/**
 * Telemetry Utilities
 *
 * Who the admin is (pseudonymously), errors and feature flags, for PostHog
 * and Sentry. Product events go through ./analytics.
 */

import posthog from 'posthog-js';
import * as Sentry from '@sentry/react';
import { isPosthogOn, isTelemetryKilled } from './telemetryGate';

// Every exported function below is gated. Gating only the init calls in main.tsx
// would leave these reachable, and whether posthog-js / @sentry-react silently
// drop calls made before init is not something to rely on.

// ============================================
// User Identification
// ============================================

export interface TelemetryUser {
  /** The DIGIT user's uuid. Only its hash leaves the browser. */
  uuid?: string;
  tenant: string;
  roles?: string[];
}

/** A stable id for the admin that isn't their uuid, email or name. */
export async function pseudonymousId(uuid: string): Promise<string | null> {
  try {
    const bytes = new TextEncoder().encode(`cms-console:${uuid}`);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  } catch {
    // No SubtleCrypto outside a secure context: stay anonymous rather than send the uuid.
    return null;
  }
}

/**
 * Identify the admin by a hash of their uuid, so a funnel can follow them
 * across days without PostHog or Sentry holding who they are. Without a uuid
 * they stay anonymous.
 */
export async function identifyUser(user: TelemetryUser) {
  if (isTelemetryKilled()) return;
  Sentry.setTag('tenant', user.tenant);
  if (user.roles?.length) Sentry.setTag('role', user.roles[0]);
  const id = user.uuid ? await pseudonymousId(user.uuid) : null;
  if (!id || isTelemetryKilled()) return;
  if (isPosthogOn()) posthog.identify(id, { roles: user.roles?.join(', ') });
  Sentry.setUser({ id });
}

/**
 * Clear user identification (on logout)
 */
export function clearUser() {
  if (isTelemetryKilled()) return;
  if (isPosthogOn()) posthog.reset();
  Sentry.setUser(null);
}

// ============================================
// Error Tracking
// ============================================

interface ErrorContext {
  component?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  [key: string]: string | number | boolean | undefined;
}

/**
 * Capture an error with context. Sentry only: product analytics gets the
 * error's code from the caller's own event, never its message.
 */
export function captureError(error: Error, context?: ErrorContext) {
  if (isTelemetryKilled()) return;
  Sentry.captureException(error, {
    extra: context,
  });
}

/**
 * Capture an API error
 */
export function captureApiError(
  endpoint: string,
  status: number,
  message: string,
) {
  if (isTelemetryKilled()) return;
  const error = new Error(`API Error: ${status} - ${message}`);

  Sentry.captureException(error, {
    extra: {
      endpoint,
      status,
    },
    tags: {
      api_endpoint: endpoint,
      http_status: status.toString(),
    },
  });
}

// ============================================
// Performance Tracking
// ============================================

/**
 * Start a performance measurement
 */
export function startMeasure(name: string): () => void {
  if (!isPosthogOn()) return () => {};
  const start = performance.now();

  return () => {
    const duration = performance.now() - start;
    posthog.capture('performance', {
      metric_name: name,
      duration_ms: Math.round(duration),
    });
  };
}

/**
 * Track page load performance
 */
export function trackPagePerformance() {
  if (!isPosthogOn()) return;
  if (typeof window !== 'undefined' && window.performance) {
    const timing = performance.timing;
    const loadTime = timing.loadEventEnd - timing.navigationStart;
    const domReady = timing.domContentLoadedEventEnd - timing.navigationStart;

    posthog.capture('page_performance', {
      load_time_ms: loadTime,
      dom_ready_ms: domReady,
      path: window.location.pathname,
    });
  }
}

// ============================================
// Feature Flags (PostHog)
// ============================================

/**
 * Check if a feature flag is enabled
 */
export function isFeatureEnabled(flagName: string): boolean {
  if (!isPosthogOn()) return false;
  return posthog.isFeatureEnabled(flagName) ?? false;
}

/**
 * Get feature flag value
 */
export function getFeatureFlag<T>(flagName: string): T | undefined {
  if (!isPosthogOn()) return undefined;
  return posthog.getFeatureFlag(flagName) as T | undefined;
}

// ============================================
// Session Recording (PostHog)
// ============================================

/**
 * Start session recording
 */
export function startRecording() {
  if (!isPosthogOn()) return;
  posthog.startSessionRecording();
}

/**
 * Stop session recording
 */
export function stopRecording() {
  if (!isPosthogOn()) return;
  posthog.stopSessionRecording();
}

// ============================================
// Debug Mode
// ============================================

/**
 * Enable debug mode for development
 */
export function enableDebugMode() {
  if (!isPosthogOn()) return;
  posthog.debug();
  console.log('[Telemetry] Debug mode enabled');
}

// ============================================
// Export PostHog and Sentry for direct access
// ============================================

export { posthog, Sentry };
