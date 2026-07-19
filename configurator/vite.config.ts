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
    },
  },
  server: {
    allowedHosts: ['crs-mockup.egov.theflywheel.in'],
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
    },
  },
})
