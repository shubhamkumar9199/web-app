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
import { CopilotContext } from '../core/models/copilot-context.model';

/** Core */
import { InputSanitizer, SanitizeResult } from '../core/input-sanitizer';
import { ResponseParser } from '../core/response-parser';

/** Services */
import { McpClientService } from './mcp-client.service';
import { AiContextService } from './ai-context.service';
import { COPILOT_CONFIG, CopilotConfig } from '../copilot.config';

/** Key under which conversations are mirrored so history survives a lost connection. */
const HISTORY_STORAGE_KEY = 'copilot_chat_conversations';

/**
 * Orchestrates a conversation: sends user input through sanitize -> MCP ->
 * parse, maintains the streaming message list, and persists history to the
 * MCP server (PostgreSQL) with a localStorage fallback.
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly mcpClientService = inject(McpClientService);
  private readonly aiContextService = inject(AiContextService);
  private readonly httpClient = inject(HttpClient);
  private readonly config = inject<CopilotConfig>(COPILOT_CONFIG);

  private readonly sanitizer = new InputSanitizer();
  private readonly parser = new ResponseParser();

  /** Live message list for the active conversation. */
  readonly messages$ = new BehaviorSubject<ChatMessage[]>([]);
  /** Saved conversations for the Recent Chats tab. */
  readonly conversations$ = new BehaviorSubject<Conversation[]>([]);

  private streamSubscription: Subscription | null = null;
  private streamResolve: (() => void) | null = null;
  private sessionId = this.newSessionId();
  private messageSeq = 0;
  private sessionSeq = 0;

  /** Send a user message and stream the assistant reply. */
  async sendMessage(content: string): Promise<void> {
    if (this.streamSubscription) {
      return;
    }

    const result = this.sanitizer.sanitize(content ?? '');
    if (result.blocked) {
      this.appendMessage(this.buildBlockedMessage(result.reason));
      return;
    }

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

    await this.streamAssistantReply(assistantId, result.text as string, context);
  }

  /** Cancel an in-flight streaming response. */
  stopStreaming(): void {
    if (!this.streamSubscription) {
      return;
    }
    this.streamSubscription.unsubscribe();

    const messages = this.messages$.value;
    const last = messages[messages.length - 1];
    if (last?.isStreaming) {
      this.updateMessage(last.id, { isStreaming: false });
    }
    this.settleStream();
  }

  /** Start a fresh conversation. */
  clearChat(): void {
    this.stopStreaming();
    this.sessionId = this.newSessionId();
    this.messages$.next([]);
  }

  /** Load persisted conversations for the current user. */
  async loadHistory(): Promise<void> {
    const userId = this.aiContextService.getContextSnapshot().loggedInUser;
    try {
      const conversations = await firstValueFrom(
        this.httpClient.get<Conversation[]>(`${this.config.mcpBaseUrl}/api/chat/history/${encodeURIComponent(userId)}`)
      );
      const list = conversations ?? [];
      this.conversations$.next(list);
      this.writeLocalConversations(list);
    } catch {
      this.conversations$.next(this.readLocalConversations());
    }
  }

  /** Subscribe to the MCP stream and fold events into the assistant message. */
  private streamAssistantReply(assistantId: string, message: string, context: CopilotContext): Promise<void> {
    return new Promise<void>((resolve) => {
      this.streamResolve = resolve;
      let rawText = '';
      let toolUsed: string | undefined;
      const streamedCards: ActionCard[] = [];

      this.streamSubscription = this.mcpClientService.sendMessage(message, context).subscribe({
        next: (event) => {
          switch (event.type) {
            case 'token':
              rawText += event.token ?? '';
              this.updateMessage(assistantId, { content: rawText });
              break;
            case 'tool_call':
              toolUsed = event.toolName;
              this.mcpClientService.handleToolCall(event);
              break;
            case 'action_card':
              if (event.card) {
                streamedCards.push(event.card);
              }
              break;
            case 'error':
              rawText = event.message || rawText;
              break;
            default:
              break;
          }
        },
        error: () => {
          const text = rawText ? `${rawText}\n\n_Connection lost. Please try again._` : this.connectionErrorText();
          this.finishAssistantMessage(assistantId, text, streamedCards, toolUsed);
        },
        complete: () => {
          this.finishAssistantMessage(assistantId, rawText, streamedCards, toolUsed);
        }
      });
    });
  }

  /** Parse the assembled text into prose + cards, mark streaming done, persist. */
  private finishAssistantMessage(
    id: string,
    rawText: string,
    streamedCards: ActionCard[],
    toolUsed: string | undefined
  ): void {
    const parsed = this.parser.parse(rawText);
    this.updateMessage(id, {
      content: parsed.text || this.connectionErrorText(),
      actionCards: [
        ...streamedCards,
        ...parsed.actionCards
      ],
      suggestedPrompts: parsed.suggestedPrompts,
      toolUsed,
      isStreaming: false
    });
    this.settleStream();
    this.persistConversation();
  }

  /** Clear the active subscription and resolve whichever sendMessage() call is waiting on it. */
  private settleStream(): void {
    this.streamSubscription = null;
    const resolve = this.streamResolve;
    this.streamResolve = null;
    resolve?.();
  }

  private connectionErrorText(): string {
    return 'Sorry, something went wrong. Please try again.';
  }

  private buildBlockedMessage(reason: SanitizeResult['reason']): ChatMessage {
    const content =
      reason === 'invalid_length'
        ? `Please enter a message up to ${this.config.maxInputLength} characters.`
        : 'That message could not be sent. Please rephrase your request.';
    return { id: this.nextMessageId(), role: 'system', content, timestamp: Date.now() };
  }

  /** Save the active conversation to the server, mirroring to localStorage either way. */
  private persistConversation(): void {
    const messages = this.messages$.value;
    if (messages.length === 0) {
      return;
    }
    const conversation = this.buildConversation(messages);
    const conversations = this.upsertConversation(this.conversations$.value, conversation);
    this.conversations$.next(conversations);
    this.writeLocalConversations(conversations);

    const userId = this.aiContextService.getContextSnapshot().loggedInUser;
    this.httpClient
      .put<void>(`${this.config.mcpBaseUrl}/api/chat/history/${encodeURIComponent(userId)}`, conversation)
      .subscribe({ error: () => undefined });
  }

  private buildConversation(messages: ChatMessage[]): Conversation {
    const firstUser = messages.find((message) => message.role === 'user');
    const last = messages[messages.length - 1];
    return {
      id: this.sessionId,
      title: this.truncate(firstUser?.content ?? 'New conversation', 60),
      preview: this.truncate(last?.content ?? '', 120),
      timestamp: last?.timestamp ?? Date.now(),
      messageCount: messages.length,
      messages
    };
  }

  private upsertConversation(list: Conversation[], conversation: Conversation): Conversation[] {
    return [
      conversation,
      ...list.filter((existing) => existing.id !== conversation.id)
    ];
  }

  private truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  private readLocalConversations(): Conversation[] {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Conversation[]) : [];
    } catch {
      return [];
    }
  }

  private writeLocalConversations(conversations: Conversation[]): void {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(conversations));
    } catch {
      // Storage unavailable or full; in-memory state still holds for this session.
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

  private nextMessageId(): string {
    this.messageSeq += 1;
    return `msg-${this.sessionId}-${this.messageSeq}`;
  }

  private newSessionId(): string {
    this.sessionSeq += 1;
    return `session-${this.sessionSeq}-${Date.now()}`;
  }
}
