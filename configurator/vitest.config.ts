import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Same as vite.config.ts: test the package source, not a dist that lags
      // `npm run build` in packages/data-provider (or doesn't exist in CI).
      '@digit-mcp/data-provider': path.resolve(__dirname, './packages/data-provider/src/index.ts'),
    },
  },
});
