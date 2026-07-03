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
import { BehaviorSubject, Subscription, firstValueFrom, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

/** Models */
import { ChatMessage, ChatRole, Conversation } from '../core/models/chat-message.model';
import { ActionCard } from '../core/models/action-card.model';

/** Core */
import { InputSanitizer, SanitizeResult } from '../core/input-sanitizer';
import { ResponseParser } from '../core/response-parser';

/** Services */
import { McpClientService } from './mcp-client.service';
import { AiContextService } from './ai-context.service';
import { AuthenticationService } from '../../core/authentication/authentication.service';
import { COPILOT_CONFIG } from '../copilot.config';

const HISTORY_STORAGE_KEY = 'mifosx_copilot_conversations';
const MAX_STORED_CONVERSATIONS = 20;

/**
 * Orchestrates a conversation: sends user input through sanitize -> MCP ->
 * parse, maintains the streaming message list, and persists history to the
 * MCP server (PostgreSQL) with a localStorage fallback.
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly mcpClientService = inject(McpClientService);
  private readonly aiContextService = inject(AiContextService);
  private readonly authenticationService = inject(AuthenticationService);
  private readonly http = inject(HttpClient);
  private readonly config = inject(COPILOT_CONFIG);

  private readonly sanitizer = new InputSanitizer();
  private readonly parser = new ResponseParser();

  /** Live message list for the active conversation. */
  readonly messages$ = new BehaviorSubject<ChatMessage[]>([]);
  /** Saved conversations for the Recent Chats tab. */
  readonly conversations$ = new BehaviorSubject<Conversation[]>([]);

  private activeStream: { subscription: Subscription; resolve: () => void } | null = null;
  private idSeq = 0;
  private conversationId = this.newId('c');

  /** Send a user message and stream the assistant reply. */
  async sendMessage(content: string): Promise<void> {
    if (this.activeStream) {
      return;
    }
    const trimmed = (content ?? '').trim();
    if (!trimmed) {
      return;
    }

    const sanitized = this.sanitizer.sanitize(trimmed);
    this.appendMessage('user', trimmed);
    if (sanitized.blocked) {
      this.appendMessage('system', this.blockedReasonText(sanitized));
      return;
    }

    const assistantId = this.appendMessage('assistant', '', { isStreaming: true });
    const context = this.aiContextService.getContextSnapshot();

    await new Promise<void>((resolve) => {
      let rawText = '';
      let toolUsed: string | undefined;
      const streamedCards: ActionCard[] = [];

      const subscription = this.mcpClientService.sendMessage(sanitized.text!, context).subscribe({
        next: (event) => {
          switch (event.type) {
            case 'token':
              rawText += event.token ?? '';
              this.updateMessage(assistantId, { content: rawText });
              break;
            case 'tool_call':
              toolUsed = event.toolName;
              break;
            case 'action_card':
              if (event.card) {
                streamedCards.push(event.card);
              }
              break;
            case 'error':
              rawText = event.message || rawText;
              break;
            default:
              break;
          }
        },
        error: () => {
          this.updateMessage(assistantId, {
            content: rawText || "Sorry, I couldn't reach the assistant. Please try again.",
            isStreaming: false
          });
          this.finishStream(resolve);
        },
        complete: () => {
          const parsed = this.parser.parse(rawText);
          this.updateMessage(assistantId, {
            content: parsed.text,
            actionCards: [
              ...streamedCards,
              ...parsed.actionCards
            ],
            suggestedPrompts: parsed.suggestedPrompts,
            toolUsed,
            isStreaming: false
          });
          this.finishStream(resolve);
        }
      });
      this.activeStream = { subscription, resolve };
    });
  }

  /** Cancel an in-flight streaming response. */
  stopStreaming(): void {
    if (!this.activeStream) {
      return;
    }
    const { subscription, resolve } = this.activeStream;
    subscription.unsubscribe();
    this.activeStream = null;
    const messages = this.messages$.value;
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant' && last.isStreaming) {
      this.updateMessage(last.id, { isStreaming: false });
    }
    this.persistConversation();
    resolve();
  }

  /** Start a fresh conversation. */
  clearChat(): void {
    this.stopStreaming();
    this.conversationId = this.newId('c');
    this.messages$.next([]);
  }

  /** Load persisted conversations for the current user. */
  async loadHistory(): Promise<void> {
    const userId = this.authenticationService.getCredentials()?.userId;
    const remote =
      userId == null
        ? null
        : await firstValueFrom(
            this.http
              .get<Conversation[]>(`${this.config.mcpBaseUrl}/api/chat/history/${userId}`)
              .pipe(catchError(() => of(null)))
          );
    this.conversations$.next(remote ?? this.readLocalHistory());
  }

  private finishStream(resolve: () => void): void {
    this.activeStream = null;
    this.persistConversation();
    resolve();
  }

  private appendMessage(role: ChatRole, content: string, extra: Partial<ChatMessage> = {}): string {
    const message: ChatMessage = { id: this.newId('m'), role, content, timestamp: Date.now(), ...extra };
    this.messages$.next([
      ...this.messages$.value,
      message
    ]);
    return message.id;
  }

  private newId(prefix: string): string {
    this.idSeq += 1;
    return `${prefix}-${Date.now()}-${this.idSeq}`;
  }

  private updateMessage(id: string, patch: Partial<ChatMessage>): void {
    this.messages$.next(
      this.messages$.value.map((message) => (message.id === id ? { ...message, ...patch } : message))
    );
  }

  private blockedReasonText(result: SanitizeResult): string {
    return result.reason === 'injection_detected'
      ? "That message looks like it's trying to override my instructions, so I can't process it."
      : 'Please enter a message between 1 and 500 characters.';
  }

  private persistConversation(): void {
    const messages = this.messages$.value;
    const firstUserMessage = messages.find((message) => message.role === 'user');
    if (!firstUserMessage) {
      return;
    }
    const lastMessage = messages[messages.length - 1];
    const conversation: Conversation = {
      id: this.conversationId,
      title: firstUserMessage.content.slice(0, 60),
      preview: lastMessage.content.slice(0, 120),
      timestamp: Date.now(),
      messageCount: messages.length,
      messages
    };
    const withoutCurrent = this.conversations$.value.filter((existing) => existing.id !== this.conversationId);
    const conversations = [
      conversation,
      ...withoutCurrent
    ].slice(0, MAX_STORED_CONVERSATIONS);
    this.conversations$.next(conversations);
    this.writeLocalHistory(conversations);
  }

  private readLocalHistory(): Conversation[] {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Conversation[]) : [];
    } catch {
      return [];
    }
  }

  private writeLocalHistory(conversations: Conversation[]): void {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(conversations));
    } catch {
      // Storage unavailable/full: in-memory conversations$ still reflects the session.
    }
  }
}
