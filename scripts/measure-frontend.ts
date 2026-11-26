// Local-only synthetic performance lab. Run from repository root:
// npx tsx scripts/measure-frontend.ts after
// Requires an idle localhost:3100; never targets remote or production data.
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createEpetServer } from '../server/app';
import { E2eApiSession, testAccount, openConsoleWithApiSession, selectTeacherDestination } from '../tests/e2e/support/fixtures';
import { createEnrolledStudent } from '../src/studentEnrollment';
import type { AppData } from '../src/store/types';

if (process.argv.length > 3) throw new Error('Usage: npx tsx scripts/measure-frontend.ts after (local synthetic data only)');
const phase = process.argv[2] ?? 'after';
if (!/^[a-z0-9-]+$/.test(phase) || phase === 'baseline') throw new Error('Use an after-phase label; baseline artifacts are frozen separately');
const output = resolve('output/frontend-experience');
const rosterSize = 300;
const repetitions = 3;
await mkdir(output, { recursive: true });
const observations: any[] = [];
const sourceDiffHash = () => createHash('sha256').update(execFileSync('git', ['diff', 'HEAD', '--binary'], { maxBuffer: 20 * 1024 * 1024 })).digest('hex');
const workingDiffSha256 = sourceDiffHash();
let browserVersion = '';
const profileInstrument = {
  name: 'local-performance-profiling-only', enforce: 'pre' as const,
  transform(source: string, id: string) {
    id = id.replaceAll('\\', '/');
    if (id.endsWith('/src/main.tsx')) {
      if (!source.includes('<ApplicationErrorBoundary><App /></ApplicationErrorBoundary>')) throw new Error('Profiler entry injection no longer matches');
      return source.replace('{StrictMode}', '{StrictMode, Profiler}').replace('<ApplicationErrorBoundary><App /></ApplicationErrorBoundary>',
        `<Profiler id="App" onRender={(id,phase,actualDuration,baseDuration,startTime,commitTime) => { ((window as any).__perfCommits ??= []).push({phase,actualDuration,baseDuration,startTime,commitTime}); }}><ApplicationErrorBoundary><App /></ApplicationErrorBoundary></Profiler>`);
    }
    if (id.endsWith('/src/components/PetCard.tsx')) return source.replace('}) => {', '}) => {\n(window as any).__perfPetRenders = ((window as any).__perfPetRenders ?? 0) + 1;');
    if (id.endsWith('/src/components/DashboardView.tsx')) return source.replace(/(export const DashboardView =[\s\S]*?=> \{)/,
      '$1\n(window as any).__perfDashboardRenders = ((window as any).__perfDashboardRenders ?? 0) + 1;');
  },
};

for (const profiling of [false, true]) {
  const kind = profiling ? 'profiling' : 'normal';
  const dist = resolve(output, `${phase}-${kind}-dist`);
  await build({
    build: { outDir: dist, emptyOutDir: true, manifest: true },
    ...(profiling ? { plugins: [profileInstrument], resolve: { alias: [{ find: /^react-dom\/client$/, replacement: resolve('node_modules/react-dom/profiling.js') }] } } : {}),
    define: { 'import.meta.env.VITE_MONITORING_ENABLED': JSON.stringify('false'), 'import.meta.env.VITE_PRODUCT_ANALYTICS_ENABLED': JSON.stringify('false') },
  });
  const manifest = JSON.parse(await readFile(resolve(dist, '.vite/manifest.json'), 'utf8'));
  const bundle = [];
  for (const [key, item] of Object.entries(manifest) as [string, any][]) {
    const bytes = await readFile(resolve(dist, item.file));
    bundle.push({ key, file: item.file, isEntry: Boolean(item.isEntry), isDynamicEntry: Boolean(item.isDynamicEntry), bytes: bytes.length, gzipBytes: gzipSync(bytes).length, imports: item.imports, dynamicImports: item.dynamicImports, css: item.css });
  }
  await writeFile(resolve(output, `${phase}-${kind}-bundles.json`), JSON.stringify(bundle, null, 2));
  const runtime = await mkdtemp(resolve(tmpdir(), 'epet-perf-'));
  const { server } = createEpetServer({ dataFile: resolve(runtime, 'synthetic.json'), distDirectory: dist,
    registrationEnabled: true, botProtectionRequired: false, emailVerificationRequired: false, forgotResponseFloorMs: 0 });
  const browser = await chromium.launch({ headless: true });
  browserVersion = browser.version();
  let owner: E2eApiSession | undefined;
  try {
    await new Promise<void>((done, reject) => {
      server.once('error', reject);
      server.listen(3100, '127.0.0.1', () => { server.off('error', reject); done(); });
    });
    owner = await E2eApiSession.register(testAccount(`performance-${kind}`));
    const initial = await owner.loadState();
    if (!initial.data) throw new Error('Missing synthetic workspace');
    const data: AppData = { ...initial.data, settings: { ...initial.data.settings!, decayAmount: 0,
      gameFeatures: { pets: true, battles: true, bosses: true, leaderboards: true } },
      classes: [{ ...initial.data.classes[0], name: 'Synthetic Performance 300',
        students: Array.from({ length: rosterSize }, (_, index) => ({ ...createEnrolledStudent({ id: `perf-${index}`, name: `Synthetic learner ${index}` }), points: 420,
          pet: { type: ['cat','dog','rabbit'][index % 3], level: 3, fullness: 90, happiness: 88 } })),
        activeBoss: { id: 'synthetic-perf-boss', name: 'Synthetic Performance Boss', isActive: true, maxHp: 10000, currentHp: 9000,
          contributions: {}, rewardTiers: [] }, learningEvidenceRecords: [], examRecords: [] }] };
    for (let run = 1; run <= repetitions; run++) {
      const before = await owner.loadState();
      await owner.saveState(data, before.revision);
      const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3100', viewport: { width: 1280, height: 900 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei', reducedMotion: 'reduce' });
      await context.addInitScript(() => {
        (window as any).__perfVitals = { lcp: null, cls: 0, longTasks: [] };
        (window as any).__perfCommits = []; (window as any).__perfPetRenders = 0; (window as any).__perfDashboardRenders = 0;
        new PerformanceObserver(list => { for (const value of list.getEntries()) (window as any).__perfVitals.lcp = value.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver(list => { for (const value of list.getEntries() as any) if (!value.hadRecentInput) (window as any).__perfVitals.cls += value.value; }).observe({ type: 'layout-shift', buffered: true });
        new PerformanceObserver(list => { for (const value of list.getEntries()) (window as any).__perfVitals.longTasks.push({ start: value.startTime, duration: value.duration }); }).observe({ type: 'longtask', buffered: true });
      });
      const loginPage = await context.newPage();
      const loginCdp = await context.newCDPSession(loginPage);
      await loginCdp.send('Network.enable'); await loginCdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await loginCdp.send('Performance.enable');
      const start = performance.now();
      await loginPage.goto('http://127.0.0.1:3100/');
      await loginPage.locator('#auth-email').waitFor();
      // The checking-state form now reserves its layout while inert. Match the
      // old final-policy-ready form rather than timing that earlier placeholder.
      await expect(loginPage.getByRole('button', { name: '登入並繼續帶班', exact: true })).toBeEnabled();
      await loginPage.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
      const loginDuration = performance.now() - start;
      await loginPage.waitForTimeout(250);
      const login = await loginPage.evaluate(() => ({ ...(window as any).__perfVitals,
        resources: performance.getEntriesByType('resource').filter((item: any) => /\.(js|css)(\?|$)/.test(item.name)).map((item: any) => ({ file: new URL(item.name).pathname, transferSize: item.transferSize, encodedBodySize: item.encodedBodySize, duration: item.duration })) }));
      await loginPage.close();
      const page = await context.newPage();
      page.setDefaultTimeout(45_000);
      const cdp = await context.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }); await cdp.send('Performance.enable');
      const todayStart = performance.now();
      await openConsoleWithApiSession(page, owner);
      await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
      const todayDuration = performance.now() - todayStart;
      console.log(`${kind} ${run}: Today ready ${todayDuration.toFixed(1)}ms`);
      const today = await page.evaluate(() => ({ ...(window as any).__perfVitals, domNodes: document.querySelectorAll('*').length,
        resources: performance.getEntriesByType('resource').filter((item: any) => /\.(js|css)(\?|$)/.test(item.name)).map((item: any) => ({ file: new URL(item.name).pathname, transferSize: item.transferSize, encodedBodySize: item.encodedBodySize, duration: item.duration })) }));
      await page.evaluate(() => { (window as any).__perfPetRenders = 0; (window as any).__perfDashboardRenders = 0; (window as any).__perfCommits = []; (window as any).__perfVitals.longTasks = []; });
      const petStart = performance.now();
      await page.getByRole('button', { name: '寵物活動', exact: true }).click();
      await page.getByRole('article').first().waitFor();
      await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
      const petDuration = performance.now() - petStart;
      console.log(`${kind} ${run}: Pets ready ${petDuration.toFixed(1)}ms`);
      await page.waitForTimeout(150);
      const visiblePetCards = await page.getByRole('region', { name: '寵物活動', exact: true }).getByRole('article').count();
      if (visiblePetCards !== 24) throw new Error(`Expected 24 visible cards on the first 300-student page, got ${visiblePetCards}`);
      const pets = await page.evaluate(() => ({ cards: document.querySelectorAll('article').length, documentArticles: document.querySelectorAll('article').length, domNodes: document.querySelectorAll('*').length,
        longTasks: (window as any).__perfVitals.longTasks, commits: (window as any).__perfCommits,
        petRenders: (window as any).__perfPetRenders, dashboardRenders: (window as any).__perfDashboardRenders }));
      Object.assign(pets, { visiblePetCards });
      await page.evaluate(() => { (window as any).__perfPetRenders = 0; (window as any).__perfDashboardRenders = 0; (window as any).__perfCommits = []; (window as any).__perfVitals.longTasks = []; });
      const feedStart = performance.now();
      const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/state' && response.request().method() === 'PUT');
      const [response] = await Promise.all([saved, page.getByRole('article').first().getByRole('button', { name: '餵食 (-10 積分)', exact: true }).click()]);
      if (response.status() !== 200) throw new Error(`Synthetic feeding failed HTTP ${response.status()}`);
      const feedToAckDuration = performance.now() - feedStart;
      const feedResponse = await response.json();
      console.log(`${kind} ${run}: Feed backend ACK ${feedToAckDuration.toFixed(1)}ms`);
      await expect(page.locator('[title="後端已同步"]')).toBeVisible({ timeout: 45_000 });
      await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
      const feedSettledDuration = performance.now() - feedStart;
      const feed = await page.evaluate(() => ({ commits: (window as any).__perfCommits, petRenders: (window as any).__perfPetRenders,
        dashboardRenders: (window as any).__perfDashboardRenders, longTasks: (window as any).__perfVitals.longTasks }));
      const navigation: any[] = [];
      for (const tab of ['對戰', '魔王管理']) {
        const t = performance.now();
        await selectTeacherDestination(page, 'Activities', tab);
        await expect(page.getByRole('tabpanel', { name: tab, exact: true })).toBeVisible();
        await expect(page.getByRole('article')).toHaveCount(0);
        await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
        navigation.push({ tab, durationMs: performance.now() - t, cards: await page.getByRole('article').count(), documentArticles: await page.locator('article').count(), domNodes: await page.locator('*').count() });
      }
      if (profiling && pets.petRenders === 0) throw new Error('Pet render instrumentation did not record real executions');
      if (profiling && feed.commits.length === 0) throw new Error('React production Profiler did not record real callbacks');
      observations.push({ kind, run, rosterSize, loginDuration, todayDuration, petDuration, feedToAckDuration, feedSettledDuration, feedAck: { status: response.status(), revision: feedResponse.revision }, login, today, pets, feed, navigation,
        cdp: await cdp.send('Performance.getMetrics') });
      await context.close();
      await writeFile(resolve(output, `${phase}-runs.json`), JSON.stringify(observations, null, 2));
      console.log(`Measured ${kind} run ${run}: Today ${todayDuration.toFixed(1)}ms; pets ${petDuration.toFixed(1)}ms; feed ACK ${feedToAckDuration.toFixed(1)}ms`);
    }
  } finally {
    await browser.close(); await owner?.dispose();
    if (server.listening) await new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); });
  }
}
const finalWorkingDiffSha256 = sourceDiffHash();
if (workingDiffSha256 !== finalWorkingDiffSha256) throw new Error('Tracked source diff changed during the benchmark; repeat after edits stop');
const summary = { phase, source: execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(), workingDiffSha256, finalWorkingDiffSha256,
  conditions: { syntheticStudents: rosterSize, repetitions, viewport: '1280x900', locale: 'zh-TW', browser: `bundled Playwright Chromium ${browserVersion}, headless`, CPU: 'unthrottled host CPU', network: 'loopback HTTP, no artificial throttling, browser cache disabled', petNavigation: 'After: top 寵物活動, 1 click; baseline: Activities → 寵物, 2 clicks. Time-to-task-path measures differ intentionally; neither is INP.', loginReadiness: 'Enabled login submit after auth/config policy settles, plus two frames; baseline form did not exist until this final policy state.', managementNavigation: 'First management tab includes returning from private activity hub to Teacher Console, then Activities and target tab. Baseline already started inside Activities. Compare card/DOM counts separately from these different interaction paths.', note: 'Laboratory measurements only. No field INP or Lighthouse score. Normal and production-profiling builds are separate; profiling adds overhead. Diff SHA-256 covers git diff HEAD --binary (tracked files).' },
  observations };
await writeFile(resolve(output, `${phase}-report.json`), JSON.stringify(summary,null,2));
console.log(`${phase} complete; localhost:3100 released.`);
