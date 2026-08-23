import { resolve } from 'node:path';
import { createEpetServer } from './app';
import {
  createAccountLifecycleMailer,
  createEmailVerificationMailer,
  createPasswordResetMailer,
  createWorkspaceInvitationMailer,
} from '../worker/passwordResetEmail';
import { createTurnstileVerifier } from '../worker/turnstile';

const port = Math.max(1, Number(process.env.PORT) || 8787);
const dataFile = resolve(
  process.env.EPET_DATA_FILE || 'server/data/epet-runtime.json',
);
const distDirectory = resolve(process.env.EPET_DIST_DIR || 'dist');
const emailEnvironment = {
  PASSWORD_RESET_FROM: process.env.PASSWORD_RESET_FROM,
  PUBLIC_APP_URL: process.env.PUBLIC_APP_URL,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
};
const { server, repository } = createEpetServer({
  dataFile,
  distDirectory,
  accountLifecycleMailer: createAccountLifecycleMailer(emailEnvironment),
  botChallengeVerifier: createTurnstileVerifier(emailEnvironment),
  botProtectionRequired: process.env.BOT_PROTECTION_REQUIRED === 'true',
  emailVerificationMailer: createEmailVerificationMailer(emailEnvironment),
  emailVerificationRequired:
    process.env.EMAIL_VERIFICATION_REQUIRED === 'true',
  passwordResetMailer: createPasswordResetMailer(emailEnvironment),
  workspaceInvitationMailer: createWorkspaceInvitationMailer(emailEnvironment),
  registrationEnabled: process.env.REGISTRATION_ENABLED === 'true',
  turnstileSiteKey: process.env.TURNSTILE_SITE_KEY,
});

const cleanupExpiredAuthenticationData = () => {
  void repository.cleanupExpiredAuthData(Date.now()).catch((error: unknown) => {
    console.error('Expired authentication data cleanup failed', error);
  });
};
cleanupExpiredAuthenticationData();
setInterval(cleanupExpiredAuthenticationData, 24 * 60 * 60 * 1_000).unref();

server.listen(port, '0.0.0.0', () => {
  console.log(`ePet API listening on http://127.0.0.1:${port}`);
});
