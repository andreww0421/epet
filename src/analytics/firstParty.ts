import { configureAnalytics } from './index';
import { analyticsPrivacyOptOut } from './client';
import { configureProductWorkflows, subscribeProductWorkflowScopeVerified } from './workflows';
import { updateProductOnboarding } from '../services/backendApi';
import { productAnalyticsEnvironment, sanitizeProductAnalyticsEvent,
  type ProductAnalyticsEvent } from '../../shared/productAnalytics/schema';

const PATH = '/api/v1/product-analytics';
const LEGACY_USAGE = new Set(['workspace_created', 'learning_evidence_created', 'boss_started', 'feature_opened']);

/** Optional write-only transport: no cookies, persistent queue, retries or diagnostics. */
export const createFirstPartyTransport = (
  send: typeof fetch = (input, init) => globalThis.fetch(input, init),
  optOut = analyticsPrivacyOptOut,
  now = Date.now,
) => {
  const pending = new Set<AbortController>();
  let disposed = false;
  let windowStart = now();
  let count = 0;
  const abort = () => { for (const controller of pending) controller.abort(); pending.clear(); };
  return {
    abort,
    dispose() { disposed = true; abort(); },
    async emit(input: unknown): Promise<void> {
      try {
        if (disposed || optOut()) { abort(); return; }
        const safe = sanitizeProductAnalyticsEvent(input);
        if (!safe || pending.size >= 16) return;
        if (now() - windowStart >= 60_000) { windowStart = now(); count = 0; }
        if (count >= 120) return;
        count += 1;
        const controller = new AbortController();
        pending.add(controller);
        const timeout = setTimeout(() => controller.abort(), 1500);
        try {
          await send(PATH, { method: 'POST', credentials: 'omit', redirect: 'error',
            referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller.signal,
            headers: { 'content-type': 'application/json' }, body: JSON.stringify(safe) });
        } finally { clearTimeout(timeout); pending.delete(controller); }
      } catch { /* Optional product measurement never changes a teacher operation. */ }
    },
  };
};

type OnboardingWriter = typeof updateProductOnboarding;
/** These authenticated calls stay in the normal API protocol; identity never enters an event. */
export const createProductOnboardingObserver = (
  write: OnboardingWriter = updateProductOnboarding,
  optOut = analyticsPrivacyOptOut,
) => {
  let epoch = 0;
  let active = false;
  let enrolled: Promise<boolean> = Promise.resolve(false);
  let queue = Promise.resolve();
  let requestedStages = new Set<string>();
  let completedStages = new Set<string>();
  const scope = (verified: boolean) => {
    const generation = ++epoch;
    active = verified;
    enrolled = Promise.resolve(false);
    queue = Promise.resolve();
    requestedStages = new Set();
    completedStages = new Set();
    const completed = completedStages;
    try {
      if (!verified || optOut()) return;
      enrolled = Promise.resolve(write('enroll')).then((result) => {
        if (result?.state?.started) completed.add('started');
        if (result?.state?.localReported) completed.add('local_completed');
        return active && generation === epoch && !optOut() && result?.eligible === true;
      }).catch(() => false);
    } catch { /* No enrollment means no cohort claim. */ }
  };
  return {
    scope,
    observe(event: ProductAnalyticsEvent) {
      try {
        if (!active || optOut() || event.kind !== 'workflow' || event.flow !== 'class_create' ||
            (event.stage !== 'started' && event.stage !== 'local_completed')) return;
        const generation = epoch;
        const stage = event.stage;
        if (requestedStages.has(stage)) return;
        requestedStages.add(stage);
        const completed = completedStages;
        const enrollment = enrolled;
        // Captures this authority's enrollment only. Never replay after scope or session changes.
        // At most two progress calls are queued per verified scope. Serialize
        // them so local completion cannot overtake its required started write.
        queue = queue.then(async () => {
          const eligible = await enrollment;
          if (eligible && active && generation === epoch && !optOut() && !completed.has(stage)) {
            const result = await write(stage);
            if (result?.state?.started) completed.add('started');
            if (result?.state?.localReported) completed.add('local_completed');
          }
        }).catch(() => undefined);
      } catch { /* Optional observer. */ }
    },
    dispose() { scope(false); },
  };
};

export const initializeFirstPartyProductAnalytics = (
  flags: { enabled?: string; environment?: string },
  dependencies: { send?: typeof fetch; writeOnboarding?: OnboardingWriter; optOut?: () => boolean } = {},
) => {
  const environment = productAnalyticsEnvironment(flags.environment);
  // A disabled bootstrap must not replace an explicitly installed local test adapter.
  if (flags.enabled !== 'true' || !environment) return () => undefined;
  const privacyOptOut = dependencies.optOut ?? analyticsPrivacyOptOut;
  const transport = createFirstPartyTransport(dependencies.send, privacyOptOut);
  const onboarding = createProductOnboardingObserver(dependencies.writeOnboarding, privacyOptOut);
  const stopScope = subscribeProductWorkflowScopeVerified((active) => {
    transport.abort(); onboarding.scope(active);
  });
  const stopWorkflows = configureProductWorkflows({ enabled: true, privacyOptOut,
    emit: (event) => { onboarding.observe(event); return transport.emit(event); } });
  const stopUsage = configureAnalytics({ enabled: true, environment,
    sink: (event) => {
      if (!LEGACY_USAGE.has(event.name)) return;
      return transport.emit({ schema_version: 2, kind: 'usage', name: event.name,
        ...(event.name === 'feature_opened' ? { feature: event.metadata.feature } : {}) });
    } });
  return () => { stopScope(); stopWorkflows(); stopUsage(); onboarding.dispose(); transport.dispose(); };
};
