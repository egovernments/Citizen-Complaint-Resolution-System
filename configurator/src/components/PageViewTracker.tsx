/**
 * PageViewTracker
 *
 * Sends a page view to PostHog and Matomo on every route change, the first
 * included (PostHog's own page view capture is off, so each is counted once).
 * Must be used inside a Router component.
 */

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageView } from '@/lib/analytics';

export default function PageViewTracker() {
  const location = useLocation();

  useEffect(() => {
    // The path only: queries can carry sign-in tokens, and ids are scrubbed inside.
    trackPageView(window.location.pathname);
  }, [location.pathname]);

  return null;
}
