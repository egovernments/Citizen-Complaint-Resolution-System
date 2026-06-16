/**
 * Default mobile-number validation values.
 *
 * Historically the codebase duplicated 10-digit Indian mobile defaults
 * (`[6-9][0-9]{9}`, prefix `+91`, length 10) across at least seven call
 * sites. That made it impossible to roll out a non-Indian deployment
 * without either (a) seeding MDMS on every environment or (b) editing
 * every file. This module centralises the fallback so an implementer
 * only has one place to look and one place to patch.
 *
 * Defaults here are used when both globalConfigs and MDMS are unavailable.
 * To override at runtime, prefer in this order:
 *
 *   1. `window.globalConfigs.getConfig("CORE_MOBILE_CONFIGS")` — set
 *      per-deployment in `globalConfigs.js`. Highest priority.
 *   2. MDMS `common-masters.MobileNumberValidation` — the single source of
 *      truth, queried at startup and cached for 5 minutes.
 *   3. These constants — last-resort fallback.
 *
 * See `products/pgr/src/hooks/pgr/useMobileValidation.js` for the
 * resolution code.
 */

/** Full-anchor regex (use with `new RegExp(pattern)`). */
export const DEFAULT_MOBILE_PATTERN = "^[79][0-9]{8}$";

/**
 * Lax (no-anchor) pattern for inbox-style search fields that want to
 * match either an empty string or a mobile number, e.g. `"^$|<lax>"`.
 */
export const DEFAULT_MOBILE_PATTERN_LAX = "[79][0-9]{8}";

/** Displayed as a non-editable prefix on mobile inputs. */
export const DEFAULT_MOBILE_PREFIX = "+251";

export const DEFAULT_MOBILE_MIN_LENGTH = 9;
export const DEFAULT_MOBILE_MAX_LENGTH = 9;

/** First digits accepted by the default pattern. */
export const DEFAULT_MOBILE_ALLOWED_STARTING_DIGITS = ["7", "9"];

/**
 * Raw (non-localised) error message — UIs that have access to the
 * translator should prefer a locale key like
 * `CORE_COMMON_MOBILE_NUMBER_INVALID` instead.
 */
export const DEFAULT_MOBILE_ERROR_MESSAGE =
  "Please enter a valid 9-digit mobile number starting with 7 or 9";
