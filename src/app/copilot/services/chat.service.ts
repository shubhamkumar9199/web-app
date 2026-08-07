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
import { InputSanitizer, SanitizeResult } from '../core/input-sanitizer';
import { ResponseParser } from '../core/response-parser';
import { IdempotencyKeyFactory } from '../core/idempotency';

/** Services */
import { McpClientService } from './mcp-client.service';
import { AiContextService } from './ai-context.service';
import { AuthenticationService } from '../../core/authentication/authentication.service';
import { COPILOT_CONFIG } from '../copilot.config';

const HISTORY_STORAGE_KEY = 'copilot_chat_history';

/** Accumulates the raw stream for one assistant turn. */
interface StreamAccumulator {
  text: string;
  cards: ActionCard[];
}

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
  private readonly httpClient = inject(HttpClient);
  private readonly config = inject(COPILOT_CONFIG);

  private readonly sanitizer = new InputSanitizer();
  private readonly parser = new ResponseParser();
  private readonly idempotencyFactory = new IdempotencyKeyFactory();

  /** Live message list for the active conversation. */
  readonly messages$ = new BehaviorSubject<ChatMessage[]>([]);
  /** Saved conversations for the Recent Chats tab. */
  readonly conversations$ = new BehaviorSubject<Conversation[]>([]);

  private sessionId = this.newSessionId();
  private activeSubscription: Subscription | null = null;
  private seq = 0;

  /** Send a user message and stream the assistant reply. */
  async sendMessage(content: string): Promise<void> {
    if (this.activeSubscription) {
      return;
    }

    const sanitized = this.sanitizer.sanitize(content);
    if (sanitized.blocked || !sanitized.text) {
      this.pushMessage({
        id: this.nextId(),
        role: 'system',
        content: this.rejectionMessage(sanitized.reason),
        timestamp: Date.now()
      });
      return;
    }

    this.pushMessage({
      id: this.nextId(),
      role: 'user',
      content: sanitized.text,
      timestamp: Date.now(),
      clientId: this.aiContextService.getCurrentClientId()
    });
    this.persistCurrentConversation();

    const context = this.aiContextService.getContextSnapshot();
    const idempotencyKey = this.idempotencyFactory.generate(
      this.authenticationService.getCredentials()?.userId ?? 0,
      'chat_message',
      context.clientId ?? 0,
      Date.now()
    );

    const assistantId = this.nextId();
    this.pushMessage({
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true
    });

    const accumulator: StreamAccumulator = { text: '', cards: [] };
    try {
      const subscription = this.mcpClientService.sendMessage(sanitized.text, context, idempotencyKey).subscribe({
        next: (event) => this.handleStreamEvent(assistantId, event, accumulator),
        error: (error) => this.finalizeWithError(assistantId, error),
        complete: () => this.clearActiveSubscription()
      });
      // A synchronous stream (e.g. test fixtures) may already have completed and
      // cleared the subscription by the time subscribe() returns; do not stomp that.
      if (!subscription.closed) {
        this.activeSubscription = subscription;
      }
    } catch (error) {
      this.finalizeWithError(assistantId, error);
    }
  }

  /** Cancel an in-flight streaming response. */
  stopStreaming(): void {
    this.activeSubscription?.unsubscribe();
    this.clearActiveSubscription();
    const messages = this.messages$.value;
    const last = messages[messages.length - 1];
    if (last?.isStreaming) {
      this.updateMessage(last.id, { isStreaming: false });
    }
  }

  /** Start a fresh conversation. */
  clearChat(): void {
    this.stopStreaming();
    this.persistCurrentConversation();
    this.sessionId = this.newSessionId();
    this.messages$.next([]);
  }

  /** Load persisted conversations for the current user. */
  async loadHistory(): Promise<void> {
    const userId = this.authenticationService.getCredentials()?.userId;
    if (userId == null) {
      this.conversations$.next(this.readCachedConversations());
      return;
    }
    try {
      const conversations = await firstValueFrom(
        this.httpClient.get<Conversation[]>(`${this.config.mcpBaseUrl}/api/chat/history/${userId}`)
      );
      const list = conversations ?? [];
      this.conversations$.next(list);
      this.cacheConversations(list);
    } catch {
      this.conversations$.next(this.readCachedConversations());
    }
  }

  /** Route a single stream event to the in-progress assistant message. */
  private handleStreamEvent(messageId: string, event: McpStreamEvent, accumulator: StreamAccumulator): void {
    try {
      switch (event.type) {
        case 'token':
          accumulator.text += event.token ?? '';
          this.updateMessage(messageId, { content: accumulator.text });
          break;
        case 'action_card':
          if (event.card) {
            accumulator.cards = [
              ...accumulator.cards,
              event.card
            ];
            this.updateMessage(messageId, { actionCards: accumulator.cards });
          }
          break;
        case 'tool_call':
          this.mcpClientService.handleToolCall(event);
          break;
        case 'error':
          this.finalizeWithError(messageId, event.message);
          break;
        case 'done':
          this.finalizeMessage(messageId, accumulator);
          break;
      }
    } catch (error) {
      this.finalizeWithError(messageId, error);
    }
  }

  /** Parse the fully-streamed text and mark the assistant message complete. */
  private finalizeMessage(messageId: string, accumulator: StreamAccumulator): void {
    const parsed = this.parser.parse(accumulator.text);
    this.updateMessage(messageId, {
      content: parsed.text,
      actionCards: [
        ...accumulator.cards,
        ...parsed.actionCards
      ],
      suggestedPrompts: parsed.suggestedPrompts,
      isStreaming: false
    });
    this.clearActiveSubscription();
    this.persistCurrentConversation();
  }

  /** Surface a stream failure as the assistant message content and stop streaming. */
  private finalizeWithError(messageId: string, error: unknown): void {
    this.updateMessage(messageId, {
      content: this.errorMessage(error),
      isStreaming: false
    });
    this.clearActiveSubscription();
    this.persistCurrentConversation();
  }

  private clearActiveSubscription(): void {
    this.activeSubscription = null;
  }

  private pushMessage(message: ChatMessage): void {
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

  /** Upsert the active session into the Recent Chats list and cache it locally. */
  private persistCurrentConversation(): void {
    const messages = this.messages$.value;
    if (messages.length === 0) {
      return;
    }
    const firstUserMessage = messages.find((message) => message.role === 'user');
    const lastMessage = messages[messages.length - 1];
    const conversation: Conversation = {
      id: this.sessionId,
      title: this.truncate(firstUserMessage?.content ?? lastMessage.content, 60),
      preview: this.truncate(lastMessage.content, 120),
      timestamp: lastMessage.timestamp,
      messageCount: messages.length,
      messages
    };
    const others = this.conversations$.value.filter((existing) => existing.id !== conversation.id);
    const updated = [
      conversation,
      ...others
    ].sort((a, b) => b.timestamp - a.timestamp);
    this.conversations$.next(updated);
    this.cacheConversations(updated);
  }

  private cacheConversations(conversations: Conversation[]): void {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(conversations));
    } catch {
      // Storage unavailable or full: in-memory conversations$ still reflects current state.
    }
  }

  private readCachedConversations(): Conversation[] {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private rejectionMessage(reason: SanitizeResult['reason']): string {
    if (reason === 'injection_detected') {
      return 'This message was blocked for security reasons.';
    }
    return 'Message must be between 1 and 500 characters.';
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return 'Something went wrong while contacting the assistant. Please try again.';
  }

  private truncate(text: string, max: number): string {
    const trimmed = (text ?? '').trim();
    return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
  }

  private newSessionId(): string {
    this.seq = 0;
    return `session-${Date.now()}`;
  }

  private nextId(): string {
    this.seq += 1;
    return `${this.sessionId}-m${this.seq}`;
  }
}
