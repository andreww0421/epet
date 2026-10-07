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
      if (!id.replaceAll('\\', '/').endsWith('/src/analytics/index.ts')) return;
      // A local synthetic sink exists only in this test build. Production has
      // no global collector, debug endpoint, adapter, credentials or opt-in.
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
    'import.meta.env.VITE_MONITORING_ENABLED': JSON.stringify('true'),
    'import.meta.env.VITE_MONITORING_ENVIRONMENT': JSON.stringify('development'),
    'import.meta.env.VITE_MONITORING_RELEASE': JSON.stringify('0123456789abcdef0123456789abcdef01234567'),
  },
});
await import('./server.ts');
