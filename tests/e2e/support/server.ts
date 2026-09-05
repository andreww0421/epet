import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createEpetServer } from '../../../server/app';
import type { WorkspaceInvitationDelivery } from '../../../server/auth';
import {
  E2E_BASE_URL,
  getE2eRuntimePaths,
  getE2eInvitationFile,
} from './paths';

const projectRoot = resolve(process.cwd());
const {
  directory: e2eRuntimeDirectory,
  dataFile: e2eDataFile,
  invitationOutboxDirectory,
} = getE2eRuntimePaths();
// Refuse to reuse an existing directory, including an interrupted older run.
await mkdir(e2eRuntimeDirectory);
await mkdir(invitationOutboxDirectory);

// Each fixture uses a unique recipient. Write one immutable delivery per file
// so Windows readers never race an atomic replacement of a shared outbox.
const captureInvitation = (delivery: WorkspaceInvitationDelivery) =>
  writeFile(getE2eInvitationFile(delivery.email), JSON.stringify(delivery), {
    encoding: 'utf8',
    flag: 'wx',
  });

const { server, repository } = createEpetServer({
  dataFile: e2eDataFile,
  distDirectory: resolve(projectRoot, 'dist'),
  botProtectionRequired: false,
  emailVerificationRequired: false,
  forgotResponseFloorMs: 0,
  registrationEnabled: true,
  workspaceInvitationMailer: captureInvitation,
});

const stop = () => {
  server.close(() => process.exit(0));
};

process.once('SIGINT', stop);
process.once('SIGTERM', stop);

await repository.cleanupExpiredAuthData(Date.now());
server.listen(Number(new URL(E2E_BASE_URL).port), '127.0.0.1', () => {
  console.log(`ePet E2E server listening on ${E2E_BASE_URL}`);
});
