import { Component, inject, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

import { AiOverlayService, AiAction, AiInsight, AiRiskProfile, AiConfirmation, AiToast } from './services/ai-overlay.service';
import { environment } from '../../environments/environment';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isTyping?: boolean;
  actionCard?: {
    type: string;
    title: string;
    data: Record<string, any>;
    actions?: { label: string; action: string }[];
  };
}

interface QuickChip {
  label: string;
  message: string;
  isActive?: boolean;
}

interface FeedItem {
  id: string;
  icon: string;
  iconColor: string;
  title: string;
  description: string;
  timestamp: string;
  actionLabel: string;
  isActive?: boolean;
}

@Component({
  selector: 'mifosx-ai-overlay',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ai-overlay.component.html',
  styleUrls: ['./ai-overlay.component.scss'],
})
export class AiOverlayComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('chatInput') chatInputEl!: ElementRef<HTMLInputElement>;
  @ViewChild('messagesContainer') messagesContainer!: ElementRef<HTMLDivElement>;

  private overlayService = inject(AiOverlayService);
  private destroy$ = new Subject<void>();

  isEnabled = environment.aiAssistant?.enabled ?? false;

  // Panel state
  panelOpen = false;
  riskBarsAnimated = false;

  // Data from service
  insights: AiInsight[] = [];
  actions: AiAction[] = [];
  riskProfile: AiRiskProfile | null = null;
  confirmation: AiConfirmation | null = null;
  toasts: AiToast[] = [];

  // Chat state
  chatMessages: ChatMessage[] = [];
  chatInput$ = '';
  isAiTyping = false;

  // Feed items (derived from insights)
  feedItems: FeedItem[] = [];

  // Quick chips by screen
  quickChips: QuickChip[] = [];
  private chipsByScreen: Record<string, QuickChip[]> = {
    'dashboard': [
      { label: 'Pending tasks', message: 'Show my pending tasks for today' },
      { label: 'Collection summary', message: 'Show collection summary for today' },
      { label: 'Overdue clients', message: 'List all clients with overdue payments', isActive: true },
      { label: 'Daily report', message: 'Show daily summary report' },
      { label: 'Recent activity', message: 'Show recent loan activity' },
    ],
    'client-list': [
      { label: 'Find client', message: 'Help me find a client' },
      { label: 'New client', message: 'Create a new client' },
      { label: 'Overdue list', message: 'Show clients with overdue payments', isActive: true },
      { label: 'Today visits', message: 'Show scheduled client visits for today' },
    ],
    'client-detail': [
      { label: 'Loan status', message: 'What is the current loan status?', isActive: true },
      { label: 'Payment history', message: 'Show payment history for this client' },
      { label: 'Create loan', message: 'Create a new loan for this client' },
      { label: 'Risk profile', message: 'Show risk profile analysis' },
    ],
    'loan-detail': [
      { label: 'Approve loan', message: 'Approve this loan application', isActive: true },
      { label: 'Repayment schedule', message: 'Show repayment schedule' },
      { label: 'Disburse funds', message: 'Disburse the loan amount' },
      { label: 'Loan history', message: 'Show loan transaction history' },
    ],
  };

  // Mock loan detail
  loanId = '4521';
  loanStatus = 'Pending Approval';
  loanData: { label: string; value: string; color?: string }[] = [
    { label: 'Principal', value: '₹50,000', color: 'gold' },
    { label: 'Interest Rate', value: '12% p.a.' },
    { label: 'Term', value: '24 months' },
    { label: 'EMI Amount', value: '₹2,354', color: 'gold' },
    { label: 'Disbursed', value: 'Mar 01, 2026', color: 'success' },
    { label: 'Next Due', value: 'Mar 18, 2026', color: 'warning' },
  ];

  ngOnInit(): void {
    if (!this.isEnabled) return;

    this.overlayService.insights$
      .pipe(takeUntil(this.destroy$))
      .subscribe(i => {
        this.insights = i;
        this.buildFeedItems();
      });

    this.overlayService.actions$
      .pipe(takeUntil(this.destroy$))
      .subscribe(a => this.actions = a);

    this.overlayService.riskProfile$
      .pipe(takeUntil(this.destroy$))
      .subscribe(r => this.riskProfile = r);

    this.overlayService.confirmation$
      .pipe(takeUntil(this.destroy$))
      .subscribe(c => this.confirmation = c);

    this.overlayService.toast$
      .pipe(takeUntil(this.destroy$))
      .subscribe(t => this.addToast(t));

    this.updateQuickChips();

    this.overlayService.actionBarVisible$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.updateQuickChips());
  }

  ngAfterViewInit(): void {
    // Listen for keyboard shortcut
    document.addEventListener('keydown', this.onGlobalKeydown);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    document.removeEventListener('keydown', this.onGlobalKeydown);
  }

  // ── Panel Controls ──

  openPanel(): void {
    this.panelOpen = true;
    this.riskBarsAnimated = false;
    // Trigger risk bar animation after panel transition
    setTimeout(() => {
      this.riskBarsAnimated = true;
    }, 400);
  }

  closePanel(): void {
    this.panelOpen = false;
    this.riskBarsAnimated = false;
  }

  togglePanel(): void {
    if (this.panelOpen) {
      this.closePanel();
    } else {
      this.openPanel();
    }
  }

  private onGlobalKeydown = (e: KeyboardEvent): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      this.togglePanel();
      if (this.panelOpen) {
        setTimeout(() => this.chatInputEl?.nativeElement?.focus(), 350);
      }
    }
  };

  // ── Feed Items ──

  private buildFeedItems(): void {
    const iconMap: Record<string, { icon: string; color: string }> = {
      'opportunity': { icon: '↗', color: 'success' },
      'warning': { icon: '!', color: 'warning' },
      'info': { icon: '✦', color: 'primary' },
    };

    this.feedItems = this.insights.map((ins, idx) => {
      const m = iconMap[ins.type] || iconMap['info'];
      return {
        id: ins.id,
        icon: m.icon,
        iconColor: m.color,
        title: ins.title,
        description: ins.message,
        timestamp: this.getRelativeTime(idx),
        actionLabel: ins.primaryAction,
        isActive: idx === 0,
      };
    });

    // Add some static feed items for richness
    if (this.feedItems.length < 3) {
      this.feedItems.push({
        id: 'feed-auto-1',
        icon: '◎',
        iconColor: 'primary',
        title: 'Repayment Collected',
        description: 'EMI payment of ₹3,500 received and recorded automatically.',
        timestamp: '2h ago',
        actionLabel: 'View',
        isActive: false,
      });
      this.feedItems.push({
        id: 'feed-auto-2',
        icon: '✓',
        iconColor: 'success',
        title: 'Document Verified',
        description: 'KYC documents for loan application have been verified.',
        timestamp: '4h ago',
        actionLabel: 'Details',
        isActive: false,
      });
    }
  }

  private getRelativeTime(index: number): string {
    const times = ['Just now', '12m ago', '1h ago', '2h ago', '4h ago'];
    return times[index] || `${index + 1}h ago`;
  }

  // ── Chat ──

  sendMessage(): void {
    const text = this.chatInput$.trim();
    if (!text || this.isAiTyping) return;

    this.chatMessages.push({
      id: `msg-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date(),
    });

    this.chatInput$ = '';
    this.scrollToBottom();
    this.simulateAiResponse(text);
  }

  sendChipMessage(chip: QuickChip): void {
    if (this.isAiTyping) return;
    this.chatMessages.push({
      id: `msg-${Date.now()}`,
      role: 'user',
      content: chip.message,
      timestamp: new Date(),
    });
    this.scrollToBottom();
    this.simulateAiResponse(chip.message);
  }

  onChatKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  private simulateAiResponse(userMessage: string): void {
    this.isAiTyping = true;
    setTimeout(() => {
      const response = this.generateMockResponse(userMessage);
      this.chatMessages.push(response);
      this.isAiTyping = false;
      this.scrollToBottom();
    }, 1500);
  }

  private generateMockResponse(userMessage: string): ChatMessage {
    const lowerMsg = userMessage.toLowerCase();
    const clientName = this.clientName || 'this client';

    if (lowerMsg.includes('loan status') || lowerMsg.includes('loan')) {
      return {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: `Loan #4521 for ${clientName} is currently Pending Approval. Principal: ₹50,000 at 12% p.a. for 24 months. All documents are verified and the loan is ready for your approval.`,
        timestamp: new Date(),
      };
    }

    if (lowerMsg.includes('payment') || lowerMsg.includes('history')) {
      return {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: `${clientName} has made 12 on-time payments totaling ₹42,000. Outstanding balance: ₹8,000. On-time rate: 92%. Next EMI of ₹3,500 is due Mar 18.`,
        timestamp: new Date(),
      };
    }

    if (lowerMsg.includes('risk') || lowerMsg.includes('profile')) {
      return {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: `Risk analysis for ${clientName}: Repayment score 78% (Good), Credit score 72%, Overdue risk 35%, Savings 85%. Overall score: 68/100 — rated Good. Eligible for top-up loan.`,
        timestamp: new Date(),
      };
    }

    if (lowerMsg.includes('approve')) {
      return {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: `Ready to approve Loan #4521 for ${clientName}. Amount: ₹50,000, Term: 24 months EMI. Use the "Approve Loan" button in the action panel on the right, or say "confirm approval" to proceed.`,
        timestamp: new Date(),
      };
    }

    return {
      id: `msg-${Date.now()}`,
      role: 'assistant',
      content: `I can help with that. For ${clientName}, I have access to loan details, payment history, risk profiles, and can execute actions like approvals and disbursements. What specifically would you like to know?`,
      timestamp: new Date(),
    };
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      if (this.messagesContainer?.nativeElement) {
        this.messagesContainer.nativeElement.scrollTop =
          this.messagesContainer.nativeElement.scrollHeight;
      }
    }, 50);
  }

  // ── Quick Chips ──

  private updateQuickChips(): void {
    const screen = this.getCurrentScreen();
    this.quickChips = this.chipsByScreen[screen] || this.chipsByScreen['dashboard'];
  }

  private getCurrentScreen(): string {
    const url = window.location.hash || '';
    if (url.includes('loans-accounts')) return 'loan-detail';
    if (url.includes('clients/') && url.includes('/')) return 'client-detail';
    if (url.includes('clients')) return 'client-list';
    return 'dashboard';
  }

  // ── Getters ──

  get clientName(): string {
    return this.overlayService.getClientName() || 'Ramesh Kumar';
  }

  get clientId(): string {
    return this.overlayService.getClientId() || '1';
  }

  get clientBranch(): string {
    return 'Koramangala Branch';
  }

  getClientInitials(): string {
    const name = this.clientName;
    if (!name) return 'CL';
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  // ── Feed Actions ──

  onFeedAction(item: FeedItem): void {
    // Mark as active
    this.feedItems.forEach(f => f.isActive = false);
    item.isActive = true;
  }

  // ── Loan Action Buttons ──

  onLoanAction(action: string): void {
    if (action === 'approve') {
      const mockAction: AiAction = {
        id: 'panel-approve',
        icon: 'approve',
        name: 'Approve Loan',
        description: 'Approve loan from dashboard panel',
        tag: 'ready',
        data: { loanId: this.loanId, amount: 50000 },
      };
      this.overlayService.executeAction(mockAction);
    } else if (action === 'disburse') {
      const mockAction: AiAction = {
        id: 'panel-disburse',
        icon: 'disburse',
        name: 'Disburse Funds',
        description: 'Disburse from dashboard panel',
        tag: 'ready',
        data: { loanId: this.loanId, amount: 50000 },
      };
      this.overlayService.executeAction(mockAction);
    }
  }

  // ── Confirmation ──

  onConfirm(): void {
    this.confirmation?.onConfirm();
  }

  onCancel(): void {
    this.confirmation?.onCancel();
  }

  // ── Toasts ──

  private addToast(toast: AiToast): void {
    this.toasts.push(toast);
    if (toast.autoDismiss !== false) {
      setTimeout(() => this.removeToast(toast.id), 4000);
    }
  }

  removeToast(id: string): void {
    this.toasts = this.toasts.filter(t => t.id !== id);
  }

  // ── Track By ──

  trackByMessage(_: number, msg: ChatMessage): string { return msg.id; }
  trackByFeed(_: number, item: FeedItem): string { return item.id; }
  trackByToast(_: number, item: AiToast): string { return item.id; }
}
