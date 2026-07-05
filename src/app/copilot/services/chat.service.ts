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
import { McpStreamEvent } from '../core/models/mcp-response.model';
import { ActionCard } from '../core/models/action-card.model';

/** Core logic */
import { InputSanitizer, MAX_INPUT_LENGTH, SanitizeResult } from '../core/input-sanitizer';
import { ResponseParser } from '../core/response-parser';

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
  private readonly http = inject(HttpClient);
  private readonly mcpClientService = inject(McpClientService);
  private readonly aiContextService = inject(AiContextService);
  private readonly authenticationService = inject(AuthenticationService);
  private readonly config = inject(COPILOT_CONFIG);

  private readonly sanitizer = new InputSanitizer();
  private readonly parser = new ResponseParser();

  /** Live message list for the active conversation. */
  readonly messages$ = new BehaviorSubject<ChatMessage[]>([]);
  /** Saved conversations for the Recent Chats tab. */
  readonly conversations$ = new BehaviorSubject<Conversation[]>([]);

  private sessionId = this.newId();
  private activeStream: Subscription | null = null;
  private activeAssistantId: string | null = null;
  private pendingResolve: (() => void) | null = null;
  private rawBuffer = '';
  private streamedCards: ActionCard[] = [];
  private pendingToolUsed: string | undefined;
  private idSeq = 0;

  /** Send a user message and stream the assistant reply. */
  async sendMessage(content: string): Promise<void> {
    this.stopStreaming();

    const trimmed = (content ?? '').trim();
    this.appendMessage({
      id: this.newId(),
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
      clientId: this.aiContextService.getCurrentClientId()
    });

    const sanitized = this.sanitizer.sanitize(trimmed);
    if (sanitized.blocked) {
      this.appendMessage({
        id: this.newId(),
        role: 'system',
        content: this.blockedReasonText(sanitized.reason),
        timestamp: Date.now()
      });
      return;
    }

    const context = this.aiContextService.getContextSnapshot();
    this.activeAssistantId = this.newId();
    this.rawBuffer = '';
    this.streamedCards = [];
    this.pendingToolUsed = undefined;
    this.appendMessage({
      id: this.activeAssistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true
    });

    return new Promise<void>((resolve) => {
      this.pendingResolve = resolve;
      try {
        this.activeStream = this.mcpClientService.sendMessage(sanitized.text as string, context).subscribe({
          next: (event) => this.handleStreamEvent(event),
          error: () => this.completeStream(this.genericErrorText()),
          complete: () => this.completeStream()
        });
      } catch {
        this.completeStream(this.genericErrorText());
      }
    });
  }

  /** Cancel an in-flight streaming response. */
  stopStreaming(): void {
    if (!this.activeStream && !this.activeAssistantId && !this.pendingResolve) {
      return;
    }
    this.completeStream();
  }

  /** Start a fresh conversation. */
  clearChat(): void {
    this.stopStreaming();
    this.sessionId = this.newId();
    this.messages$.next([]);
  }

  /** Load persisted conversations for the current user. */
  async loadHistory(): Promise<void> {
    const userId = this.authenticationService.getCredentials()?.userId;
    if (userId == null) {
      this.conversations$.next(this.readLocalHistory());
      return;
    }
    const remote = await firstValueFrom(
      this.http
        .get<Conversation[]>(`${this.config.mcpBaseUrl}/api/chat/history/${userId}`)
        .pipe(catchError(() => of(null)))
    );
    this.conversations$.next(remote ?? this.readLocalHistory());
  }

  private handleStreamEvent(event: McpStreamEvent): void {
    const id = this.activeAssistantId;
    if (!id) {
      return;
    }
    switch (event.type) {
      case 'token':
        this.rawBuffer += event.token ?? '';
        this.updateMessage(id, (message) => ({ ...message, content: this.parser.parse(this.rawBuffer).text }));
        break;
      case 'action_card':
        if (event.card) {
          this.streamedCards.push(event.card);
        }
        break;
      case 'tool_call':
        this.pendingToolUsed = event.toolName;
        try {
          this.mcpClientService.handleToolCall(event);
        } catch {
          // Tool-call routing (confirmation dialog) is not wired up yet; the token stream continues.
        }
        break;
      case 'error':
        this.completeStream(event.message || this.genericErrorText());
        break;
      case 'done':
        this.completeStream();
        break;
    }
  }

  /** Unsubscribe, finalize the streaming message, persist the conversation and resolve sendMessage(). */
  private completeStream(errorMessage?: string): void {
    if (this.activeStream) {
      this.activeStream.unsubscribe();
      this.activeStream = null;
    }
    this.finishStreamingMessage(errorMessage);
    this.persistConversation();
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    resolve?.();
  }

  private finishStreamingMessage(errorMessage?: string): void {
    const id = this.activeAssistantId;
    if (!id) {
      return;
    }
    const parsed = this.parser.parse(this.rawBuffer);
    this.updateMessage(id, (message) => ({
      ...message,
      isStreaming: false,
      content: errorMessage ?? (parsed.text || message.content),
      actionCards: [
        ...this.streamedCards,
        ...parsed.actionCards
      ],
      suggestedPrompts: parsed.suggestedPrompts,
      toolUsed: this.pendingToolUsed
    }));
    this.activeAssistantId = null;
    this.rawBuffer = '';
    this.streamedCards = [];
    this.pendingToolUsed = undefined;
  }

  private persistConversation(): void {
    const messages = this.messages$.value;
    if (messages.length === 0) {
      return;
    }
    const firstUserMessage = messages.find((message) => message.role === 'user');
    const lastMessage = messages[messages.length - 1];
    const conversation: Conversation = {
      id: this.sessionId,
      title: this.truncate(firstUserMessage?.content ?? 'New conversation', 60),
      preview: this.truncate(lastMessage.content, 120),
      timestamp: lastMessage.timestamp,
      messageCount: messages.length,
      messages
    };
    const updated = [
      conversation,
      ...this.conversations$.value.filter((existing) => existing.id !== conversation.id)
    ];
    this.conversations$.next(updated);
    this.writeLocalHistory(updated);
  }

  private appendMessage(message: ChatMessage): void {
    this.messages$.next([
      ...this.messages$.value,
      message
    ]);
  }

  private updateMessage(id: string, updater: (message: ChatMessage) => ChatMessage): void {
    this.messages$.next(this.messages$.value.map((message) => (message.id === id ? updater(message) : message)));
  }

  private blockedReasonText(reason: SanitizeResult['reason']): string {
    return reason === 'injection_detected'
      ? 'This message looks like an attempt to change how the assistant behaves, so it was not sent.'
      : `Messages must be between 1 and ${MAX_INPUT_LENGTH} characters.`;
  }

  private genericErrorText(): string {
    return 'Something went wrong reaching the assistant. Please try again.';
  }

  /** Session-unique id, no Web Crypto dependency so it also works under Jest's jsdom environment. */
  private newId(): string {
    this.idSeq += 1;
    return `${Date.now().toString(36)}-${this.idSeq}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private truncate(text: string, max: number): string {
    const clean = (text ?? '').trim();
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
  }

  private readLocalHistory(): Conversation[] {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeLocalHistory(conversations: Conversation[]): void {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(conversations));
    } catch {
      // Storage unavailable or full; conversations$ still reflects the in-memory session.
    }
  }
}
