export type MessageRole = 'user' | 'assistant' | 'system';

export type ActionCardType = 'loan' | 'client' | 'savings' | 'transaction' | 'confirmation';

export interface ActionCard {
  type: ActionCardType;
  title: string;
  data: Record<string, any>;
  actions?: ActionCardButton[];
}

export interface ActionCardButton {
  label: string;
  route?: string;
  action?: string;
  style: 'primary' | 'warn' | 'accent';
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  actionCards?: ActionCard[];
  suggestedPrompts?: string[];
}

export interface AIContext {
  screen: string;
  clientId: string | null;
  clientName: string | null;
  loanId: string | null;
  savingsAccountId: string | null;
  actionName: string | null;
  userId: number | null;
  username: string | null;
  userRole: string | null;
  permissions: string[];
  officeId: number | null;
  officeName: string | null;
}
