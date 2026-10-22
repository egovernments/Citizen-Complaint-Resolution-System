/**
 * Kill switch for the Configurator's OWN telemetry.
 *
 * The Configurator starts PostHog and Sentry at module scope, before login,
 * when its deployment gives it a key (config.js or VITE_* at build time; see
 * main.tsx). This module does not change that default — it gives operators a
 * way to switch it off without a rebuild, and gives every call site one
 * predicate to consult.
 *
 * POLARITY: absent flag, absent file, unreadable storage and any thrown error
 * all mean NOT KILLED. That is deliberate. Every environment currently running
 * this app is sending telemetry today, so defaulting to "off" here would
 * silently change behaviour on machines nobody has looked at. Turning it off is
 * an explicit act.
 *
 * NOTE this is the opposite polarity to the analytics registry in the portal
 * (digit-ui-esbuild/public/analytics.js), which is off until data says otherwise.
 * The two are different questions: there, nothing is configured yet and silence
 * is the safe default; here, something is already running and surprising a live
 * environment is the bigger risk. Routing this app's telemetry through the MDMS
 * registry is a separate piece of work.
 *
 * Three ways to switch it off, most local first:
 *   1. a single browser        — localStorage['digit.analytics.off'] = '1'
 *      (the same key the portal shim honours, so one action covers both)
 *   2. a whole environment     — edit /var/www/configurator/telemetry-config.js
 *      on the box: `window.__CFG_TELEMETRY__ = { kill: true }`. Reverted by the
 *      next deploy, which rsyncs dist over it.
 *   3. permanently for a build — VITE_CFG_TELEMETRY_KILL=true at build time.
 */

import posthog from 'posthog-js';

declare global {
  interface Window {
    __CFG_TELEMETRY__?: { kill?: boolean };
  }
}

/** True when telemetry has been explicitly switched off. */
export function isTelemetryKilled(): boolean {
  // 1. per-browser opt-out, shared with the portal shim.
  try {
    if (typeof window !== 'undefined' && window.localStorage?.getItem('digit.analytics.off') === '1') {
      return true;
    }
  } catch {
    /* storage can throw in a locked-down or partitioned context */
  }

  // 2. runtime flag from public/telemetry-config.js.
  try {
    if (typeof window !== 'undefined' && window.__CFG_TELEMETRY__?.kill === true) return true;
  } catch {
    /* ignore */
  }

  // 3. build-time flag.
  try {
    if (import.meta.env?.VITE_CFG_TELEMETRY_KILL === 'true') return true;
  } catch {
    /* ignore */
  }

  return false;
}

/** Convenience inverse, for readability at call sites. */
export function isTelemetryEnabled(): boolean {
  return !isTelemetryKilled();
}

/**
 * True when PostHog is running: telemetry is on and main.tsx started it with
 * this deployment's key. Without a key it is never started, and posthog-js logs
 * an error for every call made before init, so PostHog calls check this.
 */
export function isPosthogOn(): boolean {
  return !isTelemetryKilled() && posthog.__loaded === true;
}
