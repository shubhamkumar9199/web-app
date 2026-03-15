import { Injectable, inject, NgZone } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { switchMap, take } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { AIContextService } from './ai-context.service';
import { ChatMessage, AIContext } from './models/message.model';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

const SYSTEM_PROMPT = `You are a banking assistant embedded inside Mifos X, a core banking platform used by microfinance institutions.

You help loan officers and branch managers with:
- Looking up client information
- Creating, approving, and disbursing loans
- Managing savings accounts and transactions
- Explaining banking workflows

RULES:
1. Always be concise and professional.
2. When you reference banking data, format it as structured JSON action cards using this format:
   <!--ACTION_CARD:{"type":"loan","title":"Loan #107","data":{"status":"Pending","amount":"$5,000","client":"Ramesh Kumar"},"actions":[{"label":"Approve","action":"approve_loan","style":"primary"},{"label":"View","route":"/clients/42/loans-accounts/107","style":"accent"}]}-->
3. For destructive actions (approve, disburse, delete), always include a confirmation card:
   <!--ACTION_CARD:{"type":"confirmation","title":"Confirm Approval","data":{"warning":"This will approve loan #107 for $5,000"},"actions":[{"label":"Confirm","action":"confirm_approve_loan","style":"warn"},{"label":"Cancel","action":"cancel","style":"accent"}]}-->
4. After each response, suggest 3 follow-up actions as:
   <!--SUGGESTED_PROMPTS:["Show repayment schedule","View client details","Check loan status"]-->
5. Use the provided context (current screen, client, user role) to give relevant answers.
6. Never make up data. If you don't have information, say so.`;

@Injectable({ providedIn: 'root' })
export class AIChatService {

  private contextService = inject(AIContextService);
  private ngZone = inject(NgZone);

  private messagesSubject = new BehaviorSubject<ChatMessage[]>([]);
  readonly messages$ = this.messagesSubject.asObservable();

  private streamingSubject = new Subject<boolean>();
  readonly isStreaming$ = this.streamingSubject.asObservable();

  private abortController: AbortController | null = null;

  /** Send a user message and stream the AI response. */
  sendMessage(content: string): void {
    const userMsg = this.createMessage('user', content);
    this.addMessage(userMsg);

    this.contextService.getContext().pipe(take(1)).subscribe(ctx => {
      this.streamResponse(content, ctx);
    });
  }

  /** Stop the current streaming response. */
  stopStreaming(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.streamingSubject.next(false);

    // Mark the last message as no longer streaming
    const msgs = this.messagesSubject.value;
    const last = msgs[msgs.length - 1];
    if (last?.isStreaming) {
      last.isStreaming = false;
      this.messagesSubject.next([...msgs]);
    }
  }

  /** Clear all messages. */
  clearMessages(): void {
    this.messagesSubject.next([]);
  }

  // ── Private ────────────────────────────────────────────────────

  private async streamResponse(userMessage: string, ctx: AIContext): Promise<void> {
    const apiKey = environment.aiAssistant?.groqApiKey;
    if (!apiKey) {
      this.addMessage(this.createMessage('assistant', 'AI Assistant is not configured. Please set the Groq API key.'));
      return;
    }

    // Create placeholder assistant message for streaming
    const assistantMsg = this.createMessage('assistant', '');
    assistantMsg.isStreaming = true;
    this.addMessage(assistantMsg);
    this.streamingSubject.next(true);

    this.abortController = new AbortController();

    try {
      const contextPrompt = this.contextService.buildContextPrompt(ctx);
      const messages = this.buildChatMessages(contextPrompt, userMessage);

      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          stream: true,
          messages,
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
      }

      await this.readSSEStream(response.body!, assistantMsg);

    } catch (err: any) {
      if (err.name === 'AbortError') return; // User cancelled
      assistantMsg.content = `Sorry, something went wrong: ${err.message}`;
      assistantMsg.isStreaming = false;
      this.emitMessages();
    } finally {
      this.streamingSubject.next(false);
      this.abortController = null;
    }
  }

  /**
   * Read the SSE stream from Groq and append tokens word-by-word.
   */
  private async readSSEStream(body: ReadableStream<Uint8Array>, msg: ChatMessage): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last (possibly incomplete) line in the buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue; // skip empty/comment lines
          if (!trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6); // remove "data: "
          if (data === '[DONE]') {
            msg.isStreaming = false;
            this.parseSpecialTokens(msg);
            this.emitMessages();
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const token = parsed.choices?.[0]?.delta?.content;
            if (token) {
              msg.content += token;
              // Update UI inside Angular zone
              this.ngZone.run(() => this.emitMessages());
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
      msg.isStreaming = false;
      this.parseSpecialTokens(msg);
      this.emitMessages();
    }
  }

  /**
   * Parse ACTION_CARD and SUGGESTED_PROMPTS from the completed message.
   */
  private parseSpecialTokens(msg: ChatMessage): void {
    // Extract action cards
    const cardRegex = /<!--ACTION_CARD:(.*?)-->/g;
    let match: RegExpExecArray | null;
    const cards: any[] = [];
    while ((match = cardRegex.exec(msg.content)) !== null) {
      try {
        cards.push(JSON.parse(match[1]));
      } catch { /* skip malformed */ }
    }
    if (cards.length > 0) {
      msg.actionCards = cards;
      msg.content = msg.content.replace(cardRegex, '').trim();
    }

    // Extract suggested prompts
    const promptRegex = /<!--SUGGESTED_PROMPTS:(.*?)-->/g;
    const promptMatch = promptRegex.exec(msg.content);
    if (promptMatch) {
      try {
        msg.suggestedPrompts = JSON.parse(promptMatch[1]);
      } catch { /* skip */ }
      msg.content = msg.content.replace(promptRegex, '').trim();
    }
  }

  /**
   * Build the messages array for the Groq API call.
   * Includes system prompt + context + conversation history + current message.
   */
  private buildChatMessages(contextPrompt: string, userMessage: string): Array<{ role: string; content: string }> {
    const systemContent = `${SYSTEM_PROMPT}\n\n--- CURRENT CONTEXT ---\n${contextPrompt}`;

    // Include recent conversation history (last 10 messages) for continuity
    const history = this.messagesSubject.value
      .filter(m => !m.isStreaming && m.content)
      .slice(-10)
      .map(m => ({ role: m.role, content: m.content }));

    // Remove the last user message from history since we add it explicitly
    if (history.length > 0 && history[history.length - 1].role === 'user') {
      history.pop();
    }

    return [
      { role: 'system', content: systemContent },
      ...history,
      { role: 'user', content: userMessage },
    ];
  }

  private createMessage(role: 'user' | 'assistant', content: string): ChatMessage {
    return {
      id: crypto.randomUUID(),
      role,
      content,
      timestamp: new Date(),
    };
  }

  private addMessage(msg: ChatMessage): void {
    const msgs = [...this.messagesSubject.value, msg];
    this.messagesSubject.next(msgs);
  }

  private emitMessages(): void {
    this.messagesSubject.next([...this.messagesSubject.value]);
  }
}
