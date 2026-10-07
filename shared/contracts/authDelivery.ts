import type { WorkspaceRole } from './workspace';

export type EmailVerificationDelivery = {
  email: string;
  displayName: string;
  token: string;
  expiresAt: number;
};

export type AccountLifecycleEventKind =
  | 'email_verified'
  | 'password_changed'
  | 'workspace_joined'
  | 'workspace_role_changed'
  | 'workspace_removed'
  | 'ownership_transferred'
  | 'ownership_received'
  | 'workspace_deleted'
  | 'account_deleted';

export type AccountLifecycleDelivery = {
  eventId: string;
  kind: AccountLifecycleEventKind;
  email: string;
  displayName: string;
  occurredAt: number;
  workspaceName?: string;
  previousRole?: WorkspaceRole;
  role?: WorkspaceRole;
};

export type PasswordResetDelivery = {
  email: string;
  displayName: string;
  token: string;
  expiresAt: number;
};

export type WorkspaceInvitationDelivery = {
  invitationId: string;
  email: string;
  workspaceName: string;
  role: Exclude<WorkspaceRole, 'owner'>;
  token: string;
  expiresAt: number;
};
