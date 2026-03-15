import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

import { ClientsService } from '../clients/clients.service';
import { AuthenticationService } from '../core/authentication/authentication.service';
import { AIContext } from './models/message.model';

/**
 * Reads the current Mifos UI context (screen, client, user) and
 * packages it for the AI chat system prompt.
 *
 * Context sources:
 *  - URL segments  → screen, clientId, loanId, savingsAccountId, actionName
 *  - ClientsService  → clientName (fetched when clientId is present)
 *  - AuthenticationService → username, userId, roles, permissions, officeId
 */
@Injectable({ providedIn: 'root' })
export class AIContextService {

  private router = inject(Router);
  private clientsService = inject(ClientsService);
  private authService = inject(AuthenticationService);

  /** Cache to avoid re-fetching the same client on every message. */
  private clientCache: { id: string; name: string } | null = null;

  /**
   * Build the full AI context. Returns an Observable because we may
   * need to fetch the client name from the API.
   */
  getContext(): Observable<AIContext> {
    const urlParams = this.parseUrl();
    const user = this.getUserInfo();

    const base: AIContext = {
      screen: urlParams.screen,
      clientId: urlParams.clientId,
      clientName: null,
      loanId: urlParams.loanId,
      savingsAccountId: urlParams.savingsAccountId,
      actionName: urlParams.actionName,
      ...user,
    };

    if (!urlParams.clientId) {
      return of(base);
    }

    // Return cached name if we already fetched this client
    if (this.clientCache?.id === urlParams.clientId) {
      return of({ ...base, clientName: this.clientCache.name });
    }

    return this.clientsService.getClientData(urlParams.clientId).pipe(
      map((client: any) => {
        const name = client.displayName ?? `${client.firstname ?? ''} ${client.lastname ?? ''}`.trim();
        this.clientCache = { id: urlParams.clientId!, name };
        return { ...base, clientName: name };
      }),
      catchError(() => of(base)),
    );
  }

  /**
   * Return a quick synchronous snapshot (clientName may be null if not cached yet).
   */
  getContextSnapshot(): AIContext {
    const urlParams = this.parseUrl();
    const user = this.getUserInfo();
    return {
      screen: urlParams.screen,
      clientId: urlParams.clientId,
      clientName: this.clientCache?.id === urlParams.clientId ? this.clientCache.name : null,
      loanId: urlParams.loanId,
      savingsAccountId: urlParams.savingsAccountId,
      actionName: urlParams.actionName,
      ...user,
    };
  }

  /**
   * Build the system prompt section that describes the current context.
   */
  buildContextPrompt(ctx: AIContext): string {
    const parts: string[] = [
      `Current screen: ${ctx.screen}`,
    ];
    if (ctx.clientId) {
      parts.push(`Client ID: ${ctx.clientId}`);
    }
    if (ctx.clientName) {
      parts.push(`Client name: ${ctx.clientName}`);
    }
    if (ctx.loanId) {
      parts.push(`Loan ID: ${ctx.loanId}`);
    }
    if (ctx.savingsAccountId) {
      parts.push(`Savings account ID: ${ctx.savingsAccountId}`);
    }
    if (ctx.actionName) {
      parts.push(`Current action: ${ctx.actionName}`);
    }
    if (ctx.username) {
      parts.push(`Logged-in user: ${ctx.username} (ID ${ctx.userId})`);
    }
    if (ctx.userRole) {
      parts.push(`User role: ${ctx.userRole}`);
    }
    if (ctx.officeName) {
      parts.push(`Office: ${ctx.officeName} (ID ${ctx.officeId})`);
    }
    return parts.join('\n');
  }

  /**
   * Suggest quick-prompt chips based on the current screen.
   */
  getSuggestedPrompts(screen: string): string[] {
    const promptMap: Record<string, string[]> = {
      'client-detail': [
        'Show recent transactions',
        'Create a new loan',
        'View savings accounts',
      ],
      'loan-detail': [
        'Show repayment schedule',
        'Approve this loan',
        'Disburse this loan',
      ],
      'loan-list': [
        'Create a new loan',
        'Show pending approvals',
        'Filter by status',
      ],
      'savings-detail': [
        'Show transactions',
        'Make a deposit',
        'Make a withdrawal',
      ],
      'client-list': [
        'Search for a client',
        'Create a new client',
        'Show recent activity',
      ],
      'loan-action': [
        'What does this action do?',
        'Show loan details',
        'Go back to loan',
      ],
    };
    return promptMap[screen] ?? [
      'How can I help you?',
      'Show my pending tasks',
      'Search for a client',
    ];
  }

  // ── Private helpers ────────────────────────────────────────────

  /**
   * Parse the current Router URL into structured params.
   *
   * Mifos uses hash routing. Typical URLs:
   *   /#/clients
   *   /#/clients/42/general
   *   /#/clients/42/loans-accounts/107/general
   *   /#/clients/42/savings-accounts/200/transactions
   *   /#/clients/42/loans-accounts/107/actions/approve
   */
  private parseUrl(): {
    screen: string;
    clientId: string | null;
    loanId: string | null;
    savingsAccountId: string | null;
    actionName: string | null;
  } {
    const url = this.router.url; // e.g. "/clients/42/loans-accounts/107/general"
    const segments = url.split('/').filter(Boolean);

    let clientId: string | null = null;
    let loanId: string | null = null;
    let savingsAccountId: string | null = null;
    let actionName: string | null = null;

    for (let i = 0; i < segments.length; i++) {
      if (segments[i] === 'clients' && this.isId(segments[i + 1])) {
        clientId = segments[i + 1];
      }
      if (segments[i] === 'loans-accounts' && this.isId(segments[i + 1])) {
        loanId = segments[i + 1];
      }
      if (segments[i] === 'savings-accounts' && this.isId(segments[i + 1])) {
        savingsAccountId = segments[i + 1];
      }
      if (segments[i] === 'actions' && segments[i + 1]) {
        actionName = segments[i + 1];
      }
    }

    return {
      screen: this.detectScreen(segments, { clientId, loanId, savingsAccountId }),
      clientId,
      loanId,
      savingsAccountId,
      actionName,
    };
  }

  /**
   * Map URL segments to a human-readable screen name for the AI.
   */
  private detectScreen(
    segments: string[],
    ids: { clientId: string | null; loanId: string | null; savingsAccountId: string | null },
  ): string {
    if (segments.includes('actions')) return 'loan-action';
    if (ids.savingsAccountId) return 'savings-detail';
    if (ids.loanId) return 'loan-detail';
    if (segments.includes('loans-accounts') && !ids.loanId) return 'loan-list';
    if (ids.clientId) return 'client-detail';
    if (segments[0] === 'clients' && !ids.clientId) return 'client-list';
    if (segments[0] === 'home' || segments.length === 0) return 'dashboard';
    return segments[0] ?? 'dashboard';
  }

  /** Read user info from stored credentials. */
  private getUserInfo(): {
    userId: number | null;
    username: string | null;
    userRole: string | null;
    permissions: string[];
    officeId: number | null;
    officeName: string | null;
  } {
    const creds = this.authService.getCredentials();
    if (!creds) {
      return { userId: null, username: null, userRole: null, permissions: [], officeId: null, officeName: null };
    }
    // Roles come as an array of { id, name, ... } objects
    const roleName = Array.isArray(creds.roles) && creds.roles.length > 0
      ? creds.roles[0].name ?? null
      : null;

    return {
      userId: creds.userId,
      username: creds.username,
      userRole: roleName,
      permissions: creds.permissions ?? [],
      officeId: creds.officeId,
      officeName: creds.officeName,
    };
  }

  /** Check if a URL segment looks like a numeric ID. */
  private isId(segment: string | undefined): boolean {
    return !!segment && /^\d+$/.test(segment);
  }
}
