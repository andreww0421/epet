import { rm } from 'node:fs/promises';
import { getE2eRuntimePaths } from './paths';

export default async function cleanupE2eRuntime() {
  // getE2eRuntimePaths accepts only a UUID and resolves one dedicated directory
  // under the OS temp root, never the repository or an arbitrary environment path.
  await rm(getE2eRuntimePaths().directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
