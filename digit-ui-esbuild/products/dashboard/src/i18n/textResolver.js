import { translate as t, exists } from "./localeRuntime";

/**
 * THE single seam between catalog-descriptor text and display text — the
 * companion of dimensionLabel.js (which covers data VALUES; this file covers
 * the descriptor's own titles, subtitles and series labels). Every place the
 * dashboard renders `viz.title` / `viz.subtitle` / a seriesDefs / stackSeries /
 * channelMap / column label must route through here.
 *
 * Resolution rule (shared with dimensionLabel): a localization KEY wins when
 * its message is seeded; otherwise the DATA-OWNED English from the MDMS
 * KpiDefinition descriptor renders verbatim — a localisation gap surfaces as
 * readable English, and the client never invents translations.
 */

/**
 * Title resolution for the inverted catalog. `titleKey` (a raw
 * CMS-DASHBOARD.DASHBOARD_KPI_* localization code) wins when its message is
 * seeded; otherwise the human `viz.title` from the MDMS def is the source of
 * truth, and the prettified key remains the last-resort fallback — never
 * rendered verbatim.
 */
export function resolveTitle(def) {
  const titleKey = def?.viz?.titleKey || def?.titleKey;
  if (titleKey && exists(titleKey)) return t(titleKey);
  return (
    def?.viz?.title ||
    def?.title ||
    def?.name ||
    prettifyTitleKey(titleKey) ||
    ''
  );
}

/**
 * Subtitle: `viz.subtitleKey` (CMS-DASHBOARD.DASHBOARD_KPI_<ID>_SUBTITLE) wins
 * when seeded, else the legacy viz.subtitle / description / contextLabel chain.
 */
export function resolveSubtitle(viz) {
  const subtitle = viz?.subtitleKey && exists(viz.subtitleKey) ? t(viz.subtitleKey) : viz?.subtitle;
  return subtitle || viz?.description || viz?.contextLabel || '';
}

/**
 * stackSeries / seriesDefs / channelMap / measure-column entries: a `labelKey`
 * (DASHBOARD_SERIES_* / DASHBOARD_WF_STAGE_* / DASHBOARD_CHANNEL_* /
 * DASHBOARD_SLA_* / DASHBOARD_COL_*) wins when seeded, else the descriptor's
 * literal label.
 */
export function seriesEntryLabel(entry, fallback) {
  return entry?.labelKey && exists(entry.labelKey) ? t(entry.labelKey) : fallback;
}

/**
 * Single-series bar charts name their one series via `viz.seriesLabel`
 * ("Filed"); `viz.seriesLabelKey` (DASHBOARD_SERIES_*) wins when seeded.
 */
export function resolveSeriesLabel(viz, fallback) {
  return seriesEntryLabel({ labelKey: viz?.seriesLabelKey }, fallback);
}

function prettifyTitleKey(key) {
  if (!key) return '';
  const tail = String(key).split('.').pop().replace(/^DASHBOARD_KPI_/, '');
  if (!tail) return '';
  return tail
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
