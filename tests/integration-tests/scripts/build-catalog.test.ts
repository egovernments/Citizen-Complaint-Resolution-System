/**
 * build-catalog retention: results for the newest HISTORY_LIMIT (30) runs,
 * full reports for the newest RUN_LIMIT of them, `hasReport` on every summary.
 *
 * Run: npm run test:catalog-unit
 *
 * Each test builds a throwaway checkout (tsconfig + one spec file, which is all
 * the AST walk reads) and feeds buildCatalog synthetic Playwright reports the
 * way runner/run-cycle.sh does: make runs/<id>/, build against the published
 * history/catalog, publish, then prune runs/ to the runs that keep a report.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildCatalog, stringifyCatalog, limitFromEnv, DEFAULT_HISTORY_LIMIT,
  type Catalog, type HistoryFile, type RunSummary,
} from './build-catalog';

type Status = 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';

const SPEC = [
  "import { test } from '@playwright/test';",
  '',
  "test('alpha', async () => {});",
  "test('beta', async () => {});",
  "test('gamma', async () => {});",
  '',
].join('\n');
const TESTS = [
  { title: 'alpha', line: 3 },
  { title: 'beta', line: 4 },
  { title: 'gamma', line: 5 },
];
const id = (title: string) => `tests/a.spec.ts:${TESTS.find(t => t.title === title)!.line}:${title}`;

let root = '';
let cwd = '';
before(() => {
  cwd = process.cwd();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-catalog-test-'));
  fs.mkdirSync(path.join(root, 'tests'));
  fs.writeFileSync(path.join(root, 'tests', 'a.spec.ts'), SPEC);
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }));
  process.chdir(root); // collectFromAst reads tsconfig.json + tests/**/*.spec.ts from cwd
});
after(() => {
  process.chdir(cwd);
  fs.rmSync(root, { recursive: true, force: true });
});

/** A fresh webroot (catalog.json, history.json, runs/) for one scenario. */
function webroot(name: string): string {
  const dir = path.join(root, 'www', name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'runs'), { recursive: true });
  return dir;
}

const runId = (i: number) => `r${String(i).padStart(3, '0')}`;

/** A Playwright JSON report; a test missing from `statuses` produced no result. */
function report(statuses: Record<string, Status>, i: number): string {
  const specs = TESTS.map(t => ({
    title: t.title, file: 'a.spec.ts', line: t.line, column: 1,
    tests: [{
      results: statuses[t.title]
        ? [{
          status: statuses[t.title], duration: 1000 + i,
          attachments: [{ name: 'video', contentType: 'video/webm', path: `${root}/test-results/${t.title}/video.webm` }],
        }]
        : [],
    }],
  }));
  const r = {
    config: { rootDir: path.join(root, 'tests'), projects: [] },
    stats: { startTime: new Date(Date.UTC(2026, 8, 1) + i * 3_600_000).toISOString(), duration: 60_000, expected: 0, unexpected: 0, skipped: 0, flaky: 0 },
    suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', specs }],
    errors: [],
  };
  const p = path.join(root, 'report.json');
  fs.writeFileSync(p, JSON.stringify(r));
  return p;
}

const ALL_PASS: Record<string, Status> = { alpha: 'passed', beta: 'passed', gamma: 'passed' };

interface CycleOpts {
  statuses?: Record<string, Status>;
  historyLimit?: number;
  reportLimit?: number;
  /** false = the CI/publish.sh model: history from the runner's own history.json, runs elsewhere. */
  local?: boolean;
}

/** One run-cycle.sh pass for run `i` against webroot `www`. */
function cycle(www: string, i: number, o: CycleOpts = {}): Catalog {
  const local = o.local !== false;
  const id = runId(i);
  if (local) fs.mkdirSync(path.join(www, 'runs', id), { recursive: true });
  const reportPath = report(o.statuses ?? ALL_PASS, i);
  const historyPath = path.join(local ? root : www, 'history.json');
  const { catalog, nextHistory } = buildCatalog({
    runId: id,
    reportPath,
    historyPath,
    catalogPath: path.join(root, 'catalog.json'),
    publicHistoryPath: local ? path.join(www, 'history.json') : null,
    publicCatalogPath: path.join(www, 'catalog.json'),
    baseUrl: 'https://example.test', branch: 'test', sha: 'abc',
    historyLimit: o.historyLimit,
    reportLimit: o.reportLimit,
  });
  fs.writeFileSync(path.join(www, 'catalog.json'), stringifyCatalog(catalog));
  fs.writeFileSync(path.join(www, 'history.json'), stringifyCatalog(nextHistory));
  if (local) {
    fs.copyFileSync(reportPath, path.join(www, 'runs', id, 'report.json'));
    // run-cycle.sh's prune: keep exactly the runs whose summary still has a report.
    const keep = new Set(nextHistory.runs.filter(r => r.hasReport !== false).map(r => r.id));
    for (const d of fs.readdirSync(path.join(www, 'runs'))) {
      if (!keep.has(d)) fs.rmSync(path.join(www, 'runs', d), { recursive: true, force: true });
    }
  }
  return catalog;
}

function cycles(www: string, from: number, to: number, o: CycleOpts = {}): Catalog {
  let c: Catalog | undefined;
  for (let i = from; i <= to; i++) c = cycle(www, i, o);
  return c!;
}

const ids = (runs: RunSummary[]) => runs.map(r => r.id);
const withReport = (runs: RunSummary[]) => runs.filter(r => r.hasReport).map(r => r.id);
const onDisk = (www: string) => fs.readdirSync(path.join(www, 'runs')).sort();
const newest = (to: number, n: number) => Array.from({ length: n }, (_, k) => runId(to - k));

test('the default history window is 30 runs', () => {
  assert.equal(DEFAULT_HISTORY_LIMIT, 30);
});

test('33 runs: catalog and history keep the newest 30, newest first, per-test history capped at 30', () => {
  const www = webroot('trim');
  const c = cycles(www, 0, 32, { reportLimit: 12 });
  assert.deepEqual(ids(c.runs), newest(32, 30));
  const alpha = c.tests.find(t => t.id === id('alpha'))!;
  assert.equal(alpha.history.length, 30);
  assert.equal(alpha.history[0].runId, 'r032');
  assert.equal(alpha.history[29].runId, 'r003');
  const h = JSON.parse(fs.readFileSync(path.join(www, 'history.json'), 'utf8')) as HistoryFile;
  assert.deepEqual(ids(h.runs), ids(c.runs));
  assert.equal(h.perTest[id('alpha')].length, 30);
});

test('only the newest RUN_LIMIT runs keep a report; older ones keep their results, flagged hasReport false', () => {
  const www = webroot('reports');
  const c = cycles(www, 0, 19, { reportLimit: 12 });
  assert.equal(c.runs.length, 20);
  for (const r of c.runs) assert.equal(typeof r.hasReport, 'boolean', `${r.id} has no hasReport`);
  assert.deepEqual(withReport(c.runs), newest(19, 12));
  assert.deepEqual(c.runs.filter(r => !r.hasReport).map(r => r.id), newest(7, 8));
  // disk == catalog: the prune removed exactly the runs flagged false
  assert.deepEqual(onDisk(www), newest(19, 12).sort());
  // a pruned run still carries its counts
  const oldest = c.runs[c.runs.length - 1];
  assert.equal(oldest.id, 'r000');
  assert.equal(oldest.passed, 3);
});

test('a latestRun pointer is dropped once its run loses the report, the history entry stays', () => {
  const www = webroot('pointer');
  cycle(www, 0, { reportLimit: 3 });                                  // beta's only run
  const c = cycles(www, 1, 5, { reportLimit: 3, statuses: { alpha: 'passed', gamma: 'passed' } });
  const beta = c.tests.find(t => t.id === id('beta'))!;
  assert.equal(beta.ranInLatestRun, false);
  assert.equal(beta.latestRun, null, 'pointer into the pruned r000 must not survive');
  assert.deepEqual(beta.history.map(h => h.runId), ['r000']);
  assert.equal(c.runs.find(r => r.id === 'r000')!.hasReport, false);
  // every remaining pointer is into a run that still has its report
  const kept = new Set(withReport(c.runs));
  for (const t of c.tests) if (t.latestRun) assert.ok(kept.has(t.latestRun.runId), `${t.id} → ${t.latestRun.runId}`);
});

test('a run folder that vanished loses its report and the next run on disk keeps its slot', () => {
  const www = webroot('vanished');
  cycles(www, 0, 13, { reportLimit: 12 });
  fs.rmSync(path.join(www, 'runs', 'r011'), { recursive: true });
  const c = cycle(www, 14, { reportLimit: 12 });
  assert.equal(c.runs.find(r => r.id === 'r011')!.hasReport, false);
  assert.deepEqual(withReport(c.runs), ['r014', 'r013', 'r012', 'r010', 'r009', 'r008', 'r007', 'r006', 'r005', 'r004', 'r003', 'r002']);
  assert.deepEqual(onDisk(www), withReport(c.runs).sort());
});

test('publish.sh model (runs not local): the newest RUN_LIMIT positions keep a report, and a pruned run stays pruned when the limit grows', () => {
  const www = webroot('ci');
  let c = cycles(www, 0, 5, { reportLimit: 3, local: false });
  assert.deepEqual(withReport(c.runs), ['r005', 'r004', 'r003']);
  c = cycle(www, 6, { reportLimit: 10, local: false });
  assert.deepEqual(withReport(c.runs), ['r006', 'r005', 'r004', 'r003'], 'r000–r002 were pruned on the host and cannot come back');
});

test('RUN_LIMIT above HISTORY_LIMIT is capped at the history window', () => {
  const www = webroot('cap');
  const c = cycles(www, 0, 9, { historyLimit: 4, reportLimit: 10 });
  assert.deepEqual(ids(c.runs), newest(9, 4));
  assert.deepEqual(withReport(c.runs), newest(9, 4));
  assert.equal(c.tests.find(t => t.id === id('alpha'))!.history.length, 4);
  assert.deepEqual(onDisk(www), newest(9, 4).sort());
});

test('a 5-run history from before this change grows instead of resetting; a legacy run whose folder is gone stays, without a report', () => {
  const www = webroot('legacy');
  const legacyRuns: RunSummary[] = [4, 3, 2, 1, 0].map(i => ({
    id: runId(i), startedAt: `2026-09-01T0${i}:00:00.000Z`, durationMs: 1, passed: 3, failed: 0, skipped: 0, timedOut: 0,
    notRun: 0, cutShort: null, excluded: 0, total: 3, sha: 'old', branch: 'old', baseUrl: 'x',
  }));
  const perTest = Object.fromEntries(TESTS.map(t => [id(t.title), [4, 3, 2, 1, 0].map(i => ({ runId: runId(i), status: 'passed', durationMs: 5 }))]));
  fs.writeFileSync(path.join(www, 'history.json'), JSON.stringify({ perTest, runs: legacyRuns }, null, 2));
  for (const i of [4, 3, 2, 1]) fs.mkdirSync(path.join(www, 'runs', runId(i)));   // r000's folder is already gone
  const c = cycle(www, 5, { reportLimit: 12 });
  assert.deepEqual(ids(c.runs), newest(5, 6));
  assert.deepEqual(withReport(c.runs), newest(5, 5));
  assert.equal(c.runs.find(r => r.id === 'r000')!.hasReport, false);
  assert.equal(c.tests.find(t => t.id === id('alpha'))!.history.length, 6);
});

test('the headline still counts only the latest run, however long the history', () => {
  const www = webroot('headline');
  cycles(www, 0, 28, { reportLimit: 12 });
  const c = cycle(www, 29, { reportLimit: 12, statuses: { alpha: 'passed', beta: 'failed' } });
  const latest = c.runs[0];
  assert.equal(latest.id, 'r029');
  assert.deepEqual(
    { passed: latest.passed, failed: latest.failed, notRun: latest.notRun, total: latest.total },
    { passed: 1, failed: 1, notRun: 1, total: 3 },
  );
  const gamma = c.tests.find(t => t.id === id('gamma'))!;
  assert.equal(gamma.ranInLatestRun, false);
  assert.equal(gamma.history.length, 29);
});

test('stringifyCatalog: one line per history entry, same JSON', () => {
  const value = {
    tests: [{ id: 'x', history: [
      { runId: '2026-10-07_1020_bcf55fd61', status: 'passed', durationMs: 1234 },
      { runId: 'odd "id" \\ with\nnewline', status: 'timedOut', durationMs: 0.5 },
    ], source: 'test("a", () => {\n  expect(1).toBe(1);\n})' }],
    perTest: { 'tests/a.spec.ts:3:alpha': [{ runId: 'r1', status: 'failed', durationMs: 7 }] },
  };
  const out = stringifyCatalog(value);
  assert.deepEqual(JSON.parse(out), value);
  const entryLines = out.split('\n').filter(l => l.includes('"runId"'));
  assert.equal(entryLines.length, 3);
  for (const l of entryLines) assert.match(l, /^\s*\{ "runId": .*, "status": "\w+", "durationMs": [\d.]+ \},?$/);
  assert.match(out, /\n {2}"tests": \[\n/, 'the rest stays indented');
});

test('limitFromEnv: positive integers only', () => {
  const name = 'BUILD_CATALOG_TEST_LIMIT';
  const read = (v: string | undefined) => {
    if (v === undefined) delete process.env[name]; else process.env[name] = v;
    return limitFromEnv(name, 30);
  };
  assert.equal(read(undefined), 30);
  assert.equal(read(''), 30);
  assert.equal(read('12'), 12);
  for (const junk of ['0', '-3', 'abc', '2.5']) assert.equal(read(junk), 30, junk);
  delete process.env[name];
});
