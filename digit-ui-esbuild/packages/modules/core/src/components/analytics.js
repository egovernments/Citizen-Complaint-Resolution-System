/**
 * Safe wrapper over the portal's analytics shim (CCRS#2007), as
 * products/pgr/src/utils/analytics.js is for the complaint module.
 *
 * Controls are tagged with `data-analytics-event`, which the shim's click
 * listener picks up; this is for what a click listener cannot see. Always
 * safe to call: the shim may be absent, and it is a no-op until an admin
 * enables a destination.
 */
export function trackEvent(name, props) {
  try {
    if (typeof window === "undefined") return;
    const api = window.DigitAnalytics;
    if (!api || typeof api.trackEvent !== "function") return;
    api.trackEvent(name, props || {});
  } catch (e) {
    /* Deliberately swallowed: telemetry must never break the page. */
  }
}

export default trackEvent;
