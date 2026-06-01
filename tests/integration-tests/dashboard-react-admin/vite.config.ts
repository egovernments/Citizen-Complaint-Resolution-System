import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During local dev, proxy /tests/catalog.json + /tests/runs/* to the
// production host so the dataProvider can fetch real data without CORS
// or auth fuss. In production, this app is served from the same host
// at DASHBOARD_BASE, so the relative URLs Just Work.
//
// Path is env-driven so one build artifact deploys to any tenant:
//   naipepea → /tests-v2/ (default)   bomet → /integration-tests-v2/
const BASE = process.env.DASHBOARD_BASE || '/tests-v2/';
const PROXY_TARGET = process.env.TESTS_PROXY_TARGET || 'https://naipepea.digit.org';

export default defineConfig({
  plugins: [react()],
  base: BASE,
  server: {
    port: 5173,
    proxy: {
      '/tests': {
        target: PROXY_TARGET,
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
