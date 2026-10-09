/* Run-window paging for the vanilla dashboard (app.js).
 *
 * catalog.json keeps results for the newest 30 runs (build-catalog's
 * HISTORY_LIMIT); the dashboard shows them PAGE_SIZE at a time, newest first.
 * Page 0 is the newest five. Pure functions, no DOM: loaded by index.html
 * before app.js (window.RunWindow) and by scripts/dashboard-run-window.test.ts
 * under Node (module.exports). The react-admin dashboard has the same rules in
 * dashboard-react-admin/src/runWindow.ts.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RunWindow = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PAGE_SIZE = 5;

  function pageCount(total) {
    return Math.max(1, Math.ceil((total || 0) / PAGE_SIZE));
  }

  /** A page index that exists for `total` runs: 0 for junk, the oldest page if too far. */
  function clampPage(page, total) {
    const p = Math.floor(Number(page));
    if (!Number.isFinite(p) || p < 0) return 0;
    return Math.min(p, pageCount(total) - 1);
  }

  /**
   * The runs on one page plus what the pager needs. `runs` is catalog.runs
   * (newest first). `label` is the "runs X–Y of N" indicator, 1-based.
   */
  function windowOf(runs, page) {
    const all = runs || [];
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
      runs: slice,
      hasNewer: p > 0,
      hasOlder: p < pageCount(total) - 1,
      label: total ? `runs ${start + 1}–${start + slice.length} of ${total}` : 'no runs',
    };
  }

  /**
   * Does this run still have runs/<id>/ (report, videos, traces, run.log)?
   * Catalogs written before build-catalog recorded it lack the field; every
   * run in them still had its folder.
   */
  function hasReport(run) {
    return !!run && run.hasReport !== false;
  }

  /** Runs that keep their report, i.e. the RUN_LIMIT the box prunes to. */
  function reportsKept(runs) {
    return (runs || []).filter(hasReport).length;
  }

  /** `?runs=3` → page 2. Missing or junk → 0 (the newest runs). */
  function parsePageParam(search) {
    const v = new URLSearchParams(search || '').get('runs');
    const n = v === null ? NaN : parseInt(v, 10);
    return Number.isFinite(n) && n > 1 ? n - 1 : 0;
  }

  /** `search` with the runs page set (1-based); the newest page drops the param. */
  function withPageParam(search, page) {
    const params = new URLSearchParams(search || '');
    if (page > 0) params.set('runs', String(page + 1));
    else params.delete('runs');
    const s = params.toString();
    return s ? `?${s}` : '';
  }

  /**
   * One slot per run in `windowRuns`, in the same order: the test's history
   * entry for that run, or { runId, notRun: true } when it produced no verdict
   * there ('interrupted', written by older builders, reached none either).
   */
  function slotsFor(test, windowRuns) {
    const history = (test && test.history) || [];
    return (windowRuns || []).map(run => {
      const h = history.find(x => x.runId === run.id);
      return h && h.status !== 'interrupted' ? h : { runId: run.id, notRun: true };
    });
  }

  /**
   * The test's record across every run in `runs` (all the catalog keeps, not
   * just the visible page): how often it passed, failed (incl. timed out), was
   * skipped, or produced no result.
   */
  function recentSummary(test, runs) {
    const out = { runs: 0, passed: 0, failed: 0, skipped: 0, notRun: 0 };
    for (const slot of slotsFor(test, runs)) {
      out.runs++;
      if (slot.notRun) out.notRun++;
      else if (slot.status === 'passed') out.passed++;
      else if (slot.status === 'skipped') out.skipped++;
      else out.failed++;
    }
    return out;
  }

  return { PAGE_SIZE, pageCount, clampPage, windowOf, hasReport, reportsKept, parsePageParam, withPageParam, slotsFor, recentSummary };
});
