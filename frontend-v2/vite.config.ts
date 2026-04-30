import { sentryVitePlugin } from '@sentry/vite-plugin';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const hasSentryReleaseConfig = !!(env.SENTRY_AUTH_TOKEN && env.SENTRY_ORG && env.SENTRY_PROJECT);

  return {
    plugins: [
      react(),
      ...(hasSentryReleaseConfig
        ? [
            sentryVitePlugin({
              authToken: env.SENTRY_AUTH_TOKEN,
              org: env.SENTRY_ORG,
              project: env.SENTRY_PROJECT,
            }),
          ]
        : []),
    ],
    base: '/dashboard-v2/',
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/setupTests.ts',
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: 'hidden',
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;

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
