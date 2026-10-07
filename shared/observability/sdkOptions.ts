/** No automatic request, DOM, console, user, session, tracing or data integrations. */
export const PRIVATE_SENTRY_OPTIONS = {
  defaultIntegrations: false as const,
  integrations: [],
  sendDefaultPii: false,
  sendClientReports: false,
  attachStacktrace: false,
  maxBreadcrumbs: 0,
  debug: false,
  tracePropagationTargets: [],
  traceLifecycle: 'static' as const,
  dataCollection: {
    userInfo: false, cookies: false, httpHeaders: false, httpBodies: [] as [],
    urlQueryParams: false, databaseQueryData: false, queues: false,
    stackFrameVariables: false, frameContextLines: 0,
    graphQL: { document: false, variables: false }, genAI: { inputs: false, outputs: false },
  },
  beforeSendTransaction: () => null,
  beforeSendLog: () => null,
  beforeSendMetric: () => null,
};
