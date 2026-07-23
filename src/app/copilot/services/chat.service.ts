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
import { McpStreamEvent } from '../core/models/mcp-response.model';
import { ActionCard } from '../core/models/action-card.model';

/** Core */
import { InputSanitizer, SanitizeResult } from '../core/input-sanitizer';
import { ResponseParser } from '../core/response-parser';
import { IdempotencyKeyFactory } from '../core/idempotency';

/** Config */
import { COPILOT_CONFIG } from '../copilot.config';

/** Services */
import { McpClientService } from './mcp-client.service';
import { AiContextService } from './ai-context.service';
import { AuthenticationService } from '../../core/authentication/authentication.service';

const HISTORY_STORAGE_KEY = 'copilot_chat_history';

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
  private readonly idempotency = new IdempotencyKeyFactory();

  /** Live message list for the active conversation. */
  readonly messages$ = new BehaviorSubject<ChatMessage[]>([]);
  /** Saved conversations for the Recent Chats tab. */
  readonly conversations$ = new BehaviorSubject<Conversation[]>([]);

  private conversationId = this.createId();
  private streamSubscription: Subscription | null = null;
  private activeResolve: (() => void) | null = null;
  private seq = 0;

  /** Send a user message and stream the assistant reply. */
  async sendMessage(content: string): Promise<void> {
    const result = this.sanitizer.sanitize(content);
    if (result.blocked) {
      this.appendMessage(this.buildRejectionMessage(result.reason));
      return;
    }

    this.stopStreaming();

    const context = this.aiContextService.getContextSnapshot();
    this.appendMessage({
      id: this.nextMessageId(),
      role: 'user',
      content: result.text as string,
      timestamp: Date.now(),
      clientId: context.clientId
    });

    const assistantId = this.nextMessageId();
    this.appendMessage({
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true
    });

    const idempotencyKey = this.idempotency.generate(
      this.authenticationService.getCredentials()?.userId ?? 0,
      'chat_message',
      context.clientId ?? 0,
      Date.now()
    );

    let raw = '';
    let toolUsed: string | undefined;
    const streamedCards: ActionCard[] = [];

    try {
      await new Promise<void>((resolve, reject) => {
        this.activeResolve = resolve;
        try {
          this.streamSubscription = this.mcpClientService
            .sendMessage(result.text as string, context, idempotencyKey)
            .subscribe({
              next: (event) => {
                raw = this.applyStreamEvent(event, raw, streamedCards, assistantId, (name) => (toolUsed = name));
              },
              error: () => {
                this.finalizeAssistantMessage(assistantId, raw, toolUsed, streamedCards);
                this.settle(resolve);
              },
              complete: () => {
                this.finalizeAssistantMessage(assistantId, raw, toolUsed, streamedCards);
                this.settle(resolve);
              }
            });
        } catch (err) {
          reject(err);
        }
      });
    } catch {
      this.finalizeAssistantMessage(assistantId, raw, toolUsed, streamedCards);
    }

    this.persistConversation();
  }

  /** Cancel an in-flight streaming response. */
  stopStreaming(): void {
    this.streamSubscription?.unsubscribe();
    this.streamSubscription = null;

    const messages = this.messages$.value;
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant' && last.isStreaming) {
      this.updateMessage(last.id, { isStreaming: false });
    }

    if (this.activeResolve) {
      this.settle(this.activeResolve);
    }
  }

  /** Start a fresh conversation. */
  clearChat(): void {
    this.stopStreaming();
    this.messages$.next([]);
    this.conversationId = this.createId();
    this.seq = 0;
  }

  /** Load persisted conversations for the current user. */
  async loadHistory(): Promise<void> {
    const userId = this.authenticationService.getCredentials()?.userId;
    if (!userId) {
      this.conversations$.next(this.readFromLocalStorage());
      return;
    }
    try {
      const remote = await firstValueFrom(
        this.http.get<Conversation[]>(`${this.config.mcpBaseUrl}/api/chat/history/${userId}`)
      );
      const conversations = remote ?? [];
      this.conversations$.next(conversations);
      this.saveToLocalStorage(conversations);
    } catch {
      this.conversations$.next(this.readFromLocalStorage());
    }
  }

  /** Apply one stream event to the running state, updating the live message as it goes. */
  private applyStreamEvent(
    event: McpStreamEvent,
    raw: string,
    streamedCards: ActionCard[],
    assistantId: string,
    setToolUsed: (name: string) => void
  ): string {
    switch (event.type) {
      case 'token': {
        const next = event.token ? raw + event.token : raw;
        this.updateMessage(assistantId, { content: next });
        return next;
      }
      case 'tool_call':
        if (event.toolName) {
          setToolUsed(event.toolName);
          this.mcpClientService.handleToolCall(event);
        }
        return raw;
      case 'action_card':
        if (event.card) {
          streamedCards.push(event.card);
        }
        return raw;
      case 'error':
        return event.message ?? raw;
      default:
        return raw;
    }
  }

  /** Parse the accumulated text and mark the assistant message as settled. */
  private finalizeAssistantMessage(
    id: string,
    raw: string,
    toolUsed: string | undefined,
    streamedCards: ActionCard[]
  ): void {
    const parsed = this.parser.parse(raw);
    const text = parsed.text || raw.trim() || this.fallbackErrorText();
    const cards = [
      ...parsed.actionCards,
      ...streamedCards
    ];
    this.updateMessage(id, {
      content: text,
      isStreaming: false,
      toolUsed,
      actionCards: cards.length ? cards : undefined,
      suggestedPrompts: parsed.suggestedPrompts.length ? parsed.suggestedPrompts : undefined
    });
  }

  private settle(resolve: () => void): void {
    this.activeResolve = null;
    resolve();
  }

  private buildRejectionMessage(reason: SanitizeResult['reason']): ChatMessage {
    const content =
      reason === 'injection_detected'
        ? "I can't process that request."
        : 'Message must be between 1 and 500 characters.';
    return { id: this.nextMessageId(), role: 'assistant', content, timestamp: Date.now() };
  }

  private fallbackErrorText(): string {
    return 'Something went wrong reaching the assistant. Please try again.';
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

  private persistConversation(): void {
    const messages = this.messages$.value;
    if (!messages.length) {
      return;
    }
    const firstUser = messages.find((m) => m.role === 'user');
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    const conversation: Conversation = {
      id: this.conversationId,
      title: this.truncate(firstUser?.content ?? '', 60),
      preview: this.truncate(lastAssistant?.content ?? '', 120),
      timestamp: Date.now(),
      messageCount: messages.length,
      messages
    };
    const updated = [
      conversation,
      ...this.conversations$.value.filter((c) => c.id !== conversation.id)
    ];
    this.conversations$.next(updated);
    this.saveToLocalStorage(updated);
  }

  private truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  private saveToLocalStorage(conversations: Conversation[]): void {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(conversations));
    } catch {
      // localStorage unavailable (private browsing / quota exceeded): history stays in-memory only.
    }
  }

  private readFromLocalStorage(): Conversation[] {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Conversation[]) : [];
    } catch {
      return [];
    }
  }

  private nextMessageId(): string {
    this.seq += 1;
    return `m-${this.seq}`;
  }

  private createId(): string {
    return `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
