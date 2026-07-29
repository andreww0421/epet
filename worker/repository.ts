import type { D1Database } from '@cloudflare/workers-types';
import type { AppData } from '../src/store/types';
import {
  WorkspaceConflictError,
  WorkspaceDataTooLargeError,
  type StoredWorkspace,
  type WorkspaceRepository,
} from '../server/contracts';

const MAX_D1_STATE_BYTES = 900 * 1024;

type WorkspaceRow = {
  revision: number;
  updated_at: number;
  data_json: string;
};

const emptyWorkspace = (): StoredWorkspace => ({
  revision: 0,
  updatedAt: 0,
  data: null,
});

const decodeWorkspace = (row: WorkspaceRow | null): StoredWorkspace => {
  if (!row) return emptyWorkspace();
  return {
    revision: row.revision,
    updatedAt: row.updated_at,
    data: JSON.parse(row.data_json) as AppData,
  };
};

export class D1WorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly database: D1Database) {}

  async get(workspaceId: string): Promise<StoredWorkspace> {
    const row = await this.database
      .prepare(
        `SELECT revision, updated_at, data_json
         FROM workspaces
         WHERE workspace_id = ?`,
      )
      .bind(workspaceId)
      .first<WorkspaceRow>();
    return decodeWorkspace(row);
  }

  async put(
    workspaceId: string,
    data: AppData,
    baseRevision?: number,
  ): Promise<StoredWorkspace> {
    const dataJson = JSON.stringify(data);
    if (new TextEncoder().encode(dataJson).byteLength > MAX_D1_STATE_BYTES) {
      throw new WorkspaceDataTooLargeError();
    }

    const current = await this.get(workspaceId);
    const expectedRevision = baseRevision ?? current.revision;
    if (
      !Number.isInteger(expectedRevision) ||
      expectedRevision !== current.revision
    ) {
      throw new WorkspaceConflictError(current);
    }

    const updatedAt = Date.now();
    if (current.revision === 0) {
      const inserted = await this.database
        .prepare(
          `INSERT OR IGNORE INTO workspaces
             (workspace_id, revision, updated_at, data_json)
           VALUES (?, 1, ?, ?)`,
        )
        .bind(workspaceId, updatedAt, dataJson)
        .run();
      if ((inserted.meta.changes ?? 0) !== 1) {
        throw new WorkspaceConflictError(await this.get(workspaceId));
      }
    } else {
      const updated = await this.database
        .prepare(
          `UPDATE workspaces
           SET revision = revision + 1, updated_at = ?, data_json = ?
           WHERE workspace_id = ? AND revision = ?`,
        )
        .bind(updatedAt, dataJson, workspaceId, expectedRevision)
        .run();
      if ((updated.meta.changes ?? 0) !== 1) {
        throw new WorkspaceConflictError(await this.get(workspaceId));
      }
    }

    return {
      revision: current.revision + 1,
      updatedAt,
      data,
    };
  }
}
