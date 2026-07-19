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

/** Core (pure logic) */
import { InputSanitizer } from '../core/input-sanitizer';
import { ResponseParser } from '../core/response-parser';

/** Services */
import { McpClientService } from './mcp-client.service';
import { AiContextService } from './ai-context.service';
import { AuthenticationService } from '../../core/authentication/authentication.service';
import { COPILOT_CONFIG } from '../copilot.config';

const HISTORY_STORAGE_KEY = 'copilot_chat_history';
const CONVERSATION_TITLE_LENGTH = 48;
const CONVERSATION_PREVIEW_LENGTH = 96;

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

  private readonly inputSanitizer = new InputSanitizer();
  private readonly responseParser = new ResponseParser();

  /** Live message list for the active conversation. */
  readonly messages$ = new BehaviorSubject<ChatMessage[]>([]);
  /** Saved conversations for the Recent Chats tab. */
  readonly conversations$ = new BehaviorSubject<Conversation[]>([]);

  private seq = 0;
  private conversationId = this.generateId('conv');
  private activeStream: Subscription | null = null;
  private activeStreamDone: (() => void) | null = null;

  /** Send a user message and stream the assistant reply. */
  async sendMessage(content: string): Promise<void> {
    const result = this.inputSanitizer.sanitize(content);
    this.appendMessage({
      id: this.generateId('msg'),
      role: 'user',
      content: result.blocked ? (content ?? '').trim() : result.text!,
      timestamp: this.now()
    });

    if (result.blocked) {
      this.appendMessage(this.blockedReply(result.reason!));
      return;
    }

    return this.streamAssistantReply(result.text!);
  }

  /** Cancel an in-flight streaming response. */
  stopStreaming(): void {
    this.activeStream?.unsubscribe();
    this.activeStream = null;
    const messages = this.messages$.value;
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant' && last.isStreaming) {
      this.replaceMessage(last.id, { isStreaming: false });
      this.persistConversation();
    }
    this.activeStreamDone?.();
    this.activeStreamDone = null;
  }

  /** Start a fresh conversation. */
  clearChat(): void {
    this.stopStreaming();
    this.conversationId = this.generateId('conv');
    this.messages$.next([]);
  }

  /** Load persisted conversations for the current user. */
  async loadHistory(): Promise<void> {
    const userId = this.authenticationService.getCredentials()?.userId;
    if (!userId) {
      this.conversations$.next(this.readFromLocalStorage());
      return;
    }

    const remote = await new Promise<Conversation[] | null>((resolve) => {
      this.http
        .get<Conversation[]>(`${this.config.mcpBaseUrl}/api/chat/history/${userId}`)
        .pipe(catchError(() => of(null)))
        .subscribe((response) => resolve(response));
    });

    const conversations = remote ?? this.readFromLocalStorage();
    this.conversations$.next(conversations);
    this.writeToLocalStorage(conversations);
  }

  /** Stream the assistant reply for an already-sanitized message. */
  private streamAssistantReply(sanitizedText: string): Promise<void> {
    const context = this.aiContextService.getContextSnapshot();
    const assistantId = this.generateId('msg');
    let raw = '';

    this.appendMessage({
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: this.now(),
      isStreaming: true
    });

    return new Promise<void>((resolve) => {
      const done = () => {
        this.activeStreamDone = null;
        resolve();
      };
      this.activeStreamDone = done;

      this.activeStream = this.mcpClientService.sendMessage(sanitizedText, context).subscribe({
        next: (event) => {
          if (event.type === 'token') {
            raw += event.token ?? '';
            this.replaceMessage(assistantId, { content: raw });
          } else if (event.type === 'error') {
            raw = event.message || 'Something went wrong. Please try again.';
            this.replaceMessage(assistantId, { content: raw });
          } else if (event.type === 'tool_call') {
            this.mcpClientService.handleToolCall(event);
          }
        },
        error: () => {
          this.finishAssistantReply(assistantId, raw);
          done();
        },
        complete: () => {
          this.finishAssistantReply(assistantId, raw);
          done();
        }
      });
    });
  }

  private finishAssistantReply(assistantId: string, raw: string): void {
    this.activeStream = null;
    const parsed = this.responseParser.parse(raw);
    this.replaceMessage(assistantId, {
      content: parsed.text,
      actionCards: parsed.actionCards,
      suggestedPrompts: parsed.suggestedPrompts,
      isStreaming: false
    });
    this.persistConversation();
  }

  private blockedReply(reason: 'invalid_length' | 'injection_detected'): ChatMessage {
    const content =
      reason === 'injection_detected'
        ? "I can't process that request. Please rephrase your question."
        : 'Please enter a message between 1 and 500 characters.';
    return { id: this.generateId('msg'), role: 'assistant', content, timestamp: this.now() };
  }

  private appendMessage(message: ChatMessage): void {
    this.messages$.next([
      ...this.messages$.value,
      message
    ]);
  }

  private replaceMessage(id: string, patch: Partial<ChatMessage>): void {
    this.messages$.next(
      this.messages$.value.map((message) => (message.id === id ? { ...message, ...patch } : message))
    );
  }

  /** Upsert the active conversation into the saved list and persist it. */
  private persistConversation(): void {
    const messages = this.messages$.value;
    const firstUserMessage = messages.find((message) => message.role === 'user');
    const lastMessage = messages[messages.length - 1];
    if (!firstUserMessage || !lastMessage) {
      return;
    }

    const conversation: Conversation = {
      id: this.conversationId,
      title: this.truncate(firstUserMessage.content, CONVERSATION_TITLE_LENGTH),
      preview: this.truncate(lastMessage.content, CONVERSATION_PREVIEW_LENGTH),
      timestamp: this.now(),
      messageCount: messages.length,
      messages
    };

    const conversations = [
      conversation,
      ...this.conversations$.value.filter((existing) => existing.id !== conversation.id)
    ];
    this.conversations$.next(conversations);
    this.writeToLocalStorage(conversations);
  }

  private readFromLocalStorage(): Conversation[] {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeToLocalStorage(conversations: Conversation[]): void {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(conversations));
    } catch {
      // Storage unavailable/full: history simply is not cached locally.
    }
  }

  private truncate(text: string, max: number): string {
    const trimmed = (text ?? '').trim();
    return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
  }

  /** Monotonically increasing id, unique within this service instance. */
  private generateId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  private now(): number {
    return Date.now();
  }
}
