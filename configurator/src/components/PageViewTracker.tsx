/**
 * PageViewTracker
 *
 * Tracks page views using PostHog when routes change.
 * Must be used inside a Router component.
 */

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import posthog from 'posthog-js';

export default function PageViewTracker() {
  const location = useLocation();

  useEffect(() => {
    // Track page view on route change
    posthog.capture('$pageview', {
      $current_url: window.location.href,
      path: location.pathname,
      search: location.search,
    });
  }, [location]);

  return null;
}
