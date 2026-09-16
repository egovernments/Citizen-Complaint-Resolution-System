import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  base: '/citizen/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    allowedHosts: ['crs-mockup.egov.theflywheel.in'],
    fs: {
      // `src/config/featureFlags.ts` imports the shared parser from the
      // repo-level `ui-shared/` directory, which sits outside this app's Vite
      // root. Vite's workspace-root autodetection stops at this package (no
      // pnpm/lerna workspace above it), so without this entry `vite dev`
      // answers 403 "outside of Vite serving allow list" for that module.
      // `vite build` is unaffected — this only relaxes the dev-server guard,
      // and only for the two directories the app legitimately reads.
      allow: [
        path.resolve(__dirname),
        path.resolve(__dirname, '../ui-shared'),
      ],
    },
  },
})
