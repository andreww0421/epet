import {
  AuthForbiddenError,
  AuthValidationError,
  EmailVerificationRequiredError,
  InvalidCredentialsError,
  InvalidEmailVerificationTokenError,
  InvalidPasswordResetTokenError,
  InvalidSessionError,
} from '../auth';
import {
  EmailAlreadyExistsError,
  InvalidWorkspaceInvitationError,
  WorkspaceAlreadyClaimedError,
  WorkspaceConflictError,
  WorkspaceDataTooLargeError,
  WorkspaceMembershipNotFoundError,
  WorkspaceNotFoundError,
  WorkspaceOwnerTransferRequiredError,
  WorkspaceOwnershipConflictError,
} from '../contracts';
import { json } from '../http/response';
import { WorkspaceValidationError } from '../../shared/validation/workspaceValidation';
import {
  BotChallengeFailedError,
  BotProtectionUnavailableError,
} from '../services/botProtection';
import { WorkspaceScopeViolationError } from '../workspaceScope';
import { withClearedAuthCookies } from './authentication';
import { InvalidCsrfError } from './csrf';

export const errorResponse = (
  error: unknown,
  headers: HeadersInit = {},
) => {
  if (error instanceof WorkspaceConflictError) {
    // Repository snapshots are unscoped. Only an explicitly authorized route
    // may return one; the shared fallback must never serialize workspace data.
    return json(
      {
        error: 'REVISION_CONFLICT',
        revision: error.current.revision,
        updatedAt: error.current.updatedAt,
      },
      409,
      headers,
    );
  }
  if (error instanceof WorkspaceDataTooLargeError) {
    // Limits are public policy. The rejected (possibly merged, unscoped)
    // snapshot size and contents must never be included in this response.
    const limit = Number.isSafeInteger(error.limitBytes) && Number(error.limitBytes) > 0 &&
      (error.limitKind === 'workspace_snapshot' || error.limitKind === 'request_body')
      ? { limitBytes: error.limitBytes, limitKind: error.limitKind }
      : {};
    return json({ error: 'PAYLOAD_TOO_LARGE', ...limit }, 413, headers);
  }
  if (error instanceof WorkspaceValidationError) {
    return json({ error: 'INVALID_APP_DATA' }, 400, headers);
  }
  if (error instanceof WorkspaceOwnershipConflictError) {
    return json({ error: 'OWNERSHIP_CONFLICT' }, 409, headers);
  }
  if (error instanceof AuthValidationError) {
    return json({ error: error.code }, 400, headers);
  }
  if (error instanceof InvalidCredentialsError) {
    return json({ error: 'INVALID_CREDENTIALS' }, 401, headers);
  }
  if (error instanceof InvalidSessionError) {
    return json(
      { error: 'INVALID_SESSION' },
      401,
      withClearedAuthCookies(headers),
    );
  }
  if (error instanceof InvalidCsrfError) {
    return json({ error: 'CSRF_INVALID' }, 403, headers);
  }
  if (error instanceof BotChallengeFailedError) {
    return json({ error: 'BOT_CHALLENGE_FAILED' }, 403, headers);
  }
  if (error instanceof BotProtectionUnavailableError) {
    return json({ error: 'BOT_PROTECTION_UNAVAILABLE' }, 503, headers);
  }
  if (error instanceof EmailVerificationRequiredError) {
    return json(
      { error: 'EMAIL_VERIFICATION_REQUIRED' },
      403,
      headers,
    );
  }
  if (error instanceof AuthForbiddenError) {
    return json({ error: 'FORBIDDEN' }, 403, headers);
  }
  if (error instanceof WorkspaceScopeViolationError) {
    return json({ error: error.code }, 403, headers);
  }
  if (error instanceof InvalidPasswordResetTokenError) {
    return json(
      { error: 'INVALID_PASSWORD_RESET_TOKEN' },
      400,
      headers,
    );
  }
  if (error instanceof InvalidEmailVerificationTokenError) {
    return json(
      { error: 'INVALID_EMAIL_VERIFICATION_TOKEN' },
      400,
      headers,
    );
  }
  if (error instanceof EmailAlreadyExistsError) {
    return json(
      { error: 'EMAIL_ALREADY_EXISTS' },
      409,
      headers,
    );
  }
  if (error instanceof WorkspaceNotFoundError) {
    return json({ error: 'WORKSPACE_NOT_FOUND' }, 404, headers);
  }
  if (error instanceof WorkspaceAlreadyClaimedError) {
    return json(
      { error: 'WORKSPACE_ALREADY_CLAIMED' },
      409,
      headers,
    );
  }
  if (error instanceof WorkspaceMembershipNotFoundError) {
    return json({ error: 'MEMBERSHIP_NOT_FOUND' }, 404, headers);
  }
  if (error instanceof WorkspaceOwnerTransferRequiredError) {
    return json({ error: 'OWNER_TRANSFER_REQUIRED' }, 409, headers);
  }
  if (error instanceof InvalidWorkspaceInvitationError) {
    return json({ error: 'INVALID_WORKSPACE_INVITATION' }, 400, headers);
  }
  if (error instanceof SyntaxError) {
    return json({ error: 'INVALID_JSON' }, 400, headers);
  }
  console.error('API request failed');
  return json({ error: 'INTERNAL_ERROR' }, 500, headers);
};
