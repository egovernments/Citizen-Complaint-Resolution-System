// Unit tests for regression-alert.mjs. Plain node:test, no dependencies:
//   node --test tests/integration-tests/scripts/regression-alert.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  runsToProcess, analyzeRun, needsAlert, composeMail, composeStaleMail,
  buildMessage, curlInvocation, readConfig, bareAddress, tick, retryDelayMs, classifySendError, sendMail, curlEnv,
} from './regression-alert.mjs';

const R1 = '2026-10-04_1542_aaaa1111';
const R2 = '2026-10-05_1542_bbbb2222';
const R3 = '2026-10-06_1544_cccc3333';
const run = (id, sha, extra = {}) => ({ id, sha, branch: 'nightly', startedAt: `${id.slice(0, 10)}T15:42:00.000Z`, passed: 10, failed: 1, skipped: 1, total: 12, ...extra });
const h = (runId, status) => ({ runId, status, durationMs: 1000 });
const t2 = (id, history, extra = {}) => ({ id, title: id, file: `tests/${id}.spec.ts`, line: 1, history, latestRun: null, ...extra });

// history is newest first, like build-catalog writes it
const catalog = {
  lastRunId: R3,
  runs: [run(R3, 'cccc3333', { notRun: 2, cutShort: 'Timed out waiting 4800s for the test suite to run' }), run(R2, 'bbbb2222'), run(R1, 'aaaa1111')],
  tests: [
    t2('a-regressed', [h(R3, 'failed'), h(R2, 'passed')], { latestRun: { runId: R3, errorMessage: '\x1b[31mError: boom\x1b[39m\n  at x' } }),
    t2('b-flaky', [h(R3, 'timedOut'), h(R2, 'passed'), h(R1, 'failed')]),
    t2('c-now-skipped', [h(R3, 'skipped'), h(R2, 'passed')]),
    t2('d-stopped', [h(R2, 'passed')]),
    t2('e-interrupted', [h(R3, 'interrupted'), h(R2, 'passed')]),
    t2('f-fixed', [h(R3, 'passed'), h(R2, 'failed')]),
    t2('g-gap', [h(R3, 'failed'), h(R1, 'passed')]),          // not reached in R2 (cut-off run)
    t2('h-never', []),
    t2('i-skip-then-gone', [h(R2, 'skipped')]),
    t2('j-steady-fail', [h(R3, 'failed'), h(R2, 'failed')]),
    t2('k-long-gone', [h(R1, 'passed')]),                      // stopped two runs ago, not now
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
  const quiet = { tests: [t2('x', [h(R3, 'passed'), h(R2, 'failed')]), t2('y', [h(R3, 'failed'), h(R2, 'failed')])] };
  assert.equal(needsAlert(analyzeRun(quiet, run(R3), run(R2))), false);
});

test('needsAlert: a run that only stopped running (or only got skipped) still sends a mail', () => {
  const stoppedOnly = { tests: [t2('x', [h(R2, 'passed')])] };
  const a = analyzeRun(stoppedOnly, run(R3), run(R2));
  assert.deepEqual(a.stopped.map(x => x.id), ['x']);
  assert.equal(needsAlert(a), true);
  const skippedOnly = { tests: [t2('y', [h(R3, 'skipped'), h(R2, 'passed')])] };
  assert.equal(needsAlert(analyzeRun(skippedOnly, run(R3), run(R2))), true);
});

test('analyzeRun: in a batch, each run is judged against the runs before it, never after', () => {
  const batch = {
    runs: [run(R3), run(R2), run(R1)],
    tests: [
      t2('red-then-fixed', [h(R3, 'passed'), h(R2, 'failed'), h(R1, 'failed')]),
      t2('regressed-stays-red', [h(R3, 'failed'), h(R2, 'failed'), h(R1, 'passed')]),
    ],
  };
  const [r2, r3] = runsToProcess(batch, R1).map(({ run: r, prev }) => analyzeRun(batch, r, prev));
  assert.deepEqual(r2.regressed.map(x => x.id), ['regressed-stays-red'], 'R2 broke it; R1 had passed');
  assert.deepEqual(r2.fixed.map(x => x.id), [], 'R3 passing later does not make R2 a fix');
  assert.deepEqual(r3.regressed.map(x => x.id), [], 'still red in R3 is not news');
  assert.deepEqual(r3.fixed.map(x => x.id), ['red-then-fixed']);
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
  const section = title => m.text.split(/\n\n/).find(p => p.startsWith(title)) || '';
  assert.match(section('STOPPED RUNNING'), /tests\/d-stopped\.spec\.ts:1 — d-stopped\n.*tests\/e-interrupted\.spec\.ts:1 — e-interrupted/);
  assert.match(section('FIXED'), /✓ tests\/f-fixed\.spec\.ts:1 — f-fixed/);
  assert.match(section('NOW SKIPPED'), /○ tests\/c-now-skipped\.spec\.ts:1 — c-now-skipped {2}\(last passed in 2026-10-05_1542_bbbb2222\)/);
  assert.doesNotMatch(m.text, /k-long-gone/);
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
  assert.equal(args[0], '--disable', 'first, so ~/.curlrc is never read');
  assert.ok(args.includes('--ssl-reqd'));
  assert.equal(args[args.indexOf('--write-out') + 1], '%{response_code}', 'the relay\'s reply code is logged');
  assert.deepEqual(args.filter((_, i) => args[i - 1] === '--mail-rcpt'), ['r1@x.org', 'r2@x.org']);
  assert.equal(args[args.indexOf('--mail-from') + 1], 'a@x.org');
  assert.ok(!args.join(' ').includes('p"a'), 'password never on argv');
  assert.equal(config, 'user = "u@x.org:p\\"a\\\\ss"\n');
  assert.ok(!curlInvocation({ ...cfg, smtpUrl: 'smtps://h:465' }, ['r@x'], '/c').args.includes('--ssl-reqd'));
  assert.equal(curlInvocation({ ...cfg, smtpUser: '' }, ['r@x'], '/c').config, '', 'no auth → no config file');
});

test('curlEnv: drops every ALERT_* variable, keeps the rest', () => {
  assert.deepEqual(curlEnv({ PATH: '/bin', HOME: '/h', ALERT_SMTP_PASS: 's', ALERT_SMTP_USER: 'u', ALERT_TO: 'x' }), { PATH: '/bin', HOME: '/h' });
});

test('readConfig: recipients by comma or space; STATE_DIRECTORY; defaults', () => {
  const c = readConfig({ ALERT_TO: 'a@x.org, b@x.org  c@x.org', STATE_DIRECTORY: '/var/lib/ccrs-test-alerts', ALERT_SMTP_STARTTLS: 'false' });
  assert.deepEqual(c.to, ['a@x.org', 'b@x.org', 'c@x.org']);
  assert.equal(c.stateFile, '/var/lib/ccrs-test-alerts/state.json');
  assert.equal(c.starttls, false);
  assert.equal(c.maxList, 40);
  assert.equal(bareAddress('Name <n@x.org>'), 'n@x.org');
  // systemd passes StateDirectory= as STATE_DIRECTORY (colon-separated when several)
  assert.equal(readConfig({ STATE_DIRECTORY: '/var/lib/private/x:/var/lib/other' }).stateFile, '/var/lib/private/x/state.json');
  assert.equal(readConfig({ STATE_DIRECTORY: '/srv/a', ALERT_STATE_FILE: '/srv/b/s.json' }).stateFile, '/srv/b/s.json', 'an explicit file wins');
});

// --- tick: the 5-minute poll, end to end with a fake sender ---------------

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function box(t, catalogObj, stateObj) {
  const dir = tempDir(t, 'ra-test-');
  fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(catalogObj));
  if (stateObj) fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(stateObj));
  const cfg = readConfig({ ALERT_SMTP_URL: 'smtp://h:587', ALERT_FROM: 'a@x.org', ALERT_TO: 'r@x.org', ALERT_BOX_NAME: 'test', ALERT_WEBROOT: dir, ALERT_STATE_FILE: path.join(dir, 'state.json') });
  const state = () => JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  return { dir, cfg, state };
}

test('tick: first run on a box only baselines', (t) => {
  const { cfg, state } = box(t, catalog);
  const sent = [];
  assert.equal(tick({ cfg, opts: {}, send: (_c, s) => sent.push(s) }), 0);
  assert.equal(sent.length, 0);
  assert.equal(state().lastRunId, R3);
});

test('tick: a new run with regressions mails once and advances; the next tick is quiet', (t) => {
  const { cfg, state } = box(t, catalog, { lastRunId: R2 });
  const sent = [];
  const send = (_c, s) => sent.push(s);
  assert.equal(tick({ cfg, opts: {}, send }), 0);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /3 regressed/);
  assert.equal(state().lastRunId, R3);
  assert.equal(tick({ cfg, opts: {}, send }), 0);
  assert.equal(sent.length, 1, 'same run is never mailed twice');
});

test('tick: a failed send keeps the run and retries after a growing pause', (t) => {
  const { cfg, state } = box(t, catalog, { lastRunId: R2 });
  const t0 = Date.parse('2026-10-09T03:09:00Z');
  const fail = () => { throw Object.assign(new Error('curl exited 7: Failed to connect'), { curlExit: 7, reply: '' }); };
  const sent = [];
  const ok = (_c, s) => { sent.push(s); return '250'; };
  assert.equal(tick({ cfg, opts: {}, now: t0, send: fail }), 1);
  assert.equal(state().lastRunId, R2, 'the run is not marked handled');
  assert.equal(state().sendFailures, 1);
  assert.equal(tick({ cfg, opts: {}, now: t0 + 60_000, send: ok }), 1, 'held off: no login one minute later');
  assert.equal(sent.length, 0);
  assert.equal(tick({ cfg, opts: {}, now: t0 + 5 * 60_000, send: fail }), 1, '5 min later it tries again');
  assert.equal(state().sendFailures, 2);
  assert.equal(state().retryAfter, new Date(t0 + 15 * 60_000).toISOString(), 'then waits 10 min');
  // the timer fires on its own schedule, a moment before retryAfter: that tick goes ahead
  assert.equal(tick({ cfg, opts: {}, now: t0 + 15 * 60_000 - 1_000, send: ok }), 0);
  assert.equal(sent.length, 1);
  assert.equal(state().lastRunId, R3);
  assert.equal(state().sendFailures, undefined, 'a success clears the failure count');
  assert.equal(state().retryAfter, undefined);
});

test('retryDelayMs: 5, 10, 20, 40 minutes, then hourly; a throttled login 1, 2, then 4 hours', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 12].map(n => retryDelayMs(n) / 60_000), [5, 10, 20, 40, 60, 60]);
  assert.deepEqual([1, 2, 3, 4, 9].map(n => retryDelayMs(n, 'throttled') / 60_000), [60, 120, 240, 240, 240]);
});

test('classifySendError: a 4xx to AUTH is a throttle, a 5xx a rejected login', () => {
  const err = (curlExit, reply) => Object.assign(new Error('x'), { curlExit, reply });
  assert.equal(classifySendError(err(67, '454')), 'throttled'); // Gmail: Too many login attempts
  assert.equal(classifySendError(err(67, '535')), 'rejected');  // Gmail: Username and Password not accepted
  assert.equal(classifySendError(err(67, '534')), 'rejected');  // Gmail: Application-specific password required
  assert.equal(classifySendError(err(7, '')), 'other');         // could not connect
  assert.equal(classifySendError(err(55, '550')), 'other');     // a refused recipient is not a login problem
  assert.equal(classifySendError(new Error('spawn curl ENOENT')), 'other');
});

// A stand-in for curl, put first on PATH: records how it was called (argv,
// environment names, the --config file's mode and text, stdin) and answers
// with process.env.FAKE_CURL = "<reply> <exit code>" (default "250 0").
function fakeCurl(t) {
  const bin = tempDir(t, 'ra-curl-');
  const calls = path.join(bin, 'calls.jsonl');
  fs.writeFileSync(path.join(bin, 'curl'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const rec = { args, env: Object.keys(process.env), stdin: fs.readFileSync(0, 'utf8') };
const i = args.indexOf('--config');
if (i !== -1) {
  rec.configPath = args[i + 1];
  rec.configMode = (fs.statSync(rec.configPath).mode & 0o777).toString(8);
  rec.config = fs.readFileSync(rec.configPath, 'utf8');
}
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(rec) + '\\n');
const [reply, code] = (process.env.FAKE_CURL || '250 0').split(' ');
process.stdout.write(reply);
if (code !== '0') process.stderr.write('curl: (' + code + ') Login denied\\n');
process.exit(Number(code));
`, { mode: 0o755 });
  const saved = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, FAKE_CURL: process.env.FAKE_CURL,
    ALERT_SMTP_USER: process.env.ALERT_SMTP_USER, ALERT_SMTP_PASS: process.env.ALERT_SMTP_PASS };
  const tmp = tempDir(t, 'ra-tmpdir-');
  process.env.PATH = `${bin}${path.delimiter}${saved.PATH}`;
  process.env.TMPDIR = tmp; // sendMail's scratch dir goes here, so the test can see it is removed
  // as on the box, where the unit's EnvironmentFile= puts the login in the poll's environment
  process.env.ALERT_SMTP_USER = 'u@x.org';
  process.env.ALERT_SMTP_PASS = 'env-secret';
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  const read = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);
  return { tmp, calls: read };
}

test('sendMail: hands curl\'s exit code and the relay\'s reply to the caller (fake curl on PATH)', (t) => {
  const { tmp, calls } = fakeCurl(t);
  const cfg = { smtpUrl: 'smtp://h:587', starttls: true, smtpUser: 'u@x.org', smtpPass: 'p"a\\ss', from: 'a@x.org', to: ['r@x.org'] };
  process.env.FAKE_CURL = '250 0';
  assert.equal(sendMail(cfg, 's', 't'), '250');
  process.env.FAKE_CURL = '454 67';
  assert.throws(() => sendMail(cfg, 's', 't'), e => e.curlExit === 67 && e.reply === '454'
    && classifySendError(e) === 'throttled' && /last SMTP reply 454/.test(e.message));
  const [ok, failed] = calls();
  for (const c of [ok, failed]) {
    assert.equal(c.args[0], '--disable');
    assert.deepEqual(c.env.filter(k => k.startsWith('ALERT_')), [], 'no ALERT_* (password, login) in curl\'s environment');
    assert.ok(c.env.includes('PATH'), 'the rest of the environment is passed on');
    assert.equal(c.configMode, '600', 'the file holding the password is private to the poll');
    assert.equal(c.config, 'user = "u@x.org:p\\"a\\\\ss"\n');
    assert.ok(!c.args.join(' ').includes('p"a'), 'password never on argv');
    assert.ok(!fs.existsSync(c.configPath), 'config file gone after the send');
  }
  assert.match(ok.stdin, /^From: a@x\.org\r\n/);
  assert.deepEqual(fs.readdirSync(tmp), [], 'the scratch dir is removed after a success and after a failure');
});

function captureLog(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...m) => lines.push(m.join(' '));
  try { return { result: fn(), lines }; } finally { console.log = orig; }
}

test('tick: a throttled login says so, and waits an hour before the next login', (t) => {
  const { cfg, state } = box(t, catalog, { lastRunId: R2 });
  const t0 = Date.parse('2026-10-09T03:09:00Z');
  const throttled = () => { throw Object.assign(new Error('curl exited 67 (last SMTP reply 454): curl: (67) Login denied'), { curlExit: 67, reply: '454' }); };
  const { result, lines } = captureLog(() => tick({ cfg, opts: {}, now: t0, send: throttled }));
  assert.equal(result, 1);
  assert.equal(state().sendFailure, 'throttled');
  assert.equal(state().retryAfter, new Date(t0 + 60 * 60_000).toISOString());
  assert.match(lines.join('\n'), /send failed \(1 in a row, login throttled\)/);
  assert.match(lines.join('\n'), /Too many login attempts.*not necessarily a wrong password/s);
  const later = captureLog(() => tick({ cfg, opts: {}, now: t0 + 30 * 60_000, send: () => assert.fail('must not log in') }));
  assert.match(later.lines.join('\n'), /holding off until .* \(the relay is throttling logins\)/);
});

test('tick: a rejected login points at the credentials and keeps the short backoff', (t) => {
  const { cfg, state } = box(t, catalog, { lastRunId: R2 });
  const t0 = Date.parse('2026-10-09T03:09:00Z');
  const rejected = () => { throw Object.assign(new Error('curl exited 67 (last SMTP reply 535)'), { curlExit: 67, reply: '535' }); };
  const { lines } = captureLog(() => tick({ cfg, opts: {}, now: t0, send: rejected }));
  assert.equal(state().sendFailure, 'rejected');
  assert.equal(state().retryAfter, new Date(t0 + 5 * 60_000).toISOString());
  assert.match(lines.join('\n'), /login rejected.*app password/s);
});

test('tick: a half-written catalog is skipped without touching state', (t) => {
  const { dir, cfg, state } = box(t, catalog, { lastRunId: R2 });
  fs.writeFileSync(path.join(dir, 'catalog.json'), '{"runs": [');
  assert.equal(tick({ cfg, opts: {}, send: () => assert.fail('must not send') }), 0);
  assert.equal(state().lastRunId, R2);
});

test('tick: stale watchdog mails once per stale run when enabled', (t) => {
  const { cfg } = box(t, catalog, { lastRunId: R3 });
  cfg.staleAfterHours = 26;
  const sent = [];
  const send = (_c, s) => sent.push(s);
  const later = Date.parse('2026-10-08T00:00:00Z'); // R3 started 2026-10-06T15:42Z → ~32h
  assert.equal(tick({ cfg, opts: {}, now: later, send }), 0);
  assert.equal(tick({ cfg, opts: {}, now: later + 3_600_000, send }), 0);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /no new test run for 26h/);
});

test('tick: the state file is replaced in one step, never rewritten in place', (t) => {
  const { dir, cfg, state } = box(t, catalog, { lastRunId: R2 });
  // A hard link shares the file's inode: a rename leaves it holding the old
  // state, an in-place rewrite would change it too (and a crash mid-write
  // could leave state.json empty or half-written).
  const witness = path.join(dir, 'witness.json');
  fs.linkSync(path.join(dir, 'state.json'), witness);
  assert.equal(tick({ cfg, opts: {}, send: () => '250' }), 0);
  assert.equal(state().lastRunId, R3);
  assert.equal(JSON.parse(fs.readFileSync(witness, 'utf8')).lastRunId, R2);
  assert.ok(!fs.existsSync(path.join(dir, 'state.json.tmp')), 'no temp file left behind');
});

test('tick: during a backoff, a run that needs no mail is still recorded as handled', (t) => {
  const quiet = { runs: [run(R3), run(R2)], tests: [t2('x', [h(R3, 'passed'), h(R2, 'failed')])] };
  const retryAfter = '2026-10-09T05:00:00.000Z';
  const { cfg, state } = box(t, quiet, { lastRunId: R2, sendFailures: 1, sendFailure: 'other', retryAfter });
  const { result, lines } = captureLog(() => tick({ cfg, opts: {}, now: Date.parse('2026-10-09T04:00:00Z'), send: () => assert.fail('nothing to send') }));
  assert.equal(result, 0);
  assert.equal(state().lastRunId, R3, 'nothing to mail, so nothing to hold off');
  assert.doesNotMatch(lines.join('\n'), /holding off/);
});

test('tick: --dry-run never writes state and never sends', (t) => {
  const { cfg, state } = box(t, catalog, { lastRunId: R2 });
  const orig = console.log; console.log = () => {};
  try { assert.equal(tick({ cfg, opts: { dryRun: true }, send: () => assert.fail('must not send') }), 0); }
  finally { console.log = orig; }
  assert.equal(state().lastRunId, R2);
});
