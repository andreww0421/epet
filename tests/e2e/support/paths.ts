import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

// Intentionally not configurable: fixture mutations must never target production.
export const E2E_BASE_URL = 'http://127.0.0.1:3100';

export const initializeE2eRun = () => {
  // Playwright propagates this identifier to its webServer and test workers.
  process.env.EPET_E2E_RUN_ID ??= randomUUID();
};

export const getE2eRuntimePaths = () => {
  const runId = process.env.EPET_E2E_RUN_ID;
  if (!runId || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runId)) {
    throw new Error('Start the isolated E2E server through npm run test:e2e');
  }
  // Only a UUID is accepted, never a user-provided path. Keep frequently
  // replaced JSON files outside OneDrive to avoid its transient file locks.
  const directory = resolve(tmpdir(), `epet-e2e-${runId}`);
  return {
    directory,
    dataFile: resolve(directory, 'runtime.json'),
    invitationOutboxDirectory: resolve(directory, 'invitations'),
  };
};

export const getE2eInvitationFile = (email: string) => {
  const recipientId = createHash('sha256')
    .update(email.trim().toLocaleLowerCase()).digest('hex');
  return resolve(getE2eRuntimePaths().invitationOutboxDirectory, `${recipientId}.json`);
};
