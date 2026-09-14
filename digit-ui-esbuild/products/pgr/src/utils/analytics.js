/**
 * Safe wrapper over the portal's analytics shim (CCRS#2007).
 *
 * Most controls are tagged declaratively with `data-analytics-event`, which the
 * shim's click listener picks up. This exists for the events a click listener
 * structurally cannot see: an option chosen inside a menu component, or the
 * outcome of a request that happens long after the click.
 *
 * Always safe to call. The shim is absent entirely when the portal is built
 * without it, and `DigitAnalytics.trackEvent` is itself a no-op until an admin
 * enables a destination — so a call site never has to know whether analytics is
 * switched on, and analytics can never break a journey.
 */
export function trackEvent(name, props) {
  try {
    if (typeof window === "undefined") return;
    const api = window.DigitAnalytics;
    if (!api || typeof api.trackEvent !== "function") return;
    api.trackEvent(name, props || {});
  } catch (e) {
    /* Deliberately swallowed: telemetry must never surface to the citizen. */
  }
}

export default trackEvent;
