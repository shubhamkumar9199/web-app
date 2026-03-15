import { Component, inject, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { environment } from '../../environments/environment';
import { AIChatService } from './ai-chat.service';
import { AIContextService } from './ai-context.service';
import { ChatMessage, ActionCard, AIContext } from './models/message.model';

@Component({
  selector: 'mifosx-ai-chat',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatTooltipModule,
    MatChipsModule,
    MatCardModule,
    MatDividerModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './ai-chat.component.html',
  styleUrls: ['./ai-chat.component.scss'],
})
export class AIChatComponent implements OnInit, OnDestroy {

  @ViewChild('messageContainer') messageContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('messageInput') messageInput!: ElementRef<HTMLInputElement>;

  private chatService = inject(AIChatService);
  private contextService = inject(AIContextService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private destroy$ = new Subject<void>();

  isOpen = false;
  isEnabled = environment.aiAssistant?.enabled ?? false;
  messages: ChatMessage[] = [];
  isStreaming = false;
  userInput = '';
  context: AIContext | null = null;
  suggestedPrompts: string[] = [];

  /** Pending confirmation action (for destructive operations). */
  pendingConfirmation: { action: string; card: ActionCard } | null = null;

  ngOnInit(): void {
    if (!this.isEnabled) return;

    this.chatService.messages$.pipe(takeUntil(this.destroy$)).subscribe(msgs => {
      this.messages = msgs;
      this.cdr.detectChanges();
      this.scrollToBottom();
    });

    this.chatService.isStreaming$.pipe(takeUntil(this.destroy$)).subscribe(s => {
      this.isStreaming = s;
      this.cdr.detectChanges();
    });

    // Listen to route changes to update context + suggested prompts
    this.router.events.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.refreshContext();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  togglePanel(): void {
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      this.refreshContext();
      setTimeout(() => this.messageInput?.nativeElement?.focus(), 200);
    }
  }

  sendMessage(): void {
    const text = this.userInput.trim();
    if (!text || this.isStreaming) return;
    this.userInput = '';
    this.chatService.sendMessage(text);
  }

  sendPrompt(prompt: string): void {
    if (this.isStreaming) return;
    this.userInput = '';
    this.chatService.sendMessage(prompt);
  }

  stopStreaming(): void {
    this.chatService.stopStreaming();
  }

  clearChat(): void {
    this.chatService.clearMessages();
    this.pendingConfirmation = null;
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  // ── Action card handlers ───────────────────────────────────────

  onActionClick(card: ActionCard, action: string): void {
    if (action === 'cancel') {
      this.pendingConfirmation = null;
      return;
    }

    // If this is a confirmation card, execute the confirmed action
    if (card.type === 'confirmation') {
      this.pendingConfirmation = null;
      this.chatService.sendMessage(`Confirmed: execute ${action}`);
      return;
    }

    // If action looks destructive, show confirmation first
    if (this.isDestructiveAction(action)) {
      this.pendingConfirmation = { action, card };
      return;
    }

    // Otherwise send as a message
    this.chatService.sendMessage(`Execute action: ${action}`);
  }

  onRouteClick(route: string): void {
    this.router.navigateByUrl(route);
  }

  confirmAction(): void {
    if (!this.pendingConfirmation) return;
    this.chatService.sendMessage(`Confirmed: execute ${this.pendingConfirmation.action}`);
    this.pendingConfirmation = null;
  }

  cancelConfirmation(): void {
    this.pendingConfirmation = null;
  }

  // ── Helpers ────────────────────────────────────────────────────

  get contextHeader(): string {
    if (!this.context?.clientName) return '';
    return `${this.context.clientName} · #${this.context.clientId}`;
  }

  get screenLabel(): string {
    return this.context?.screen ?? '';
  }

  trackByMessageId(_index: number, msg: ChatMessage): string {
    return msg.id;
  }

  private refreshContext(): void {
    const snapshot = this.contextService.getContextSnapshot();
    this.context = snapshot;
    this.suggestedPrompts = this.contextService.getSuggestedPrompts(snapshot.screen);

    // Also trigger async fetch to populate client name cache
    this.contextService.getContext().pipe(takeUntil(this.destroy$)).subscribe(ctx => {
      this.context = ctx;
      this.cdr.detectChanges();
    });
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      const el = this.messageContainer?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);
  }

  private isDestructiveAction(action: string): boolean {
    const destructive = ['approve', 'disburse', 'delete', 'close', 'reject', 'withdraw', 'write_off'];
    return destructive.some(d => action.toLowerCase().includes(d));
  }
}
