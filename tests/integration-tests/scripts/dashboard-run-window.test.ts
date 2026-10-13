/**
 * Run-window paging of both dashboards: the vanilla dashboard/run-window.js
 * and the react-admin dashboard-react-admin/src/runWindow.ts get the same
 * cases, so the two stay in step. Also the decisions the views only render:
 * which runs link to a report (none once pruned), the v1 run chips and detail
 * link, the v2 run history rows, and v2 normalize's slot alignment.
 *
 * Run: npm run test:catalog-unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as v2 from '../dashboard-react-admin/src/runWindow';
import { normalize } from '../dashboard-react-admin/src/normalize';
import type { Catalog, CatalogTest, RunSummary } from '../dashboard-react-admin/src/types';

const require = createRequire(__filename);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const v1 = require('../dashboard/run-window.js') as {
  PAGE_SIZE: number;
  pageCount(total: number): number;
  clampPage(page: unknown, total: number): number;
  windowOf<T>(runs: T[], page: unknown): { page: number; pages: number; total: number; first: number; last: number; runs: T[]; hasNewer: boolean; hasOlder: boolean; label: string };
  hasReport(run: unknown): boolean;
  reportsKept(runs: unknown[]): number;
  clampStart(start: unknown, total: number): number;
  windowAt<T>(runs: T[], start: unknown): { start: number; pages: number; total: number; first: number; last: number; runs: T[]; hasNewer: boolean; hasOlder: boolean; label: string };
  startFromSearch(search: string, runs: Array<{ id: string }>): number;
  searchForStart(search: string, runs: Array<{ id: string }>, start: number): string;
  isLegacyCount(run: unknown): boolean;
  reportPath(runId: string): string;
  runChip(run: unknown, latestId: string): { href: string | null; pruned: boolean; legacy: boolean; latest: boolean; cls: string; label: string; stats: string };
  latestRunReportPath(latestRun: unknown, runs: unknown[]): string | null;
  slotsFor(test: unknown, runs: Array<{ id: string }>): Array<Record<string, unknown>>;
  recentSummary(test: unknown, runs: Array<{ id: string }>): { runs: number; passed: number; failed: number; skipped: number; notRun: number };
};

/** Both implementations behind one shape: page items under `items`. */
const impls = [
  { name: 'v1 run-window.js', win: <T,>(runs: T[], page: number) => { const w = v1.windowOf(runs, page); return { ...w, items: w.runs }; }, clamp: v1.clampPage, pages: v1.pageCount, hasReport: v1.hasReport, kept: v1.reportsKept, size: v1.PAGE_SIZE },
  { name: 'v2 runWindow.ts', win: <T,>(runs: T[], page: number) => v2.windowOf(runs, page), clamp: v2.clampPage, pages: v2.pageCount, hasReport: (r: unknown) => v2.hasReport(r as never), kept: v2.reportsKept, size: v2.PAGE_SIZE },
];

const runs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `run-${i + 1}` })); // newest first

for (const impl of impls) {
  test(`${impl.name}: five runs a page`, () => {
    assert.equal(impl.size, 5);
  });

  test(`${impl.name}: 30 runs page as 1–5 … 26–30, newest first`, () => {
    const all = runs(30);
    assert.equal(impl.pages(30), 6);
    const first = impl.win(all, 0);
    assert.deepEqual(first.items.map(r => r.id), ['run-1', 'run-2', 'run-3', 'run-4', 'run-5']);
    assert.equal(first.label, 'runs 1–5 of 30');
    assert.deepEqual([first.hasNewer, first.hasOlder], [false, true]);
    const second = impl.win(all, 1);
    assert.deepEqual(second.items.map(r => r.id), ['run-6', 'run-7', 'run-8', 'run-9', 'run-10']);
    assert.equal(second.label, 'runs 6–10 of 30');
    assert.deepEqual([second.hasNewer, second.hasOlder], [true, true]);
    const last = impl.win(all, 5);
    assert.equal(last.label, 'runs 26–30 of 30');
    assert.deepEqual([last.first, last.last], [26, 30]);
    assert.deepEqual([last.hasNewer, last.hasOlder], [true, false]);
  });

  test(`${impl.name}: a short last page, and pages past the end clamp to it`, () => {
    const all = runs(32);
    assert.equal(impl.pages(32), 7);
    const last = impl.win(all, 6);
    assert.deepEqual(last.items.map(r => r.id), ['run-31', 'run-32']);
    assert.equal(last.label, 'runs 31–32 of 32');
    assert.equal(impl.win(all, 99).page, 6);
    assert.equal(impl.win(all, 99).label, 'runs 31–32 of 32');
  });

  test(`${impl.name}: junk pages fall back to the newest runs`, () => {
    for (const junk of [-1, NaN, Infinity, undefined as unknown as number, 'x' as unknown as number]) {
      assert.equal(impl.clamp(junk, 30), 0, String(junk));
    }
    assert.equal(impl.clamp('2' as unknown as number, 30), 2, 'a numeric string from storage still works');
    assert.equal(impl.clamp(1.7, 30), 1);
  });

  test(`${impl.name}: five runs or fewer is one page with no paging`, () => {
    for (const n of [1, 5]) {
      const w = impl.win(runs(n), 3);
      assert.equal(w.page, 0);
      assert.equal(w.items.length, n);
      assert.equal(w.label, `runs 1–${n} of ${n}`);
      assert.deepEqual([w.hasNewer, w.hasOlder], [false, false]);
    }
    const none = impl.win([], 0);
    assert.deepEqual([none.total, none.first, none.last, none.label, none.hasOlder], [0, 0, 0, 'no runs', false]);
  });

  test(`${impl.name}: hasReport — false only when the builder said so`, () => {
    assert.equal(impl.hasReport({ id: 'a', hasReport: true }), true);
    assert.equal(impl.hasReport({ id: 'a' }), true, 'catalogs from before the field: the folder was still there');
    assert.equal(impl.hasReport({ id: 'a', hasReport: false }), false);
    assert.equal(impl.hasReport(undefined), false, 'an unknown run (not in catalog.runs) gets no link');
    assert.equal(impl.kept([{ hasReport: true }, {}, { hasReport: false }] as never[]), 2);
  });
}

// ---------------------------------------------------------------------------
// v1: a window in the URL is named by its newest run, so a link is stable.
// ---------------------------------------------------------------------------

/** `n` run ids in the minted format, newest first, six hours apart, the newest at `newest` hours. */
const mintedRuns = (n: number, newest = 1000) => Array.from({ length: n }, (_, i) => {
  const d = new Date(Date.UTC(2026, 8, 1) + (newest - i) * 6 * 3_600_000);
  const p2 = (x: number) => String(x).padStart(2, '0');
  return { id: `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}_${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}_sha${newest - i}` };
});
const idsOf = (rs: Array<{ id: string }>) => rs.map(r => r.id);

test('v1 run-window.js: ?runs=<run id> round-trips, leaves other params alone, and the newest window has no param', () => {
  const all = mintedRuns(30);
  assert.equal(v1.searchForStart('', all, 0), '');
  assert.equal(v1.searchForStart('?runs=' + all[7].id, all, 0), '', 'back on the newest window the param goes');
  assert.equal(v1.searchForStart('?x=1', all, 5), `?x=1&runs=${all[5].id}`);
  for (const start of [0, 1, 5, 7, 25, 29]) {
    assert.equal(v1.startFromSearch(v1.searchForStart('?x=1', all, start), all), start, `start ${start}`);
  }
  assert.equal(v1.startFromSearch('', all), 0);
});

test('v1 run-window.js: a shared ?runs=<run id> link shows the same runs after newer runs arrive', () => {
  const before = mintedRuns(30);
  const link = v1.searchForStart('', before, 10);
  const shown = idsOf(v1.windowAt(before, v1.startFromSearch(link, before)).runs);
  assert.deepEqual(shown, idsOf(before.slice(10, 15)));
  // three more runs: everything shifts down by three, the oldest three age out
  const after = [...mintedRuns(3, 1003), ...before].slice(0, 30);
  const start = v1.startFromSearch(link, after);
  assert.equal(start, 13);
  const w = v1.windowAt(after, start);
  assert.deepEqual(idsOf(w.runs), shown);
  assert.equal(w.label, 'runs 14–18 of 30');
});

test('v1 run-window.js: a link to a run that aged out opens the oldest runs; junk opens the newest', () => {
  const all = mintedRuns(30);
  const agedOut = mintedRuns(1, 1000 - 40)[0].id;   // older than every kept run
  assert.equal(v1.startFromSearch(`?runs=${agedOut}`, all), 25);
  assert.deepEqual(idsOf(v1.windowAt(all, 25).runs), idsOf(all.slice(25)));
  assert.equal(v1.startFromSearch(`?runs=${agedOut}`, all.slice(0, 3)), 0, 'three runs: the oldest window is the only one');
  // an id between two kept runs (e.g. a run that never published) opens at the next older kept run
  const between = all[4].id.replace(/_sha\d+$/, '_zzz').replace(/_(\d{2})(\d{2})_/, (_m, h, m) => `_${h}${String(Number(m) + 1).padStart(2, '0')}_`);
  assert.equal(v1.startFromSearch(`?runs=${between}`, all), 4);
  for (const junk of ['?runs=abc', '?runs=', '?runs=%20', '?runs=../x']) assert.equal(v1.startFromSearch(junk, all), 0, junk);
});

test('v1 run-window.js: old ?runs=<page> links still open that page', () => {
  const all = mintedRuns(30);
  assert.equal(v1.startFromSearch('?runs=1', all), 0);
  assert.equal(v1.startFromSearch('?runs=3', all), 10);
  assert.equal(v1.startFromSearch('?x=1&runs=6', all), 25);
  assert.equal(v1.startFromSearch('?runs=99', all), 25, 'past the end: the oldest page');
  for (const junk of ['?runs=0', '?runs=-2']) assert.equal(v1.startFromSearch(junk, all), 0, junk);
  // and they are rewritten to the stable form
  assert.equal(v1.searchForStart('?runs=3', all, v1.startFromSearch('?runs=3', all)), `?runs=${all[10].id}`);
});

test('v1 run-window.js: a window can start at any run; Newer/Older move it by five', () => {
  const all = runs(31);
  const w = v1.windowAt(all, 7);
  assert.deepEqual(idsOf(w.runs), ['run-8', 'run-9', 'run-10', 'run-11', 'run-12']);
  assert.deepEqual([w.start, w.first, w.last, w.label, w.hasNewer, w.hasOlder], [7, 8, 12, 'runs 8–12 of 31', true, true]);
  const tail = v1.windowAt(all, 27);
  assert.deepEqual([tail.label, tail.hasOlder, tail.runs.length], ['runs 28–31 of 31', false, 4]);
  assert.equal(v1.windowAt(all, 26).hasOlder, false, 'runs 27–31 are the oldest five');
  assert.equal(v1.windowAt(all, 25).hasOlder, true);
  assert.equal(v1.windowAt(all, 0).hasNewer, false);
  for (const junk of [-1, NaN, 'x', undefined]) assert.equal(v1.clampStart(junk, 31), 0, String(junk));
  assert.equal(v1.clampStart(99, 31), 30);
  assert.equal(v1.clampStart(3, 0), 0);
  assert.deepEqual(v1.windowAt([], 4).label, 'no runs');
});

// ---------------------------------------------------------------------------
// v2: the stored page only holds while no newer run has arrived.
// ---------------------------------------------------------------------------

test('v2 runWindow.ts: the stored page holds until a newer run arrives, then the newest runs show', () => {
  const stored = (page: unknown, lastRunId: unknown) => JSON.stringify({ page, lastRunId });
  assert.equal(v2.pageFor(stored(3, 'run-a'), 'run-a', 30), 3);
  assert.equal(v2.pageFor(stored(3, 'run-a'), 'run-b', 30), 0, 'a newer run: back to the newest page');
  assert.equal(v2.pageFor(stored(9, 'run-a'), 'run-a', 12), 2, 'clamped to the pages there are');
  assert.equal(v2.pageFor(null, 'run-a', 30), 0, 'nothing stored (new tab)');
  assert.equal(v2.pageFor(stored(3, 'run-a'), undefined, 0), 0, 'catalog still loading');
  assert.equal(v2.pageFor(JSON.stringify({ page: 2 }), undefined, 30), 0, 'no newest run to compare against');
  for (const junk of ['{', '3', 'null', '"x"', stored('x', 'run-a'), stored(-2, 'run-a'), JSON.stringify({ page: 2 })]) {
    assert.equal(v2.pageFor(junk, 'run-a', 30), 0, junk);
  }
});

const history = [
  { runId: 'run-1', status: 'passed', durationMs: 1 },
  { runId: 'run-2', status: 'interrupted', durationMs: 1 },
  { runId: 'run-4', status: 'failed', durationMs: 1 },
  { runId: 'run-5', status: 'timedOut', durationMs: 1 },
  { runId: 'run-6', status: 'skipped', durationMs: 1 },
  { runId: 'gone', status: 'passed', durationMs: 1 }, // older than the window: never shown
];

test('slots align to the window runs; interrupted and missing are "not run" (v1 and v2 agree)', () => {
  const page = runs(5);
  const s1 = v1.slotsFor({ history }, page);
  const s2 = v2.slotsFor({ history } as never, page.map(r => r.id));
  assert.deepEqual(s1, s2);
  assert.deepEqual(s1.map(s => ('notRun' in s ? 'notrun' : s.status)), ['passed', 'notrun', 'notrun', 'failed', 'timedOut']);
});

test('the "last N runs" summary counts every run the catalog keeps (v1 and v2 agree)', () => {
  const all = runs(7);
  const want = { runs: 7, passed: 1, failed: 2, skipped: 1, notRun: 3 };
  assert.deepEqual(v1.recentSummary({ history }, all), want);
  assert.deepEqual(v2.summarize(v2.slotsFor({ history } as never, all.map(r => r.id))), want);
});

// ---------------------------------------------------------------------------
// Report links: a run is linked only while it still has runs/<id>/.
// ---------------------------------------------------------------------------

const REPORT = (id: string) => `runs/${id}/playwright-report/index.html`;
const summary = (id: string, extra: Partial<RunSummary> = {}): RunSummary => ({
  id, startedAt: '2026-10-01T00:00:00Z', durationMs: 1, passed: 2, failed: 1, skipped: 0, timedOut: 0,
  notRun: 0, cutShort: null, total: 3, sha: 'x', branch: 'b', baseUrl: 'u', ...extra,
});

test('a run is linked to its report until it is pruned (v1 chip and v2 link agree)', () => {
  const cases: Array<[RunSummary, string | null]> = [
    [summary('kept', { hasReport: true }), REPORT('kept')],
    [summary('old-catalog'), REPORT('old-catalog')], // no field: the folder was still there
    [summary('pruned', { hasReport: false }), null],
  ];
  for (const [run, want] of cases) {
    assert.equal(v1.runChip(run, 'other').href, want, `v1 ${run.id}`);
    assert.equal(v2.runReportPath(run), want, `v2 ${run.id}`);
  }
  assert.equal(v2.runReportPath(undefined), null, 'v2: a run the catalog does not list gets no link');
});

test('v1 run chip: pruned runs are plain text marked "report pruned"; latest and legacy runs are marked', () => {
  const pruned = v1.runChip(summary('2026-10-01_0001_aaa', { hasReport: false }), 'x');
  assert.deepEqual([pruned.href, pruned.pruned, pruned.cls], [null, true, 'run-chip pruned']);
  assert.match(pruned.stats, /^2\/3 pass · report pruned$/);
  assert.equal(pruned.label, '2026-10-01 0001');
  const latest = v1.runChip(summary('2026-10-02_0651_bbb', { hasReport: true, cutShort: 'Timed out' }), '2026-10-02_0651_bbb');
  assert.deepEqual([latest.href, latest.latest, latest.cls], [REPORT('2026-10-02_0651_bbb'), true, 'run-chip latest']);
  assert.equal(latest.label, '★ 2026-10-02 0651');
  assert.equal(latest.stats, '2/3 pass ⚠');
  const legacy = v1.runChip(summary('r', { notRun: null }), 'x');
  assert.deepEqual([legacy.legacy, legacy.cls, legacy.stats], [true, 'run-chip legacy', '≈2/3 pass']);
  assert.equal(v1.isLegacyCount({ notRun: 0 }), false);
  assert.equal(v1.isLegacyCount({}), true);
});

test('v1 detail pane: "Open Playwright report" only while the latestRun\'s run keeps its report', () => {
  const runs = [summary('a', { hasReport: true }), summary('b', { hasReport: false })];
  assert.equal(v1.latestRunReportPath(null, runs), null);
  assert.equal(v1.latestRunReportPath({ runId: 'a' }, runs), REPORT('a'));
  assert.equal(v1.latestRunReportPath({ runId: 'b' }, runs), null, 'pruned run');
  assert.equal(v1.latestRunReportPath({ runId: 'gone' }, runs), REPORT('gone'), 'a run an older catalog does not list keeps its link');
});

test('v2 run history: report link, media and "latest" per row of the visible page', () => {
  // 7 runs, newest first: r1–r3 keep their report, r4–r7 were pruned.
  const runs = [1, 2, 3, 4, 5, 6, 7].map(i => summary(`r${i}`, { hasReport: i <= 3 }));
  const t = {
    history: [
      { runId: 'r2', status: 'failed', durationMs: 10 },
      { runId: 'r4', status: 'passed', durationMs: 20 },
      { runId: 'r6', status: 'passed', durationMs: 30 },
    ],
    latestRun: { runId: 'r2', videoUrl: 'v', traceUrl: 't', screenshotUrls: [], errorMessage: null, errorStack: null },
    ranInLatestRun: false,
  } as unknown as CatalogTest;
  t.runSlots = v2.slotsFor(t, runs.map(r => r.id));
  const page0 = v2.historyRows(t, runs, 0);
  assert.deepEqual(page0.map(r => r.runId), ['r1', 'r2', 'r3', 'r4', 'r5']);
  assert.deepEqual(page0.map(r => r.reportPath), [REPORT('r1'), REPORT('r2'), REPORT('r3'), null, null]);
  assert.deepEqual(page0.map(r => r.entry?.status ?? null), [null, 'failed', null, 'passed', null]);
  assert.deepEqual(page0.map(r => r.hasMedia), [false, true, false, false, false]);
  assert.deepEqual(page0.map(r => r.isLatest), [false, false, false, false, false], 'r2 is the carried-over last result, not the latest run');
  const ranLatest = v2.historyRows({ ...t, latestRun: { ...t.latestRun!, runId: 'r1' }, ranInLatestRun: true, runSlots: v2.slotsFor({ history: [{ runId: 'r1', status: 'passed', durationMs: 1 }] } as never, runs.map(r => r.id)) }, runs, 0);
  assert.deepEqual([ranLatest[0].hasMedia, ranLatest[0].isLatest], [true, true]);
  // a pointer into a pruned run (older catalogs) gets no video/trace links either
  const intoPruned = v2.historyRows({ ...t, latestRun: { ...t.latestRun!, runId: 'r4' } }, runs, 0);
  assert.deepEqual(intoPruned.map(r => r.hasMedia), [false, false, false, false, false]);
  const page1 = v2.historyRows(t, runs, 1);
  assert.deepEqual(page1.map(r => [r.runId, r.reportPath]), [['r6', null], ['r7', null]], 'the oldest page: pruned runs, no links');
});

test('v2 normalize aligns every test\'s runSlots to ALL kept runs, not just the first page', () => {
  const runs = Array.from({ length: 12 }, (_, i) => summary(`run-${i + 1}`)); // newest first
  const catalog = {
    generatedAt: '', lastRunId: 'run-1', tagFacets: {},
    runs,
    tests: [{
      id: 't', title: 't', describe: '', file: 'a.spec.ts', line: 1, tags: [], description: null, source: '',
      lastStatus: 'failed', lastDurationMs: 1, ranInLatestRun: true, latestRun: null, parseError: null,
      history: [
        { runId: 'run-1', status: 'failed', durationMs: 1 },
        { runId: 'run-7', status: 'failed', durationMs: 1 },
        { runId: 'run-12', status: 'passed', durationMs: 1 },
      ],
    }],
  } as unknown as Catalog;
  const c = normalize(catalog);
  const t = c.tests[0];
  assert.equal(t.runSlots!.length, 12);
  assert.deepEqual(t.runSlots!.map(s => s.runId), runs.map(r => r.id));
  assert.deepEqual(c.runs.map(r => r.position), runs.map((_, i) => i));
  // page 2 (runs 6–10) and the short page 3 (runs 11–12) have real slots, not empty dots
  assert.deepEqual(v2.windowOf(t.runSlots!, 1).items.map(s => ('notRun' in s ? 'notrun' : s.status)), ['notrun', 'failed', 'notrun', 'notrun', 'notrun']);
  assert.deepEqual(v2.windowOf(t.runSlots!, 2).items.map(s => ('notRun' in s ? 'notrun' : s.status)), ['notrun', 'passed']);
  // "Top failing tests" and "Last N runs" tally all 12 runs
  assert.deepEqual(v2.summarize(t.runSlots!), { runs: 12, passed: 1, failed: 2, skipped: 0, notRun: 9 });
});
