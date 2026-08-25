import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Local Compose Kong defaults to 18000. For an SSH tunnel override:
//   PROXY_PORT=18280 vite
//   ssh -N -L 18280:127.0.0.1:18000 <host>
const PROXY_TARGET = `http://127.0.0.1:${process.env.PROXY_PORT || '18000'}`

const apiProxy = {
  target: PROXY_TARGET,
  changeOrigin: true,
}

// https://vite.dev/config/
export default defineConfig({
  base: '/configurator/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Always the package source — dist lags `npm run build` in the package,
      // and a stale clientFilter is what made /manage/localization show 0 rows
      // against a live dashboard count.
      '@digit-mcp/data-provider': path.resolve(__dirname, './packages/data-provider/src/index.ts'),
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
    proxy: {
      '/user': apiProxy,
      '/mdms-v2': apiProxy,
      '/egov-hrms': apiProxy,
      '/egov-enc-service': apiProxy,
      '/egov-workflow-v2': apiProxy,
      '/boundary-service': apiProxy,
      '/localization': apiProxy,
      '/filestore': apiProxy,
      '/novu-bridge': apiProxy,
      '/turbopass': apiProxy,
      '/pgr-services': apiProxy,
      '/access': apiProxy,
      '/egov-idgen': apiProxy,
    },
  },
})
