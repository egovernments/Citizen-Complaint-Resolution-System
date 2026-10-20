import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import posthog from 'posthog-js'
import './index.css'
import App from './App.tsx'
import { isTelemetryKilled } from './lib/telemetryGate'
import { scrubCapture, startMatomo } from './lib/analytics'
import { scrubSentryBreadcrumb, scrubSentryEvent } from './lib/sentryScrub'
import { resolveConfig } from './api/runtimeConfig'

// Ops kill switch for this app's own telemetry. Absent flag => NOT killed, so
// every already-deployed environment behaves exactly as before; see
// src/lib/telemetryGate.ts for the three ways to switch it off. The error
// boundary and profiler wrapper below stay unconditional so the fallback UI
// still renders when telemetry is off.
if (!isTelemetryKilled()) {
  // Where this console's telemetry goes is the deployment's choice: config.js
  // (the deploy renders it from the inventory) or VITE_* at build time. Without
  // a value that one stays off; the repo carries no project of its own.
  const sentryDsn = resolveConfig('SENTRY_DSN', import.meta.env.VITE_SENTRY_DSN)
  const posthogKey = resolveConfig('POSTHOG_KEY', import.meta.env.VITE_POSTHOG_KEY)

  // Initialize Sentry for error tracking. No personal data: no IP, cookies or
  // user details by default, replays masked, and anything in an error that
  // looks like an email or a phone number masked before it is sent.
  if (sentryDsn) {
    Sentry.init({
      dsn: sentryDsn,
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true }),
      ],
      // Performance Monitoring
      tracesSampleRate: 1.0, // Capture 100% of transactions
      // Session Replay
      replaysSessionSampleRate: 0.1, // Sample 10% of sessions
      replaysOnErrorSampleRate: 1.0, // Sample 100% of sessions with errors
      sendDefaultPii: false,
      beforeSend: scrubSentryEvent,
      beforeBreadcrumb: scrubSentryBreadcrumb,
      environment: import.meta.env.MODE,
    })
  }

  // Initialize PostHog for analytics: only the tracking plan's events
  // (src/lib/analytics.ts) and page views, with URLs scrubbed of ids and
  // queries. No autocapture, which records the text of what was clicked, and
  // no session recording.
  if (posthogKey) {
    posthog.init(posthogKey, {
      api_host: resolveConfig('POSTHOG_HOST', import.meta.env.VITE_POSTHOG_HOST) || 'https://us.i.posthog.com',
      person_profiles: 'identified_only',
      // PageViewTracker sends every page view, the first included.
      capture_pageview: false,
      capture_pageleave: true,
      autocapture: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      disable_session_recording: true,
      enable_recording_console_log: false,
      disable_surveys: true,
      respect_dnt: true,
      before_send: scrubCapture,
    })
    posthog.register({ app: 'console' })
  }
  void startMatomo()
}

// Wrap App with Sentry Error Boundary
const SentryApp = Sentry.withProfiler(App)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary
      fallback={({ error, resetError }) => (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="max-w-md p-8 bg-white rounded-lg shadow-lg text-center">
            <h1 className="text-2xl font-bold text-red-600 mb-4">Something went wrong</h1>
            <p className="text-gray-600 mb-4">
              An error occurred. Our team has been notified.
            </p>
            <pre className="text-xs text-left bg-gray-100 p-4 rounded mb-4 overflow-auto max-h-32">
              {(error as Error)?.message || 'Unknown error'}
            </pre>
            <button
              onClick={resetError}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Try Again
            </button>
          </div>
        </div>
      )}
    >
      <SentryApp />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
