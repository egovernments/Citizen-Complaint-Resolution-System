/**
 * Run-window paging, shared by the tests list, the test page and the home
 * dashboard.
 *
 * catalog.json keeps results for the newest 30 runs (build-catalog's
 * HISTORY_LIMIT); the dashboard shows them PAGE_SIZE at a time, newest first.
 * Page 0 is the newest five. The page lives in the react-admin store
 * (localStorage), so it survives a refresh and moving between views. Pure
 * functions only (no React, no import.meta) so scripts/dashboard-run-window.test.ts
 * can run them under Node. The vanilla dashboard has the same rules in
 * dashboard/run-window.js.
 */
import type { CatalogTest, RunSlot, RunSummary } from './types';

export const PAGE_SIZE = 5;

/** react-admin store key for the current page (0 = newest runs). */
export const RUN_PAGE_STORE_KEY = 'runWindow.page';

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil((total || 0) / PAGE_SIZE));
}

/** A page index that exists for `total` runs: 0 for junk, the oldest page if too far. */
export function clampPage(page: number, total: number): number {
  const p = Math.floor(Number(page));
  if (!Number.isFinite(p) || p < 0) return 0;
  return Math.min(p, pageCount(total) - 1);
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
