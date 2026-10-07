import type {
  AccountLifecycleDelivery,
  EmailVerificationDelivery,
  PasswordResetDelivery,
  WorkspaceInvitationDelivery,
} from '../../shared/contracts/authDelivery';
import type { BotChallengeVerification } from '../../shared/contracts/botChallenge';
import type { AuthServiceOptions } from '../auth';
import type { AuthRepository, WorkspaceRepository } from '../contracts';
import type { MonitoringReporter } from '../../shared/observability/policy';

export type { BotChallengeVerification } from '../../shared/contracts/botChallenge';

export type ApiOptions = {
  monitoringReporter?: MonitoringReporter;
  allowLocalWorkspaceIds?: boolean;
  allowedOrigins?: string[];
  auth?: AuthServiceOptions;
  accountLifecycleMailer?: (
    delivery: AccountLifecycleDelivery,
  ) => Promise<void>;
  botChallengeVerifier?: (
    input: BotChallengeVerification,
  ) => Promise<boolean>;
  botProtectionRequired?: boolean;
  clientIp?: (request: Request) => string | null | undefined;
  emailVerificationMailer?: (
    delivery: EmailVerificationDelivery,
  ) => Promise<void>;
  emailVerificationRequired?: boolean;
  passwordResetMailer?: (
    delivery: PasswordResetDelivery,
  ) => Promise<void>;
  workspaceInvitationMailer?: (
    delivery: WorkspaceInvitationDelivery,
  ) => Promise<void>;
  clientIdentity?: (request: Request) => string | null | undefined;
  deferBackgroundTask?: (task: Promise<void>) => void;
  forgotResponseFloorMs?: number;
  registrationEnabled?: boolean;
  turnstileSiteKey?: string;
  sessionCookieMaxAgeSeconds?: number;
};

export type ApiRepository = WorkspaceRepository & AuthRepository;
