import type { AppData } from '../src/store/types';

export type StoredWorkspace = {
  revision: number;
  updatedAt: number;
  data: AppData | null;
};

export interface WorkspaceRepository {
  get(workspaceId: string): Promise<StoredWorkspace>;
  put(
    workspaceId: string,
    data: AppData,
    baseRevision?: number,
  ): Promise<StoredWorkspace>;
}

export class WorkspaceConflictError extends Error {
  constructor(readonly current: StoredWorkspace) {
    super('Workspace revision conflict');
  }
}

export class WorkspaceDataTooLargeError extends Error {
  constructor() {
    super('Workspace data is too large');
  }
}
