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
import { CopilotContext } from '../core/models/copilot-context.model';

/** Core */
import { InputSanitizer, SanitizeResult } from '../core/input-sanitizer';
import { ResponseParser } from '../core/response-parser';

/** Services */
import { McpClientService } from './mcp-client.service';
import { AiContextService } from './ai-context.service';

/** Config */
import { COPILOT_CONFIG } from '../copilot.config';

const HISTORY_STORAGE_KEY = 'copilot_chat_history';

/**
 * Orchestrates a conversation: sends user input through sanitize -> MCP ->
 * parse, maintains the streaming message list, and persists history to the
 * MCP server (PostgreSQL) with a localStorage fallback.
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);
  private readonly mcpClient = inject(McpClientService);
  private readonly aiContext = inject(AiContextService);
  private readonly config = inject(COPILOT_CONFIG);

  private readonly sanitizer = new InputSanitizer();
  private readonly parser = new ResponseParser();

  /** Live message list for the active conversation. */
  readonly messages$ = new BehaviorSubject<ChatMessage[]>([]);
  /** Saved conversations for the Recent Chats tab. */
  readonly conversations$ = new BehaviorSubject<Conversation[]>([]);

  private streamSubscription: Subscription | null = null;
  private currentConversationId = this.newConversationId();
  private seq = 0;

  /** Send a user message and stream the assistant reply. */
  async sendMessage(content: string): Promise<void> {
    const sanitized = this.sanitizer.sanitize(content);
    this.appendMessage({
      id: this.nextId(),
      role: 'user',
      content: (content ?? '').trim(),
      timestamp: Date.now()
    });

    if (sanitized.blocked || !sanitized.text) {
      this.appendMessage(this.rejectionMessage(sanitized.reason));
      return;
    }
    const messageText = sanitized.text;

    this.stopStreaming();

    const context = this.aiContext.getContextSnapshot();
    const assistantId = this.nextId();
    this.appendMessage({
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true
    });

    await this.streamAssistantReply(assistantId, messageText, context);
    this.persistConversation();
  }

  /** Cancel an in-flight streaming response. */
  stopStreaming(): void {
    this.streamSubscription?.unsubscribe();
    this.streamSubscription = null;
    const streaming = this.messages$.value.find((message) => message.isStreaming);
    if (streaming) {
      this.patchMessage(streaming.id, { isStreaming: false });
    }
  }

  /** Start a fresh conversation. */
  clearChat(): void {
    this.stopStreaming();
    this.messages$.next([]);
    this.currentConversationId = this.newConversationId();
  }

  /** Load persisted conversations for the current user. */
  async loadHistory(): Promise<void> {
    const userId = this.aiContext.getContextSnapshot().loggedInUser;
    try {
      const conversations = await firstValueFrom(
        this.http.get<Conversation[]>(`${this.config.mcpBaseUrl}/api/chat/history/${encodeURIComponent(userId)}`)
      );
      const list = conversations ?? [];
      this.conversations$.next(list);
      this.saveToLocalStorage(list);
    } catch {
      this.conversations$.next(this.readFromLocalStorage());
    }
  }

  /** Subscribe to the MCP stream and drive the assistant message to completion. */
  private streamAssistantReply(assistantId: string, messageText: string, context: CopilotContext): Promise<void> {
    let raw = '';
    let toolUsed: string | undefined;

    return new Promise<void>((resolve) => {
      let settled = false;
      const settle = (errorMessage?: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        this.finalizeAssistantMessage(assistantId, raw, toolUsed, errorMessage);
        resolve();
      };

      this.streamSubscription = this.mcpClient.sendMessage(messageText, context).subscribe({
        next: (event: McpStreamEvent) => {
          switch (event.type) {
            case 'token':
              raw += event.token ?? '';
              this.patchMessage(assistantId, { content: raw });
              break;
            case 'tool_call':
              toolUsed = event.toolName;
              this.patchMessage(assistantId, { toolUsed });
              break;
            case 'action_card':
              if (event.card) {
                raw += `\n\`\`\`action_card\n${JSON.stringify(event.card)}\n\`\`\`\n`;
              }
              break;
            case 'error':
              settle(event.message || 'The assistant ran into a problem. Please try again.');
              break;
            case 'done':
              settle();
              break;
            default:
              break;
          }
        },
        error: () => settle('The assistant is unavailable right now. Please try again shortly.'),
        complete: () => settle()
      });
    });
  }

  /** Parse the assembled raw text into prose + cards + suggestions and mark done. */
  private finalizeAssistantMessage(id: string, raw: string, toolUsed: string | undefined, errorMessage?: string): void {
    const parsed = this.parser.parse(raw);
    const content = errorMessage ? `${parsed.text ? `${parsed.text}\n\n` : ''}${errorMessage}` : parsed.text;
    this.patchMessage(id, {
      content,
      actionCards: parsed.actionCards,
      suggestedPrompts: parsed.suggestedPrompts,
      toolUsed,
      isStreaming: false
    });
  }

  /** Save the current message list as the active entry in the Recent Chats tab. */
  private persistConversation(): void {
    const messages = this.messages$.value;
    if (!messages.length) {
      return;
    }
    const conversation: Conversation = {
      id: this.currentConversationId,
      title: this.deriveTitle(messages),
      preview: this.derivePreview(messages),
      timestamp: Date.now(),
      messageCount: messages.length,
      messages
    };
    const list = [
      conversation,
      ...this.conversations$.value.filter((c) => c.id !== conversation.id)
    ];
    this.conversations$.next(list);
    this.saveToLocalStorage(list);
  }

  private deriveTitle(messages: ChatMessage[]): string {
    const firstUser = messages.find((message) => message.role === 'user');
    return this.truncate(firstUser?.content || 'New conversation', 60);
  }

  private derivePreview(messages: ChatMessage[]): string {
    return this.truncate(messages[messages.length - 1]?.content ?? '', 120);
  }

  private truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 3)}...` : text;
  }

  private rejectionMessage(reason: SanitizeResult['reason']): ChatMessage {
    const content =
      reason === 'injection_detected'
        ? "I can't process that request. Please ask about a client, loan, or savings account instead."
        : 'Your message is empty or too long. Please shorten it and try again.';
    return {
      id: this.nextId(),
      role: 'system',
      content,
      timestamp: Date.now()
    };
  }

  private appendMessage(message: ChatMessage): void {
    this.messages$.next([
      ...this.messages$.value,
      message
    ]);
  }

  private patchMessage(id: string, patch: Partial<ChatMessage>): void {
    this.messages$.next(
      this.messages$.value.map((message) => (message.id === id ? { ...message, ...patch } : message))
    );
  }

  private saveToLocalStorage(conversations: Conversation[]): void {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(conversations));
    } catch {
      // Storage unavailable (private browsing, quota exceeded) - degrade silently.
    }
  }

  private readFromLocalStorage(): Conversation[] {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as Conversation[]) : [];
    } catch {
      return [];
    }
  }

  private nextId(): string {
    this.seq += 1;
    return `msg-${Date.now()}-${this.seq}`;
  }

  private newConversationId(): string {
    return `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
