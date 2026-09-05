import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import type { AppData, ClassData } from '../../../src/store/types';
import type { WorkspaceRole } from '../../../server/contracts';
import type { WorkspaceInvitationDelivery } from '../../../server/auth';
import { getE2eInvitationFile, E2E_BASE_URL } from './paths';

export { E2E_BASE_URL } from './paths';
export const E2E_PASSWORD = 'E2E-safe-password-2026!';

export type TestAccount = {
  displayName: string;
  email: string;
  password: string;
};

type SessionView = {
  user: {
    id: string;
    email: string;
    displayName: string;
    role: WorkspaceRole;
    emailVerified: boolean;
  };
  workspaces: Array<{
    id: string;
    name: string;
    role: WorkspaceRole;
  }>;
  activeWorkspaceId: string | null;
};

type AuthEnvelope = {
  csrfToken: string;
  session: SessionView;
};

export type StateSnapshot = {
  data: AppData | null;
  revision: number;
  updatedAt: number;
};

const authCookiePattern =
  /(__Host-epet_(?:session|csrf)=[A-Za-z0-9_-]+)/g;

const cookiesFrom = (response: APIResponse) => {
  const headerText = response.headersArray()
    .filter((header) => header.name.toLocaleLowerCase() === 'set-cookie')
    .map((header) => header.value)
    .join(',');
  return [...headerText.matchAll(authCookiePattern)]
    .map((match) => match[1])
    .join('; ');
};

const parseResponse = async <T>(response: APIResponse): Promise<T> => {
  const body = await response.json() as T;
  return body;
};

export const testAccount = (prefix: string): TestAccount => ({
  displayName: `E2E ${prefix}`,
  email: `${prefix.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomUUID().slice(0, 8)}@example.test`,
  password: E2E_PASSWORD,
});

export class E2eApiSession {
  private constructor(
    readonly context: APIRequestContext,
    readonly account: TestAccount,
    readonly csrfToken: string,
    readonly cookie: string,
    readonly session: SessionView,
  ) {}

  static async register(account: TestAccount) {
    const context = await playwrightRequest.newContext({
      baseURL: E2E_BASE_URL,
    });
    const response = await context.post('/api/v1/auth/register', {
      data: {
        displayName: account.displayName,
        email: account.email,
        password: account.password,
      },
      headers: { origin: E2E_BASE_URL },
    });
    expect(response.status()).toBe(201);
    const body = await parseResponse<AuthEnvelope>(response);
    const cookie = cookiesFrom(response);
    expect(cookie.includes('__Host-epet_session=')).toBe(true);
    expect(cookie.includes('__Host-epet_csrf=')).toBe(true);
    return new E2eApiSession(
      context,
      account,
      body.csrfToken,
      cookie,
      body.session,
    );
  }

  static async login(account: TestAccount) {
    const context = await playwrightRequest.newContext({
      baseURL: E2E_BASE_URL,
    });
    const response = await context.post('/api/v1/auth/login', {
      data: { email: account.email, password: account.password },
      headers: { origin: E2E_BASE_URL },
    });
    expect(response.status()).toBe(200);
    const body = await parseResponse<AuthEnvelope>(response);
    return new E2eApiSession(
      context,
      account,
      body.csrfToken,
      cookiesFrom(response),
      body.session,
    );
  }

  static async acceptInvitation(
    account: TestAccount,
    invitationToken: string,
  ) {
    const context = await playwrightRequest.newContext({
      baseURL: E2E_BASE_URL,
    });
    const response = await context.post('/api/v1/auth/invitations/accept', {
      data: {
        token: invitationToken,
        displayName: account.displayName,
        password: account.password,
      },
      headers: { origin: E2E_BASE_URL },
    });
    expect(response.status()).toBe(201);
    const body = await parseResponse<AuthEnvelope>(response);
    return new E2eApiSession(
      context,
      account,
      body.csrfToken,
      cookiesFrom(response),
      body.session,
    );
  }

  private headers(workspaceId?: string, mutation = false) {
    return {
      cookie: this.cookie,
      origin: E2E_BASE_URL,
      ...(mutation ? { 'x-csrf-token': this.csrfToken } : {}),
      ...(workspaceId ? { 'x-epet-workspace': workspaceId } : {}),
    };
  }

  async loadState(workspaceId = this.session.activeWorkspaceId) {
    if (!workspaceId) throw new Error('An active E2E workspace is required');
    const response = await this.context.get('/api/v1/state', {
      headers: this.headers(workspaceId),
    });
    expect(response.status()).toBe(200);
    return parseResponse<StateSnapshot>(response);
  }

  async saveState(
    data: AppData,
    baseRevision: number,
    workspaceId = this.session.activeWorkspaceId,
  ) {
    if (!workspaceId) throw new Error('An active E2E workspace is required');
    const response = await this.context.put('/api/v1/state', {
      data: { data, baseRevision },
      headers: this.headers(workspaceId, true),
    });
    expect(response.status()).toBe(200);
    return parseResponse<StateSnapshot>(response);
  }

  async createWorkspace(name: string) {
    const response = await this.context.post('/api/v1/workspaces', {
      data: { name },
      headers: this.headers(undefined, true),
    });
    expect(response.status()).toBe(201);
    return parseResponse<{ session: SessionView }>(response);
  }

  async invite(
    workspaceId: string,
    input: {
      email: string;
      role: Exclude<WorkspaceRole, 'owner'>;
      classIds: string[];
    },
  ) {
    const response = await this.context.post('/api/v1/invitations', {
      data: input,
      headers: this.headers(workspaceId, true),
    });
    expect(response.status()).toBe(202);
  }

  async removeMember(workspaceId: string, userId: string) {
    const response = await this.context.delete(
      `/api/v1/members/${encodeURIComponent(userId)}`,
      { headers: this.headers(workspaceId, true) },
    );
    expect(response.status()).toBe(200);
  }

  async dispose() {
    await this.context.dispose();
  }
}

export const readInvitation = async (email: string) => {
  const normalizedEmail = email.trim().toLocaleLowerCase();
  let delivery: WorkspaceInvitationDelivery | undefined;
  await expect.poll(async () => {
    try {
      delivery = JSON.parse(
        await readFile(getE2eInvitationFile(normalizedEmail), 'utf8'),
      ) as WorkspaceInvitationDelivery;
      return Boolean(delivery?.token);
    } catch {
      return false;
    }
  }).toBe(true);
  if (!delivery) throw new Error('Invitation delivery was not captured');
  return delivery;
};

export const inviteAccount = async (
  owner: E2eApiSession,
  workspaceId: string,
  account: TestAccount,
  role: Exclude<WorkspaceRole, 'owner'>,
  classIds: string[],
) => {
  await owner.invite(workspaceId, {
    email: account.email,
    role,
    classIds,
  });
  const invitation = await readInvitation(account.email);
  return E2eApiSession.acceptInvitation(account, invitation.token);
};

export const addIsolatedClass = async (
  owner: E2eApiSession,
  workspaceId: string,
  name: string,
) => {
  const snapshot = await owner.loadState(workspaceId);
  if (!snapshot.data || !snapshot.data.classes[0]) {
    throw new Error('E2E workspace is missing its default class');
  }
  const source = snapshot.data.classes[0];
  const isolatedClass: ClassData = {
    ...structuredClone(source),
    id: `class-${randomUUID()}`,
    name,
    students: [],
    classGoals: [],
    learningEvidenceRecords: [],
    examRecords: [],
    activeBoss: undefined,
  };
  const data: AppData = {
    ...snapshot.data,
    classes: [...snapshot.data.classes, isolatedClass],
  };
  await owner.saveState(data, snapshot.revision, workspaceId);
  return isolatedClass;
};

export const loginViaUi = async (page: Page, account: TestAccount) => {
  await page.goto('/#/login');
  await page.locator('#auth-email').fill(account.email);
  await page.locator('#auth-password').fill(account.password);
  await page.getByRole('button', { name: '登入並繼續帶班' }).click();
  await expect(page.getByRole('button', { name: '登出' })).toBeVisible();
  await page.getByRole('button', { name: '導師控制台', exact: true }).click();
  await expect(page.getByRole('heading', { name: '導師控制台' })).toBeVisible();
  await waitForBackendSync(page);
};

export const waitForBackendSync = async (page: Page) => {
  await expect(page.locator('[title="後端已同步"]')).toBeVisible({
    timeout: 15_000,
  });
};

// The connected badge remains visible during the debounce interval. Wait for
// the actual write before treating a UI mutation as durable.
export const performSyncedAction = async (
  page: Page,
  action: () => Promise<unknown>,
) => {
  const saved = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/v1/state' &&
    response.request().method() === 'PUT',
  );
  const [response] = await Promise.all([saved, action()]);
  expect(response.status()).toBe(200);
  await waitForBackendSync(page);
};

export const selectDashboardTab = async (page: Page, name: string) => {
  await page.getByRole('tab', { name, exact: true }).click();
};

export const switchWorkspaceViaUi = async (page: Page, workspaceId: string) => {
  const select = page.getByRole('combobox', { name: '工作區', exact: true });
  const loading = page.waitForResponse((response) =>
    response.url().endsWith('/api/v1/state') &&
    response.request().method() === 'GET' &&
    response.request().headers()['x-epet-workspace'] === workspaceId,
  );
  await select.selectOption(workspaceId);
  expect((await loading).status()).toBe(200);
  await waitForBackendSync(page);
  await expect(select).toHaveValue(workspaceId);
};

export const addClassViaUi = async (page: Page, name: string) => {
  await selectDashboardTab(page, '學生');
  await page.getByRole('button', { name: '新增班級' }).click();
  await page.getByLabel('班級名稱').fill(name);
  await performSyncedAction(page, () =>
    page.getByLabel('班級名稱').press('Enter'));
  await expect(page.locator('#classSelect')).toHaveValue(/.+/);
  await expect(page.locator('#classSelect option:checked')).toHaveText(name);
  await waitForBackendSync(page);
};

export const addStudentViaUi = async (page: Page, name: string) => {
  await selectDashboardTab(page, '學生');
  const panel = page.getByRole('heading', { name: '新增學生' }).locator('..');
  await panel.getByLabel('學生姓名').fill(name);
  await performSyncedAction(page, () =>
    panel.getByRole('button', { name: '新增', exact: true }).click());
  await expect(page.getByText(`已新增學生：${name}`)).toBeVisible();
  await waitForBackendSync(page);
};

export const getBrowserCsrfToken = async (context: BrowserContext) => {
  const cookies = await context.cookies();
  const csrfCookie = cookies.find(
    (cookie) => cookie.name === '__Host-epet_csrf',
  );
  if (!csrfCookie) throw new Error('Browser CSRF cookie is missing');
  return csrfCookie.value;
};

export const browserApiRequest = async (
  context: BrowserContext,
  path: string,
  options: {
    body?: Record<string, unknown>;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    workspaceId?: string;
  } = {},
) => {
  const method = options.method ?? 'GET';
  const mutation = !['GET'].includes(method);
  const headers: Record<string, string> = {
    origin: E2E_BASE_URL,
    ...(options.workspaceId
      ? { 'x-epet-workspace': options.workspaceId }
      : {}),
  };
  // APIRequestContext does not apply Chromium's loopback Secure-cookie
  // exception, so fixture API assertions explicitly reuse the browser cookies.
  headers.cookie = (await context.cookies())
    .filter((cookie) => cookie.name === '__Host-epet_session' ||
      cookie.name === '__Host-epet_csrf')
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
  if (mutation) {
    headers['x-csrf-token'] = await getBrowserCsrfToken(context);
  }
  return context.request.fetch(`${E2E_BASE_URL}${path}`, {
    method,
    headers,
    ...(options.body ? { data: options.body } : {}),
  });
};

export const loadBrowserState = async (
  context: BrowserContext,
  workspaceId: string,
) => {
  const response = await browserApiRequest(context, '/api/v1/state', {
    workspaceId,
  });
  expect(response.status()).toBe(200);
  return parseResponse<StateSnapshot>(response);
};
