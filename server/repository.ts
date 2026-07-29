import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AppData } from '../src/store/types';
import {
  WorkspaceConflictError,
  type StoredWorkspace,
  type WorkspaceRepository,
} from './contracts';

type DatabaseFile = {
  version: 1;
  workspaces: Record<string, StoredWorkspace>;
};

const EMPTY_DATABASE: DatabaseFile = {
  version: 1,
  workspaces: {},
};

export class JsonWorkspaceRepository implements WorkspaceRepository {
  private database: DatabaseFile | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private async load() {
    if (this.database) return this.database;
    try {
      const raw = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<DatabaseFile>;
      this.database = {
        version: 1,
        workspaces:
          raw.workspaces && typeof raw.workspaces === 'object'
            ? raw.workspaces as Record<string, StoredWorkspace>
            : {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.database = structuredClone(EMPTY_DATABASE);
    }
    return this.database;
  }

  private async persist(database: DatabaseFile) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(database, null, 2), 'utf8');
    await rename(temporaryPath, this.filePath);
  }

  async get(workspaceId: string): Promise<StoredWorkspace> {
    await this.mutationQueue;
    const database = await this.load();
    return structuredClone(database.workspaces[workspaceId] ?? {
      revision: 0,
      updatedAt: 0,
      data: null,
    });
  }

  async put(
    workspaceId: string,
    data: AppData,
    baseRevision?: number,
  ): Promise<StoredWorkspace> {
    const operation = this.mutationQueue.then(async () => {
      const database = await this.load();
      const current = database.workspaces[workspaceId] ?? {
        revision: 0,
        updatedAt: 0,
        data: null,
      };
      if (
        baseRevision != null &&
        Number.isInteger(baseRevision) &&
        baseRevision !== current.revision
      ) {
        throw new WorkspaceConflictError(structuredClone(current));
      }
      const next: StoredWorkspace = {
        revision: current.revision + 1,
        updatedAt: Date.now(),
        data: structuredClone(data),
      };
      database.workspaces[workspaceId] = next;
      await this.persist(database);
      return structuredClone(next);
    });
    this.mutationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
}
