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
import { BehaviorSubject, Subscription, firstValueFrom } from 'rxjs';

/** Models */
import { ChatMessage, Conversation } from '../core/models/chat-message.model';
import { ActionCard } from '../core/models/action-card.model';
import { McpStreamEvent } from '../core/models/mcp-response.model';

/** Core */
import { InputSanitizer } from '../core/input-sanitizer';
import { ResponseParser } from '../core/response-parser';
import { IdempotencyKeyFactory } from '../core/idempotency';

/** Services */
import { McpClientService } from './mcp-client.service';
import { AiContextService } from './ai-context.service';
import { AuthenticationService } from '../../core/authentication/authentication.service';

/** Config */
import { COPILOT_CONFIG } from '../copilot.config';

const CHAT_HISTORY_STORAGE_KEY = 'copilot_chat_history';

/**
 * Orchestrates a conversation: sends user input through sanitize -> MCP ->
 * parse, maintains the streaming message list, and persists history to the
 * MCP server (PostgreSQL) with a localStorage fallback.
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);
  private readonly mcpClientService = inject(McpClientService);
  private readonly aiContextService = inject(AiContextService);
  private readonly authenticationService = inject(AuthenticationService);
  private readonly config = inject(COPILOT_CONFIG);

  private readonly sanitizer = new InputSanitizer();
  private readonly responseParser = new ResponseParser();
  private readonly idempotencyFactory = new IdempotencyKeyFactory();

  /** Live message list for the active conversation. */
  readonly messages$ = new BehaviorSubject<ChatMessage[]>([]);
  /** Saved conversations for the Recent Chats tab. */
  readonly conversations$ = new BehaviorSubject<Conversation[]>([]);

  private activeSubscription: Subscription | null = null;
  private streamingMessageId: string | null = null;
  private activeResolve: (() => void) | null = null;
  private seq = 0;

  /** Send a user message and stream the assistant reply. */
  async sendMessage(content: string): Promise<void> {
    const sanitized = this.sanitizer.sanitize(content);
    if (sanitized.blocked) {
      this.appendMessage(this.buildBlockedMessage(sanitized.reason));
      return;
    }
    const text = sanitized.text as string;
    this.appendMessage({ id: this.nextId(), role: 'user', content: text, timestamp: this.now() });

    const context = this.aiContextService.getContextSnapshot();
    const credentials = this.authenticationService.getCredentials();
    const idempotencyKey = this.idempotencyFactory.generate(
      credentials?.userId ?? 0,
      'chat_message',
      context.clientId ?? 0,
      this.now()
    );

    const assistantId = this.nextId();
    this.streamingMessageId = assistantId;
    this.appendMessage({
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: this.now(),
      isStreaming: true
    });

    let rawText = '';
    const cards: ActionCard[] = [];

    await new Promise<void>((resolve) => {
      this.activeResolve = resolve;
      this.activeSubscription = this.mcpClientService.sendMessage(text, context, idempotencyKey).subscribe({
        next: (event) => {
          rawText = this.applyStreamEvent(event, assistantId, rawText, cards);
          if (event.type === 'error') {
            this.finishStreaming(assistantId, rawText, cards, event.message ?? 'copilot.chat.error');
            resolve();
          } else if (event.type === 'done') {
            this.finishStreaming(assistantId, rawText, cards);
            resolve();
          }
        },
        error: () => {
          this.finishStreaming(assistantId, rawText, cards, 'copilot.chat.error');
          resolve();
        },
        complete: () => {
          this.finishStreaming(assistantId, rawText, cards);
          resolve();
        }
      });
    });
  }

  /** Cancel an in-flight streaming response. */
  stopStreaming(): void {
    if (this.activeSubscription) {
      this.activeSubscription.unsubscribe();
      this.activeSubscription = null;
    }
    if (this.streamingMessageId) {
      this.updateMessage(this.streamingMessageId, { isStreaming: false });
      this.streamingMessageId = null;
    }
    if (this.activeResolve) {
      this.activeResolve();
      this.activeResolve = null;
    }
  }

  /** Start a fresh conversation. */
  clearChat(): void {
    this.stopStreaming();
    this.messages$.next([]);
  }

  /** Load persisted conversations for the current user, falling back to localStorage. */
  async loadHistory(): Promise<void> {
    const credentials = this.authenticationService.getCredentials();
    const userId = credentials?.userId;
    if (!userId) {
      this.conversations$.next(this.readLocalConversations());
      return;
    }
    try {
      const conversations = await firstValueFrom(
        this.http.get<Conversation[]>(`${this.config.mcpBaseUrl}/api/chat/history/${userId}`)
      );
      this.conversations$.next(conversations ?? []);
    } catch {
      this.conversations$.next(this.readLocalConversations());
    }
  }

  /** Apply one SSE event to the in-flight assistant message, returning the updated raw text. */
  private applyStreamEvent(event: McpStreamEvent, assistantId: string, rawText: string, cards: ActionCard[]): string {
    if (event.type === 'token') {
      const updated = rawText + (event.token ?? '');
      this.updateMessage(assistantId, { content: updated });
      return updated;
    }
    if (event.type === 'tool_call') {
      this.mcpClientService.handleToolCall(event);
      return rawText;
    }
    if (event.type === 'action_card' && event.card) {
      cards.push(event.card);
      this.updateMessage(assistantId, { actionCards: [...cards] });
      return rawText;
    }
    return rawText;
  }

  /** Finalize the assistant message once the stream ends, error or not. Idempotent. */
  private finishStreaming(assistantId: string, rawText: string, cards: ActionCard[], errorMessage?: string): void {
    if (this.streamingMessageId !== assistantId) {
      return;
    }
    this.streamingMessageId = null;
    this.activeSubscription = null;
    this.activeResolve = null;
    if (errorMessage) {
      this.updateMessage(assistantId, { content: errorMessage, isStreaming: false });
      return;
    }
    const parsed = this.responseParser.parse(rawText);
    this.updateMessage(assistantId, {
      content: parsed.text,
      actionCards: [
        ...cards,
        ...parsed.actionCards
      ],
      suggestedPrompts: parsed.suggestedPrompts,
      isStreaming: false
    });
  }

  private buildBlockedMessage(reason?: 'invalid_length' | 'injection_detected'): ChatMessage {
    const content = reason === 'injection_detected' ? 'copilot.chat.blockedInjection' : 'copilot.chat.blockedLength';
    return { id: this.nextId(), role: 'system', content, timestamp: this.now() };
  }

  private readLocalConversations(): Conversation[] {
    try {
      const raw = localStorage.getItem(CHAT_HISTORY_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Conversation[]) : [];
    } catch {
      return [];
    }
  }

  private appendMessage(message: ChatMessage): void {
    this.messages$.next([
      ...this.messages$.value,
      message
    ]);
  }

  private updateMessage(id: string, patch: Partial<ChatMessage>): void {
    this.messages$.next(
      this.messages$.value.map((message) => (message.id === id ? { ...message, ...patch } : message))
    );
  }

  private nextId(): string {
    this.seq += 1;
    return `m-${this.seq}`;
  }

  private now(): number {
    return Date.now();
  }
}
