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

/** Environment */
import { environment } from '../../../environments/environment';

/** Models */
import { ChatMessage, Conversation } from '../core/models/chat-message.model';
import { McpStreamEvent } from '../core/models/mcp-response.model';
import { ActionCard } from '../core/models/action-card.model';

/** Core */
import { InputSanitizer } from '../core/input-sanitizer';
import { ResponseParser } from '../core/response-parser';

/** Services */
import { McpClientService } from './mcp-client.service';
import { AiContextService } from './ai-context.service';
import { AuthenticationService } from '../../core/authentication/authentication.service';

const HISTORY_STORAGE_KEY = 'copilot_conversations';
const MAX_STORED_CONVERSATIONS = 20;

/** Client-side id, unique enough for message/session tracking (not a security token). */
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
  private readonly http = inject(HttpClient);

  private readonly sanitizer = new InputSanitizer();
  private readonly parser = new ResponseParser();

  /** Live message list for the active conversation. */
  readonly messages$ = new BehaviorSubject<ChatMessage[]>([]);
  /** Saved conversations for the Recent Chats tab. */
  readonly conversations$ = new BehaviorSubject<Conversation[]>([]);

  private sessionId = generateId();
  private streamSubscription: Subscription | null = null;
  private resolveActiveSend: (() => void) | null = null;

  /** Send a user message and stream the assistant reply. */
  async sendMessage(content: string): Promise<void> {
    const sanitized = this.sanitizer.sanitize(content);
    if (sanitized.blocked || !sanitized.text) {
      this.appendMessage(this.buildBlockedMessage(sanitized.reason));
      return;
    }

    this.appendMessage({
      id: generateId(),
      role: 'user',
      content: sanitized.text,
      timestamp: Date.now()
    });

    const assistantId = generateId();
    this.appendMessage({
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true
    });

    const context = this.aiContextService.getContextSnapshot();
    let raw = '';
    const streamedCards: ActionCard[] = [];

    const applyParsedText = (): void => {
      const parsed = this.parser.parse(raw);
      this.updateMessage(assistantId, (msg) => ({
        ...msg,
        content: parsed.text,
        actionCards: [
          ...streamedCards,
          ...parsed.actionCards
        ],
        suggestedPrompts: parsed.suggestedPrompts
      }));
    };

    return new Promise<void>((resolve) => {
      this.resolveActiveSend = resolve;
      const finish = (): void => {
        this.updateMessage(assistantId, (msg) => ({ ...msg, isStreaming: false }));
        this.streamSubscription = null;
        this.resolveActiveSend = null;
        this.persistActiveConversation();
        resolve();
      };
      this.streamSubscription = this.mcpClientService.sendMessage(sanitized.text!, context).subscribe({
        next: (event: McpStreamEvent) => {
          if (event.type === 'token' && event.token) {
            raw += event.token;
            applyParsedText();
          } else if (event.type === 'tool_call') {
            this.updateMessage(assistantId, (msg) => ({ ...msg, toolUsed: event.toolName }));
            this.mcpClientService.handleToolCall(event);
          } else if (event.type === 'action_card' && event.card) {
            streamedCards.push(event.card);
            applyParsedText();
          } else if (event.type === 'error') {
            this.updateMessage(assistantId, (msg) => ({
              ...msg,
              content: msg.content || event.message || '',
              isStreaming: false
            }));
          }
        },
        error: finish,
        complete: finish
      });
    });
  }

  /** Cancel an in-flight streaming response. */
  stopStreaming(): void {
    this.streamSubscription?.unsubscribe();
    this.streamSubscription = null;
    const messages = this.messages$.value;
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant' && last.isStreaming) {
      this.updateMessage(last.id, (msg) => ({ ...msg, isStreaming: false }));
      this.persistActiveConversation();
    }
    this.resolveActiveSend?.();
    this.resolveActiveSend = null;
  }

  /** Start a fresh conversation. */
  clearChat(): void {
    this.stopStreaming();
    this.sessionId = generateId();
    this.messages$.next([]);
  }

  /** Load persisted conversations for the current user. */
  async loadHistory(): Promise<void> {
    const userId = this.authenticationService.getCredentials()?.userId;
    if (userId === undefined || userId === null) {
      this.conversations$.next(this.readStoredConversations());
      return;
    }

    const conversations = await new Promise<Conversation[]>((resolve) => {
      this.http
        .get<Conversation[]>(`${environment.copilotMcpBaseUrl}/api/chat/history/${userId}`)
        .pipe(catchError(() => of(this.readStoredConversations())))
        .subscribe((result) => resolve(result ?? []));
    });
    this.conversations$.next(conversations);
  }

  private appendMessage(message: ChatMessage): void {
    this.messages$.next([
      ...this.messages$.value,
      message
    ]);
  }

  private updateMessage(id: string, update: (msg: ChatMessage) => ChatMessage): void {
    this.messages$.next(this.messages$.value.map((msg) => (msg.id === id ? update(msg) : msg)));
  }

  private buildBlockedMessage(reason: 'invalid_length' | 'injection_detected' | undefined): ChatMessage {
    const content =
      reason === 'injection_detected' ? 'copilot.errors.injectionDetected' : 'copilot.errors.invalidLength';
    return { id: generateId(), role: 'system', content, timestamp: Date.now() };
  }

  /** Snapshot the current message list into Recent Chats and localStorage. */
  private persistActiveConversation(): void {
    const messages = this.messages$.value;
    const firstUserMessage = messages.find((msg) => msg.role === 'user');
    if (!firstUserMessage) {
      return;
    }
    const lastMessage = messages[messages.length - 1];
    const conversation: Conversation = {
      id: this.sessionId,
      title: firstUserMessage.content.slice(0, 60),
      preview: lastMessage.content.slice(0, 120),
      timestamp: lastMessage.timestamp,
      messageCount: messages.length,
      messages
    };

    const stored = this.readStoredConversations().filter((conv) => conv.id !== conversation.id);
    const updated = [
      conversation,
      ...stored
    ].slice(0, MAX_STORED_CONVERSATIONS);
    this.writeStoredConversations(updated);
    this.conversations$.next(updated);
  }

  private readStoredConversations(): Conversation[] {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeStoredConversations(conversations: Conversation[]): void {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(conversations));
    } catch {
      // Storage unavailable or quota exceeded: history simply won't persist locally.
    }
  }
}
