import { defineConfig, devices } from '@playwright/test';
import { E2E_BASE_URL, initializeE2eRun } from './tests/e2e/support/paths';

initializeE2eRun();

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './output/playwright/test-results',
  fullyParallel: false,
  workers: 1,
  globalTeardown: './tests/e2e/support/global-teardown.ts',
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: './output/playwright/report', open: 'never' }],
  ],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: E2E_BASE_URL,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run test:e2e:server',
    url: `${E2E_BASE_URL}/api/v1/health`,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120_000,
  },
  expect: {
    timeout: 10_000,
  },
  timeout: 90_000,
});
