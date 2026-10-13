/**
 * What the dashboard derives from catalog.json once per load. Pure functions
 * only (no React, no import.meta), so scripts/dashboard-normalize.test.ts can
 * run them under Node.
 */
import type { Catalog, CatalogTest, CurrentStatus, TestStatus } from './types';

/** Run slots shown per test: the builder keeps the same 5-run window. */
export const RUN_WINDOW = 5;

/**
 * Status column order, most urgent first (an ascending sort on statusRank):
 * a red result, then no verdict at all (coverage this run lost), then a skip
 * (it ran but proved nothing), then a pass. An excluded test is outside the
 * run total, so it comes last. 'interrupted' only appears in catalogs from
 * older builders; it reached no verdict, so it sits with "not run".
 */
export const STATUS_SEVERITY: readonly CurrentStatus[] = [
  'failed', 'timedOut', 'interrupted', 'notrun', 'skipped', 'passed', 'excluded',
];

/**
 * Derive, once per load, everything that answers "what happened in the latest
 * run" — so components read one field instead of each re-deriving it from
 * lastStatus (which is only the last KNOWN result, possibly from an older run).
 */
export function normalize(c: Catalog): Catalog {
  const windowIds = c.runs.slice(0, RUN_WINDOW).map(r => r.id); // builder writes newest first
  for (const t of c.tests) {
    if (typeof t.ranInLatestRun !== 'boolean') {
      // Older catalogs: history only gains an entry when the test ran (older
      // builders also wrote one for an interrupted test, which reached no verdict).
      const h0 = t.history[0];
      t.ranInLatestRun = !!h0 && h0.runId === c.lastRunId && h0.status !== 'interrupted';
    }
    if (typeof t.excluded !== 'boolean') {
      // Older catalogs: the builder's exclusion rule back then — an
      // @local-only test with no verdict in the latest run.
      t.excluded = !t.ranInLatestRun && (t.tags || []).includes('@local-only');
    }
    // Bucketed as the run summary counts it, so 'notrun' tests add up to run.notRun.
    t.currentStatus = t.excluded
      ? 'excluded'
      : t.ranInLatestRun && t.lastStatus ? t.lastStatus : 'notrun';
    t.statusRank = STATUS_SEVERITY.indexOf(t.currentStatus);
    t.runSlots = windowIds.map(id => {
      const h = t.history.find(x => x.runId === id);
      return h && h.status !== 'interrupted' ? h : { runId: id, notRun: true as const };
    });
  }
  return c;
}

/**
 * The newest result that reached a verdict, for "last: passed in <run>" on a
 * test the latest run didn't reach. Catalogs from older builders can hold an
 * interrupted lastStatus or history entry, which reached none, so both are
 * skipped. runId is null when nothing says which run it came from.
 */
export function lastKnown(t: CatalogTest): { status: TestStatus; runId: string | null } | null {
  const h = t.history.find(x => x.status !== 'interrupted');
  if (t.lastStatus && t.lastStatus !== 'interrupted') {
    return { status: t.lastStatus, runId: t.latestRun?.runId ?? h?.runId ?? null };
  }
  return h ? { status: h.status, runId: h.runId } : null;
}
