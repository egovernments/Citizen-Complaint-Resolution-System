/* Run-window paging for the vanilla dashboard (app.js).
 *
 * catalog.json keeps results for the newest 30 runs (build-catalog's
 * DEFAULT_HISTORY_LIMIT); the dashboard shows them PAGE_SIZE at a time, newest
 * first. A window is named by its start: 0 is the newest five, and the URL
 * names any other window by the id of its newest run (?runs=<id>), so a shared
 * link keeps showing the same runs after newer ones arrive. Pure functions, no
 * DOM: loaded by index.html before app.js (window.RunWindow) and by
 * scripts/dashboard-run-window.test.ts under Node (module.exports). The
 * react-admin dashboard pages the same way in dashboard-react-admin/src/runWindow.ts.
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

  /** A start position that exists for `total` runs: 0 for junk, the oldest run at most. */
  function clampStart(start, total) {
    const s = Math.floor(Number(start));
    if (!Number.isFinite(s) || s < 0) return 0;
    return Math.min(s, Math.max(0, (total || 0) - 1));
  }

  /**
   * Up to PAGE_SIZE runs starting at position `start` of `runs` (catalog.runs,
   * newest first; 0 = the newest runs), plus what the pager needs. `label` is
   * the "runs X–Y of N" indicator, 1-based. Newer/Older move the start by
   * PAGE_SIZE.
   */
  function windowAt(runs, start) {
    const all = runs || [];
    const total = all.length;
    const s = clampStart(start, total);
    const slice = all.slice(s, s + PAGE_SIZE);
    return {
      start: s,
      pages: pageCount(total),
      total,
      first: total ? s + 1 : 0,
      last: s + slice.length,
      runs: slice,
      hasNewer: s > 0,
      hasOlder: s + PAGE_SIZE < total,
      label: total ? `runs ${s + 1}–${s + slice.length} of ${total}` : 'no runs',
    };
  }

  /** Page `page` of five (0 = newest): the window at page * PAGE_SIZE. */
  function windowOf(runs, page) {
    const p = clampPage(page, (runs || []).length);
    return Object.assign(windowAt(runs, p * PAGE_SIZE), { page: p });
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

  /** A run summary written before not-run tracking: its counts may include carried-over results. */
  function isLegacyCount(run) {
    return typeof run.notRun !== 'number';
  }

  /** A run's standalone Playwright report, relative to the dashboard. */
  function reportPath(runId) {
    return `runs/${runId}/playwright-report/index.html`;
  }

  /**
   * What the top bar's chip for `run` shows. It links to the run's report only
   * while the run still has one (href null = render plain text); a pruned run
   * keeps its counts and says "report pruned". Text is unescaped.
   */
  function runChip(run, latestId) {
    const pruned = !hasReport(run);
    const legacy = isLegacyCount(run);
    const latest = run.id === latestId;
    return {
      href: pruned ? null : reportPath(run.id),
      pruned,
      legacy,
      latest,
      cls: `run-chip${latest ? ' latest' : ''}${legacy ? ' legacy' : ''}${pruned ? ' pruned' : ''}`,
      label: `${latest ? '★ ' : ''}${String(run.id).split('_').slice(0, 2).join(' ')}`,
      stats: `${legacy ? '≈' : ''}${run.passed}/${run.total} pass${run.cutShort ? ' ⚠' : ''}${pruned ? ' · report pruned' : ''}`,
    };
  }

  /**
   * The detail pane's "Open Playwright report" target for a test's latestRun,
   * or null. build-catalog only keeps latestRun pointers into runs that still
   * have a report, so this is null only when the catalog lists the run as
   * pruned; a run the catalog doesn't list (older catalogs) keeps its link.
   */
  function latestRunReportPath(latestRun, runs) {
    if (!latestRun || !latestRun.runId) return null;
    const run = (runs || []).find(r => r.id === latestRun.runId);
    return run && !hasReport(run) ? null : reportPath(latestRun.runId);
  }

  /** Run ids are minted as YYYY-MM-DD_HHMM_<sha> (UTC), so they sort by age. */
  const RUN_ID = /^\d{4}-\d{2}-\d{2}_/;

  /**
   * The window a URL asks for, as a start position in `runs` (catalog.runs):
   *   ?runs=<run id>  the window starting at that run. A run the catalog no
   *                   longer keeps resolves to the newest kept run before it,
   *                   which for a run that aged out is the oldest window.
   *   ?runs=<n>       page n of five, as written before run ids were used.
   *   none or junk    0, the newest runs.
   */
  function startFromSearch(search, runs) {
    const all = runs || [];
    const v = new URLSearchParams(search || '').get('runs');
    if (!v) return 0;
    if (/^-?\d+$/.test(v)) return clampPage(parseInt(v, 10) - 1, all.length) * PAGE_SIZE;
    const at = all.findIndex(r => r.id === v);
    if (at >= 0) return at;
    if (!RUN_ID.test(v)) return 0;
    const before = all.findIndex(r => String(r.id) < v);
    return before >= 0 ? before : Math.max(0, all.length - PAGE_SIZE);
  }

  /**
   * `search` naming the window that starts at `start`: ?runs=<id of its newest
   * run>. The newest window drops the param, so a plain link always shows the
   * latest runs. Other params are left alone.
   */
  function searchForStart(search, runs, start) {
    const params = new URLSearchParams(search || '');
    const all = runs || [];
    const s = clampStart(start, all.length);
    if (s > 0) params.set('runs', String(all[s].id));
    else params.delete('runs');
    const out = params.toString();
    return out ? `?${out}` : '';
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

  return {
    PAGE_SIZE, pageCount, clampPage, clampStart, windowAt, windowOf, hasReport, reportsKept, isLegacyCount, reportPath,
    runChip, latestRunReportPath, startFromSearch, searchForStart, slotsFor, recentSummary,
  };
});
