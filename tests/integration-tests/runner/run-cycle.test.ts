/**
 * run-cycle.sh end to end, with Playwright faked: history keeps HISTORY_LIMIT
 * runs while runs/ is pruned to the RUN_LIMIT newest, the catalog's
 * `hasReport` matches what is left on disk, and only one cycle at a time
 * works on a webroot or a checkout.
 *
 * Run: npm run test:catalog-unit
 *
 * The real run-cycle.sh and the real scripts/build-catalog.ts run against
 * throwaway checkouts (one spec file); a fake `npx` first on PATH answers
 * `npx playwright test` with a canned report.json (after waiting for $GATE to
 * exist, when set) and hands everything else (`npx tsx …`) to the real npx.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const HERE = __dirname;
const SUITE = path.resolve(HERE, '..');

/**
 * run-cycle.sh takes its lock with flock(1) and bounds Playwright with
 * timeout(1): GNU util-linux and coreutils, on every Linux box and CI runner
 * but not on a stock Mac. Skip with the reason rather than fail there.
 */
const missingTools = ['flock', 'timeout'].filter(cmd => spawnSync('bash', ['-c', `command -v ${cmd}`]).status !== 0);
const skip = missingTools.length
  ? `run-cycle.sh needs GNU ${missingTools.join(' and ')} on PATH (both ship with Linux; on macOS install util-linux and coreutils)`
  : false;

let tmp = '';
let shim = '';
let canned = '';

/** A throwaway tests/integration-tests checkout with one spec. */
function checkout(name: string): string {
  const repo = path.join(tmp, name);
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}');
  fs.writeFileSync(path.join(repo, 'tests', 'a.spec.ts'), "import { test } from '@playwright/test';\n\ntest('alpha', async () => {});\n");
  fs.symlinkSync(path.join(SUITE, 'scripts'), path.join(repo, 'scripts'));
  fs.symlinkSync(path.join(SUITE, 'node_modules'), path.join(repo, 'node_modules'));
  return repo;
}

/** An empty webroot. */
function webroot(name: string): string {
  const www = path.join(tmp, name);
  fs.mkdirSync(path.join(www, 'runs'), { recursive: true });
  return www;
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-cycle-test-'));
  shim = path.join(tmp, 'bin');
  canned = path.join(tmp, 'reports');
  for (const d of [shim, canned]) fs.mkdirSync(d, { recursive: true });
  const realNpx = execFileSync('bash', ['-c', 'command -v npx']).toString().trim();
  fs.writeFileSync(path.join(shim, 'npx'), [
    '#!/usr/bin/env bash',
    'if [[ "$1" == "playwright" ]]; then',
    '  if [[ -n "${GATE:-}" ]]; then until [[ -e "$GATE" ]]; do sleep 0.1; done; fi',
    '  cp "$CANNED/$RUN_ID.json" report.json',
    '  mkdir -p test-results/alpha playwright-report',
    '  echo "<h1>$RUN_ID</h1>" > playwright-report/index.html',
    '  exit 1',
    'fi',
    `exec "${realNpx}" "$@"`,
    '',
  ].join('\n'), { mode: 0o755 });
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const runId = (i: number) => `2026-09-${String(1 + Math.floor(i / 4)).padStart(2, '0')}_${['0001', '0651', '1020', '1550'][i % 4]}_abc${i}`;

/** The canned report for run `i` and the env run-cycle.sh gets from server.mjs. */
function prepare(i: number, repo: string, www: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const id = runId(i);
  fs.writeFileSync(path.join(canned, `${id}.json`), JSON.stringify({
    config: { rootDir: path.join(repo, 'tests'), projects: [] },
    stats: { startTime: new Date(Date.UTC(2026, 8, 1) + i * 3_600_000).toISOString(), duration: 1000, expected: 1, unexpected: 0, skipped: 0, flaky: 0 },
    suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', specs: [{ title: 'alpha', file: 'a.spec.ts', line: 3, column: 1, tests: [{ results: [{ status: i % 3 ? 'passed' : 'failed', duration: 100, attachments: [] }] }] }] }],
    errors: [],
  }));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${shim}:${process.env.PATH}`,
    CANNED: canned,
    RUN_ID: id, REPO_DIR: repo, WEBROOT: www,
    RUN_LIMIT: '2', HISTORY_LIMIT: '4', BRANCH: 'test',
    ...extra,
  };
  delete env.RUN_LOCK;
  if (extra.RUN_LOCK) env.RUN_LOCK = extra.RUN_LOCK;
  return env;
}

const SCRIPT = path.join(SUITE, 'runner', 'run-cycle.sh');

/** One cycle to completion. `daemonDir`: make runs/<id>/ + run.log first, as server.mjs does. */
function runCycle(i: number, repo: string, www: string, o: { daemonDir?: boolean; env?: Record<string, string> } = {}) {
  if (o.daemonDir !== false) {
    fs.mkdirSync(path.join(www, 'runs', runId(i)), { recursive: true });
    fs.writeFileSync(path.join(www, 'runs', runId(i), 'run.log'), 'daemon log\n');
  }
  return spawnSync('bash', [SCRIPT], { env: prepare(i, repo, www, o.env), encoding: 'utf8', timeout: 120_000 });
}

test('six cycles with HISTORY_LIMIT=4 RUN_LIMIT=2: four runs of results, two reports on disk, hasReport matches disk', { skip }, () => {
  const repo = checkout('repo');
  const www = webroot('www');
  for (let i = 0; i < 6; i++) {
    const r = runCycle(i, repo, www);
    assert.equal(r.status, 0, `run-cycle ${runId(i)} exited ${r.status}\n${r.stdout}\n${r.stderr}`);
  }
  const catalog = JSON.parse(fs.readFileSync(path.join(www, 'catalog.json'), 'utf8'));
  const history = JSON.parse(fs.readFileSync(path.join(www, 'history.json'), 'utf8'));
  const newest = [5, 4, 3, 2].map(runId);
  assert.deepEqual(catalog.runs.map((r: { id: string }) => r.id), newest);
  assert.deepEqual(history.runs.map((r: { id: string }) => r.id), newest);
  assert.deepEqual(catalog.runs.map((r: { hasReport: boolean }) => r.hasReport), [true, true, false, false]);
  assert.deepEqual(fs.readdirSync(path.join(www, 'runs')).sort(), [runId(4), runId(5)]);
  assert.equal(catalog.tests[0].history.length, 4);
  assert.deepEqual(catalog.tests[0].history.map((h: { runId: string }) => h.runId), newest);
  assert.equal(catalog.tests[0].latestRun.runId, runId(5));
  assert.ok(fs.existsSync(path.join(www, 'runs', runId(5), 'playwright-report', 'index.html')));
});

test('one cycle at a time per webroot and per checkout: a second exits 1 and leaves runs/ alone', { skip }, async () => {
  const repoA = checkout('lock-repo-a');
  const repoB = checkout('lock-repo-b');
  const www = webroot('lock-www');
  const otherWww = webroot('lock-www-other');
  const gate = path.join(tmp, 'lock-gate');

  // A: a slow cycle (its Playwright waits for the gate), started like the daemon does.
  const a = 10;
  fs.mkdirSync(path.join(www, 'runs', runId(a)), { recursive: true });
  const childA = spawn('bash', [SCRIPT], { env: prepare(a, repoA, www, { GATE: gate }), stdio: ['ignore', 'pipe', 'pipe'] });
  let outA = '';
  childA.stdout.on('data', d => { outA += d; });
  childA.stderr.on('data', d => { outA += d; });
  const doneA = new Promise<number | null>(resolve => childA.on('exit', code => resolve(code)));
  const phaseA = path.join(www, 'runs', runId(a), 'phase');
  for (let waited = 0; !(fs.existsSync(phaseA) && fs.readFileSync(phaseA, 'utf8').trim() === 'running'); waited += 100) {
    assert.ok(waited < 30_000, `cycle A never reached "running":\n${outA}`);
    await new Promise(r => setTimeout(r, 100));
  }

  try {
    // B: same webroot, its own checkout, started without a daemon folder (a nightly wrapper)
    const b = runCycle(11, repoB, www, { daemonDir: false });
    assert.equal(b.status, 1, `B exited ${b.status}\n${b.stdout}\n${b.stderr}`);
    assert.match(b.stderr, /another run holds the lock on .*lock-www — aborting/);
    assert.equal(fs.existsSync(path.join(www, 'runs', runId(11))), false, 'B left no folder behind');

    // C: same webroot, the daemon made its folder and run.log: it gets the phase for the RUN button
    const c = runCycle(12, repoB, www);
    assert.equal(c.status, 1);
    assert.equal(fs.readFileSync(path.join(www, 'runs', runId(12), 'phase'), 'utf8').trim(), 'aborted-locked');

    // D: another webroot but A's checkout: the checkout is locked too
    const d = runCycle(13, repoA, otherWww, { daemonDir: false });
    assert.equal(d.status, 1, `D exited ${d.status}\n${d.stderr}`);
    assert.match(d.stderr, /another run holds the lock on .*lock-repo-a — aborting/);
    assert.deepEqual(fs.readdirSync(path.join(otherWww, 'runs')), []);

    // the lock does not depend on /tmp: a different TMPDIR (as under PrivateTmp) still collides
    const e = runCycle(14, repoB, www, { daemonDir: false, env: { TMPDIR: fs.mkdtempSync(path.join(tmp, 'private-tmp-')) } });
    assert.equal(e.status, 1);
  } finally {
    fs.writeFileSync(gate, '');
  }

  assert.equal(await doneA, 0, `cycle A failed:\n${outA}`);
  // A published, and its prune removed C's aborted folder
  const catalog = JSON.parse(fs.readFileSync(path.join(www, 'catalog.json'), 'utf8'));
  assert.deepEqual(catalog.runs.map((r: { id: string }) => r.id), [runId(a)]);
  assert.deepEqual(fs.readdirSync(path.join(www, 'runs')), [runId(a)]);

  // with A done, the webroot is free again
  const f = runCycle(15, repoB, www);
  assert.equal(f.status, 0, `F exited ${f.status}\n${f.stderr}`);
});

test('RUN_LOCK names another lock to use instead of the webroot', { skip }, () => {
  const repo = checkout('runlock-repo');
  const www = webroot('runlock-www');
  const lockFile = path.join(tmp, 'runlock');
  fs.writeFileSync(lockFile, '');
  // hold the lock file, as another cycle with the same RUN_LOCK would
  const holder = spawnSync('flock', ['-n', lockFile, 'bash', '-c',
    `RUN_LOCK=${JSON.stringify(lockFile)} bash ${JSON.stringify(SCRIPT)}`], { env: prepare(20, repo, www, { RUN_LOCK: lockFile }), encoding: 'utf8', timeout: 60_000 });
  assert.equal(holder.status, 1, `a cycle on a held RUN_LOCK must abort\n${holder.stderr}`);
  assert.match(holder.stderr, /another run holds the lock on .*runlock — aborting/);
  // free, it runs
  const r = runCycle(21, repo, www, { env: { RUN_LOCK: lockFile } });
  assert.equal(r.status, 0, r.stderr);
});

test('a prune that fails says so in run.log, and the run still publishes', {
  skip: skip || (process.getuid?.() === 0 ? 'root ignores the permission bits this test relies on' : false),
}, () => {
  const repo = checkout('prunefail-repo');
  const www = webroot('prunefail-www');
  // a folder the next prune must delete, which this user can't empty
  const locked = path.join(www, 'runs', 'stale-run', 'sub');
  fs.mkdirSync(locked, { recursive: true });
  fs.writeFileSync(path.join(locked, 'file'), 'x');
  fs.chmodSync(locked, 0o555);
  try {
    const r = runCycle(30, repo, www, { env: { RUN_LIMIT: '1' } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /\[run-cycle\] could not prune runs\/stale-run \(owner \S+, this run is \S+\): rm: cannot remove/);
    assert.equal(fs.readFileSync(path.join(www, 'runs', runId(30), 'phase'), 'utf8').trim(), 'done');
  } finally {
    fs.chmodSync(locked, 0o755);
  }
});

test('run as root (the nightly wrappers), it leaves the webroot owned like the webroot, so the webroot owner can prune it', {
  skip: skip || (process.getuid?.() !== 0 ? 'needs root, as the on-box nightly wrappers run it (e.g. in a node:22 container)' : false)
    || (spawnSync('bash', ['-c', 'command -v setpriv']).status !== 0 ? 'needs setpriv (util-linux)' : false),
}, () => {
  const owner = { uid: 65534, gid: 65534 };   // nobody: stands in for digit-tests
  fs.chmodSync(tmp, 0o755);                     // mkdtemp made it 0700; the owner must reach its checkout
  const repo = checkout('owner-repo');          // the daemon's checkout, shared with the nightly
  const www = webroot('owner-www');
  const home = path.join(tmp, 'owner-home');
  fs.mkdirSync(home, { recursive: true });
  for (const p of [repo, www, home]) execFileSync('chown', ['-R', `${owner.uid}:${owner.gid}`, p]);
  const notOwned = (dir: string) => execFileSync('find', [dir, '!', '-uid', String(owner.uid), '-printf', '%P\n']).toString().split('\n').filter(Boolean);

  // two nightly runs as root; the wrapper makes runs/<id>/ and run.log as root first
  for (const i of [40, 41]) {
    const r = runCycle(i, repo, www, { env: { RUN_LIMIT: '2' } });
    assert.equal(r.status, 0, r.stderr);
    if (i === 40) execFileSync('chown', ['-R', '0:0', path.join(www, 'runs', runId(40))]); // as an older run-cycle.sh left it
  }
  assert.deepEqual(notOwned(www), [], 'root left nothing in the webroot it owns, and healed the older root-owned folder');
  assert.deepEqual(notOwned(repo), [], 'nor in the checkout');

  // a nightly that finds the webroot locked: its wrapper-made folder is handed back too
  fs.mkdirSync(path.join(www, 'runs', runId(39)));
  fs.writeFileSync(path.join(www, 'runs', runId(39), 'run.log'), 'wrapper log\n');
  const aborted = spawnSync('flock', ['-n', www, 'bash', SCRIPT], { env: prepare(39, repo, www), encoding: 'utf8', timeout: 60_000 });
  assert.equal(aborted.status, 1, aborted.stderr);
  assert.equal(fs.readFileSync(path.join(www, 'runs', runId(39), 'phase'), 'utf8').trim(), 'aborted-locked');
  assert.deepEqual(notOwned(www), [], 'the aborted run\'s folder belongs to the webroot owner');

  // a RUN-button run as the webroot's owner. It asks for RUN_LIMIT=1, but the
  // root runs were built with 2, so it keeps two reports and must delete r40,
  // the folder the root "wrapper" made.
  const env = prepare(42, repo, www, { RUN_LIMIT: '1', HOME: home });
  fs.mkdirSync(path.join(www, 'runs', runId(42)));
  execFileSync('chown', [`${owner.uid}:${owner.gid}`, path.join(www, 'runs', runId(42))]);
  const r = spawnSync('setpriv', [`--reuid=${owner.uid}`, `--regid=${owner.gid}`, '--clear-groups', 'bash', SCRIPT], { env, encoding: 'utf8', timeout: 120_000 });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.doesNotMatch(r.stderr, /could not prune/);
  const catalog = JSON.parse(fs.readFileSync(path.join(www, 'catalog.json'), 'utf8'));
  assert.deepEqual(catalog.runs.map((x: { id: string; hasReport: boolean }) => [x.id, x.hasReport]), [[runId(42), true], [runId(41), true], [runId(40), false]]);
  // disk == the runs with a report: the root-made r40 is gone
  assert.deepEqual(fs.readdirSync(path.join(www, 'runs')).sort(), [runId(41), runId(42)]);
});
