import { build } from 'vite';
import { E2E_DIST_DIRECTORY } from './paths';

// Keep Vite's build and the HTTP server in one process. This gives Playwright
// a single process to terminate on Windows instead of an npm/cmd child tree.
await build({
  build: { outDir: E2E_DIST_DIRECTORY, emptyOutDir: true },
  plugins: [{
    name: 'synthetic-product-analytics',
    enforce: 'pre',
    transform(source, id) {
      if (id.replaceAll('\\', '/').endsWith('/src/store/useStore.ts')) {
        // Observe every store hydration in the isolated synthetic browser build.
        // No production global or mutation shortcut is shipped by this fixture.
        return `${source}\nconst draftTestChanges = [];
          window.__epetTestStore = {
            getData: () => structuredClone(useStore.getState().data),
            changes: draftTestChanges,
            resetObservations: () => { draftTestChanges.length = 0; },
          };
          useStore.subscribe((state, previous) => {
            if (state.data !== previous.data) {
              draftTestChanges.push(structuredClone(state.data));
              if (draftTestChanges.length > 200) draftTestChanges.shift();
            }
          });\n`;
      }
      if (id.replaceAll('\\', '/').endsWith('/src/analytics/workflows.ts')) {
        return `${source}\nconfigureProductWorkflows({ enabled: true, emit: (event) => {
          window.dispatchEvent(new CustomEvent('epet-test-workflow-analytics', { detail: event }));
        } });\n`;
      }
      if (!id.replaceAll('\\', '/').endsWith('/src/analytics/index.ts')) return;
      // This synthetic sink exists only in the isolated test build. Production
      // assets must contain none of its globals or markers; first-party pilot
      // collection remains independently disabled by its normal runtime flags.
      return `${source}\nconfigureAnalytics({
        enabled: true,
        environment: 'development',
        sink: (event) => {
          window.dispatchEvent(new CustomEvent('epet-test-product-analytics', { detail: event }));
        },
      });\n`;
    },
  }],
  // Synthetic E2E traffic is intercepted locally. Never inherit a deployed
  // monitoring environment or project configuration from the invoking shell.
  define: {
    'import.meta.env.VITE_PRODUCT_ANALYTICS_ENABLED': JSON.stringify('false'),
    'import.meta.env.VITE_PRODUCT_ANALYTICS_ENVIRONMENT': JSON.stringify('development'),
    'import.meta.env.VITE_MONITORING_ENABLED': JSON.stringify('true'),
    'import.meta.env.VITE_MONITORING_ENVIRONMENT': JSON.stringify('development'),
    'import.meta.env.VITE_MONITORING_RELEASE': JSON.stringify('0123456789abcdef0123456789abcdef01234567'),
  },
});
if (process.env.EPET_E2E_REPOSITORY === 'd1') {
  await import('./d1-server.ts');
} else {
  await import('./server.ts');
}
