import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ApplicationErrorBoundary } from './components/ui/ApplicationErrorBoundary';
import { initializeFrontendMonitoring, reportFrontendError } from './services/monitoring';
import { initializeFirstPartyProductAnalytics } from './analytics/firstParty';
import './index.css';

const runtimeEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
initializeFirstPartyProductAnalytics({
  enabled: runtimeEnv.VITE_PRODUCT_ANALYTICS_ENABLED,
  environment: runtimeEnv.VITE_PRODUCT_ANALYTICS_ENVIRONMENT,
});
initializeFrontendMonitoring({
  enabled: runtimeEnv.VITE_MONITORING_ENABLED,
  environment: runtimeEnv.VITE_MONITORING_ENVIRONMENT,
  release: runtimeEnv.VITE_MONITORING_RELEASE,
});
const reactError = () => reportFrontendError({ category: 'frontend.react', route: 'unknown', method: 'unknown' });

createRoot(document.getElementById('root')!, {
  onCaughtError: reactError, onUncaughtError: reactError, onRecoverableError: reactError,
}).render(
  <StrictMode>
    <ApplicationErrorBoundary><App /></ApplicationErrorBoundary>
  </StrictMode>,
);
