/**
 * Citizen Dashboard — the real PGR dashboard, ported verbatim from the
 * digit-configurator's /manage/pgr-dashboard route. Hits
 * /pgr-services/v2/dashboard same-origin (no auth header required — the
 * endpoint is open) and renders the same KPI cards, trend charts, and
 * tabbed breakdowns operators see today.
 */
export { default } from './PgrDashboard';
