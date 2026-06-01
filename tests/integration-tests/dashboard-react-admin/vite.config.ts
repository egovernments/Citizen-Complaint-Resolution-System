import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During local dev, proxy /tests/catalog.json + /tests/runs/* to the
// production host so the dataProvider can fetch real data without CORS
// or auth fuss. In production, this app is served from /tests/ on the
// same host, so the relative URLs Just Work.
export default defineConfig({
  plugins: [react()],
  base: '/tests-v2/',
  server: {
    port: 5173,
    proxy: {
      '/tests': {
        target: 'https://naipepea.digit.org',
        changeOrigin: true,
        secure: true,
        // Replace this with your basic-auth creds for local dev.
        // (One-shot for the developer; never commit a real password.)
        auth: process.env.TESTS_BASIC_AUTH || undefined,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
