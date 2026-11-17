import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeInvitation, decodeMembership, decodeRevision, decodeSession, decodeUser, decodeWorkspace,
  type InvitationRow, type MembershipRow, type SessionRow, type UserRow,
} from '../worker/repositoryRows';

const userRow = (): UserRow => ({
  user_id: 'synthetic-user', email: 'Synthetic@example.test', email_normalized: 'synthetic@example.test',
  email_verified_at: null, display_name: 'Synthetic teacher', status: 'active',
  password_algorithm: 'PBKDF2-HMAC-SHA256', password_salt: 'synthetic-salt', password_hash: 'synthetic-hash',
  password_iterations: 100_000, created_at: 1, updated_at: 2, password_changed_at: 3,
});
const membershipRow = (): MembershipRow => ({
  workspace_id: 'synthetic-workspace', user_id: 'synthetic-user', role: 'teacher',
  created_at: 0, created_by_user_id: null,
});
const sessionRow = (): SessionRow => ({
  token_hash: 'synthetic-token-hash', user_id: 'synthetic-user', active_workspace_id: null,
  created_at: 0, expires_at: 10, last_seen_at: 0, revoked_at: null,
});
const invitationRow = (): InvitationRow => ({
  invitation_id: 'synthetic-invitation', token_hash: 'synthetic-token-hash', workspace_id: 'synthetic-workspace',
  email: 'Teacher@example.test', email_normalized: 'teacher@example.test', role: 'teacher',
  class_ids_json: '["B","A","A"," A "]', created_by_user_id: 'synthetic-owner',
  created_at: 0, expires_at: 10, accepted_at: null, accepted_by_user_id: null, revoked_at: null,
});

test('missing D1 rows retain the established empty workspace and nullable auth contracts', () => {
  const first = decodeWorkspace(null);
  const second = decodeWorkspace(null);
  assert.deepEqual(first, { revision: 0, updatedAt: 0, data: null });
  assert.notEqual(first, second, 'empty results must not share mutable metadata');
  assert.equal(decodeUser(null), null);
  assert.equal(decodeMembership(null), null);
  assert.equal(decodeSession(null), null);
});

test('workspace decoding parses exact stored JSON without normalizing identity, legacy fields or settings', () => {
  const data = { lastOpened: 0, currentClassId: 'A',
    classes: ['A', 'B'].map((id) => ({ id, name: `Synthetic ${id}`, students: [{
      id: '100', name: id === 'A' ? 'Synthetic Alice' : 'Synthetic Bob', points: 351,
      pet: { type: 'cat', level: 4, fullness: 72, happiness: 64 }, legacyExtension: { value: null },
    }] })), settings: { decayAmount: 0, decayType: 'daily',
      gameFeatures: { pets: false, battles: false, bosses: true, leaderboards: false } } };
  const row = Object.freeze({ revision: 7, updated_at: 0, data_json: JSON.stringify(data) });
  const decoded = decodeWorkspace(row);
  assert.deepEqual(decoded, { revision: 7, updatedAt: 0, data });
  assert.notEqual(decoded.data, data);
  assert.equal(JSON.parse(row.data_json).classes[1].students[0].name, 'Synthetic Bob');
  assert.throws(() => decodeWorkspace({ ...row, data_json: '{invalid' }), SyntaxError);
});

test('user decoding preserves every credential field and verification timestamps without modifying input', () => {
  const row = Object.freeze(userRow());
  assert.deepEqual(decodeUser(row), {
    id: row.user_id, email: row.email, normalizedEmail: row.email_normalized,
    emailVerifiedAt: null, displayName: row.display_name, status: 'active',
    password: { algorithm: row.password_algorithm, salt: row.password_salt,
      hash: row.password_hash, iterations: row.password_iterations },
    createdAt: 1, updatedAt: 2, passwordChangedAt: 3,
  });
  const legacy = decodeUser({ ...row, email_verified_at: 0, password_iterations: 1 });
  assert.equal(legacy?.emailVerifiedAt, 0);
  assert.equal(legacy?.password.iterations, 1, 'decoding must not rehash or upgrade credentials');
  const first = decodeUser(row)!;
  first.password.hash = 'synthetic-output-change';
  assert.equal(decodeUser(row)?.password.hash, 'synthetic-hash');
});

test('membership optional creator mapping preserves null-to-undefined and existing empty-string semantics', () => {
  const row = Object.freeze(membershipRow());
  assert.deepEqual(decodeMembership(row), { workspaceId: row.workspace_id, userId: row.user_id,
    role: 'teacher', createdAt: 0, createdByUserId: undefined });
  assert.equal(decodeMembership({ ...row, created_by_user_id: '' })?.createdByUserId, '');
  assert.equal(decodeMembership({ ...row, created_by_user_id: 'synthetic-owner' })?.createdByUserId, 'synthetic-owner');
});

test('sessions preserve nullable workspace and revocation fields rather than converting them to optional fields', () => {
  const row = Object.freeze(sessionRow());
  assert.deepEqual(decodeSession(row), { tokenHash: row.token_hash, userId: row.user_id,
    activeWorkspaceId: null, createdAt: 0, expiresAt: 10, lastSeenAt: 0, revokedAt: null });
  const exact = decodeSession({ ...row, active_workspace_id: '', revoked_at: 0 });
  assert.equal(exact?.activeWorkspaceId, '');
  assert.equal(exact?.revokedAt, 0);
});

test('revision metadata retains zero values and optional actor semantics without changing persisted byte counts', () => {
  const row = Object.freeze({ workspace_id: 'synthetic-workspace', revision: 0, updated_at: 0,
    actor_user_id: null, data_size_bytes: 0 });
  assert.deepEqual(decodeRevision(row), { workspaceId: row.workspace_id, revision: 0,
    updatedAt: 0, actorUserId: undefined, dataSizeBytes: 0 });
  assert.equal(decodeRevision({ ...row, actor_user_id: '' }).actorUserId, '');
  assert.equal(decodeRevision({ ...row, data_size_bytes: 901_234 }).dataSizeBytes, 901_234);
});

test('invitation decoding retains exact class scope and lifecycle fields instead of expanding or normalizing access', () => {
  const row = Object.freeze(invitationRow());
  assert.deepEqual(decodeInvitation(row), { id: row.invitation_id, tokenHash: row.token_hash,
    workspaceId: row.workspace_id, email: row.email, normalizedEmail: row.email_normalized,
    role: 'teacher', classIds: ['B', 'A', 'A', ' A '], createdByUserId: 'synthetic-owner',
    createdAt: 0, expiresAt: 10, acceptedAt: null, acceptedByUserId: undefined, revokedAt: null });
  const accepted = decodeInvitation({ ...row, accepted_at: 0, accepted_by_user_id: '', revoked_at: 0 });
  assert.equal(accepted.acceptedAt, 0);
  assert.equal(accepted.acceptedByUserId, '');
  assert.equal(accepted.revokedAt, 0);
  const decoded = decodeInvitation(row);
  decoded.classIds.push('synthetic-output-only');
  assert.deepEqual(decodeInvitation(row).classIds, ['B', 'A', 'A', ' A ']);
});

test('malformed stored invitation scope JSON still fails instead of becoming unscoped access', () => {
  assert.throws(() => decodeInvitation({ ...invitationRow(), class_ids_json: '{invalid' }), SyntaxError);
  assert.deepEqual(decodeInvitation({ ...invitationRow(), class_ids_json: '[]' }).classIds, []);
});
