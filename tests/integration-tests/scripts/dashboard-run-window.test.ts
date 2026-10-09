/**
 * Run-window paging of both dashboards: the vanilla dashboard/run-window.js
 * and the react-admin dashboard-react-admin/src/runWindow.ts get the same
 * cases, so the two stay in step.
 *
 * Run: npm run test:catalog-unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as v2 from '../dashboard-react-admin/src/runWindow';

const require = createRequire(__filename);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const v1 = require('../dashboard/run-window.js') as {
  PAGE_SIZE: number;
  pageCount(total: number): number;
  clampPage(page: unknown, total: number): number;
  windowOf<T>(runs: T[], page: unknown): { page: number; pages: number; total: number; first: number; last: number; runs: T[]; hasNewer: boolean; hasOlder: boolean; label: string };
  hasReport(run: unknown): boolean;
  reportsKept(runs: unknown[]): number;
  parsePageParam(search: string): number;
  withPageParam(search: string, page: number): string;
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

test('v1 run-window.js: the ?runs= page survives a refresh and leaves other params alone', () => {
  assert.equal(v1.parsePageParam(''), 0);
  assert.equal(v1.parsePageParam('?runs=1'), 0);
  assert.equal(v1.parsePageParam('?runs=3'), 2);
  assert.equal(v1.parsePageParam('?x=1&runs=6'), 5);
  for (const junk of ['?runs=0', '?runs=-2', '?runs=abc', '?runs=']) assert.equal(v1.parsePageParam(junk), 0, junk);
  assert.equal(v1.withPageParam('', 2), '?runs=3');
  assert.equal(v1.withPageParam('?runs=3', 0), '');
  assert.equal(v1.withPageParam('?x=1', 1), '?x=1&runs=2');
  assert.equal(v1.withPageParam('?x=1&runs=4', 0), '?x=1');
  for (const p of [0, 1, 5]) assert.equal(v1.parsePageParam(v1.withPageParam('?x=1', p)), p);
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
