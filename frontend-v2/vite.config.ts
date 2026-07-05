import { sentryVitePlugin } from '@sentry/vite-plugin';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  const frontendEnv = loadEnv(mode, __dirname, '');
  const rootEnv = loadEnv(mode, resolve(__dirname, '..'), '');
  const env = { ...rootEnv, ...frontendEnv };
  const hasSentryReleaseConfig = !!(env.SENTRY_AUTH_TOKEN && env.SENTRY_ORG && env.SENTRY_PROJECT);
  const desktopApiTarget = (env.VITE_API_BASE_URL || env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '');
  const shouldUploadSentrySourcemaps =
    env.CI === 'true' &&
    env.SENTRY_UPLOAD_SOURCEMAPS === 'true' &&
    hasSentryReleaseConfig;

  return {
    plugins: [
      react(),
      ...(shouldUploadSentrySourcemaps
        ? [
            sentryVitePlugin({
              authToken: env.SENTRY_AUTH_TOKEN,
              org: env.SENTRY_ORG,
              project: env.SENTRY_PROJECT,
              errorHandler: (err) => {
                console.warn('[sentry-vite-plugin] Source map upload skipped:', err.message);
              },
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    // Tauri expects a relative base so assets load correctly in the desktop shell.
    base: mode === 'tauri' ? './' : '/dashboard-v2/',
    // Tauri dev server port -- must be locked
    // `server.proxy` only affects `vite dev`/`vite preview` (never `vite build`), so it's safe to
    // always define it here. This proxy is what lets the plain dev server (used by Playwright's
    // webServer and by any human running `npm run dev`) reach the backend, not just the Tauri
    // desktop dev flow, which already opts into `--mode tauri` explicitly via tauri.conf.json's
    // `beforeDevCommand`.
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: desktopApiTarget,
          changeOrigin: true,
          secure: false,
        },
        '/auth': {
          target: desktopApiTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/setupTests.ts',
      exclude: ['**/node_modules/**', 'e2e/**', 'tests/**'],
      reporters: ['verbose', 'hanging-process'],
      pool: 'forks',
      fileParallelism: false,
      testTimeout: 30000,
      hookTimeout: 10000,
      teardownTimeout: 10000,
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: 'hidden',
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('@sentry/')) return 'sentry';
            if (id.includes('@sentry-internal/')) return 'sentry';
            if (id.includes('react-router') || id.includes('@remix-run/router')) return 'router';
            if (id.includes('lucide-react')) return 'icons';
            if (id.includes('@radix-ui/')) return 'radix';
            return 'vendor';
          },
        },
      },
    },
  };
});
