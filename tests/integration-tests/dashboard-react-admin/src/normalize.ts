/**
 * What the dashboard derives from catalog.json once per load. Pure functions
 * only (no React, no import.meta), so scripts/dashboard-normalize.test.ts can
 * run them under Node.
 */
import type { Catalog } from './types';

/** Run slots shown per test: the builder keeps the same 5-run window. */
export const RUN_WINDOW = 5;

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
    t.currentStatus = t.ranInLatestRun
      ? (t.lastStatus ?? 'never')
      : (t.lastStatus || t.history.length ? 'notrun' : 'never');
    t.runSlots = windowIds.map(id => {
      const h = t.history.find(x => x.runId === id);
      return h && h.status !== 'interrupted' ? h : { runId: id, notRun: true as const };
    });
  }
  return c;
}
