/**
 * run-cycle.sh end to end, with Playwright faked: history keeps HISTORY_LIMIT
 * runs while runs/ is pruned to the RUN_LIMIT newest, and the catalog's
 * `hasReport` matches what is left on disk.
 *
 * Run: npm run test:catalog-unit
 *
 * The real run-cycle.sh and the real scripts/build-catalog.ts run against a
 * throwaway checkout (one spec file); a fake `npx` first on PATH answers
 * `npx playwright test` with a canned report.json and hands everything else
 * (`npx tsx …`) to the real npx.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const HERE = __dirname;
const SUITE = path.resolve(HERE, '..');

let tmp = '';
let repo = '';
let www = '';
let shim = '';
let canned = '';

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-cycle-test-'));
  repo = path.join(tmp, 'repo');
  www = path.join(tmp, 'www');
  shim = path.join(tmp, 'bin');
  canned = path.join(tmp, 'reports');
  for (const d of [path.join(repo, 'tests'), path.join(www, 'runs'), shim, canned]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(repo, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}');
  fs.writeFileSync(path.join(repo, 'tests', 'a.spec.ts'), "import { test } from '@playwright/test';\n\ntest('alpha', async () => {});\n");
  fs.symlinkSync(path.join(SUITE, 'scripts'), path.join(repo, 'scripts'));
  fs.symlinkSync(path.join(SUITE, 'node_modules'), path.join(repo, 'node_modules'));
  const realNpx = execFileSync('bash', ['-c', 'command -v npx']).toString().trim();
  fs.writeFileSync(path.join(shim, 'npx'), [
    '#!/usr/bin/env bash',
    'if [[ "$1" == "playwright" ]]; then',
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

const runId = (i: number) => `2026-09-0${1 + Math.floor(i / 4)}_${['0001', '0651', '1020', '1550'][i % 4]}_abc${i}`;

function runCycle(i: number): void {
  const id = runId(i);
  fs.writeFileSync(path.join(canned, `${id}.json`), JSON.stringify({
    config: { rootDir: path.join(repo, 'tests'), projects: [] },
    stats: { startTime: new Date(Date.UTC(2026, 8, 1) + i * 3_600_000).toISOString(), duration: 1000, expected: 1, unexpected: 0, skipped: 0, flaky: 0 },
    suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', specs: [{ title: 'alpha', file: 'a.spec.ts', line: 3, column: 1, tests: [{ results: [{ status: i % 3 ? 'passed' : 'failed', duration: 100, attachments: [] }] }] }] }],
    errors: [],
  }));
  fs.mkdirSync(path.join(www, 'runs', id), { recursive: true }); // server.mjs makes it before the job starts
  const r = spawnSync('bash', [path.join(SUITE, 'runner', 'run-cycle.sh')], {
    env: {
      ...process.env,
      PATH: `${shim}:${process.env.PATH}`,
      CANNED: canned,
      RUN_ID: id, REPO_DIR: repo, WEBROOT: www,
      RUN_LIMIT: '2', HISTORY_LIMIT: '4', BRANCH: 'test',
      RUN_LOCK: path.join(tmp, 'lock'),
    },
    encoding: 'utf8',
    timeout: 120_000,
  });
  assert.equal(r.status, 0, `run-cycle ${id} exited ${r.status}\n${r.stdout}\n${r.stderr}`);
}

test('six cycles with HISTORY_LIMIT=4 RUN_LIMIT=2: four runs of results, two reports on disk, hasReport matches disk', () => {
  for (let i = 0; i < 6; i++) runCycle(i);
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
