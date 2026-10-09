/**
 * The catalog stores attachment URLs relative to the dashboard root (e.g.
 * 'runs/<id>/test-results/.../video.webm'). Browsers resolve such relative
 * URLs against the *current page* URL, which under react-router becomes
 * '/tests-v2/tests/<id>/show' and yields broken paths. Anchor every URL
 * to import.meta.env.BASE_URL so relatives behave like '/tests-v2/runs/...'.
 */
export function rootedUrl(rel: string | null | undefined): string | undefined {
  if (!rel) return undefined;
  if (/^https?:\/\//i.test(rel)) return rel;
  if (rel.startsWith('/')) return rel;
  const base = import.meta.env.BASE_URL || '/';
  return `${base}${rel}`.replace(/\/{2,}/g, '/');
}

/** A run's standalone Playwright HTML report (only valid while the run has its report). */
export function reportUrl(runId: string): string | undefined {
  return rootedUrl(`runs/${runId}/playwright-report/index.html`);
}
