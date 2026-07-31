/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/** Angular Imports */
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Subscription, catchError, of } from 'rxjs';

/** Models */
import { ChatMessage, Conversation } from '../core/models/chat-message.model';
import { McpStreamEvent } from '../core/models/mcp-response.model';

/** Core */
import { InputSanitizer } from '../core/input-sanitizer';
import { ResponseParser } from '../core/response-parser';
import { COPILOT_CONFIG } from '../copilot.config';

/** Services */
import { McpClientService } from './mcp-client.service';
import { AiContextService } from './ai-context.service';

const HISTORY_STORAGE_KEY = 'copilot_chat_history';

/**
 * Orchestrates a conversation: sends user input through sanitize -> MCP ->
 * parse, maintains the streaming message list, and persists history to the
 * MCP server (PostgreSQL) with a localStorage fallback.
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(COPILOT_CONFIG);
  private readonly mcpClient = inject(McpClientService);
  private readonly aiContext = inject(AiContextService);

  private readonly sanitizer = new InputSanitizer();
  private readonly parser = new ResponseParser();

  /** Live message list for the active conversation. */
  readonly messages$ = new BehaviorSubject<ChatMessage[]>([]);
  /** Saved conversations for the Recent Chats tab. */
  readonly conversations$ = new BehaviorSubject<Conversation[]>([]);

  private activeSubscription: Subscription | null = null;
  private seq = 0;
  private conversationId = this.newId('conv');

  /** Send a user message and stream the assistant reply. */
  async sendMessage(content: string): Promise<void> {
    const sanitized = this.sanitizer.sanitize(content);
    if (sanitized.blocked) {
      this.appendMessage(this.buildMessage('system', this.blockedReasonText(sanitized.reason)));
      return;
    }

    this.stopStreaming();
    this.appendMessage(this.buildMessage('user', sanitized.text ?? ''));
    const assistantMessage = this.buildMessage('assistant', '');
    assistantMessage.isStreaming = true;
    this.appendMessage(assistantMessage);

    const context = this.aiContext.getContextSnapshot();
    const raw = { text: '' };

    return new Promise<void>((resolve) => {
      const finish = (): void => {
        this.activeSubscription = null;
        this.updateMessage(assistantMessage.id, { isStreaming: false });
        this.saveConversation();
        resolve();
      };
      try {
        this.activeSubscription = this.mcpClient.sendMessage(sanitized.text ?? '', context).subscribe({
          next: (event) => this.applyStreamEvent(assistantMessage.id, event, raw),
          error: () => {
            this.updateMessage(assistantMessage.id, { content: this.errorReplyText() });
            finish();
          },
          complete: finish
        });
      } catch {
        this.updateMessage(assistantMessage.id, { content: this.errorReplyText() });
        finish();
      }
    });
  }

  /** Cancel an in-flight streaming response. */
  stopStreaming(): void {
    this.activeSubscription?.unsubscribe();
    this.activeSubscription = null;
    const last = this.messages$.value[this.messages$.value.length - 1];
    if (last?.role === 'assistant' && last.isStreaming) {
      this.updateMessage(last.id, { isStreaming: false });
    }
  }

  /** Start a fresh conversation. */
  clearChat(): void {
    this.stopStreaming();
    this.messages$.next([]);
    this.conversationId = this.newId('conv');
  }

  /** Load persisted conversations for the current user. */
  async loadHistory(): Promise<void> {
    const userId = this.aiContext.getContextSnapshot().loggedInUser;
    const localHistory = this.readLocalHistory();
    if (!userId) {
      this.conversations$.next(localHistory);
      return;
    }

    const remote$ = this.http
      .get<Conversation[]>(`${this.config.mcpBaseUrl}/api/chat/history/${encodeURIComponent(userId)}`)
      .pipe(catchError(() => of(null)));
    const remoteHistory = await new Promise<Conversation[] | null>((resolve) => {
      remote$.subscribe((result) => resolve(result));
    });
    this.conversations$.next(remoteHistory ?? localHistory);
  }

  /** Route a stream event to the in-flight assistant message. */
  private applyStreamEvent(messageId: string, event: McpStreamEvent, raw: { text: string }): void {
    switch (event.type) {
      case 'token':
        raw.text += event.token ?? '';
        this.updateMessage(messageId, { content: raw.text });
        break;
      case 'action_card':
        if (event.card) {
          this.updateMessage(messageId, (message) => ({
            actionCards: [
              ...(message.actionCards ?? []),
              event.card!
            ]
          }));
        }
        break;
      case 'tool_call':
        this.updateMessage(messageId, { toolUsed: event.toolName });
        break;
      case 'error':
        this.updateMessage(messageId, { content: event.message || this.errorReplyText() });
        break;
      case 'done':
        this.applyParsedResponse(messageId, raw.text);
        break;
      default:
        break;
    }
  }

  /** Merge any fenced action cards / suggestions found in the assembled text. */
  private applyParsedResponse(messageId: string, rawText: string): void {
    const parsed = this.parser.parse(rawText);
    this.updateMessage(messageId, (message) => ({
      content: parsed.text || message.content,
      actionCards: parsed.actionCards.length ? [
            ...(message.actionCards ?? []),
            ...parsed.actionCards
          ] : message.actionCards,
      suggestedPrompts: parsed.suggestedPrompts.length ? parsed.suggestedPrompts : message.suggestedPrompts
    }));
  }

  private buildMessage(role: ChatMessage['role'], content: string): ChatMessage {
    return {
      id: this.newId('msg'),
      role,
      content,
      timestamp: Date.now(),
      clientId: this.aiContext.getCurrentClientId()
    };
  }

  private appendMessage(message: ChatMessage): void {
    this.messages$.next([
      ...this.messages$.value,
      message
    ]);
  }

  private updateMessage(
    id: string,
    patch: Partial<ChatMessage> | ((message: ChatMessage) => Partial<ChatMessage>)
  ): void {
    this.messages$.next(
      this.messages$.value.map((message) =>
        message.id === id ? { ...message, ...(typeof patch === 'function' ? patch(message) : patch) } : message
      )
    );
  }

  private saveConversation(): void {
    const messages = this.messages$.value;
    const firstUserMessage = messages.find((message) => message.role === 'user');
    if (!firstUserMessage) {
      return;
    }
    const conversation: Conversation = {
      id: this.conversationId,
      title: firstUserMessage.content.slice(0, 60),
      preview: messages[messages.length - 1]?.content.slice(0, 120) ?? '',
      timestamp: Date.now(),
      messageCount: messages.length,
      messages
    };
    const history = this.readLocalHistory().filter((existing) => existing.id !== conversation.id);
    const updated = [
      conversation,
      ...history
    ];
    this.conversations$.next(updated);
    this.writeLocalHistory(updated);
  }

  private readLocalHistory(): Conversation[] {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Conversation[]) : [];
    } catch {
      return [];
    }
  }

  private writeLocalHistory(history: Conversation[]): void {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch {
      // Storage unavailable or full; history simply will not persist across reloads.
    }
  }

  private blockedReasonText(reason: string | undefined): string {
    return reason === 'invalid_length'
      ? 'Your message is empty or too long. Please rephrase and try again.'
      : 'Your message could not be sent for security reasons. Please rephrase and try again.';
  }

  private errorReplyText(): string {
    return 'Something went wrong reaching the assistant. Please try again.';
  }

  private newId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${Date.now()}-${this.seq}`;
  }
}
