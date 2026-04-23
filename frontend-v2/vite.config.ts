import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/dashboard-v2/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
