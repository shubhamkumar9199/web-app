/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/** Angular Imports */
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Subscription } from 'rxjs';

/** Models */
import { ChatMessage, Conversation } from '../core/models/chat-message.model';
import { ActionCard } from '../core/models/action-card.model';
import { McpStreamEvent } from '../core/models/mcp-response.model';

/** Core logic */
import { InputSanitizer, MAX_INPUT_LENGTH } from '../core/input-sanitizer';
import { ResponseParser } from '../core/response-parser';

/** Services */
import { McpClientService } from './mcp-client.service';
import { AiContextService } from './ai-context.service';

const HISTORY_STORAGE_KEY = 'copilot_conversations';
const MAX_SAVED_CONVERSATIONS = 20;
const GENERIC_STREAM_ERROR = 'Something went wrong while talking to Mifos Intelligence AI. Please try again.';

/**
 * Orchestrates a conversation: sends user input through sanitize -> MCP ->
 * parse, maintains the streaming message list, and persists history to
 * localStorage (server-side persistence is added once the MCP history
 * endpoint contract is finalised, see copilot-routine-reports/BLOCKED-mcp.md).
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly mcpClientService = inject(McpClientService);
  private readonly aiContextService = inject(AiContextService);
  private readonly sanitizer = new InputSanitizer();
  private readonly responseParser = new ResponseParser();

  /** Live message list for the active conversation. */
  readonly messages$ = new BehaviorSubject<ChatMessage[]>([]);
  /** Saved conversations for the Recent Chats tab. */
  readonly conversations$ = new BehaviorSubject<Conversation[]>([]);

  private conversationId = this.newId('conv');
  private activeStream: Subscription | null = null;
  private resolveActiveStream: (() => void) | null = null;
  private rawBuffer = '';
  private streaming = false;
  private seq = 0;

  /** Send a user message and stream the assistant reply. */
  async sendMessage(content: string): Promise<void> {
    const trimmed = (content ?? '').trim();
    if (!trimmed || this.streaming) {
      return;
    }

    this.appendMessage({
      id: this.newId('msg'),
      role: 'user',
      content: trimmed,
      timestamp: Date.now()
    });

    const sanitized = this.sanitizer.sanitize(trimmed);
    if (sanitized.blocked || !sanitized.text) {
      this.appendMessage({
        id: this.newId('msg'),
        role: 'assistant',
        content: this.blockedMessage(sanitized.reason),
        timestamp: Date.now()
      });
      this.persistConversation();
      return;
    }

    const context = this.aiContextService.getContextSnapshot();
    const assistantId = this.newId('msg');
    this.appendMessage({
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
      actionCards: []
    });

    this.rawBuffer = '';
    this.streaming = true;

    return new Promise<void>((resolve) => {
      this.resolveActiveStream = resolve;
      this.activeStream = this.mcpClientService.sendMessage(sanitized.text as string, context).subscribe({
        next: (event) => this.applyStreamEvent(assistantId, event),
        error: () => {
          this.finishMessage(assistantId, GENERIC_STREAM_ERROR);
          this.endStream();
        },
        complete: () => this.endStream()
      });
    });
  }

  /** Cancel an in-flight streaming response. */
  stopStreaming(): void {
    if (!this.activeStream) {
      return;
    }
    this.activeStream.unsubscribe();

    const messages = this.messages$.value;
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant' && last.isStreaming) {
      this.updateMessage(last.id, (msg) => ({ ...msg, isStreaming: false }));
      this.persistConversation();
    }

    this.endStream();
  }

  /** Common teardown after a stream finishes, errors, or is stopped. */
  private endStream(): void {
    this.streaming = false;
    this.activeStream = null;
    this.resolveActiveStream?.();
    this.resolveActiveStream = null;
  }

  /** Start a fresh conversation. */
  clearChat(): void {
    this.stopStreaming();
    this.conversationId = this.newId('conv');
    this.rawBuffer = '';
    this.messages$.next([]);
  }

  /** Load persisted conversations for the current user. */
  async loadHistory(): Promise<void> {
    // TODO: GET /api/chat/history/{userId} once the MCP history endpoint
    // contract is finalised; localStorage is the fallback for now.
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      this.conversations$.next(Array.isArray(parsed) ? parsed : []);
    } catch {
      this.conversations$.next([]);
    }
  }

  /** Route a single stream event to the right handling. */
  private applyStreamEvent(messageId: string, event: McpStreamEvent): void {
    switch (event.type) {
      case 'token':
        this.rawBuffer += event.token ?? '';
        this.updateMessage(messageId, (msg) => ({
          ...msg,
          content: this.responseParser.parse(this.rawBuffer).text
        }));
        break;
      case 'tool_call':
        this.updateMessage(messageId, (msg) => ({ ...msg, toolUsed: event.toolName }));
        break;
      case 'action_card':
        if (event.card) {
          const card = event.card;
          this.updateMessage(messageId, (msg) => ({
            ...msg,
            actionCards: this.mergeCards(msg.actionCards ?? [], [card])
          }));
        }
        break;
      case 'error':
        this.finishMessage(messageId, event.message || GENERIC_STREAM_ERROR);
        break;
      case 'done':
        this.finalizeStreamedMessage(messageId);
        break;
      default:
        break;
    }
  }

  /** On 'done': assemble final text/cards/suggestions from the buffered raw text. */
  private finalizeStreamedMessage(messageId: string): void {
    const parsed = this.responseParser.parse(this.rawBuffer);
    this.updateMessage(messageId, (msg) => ({
      ...msg,
      content: parsed.text,
      actionCards: this.mergeCards(msg.actionCards ?? [], parsed.actionCards),
      suggestedPrompts: parsed.suggestedPrompts,
      isStreaming: false
    }));
    this.persistConversation();
  }

  private finishMessage(messageId: string, content: string): void {
    this.updateMessage(messageId, (msg) => ({ ...msg, content, isStreaming: false }));
    this.persistConversation();
  }

  /** Merge new action cards into an existing list, skipping exact duplicates. */
  private mergeCards(existing: ActionCard[], incoming: ActionCard[]): ActionCard[] {
    const seen = new Set(existing.map((card) => JSON.stringify(card)));
    const merged = [...existing];
    for (const card of incoming) {
      const key = JSON.stringify(card);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(card);
      }
    }
    return merged;
  }

  private appendMessage(message: ChatMessage): void {
    this.messages$.next([
      ...this.messages$.value,
      message
    ]);
  }

  private updateMessage(id: string, updater: (msg: ChatMessage) => ChatMessage): void {
    this.messages$.next(this.messages$.value.map((msg) => (msg.id === id ? updater(msg) : msg)));
  }

  private blockedMessage(reason?: 'invalid_length' | 'injection_detected'): string {
    if (reason === 'injection_detected') {
      return "I can't process that message as written - it looks like it's trying to override my instructions. Please rephrase your question.";
    }
    return `Please enter a message between 1 and ${MAX_INPUT_LENGTH} characters.`;
  }

  /** Save the active conversation (title/preview from its messages) to the Recent Chats list. */
  private persistConversation(): void {
    const messages = this.messages$.value;
    if (!messages.length) {
      return;
    }
    const firstUser = messages.find((msg) => msg.role === 'user');
    const last = messages[messages.length - 1];
    const conversation: Conversation = {
      id: this.conversationId,
      title: this.truncate(firstUser?.content ?? 'New conversation', 60),
      preview: this.truncate(last?.content ?? '', 120),
      timestamp: Date.now(),
      messageCount: messages.length,
      messages
    };

    const updated = [
      conversation,
      ...this.conversations$.value.filter((conv) => conv.id !== conversation.id)
    ].slice(0, MAX_SAVED_CONVERSATIONS);
    this.conversations$.next(updated);

    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Best-effort only: private-browsing / full storage should not break the chat.
    }
  }

  private truncate(text: string, max: number): string {
    const clean = (text ?? '').trim();
    return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
  }

  private newId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }
}
