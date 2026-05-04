import { resolve } from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_URL || 'http://localhost:3001';

  return {
    base: '/driver-app/',
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'icons/icon-192.png',
          'icons/icon-512.png',
          'icons/apple-touch-icon.png',
        ],
        manifest: {
          name: 'NodeRoute Driver',
          short_name: 'NR Driver',
          theme_color: '#0f766e',
          background_color: '#f4f7f8',
          display: 'standalone',
          start_url: '/driver-app/',
          scope: '/driver-app/',
          icons: [
            {
              src: '/driver-app/icons/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: '/driver-app/icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: '/driver-app/icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: ({ request, url }) =>
                request.method === 'GET' &&
                url.origin === self.location.origin &&
                (
                  url.pathname.startsWith('/api/driver/routes') ||
                  url.pathname.startsWith('/api/driver/invoices') ||
                  url.pathname.startsWith('/api/driver/summary') ||
                  url.pathname.startsWith('/api/deliveries/deliveries') ||
                  /^\/api\/stops\/[^/]+$/.test(url.pathname)
                ),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'nr-driver-api-cache',
                expiration: {
                  maxEntries: 40,
                  maxAgeSeconds: 60 * 60 * 8,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    server: {
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/auth': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  };
});
