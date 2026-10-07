import { defineConfig, devices } from '@playwright/test';
import { validateStagingUrl } from './scripts/staging-target.mjs';

// Unlike local E2E, this suite never starts a fixture server, seeds an account,
// reads local storage state, or invokes local/global cleanup against a remote DB.
const baseURL = validateStagingUrl(process.env.STAGING_BASE_URL);

export default defineConfig({
  testDir: './tests/staging',
  testMatch: '**/*.spec.ts',
  outputDir: './output/playwright/staging-test-results',
  preserveOutput: 'never',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'dot',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    ignoreHTTPSErrors: false,
    serviceWorkers: 'block',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  expect: { timeout: 10_000 },
  timeout: 45_000,
});
