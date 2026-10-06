/**
 * PageViewTracker
 *
 * Tracks page views using PostHog when routes change.
 * Must be used inside a Router component.
 */

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import posthog from 'posthog-js';
import { isTelemetryKilled } from '@/lib/telemetryGate';

export default function PageViewTracker() {
  const location = useLocation();

  useEffect(() => {
    // This capture does NOT go through lib/telemetry, so it needs the gate
    // explicitly — otherwise switching telemetry off would still leak a page
    // view on every route change.
    if (isTelemetryKilled()) return;
    // Track page view on route change
    posthog.capture('$pageview', {
      $current_url: window.location.href,
      path: location.pathname,
      search: location.search,
    });
  }, [location]);

  return null;
}
