import { test } from 'node:test';
import assert from 'node:assert/strict';
import { split, summary } from './ci-shards.mjs';

// A Playwright JSON report: one suite per file, one spec per test. Each test is
// [title, ...attempt durations]; no durations = listed or not run.
function report(files) {
  return {
    config: { rootDir: '/repo/tests' },
    suites: Object.entries(files).map(([file, tests]) => ({
      title: file, file,
      specs: tests.map(([title, ...ms]) => ({
        title, file,
        tests: [{
          projectName: file.endsWith('.setup.ts') ? 'setup' : 'chromium',
          status: ms.length > 1 ? 'unexpected' : ms.length ? 'expected' : 'skipped',
          results: ms.map((duration, i) => ({ duration, status: i === ms.length - 1 && ms.length === 1 ? 'passed' : 'failed' })),
        }],
      })),
    })),
  };
}
const listed = files => report(Object.fromEntries(Object.entries(files).map(([f, titles]) => [f, titles.map(t => [t])])));
const LIST = listed({
  'fixtures/auth.setup.ts': ['authenticate'],
  'admin/a.spec.ts': ['a1', 'a2'],
  'citizen/b.spec.ts': ['b1'],
  'citizen/c.spec.ts': ['c1', 'c2', 'c3'],
  'employee/d.spec.ts': ['d1'],
});
const files = bins => bins.map(b => b.files);

test('packs whole files by their develop time, longest first, each list in suite order', () => {
  const base = report({
    'fixtures/auth.setup.ts': [['authenticate', 999_000]],
    'admin/a.spec.ts': [['a1', 10_000], ['a2', 10_000]],
    // A failing test costs every attempt: 2 × 60 s.
    'citizen/b.spec.ts': [['b1', 60_000, 60_000]],
    'citizen/c.spec.ts': [['c1', 20_000], ['c2', 20_000], ['c3', 10_000]],
    'employee/d.spec.ts': [['d1', 40_000]],
  });
  const bins = split(LIST, base, 2);
  // b 120 → 1; c 50 → 2; d 40 → 2 (90); a 20 → 2 (110 < 120).
  assert.deepEqual(files(bins), [['citizen/b.spec.ts'], ['admin/a.spec.ts', 'citizen/c.spec.ts', 'employee/d.spec.ts']]);
  assert.deepEqual(bins.map(b => [b.tests, b.ms]), [[1, 120_000], [6, 110_000]]);
  assert.match(summary(bins, { timed: true, baselineLabel: 'develop @ abc' }),
    /packed by their time on develop @ abc[\s\S]*\| 1 \| 1 \| 1 \| 2\.0 min \|\n\| 2 \| 3 \| 6 \| 1\.8 min \|/);
});

test('setup files are left out; every other file lands in exactly one list', () => {
  for (const n of [1, 2, 3, 4, 7]) {
    const all = split(LIST, null, n).flatMap(b => b.files).sort();
    assert.deepEqual(all, ['admin/a.spec.ts', 'citizen/b.spec.ts', 'citizen/c.spec.ts', 'employee/d.spec.ts'], `${n} shards`);
  }
});

test('a test the baseline has no time for counts as the baseline median', () => {
  const base = report({
    'admin/a.spec.ts': [['a1', 30_000], ['a2', 30_000]],
    'citizen/b.spec.ts': [['b1']], // not run on develop
    'citizen/c.spec.ts': [['c1', 10_000], ['c2', 10_000], ['c3', 10_000]],
    // d is new: not in the baseline at all
  });
  const ms = Object.fromEntries(split(LIST, base, 4).filter(b => b.files.length).map(b => [b.files[0], b.ms]));
  // median of the 5 timed tests (10, 10, 10, 30, 30) = 10 s
  assert.deepEqual(ms, { 'admin/a.spec.ts': 60_000, 'citizen/c.spec.ts': 30_000, 'citizen/b.spec.ts': 10_000, 'employee/d.spec.ts': 10_000 });
});

test('with no baseline every test counts the same', () => {
  const bins = split(LIST, null, 2);
  // c 3 → 1; a 2 → 2; b 1 → 2 (3); d 1 → a tie, so the first list.
  assert.deepEqual(files(bins), [['citizen/c.spec.ts', 'employee/d.spec.ts'], ['admin/a.spec.ts', 'citizen/b.spec.ts']]);
  assert.deepEqual(bins.map(b => b.tests), [4, 3]);
  assert.match(summary(bins, { timed: false }), /No develop baseline yet[\s\S]*\| 1 \| 2 \| 4 \| – \|/);
});
