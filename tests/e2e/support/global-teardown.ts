import { readFile, rm } from 'node:fs/promises';
import { getE2eRuntimePaths } from './paths';

export default async function cleanupE2eRuntime() {
  const paths = getE2eRuntimePaths();
  const serverPid = Number(await readFile(paths.serverPidFile, 'utf8'));
  if (!Number.isSafeInteger(serverPid) || serverPid <= 0 || serverPid === process.pid) {
    throw new Error('Invalid isolated E2E server PID');
  }

  try {
    process.kill(serverPid, 'SIGTERM');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }

  let serverStopped = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      process.kill(serverPid, 0);
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        serverStopped = true;
        break;
      }
      throw error;
    }
  }
  if (!serverStopped) throw new Error('Timed out stopping isolated E2E server');

  // getE2eRuntimePaths accepts only a UUID and resolves one dedicated directory
  // under the OS temp root, never the repository or an arbitrary environment path.
  await rm(paths.directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
