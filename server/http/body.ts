import { WorkspaceDataTooLargeError } from '../contracts';

export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_AUTH_BODY_BYTES = 16 * 1024;

export const readJsonBody = async (
  request: Request,
  maximumBytes = MAX_BODY_BYTES,
) => {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new WorkspaceDataTooLargeError();
  }
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > maximumBytes) throw new WorkspaceDataTooLargeError();
  if (buffer.byteLength === 0) return {} as Record<string, unknown>;
  const parsed = JSON.parse(new TextDecoder().decode(buffer)) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
};

export const getString = (value: unknown) =>
  typeof value === 'string' ? value : '';
