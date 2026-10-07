export const json = (
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
) => {
  const responseHeaders = new Headers(headers);
  if (!responseHeaders.has('cache-control')) {
    responseHeaders.set('cache-control', 'no-store');
  }
  return Response.json(body, { status, headers: responseHeaders });
};
