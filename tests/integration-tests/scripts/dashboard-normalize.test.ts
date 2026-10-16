/**
 * v2's normalize (dashboard-react-admin/src/normalize.ts): the once-per-load
 * derivation every badge, filter, bar and sort in the react-admin dashboard
 * reads, for catalogs from this builder and from older ones.
 *
 * Run: npm run test:catalog-unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, lastKnown, STATUS_SEVERITY } from '../dashboard-react-admin/src/normalize';
import type { Catalog, CatalogTest, CurrentStatus, HistoryEntry, LatestRun, RunSummary, TestStatus } from '../dashboard-react-admin/src/types';

const RUNS = ['r5', 'r4', 'r3', 'r2', 'r1']; // newest first, as the builder writes them

const run = (id: string): RunSummary => ({
  id, startedAt: '2026-10-09T00:00:00.000Z', durationMs: 1, passed: 0, failed: 0, skipped: 0, timedOut: 0,
  notRun: 0, total: 0, sha: 'abc', branch: 'test', baseUrl: 'https://example.test',
});
const h = (runId: string, status: TestStatus): HistoryEntry => ({ runId, status, durationMs: 100 });
const media = (runId: string): LatestRun => ({ runId, videoUrl: null, traceUrl: null, screenshotUrls: [], errorMessage: null, errorStack: null });

function t(title: string, over: Partial<CatalogTest> = {}): CatalogTest {
  return {
    id: `tests/a.spec.ts:1:${title}`, title, describe: '', file: 'tests/a.spec.ts', line: 1, tags: [],
    description: null, source: '', lastStatus: null, lastDurationMs: null, history: [], latestRun: null,
    parseError: null, ...over,
  };
}
const catalog = (tests: CatalogTest[]): Catalog =>
  ({ generatedAt: '', lastRunId: RUNS[0], tagFacets: {}, tests, runs: RUNS.map(run) });
const statusOf = (c: Catalog) => Object.fromEntries(c.tests.map(x => [x.title, x.currentStatus]));

test('this builder\'s catalog: currentStatus is the latest verdict, "notrun" or "excluded", from the builder\'s flags', () => {
  const c = normalize(catalog([
    t('failed now', { ranInLatestRun: true, excluded: false, lastStatus: 'failed', history: [h('r5', 'failed')] }),
    t('carried pass', { ranInLatestRun: false, excluded: false, lastStatus: 'passed', history: [h('r3', 'passed')] }),
    t('never reached', { ranInLatestRun: false, excluded: false }),
    t('testIgnored', { ranInLatestRun: false, excluded: true }),
    // The builder's flag wins over the tag: a LOCAL_STACK=1 run planned these.
    t('local ran', { tags: ['@local-only'], ranInLatestRun: true, excluded: false, lastStatus: 'passed', history: [h('r5', 'passed')] }),
    t('local unreached', { tags: ['@local-only'], ranInLatestRun: false, excluded: false }),
  ]));
  assert.deepEqual(statusOf(c), {
    'failed now': 'failed',
    'carried pass': 'notrun',
    'never reached': 'notrun', // planned with no verdict counts in run.notRun, whether or not it ever ran
    'testIgnored': 'excluded',
    'local ran': 'passed',
    'local unreached': 'notrun',
  });
});

test('older catalog: ranInLatestRun from history, excluded from the @local-only rule it was counted by', () => {
  const c = normalize(catalog([
    t('ran', { lastStatus: 'passed', history: [h('r5', 'passed')] }),
    t('interrupted now', { lastStatus: 'interrupted', history: [h('r5', 'interrupted'), h('r4', 'passed')] }),
    t('ran before', { lastStatus: 'failed', history: [h('r4', 'failed')] }),
    t('local never', { tags: ['@local-only'] }),
    t('local ran', { tags: ['@local-only'], lastStatus: 'passed', history: [h('r5', 'passed')] }),
  ]));
  assert.deepEqual(c.tests.map(x => [x.title, x.ranInLatestRun, x.excluded]), [
    ['ran', true, false],
    ['interrupted now', false, false],
    ['ran before', false, false],
    ['local never', false, true],
    ['local ran', true, false],
  ]);
  assert.deepEqual(statusOf(c), {
    'ran': 'passed', 'interrupted now': 'notrun', 'ran before': 'notrun', 'local never': 'excluded', 'local ran': 'passed',
  });
});

test('runSlots: one per run, newest first; a run with no entry or an interrupted one is a not-run slot', () => {
  const [x] = normalize(catalog([
    t('x', { history: [h('r5', 'passed'), h('r3', 'interrupted'), h('r2', 'failed')] }),
  ])).tests;
  assert.deepEqual(x.runSlots, [
    h('r5', 'passed'),
    { runId: 'r4', notRun: true },
    { runId: 'r3', notRun: true },
    h('r2', 'failed'),
    { runId: 'r1', notRun: true },
  ]);
});

test('statusRank sorts the Status column by severity, not alphabetically', () => {
  const statuses: CurrentStatus[] = ['passed', 'excluded', 'skipped', 'timedOut', 'notrun', 'failed'];
  const c = normalize(catalog(statuses.map(s => s === 'excluded'
    ? t(s, { ranInLatestRun: false, excluded: true })
    : s === 'notrun'
      ? t(s, { ranInLatestRun: false, excluded: false })
      : t(s, { ranInLatestRun: true, excluded: false, lastStatus: s as TestStatus, history: [h('r5', s as TestStatus)] }))));
  const sorted = [...c.tests].sort((a, b) => (a.statusRank ?? 99) - (b.statusRank ?? 99)).map(x => x.currentStatus);
  assert.deepEqual(sorted, ['failed', 'timedOut', 'notrun', 'skipped', 'passed', 'excluded']);
  // Every status a test can end up with has a rank.
  for (const s of ['passed', 'failed', 'skipped', 'timedOut', 'interrupted', 'notrun', 'excluded'] as CurrentStatus[]) {
    assert.ok(STATUS_SEVERITY.includes(s), s);
  }
  assert.equal(new Set(STATUS_SEVERITY).size, STATUS_SEVERITY.length);
});

test('lastKnown: the newest result that reached a verdict, skipping interrupted ones', () => {
  assert.deepEqual(
    lastKnown(t('a', { lastStatus: 'interrupted', latestRun: media('r5'), history: [h('r5', 'interrupted'), h('r3', 'passed')] })),
    { status: 'passed', runId: 'r3' });
  assert.deepEqual(lastKnown(t('b', { lastStatus: 'failed', latestRun: media('r4'), history: [h('r4', 'failed')] })), { status: 'failed', runId: 'r4' });
  assert.deepEqual(lastKnown(t('c', { lastStatus: 'passed', history: [h('r3', 'passed')] })), { status: 'passed', runId: 'r3' });
  assert.equal(lastKnown(t('d', { history: [h('r5', 'interrupted')] })), null);
  assert.equal(lastKnown(t('e')), null);
});
