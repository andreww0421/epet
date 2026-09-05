import AxeBuilder from '@axe-core/playwright';
import { writeFile } from 'node:fs/promises';
import { expect, test as base, type Page, type TestInfo } from '@playwright/test';
import {
  E2eApiSession,
  addStudentViaUi,
  loginViaUi,
  testAccount,
} from '../e2e/support/fixtures';

export const STUDENT_NAME = 'A11Y 測試學生';

export const test = base.extend<{ teacherPage: Page }>({
  teacherPage: async ({ page }, use) => {
    const account = testAccount('accessibility');
    const session = await E2eApiSession.register(account);
    await session.dispose();
    await loginViaUi(page, account);
    await addStudentViaUi(page, STUDENT_NAME);
    await use(page);
  },
});

export const scanAccessibility = async (page: Page, info: TestInfo, name: string) => {
  // Scan all default axe rules, including best practices. Do not hide elements
  // or disable rules; lower-impact and manual-review findings stay in reports.
  const results = await new AxeBuilder({ page }).analyze();
  const summarize = (items: typeof results.violations) => items.map((item) => ({
    id: item.id,
    impact: item.impact,
    help: item.help,
    helpUrl: item.helpUrl,
    nodes: item.nodes.map((node) => ({
      target: node.target,
      failureSummary: node.failureSummary,
    })),
  }));
  const violations = summarize(results.violations);
  const reportPath = info.outputPath(`axe-${name}.json`);
  await writeFile(reportPath, JSON.stringify({
    name,
    axeVersion: results.testEngine.version,
    violations,
    incomplete: summarize(results.incomplete),
  }, null, 2));
  await info.attach(`axe-${name}`, {
    path: reportPath,
    contentType: 'application/json',
  });
  // Synthetic local data only; screenshots also support manual layout review.
  const screenshotPath = info.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await info.attach(name, { path: screenshotPath, contentType: 'image/png' });
  expect.soft(violations.filter((item) =>
    item.impact === 'critical' || item.impact === 'serious'),
  `${name}: critical/serious axe violations`).toEqual([]);
};
