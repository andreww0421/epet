export type TurnstileEnv = {
  TURNSTILE_SECRET_KEY?: string;
};

export type BotChallengeVerification = {
  token: string;
  action: string;
  remoteIp?: string;
  expectedHostname: string;
};

type SiteverifyResponse = {
  success?: boolean;
  hostname?: string;
  action?: string;
  'error-codes'?: string[];
};

const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export const createTurnstileVerifier = (env: TurnstileEnv) => {
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return undefined;

  return async (input: BotChallengeVerification) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          secret,
          response: input.token,
          ...(input.remoteIp ? { remoteip: input.remoteIp } : {}),
          idempotency_key: crypto.randomUUID(),
        }),
        signal: controller.signal,
      });
      if (!response.ok) return false;
      const result = await response.json() as SiteverifyResponse;
      return result.success === true &&
        result.action === input.action &&
        result.hostname === input.expectedHostname;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  };
};
