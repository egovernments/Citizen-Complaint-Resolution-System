/**
 * Relative freshness label for the dashboard tile stamp (#2047).
 * Parts are pure so tests do not depend on React or i18n.
 *
 * Each phrase uses a direct t("KEY", "English") call so dashboard-l10n-seed
 * regeneration keeps picking these literals up.
 */

export function updatedAgoParts(asOfMs, nowMs = Date.now()) {
  if (asOfMs == null || !Number.isFinite(asOfMs)) return null;
  const deltaMs = Math.max(0, nowMs - asOfMs);
  const mins = Math.floor(deltaMs / 60_000);
  if (mins < 1) return { unit: "justNow", n: 0 };
  if (mins < 60) return { unit: "min", n: mins };
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return { unit: "hrs", n: hrs };
  return { unit: "days", n: Math.floor(hrs / 24) };
}

function withCount(message, n) {
  return String(message).replace(/\{\{\s*n\s*\}\}/g, String(n));
}

/**
 * @param {number} asOfMs
 * @param {(key: string, seed: string) => string} t
 * @param {number} [nowMs]
 */
export function formatUpdatedAgoLabel(asOfMs, t, nowMs = Date.now()) {
  const parts = updatedAgoParts(asOfMs, nowMs);
  if (!parts) return null;
  if (parts.unit === "justNow")
    return t("DASHBOARD_COMMON_UPDATED_JUST_NOW", "just now");
  if (parts.unit === "min")
    // "min" is the same singular/plural abbreviation in the issue copy.
    return withCount(t("DASHBOARD_COMMON_UPDATED_MIN_AGO", "{{n}} min ago"), parts.n);
  if (parts.unit === "hrs")
    return withCount(
      parts.n === 1
        ? t("DASHBOARD_COMMON_UPDATED_HR_AGO", "{{n}} hr ago")
        : t("DASHBOARD_COMMON_UPDATED_HRS_AGO", "{{n}} hrs ago"),
      parts.n
    );
  return withCount(
    parts.n === 1
      ? t("DASHBOARD_COMMON_UPDATED_DAY_AGO", "{{n}} day ago")
      : t("DASHBOARD_COMMON_UPDATED_DAYS_AGO", "{{n}} days ago"),
    parts.n
  );
}
