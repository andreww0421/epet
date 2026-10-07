export const MAX_STORED_REVISIONS = 25;
export const AUTH_RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1_000;

export const createEmptyStoredWorkspace = () => ({
  revision: 0,
  updatedAt: 0,
  data: null,
});

export const utf8Size = (value: string) =>
  new TextEncoder().encode(value).byteLength;

export const jsonUtf8Size = (value: unknown) => {
  const serialized = JSON.stringify(value);
  return utf8Size(serialized ?? '');
};

export const clampAuditQueryLimit = (limit: number | undefined) =>
  Math.max(1, Math.min(201, Math.floor(limit ?? 50)));
