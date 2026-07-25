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

/** Core (framework-agnostic) logic */
import { InputSanitizer } from '../core/input-sanitizer';
import { ResponseParser } from '../core/response-parser';

/** Services */
import { AiContextService } from './ai-context.service';
import { McpClientService } from './mcp-client.service';
import { COPILOT_CONFIG } from '../copilot.config';

const HISTORY_STORAGE_KEY = 'mifos_copilot_chat_history';

/**
 * Orchestrates a conversation: sends user input through sanitize -> MCP ->
 * parse, maintains the streaming message list, and persists history to the
 * MCP server (PostgreSQL) with a localStorage fallback.
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);
  private readonly aiContextService = inject(AiContextService);
  private readonly mcpClientService = inject(McpClientService);
  private readonly config = inject(COPILOT_CONFIG);

  private readonly inputSanitizer = new InputSanitizer();
  private readonly responseParser = new ResponseParser();

  /** Live message list for the active conversation. */
  readonly messages$ = new BehaviorSubject<ChatMessage[]>([]);
  /** Saved conversations for the Recent Chats tab. */
  readonly conversations$ = new BehaviorSubject<Conversation[]>([]);

  private activeSubscription: Subscription | null = null;
  private pendingResolve: (() => void) | null = null;
  private seq = 0;
  private conversationId = this.newId('conv');

  /** Send a user message and stream the assistant reply. */
  async sendMessage(content: string): Promise<void> {
    const sanitized = this.inputSanitizer.sanitize(content);
    if (sanitized.blocked) {
      this.append(this.buildMessage('user', content));
      this.append(this.buildMessage('assistant', this.blockedReasonText(sanitized.reason)));
      return;
    }

    this.append(this.buildMessage('user', sanitized.text as string));
    const assistantId = this.newId('msg');
    this.append({ id: assistantId, role: 'assistant', content: '', timestamp: Date.now(), isStreaming: true });

    const context = this.aiContextService.getContextSnapshot();

    await new Promise<void>((resolve) => {
      this.activeSubscription?.unsubscribe();
      this.pendingResolve = resolve;
      this.activeSubscription = this.mcpClientService.sendMessage(sanitized.text as string, context).subscribe({
        next: (event) => this.applyStreamEvent(assistantId, event),
        error: (error) => {
          this.applyError(assistantId, error?.message);
          this.settle();
        },
        complete: () => this.settle()
      });
    });
  }

  /** Cancel an in-flight streaming response. */
  stopStreaming(): void {
    this.activeSubscription?.unsubscribe();
    this.activeSubscription = null;
    const messages = this.messages$.value;
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant' && last.isStreaming) {
      this.update(last.id, { isStreaming: false });
    }
    this.settle();
  }

  /** Start a fresh conversation. */
  clearChat(): void {
    this.activeSubscription?.unsubscribe();
    this.activeSubscription = null;
    this.conversationId = this.newId('conv');
    this.messages$.next([]);
  }

  /** Load persisted conversations for the current user. */
  async loadHistory(): Promise<void> {
    const userId = this.aiContextService.getContextSnapshot().loggedInUser;
    try {
      const conversations = await firstValueFrom(
        this.http.get<Conversation[]>(`${this.config.mcpBaseUrl}/api/chat/history/${encodeURIComponent(userId)}`)
      );
      const list = conversations ?? [];
      this.conversations$.next(list);
      this.writeLocalHistory(list);
    } catch {
      this.conversations$.next(this.readLocalHistory());
    }
  }

  /** Route a single SSE event onto the streaming assistant message. */
  private applyStreamEvent(messageId: string, event: McpStreamEvent): void {
    switch (event.type) {
      case 'token':
        this.update(messageId, { content: (this.find(messageId)?.content ?? '') + (event.token ?? '') });
        break;
      case 'tool_call':
        this.update(messageId, { toolUsed: event.toolName });
        this.mcpClientService.handleToolCall(event);
        break;
      case 'action_card':
        if (event.card) {
          const existing = this.find(messageId)?.actionCards ?? [];
          this.update(messageId, { actionCards: [
              ...existing,
              event.card
            ] });
        }
        break;
      case 'done':
        this.finalize(messageId);
        break;
      case 'error':
        this.applyError(messageId, event.message);
        break;
    }
  }

  /** Extract any fenced action-card/suggestion blocks from the assembled text and persist the turn. */
  private finalize(messageId: string): void {
    const message = this.find(messageId);
    if (!message) {
      return;
    }
    const parsed = this.responseParser.parse(message.content);
    const actionCards = message.actionCards?.length ? message.actionCards : parsed.actionCards;
    this.update(messageId, {
      content: parsed.text || message.content,
      actionCards,
      suggestedPrompts: parsed.suggestedPrompts,
      isStreaming: false
    });
    this.persistConversation();
  }

  private applyError(messageId: string, message?: string): void {
    this.update(messageId, {
      content: message || 'Sorry, something went wrong while getting a response. Please try again.',
      isStreaming: false
    });
  }

  private persistConversation(): void {
    const messages = this.messages$.value;
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
    this.writeLocalHistory(updated);
  }

  private writeLocalHistory(conversations: Conversation[]): void {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(conversations));
    } catch {
      // localStorage unavailable (private browsing / quota exceeded) - history stays in-memory only.
    }
  }

  private readLocalHistory(): Conversation[] {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Conversation[]) : [];
    } catch {
      return [];
    }
  }

  private blockedReasonText(reason?: string): string {
    if (reason === 'invalid_length') {
      return 'Your message is empty or too long (max 500 characters). Please rephrase and try again.';
    }
    return "That message couldn't be processed for security reasons. Please rephrase your question.";
  }

  private truncate(text: string, max: number): string {
    const trimmed = (text ?? '').trim();
    return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
  }

  private find(id: string): ChatMessage | undefined {
    return this.messages$.value.find((m) => m.id === id);
  }

  private append(message: ChatMessage): void {
    this.messages$.next([
      ...this.messages$.value,
      message
    ]);
  }

  private update(id: string, patch: Partial<ChatMessage>): void {
    this.messages$.next(this.messages$.value.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  private buildMessage(role: ChatMessage['role'], content: string): ChatMessage {
    return { id: this.newId('msg'), role, content, timestamp: Date.now() };
  }

  private settle(): void {
    this.pendingResolve?.();
    this.pendingResolve = null;
  }

  private newId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${Date.now()}-${this.seq}`;
  }
}
