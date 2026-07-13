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
import { ChatMessage, Conversation } from '../core/models/chat-message.model';
import { ActionCard } from '../core/models/action-card.model';
import { McpStreamEvent } from '../core/models/mcp-response.model';
import { SanitizeResult } from '../core/input-sanitizer';

/** Core / services */
import { InputSanitizer } from '../core/input-sanitizer';
import { ResponseParser } from '../core/response-parser';
import { COPILOT_CONFIG } from '../copilot.config';
import { AiContextService } from './ai-context.service';
import { McpClientService } from './mcp-client.service';

const HISTORY_STORAGE_KEY = 'copilot_chat_history';
const GENERIC_ERROR_TEXT = 'Sorry, something went wrong while reaching the assistant. Please try again.';

/**
 * Orchestrates a conversation: sends user input through sanitize -> MCP ->
 * parse, maintains the streaming message list, and persists history to the
 * MCP server (PostgreSQL) with a localStorage fallback.
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(COPILOT_CONFIG);
  private readonly aiContextService = inject(AiContextService);
  private readonly mcpClientService = inject(McpClientService);

  private readonly sanitizer = new InputSanitizer();
  private readonly responseParser = new ResponseParser();

  /** Live message list for the active conversation. */
  readonly messages$ = new BehaviorSubject<ChatMessage[]>([]);
  /** Saved conversations for the Recent Chats tab. */
  readonly conversations$ = new BehaviorSubject<Conversation[]>([]);

  private activeSubscription?: Subscription;
  private activeResolve?: () => void;
  private seq = 0;
  private currentConversationId = this.nextId('conv');

  /** Send a user message and stream the assistant reply. */
  async sendMessage(content: string): Promise<void> {
    const sanitized = this.sanitizer.sanitize(content);
    if (sanitized.blocked) {
      this.appendMessages(
        this.buildMessage('user', (content ?? '').trim()),
        this.buildMessage('system', this.blockedReasonText(sanitized))
      );
      return;
    }

    this.endActiveTurn();
    const userMessage = this.buildMessage('user', sanitized.text as string);
    const assistantMessage = this.buildMessage('assistant', '', {
      isStreaming: true,
      actionCards: [],
      suggestedPrompts: []
    });
    this.appendMessages(userMessage, assistantMessage);

    const context = this.aiContextService.getContextSnapshot();

    try {
      await new Promise<void>((resolve) => {
        this.activeResolve = resolve;
        this.activeSubscription = this.mcpClientService.sendMessage(sanitized.text as string, context).subscribe({
          next: (event) => this.handleStreamEvent(assistantMessage.id, event),
          error: () => {
            this.applyError(assistantMessage.id, GENERIC_ERROR_TEXT);
            this.finishActiveTurn();
          },
          complete: () => this.finishActiveTurn()
        });
      });
    } catch {
      this.applyError(assistantMessage.id, GENERIC_ERROR_TEXT);
    }
  }

  /** Cancel an in-flight streaming response. */
  stopStreaming(): void {
    const messages = this.messages$.value;
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant' && last.isStreaming) {
      this.updateMessage(last.id, (m) => ({ ...m, isStreaming: false }));
    }
    this.endActiveTurn();
  }

  /** Start a fresh conversation. */
  clearChat(): void {
    this.endActiveTurn();
    this.messages$.next([]);
    this.currentConversationId = this.nextId('conv');
  }

  /** Unsubscribe any in-flight stream and unblock its pending sendMessage() promise. */
  private endActiveTurn(): void {
    this.activeSubscription?.unsubscribe();
    this.activeSubscription = undefined;
    const resolve = this.activeResolve;
    this.activeResolve = undefined;
    resolve?.();
  }

  /** The stream finished on its own (done/error/complete) - just clear the bookkeeping. */
  private finishActiveTurn(): void {
    this.activeSubscription = undefined;
    const resolve = this.activeResolve;
    this.activeResolve = undefined;
    resolve?.();
  }

  /** Load persisted conversations for the current user. */
  async loadHistory(): Promise<void> {
    const { loggedInUser } = this.aiContextService.getContextSnapshot();
    const url = `${this.config.mcpBaseUrl}/api/chat/history/${encodeURIComponent(loggedInUser)}`;
    const conversations = await firstValueFrom(
      this.http.get<Conversation[]>(url).pipe(catchError(() => of(this.readConversationsFromStorage())))
    );
    this.conversations$.next(conversations ?? []);
  }

  private handleStreamEvent(messageId: string, event: McpStreamEvent): void {
    switch (event.type) {
      case 'token':
        this.appendToken(messageId, event.token ?? '');
        break;
      case 'tool_call':
        this.mcpClientService.handleToolCall(event);
        this.setToolUsed(messageId, event.toolName);
        break;
      case 'action_card':
        if (event.card) {
          this.appendActionCard(messageId, event.card);
        }
        break;
      case 'done':
        this.finalizeMessage(messageId);
        break;
      case 'error':
        this.applyError(messageId, event.message ?? GENERIC_ERROR_TEXT);
        break;
    }
  }

  private appendToken(id: string, token: string): void {
    this.updateMessage(id, (m) => ({ ...m, content: m.content + token }));
  }

  private appendActionCard(id: string, card: ActionCard): void {
    this.updateMessage(id, (m) => ({ ...m, actionCards: [
        ...(m.actionCards ?? []),
        card
      ] }));
  }

  private setToolUsed(id: string, toolName?: string): void {
    if (!toolName) {
      return;
    }
    this.updateMessage(id, (m) => ({ ...m, toolUsed: toolName }));
  }

  private finalizeMessage(id: string): void {
    this.updateMessage(id, (m) => ({
      ...m,
      isStreaming: false,
      suggestedPrompts: this.responseParser.parseSuggestions(m.content)
    }));
    this.persistCurrentConversation();
  }

  private applyError(id: string, message: string): void {
    this.updateMessage(id, (m) => ({
      ...m,
      isStreaming: false,
      content: m.content.length ? m.content : message
    }));
  }

  private appendMessages(...messages: ChatMessage[]): void {
    this.messages$.next([
      ...this.messages$.value,
      ...messages
    ]);
  }

  private updateMessage(id: string, updater: (message: ChatMessage) => ChatMessage): void {
    this.messages$.next(this.messages$.value.map((m) => (m.id === id ? updater(m) : m)));
  }

  private buildMessage(role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
    return { id: this.nextId('m'), role, content, timestamp: Date.now(), ...extra };
  }

  private blockedReasonText(result: SanitizeResult): string {
    if (result.reason === 'invalid_length') {
      return 'Your message is empty or too long. Please shorten it and try again.';
    }
    return "Sorry, I can't process that request.";
  }

  private persistCurrentConversation(): void {
    const messages = this.messages$.value;
    if (messages.length === 0) {
      return;
    }
    const firstUser = messages.find((m) => m.role === 'user');
    const last = messages[messages.length - 1];
    const conversation: Conversation = {
      id: this.currentConversationId,
      title: this.truncate(firstUser?.content ?? 'Conversation', 60),
      preview: this.truncate(last.content, 120),
      timestamp: last.timestamp,
      messageCount: messages.length,
      messages
    };
    const updated = [
      conversation,
      ...this.conversations$.value.filter((c) => c.id !== conversation.id)
    ];
    this.conversations$.next(updated);
    this.saveConversationsToStorage(updated);
  }

  private truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  private saveConversationsToStorage(conversations: Conversation[]): void {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(conversations));
    } catch {
      // Storage unavailable (private browsing / quota) - the in-memory list still works.
    }
  }

  private readConversationsFromStorage(): Conversation[] {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Conversation[]) : [];
    } catch {
      return [];
    }
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }
}
