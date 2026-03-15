import { Component, inject, OnInit, OnDestroy, ViewChild, ElementRef, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil, interval } from 'rxjs';

import { AiOverlayService, AiRiskProfile } from './services/ai-overlay.service';
import { environment } from '../../environments/environment';

interface LoanDetailData {
  loanId: string;
  status: string;
  amount: string;
  interestRate: string;
  term: string;
  repaymentRate: string;
  overdueAmount: string;
  totalRepaid: string;
  nextEmiDate: string;
}

interface FeedItem {
  id: string;
  icon: string;
  iconColor: 'purple' | 'gold' | 'success' | 'warning';
  title: string;
  description: string;
  timestamp: string;
  action: string;
  isActive?: boolean;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface QuickChip {
  id: string;
  label: string;
  isActive?: boolean;
}

@Component({
  selector: 'mifosx-ai-intelligence-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ai-intelligence-panel.component.html',
  styleUrls: ['./ai-intelligence-panel.component.scss'],
})
export class AiIntelligencePanelComponent implements OnInit, OnDestroy {
  @ViewChild('chatInput') chatInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('messagesContainer') messagesContainer!: ElementRef<HTMLDivElement>;

  private overlayService = inject(AiOverlayService);
  private destroy$ = new Subject<void>();

  // Panel state
  isEnabled = environment.aiAssistant?.enabled ?? false;
  isPanelOpen = signal(false);
  isLiveConnected = signal(true);

  // UI state
  activeFeedItemId = signal<string | null>('feed-1');
  chatInput$ = '';
  isAiTyping = false;
  chatMessages: ChatMessage[] = [];

  // Data signals
  currentClient = signal({
    name: 'Ramesh Kumar',
    id: '#CL001234',
    branch: 'Mumbai Central',
    avatar: 'RK'
  });

  feedItems = signal<FeedItem[]>([
    {
      id: 'feed-1',
      icon: 'approve',
      iconColor: 'success',
      title: 'Loan approval recommended',
      description: 'Strong credit profile with 96% repayment history. Risk score: Low.',
      timestamp: '2 mins ago',
      action: 'Review',
      isActive: true
    },
    {
      id: 'feed-2',
      icon: 'alert',
      iconColor: 'warning',
      title: 'Payment reminder due',
      description: 'EMI of ₹3,500 due in 2 days. Client has good payment history.',
      timestamp: '5 mins ago',
      action: 'Send'
    },
    {
      id: 'feed-3',
      icon: 'opportunity',
      iconColor: 'purple',
      title: 'Top-up loan opportunity',
      description: 'Client eligible for additional ₹25K loan at 12% interest.',
      timestamp: '12 mins ago',
      action: 'Create'
    },
    {
      id: 'feed-4',
      icon: 'savings',
      iconColor: 'gold',
      title: 'Savings goal achieved',
      description: 'Monthly savings target of ₹5,000 exceeded by 120%.',
      timestamp: '18 mins ago',
      action: 'View'
    }
  ]);

  loanDetail = signal<LoanDetailData>({
    loanId: 'LN4521',
    status: 'Active',
    amount: '₹50,000',
    interestRate: '12.5% p.a.',
    term: '24 months',
    repaymentRate: '94.2%',
    overdueAmount: '₹0',
    totalRepaid: '₹32,500',
    nextEmiDate: 'Mar 18, 2026'
  });

  riskProfile = signal<AiRiskProfile>({
    repayment: 78,
    credit: 85,
    overdue: 35,
    savings: 92,
    overallScore: 68,
    rating: 'good'
  });

  actionChips = signal<QuickChip[]>([
    { id: 'approve', label: 'Approve loan' },
    { id: 'payment', label: 'Record payment' },
    { id: 'reminder', label: 'Send reminder' },
    { id: 'topup', label: 'Create top-up', isActive: true },
    { id: 'history', label: 'View history' },
    { id: 'report', label: 'Generate report' }
  ]);

  // Computed values
  attentionCount = computed(() => this.feedItems().length);

  currentTimestamp = new Intl.DateTimeFormat('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(new Date());

  ngOnInit(): void {
    if (!this.isEnabled) return;

    this.setupKeyboardShortcuts();

    // Simulate occasional disconnects
    interval(2000).pipe(takeUntil(this.destroy$)).subscribe(() => {
      if (Math.random() < 0.05) {
        this.isLiveConnected.set(false);
        setTimeout(() => this.isLiveConnected.set(true), 3000);
      }
    });

    // Auto-cycle through feed items
    interval(8000).pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.cycleFeedItems();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    document.removeEventListener('keydown', this.handleKeyboardShortcuts);
  }

  // Keyboard shortcuts
  private setupKeyboardShortcuts(): void {
    document.addEventListener('keydown', this.handleKeyboardShortcuts);
  }

  private handleKeyboardShortcuts = (event: KeyboardEvent): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.togglePanel();
    }

    if (event.key === 'Escape' && this.isPanelOpen()) {
      event.preventDefault();
      this.closePanel();
    }

    if (this.isPanelOpen() && !this.isInputFocused()) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.navigateFeed('next');
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.navigateFeed('prev');
      }
    }
  };

  private isInputFocused(): boolean {
    const activeElement = document.activeElement;
    return activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA';
  }

  private navigateFeed(direction: 'next' | 'prev'): void {
    const items = this.feedItems();
    const currentIndex = items.findIndex(item => item.id === this.activeFeedItemId());

    if (direction === 'next') {
      const nextIndex = (currentIndex + 1) % items.length;
      this.activeFeedItemId.set(items[nextIndex].id);
    } else {
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
      this.activeFeedItemId.set(items[prevIndex].id);
    }
  }

  // Panel controls
  togglePanel(): void {
    this.isPanelOpen.update(isOpen => !isOpen);
  }

  closePanel(): void {
    this.isPanelOpen.set(false);
  }

  // Feed controls
  selectFeedItem(id: string): void {
    this.activeFeedItemId.set(id);
  }

  private cycleFeedItems(): void {
    const items = this.feedItems();
    const currentIndex = items.findIndex(item => item.id === this.activeFeedItemId());
    const nextIndex = (currentIndex + 1) % items.length;
    this.activeFeedItemId.set(items[nextIndex].id);
  }

  // Action handlers
  performLoanAction(action: string): void {
    console.log(`Loan action: ${action}`);
  }

  quickAction(chipId: string): void {
    const chip = this.actionChips().find(c => c.id === chipId);
    if (chip) {
      this.chatInput$ = chip.label;
      this.sendMessage();
    }
  }

  // Chat
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
    this.scrollChatToBottom();
    this.simulateAiResponse(text);
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
      this.scrollChatToBottom();
    }, 1500);
  }

  private generateMockResponse(userMessage: string): ChatMessage {
    const lowerMsg = userMessage.toLowerCase();
    const clientName = this.currentClient().name;

    if (lowerMsg.includes('approve')) {
      return {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: `I can help you approve the loan for ${clientName}. Based on their excellent credit profile and 96% repayment history, this is a low-risk approval. The loan amount is ₹50,000 at 12.5% p.a. for 24 months.`,
        timestamp: new Date(),
      };
    }

    if (lowerMsg.includes('payment') || lowerMsg.includes('reminder')) {
      return {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: `The next EMI payment of ₹3,500 is due on Mar 18, 2026. ${clientName} has maintained a good payment history. I can send a payment reminder or help record a payment.`,
        timestamp: new Date(),
      };
    }

    return {
      id: `msg-${Date.now()}`,
      role: 'assistant',
      content: `I understand you're asking about "${userMessage}". I can help with loan approvals, payment tracking, risk analysis, and client management for ${clientName}. What would you like to do?`,
      timestamp: new Date(),
    };
  }

  private scrollChatToBottom(): void {
    setTimeout(() => {
      if (this.messagesContainer?.nativeElement) {
        this.messagesContainer.nativeElement.scrollTop =
          this.messagesContainer.nativeElement.scrollHeight;
      }
    }, 50);
  }

  getUserInitials(): string {
    const name = this.currentClient().name;
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  // Risk bar style
  getRiskBarStyle(value: number): any {
    return {
      '--bar-width': `${value}%`,
      'width': `${value}%`
    };
  }

  // Track by
  trackByFeedItem(_: number, item: FeedItem): string {
    return item.id;
  }

  trackByMessage(_: number, msg: ChatMessage): string {
    return msg.id;
  }

  trackByChip(_: number, chip: QuickChip): string {
    return chip.id;
  }
}
