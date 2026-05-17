import { sentryVitePlugin } from '@sentry/vite-plugin';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  const frontendEnv = loadEnv(mode, __dirname, '');
  const rootEnv = loadEnv(mode, resolve(__dirname, '..'), '');
  const env = { ...rootEnv, ...frontendEnv };
  const sentryUploadEnabled = String(env.SENTRY_UPLOAD_SOURCEMAPS || '').toLowerCase() === 'true';
  const hasSentryReleaseConfig = sentryUploadEnabled && !!(env.SENTRY_AUTH_TOKEN && env.SENTRY_ORG && env.SENTRY_PROJECT);

  return {
    plugins: [
      react(),
      ...(hasSentryReleaseConfig
        ? [
            sentryVitePlugin({
              authToken: env.SENTRY_AUTH_TOKEN,
              org: env.SENTRY_ORG,
              project: env.SENTRY_PROJECT,
              telemetry: false,
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    base: '/dashboard-v2/',
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/setupTests.ts',
      exclude: ['**/node_modules/**', 'e2e/**', 'tests/**'],
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
