import assert from 'node:assert/strict';
import test from 'node:test';
import { validateStagingUrl } from '../../scripts/staging-target.mjs';

test('staging target accepts only the dedicated HTTPS Worker root', () => {
  const origin = 'https://epet-staging.school-account.workers.dev';
  assert.equal(validateStagingUrl(origin), origin);
  assert.equal(validateStagingUrl(`${origin}/`), origin);
});

test('staging target rejects production, arbitrary origins, and ambiguous URL metadata', () => {
  for (const invalid of [
    undefined,
    '',
    ' https://epet-staging.school-account.workers.dev',
    'https://epet-production.school-account.workers.dev',
    'https://epet-staging.school-account.workers.dev.attacker.invalid',
    'https://epet-staging.nested.school-account.workers.dev',
    'https://epet-staging.-invalid.workers.dev',
    'https://epet-staging.invalid-.workers.dev',
    'https://epet-staging.school_account.workers.dev',
    'https://localhost',
    'https://staging.example.com',
    'http://epet-staging.school-account.workers.dev',
    'https://epet-staging.school-account.workers.dev:8443',
    'https://user:secret@epet-staging.school-account.workers.dev',
    'https://epet-staging.school-account.workers.dev/login',
    'https://epet-staging.school-account.workers.dev?secret=hidden',
    'https://epet-staging.school-account.workers.dev#fragment',
    'https://epet-staging.school-account.workers.dev?',
    'https://epet-staging.school-account.workers.dev#',
    'https://@epet-staging.school-account.workers.dev',
    'https://epet-staging.school-account.workers.dev/path/../',
  ]) {
    assert.throws(() => validateStagingUrl(invalid), /STAGING_BASE_URL/);
  }
});

test('invalid URL errors do not expose credentials or query values', () => {
  for (const value of [
    'https://sensitive-user:sensitive-password@epet-staging.school-account.workers.dev',
    'https://epet-staging.school-account.workers.dev?secret=sensitive-value',
    'invalid-sensitive-value',
  ]) {
    assert.throws(() => validateStagingUrl(value), (error) =>
      error instanceof Error && !error.message.includes('sensitive'));
  }
});
