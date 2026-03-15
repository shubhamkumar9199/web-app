import { Injectable, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { BehaviorSubject, Subject, filter } from 'rxjs';

// ═══════════════════════════════════════════
// MOCK DATA INTERFACES
// ═══════════════════════════════════════════

export interface AiInsight {
  id: string;
  type: 'opportunity' | 'warning' | 'info';
  title: string;
  message: string;
  highlights: { text: string; value: string }[];
  primaryAction: string;
  secondaryAction?: string;
}

export interface AiAction {
  id: string;
  icon: 'approve' | 'disburse' | 'alert' | 'savings' | 'loan';
  name: string;
  description: string;
  tag: 'urgent' | 'ready' | 'suggested';
  data?: Record<string, any>;
}

export interface AiRiskProfile {
  repayment: number;
  credit: number;
  overdue: number;
  savings: number;
  overallScore: number;
  rating: 'good' | 'average' | 'poor';
}

export interface AiToast {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  subtitle?: string;
  txnId?: string;
  autoDismiss?: boolean;
}

export interface AiConfirmation {
  title: string;
  description: string;
  amount?: string;
  details?: { label: string; value: string }[];
  confirmLabel: string;
  cancelLabel: string;
  type: 'confirm' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

export interface AiHotspot {
  id: string;
  targetSelector: string;
  insight: AiInsight;
  position: 'top' | 'bottom' | 'left' | 'right';
}

// ═══════════════════════════════════════════
// MOCK DATA
// ═══════════════════════════════════════════

const MOCK_CLIENTS: Record<string, { name: string; id: string }> = {
  '1': { name: 'Ramesh Kumar', id: '1' },
  '2': { name: 'Priya Sharma', id: '2' },
  '3': { name: 'Amit Patel', id: '3' },
  '42': { name: 'Suresh Reddy', id: '42' },
};

const MOCK_INSIGHTS: Record<string, AiInsight[]> = {
  'dashboard': [
    {
      id: 'ins-dash',
      type: 'info',
      title: 'Welcome Back',
      message: 'Here is your daily summary and pending actions.',
      highlights: [
        { text: 'Pending approvals', value: '2' },
        { text: 'Overdue payments', value: '₹15,500' },
      ],
      primaryAction: 'View Dashboard',
      secondaryAction: 'Dismiss',
    },
  ],
  'client-list': [
    {
      id: 'ins-0',
      type: 'info',
      title: 'Daily Summary',
      message: 'You have 5 pending tasks and 2 loan approvals waiting.',
      highlights: [
        { text: 'Collections today', value: '₹45,000' },
        { text: 'Overdue clients', value: '3' },
      ],
      primaryAction: 'View Tasks',
      secondaryAction: 'Dismiss',
    },
  ],
  'client-detail': [
    {
      id: 'ins-1',
      type: 'opportunity',
      title: 'Top-up Eligible',
      message: 'This client has excellent repayment history and is eligible for a top-up loan.',
      highlights: [
        { text: 'Available amount', value: '₹25,000' },
        { text: 'Interest rate', value: '12% p.a.' },
      ],
      primaryAction: 'Create Top-up',
      secondaryAction: 'Dismiss',
    },
    {
      id: 'ins-2',
      type: 'info',
      title: 'Upcoming EMI',
      message: 'Next EMI payment is due in 3 days.',
      highlights: [
        { text: 'Amount due', value: '₹3,500' },
        { text: 'Due date', value: 'Mar 18, 2026' },
      ],
      primaryAction: 'Send Reminder',
      secondaryAction: 'Dismiss',
    },
  ],
  'loan-detail': [
    {
      id: 'ins-3',
      type: 'warning',
      title: 'Pending Approval',
      message: 'This loan application is pending your approval for 2 days.',
      highlights: [
        { text: 'Loan amount', value: '₹50,000' },
        { text: 'Submitted', value: 'Mar 13, 2026' },
      ],
      primaryAction: 'Review & Approve',
      secondaryAction: 'View Details',
    },
  ],
};

const MOCK_ACTIONS: Record<string, AiAction[]> = {
  'dashboard': [
    {
      id: 'act-dash1',
      icon: 'approve',
      name: '2 Pending Approvals',
      description: 'Loan applications waiting for your review.',
      tag: 'ready',
      data: { count: 2 },
    },
    {
      id: 'act-dash2',
      icon: 'alert',
      name: 'Overdue Collections',
      description: '₹15,500 overdue across 3 clients.',
      tag: 'urgent',
      data: { amount: 15500 },
    },
    {
      id: 'act-dash3',
      icon: 'disburse',
      name: 'Ready to Disburse',
      description: '1 approved loan ready for disbursement.',
      tag: 'ready',
      data: { count: 1 },
    },
  ],
  'client-list': [
    {
      id: 'act-0',
      icon: 'alert',
      name: 'Follow-up Required',
      description: '3 clients have overdue payments. Send reminders now.',
      tag: 'urgent',
      data: { count: 3 },
    },
    {
      id: 'act-0b',
      icon: 'approve',
      name: 'Pending Approvals',
      description: '2 loan applications awaiting your approval.',
      tag: 'ready',
      data: { count: 2 },
    },
    {
      id: 'act-0c',
      icon: 'savings',
      name: 'New Deposits',
      description: '₹45,000 collected today across 5 clients.',
      tag: 'suggested',
      data: { amount: 45000 },
    },
  ],
  'client-detail': [
    {
      id: 'act-1',
      icon: 'approve',
      name: 'Approve Loan',
      description: 'Loan #4521 is ready for approval. All documents verified.',
      tag: 'ready',
      data: { loanId: '4521', amount: 50000 },
    },
    {
      id: 'act-2',
      icon: 'alert',
      name: 'Collect Payment',
      description: 'EMI of ₹3,500 is overdue by 5 days. Last reminder sent.',
      tag: 'urgent',
      data: { amount: 3500, daysOverdue: 5 },
    },
    {
      id: 'act-3',
      icon: 'disburse',
      name: 'Offer Top-up',
      description: 'Client eligible for ₹25,000 top-up based on history.',
      tag: 'suggested',
      data: { eligibleAmount: 25000 },
    },
  ],
  'loan-detail': [
    {
      id: 'act-4',
      icon: 'approve',
      name: 'Approve Loan',
      description: 'All verification completed. Ready for approval.',
      tag: 'ready',
      data: { loanId: '4521', amount: 50000 },
    },
    {
      id: 'act-5',
      icon: 'disburse',
      name: 'Disburse Funds',
      description: 'Loan approved. Disburse ₹50,000 to client account.',
      tag: 'ready',
      data: { amount: 50000, accountNo: 'XXXX-1234' },
    },
    {
      id: 'act-6',
      icon: 'loan',
      name: 'Schedule Repayment',
      description: 'Set up automatic repayment schedule.',
      tag: 'suggested',
    },
  ],
};

const MOCK_RISK_PROFILES: Record<string, AiRiskProfile> = {
  '1': { repayment: 78, credit: 72, overdue: 35, savings: 85, overallScore: 68, rating: 'good' },
  '2': { repayment: 92, credit: 88, overdue: 8, savings: 76, overallScore: 82, rating: 'good' },
  '3': { repayment: 45, credit: 52, overdue: 68, savings: 30, overallScore: 42, rating: 'poor' },
  '42': { repayment: 65, credit: 60, overdue: 45, savings: 55, overallScore: 56, rating: 'average' },
};

// ═══════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════

@Injectable({ providedIn: 'root' })
export class AiOverlayService {
  private router = inject(Router);

  // State
  private insightsSubject = new BehaviorSubject<AiInsight[]>([]);
  private actionsSubject = new BehaviorSubject<AiAction[]>([]);
  private riskProfileSubject = new BehaviorSubject<AiRiskProfile | null>(null);
  private confirmationSubject = new BehaviorSubject<AiConfirmation | null>(null);
  private toastSubject = new Subject<AiToast>();
  private actionBarVisibleSubject = new BehaviorSubject<boolean>(false);
  private actionBarExpandedSubject = new BehaviorSubject<boolean>(false);

  // Public observables
  readonly insights$ = this.insightsSubject.asObservable();
  readonly actions$ = this.actionsSubject.asObservable();
  readonly riskProfile$ = this.riskProfileSubject.asObservable();
  readonly confirmation$ = this.confirmationSubject.asObservable();
  readonly toast$ = this.toastSubject.asObservable();
  readonly actionBarVisible$ = this.actionBarVisibleSubject.asObservable();
  readonly actionBarExpanded$ = this.actionBarExpandedSubject.asObservable();

  // Current context
  private currentScreen = '';
  private currentClientId: string | null = null;

  constructor() {
    // Listen to route changes and update context
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((event) => {
        this.updateContext(event.urlAfterRedirects);
      });

    // Also trigger on initial load
    setTimeout(() => {
      this.updateContext(this.router.url);
    }, 500);
  }

  // ─────────────────────────────────────────
  // Context & Data Loading
  // ─────────────────────────────────────────

  private updateContext(url: string): void {
    const segments = url.split('/').filter(Boolean);

    // Extract IDs from URL
    let clientId: string | null = null;
    let screen = 'dashboard';

    for (let i = 0; i < segments.length; i++) {
      if (segments[i] === 'clients' && /^\d+$/.test(segments[i + 1])) {
        clientId = segments[i + 1];
      }
    }

    // Determine screen type
    if (segments.includes('loans-accounts')) {
      screen = 'loan-detail';
    } else if (segments.includes('savings-accounts')) {
      screen = 'savings-detail';
    } else if (clientId) {
      screen = 'client-detail';
    } else if (segments[0] === 'clients') {
      screen = 'client-list';
    }

    this.currentScreen = screen;
    this.currentClientId = clientId;

    // Load mock data for current context
    this.loadMockData();
  }

  private loadMockData(): void {
    // Load insights
    const insights = MOCK_INSIGHTS[this.currentScreen] || [];
    this.insightsSubject.next(insights);

    // Load actions
    const actions = MOCK_ACTIONS[this.currentScreen] || [];
    this.actionsSubject.next(actions);

    // Show action bar if there are actions
    this.actionBarVisibleSubject.next(actions.length > 0);
    this.actionBarExpandedSubject.next(false);

    // Load risk profile if on client page
    if (this.currentClientId) {
      const profile = MOCK_RISK_PROFILES[this.currentClientId] || MOCK_RISK_PROFILES['1'];
      this.riskProfileSubject.next(profile);
    } else {
      this.riskProfileSubject.next(null);
    }
  }

  // ─────────────────────────────────────────
  // Public Methods
  // ─────────────────────────────────────────

  getClientName(): string {
    if (!this.currentClientId) return '';
    return MOCK_CLIENTS[this.currentClientId]?.name || `Client #${this.currentClientId}`;
  }

  getClientId(): string | null {
    return this.currentClientId;
  }

  getActionCount(): number {
    return this.actionsSubject.value.length;
  }

  toggleActionBar(): void {
    this.actionBarExpandedSubject.next(!this.actionBarExpandedSubject.value);
  }

  hideActionBar(): void {
    this.actionBarVisibleSubject.next(false);
  }

  // ─────────────────────────────────────────
  // Action Handlers
  // ─────────────────────────────────────────

  executeAction(action: AiAction): void {
    // Show confirmation for certain actions
    if (['approve', 'disburse'].includes(action.icon)) {
      this.showConfirmation({
        title: action.icon === 'approve' ? 'Approve Loan?' : 'Disburse Funds?',
        description: action.icon === 'approve'
          ? 'This will approve the loan application and notify the client.'
          : 'This will transfer funds to the client\'s linked bank account.',
        amount: action.data?.amount ? `₹${action.data.amount.toLocaleString()}` : undefined,
        details: [
          { label: 'Client', value: this.getClientName() },
          { label: 'Loan ID', value: `#${action.data?.loanId || '4521'}` },
        ],
        confirmLabel: action.icon === 'approve' ? 'Approve' : 'Disburse',
        cancelLabel: 'Cancel',
        type: 'confirm',
        onConfirm: () => this.completeAction(action),
        onCancel: () => this.hideConfirmation(),
      });
    } else {
      // Execute directly
      this.completeAction(action);
    }
  }

  private completeAction(action: AiAction): void {
    this.hideConfirmation();

    // Simulate processing delay
    setTimeout(() => {
      // Show success toast
      this.showToast({
        id: `toast-${Date.now()}`,
        type: 'success',
        title: this.getSuccessMessage(action),
        subtitle: `${this.getClientName()} · ₹${action.data?.amount?.toLocaleString() || '50,000'}`,
        txnId: `TXN-${Math.floor(Math.random() * 900000) + 100000}`,
        autoDismiss: true,
      });

      // Remove the action from the list
      const currentActions = this.actionsSubject.value.filter(a => a.id !== action.id);
      this.actionsSubject.next(currentActions);

      if (currentActions.length === 0) {
        this.actionBarVisibleSubject.next(false);
      }
    }, 800);
  }

  private getSuccessMessage(action: AiAction): string {
    switch (action.icon) {
      case 'approve': return 'Loan approved successfully';
      case 'disburse': return 'Funds disbursed successfully';
      case 'alert': return 'Payment collected';
      default: return 'Action completed';
    }
  }

  // ─────────────────────────────────────────
  // Confirmation Dialog
  // ─────────────────────────────────────────

  showConfirmation(config: AiConfirmation): void {
    this.confirmationSubject.next(config);
  }

  hideConfirmation(): void {
    this.confirmationSubject.next(null);
  }

  // ─────────────────────────────────────────
  // Toast Notifications
  // ─────────────────────────────────────────

  showToast(toast: AiToast): void {
    this.toastSubject.next(toast);
  }

  // ─────────────────────────────────────────
  // Dismiss Insight
  // ─────────────────────────────────────────

  dismissInsight(insightId: string): void {
    const current = this.insightsSubject.value.filter(i => i.id !== insightId);
    this.insightsSubject.next(current);
  }
}
