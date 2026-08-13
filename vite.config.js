import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    // The real bundle gates are `npm run size:check` (gzip
    // transfer budget) + the Lighthouse `resource-summary:script:size`
    // hard cap — both measured on GZIP, both green. Vite's default 500 KB
    // warning is on the RAW uncompressed chunk, so it fired on every build
    // as pure noise (index.js is ~566 KB raw / ~147 KB gzip — re-measured;
    // the previous figures had drifted). Raise the
    // limit so the console warning reflects the raw size we actually ship
    // and stops crying wolf; the meaningful budgets stay enforced elsewhere.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // Split React out of the app chunk so the framework
        // can be cached independently of feature code. With `React.lazy`
        // applied to StatsView in CuratorApp, the StatsView + Charts.jsx
        // bundle is also code-split automatically by Vite (no manual
        // entry needed for that — `import()` is the signal).
        //
        // Vite 8 uses Rolldown which dropped the object-form
        // shorthand for manualChunks — must use the function form.
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') ||
              id.includes('node_modules/react/') ||
              String(id).endsWith('node_modules/react') ||
              String(id).endsWith('node_modules/react-dom')) {
            return 'vendor-react';
          }
          // The dictionaries are NO LONGER chunked together.
          //
          // They were once all five in one EAGER chunk, for cache stability on
          // redeploy. That was right while every dictionary was a static
          // import — but it meant a user downloaded 78.3 KB gzip to read
          // ~15.7, on every cold start, and it is what made a sixth language
          // impossible (~29 KB of budget headroom against ~16 KB each).
          //
          // Now `src/i18n.ts` statically imports ONLY English and reaches the
          // others through `import.meta.glob`, so each is its own chunk,
          // fetched on demand. Forcing them back into a shared chunk here
          // would silently undo that: a manualChunks group is emitted as one
          // file, so importing any one language would pull all five.
          //
          // The cache-stability win survives: each dictionary now has its own
          // content hash, so a change to one no longer invalidates the other
          // four — strictly better than the shared chunk on that axis too.
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    globals: true,
    // Exclude Playwright e2e specs — different runner (playwright test).
    exclude: ['node_modules/**', 'dist/**', 'e2e/**'],
  },
})
