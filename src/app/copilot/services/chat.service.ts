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

/** Environment */
import { environment } from '../../../environments/environment';

/** Models */
import { ChatMessage, Conversation } from '../core/models/chat-message.model';
import { McpStreamEvent } from '../core/models/mcp-response.model';

/** Core */
import { InputSanitizer } from '../core/input-sanitizer';
import { ResponseParser } from '../core/response-parser';

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

  private readonly inputSanitizer = new InputSanitizer();
  private readonly responseParser = new ResponseParser();

  /** Live message list for the active conversation. */
  readonly messages$ = new BehaviorSubject<ChatMessage[]>([]);
  /** Saved conversations for the Recent Chats tab. */
  readonly conversations$ = new BehaviorSubject<Conversation[]>([]);

  private streamSubscription: Subscription | null = null;
  private seq = 0;

  /** Send a user message and stream the assistant reply. */
  async sendMessage(content: string): Promise<void> {
    const result = this.inputSanitizer.sanitize(content);
    if (result.blocked) {
      this.appendMessage(this.buildMessage('user', this.inputSanitizer.stripDangerous(content)));
      this.appendMessage(this.buildMessage('assistant', this.rejectionText(result.reason)));
      return;
    }

    this.appendMessage(this.buildMessage('user', result.text as string));
    const assistantMessage = this.buildMessage('assistant', '', { isStreaming: true });
    this.appendMessage(assistantMessage);

    this.streamSubscription?.unsubscribe();

    const context = this.aiContextService.getContextSnapshot();
    let buffer = '';
    let toolUsed: string | undefined;

    try {
      const stream$ = this.mcpClientService.sendMessage(result.text as string, context);
      this.streamSubscription = stream$.subscribe({
        next: (event: McpStreamEvent) => {
          if (event.type === 'token' && event.token) {
            buffer += event.token;
            this.updateMessage(assistantMessage.id, { content: buffer });
          } else if (event.type === 'tool_call') {
            toolUsed = event.toolName;
            this.safelyHandleToolCall(event);
          } else if (event.type === 'error') {
            this.finalizeWithError(assistantMessage.id, event.message);
          } else if (event.type === 'done') {
            this.finalizeAssistantMessage(assistantMessage.id, buffer, toolUsed);
          }
        },
        error: (error: unknown) => this.finalizeWithError(assistantMessage.id, this.errorText(error)),
        complete: () => {
          this.streamSubscription = null;
        }
      });
    } catch (error) {
      this.finalizeWithError(assistantMessage.id, this.errorText(error));
    }
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
  }

  /** Start a fresh conversation. */
  clearChat(): void {
    this.streamSubscription?.unsubscribe();
    this.streamSubscription = null;
    this.messages$.next([]);
  }

  /** Load persisted conversations for the current user. */
  async loadHistory(): Promise<void> {
    const userId = this.authenticationService.getCredentials()?.userId;
    if (userId == null) {
      this.conversations$.next(this.readLocalHistory());
      return;
    }

    try {
      const url = `${environment.copilotMcpBaseUrl}/api/chat/history/${userId}`;
      const conversations = await firstValueFrom(this.http.get<Conversation[]>(url));
      this.conversations$.next(conversations ?? []);
    } catch {
      this.conversations$.next(this.readLocalHistory());
    }
  }

  private appendMessage(message: ChatMessage): void {
    this.messages$.next([
      ...this.messages$.value,
      message
    ]);
  }

  private updateMessage(id: string, changes: Partial<ChatMessage>): void {
    this.messages$.next(
      this.messages$.value.map((message) => (message.id === id ? { ...message, ...changes } : message))
    );
  }

  private finalizeAssistantMessage(id: string, rawBuffer: string, toolUsed?: string): void {
    const parsed = this.responseParser.parse(rawBuffer);
    this.updateMessage(id, {
      content: parsed.text,
      actionCards: parsed.actionCards,
      suggestedPrompts: parsed.suggestedPrompts,
      toolUsed,
      isStreaming: false
    });
    this.persistHistory();
    this.streamSubscription = null;
  }

  private finalizeWithError(id: string, message?: string): void {
    this.updateMessage(id, {
      content: message || 'Sorry, something went wrong while contacting the assistant. Please try again.',
      isStreaming: false
    });
    this.streamSubscription?.unsubscribe();
    this.streamSubscription = null;
  }

  /** Tool-call routing is best-effort: a failure here must not break the chat stream. */
  private safelyHandleToolCall(event: McpStreamEvent): void {
    try {
      this.mcpClientService.handleToolCall(event);
    } catch {
      // Confirmation routing is not available yet; the assistant reply still completes.
    }
  }

  private buildMessage(role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
    this.seq += 1;
    return {
      id: `msg-${this.seq}`,
      role,
      content,
      timestamp: Date.now(),
      ...extra
    };
  }

  private persistHistory(): void {
    const conversation: Conversation = {
      id: 'active',
      title: this.messages$.value.find((message) => message.role === 'user')?.content ?? '',
      preview: this.messages$.value[this.messages$.value.length - 1]?.content ?? '',
      timestamp: Date.now(),
      messageCount: this.messages$.value.length,
      messages: this.messages$.value
    };
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify([conversation]));
    } catch {
      // Storage may be unavailable (private browsing, quota); history is best-effort.
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

  private rejectionText(reason?: string): string {
    return reason === 'injection_detected'
      ? "Sorry, I can't process that request."
      : 'Please rephrase your message (it was empty or too long).';
  }

  private errorText(error: unknown): string {
    return error instanceof Error
      ? error.message
      : 'Sorry, something went wrong while contacting the assistant. Please try again.';
  }
}
