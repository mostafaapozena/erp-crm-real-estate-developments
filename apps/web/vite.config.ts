import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Two kinds of splitting, for two different reasons.
 *
 * **Route splitting** (`React.lazy` in `routes.tsx`) keeps a feature area out of the first download
 * until someone opens it. A collections officer never loads the marketing screens.
 *
 * **Vendor splitting** (`manualChunks` below) is what keeps any single chunk inside the budget. React
 * and Material UI are large, shared by every route, and change only when we upgrade them — bundling
 * them with the entry makes one oversized chunk that must be re-downloaded whenever our own code
 * changes. Separating them also means the budget check measures our code, not the framework's.
 *
 * The budget itself (`npm run check:bundle`) is unchanged and is not to be raised: it is an approved
 * decision, and the correct response to exceeding it is more splitting.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:4000',
      '/health': 'http://localhost:4000',
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
    // The same proxy as `server`, because the end-to-end tests run against the **built** bundle. The
    // browser must reach one origin for both the page and the API, or the session cookie — which is
    // `SameSite=Strict` and path-scoped — is never sent back and every refresh fails.
    proxy: {
      '/api': 'http://localhost:4000',
      '/health': 'http://localhost:4000',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          // Emotion must sit with MUI: splitting them produces two style caches at runtime.
          if (id.includes('@mui') || id.includes('@emotion') || id.includes('stylis')) {
            return 'vendor-mui';
          }
          if (id.includes('react-router')) return 'vendor-router';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('scheduler')) {
            return 'vendor-react';
          }
          if (id.includes('i18next')) return 'vendor-i18n';
          return undefined;
        },
      },
    },
  },
});
