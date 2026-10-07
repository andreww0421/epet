import { createAnalyticsClient } from './client';

const analytics = createAnalyticsClient();
export const configureAnalytics = analytics.configure;
export const trackAnalytics = analytics.track;
export { createAnalyticsClient, type AnalyticsConfiguration, type AnalyticsSink } from './client';
export { sanitizeAnalyticsEvent, ANALYTICS_EVENT_NAMES, type AnalyticsEnvironment, type AnalyticsEvent, type AnalyticsEventName, type AnalyticsMetadata } from './schema';
// React hooks stay separate: this barrel is safe in store/API services and has
// no React, Zustand, SDK, DOM, error-monitoring or transport imports.
