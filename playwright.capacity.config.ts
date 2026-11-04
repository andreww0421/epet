import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const webServer = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer;
if (!webServer) throw new Error('Capacity tests require the local E2E web server');

// Capacity regressions use actual local D1 storage. Keep this synthetic fixture
// out of the default JSON-backed suite and refuse deployed URLs through paths.ts.
export default defineConfig({
  ...base,
  testDir: './tests/e2e-capacity',
  outputDir: './output/playwright/capacity-results',
  reporter: [['list'], ['html', { outputFolder: './output/playwright/capacity-report', open: 'never' }]],
  webServer: {
    ...webServer,
    env: { ...webServer.env, EPET_E2E_REPOSITORY: 'd1' },
  },
});
