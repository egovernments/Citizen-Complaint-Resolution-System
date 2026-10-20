import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import posthog from 'posthog-js'
import './index.css'
import App from './App.tsx'

// Where telemetry goes is the build's choice (VITE_SENTRY_DSN, VITE_POSTHOG_KEY,
// VITE_POSTHOG_HOST); without a value that one stays off.
const sentryDsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim()
const posthogKey = (import.meta.env.VITE_POSTHOG_KEY as string | undefined)?.trim()

// Initialize Sentry for error tracking
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
    ],
    // Performance Monitoring
    tracesSampleRate: 1.0, // Capture 100% of transactions
    // Session Replay
    replaysSessionSampleRate: 0.1, // Sample 10% of sessions
    replaysOnErrorSampleRate: 1.0, // Sample 100% of sessions with errors
    // Send default PII data
    sendDefaultPii: true,
    environment: import.meta.env.MODE,
  })
}

// Initialize PostHog for analytics
if (posthogKey) {
  posthog.init(posthogKey, {
    api_host: (import.meta.env.VITE_POSTHOG_HOST as string | undefined)?.trim() || 'https://us.i.posthog.com',
    person_profiles: 'identified_only',
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
    // Respect Do Not Track
    respect_dnt: true,
    // Enable session recording
    enable_recording_console_log: true,
  })
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
