import assert from 'node:assert/strict';
import test from 'node:test';
import { configureAnalytics, type AnalyticsEvent } from '../src/analytics';
import { clearAuthentication, createWorkspace, registerAccount, loginAccount, acceptWorkspaceInvitation, BackendApiError } from '../src/services/backendApi';

const privateText = 'SYNTHETIC-WORKSPACE-EMAIL-STUDENT-SESSION-CSRF-PASSWORD';
const session = { activeWorkspaceId: privateText, user: { email: privateText }, workspaces: [{ id: privateText, name: privateText }] };

test('workspace creation tracks explicit and registration success only with exact original session/cookie contracts', async (t) => {
  const events: AnalyticsEvent[] = [];
  const stop = configureAnalytics({ enabled: true, environment: 'development', sink: (event) => { events.push(event); } });
  t.after(() => { stop(); clearAuthentication(); });
  const calls: RequestInit[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    calls.push(init!); return Response.json({ session, csrfToken: privateText });
  });
  assert.deepEqual(await registerAccount({ displayName: privateText, email: privateText, password: privateText }), session);
  assert.deepEqual(await createWorkspace(privateText), session);
  await loginAccount({ email: privateText, password: privateText });
  await acceptWorkspaceInvitation({ token: privateText, displayName: privateText, password: privateText });
  assert.deepEqual(events, [
    { name: 'workspace_created', metadata: { creation_source: 'registration' }, environment: 'development', schema_version: 1 },
    { name: 'workspace_created', metadata: { creation_source: 'explicit' }, environment: 'development', schema_version: 1 },
  ]);
  assert.equal(calls[1].credentials, 'same-origin');
  assert.equal(new Headers(calls[1].headers).get('x-csrf-token'), privateText);
  assert.ok(!JSON.stringify(events).includes(privateText));
});

test('failed workspace and registration calls emit no completed event and preserve original failures', async (t) => {
  const events: AnalyticsEvent[] = [];
  const stop = configureAnalytics({ enabled: true, environment: 'staging', sink: (event) => { events.push(event); } });
  t.after(() => { stop(); clearAuthentication(); });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: privateText }, { status: 503 }));
  await assert.rejects(createWorkspace(privateText), (error: unknown) => error instanceof BackendApiError && error.status === 503 && error.code === privateText);
  await assert.rejects(registerAccount({ displayName: privateText, email: privateText, password: privateText }), BackendApiError);
  assert.deepEqual(events, []);
});

test('a failing analytics adapter cannot turn a successful workspace creation into a product failure', async (t) => {
  const stop = configureAnalytics({ enabled: true, environment: 'production', sink: () => { throw new Error(privateText); } });
  t.after(() => { stop(); clearAuthentication(); });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ session }));
  assert.deepEqual(await createWorkspace(privateText), session);
});
