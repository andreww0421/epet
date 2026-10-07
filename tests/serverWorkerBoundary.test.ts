import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import type {
  AccountLifecycleDelivery,
  EmailVerificationDelivery,
  PasswordResetDelivery,
  WorkspaceInvitationDelivery,
} from '../shared/contracts/authDelivery';
import type {
  BotChallengeVerification,
} from '../shared/contracts/botChallenge';
import type { WorkspaceRole } from '../shared/contracts/workspace';
import {
  AUTH_RATE_LIMIT_RETENTION_MS,
  MAX_STORED_REVISIONS,
  clampAuditQueryLimit,
  createEmptyStoredWorkspace,
  jsonUtf8Size,
  utf8Size,
} from '../shared/domain/repositoryPolicy';
import {
  isValidWorkspaceId,
} from '../shared/domain/workspaceIdentifiers';
import {
  findPermanentlyDeletedStudentIds as findSharedDeletedStudents,
  purgeStudentsFromWorkspaceData as purgeSharedStudents,
} from '../shared/domain/studentPrivacy';
import {
  BASE_CONTENT_SECURITY_POLICY,
  createResponseSecurityHeaders,
  DEFAULT_PERMISSIONS_POLICY,
  DOCUMENT_CACHE_CONTROL,
  IMMUTABLE_ASSET_CACHE_CONTROL,
  PRIVATE_RESPONSE_CACHE_CONTROL,
  secureResponse,
  STRICT_TRANSPORT_SECURITY,
  TURNSTILE_CHALLENGE_ORIGIN,
} from '../shared/security/responsePolicy';
import {
  hashOpaqueToken as hashSharedOpaqueToken,
} from '../shared/security/tokens';
import {
  createAccountLifecycleMailer as createSharedAccountLifecycleMailer,
  createEmailVerificationMailer as createSharedEmailVerificationMailer,
  createPasswordResetMailer as createSharedPasswordResetMailer,
  createWorkspaceInvitationMailer as createSharedWorkspaceInvitationMailer,
} from '../shared/services/accountEmail';
import {
  createTurnstileVerifier as createSharedTurnstileVerifier,
} from '../shared/services/turnstile';
import {
  hashOpaqueToken as hashLegacyOpaqueToken,
  type AccountLifecycleDelivery as LegacyAccountLifecycleDelivery,
  type EmailVerificationDelivery as LegacyEmailVerificationDelivery,
  type PasswordResetDelivery as LegacyPasswordResetDelivery,
  type WorkspaceInvitationDelivery as LegacyWorkspaceInvitationDelivery,
} from '../server/auth';
import type {
  BotChallengeVerification as LegacyBotChallengeVerification,
} from '../server/contracts/api';
import type {
  WorkspaceRole as LegacyWorkspaceRole,
} from '../server/contracts';
import {
  findPermanentlyDeletedStudentIds as findLegacyDeletedStudents,
  purgeStudentsFromWorkspaceData as purgeLegacyStudents,
} from '../server/studentPrivacy';
import {
  createAccountLifecycleMailer as createLegacyAccountLifecycleMailer,
  createEmailVerificationMailer as createLegacyEmailVerificationMailer,
  createPasswordResetMailer as createLegacyPasswordResetMailer,
  createWorkspaceInvitationMailer as createLegacyWorkspaceInvitationMailer,
} from '../worker/passwordResetEmail';
import {
  createTurnstileVerifier as createLegacyTurnstileVerifier,
  type BotChallengeVerification as LegacyWorkerBotChallengeVerification,
} from '../worker/turnstile';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
    (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
        (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;

const contractCompatibility: [
  Equal<WorkspaceRole, LegacyWorkspaceRole>,
  Equal<BotChallengeVerification, LegacyBotChallengeVerification>,
  Equal<BotChallengeVerification, LegacyWorkerBotChallengeVerification>,
  Equal<EmailVerificationDelivery, LegacyEmailVerificationDelivery>,
  Equal<AccountLifecycleDelivery, LegacyAccountLifecycleDelivery>,
  Equal<PasswordResetDelivery, LegacyPasswordResetDelivery>,
  Equal<WorkspaceInvitationDelivery, LegacyWorkspaceInvitationDelivery>,
] = [true, true, true, true, true, true, true];

test('shared contracts stay type-compatible with established server imports', () => {
  assert.deepEqual(
    contractCompatibility,
    [true, true, true, true, true, true, true],
  );
});

test('legacy service and domain imports remain direct compatibility re-exports', () => {
  assert.equal(hashLegacyOpaqueToken, hashSharedOpaqueToken);
  assert.equal(createLegacyTurnstileVerifier, createSharedTurnstileVerifier);
  assert.equal(createLegacyPasswordResetMailer, createSharedPasswordResetMailer);
  assert.equal(
    createLegacyWorkspaceInvitationMailer,
    createSharedWorkspaceInvitationMailer,
  );
  assert.equal(
    createLegacyEmailVerificationMailer,
    createSharedEmailVerificationMailer,
  );
  assert.equal(
    createLegacyAccountLifecycleMailer,
    createSharedAccountLifecycleMailer,
  );
  assert.equal(findLegacyDeletedStudents, findSharedDeletedStudents);
  assert.equal(purgeLegacyStudents, purgeSharedStudents);
});

test('workspace identifiers retain distinct local and production policies', () => {
  const cloudWorkspaceId = `ws_${'a'.repeat(24)}`;

  assert.equal(isValidWorkspaceId('local_workspace-1', true), true);
  assert.equal(isValidWorkspaceId('local_workspace-1', false), false);
  assert.equal(isValidWorkspaceId(cloudWorkspaceId, false), true);
  assert.equal(isValidWorkspaceId(cloudWorkspaceId, true), true);
  assert.equal(isValidWorkspaceId('', true), false);
  assert.equal(isValidWorkspaceId('../workspace', true), false);
  assert.equal(isValidWorkspaceId(`ws_${'a'.repeat(23)}`, false), false);
});

test('shared repository policies preserve adapter-independent limits', () => {
  assert.equal(MAX_STORED_REVISIONS, 25);
  assert.equal(AUTH_RATE_LIMIT_RETENTION_MS, 24 * 60 * 60 * 1_000);
  assert.deepEqual(createEmptyStoredWorkspace(), {
    revision: 0,
    updatedAt: 0,
    data: null,
  });

  assert.equal(utf8Size('A🙂'), 5);
  assert.equal(
    jsonUtf8Size({ label: '學生' }),
    utf8Size(JSON.stringify({ label: '學生' })),
  );
  assert.equal(clampAuditQueryLimit(undefined), 50);
  assert.equal(clampAuditQueryLimit(0), 1);
  assert.equal(clampAuditQueryLimit(9.9), 9);
  assert.equal(clampAuditQueryLimit(1_000), 201);
});

test('response security policy preserves the Node document profile', () => {
  const headers = createResponseSecurityHeaders({ document: true });

  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('referrer-policy'), 'no-referrer');
  assert.equal(
    headers.get('permissions-policy'),
    DEFAULT_PERMISSIONS_POLICY,
  );
  assert.equal(headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(
    headers.get('content-security-policy'),
    BASE_CONTENT_SECURITY_POLICY,
  );
  assert.equal(headers.get('strict-transport-security'), null);
  assert.equal(headers.get('cross-origin-embedder-policy'), null);
  assert.match(
    BASE_CONTENT_SECURITY_POLICY,
    new RegExp(`script-src 'self' ${TURNSTILE_CHALLENGE_ORIGIN}`),
  );
  assert.match(
    BASE_CONTENT_SECURITY_POLICY,
    new RegExp(`frame-src ${TURNSTILE_CHALLENGE_ORIGIN}`),
  );
  assert.match(BASE_CONTENT_SECURITY_POLICY, /frame-ancestors 'none'/);
  assert.doesNotMatch(BASE_CONTENT_SECURITY_POLICY, /script-src[^;]*unsafe-/);
});

test('response security policy preserves the stricter Worker document profile', () => {
  const headers = createResponseSecurityHeaders({
    cacheControl: DOCUMENT_CACHE_CONTROL,
    document: true,
    strictTransportSecurity: true,
    upgradeInsecureRequests: true,
  });

  assert.equal(
    headers.get('permissions-policy'),
    DEFAULT_PERMISSIONS_POLICY,
  );
  assert.equal(
    headers.get('strict-transport-security'),
    STRICT_TRANSPORT_SECURITY,
  );
  assert.equal(
    headers.get('content-security-policy'),
    `${BASE_CONTENT_SECURITY_POLICY}; upgrade-insecure-requests`,
  );
  assert.equal(headers.get('cache-control'), DOCUMENT_CACHE_CONTROL);
});

test('secureResponse preserves response semantics while applying headers', async () => {
  const response = secureResponse(new Response('created', {
    status: 201,
    headers: {
      'content-type': 'text/plain',
      'x-content-type-options': 'unsafe-value',
      'x-request-id': 'request-1',
    },
  }), {
    cacheControl: PRIVATE_RESPONSE_CACHE_CONTROL,
    strictTransportSecurity: true,
  });

  assert.equal(response.status, 201);
  assert.equal(await response.text(), 'created');
  assert.equal(response.headers.get('content-type'), 'text/plain');
  assert.equal(response.headers.get('x-request-id'), 'request-1');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(
    response.headers.get('strict-transport-security'),
    STRICT_TRANSPORT_SECURITY,
  );
  assert.equal(
    response.headers.get('cache-control'),
    PRIVATE_RESPONSE_CACHE_CONTROL,
  );
});

test('cache profiles distinguish documents, private responses, and fingerprinted assets', () => {
  assert.equal(DOCUMENT_CACHE_CONTROL, 'no-cache');
  assert.equal(PRIVATE_RESPONSE_CACHE_CONTROL, 'no-store');
  assert.equal(
    IMMUTABLE_ASSET_CACHE_CONTROL,
    'public, max-age=31536000, immutable',
  );
});

test('server bootstrap no longer depends on Worker-owned service modules', async () => {
  const source = await readFile(join(process.cwd(), 'server/index.ts'), 'utf8');
  assert.doesNotMatch(source, /from ['"]\.\.\/worker\//);
});
