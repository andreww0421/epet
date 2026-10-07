import { mkdir, writeFile } from 'node:fs/promises';
import { createEpetServer } from '../../../server/app';
import type { WorkspaceInvitationDelivery } from '../../../server/auth';
import {
  E2E_BASE_URL,
  E2E_DIST_DIRECTORY,
  getE2eRuntimePaths,
  getE2eInvitationFile,
} from './paths';

const {
  directory: e2eRuntimeDirectory,
  dataFile: e2eDataFile,
  invitationOutboxDirectory,
  serverPidFile,
} = getE2eRuntimePaths();
// Refuse to reuse an existing directory, including an interrupted older run.
await mkdir(e2eRuntimeDirectory);
await mkdir(invitationOutboxDirectory);
await writeFile(serverPidFile, String(process.pid), { encoding: 'utf8', flag: 'wx' });

// Each fixture uses a unique recipient. Write one immutable delivery per file
// so Windows readers never race an atomic replacement of a shared outbox.
const captureInvitation = (delivery: WorkspaceInvitationDelivery) =>
  writeFile(getE2eInvitationFile(delivery.email), JSON.stringify(delivery), {
    encoding: 'utf8',
    flag: 'wx',
  });

const { server, repository } = createEpetServer({
  dataFile: e2eDataFile,
  distDirectory: E2E_DIST_DIRECTORY,
  botProtectionRequired: false,
  emailVerificationRequired: false,
  forgotResponseFloorMs: 0,
  registrationEnabled: true,
  workspaceInvitationMailer: captureInvitation,
});

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  server.close(() => process.exit(0));
  // Browser keep-alive sockets can otherwise leave Playwright's webServer
  // teardown waiting indefinitely after every assertion has completed.
  server.closeAllConnections();
};

process.once('SIGINT', stop);
process.once('SIGTERM', stop);

await repository.cleanupExpiredAuthData(Date.now());
server.listen(Number(new URL(E2E_BASE_URL).port), '127.0.0.1', () => {
  console.log(`ePet E2E server listening on ${E2E_BASE_URL}`);
});
