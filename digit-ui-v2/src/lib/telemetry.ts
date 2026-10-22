/**
 * Telemetry Utilities
 *
 * Unified interface for tracking events, errors, and user actions
 * using PostHog (analytics) and Sentry (error tracking).
 */

import posthog from 'posthog-js';
import * as Sentry from '@sentry/react';

// PostHog only once main.tsx started it, which it does only when the build set
// VITE_POSTHOG_KEY; posthog-js logs an error for every call made before init.
const ph = () => (posthog.__loaded ? posthog : undefined);

// ============================================
// User Identification
// ============================================

export interface TelemetryUser {
  id: string;
  name: string;
  email?: string;
  tenant: string;
  roles?: string[];
}

/**
 * Identify the current user for analytics and error tracking
 */
export function identifyUser(user: TelemetryUser) {
  // PostHog identification
  ph()?.identify(user.id, {
    name: user.name,
    email: user.email,
    tenant: user.tenant,
    roles: user.roles?.join(', '),
  });

  // Sentry user context
  Sentry.setUser({
    id: user.id,
    username: user.name,
    email: user.email,
  });

  // Sentry tags for filtering
  Sentry.setTag('tenant', user.tenant);
  if (user.roles?.length) {
    Sentry.setTag('role', user.roles[0]);
  }
}

/**
 * Clear user identification (on logout)
 */
export function clearUser() {
  ph()?.reset();
  Sentry.setUser(null);
}

// ============================================
// Event Tracking
// ============================================

export type EventName =
  // Navigation
  | 'page_view'
  | 'navigation'
  // Authentication
  | 'login'
  | 'logout'
  | 'session_restored'
  // Entity Actions
  | 'entity_view'
  | 'entity_create'
  | 'entity_update'
  | 'entity_delete'
  | 'entity_export'
  | 'entity_import'
  // Search & Filter
  | 'search'
  | 'filter_apply'
  // Onboarding
  | 'phase_start'
  | 'phase_complete'
  | 'onboarding_complete'
  // Errors
  | 'api_error'
  | 'validation_error'
  // UI Interactions
  | 'help_open'
  | 'docs_click'
  | 'mode_switch'
  // Audit
  | 'audit_run'
  | 'audit_complete';

interface EventProperties {
  [key: string]: string | number | boolean | string[] | undefined;
}

/**
 * Track a custom event
 */
export function trackEvent(event: EventName, properties?: EventProperties) {
  ph()?.capture(event, properties);

  // Also add breadcrumb to Sentry for context
  Sentry.addBreadcrumb({
    category: 'user-action',
    message: event,
    data: properties,
    level: 'info',
  });
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
 * Capture an error with context
 */
export function captureError(error: Error, context?: ErrorContext) {
  // Send to Sentry
  Sentry.captureException(error, {
    extra: context,
  });

  // Also track in PostHog
  ph()?.capture('error', {
    error_message: error.message,
    error_name: error.name,
    ...context,
  });
}

/**
 * Capture an API error
 */
export function captureApiError(
  endpoint: string,
  status: number,
  message: string,
  requestBody?: unknown
) {
  const error = new Error(`API Error: ${status} - ${message}`);

  Sentry.captureException(error, {
    extra: {
      endpoint,
      status,
      message,
      requestBody: requestBody ? JSON.stringify(requestBody).slice(0, 1000) : undefined,
    },
    tags: {
      api_endpoint: endpoint,
      http_status: status.toString(),
    },
  });

  ph()?.capture('api_error', {
    endpoint,
    status,
    message,
  });
}

// ============================================
// Performance Tracking
// ============================================

/**
 * Start a performance measurement
 */
export function startMeasure(name: string): () => void {
  const start = performance.now();

  return () => {
    const duration = performance.now() - start;
    ph()?.capture('performance', {
      metric_name: name,
      duration_ms: Math.round(duration),
    });
  };
}

/**
 * Track page load performance
 */
export function trackPagePerformance() {
  if (typeof window !== 'undefined' && window.performance) {
    const timing = performance.timing;
    const loadTime = timing.loadEventEnd - timing.navigationStart;
    const domReady = timing.domContentLoadedEventEnd - timing.navigationStart;

    ph()?.capture('page_performance', {
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
  return ph()?.isFeatureEnabled(flagName) ?? false;
}

/**
 * Get feature flag value
 */
export function getFeatureFlag<T>(flagName: string): T | undefined {
  return ph()?.getFeatureFlag(flagName) as T | undefined;
}

// ============================================
// Session Recording (PostHog)
// ============================================

/**
 * Start session recording
 */
export function startRecording() {
  ph()?.startSessionRecording();
}

/**
 * Stop session recording
 */
export function stopRecording() {
  ph()?.stopSessionRecording();
}

// ============================================
// Debug Mode
// ============================================

/**
 * Enable debug mode for development
 */
export function enableDebugMode() {
  ph()?.debug();
  console.log('[Telemetry] Debug mode enabled');
}

// ============================================
// Export PostHog and Sentry for direct access
// ============================================

export { posthog, Sentry };
