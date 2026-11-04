import assert from 'node:assert/strict';
import test from 'node:test';
import type { ApiOptions, ApiRepository, BotChallengeVerification } from '../server/contracts/api';
import { createApiRuntime } from '../server/services/apiRuntime';
import { BotChallengeFailedError, BotProtectionUnavailableError } from '../server/services/botProtection';
import { createTurnstileVerifier } from '../shared/services/turnstile';

const challenge: BotChallengeVerification = {
  token: 'synthetic-turnstile-token',
  action: 'login',
  expectedHostname: 'teacher.example.test',
};

const challengeRuntime = (options: ApiOptions) => createApiRuntime(
  new Proxy({} as ApiRepository, {
    get(_target, property) {
      throw new Error(`Challenge validation unexpectedly accessed repository: ${String(property)}`);
    },
  }),
  options,
);

test('Turnstile rejects provider failures and malformed responses and clears every timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const signals: AbortSignal[] = [];
  let providerResponse = async (): Promise<Response> => Response.json({ success: false });
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    assert.ok(init?.signal);
    signals.push(init.signal);
    return providerResponse();
  });
  const verifier = createTurnstileVerifier({ TURNSTILE_SECRET_KEY: 'synthetic-secret' });
  assert.ok(verifier);

  const scenarios: Array<{ name: string; respond: () => Promise<Response> }> = [
    { name: 'unsuccessful status', respond: async () => new Response(null, { status: 503 }) },
    { name: 'invalid JSON', respond: async () => new Response('{malformed') },
    { name: 'null JSON', respond: async () => Response.json(null) },
    { name: 'missing success', respond: async () => Response.json({ action: challenge.action, hostname: challenge.expectedHostname }) },
    { name: 'false success', respond: async () => Response.json({ success: false, action: challenge.action, hostname: challenge.expectedHostname }) },
    { name: 'non-boolean success', respond: async () => Response.json({ success: 'true', action: challenge.action, hostname: challenge.expectedHostname }) },
    { name: 'transport rejection', respond: async () => { throw new Error('Synthetic provider transport failure'); } },
  ];
  for (const scenario of scenarios) {
    providerResponse = scenario.respond;
    assert.equal(await verifier(challenge), false, scenario.name);
  }

  providerResponse = async () => Response.json({
    success: true,
    action: challenge.action,
    hostname: challenge.expectedHostname,
  });
  assert.equal(await verifier(challenge), true);
  t.mock.timers.tick(5_000);
  assert.equal(signals.length, scenarios.length + 1);
  assert.ok(signals.every((signal) => !signal.aborted), 'Completed requests must cancel their abort timer');
});

test('Turnstile aborts a stalled provider request at five seconds and fails closed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let requestSignal: AbortSignal | undefined;
  let abortCount = 0;
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    assert.ok(init?.signal);
    requestSignal = init.signal;
    return new Promise<Response>((_resolve, reject) => {
      requestSignal!.addEventListener('abort', () => {
        abortCount += 1;
        reject(new DOMException('Synthetic timeout', 'AbortError'));
      }, { once: true });
    });
  });
  const verifier = createTurnstileVerifier({ TURNSTILE_SECRET_KEY: 'synthetic-secret' });
  assert.ok(verifier);
  const pending = verifier(challenge);
  assert.ok(requestSignal);
  t.mock.timers.tick(4_999);
  assert.equal(requestSignal.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(await pending, false);
  assert.equal(requestSignal.aborted, true);
  assert.equal(abortCount, 1);
  t.mock.timers.tick(5_000);
  assert.equal(abortCount, 1);
});

test('API challenge validation accepts 2048 characters and rejects missing or oversized tokens before verification', async () => {
  const checks: BotChallengeVerification[] = [];
  const runtime = challengeRuntime({
    botProtectionRequired: true,
    botChallengeVerifier: async (input) => { checks.push(input); return true; },
    turnstileSiteKey: 'synthetic-site-key',
    clientIp: () => ' 198.51.100.45 ',
  });
  const request = new Request('https://teacher.example.test/api/v1/auth/login');
  const longestToken = 't'.repeat(2_048);
  await runtime.verifyBotChallenge(request, { turnstileToken: longestToken }, 'login');
  assert.deepEqual(checks, [{
    token: longestToken,
    action: 'login',
    expectedHostname: 'teacher.example.test',
    remoteIp: '198.51.100.45',
  }]);

  for (const action of ['register', 'login', 'forgot'] as const) {
    for (const body of [{}, { turnstileToken: '' }, { turnstileToken: null }, { turnstileToken: 42 }, { turnstileToken: 't'.repeat(2_049) }]) {
      await assert.rejects(runtime.verifyBotChallenge(request, body, action), BotChallengeFailedError);
    }
  }
  assert.equal(checks.length, 1, 'Invalid tokens must never reach the verifier');
});

test('required bot protection disables authentication and registration when verifier or site key is unavailable', async () => {
  let checks = 0;
  const options: ApiOptions = {
    botProtectionRequired: true,
    botChallengeVerifier: async () => { checks += 1; return true; },
    turnstileSiteKey: 'synthetic-site-key',
    registrationEnabled: true,
  };
  const request = new Request('https://teacher.example.test/api/v1/auth/login');
  for (const unavailable of [
    { botChallengeVerifier: undefined },
    { turnstileSiteKey: undefined },
    { turnstileSiteKey: '' },
    { turnstileSiteKey: '   ' },
  ]) {
    const runtime = challengeRuntime({ ...options, ...unavailable });
    assert.equal(runtime.botProtectionEnabled, false);
    assert.equal(runtime.authenticationEnabled, false);
    assert.equal(runtime.registrationEnabled, false);
    for (const action of ['register', 'login', 'forgot'] as const) {
      await assert.rejects(runtime.verifyBotChallenge(request, {
        turnstileToken: challenge.token,
      }, action), BotProtectionUnavailableError);
    }
  }
  assert.equal(checks, 0);
});

test('API challenge validation converts a verifier denial into the established challenge error', async () => {
  const runtime = challengeRuntime({
    botProtectionRequired: true,
    botChallengeVerifier: async () => false,
    turnstileSiteKey: 'synthetic-site-key',
  });
  await assert.rejects(runtime.verifyBotChallenge(
    new Request('https://teacher.example.test/api/v1/auth/login'),
    { turnstileToken: challenge.token },
    'login',
  ), BotChallengeFailedError);
});
