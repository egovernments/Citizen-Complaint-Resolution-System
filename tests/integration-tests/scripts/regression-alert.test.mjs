// Unit tests for regression-alert.mjs. Plain node:test, no dependencies:
//   node --test tests/integration-tests/scripts/regression-alert.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  runsToProcess, analyzeRun, needsAlert, composeMail, composeStaleMail,
  buildMessage, curlInvocation, readConfig, bareAddress, tick,
} from './regression-alert.mjs';

const R1 = '2026-10-04_1542_aaaa1111';
const R2 = '2026-10-05_1542_bbbb2222';
const R3 = '2026-10-06_1544_cccc3333';
const run = (id, sha, extra = {}) => ({ id, sha, branch: 'nightly', startedAt: `${id.slice(0, 10)}T15:42:00.000Z`, passed: 10, failed: 1, skipped: 1, total: 12, ...extra });
const h = (runId, status) => ({ runId, status, durationMs: 1000 });
const t = (id, history, extra = {}) => ({ id, title: id, file: `tests/${id}.spec.ts`, line: 1, history, latestRun: null, ...extra });

// history is newest first, like build-catalog writes it
const catalog = {
  lastRunId: R3,
  runs: [run(R3, 'cccc3333', { notRun: 2, cutShort: 'Timed out waiting 4800s for the test suite to run' }), run(R2, 'bbbb2222'), run(R1, 'aaaa1111')],
  tests: [
    t('a-regressed', [h(R3, 'failed'), h(R2, 'passed')], { latestRun: { runId: R3, errorMessage: '\x1b[31mError: boom\x1b[39m\n  at x' } }),
    t('b-flaky', [h(R3, 'timedOut'), h(R2, 'passed'), h(R1, 'failed')]),
    t('c-now-skipped', [h(R3, 'skipped'), h(R2, 'passed')]),
    t('d-stopped', [h(R2, 'passed')]),
    t('e-interrupted', [h(R3, 'interrupted'), h(R2, 'passed')]),
    t('f-fixed', [h(R3, 'passed'), h(R2, 'failed')]),
    t('g-gap', [h(R3, 'failed'), h(R1, 'passed')]),          // not reached in R2 (cut-off run)
    t('h-never', []),
    t('i-skip-then-gone', [h(R2, 'skipped')]),
    t('j-steady-fail', [h(R3, 'failed'), h(R2, 'failed')]),
  ],
};

test('runsToProcess: nothing when the newest run was handled', () => {
  assert.deepEqual(runsToProcess(catalog, R3), []);
});

test('runsToProcess: every newer run, oldest first, each with its predecessor', () => {
  const out = runsToProcess(catalog, R1);
  assert.deepEqual(out.map(x => [x.run.id, x.prev?.id]), [[R2, R1], [R3, R2]]);
});

test('runsToProcess: a handled run that left the window → only the newest', () => {
  const out = runsToProcess(catalog, '2026-09-01_0000_old');
  assert.deepEqual(out.map(x => [x.run.id, x.prev?.id]), [[R3, R2]]);
});

test('analyzeRun sorts every test into the right group', () => {
  const a = analyzeRun(catalog, catalog.runs[0], catalog.runs[1]);
  assert.deepEqual(a.regressed.map(x => x.id), ['a-regressed', 'b-flaky', 'g-gap']);
  assert.deepEqual(a.nowSkipped.map(x => x.id), ['c-now-skipped']);
  assert.deepEqual(a.stopped.map(x => x.id), ['d-stopped', 'e-interrupted']);
  assert.deepEqual(a.fixed.map(x => x.id), ['f-fixed']);
  const flaky = a.regressed.find(x => x.id === 'b-flaky');
  assert.deepEqual(flaky.flaky, { fails: 1, of: 2 });
  assert.equal(a.regressed.find(x => x.id === 'a-regressed').flaky, null);
  assert.equal(a.regressed.find(x => x.id === 'g-gap').since, R1, 'last earlier verdict, skipping a run that never reached it');
  assert.equal(a.regressed.find(x => x.id === 'a-regressed').error, 'Error: boom', 'first error line, ANSI stripped');
  assert.ok(needsAlert(a));
});

test('needsAlert: a run with only fixes (or nothing) sends no mail', () => {
  const quiet = { tests: [t('x', [h(R3, 'passed'), h(R2, 'failed')]), t('y', [h(R3, 'failed'), h(R2, 'failed')])] };
  assert.equal(needsAlert(analyzeRun(quiet, run(R3), run(R2))), false);
});

test('composeMail: subject counts, compare link, deep links, truncation', () => {
  const a = analyzeRun(catalog, catalog.runs[0], catalog.runs[1]);
  const cfg = { boxName: 'bomet', dashboardUrl: 'https://box.example/tests/', repoUrl: 'https://github.com/o/r', maxList: 2 };
  const m = composeMail(a, cfg);
  assert.equal(m.subject, `[CCRS tests][bomet] 3 regressed, 1 now skipped, 2 stopped running — ${R3}`);
  assert.match(m.text, /Changes: {3}https:\/\/github\.com\/o\/r\/compare\/bbbb2222\.\.\.cccc3333/);
  assert.match(m.text, /Cut short: Timed out waiting 4800s/);
  assert.match(m.text, /2 not run of 12/);
  assert.match(m.text, /https:\/\/box\.example\/tests\/#test\/a-regressed/);
  assert.match(m.text, /flaky: failed 1 of the last 2 runs/);
  assert.match(m.text, /… and 1 more \(see the dashboard\)/, 'maxList=2 truncates the 3 regressions');
});

test('composeStaleMail names the last run', () => {
  const m = composeStaleMail(run(R3), 26, { boxName: 'naipepea', dashboardUrl: '' });
  assert.equal(m.subject, `[CCRS tests][naipepea] no new test run for 26h — last ${R3}`);
});

test('buildMessage: headers, encoded non-ASCII subject, base64 body that round-trips', () => {
  const text = 'Run: x — ✗ regressed\n' + 'y'.repeat(300) + '\n';
  const msg = buildMessage({ from: 'CCRS alerts <alerts@example.org>', to: ['a@x.org', 'b@x.org'], subject: '[x] 1 regressed — r', text, date: new Date('2026-10-08T06:30:00Z') });
  const [head, body] = msg.split('\r\n\r\n');
  assert.match(head, /^From: CCRS alerts <alerts@example\.org>$/m);
  assert.match(head, /^To: a@x\.org, b@x\.org$/m);
  assert.match(head, /^Subject: =\?UTF-8\?B\?/m, 'non-ASCII subject is an encoded-word');
  assert.match(head, /^Date: Thu, 08 Oct 2026 06:30:00 \+0000$/m);
  assert.match(head, /^Message-ID: <[0-9a-f-]+@example\.org>$/m);
  assert.ok(body.split('\r\n').every(l => l.length <= 76), 'body lines wrapped for SMTP');
  assert.equal(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8'), text);
});

test('curlInvocation: STARTTLS on smtp://, password only in the config file', () => {
  const cfg = { smtpUrl: 'smtp://smtp.example.org:587', starttls: true, smtpUser: 'u@x.org', smtpPass: 'p"a\\ss', from: 'A <a@x.org>' };
  const { args, config } = curlInvocation(cfg, ['r1@x.org', 'r2@x.org'], '/tmp/c.conf');
  assert.ok(args.includes('--ssl-reqd'));
  assert.deepEqual(args.filter((_, i) => args[i - 1] === '--mail-rcpt'), ['r1@x.org', 'r2@x.org']);
  assert.equal(args[args.indexOf('--mail-from') + 1], 'a@x.org');
  assert.ok(!args.join(' ').includes('p"a'), 'password never on argv');
  assert.equal(config, 'user = "u@x.org:p\\"a\\\\ss"\n');
  assert.ok(!curlInvocation({ ...cfg, smtpUrl: 'smtps://h:465' }, ['r@x'], '/c').args.includes('--ssl-reqd'));
  assert.equal(curlInvocation({ ...cfg, smtpUser: '' }, ['r@x'], '/c').config, '', 'no auth → no config file');
});

test('readConfig: recipients by comma or space; STATE_DIRECTORY; defaults', () => {
  const c = readConfig({ ALERT_TO: 'a@x.org, b@x.org  c@x.org', STATE_DIRECTORY: '/var/lib/ccrs-test-alerts', ALERT_SMTP_STARTTLS: 'false' });
  assert.deepEqual(c.to, ['a@x.org', 'b@x.org', 'c@x.org']);
  assert.equal(c.stateFile, '/var/lib/ccrs-test-alerts/state.json');
  assert.equal(c.starttls, false);
  assert.equal(c.maxList, 40);
  assert.equal(bareAddress('Name <n@x.org>'), 'n@x.org');
});

// --- tick: the 5-minute poll, end to end with a fake sender ---------------

function box(catalogObj, stateObj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-test-'));
  fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(catalogObj));
  if (stateObj) fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(stateObj));
  const cfg = readConfig({ ALERT_SMTP_URL: 'smtp://h:587', ALERT_FROM: 'a@x.org', ALERT_TO: 'r@x.org', ALERT_BOX_NAME: 'test', ALERT_WEBROOT: dir, ALERT_STATE_FILE: path.join(dir, 'state.json') });
  const state = () => JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  return { dir, cfg, state };
}

test('tick: first run on a box only baselines', () => {
  const { cfg, state } = box(catalog);
  const sent = [];
  assert.equal(tick({ cfg, opts: {}, send: (_c, s) => sent.push(s) }), 0);
  assert.equal(sent.length, 0);
  assert.equal(state().lastRunId, R3);
});

test('tick: a new run with regressions mails once and advances; the next tick is quiet', () => {
  const { cfg, state } = box(catalog, { lastRunId: R2 });
  const sent = [];
  const send = (_c, s) => sent.push(s);
  assert.equal(tick({ cfg, opts: {}, send }), 0);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /3 regressed/);
  assert.equal(state().lastRunId, R3);
  assert.equal(tick({ cfg, opts: {}, send }), 0);
  assert.equal(sent.length, 1, 'same run is never mailed twice');
});

test('tick: a failed send keeps the state so the next tick retries', () => {
  const { cfg, state } = box(catalog, { lastRunId: R2 });
  assert.equal(tick({ cfg, opts: {}, send: () => { throw new Error('535 auth failed'); } }), 1);
  assert.equal(state().lastRunId, R2);
});

test('tick: a half-written catalog is skipped without touching state', () => {
  const { dir, cfg, state } = box(catalog, { lastRunId: R2 });
  fs.writeFileSync(path.join(dir, 'catalog.json'), '{"runs": [');
  assert.equal(tick({ cfg, opts: {}, send: () => assert.fail('must not send') }), 0);
  assert.equal(state().lastRunId, R2);
});

test('tick: stale watchdog mails once per stale run when enabled', () => {
  const { cfg } = box(catalog, { lastRunId: R3 });
  cfg.staleAfterHours = 26;
  const sent = [];
  const send = (_c, s) => sent.push(s);
  const later = Date.parse('2026-10-08T00:00:00Z'); // R3 started 2026-10-06T15:42Z → ~32h
  assert.equal(tick({ cfg, opts: {}, now: later, send }), 0);
  assert.equal(tick({ cfg, opts: {}, now: later + 3_600_000, send }), 0);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /no new test run for 26h/);
});

test('tick: --dry-run never writes state and never sends', () => {
  const { cfg, state } = box(catalog, { lastRunId: R2 });
  const orig = console.log; console.log = () => {};
  try { assert.equal(tick({ cfg, opts: { dryRun: true }, send: () => assert.fail('must not send') }), 0); }
  finally { console.log = orig; }
  assert.equal(state().lastRunId, R2);
});
