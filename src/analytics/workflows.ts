import {
  PRODUCT_ANALYTICS_FLOWS,
  type ProductAnalyticsFlow,
  type ProductAnalyticsStage,
  type ProductAnalyticsWorkflowEvent,
} from '../../shared/productAnalytics/schema';
import { analyticsPrivacyOptOut } from './client';

export type ProductWorkflowToken = Readonly<{ attempt: string; flow: ProductAnalyticsFlow }>;
type Entry = { token: ProductWorkflowToken; stage: 'started' | 'local_completed'; createdAt: number;
  classContext?: 'first' | 'subsequent' };
type Configuration = { enabled: boolean; emit: (event: ProductAnalyticsWorkflowEvent) => unknown;
  privacyOptOut?: () => boolean };

// Attempts and authority are strictly memory-only. The scope is never copied into an event.
const TTL_MS = 15 * 60_000;
const MAX_PENDING = 16;
const attempts = new Map<string, Entry>();
const clearListeners = new Set<() => void>();
const scopeListeners = new Set<(active: boolean) => void>();
let configuration: Configuration | undefined;
let scopeKey: string | null = null;
let delivering = false;
let classAttemptSeen = false;

const notifyScope = () => {
  for (const listener of scopeListeners) { try { listener(scopeKey !== null); } catch { /* Optional observer. */ } }
};
export const clearProductWorkflows = () => {
  attempts.clear();
  for (const listener of clearListeners) { try { listener(); } catch { /* Optional sidecar. */ } }
};
export const subscribeProductWorkflowCleared = (listener: () => void) => {
  clearListeners.add(listener);
  return () => { clearListeners.delete(listener); };
};
export const subscribeProductWorkflowScopeVerified = (listener: (active: boolean) => void) => {
  scopeListeners.add(listener);
  try { listener(scopeKey !== null); } catch { /* Optional observer. */ }
  return () => { scopeListeners.delete(listener); };
};
export const setProductWorkflowScope = (nextScope: string | null) => {
  const next = typeof nextScope === 'string' && nextScope.length > 0 ? nextScope : null;
  if (next === scopeKey) return;
  clearProductWorkflows();
  scopeKey = next;
  classAttemptSeen = false;
  notifyScope();
};
const activeConfiguration = () => {
  try {
    if (analyticsPrivacyOptOut() || configuration?.privacyOptOut?.()) {
      clearProductWorkflows();
      return undefined;
    }
    return scopeKey && configuration?.enabled === true ? configuration : undefined;
  } catch { clearProductWorkflows(); return undefined; }
};
const emit = (entry: Entry, stage: ProductAnalyticsStage) => {
  const active = activeConfiguration();
  if (!active || delivering) return;
  const event = Object.freeze({ schema_version: 2, kind: 'workflow', attempt: entry.token.attempt,
    flow: entry.token.flow, stage,
    ...(entry.token.flow === 'class_create' && entry.classContext ? { class_context: entry.classContext } : {}),
  }) as ProductAnalyticsWorkflowEvent;
  delivering = true;
  try { void Promise.resolve(active.emit(event)).catch(() => undefined); }
  catch { /* Analytics cannot change a product result. */ }
  finally { delivering = false; }
};
const prune = () => {
  const now = Date.now();
  for (const entry of attempts.values()) {
    if (now - entry.createdAt >= TTL_MS) {
      attempts.delete(entry.token.attempt);
      emit(entry, 'unconfirmed');
    }
  }
};
export const configureProductWorkflows = (next: Configuration) => {
  clearProductWorkflows();
  const current = next.enabled === true && typeof next.emit === 'function' ? { ...next } : undefined;
  configuration = current;
  activeConfiguration();
  return () => {
    if (configuration === current) { configuration = undefined; clearProductWorkflows(); }
  };
};

/** Reuses an open dialog's started attempt; completed commands always get a new token. */
export const beginProductWorkflow = (flow: ProductAnalyticsFlow): ProductWorkflowToken | null => {
  try {
    if (!activeConfiguration() || delivering || !PRODUCT_ANALYTICS_FLOWS.includes(flow)) return null;
    prune();
    for (const entry of attempts.values()) {
      if (entry.token.flow === flow && entry.stage === 'started') return entry.token;
    }
    if (attempts.size >= MAX_PENDING) {
      const oldest = attempts.values().next().value as Entry | undefined;
      if (oldest) { attempts.delete(oldest.token.attempt); emit(oldest, 'unconfirmed'); }
    }
    // A secure attempt UUID is the only correlation value sent to the collector.
    const attempt = globalThis.crypto?.randomUUID?.();
    if (!attempt) return null;
    const token = Object.freeze({ attempt, flow });
    const entry: Entry = { token, stage: 'started', createdAt: Date.now(),
      ...(flow === 'class_create' ? { classContext: classAttemptSeen ? 'subsequent' as const : 'first' as const } : {}) };
    if (flow === 'class_create') classAttemptSeen = true;
    attempts.set(attempt, entry);
    emit(entry, 'started');
    return token;
  } catch { return null; }
};
const find = (target: ProductWorkflowToken | ProductAnalyticsFlow | null | undefined) => {
  if (!target || !activeConfiguration()) return undefined;
  prune();
  if (typeof target === 'string') return [...attempts.values()].reverse().find(
    (entry) => entry.token.flow === target && entry.stage === 'started');
  const entry = attempts.get(target.attempt);
  return entry?.token === target ? entry : undefined;
};
export const isProductWorkflowPending = (token: ProductWorkflowToken | null | undefined) => Boolean(find(token));
export const completeLocalProductWorkflow = (target: ProductWorkflowToken | ProductAnalyticsFlow | null | undefined) => {
  const entry = find(target);
  if (!entry || entry.stage !== 'started') return;
  entry.stage = 'local_completed';
  emit(entry, 'local_completed');
  // Reports finish when the output has been prepared. No saved/printed claim is made.
  if (entry.token.flow === 'report_weekly' || entry.token.flow === 'report_exam') attempts.delete(entry.token.attempt);
};
const finish = (target: ProductWorkflowToken | ProductAnalyticsFlow | null | undefined,
  stage: 'backend_acknowledged' | 'cancelled' | 'rejected' | 'unconfirmed') => {
  const entry = find(target);
  if (!entry || (stage === 'backend_acknowledged' && entry.stage !== 'local_completed')) return;
  attempts.delete(entry.token.attempt);
  emit(entry, stage);
};
export const acknowledgeProductWorkflow = (token: ProductWorkflowToken) => finish(token, 'backend_acknowledged');
export const cancelProductWorkflow = (target: ProductWorkflowToken | ProductAnalyticsFlow | null | undefined) => finish(target, 'cancelled');
export const rejectProductWorkflow = (target: ProductWorkflowToken | ProductAnalyticsFlow | null | undefined) => finish(target, 'rejected');
export const markProductWorkflowUnconfirmed = (token: ProductWorkflowToken) => finish(token, 'unconfirmed');
