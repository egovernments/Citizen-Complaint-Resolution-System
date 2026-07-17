import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Local API proxy → SSH tunnel to Bomet Kong.
// Default 18280 matches: ssh -N -L 18280:127.0.0.1:18000 bomet
// Do NOT use 18000 (host nginx) — that 301s to https://bometfeedbackhub… and CORS-breaks the browser.
const PROXY_TARGET = `http://127.0.0.1:${process.env.PROXY_PORT || '18280'}`

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
