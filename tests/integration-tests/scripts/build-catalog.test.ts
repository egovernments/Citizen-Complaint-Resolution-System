/**
 * build-catalog run accounting: what one run's summary counts, how a test the
 * run planned but never reached ("not run") is told apart from one it never
 * planned ("excluded"), the one-shot recompute of summaries written before
 * `notRun` existed, and what carries over when a test produced no verdict.
 *
 * Run: npm run test:catalog-unit
 *
 * Each scenario builds over a throwaway checkout (tsconfig.json plus a few spec
 * files, which is all the AST walk reads) and feeds buildCatalog synthetic
 * reports shaped like Playwright 1.59.1's JSON reporter output: a test the run
 * planned is listed (with `results: []` if it never started), one the config or
 * command line filtered out is not listed at all. A cycle runs the way
 * runner/run-cycle.sh does: make runs/<id>/, build against the published
 * history/catalog in a webroot, publish, copy the report into runs/<id>/.
 *
 * Everything lives inside one describe() with its own setup, and it puts back
 * whatever cwd it found, so it can share this file with other suites.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildCatalog, verdictOf, tally, countReport, recount, cutShortOf,
  type Catalog, type CatalogTest, type HistoryFile, type PwReport, type RunSummary,
} from './build-catalog';
import { normalize } from '../dashboard-react-admin/src/normalize';
import type { Catalog as V2Catalog } from '../dashboard-react-admin/src/types';

describe('run accounting', () => {
  type Status = 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';
  /** Per test: its result, or 'unreached' (planned, results: []). A test left out was never planned. */
  type Plan = Record<string, Status | 'unreached'>;

  const SPECS: Record<string, string> = {
    'tests/a.spec.ts': [
      "import { test } from '@playwright/test';",
      '',
      "test('alpha', async () => {});",
      "test('beta', async () => {});",
      "test('gamma', async () => {});",
      "test('delta', async () => {});",
      "test('kc', { tag: ['@local-only'] }, async () => {});",
      '',
    ].join('\n'),
    // Never planned on any run here, the way develop's playwright.config.ts
    // testIgnores tests/identity-real/.
    'tests/ignored/x.spec.ts': [
      "import { test } from '@playwright/test';",
      '',
      "test('ignored', async () => {});",
      '',
    ].join('\n'),
  };
  /** Where each test sits, as the report gives it: relative to rootDir (= tests/). */
  const LOC: Record<string, { file: string; line: number }> = {
    alpha: { file: 'a.spec.ts', line: 3 },
    beta: { file: 'a.spec.ts', line: 4 },
    gamma: { file: 'a.spec.ts', line: 5 },
    delta: { file: 'a.spec.ts', line: 6 },
    kc: { file: 'a.spec.ts', line: 7 },
    ignored: { file: 'ignored/x.spec.ts', line: 3 },
  };
  /** The AST id (file:line:title, cwd-relative). */
  const idOf = (name: string) => `tests/${LOC[name].file}:${LOC[name].line}:${name}`;
  const TIMEOUT = '\u001b[31mTimed out waiting 4800s for the test suite to run\u001b[39m';
  const LOAD_ERROR = "Error: Cannot find module '../utils/missing'\nRequire stack:\n- tests/a.spec.ts";

  let root = '';
  let cwdBefore = '';
  before(() => {
    cwdBefore = process.cwd();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-catalog-accounting-'));
    for (const [file, text] of Object.entries(SPECS)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), text);
    }
    fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }));
    process.chdir(root); // collectFromAst reads tsconfig.json + tests/**/*.spec.ts from cwd
  });
  after(() => {
    process.chdir(cwdBefore);
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** A Playwright JSON report for `plan`; `empty` = the run aborted before planning anything. */
  function pwReport(plan: Plan, o: { errors?: string[]; empty?: boolean } = {}): PwReport {
    const byFile = new Map<string, unknown[]>();
    for (const [name, st] of Object.entries(plan)) {
      const { file, line } = LOC[name];
      const results = st === 'unreached' ? [] : [{
        status: st, duration: 1000 + line,
        attachments: [{ name: 'video', contentType: 'video/webm', path: `${root}/test-results/${name}/video.webm` }],
      }];
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file)!.push({ title: name, file, line, column: 1, tests: [{ results }] });
    }
    // A setup project's entry: in every planned report, never in the catalog.
    byFile.set('fixtures/auth.setup.ts', [{
      title: 'authenticate', file: 'fixtures/auth.setup.ts', line: 3, column: 1,
      tests: [{ results: [{ status: 'passed', duration: 5 }] }],
    }]);
    return {
      config: { rootDir: path.join(root, 'tests'), projects: [] },
      stats: { startTime: '2026-10-09T00:00:00.000Z', duration: 60_000, expected: 0, unexpected: 0, skipped: 0, flaky: 0 },
      suites: o.empty ? [] : [...byFile].map(([file, specs]) => ({ title: file, file, specs })),
      errors: (o.errors ?? []).map(message => ({ message })),
    } as unknown as PwReport;
  }

  const ALL: Plan = { alpha: 'passed', beta: 'passed', gamma: 'passed', delta: 'passed' };

  /** A fresh webroot (catalog.json, history.json, runs/) for one scenario. */
  function webroot(name: string): string {
    const dir = path.join(root, 'www', name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, 'runs'), { recursive: true });
    return dir;
  }

  /** Run fn with LOCAL_STACK set to `localStack` (unset when undefined), then put it back. */
  function withLocalStack<T>(localStack: string | undefined, fn: () => T): T {
    const saved = process.env.LOCAL_STACK;
    if (localStack === undefined) delete process.env.LOCAL_STACK;
    else process.env.LOCAL_STACK = localStack;
    try { return fn(); } finally {
      if (saved === undefined) delete process.env.LOCAL_STACK;
      else process.env.LOCAL_STACK = saved;
    }
  }

  interface CycleOpts {
    /** false = the CI/publish.sh model: history from the runner's own history.json, runs published elsewhere. */
    local?: boolean;
    localStack?: string;
  }

  /** One run-cycle.sh pass for `runId` against webroot `www`; `report` may be raw text. */
  function cycle(www: string, runId: string, report: PwReport | string, o: CycleOpts = {}): Catalog {
    const local = o.local !== false;
    if (local) fs.mkdirSync(path.join(www, 'runs', runId), { recursive: true });
    const reportPath = path.join(root, 'report.json');
    fs.writeFileSync(reportPath, typeof report === 'string' ? report : JSON.stringify(report));
    const { catalog, nextHistory } = withLocalStack(o.localStack, () => buildCatalog({
      runId,
      reportPath,
      historyPath: local ? path.join(root, 'history.runner.json') : path.join(www, 'history.json'),
      catalogPath: path.join(root, 'catalog.runner.json'),
      publicHistoryPath: local ? path.join(www, 'history.json') : null,
      publicCatalogPath: path.join(www, 'catalog.json'),
      baseUrl: 'https://example.test', branch: 'test', sha: 'abc',
    }));
    fs.writeFileSync(path.join(www, 'catalog.json'), JSON.stringify(catalog));
    fs.writeFileSync(path.join(www, 'history.json'), JSON.stringify(nextHistory));
    if (local) fs.copyFileSync(reportPath, path.join(www, 'runs', runId, 'report.json'));
    return catalog;
  }

  const byName = (c: Catalog, name: string): CatalogTest => {
    const t = c.tests.find(x => x.id === idOf(name));
    assert.ok(t, `no catalog entry for ${name}`);
    return t;
  };
  const counts = (r: RunSummary) => ({
    passed: r.passed, failed: r.failed, timedOut: r.timedOut, skipped: r.skipped,
    notRun: r.notRun, excluded: r.excluded, total: r.total,
  });

  /** A summary as the builder wrote it before `notRun` existed (no notRun, no cutShort). */
  function oldSummary(id: string, over: Partial<RunSummary> = {}): RunSummary {
    return {
      id, startedAt: '2026-10-01T00:00:00.000Z', durationMs: 1,
      passed: 0, failed: 0, skipped: 0, timedOut: 0, excluded: 0, total: 0,
      sha: 'old', branch: 'test', baseUrl: 'https://example.test', ...over,
    };
  }

  /** Publish a history.json (and optionally catalog.json) into `www` as an earlier cycle would have. */
  function seed(www: string, history: HistoryFile, tests?: Array<Partial<CatalogTest>>): void {
    fs.writeFileSync(path.join(www, 'history.json'), JSON.stringify(history));
    if (tests) fs.writeFileSync(path.join(www, 'catalog.json'), JSON.stringify({ tests, runs: history.runs }));
  }

  // -------------------------------------------------------------------------
  // The pure pieces.
  // -------------------------------------------------------------------------

  test('tally: total = passed + failed + skipped + notRun, failed includes timedOut, excluded stays out', () => {
    const c = tally([
      { verdict: 'passed', excluded: false },
      { verdict: 'failed', excluded: false },
      { verdict: 'timedOut', excluded: false },
      { verdict: 'skipped', excluded: false },
      { verdict: undefined, excluded: false },
      { verdict: undefined, excluded: true },
      { verdict: 'passed', excluded: true },
    ]);
    assert.deepEqual(c, { passed: 1, failed: 2, timedOut: 1, skipped: 1, notRun: 1, excluded: 2, total: 5 });
    assert.equal(c.total, c.passed + c.failed + c.skipped + c.notRun);
  });

  test('verdictOf: interrupted, or no result, is no verdict', () => {
    assert.equal(verdictOf(undefined), undefined);
    assert.equal(verdictOf({ status: 'interrupted', duration: 1 }), undefined);
    for (const s of ['passed', 'failed', 'timedOut', 'skipped'] as const) {
      assert.equal(verdictOf({ status: s, duration: 1 }), s);
    }
  });

  test('countReport: counts the report\'s own spec entries; no result or interrupted is not run', () => {
    const c = countReport(pwReport({ alpha: 'passed', beta: 'timedOut', gamma: 'unreached', delta: 'interrupted' }));
    // fixtures/auth.setup.ts is in the report but is not a .spec.ts test.
    assert.deepEqual(c, { passed: 1, failed: 1, timedOut: 1, skipped: 0, notRun: 2, excluded: 0, total: 4 });
  });

  test('cutShortOf: the global timeout in any task, or --max-failures; nothing else', () => {
    const cut = (...errors: string[]) => cutShortOf(pwReport({}, { errors }));
    assert.equal(cut(TIMEOUT), 'Timed out waiting 4800s for the test suite to run');
    assert.equal(cut('Timed out waiting 0.9s for the global setup to run'), 'Timed out waiting 0.9s for the global setup to run');
    assert.equal(cut('Timed out waiting 30s for the start dev server to run'), 'Timed out waiting 30s for the start dev server to run');
    assert.equal(cut('Testing stopped early after 1 maximum allowed failures.'), 'Testing stopped early after 1 maximum allowed failures.');
    assert.equal(cut('Error: worker teardown interrupted\n  at fixture'), null);
    assert.equal(cut(LOAD_ERROR), null);
    assert.equal(cut(), null);
    // The first matching line wins over an unrelated error before it.
    assert.equal(cut('Error: flaky fixture', `${TIMEOUT}\nmore detail`), 'Timed out waiting 4800s for the test suite to run');
  });

  test('recount: outcome counts from the report, excluded as stored, cut-short message from the report', () => {
    const r = recount(
      oldSummary('r1', { passed: 9, excluded: 7, total: 9 }),
      pwReport({ alpha: 'passed', beta: 'unreached' }, { errors: ['Testing stopped early after 1 maximum allowed failures.'] }),
    );
    assert.deepEqual(counts(r), { passed: 1, failed: 0, timedOut: 0, skipped: 0, notRun: 1, excluded: 7, total: 2 });
    assert.equal(r.cutShort, 'Testing stopped early after 1 maximum allowed failures.');
    assert.equal(r.id, 'r1');
  });

  // -------------------------------------------------------------------------
  // One build.
  // -------------------------------------------------------------------------

  test('a complete run: each planned test counts its verdict; the unplanned ones are excluded', () => {
    const c = cycle(webroot('complete'), 'r1', pwReport({ alpha: 'passed', beta: 'failed', gamma: 'timedOut', delta: 'skipped' }));
    const r = c.runs[0];
    assert.deepEqual(counts(r), { passed: 1, failed: 2, timedOut: 1, skipped: 1, notRun: 0, excluded: 2, total: 4 });
    assert.equal(r.total, r.passed + r.failed + r.skipped + (r.notRun ?? NaN));
    assert.equal(r.cutShort, null);
    assert.deepEqual(c.tests.filter(t => t.excluded).map(t => t.title).sort(), ['ignored', 'kc']);
    for (const name of ['alpha', 'beta', 'gamma', 'delta']) assert.equal(byName(c, name).ranInLatestRun, true, name);
    assert.equal(byName(c, 'gamma').lastStatus, 'timedOut');
  });

  test('planned but never reached is not run; never planned is excluded, even with no tag', () => {
    const c = cycle(webroot('cut'), 'r1', pwReport({ alpha: 'passed', beta: 'unreached', gamma: 'unreached', delta: 'passed' }, { errors: [TIMEOUT] }));
    const r = c.runs[0];
    assert.deepEqual(counts(r), { passed: 2, failed: 0, timedOut: 0, skipped: 0, notRun: 2, excluded: 2, total: 4 });
    assert.equal(r.cutShort, 'Timed out waiting 4800s for the test suite to run');
    const beta = byName(c, 'beta');
    assert.equal(beta.excluded, false);
    assert.equal(beta.ranInLatestRun, false);
    assert.equal(beta.lastStatus, null);
    assert.deepEqual(beta.history, []);
    const ignored = byName(c, 'ignored'); // untagged: only the report says it was left out
    assert.deepEqual(ignored.tags, []);
    assert.equal(ignored.excluded, true);
  });

  test('@local-only: excluded when the run leaves it out, with or without LOCAL_STACK; counted when the run plans it', () => {
    // A remote run: grepInvert drops it, so it is not in the report.
    for (const localStack of [undefined, '1']) {
      const c = cycle(webroot(`kc-remote-${localStack}`), 'r1', pwReport(ALL), { localStack });
      assert.equal(byName(c, 'kc').excluded, true, `LOCAL_STACK=${localStack}`);
      assert.equal(c.runs[0].total, 4);
    }
    // LOCAL_STACK=1: the config plans it, so it counts like any other test.
    const ran = cycle(webroot('kc-local'), 'r1', pwReport({ ...ALL, kc: 'passed' }), { localStack: '1' });
    assert.equal(byName(ran, 'kc').excluded, false);
    assert.deepEqual(counts(ran.runs[0]), { passed: 5, failed: 0, timedOut: 0, skipped: 0, notRun: 0, excluded: 1, total: 5 });
    // ...and planned but not reached, it is not run, not excluded.
    const cut = cycle(webroot('kc-local-cut'), 'r1', pwReport({ ...ALL, kc: 'unreached' }, { errors: [TIMEOUT] }), { localStack: '1' });
    assert.equal(byName(cut, 'kc').excluded, false);
    assert.equal(cut.runs[0].notRun, 1);
  });

  test('a run that planned nothing (a spec failed to load) is all not run, never all excluded', () => {
    const empty = pwReport({}, { empty: true, errors: [LOAD_ERROR] });
    // First build: only the @local-only rule says what the config leaves out.
    const first = cycle(webroot('empty-first'), 'r1', empty);
    assert.deepEqual(counts(first.runs[0]), { passed: 0, failed: 0, timedOut: 0, skipped: 0, notRun: 5, excluded: 1, total: 5 });
    assert.equal(first.runs[0].cutShort, "Error: Cannot find module '../utils/missing'");
    assert.equal(byName(first, 'kc').excluded, true);
    // LOCAL_STACK=1 would have planned the @local-only test too.
    const local = cycle(webroot('empty-local'), 'r1', empty, { localStack: '1' });
    assert.equal(local.runs[0].total, 6);
    assert.equal(local.runs[0].excluded, 0);
    // After a normal run, each test keeps that build's call: same total as before.
    const www = webroot('empty-after');
    const normal = cycle(www, 'r1', pwReport(ALL));
    const broken = cycle(www, 'r2', empty);
    assert.equal(broken.runs[0].total, normal.runs[0].total);
    assert.deepEqual(counts(broken.runs[0]), { passed: 0, failed: 0, timedOut: 0, skipped: 0, notRun: 4, excluded: 2, total: 4 });
    assert.equal(byName(broken, 'ignored').excluded, true);
    // Its old results stay last-known, not current.
    assert.equal(byName(broken, 'alpha').ranInLatestRun, false);
    assert.equal(byName(broken, 'alpha').lastStatus, 'passed');
  });

  test('an interrupted result is no result: the last real verdict and its media carry over', () => {
    const www = webroot('interrupted');
    cycle(www, 'r1', pwReport(ALL));
    const c = cycle(www, 'r2', pwReport({ ...ALL, alpha: 'interrupted' }, { errors: [TIMEOUT] }));
    const alpha = byName(c, 'alpha');
    assert.equal(alpha.ranInLatestRun, false);
    assert.equal(alpha.lastStatus, 'passed');
    assert.equal(alpha.latestRun?.runId, 'r1');
    assert.deepEqual(alpha.history.map(h => `${h.runId}:${h.status}`), ['r1:passed']);
    assert.equal(c.runs[0].notRun, 1);
    assert.equal(c.runs[0].passed, 3);
  });

  test('an interrupted lastStatus from an older catalog is not carried forward', () => {
    const www = webroot('older-interrupted');
    fs.mkdirSync(path.join(www, 'runs', 'r1'));
    fs.mkdirSync(path.join(www, 'runs', 'r2'));
    const media = (runId: string) => ({ runId, videoUrl: `runs/${runId}/v.webm`, traceUrl: null, screenshotUrls: [], errorMessage: null, errorStack: null });
    seed(www, {
      runs: [oldSummary('r2', { notRun: 0 }), oldSummary('r1', { notRun: 0 })],
      perTest: {
        [idOf('alpha')]: [{ runId: 'r2', status: 'interrupted', durationMs: 9 }, { runId: 'r1', status: 'passed', durationMs: 1500 }],
        [idOf('beta')]: [{ runId: 'r2', status: 'interrupted', durationMs: 9 }],
        [idOf('gamma')]: [{ runId: 'r2', status: 'failed', durationMs: 700 }],
      },
    }, [
      { id: idOf('alpha'), lastStatus: 'interrupted', lastDurationMs: 9, latestRun: media('r2') },
      { id: idOf('beta'), lastStatus: 'interrupted', lastDurationMs: 9, latestRun: media('r2') },
      { id: idOf('gamma'), lastStatus: 'failed', lastDurationMs: 700, latestRun: media('r2') },
    ]);
    const c = cycle(www, 'r3', pwReport({ alpha: 'unreached', beta: 'unreached', gamma: 'unreached', delta: 'passed' }));
    const alpha = byName(c, 'alpha');
    assert.equal(alpha.lastStatus, 'passed', 'falls back to the newest real result');
    assert.equal(alpha.lastDurationMs, 1500);
    assert.equal(alpha.latestRun, null, 'the media kept was the interrupted run\'s');
    assert.deepEqual(alpha.history.map(h => `${h.runId}:${h.status}`), ['r1:passed']);
    const beta = byName(c, 'beta');
    assert.equal(beta.lastStatus, null, 'no real result to fall back to');
    assert.equal(beta.latestRun, null);
    assert.deepEqual(beta.history, []);
    const gamma = byName(c, 'gamma'); // a real result still carries as before
    assert.equal(gamma.lastStatus, 'failed');
    assert.equal(gamma.latestRun?.runId, 'r2');
  });

  // -------------------------------------------------------------------------
  // The one-shot recompute of summaries written before `notRun` existed.
  // -------------------------------------------------------------------------

  test('recompute: an old summary is recounted from its own report, keeps its excluded count, and is visited once', () => {
    const www = webroot('recompute');
    fs.mkdirSync(path.join(www, 'runs', 'r1'));
    fs.writeFileSync(path.join(www, 'runs', 'r1', 'report.json'),
      JSON.stringify(pwReport({ alpha: 'passed', beta: 'unreached', gamma: 'passed', delta: 'failed' }, { errors: [TIMEOUT] })));
    // What the old builder wrote: beta's carried-over pass counted as r1's own.
    seed(www, { runs: [oldSummary('r1', { passed: 3, failed: 1, total: 4, excluded: 2 })], perTest: {} });
    const c = cycle(www, 'r2', pwReport(ALL));
    const r1 = c.runs[1];
    assert.equal(r1.id, 'r1');
    assert.deepEqual(counts(r1), { passed: 2, failed: 1, timedOut: 0, skipped: 0, notRun: 1, excluded: 2, total: 4 });
    assert.equal(r1.cutShort, 'Timed out waiting 4800s for the test suite to run');
    // Its total now matches the live count of the same suite.
    assert.equal(r1.total, c.runs[0].total);
    // Persisted: the next build leaves it alone even if the report changes.
    fs.writeFileSync(path.join(www, 'runs', 'r1', 'report.json'), JSON.stringify(pwReport({ alpha: 'failed' })));
    const again = cycle(www, 'r3', pwReport(ALL));
    assert.deepEqual(again.runs.find(r => r.id === 'r1'), r1);
  });

  test('recompute: a past report that planned nothing keeps its stored total, all of it not run', () => {
    const www = webroot('recompute-empty');
    fs.mkdirSync(path.join(www, 'runs', 'r1'));
    fs.writeFileSync(path.join(www, 'runs', 'r1', 'report.json'), JSON.stringify(pwReport({}, { empty: true, errors: [LOAD_ERROR] })));
    seed(www, { runs: [oldSummary('r1', { passed: 4, total: 5, excluded: 1 })], perTest: {} });
    const r1 = cycle(www, 'r2', pwReport(ALL)).runs[1];
    assert.deepEqual(counts(r1), { passed: 0, failed: 0, timedOut: 0, skipped: 0, notRun: 5, excluded: 1, total: 5 });
    assert.equal(r1.cutShort, "Error: Cannot find module '../utils/missing'");
  });

  test('recompute: an unreadable report.json marks a legacy count (notRun: null), never retried', () => {
    const www = webroot('recompute-unreadable');
    fs.mkdirSync(path.join(www, 'runs', 'r1'));
    fs.writeFileSync(path.join(www, 'runs', 'r1', 'report.json'), '{ not json');
    const stored = oldSummary('r1', { passed: 3, total: 4, excluded: 2 });
    seed(www, { runs: [stored], perTest: {} });
    const r1 = cycle(www, 'r2', pwReport(ALL)).runs[1];
    // its folder is there, so it keeps its report (hasReport, from the retention rules)
    assert.deepEqual(r1, { ...stored, notRun: null, cutShort: null, hasReport: true });
    // Fixed later: still not recomputed, the marker is the answer.
    fs.writeFileSync(path.join(www, 'runs', 'r1', 'report.json'), JSON.stringify(pwReport(ALL)));
    const again = cycle(www, 'r3', pwReport(ALL)).runs.find(r => r.id === 'r1');
    assert.equal(again?.notRun, null);
    assert.equal(again?.passed, 3);
  });

  test('recompute: folder without report.json is a legacy count; a run whose folder is gone stays, legacy and without a report', () => {
    const www = webroot('recompute-missing');
    fs.mkdirSync(path.join(www, 'runs', 'r1')); // no report.json in it
    seed(www, { runs: [oldSummary('r1', { passed: 3, total: 4 }), oldSummary('r0', { passed: 2, total: 4 })], perTest: {} }); // no runs/r0/
    const c = cycle(www, 'r2', pwReport(ALL));
    // results are kept for the whole history window; only the report goes with the folder
    assert.deepEqual(c.runs.map(r => [r.id, r.hasReport]), [['r2', true], ['r1', true], ['r0', false]]);
    for (const r of c.runs.slice(1)) {
      assert.deepEqual([r.notRun, r.cutShort], [null, null], `${r.id}: nothing to recount from, so a legacy count`);
    }
    assert.deepEqual(c.runs.slice(1).map(r => r.passed), [3, 2], 'the stored counts stay as they were');
  });

  test('recompute: runs published elsewhere (CI rsync model) get the legacy marker', () => {
    const www = webroot('recompute-ci');
    seed(www, { runs: [oldSummary('r1', { passed: 4, total: 4 })], perTest: {} });
    const c = cycle(www, 'r2', pwReport(ALL), { local: false });
    assert.equal(c.runs[1].id, 'r1');
    assert.equal(c.runs[1].notRun, null);
    assert.equal(c.runs[1].passed, 4);
  });

  // -------------------------------------------------------------------------
  // What the dashboards read.
  // -------------------------------------------------------------------------

  test('v2 normalize buckets a built catalog the way its run summary counts it', () => {
    const www = webroot('v2-agrees');
    cycle(www, 'r1', pwReport(ALL));
    const built = cycle(www, 'r2', pwReport({ alpha: 'passed', beta: 'timedOut', gamma: 'unreached', delta: 'failed' }, { errors: [TIMEOUT] }));
    const r = built.runs[0];
    const v2 = normalize(JSON.parse(JSON.stringify(built)) as V2Catalog);
    const n = (s: string) => v2.tests.filter(t => t.currentStatus === s).length;
    assert.equal(n('notrun'), r.notRun);
    assert.equal(n('excluded'), r.excluded);
    assert.equal(n('passed'), r.passed);
    assert.equal(n('failed') + n('timedOut'), r.failed);
    assert.equal(n('skipped'), r.skipped);
  });
});
