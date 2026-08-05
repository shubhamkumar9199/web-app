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
import { ChatMessage, ChatRole, Conversation } from '../core/models/chat-message.model';
import { ActionCard } from '../core/models/action-card.model';
import { McpStreamEvent } from '../core/models/mcp-response.model';

/** Core logic */
import { InputSanitizer, SanitizeResult } from '../core/input-sanitizer';
import { ResponseParser } from '../core/response-parser';

/** Services */
import { AiContextService } from './ai-context.service';
import { McpClientService } from './mcp-client.service';
import { AuthenticationService } from '../../core/authentication/authentication.service';

const HISTORY_STORAGE_PREFIX = 'copilot_chat_history_';
const TITLE_MAX_LENGTH = 60;
const PREVIEW_MAX_LENGTH = 120;

const BLOCKED_INPUT_TEXT: Record<string, string> = {
  invalid_length: 'Message must be between 1 and 500 characters.',
  injection_detected: 'This message could not be sent for security reasons.'
};
const STREAM_ERROR_TEXT = 'Something went wrong while getting a response. Please try again.';

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
  private readonly authenticationService = inject(AuthenticationService);

  private readonly sanitizer = new InputSanitizer();
  private readonly responseParser = new ResponseParser();

  /** Live message list for the active conversation. */
  readonly messages$ = new BehaviorSubject<ChatMessage[]>([]);
  /** Saved conversations for the Recent Chats tab. */
  readonly conversations$ = new BehaviorSubject<Conversation[]>([]);

  private sessionId = this.newSessionId();
  private activeStream: Subscription | null = null;
  private activeFinish: ((failed: boolean) => void) | null = null;
  private sequence = 0;

  /** Send a user message and stream the assistant reply. */
  async sendMessage(content: string): Promise<void> {
    const result = this.sanitizer.sanitize(content);
    if (result.blocked) {
      this.appendMessage(this.buildMessage('system', this.blockedText(result)));
      return;
    }

    this.appendMessage(this.buildMessage('user', result.text as string));
    const assistantMessage = this.buildMessage('assistant', '', { isStreaming: true });
    this.appendMessage(assistantMessage);

    await this.streamAssistantReply(assistantMessage.id, result.text as string);
    this.persistActiveConversation();
  }

  /** Cancel an in-flight streaming response. */
  stopStreaming(): void {
    this.activeStream?.unsubscribe();
    this.activeStream = null;
    this.activeFinish?.(false);
  }

  /** Start a fresh conversation. */
  clearChat(): void {
    this.stopStreaming();
    this.messages$.next([]);
    this.sequence = 0;
    this.sessionId = this.newSessionId();
  }

  /** Load persisted conversations for the current user. */
  async loadHistory(): Promise<void> {
    const userId = this.currentUserId();
    const local = this.readLocalHistory(userId);

    try {
      const remote = await firstValueFrom(this.http.get<Conversation[]>(`/api/chat/history/${userId}`));
      const conversations = remote ?? [];
      this.conversations$.next(conversations);
      this.writeLocalHistory(userId, conversations);
    } catch {
      this.conversations$.next(local);
    }
  }

  /** Open the MCP stream for one turn and apply each event to the assistant message. */
  private streamAssistantReply(messageId: string, content: string): Promise<void> {
    const context = this.aiContextService.getContextSnapshot();
    let rawText = '';
    let settled = false;

    return new Promise<void>((resolve) => {
      const finish = (failed: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        this.finalizeAssistantMessage(messageId, rawText, failed);
        this.activeStream = null;
        this.activeFinish = null;
        resolve();
      };
      this.activeFinish = finish;

      this.activeStream = this.mcpClientService.sendMessage(content, context).subscribe({
        next: (event: McpStreamEvent) => {
          rawText = this.applyStreamEvent(messageId, event, rawText);
          if (event.type === 'done') {
            finish(false);
          }
        },
        error: () => finish(true),
        complete: () => finish(false)
      });
    });
  }

  /** Apply one stream event to the in-progress assistant message; returns the updated raw text. */
  private applyStreamEvent(messageId: string, event: McpStreamEvent, rawText: string): string {
    switch (event.type) {
      case 'token': {
        const nextRawText = rawText + (event.token ?? '');
        this.updateMessage(messageId, { content: this.responseParser.parse(nextRawText).text });
        return nextRawText;
      }
      case 'tool_call':
        this.updateMessage(messageId, { toolUsed: event.toolName });
        return rawText;
      case 'action_card':
        if (event.card) {
          this.appendActionCard(messageId, event.card);
        }
        return rawText;
      case 'error':
        this.updateMessage(messageId, { content: event.message ?? STREAM_ERROR_TEXT });
        return rawText;
      default:
        return rawText;
    }
  }

  /** Mark streaming done and attach suggestions parsed out of the finished text. */
  private finalizeAssistantMessage(messageId: string, rawText: string, failed: boolean): void {
    const parsed = this.responseParser.parse(rawText);
    const existing = this.messages$.value.find((m) => m.id === messageId);
    const content = parsed.text || existing?.content || (failed ? STREAM_ERROR_TEXT : '');
    this.updateMessage(messageId, {
      content,
      suggestedPrompts: parsed.suggestedPrompts.length ? parsed.suggestedPrompts : undefined,
      isStreaming: false
    });
  }

  private appendActionCard(messageId: string, card: ActionCard): void {
    const message = this.messages$.value.find((m) => m.id === messageId);
    const actionCards = [
      ...(message?.actionCards ?? []),
      card
    ];
    this.updateMessage(messageId, { actionCards });
  }

  /** Snapshot the active conversation into the Recent Chats list and persist it. */
  private persistActiveConversation(): void {
    const messages = this.messages$.value;
    if (!messages.length) {
      return;
    }

    const firstUser = messages.find((m) => m.role === 'user');
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    const conversation: Conversation = {
      id: this.sessionId,
      title: this.truncate(firstUser?.content ?? 'New conversation', TITLE_MAX_LENGTH),
      preview: this.truncate(lastAssistant?.content ?? '', PREVIEW_MAX_LENGTH),
      timestamp: Date.now(),
      messageCount: messages.length,
      messages
    };

    const userId = this.currentUserId();
    const conversations = [
      conversation,
      ...this.conversations$.value.filter((c) => c.id !== conversation.id)
    ];
    this.conversations$.next(conversations);
    this.writeLocalHistory(userId, conversations);
    this.http.post(`/api/chat/history/${userId}`, conversation).subscribe({ error: () => undefined });
  }

  private appendMessage(message: ChatMessage): void {
    this.messages$.next([
      ...this.messages$.value,
      message
    ]);
  }

  private updateMessage(id: string, patch: Partial<ChatMessage>): void {
    this.messages$.next(this.messages$.value.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  private buildMessage(role: ChatRole, content: string, patch: Partial<ChatMessage> = {}): ChatMessage {
    this.sequence += 1;
    return {
      id: `${this.sessionId}-${this.sequence}`,
      role,
      content,
      timestamp: Date.now(),
      ...patch
    };
  }

  private blockedText(result: SanitizeResult): string {
    return BLOCKED_INPUT_TEXT[result.reason ?? 'invalid_length'];
  }

  private currentUserId(): string {
    const credentials = this.authenticationService.getCredentials();
    return credentials?.userId != null ? String(credentials.userId) : 'anonymous';
  }

  private readLocalHistory(userId: string): Conversation[] {
    try {
      const raw = localStorage.getItem(`${HISTORY_STORAGE_PREFIX}${userId}`);
      return raw ? (JSON.parse(raw) as Conversation[]) : [];
    } catch {
      return [];
    }
  }

  private writeLocalHistory(userId: string, conversations: Conversation[]): void {
    try {
      localStorage.setItem(`${HISTORY_STORAGE_PREFIX}${userId}`, JSON.stringify(conversations));
    } catch {
      // Storage unavailable or full: history simply is not persisted locally this turn.
    }
  }

  private truncate(text: string, max: number): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
  }

  private newSessionId(): string {
    return `session-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  }
}
