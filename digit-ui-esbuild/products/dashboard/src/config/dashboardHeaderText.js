/**
 * The dashboard header's title and "<ward> · <period>" context line, as plain
 * functions shared by DashboardHeader and the export (#1977).
 */

import { GEOGRAPHY_OPTIONS } from "./globalFilterGroups";
import { dimensionLabel } from "../i18n/dimensionLabel";

/**
 * Render a filter ISO date (yyyy-mm-dd) in the ACTIVE locale's numeric order —
 * hardcoding `${m}/${d}/${y}` printed US dates under every locale (06/13/2026
 * where French expects 13/06/2026). `language` is the DIGIT locale
 * (en_IN / fr_FR); underscore→hyphen makes it a BCP 47 tag.
 */
export function formatDisplayDate(iso, language) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return iso;
  const opts = { day: "2-digit", month: "2-digit", year: "numeric" };
  try {
    return date.toLocaleDateString(language?.replace("_", "-"), opts);
  } catch (e) {
    // Malformed stored locale tag — let the browser default decide.
    return date.toLocaleDateString(undefined, opts);
  }
}

/** The ward part of the header's context line ("All Localities" when unfiltered). */
export function headerGeographyLabel(filters, filterOptions, t) {
  const geoOptions = filterOptions?.geography ?? GEOGRAPHY_OPTIONS;
  const geoId = filters?.geography;
  // The geography chip is a raw boundary code — route it through the
  // dimension-label seam; the "all" sentinel renders its localized label.
  return geoId && geoId !== "all"
    ? dimensionLabel(geoId, "boundary")
    : geoOptions.find((o) => o.id === geoId)?.label ??
        t("DASHBOARD_HEADER_ALL_LOCALITIES", "All Localities");
}

/** The period part of the header's context line. */
export function headerPeriodLabel(filters, t, language) {
  if (filters?.dateFrom && filters?.dateTo) {
    return `${formatDisplayDate(filters.dateFrom, language)} – ${formatDisplayDate(filters.dateTo, language)}`;
  }
  return t("DASHBOARD_HEADER_LAST_7_DAYS", "Last 7 days");
}

export function buildSubtitle(filters, filterOptions, t, language) {
  return `${headerGeographyLabel(filters, filterOptions, t)} · ${headerPeriodLabel(filters, t, language)}`;
}

// ONE full-phrase key wins when seeded — splicing the DASHBOARD_PRODUCT_LABEL
// globalConfig onto a translated "Operations" produced mixed-language titles
// ("Complaint Resolution Opérations"); word order/agreement can't survive
// per-word translation. The legacy composition stays as the unseeded fallback,
// so tenants that brand via DASHBOARD_PRODUCT_LABEL and don't seed
// DASHBOARD_HEADER_TITLE keep their branded English title; branded tenants
// that localize should carry the brand inside the seeded message itself.
export function dashboardTitle(t, exists, productLabel) {
  return exists("DASHBOARD_HEADER_TITLE")
    ? t("DASHBOARD_HEADER_TITLE", "Complaint Resolution Operations")
    : productLabel.toLowerCase().includes("pgr")
    ? t("DASHBOARD_HEADER_PGR_OPERATIONS", "PGR Operations")
    : `${productLabel} ${t("DASHBOARD_HEADER_OPERATIONS", "Operations")}`;
}
