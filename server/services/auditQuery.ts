import type { AuditEventRecord, WorkspaceAuditQuery } from '../contracts';

export const getAuditQuery = (url: URL): WorkspaceAuditQuery | null => {
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit == null ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return null;

  const readText = (name: string, maximumLength: number) => {
    const raw = url.searchParams.get(name);
    if (raw == null) return { valid: true, value: undefined };
    const value = raw.trim();
    return value && value.length <= maximumLength
      ? { valid: true, value }
      : { valid: false, value: undefined };
  };
  const action = readText('action', 120);
  const actorUserId = readText('actorUserId', 128);
  const targetType = readText('targetType', 80);
  if (!action.valid || !actorUserId.valid || !targetType.valid) return null;

  const readTimestamp = (name: string) => {
    const raw = url.searchParams.get(name);
    if (raw == null) return { valid: true, value: undefined };
    if (!/^\d{1,16}$/.test(raw)) {
      return { valid: false, value: undefined };
    }
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= 0
      ? { valid: true, value }
      : { valid: false, value: undefined };
  };
  const from = readTimestamp('from');
  const to = readTimestamp('to');
  if (
    !from.valid ||
    !to.valid ||
    (from.value != null && to.value != null && from.value > to.value)
  ) return null;

  const rawCursor = url.searchParams.get('cursor');
  let cursor: WorkspaceAuditQuery['cursor'];
  if (rawCursor != null) {
    const separator = rawCursor.indexOf(':');
    const createdAtText = rawCursor.slice(0, separator);
    const id = rawCursor.slice(separator + 1);
    if (
      separator <= 0 ||
      !/^\d{1,16}$/.test(createdAtText) ||
      !id ||
      id.length > 256
    ) return null;
    const createdAt = Number(createdAtText);
    if (!Number.isSafeInteger(createdAt) || createdAt < 0) return null;
    cursor = { createdAt, id };
  }

  return {
    limit,
    ...(cursor ? { cursor } : {}),
    ...(action.value ? { action: action.value } : {}),
    ...(actorUserId.value ? { actorUserId: actorUserId.value } : {}),
    ...(targetType.value ? { targetType: targetType.value } : {}),
    ...(from.value != null ? { fromCreatedAt: from.value } : {}),
    ...(to.value != null ? { toCreatedAt: to.value } : {}),
  };
};

const SENSITIVE_AUDIT_METADATA_KEY =
  /token|password|secret|authorization|cookie|credential|session/i;

const sanitizeAuditMetadataValue = (value: unknown, depth = 0): unknown => {
  if (depth >= 5) return '[depth-limited]';
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) =>
      sanitizeAuditMetadataValue(item, depth + 1)
    );
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SENSITIVE_AUDIT_METADATA_KEY.test(key))
        .slice(0, 100)
        .map(([key, item]) => [
          key,
          sanitizeAuditMetadataValue(item, depth + 1),
        ]),
    );
  }
  return typeof value === 'string' ? value.slice(0, 2_000) : value;
};

export const auditEventForResponse = (
  event: AuditEventRecord,
): AuditEventRecord => {
  const { metadata, ...record } = event;
  if (!metadata) return record;
  const safeMetadata = sanitizeAuditMetadataValue(metadata);
  return safeMetadata && typeof safeMetadata === 'object'
    ? { ...record, metadata: safeMetadata as Record<string, unknown> }
    : record;
};
