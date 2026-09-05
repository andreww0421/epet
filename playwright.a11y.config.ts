import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

export default defineConfig(baseConfig, {
  testDir: './tests/accessibility',
  outputDir: './output/playwright/accessibility/results',
  reporter: [
    ['list'],
    ['html', { outputFolder: './output/playwright/accessibility/report', open: 'never' }],
  ],
});
