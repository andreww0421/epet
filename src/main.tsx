import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ApplicationErrorBoundary } from './components/ui/ApplicationErrorBoundary';
import { initializeFrontendMonitoring, reportFrontendError } from './services/monitoring';
import './index.css';

const runtimeEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
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
