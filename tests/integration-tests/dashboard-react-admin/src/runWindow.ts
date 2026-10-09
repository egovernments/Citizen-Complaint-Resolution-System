/**
 * Run-window paging, shared by the tests list, the test page and the home
 * dashboard.
 *
 * catalog.json keeps results for the newest 30 runs (build-catalog's
 * DEFAULT_HISTORY_LIMIT); the dashboard shows them PAGE_SIZE at a time, newest
 * first. Page 0 is the newest five. The page is kept for the browser tab
 * (sessionStorage, see RunPager.tsx) together with the newest run it was
 * picked against, and goes back to the newest runs once a newer run arrives
 * (pageFor). Pure functions only (no React, no import.meta) so
 * scripts/dashboard-run-window.test.ts can run them under Node. The vanilla
 * dashboard pages the same way in dashboard/run-window.js.
 */
import type { CatalogTest, HistoryEntry, RunSlot, RunSummary } from './types';

export const PAGE_SIZE = 5;

/** sessionStorage key for the current page: a StoredRunPage as JSON. */
export const RUN_PAGE_STORAGE_KEY = 'digit-tests.runWindow';

/** What is stored: the page (0 = newest runs) and the newest run when it was picked. */
export interface StoredRunPage {
  page: number;
  lastRunId: string;
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil((total || 0) / PAGE_SIZE));
}

/** A page index that exists for `total` runs: 0 for junk, the oldest page if too far. */
export function clampPage(page: number, total: number): number {
  const p = Math.floor(Number(page));
  if (!Number.isFinite(p) || p < 0) return 0;
  return Math.min(p, pageCount(total) - 1);
}

/**
 * The page to show, from the stored value (raw JSON, or null when nothing is
 * stored): the stored page while `lastRunId` (the catalog's newest run) is
 * still the run it was picked against, else 0. Each new run shifts every
 * page by one run, and the status column always describes the newest run, so
 * a page kept across runs would show other runs than the ones picked.
 */
export function pageFor(raw: string | null, lastRunId: string | undefined, total: number): number {
  if (!raw || !lastRunId) return 0;
  let stored: Partial<StoredRunPage> | null;
  try {
    stored = JSON.parse(raw) as Partial<StoredRunPage> | null;
  } catch {
    return 0;
  }
  return stored && stored.lastRunId === lastRunId ? clampPage(stored.page as number, total) : 0;
}

export interface RunWindow<T> {
  page: number;
  pages: number;
  total: number;
  /** 1-based position of the first/last run shown (0 when there are none). */
  first: number;
  last: number;
  items: T[];
  hasNewer: boolean;
  hasOlder: boolean;
  /** "runs 6–10 of 30" */
  label: string;
}

/**
 * One page of a newest-first list: catalog.runs, or a test's runSlots (which
 * dataProvider aligns to catalog.runs, so the same page means the same runs).
 */
export function windowOf<T>(items: readonly T[], page: number): RunWindow<T> {
  const all = items ?? [];
  const total = all.length;
  const p = clampPage(page, total);
  const start = p * PAGE_SIZE;
  const slice = all.slice(start, start + PAGE_SIZE);
  return {
    page: p,
    pages: pageCount(total),
    total,
    first: total ? start + 1 : 0,
    last: start + slice.length,
    items: slice,
    hasNewer: p > 0,
    hasOlder: p < pageCount(total) - 1,
    label: total ? `runs ${start + 1}–${start + slice.length} of ${total}` : 'no runs',
  };
}

/**
 * Does this run still have runs/<id>/ (report, videos, traces, run.log)?
 * Catalogs written before build-catalog recorded it lack the field; every run
 * in them still had its folder.
 */
export function hasReport(run: Pick<RunSummary, 'hasReport'> | undefined | null): boolean {
  return !!run && run.hasReport !== false;
}

/** Runs that keep their report, i.e. the RUN_LIMIT the box prunes to. */
export function reportsKept(runs: readonly RunSummary[]): number {
  return runs.filter(hasReport).length;
}

/** A run's standalone Playwright report, relative to the app base (urls.rootedUrl roots it). */
export function reportPath(runId: string): string {
  return `runs/${runId}/playwright-report/index.html`;
}

/** Where a run's "Report" link points, or null once its report was pruned (render "report pruned"). */
export function runReportPath(run: Pick<RunSummary, 'id' | 'hasReport'> | undefined | null): string | null {
  return run && hasReport(run) ? reportPath(run.id) : null;
}

/** One row of the test page's run history (RunHistoryBlock). */
export interface HistoryRow {
  runId: string;
  /** The test's result in that run; null when it produced none ("not run"). */
  entry: HistoryEntry | null;
  /** The run's report, or null once it was pruned: no link, "report pruned". */
  reportPath: string | null;
  /** This is the run whose video/trace the catalog keeps for the test (latestRun). */
  hasMedia: boolean;
  /** ...and that run is the latest one; otherwise it is the carried-over last result. */
  isLatest: boolean;
}

/**
 * The test page's run history for one page of the run window: a row per run,
 * newest first, aligned to catalog.runs through test.runSlots.
 */
export function historyRows(
  test: Pick<CatalogTest, 'runSlots' | 'latestRun' | 'ranInLatestRun'>,
  runs: readonly RunSummary[],
  page: number,
): HistoryRow[] {
  const byId = new Map(runs.map(run => [run.id, run]));
  return windowOf(test.runSlots ?? [], page).items.map(slot => {
    const entry = 'notRun' in slot ? null : slot;
    const path = runReportPath(byId.get(slot.runId));
    const hasMedia = !!entry && !!path && test.latestRun?.runId === slot.runId;
    return { runId: slot.runId, entry, reportPath: path, hasMedia, isLatest: hasMedia && !!test.ranInLatestRun };
  });
}

/**
 * One slot per run id, in the same order: the test's history entry for that
 * run, or a not-run marker when it produced no verdict there ('interrupted',
 * written by older builders, reached none either).
 */
export function slotsFor(test: Pick<CatalogTest, 'history'>, runIds: readonly string[]): RunSlot[] {
  return runIds.map(id => {
    const h = test.history.find(x => x.runId === id);
    return h && h.status !== 'interrupted' ? h : { runId: id, notRun: true as const };
  });
}

export interface RecentSummary {
  runs: number;
  passed: number;
  /** failed or timed out */
  failed: number;
  skipped: number;
  notRun: number;
}

/** Tally run slots: how often the test passed, failed (incl. timed out), was skipped or had no result. */
export function summarize(slots: readonly RunSlot[]): RecentSummary {
  const out: RecentSummary = { runs: 0, passed: 0, failed: 0, skipped: 0, notRun: 0 };
  for (const s of slots) {
    out.runs++;
    if ('notRun' in s) out.notRun++;
    else if (s.status === 'passed') out.passed++;
    else if (s.status === 'skipped') out.skipped++;
    else out.failed++;
  }
  return out;
}
