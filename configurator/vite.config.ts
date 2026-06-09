import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Allow VITE_DESIGNER_UPSTREAM to point at the deployed Bomet/Nairobi designer
  // host during dev (e.g. `https://bometfeedbackhub.digit.org`). When set, we
  // proxy `/designer/` to that host so the iframe loads without CORS/redirect
  // gymnastics. In production builds the iframe just hits `/designer/` on the
  // same nginx that serves the configurator.
  const env = loadEnv(mode, process.cwd(), '')
  const designerUpstream = env.VITE_DESIGNER_UPSTREAM

  return {
    base: '/configurator/',
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      allowedHosts: ['crs-mockup.egov.theflywheel.in'],
      proxy: designerUpstream
        ? {
            '/designer': {
              target: designerUpstream,
              changeOrigin: true,
              secure: false,
            },
          }
        : undefined,
    },
  }
})
