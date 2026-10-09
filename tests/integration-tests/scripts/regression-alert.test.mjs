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
  splitAddressList, isAddress, configProblems, readState, writeState, catalogIsBehind,
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

test('runsToProcess: a handled run that left the window → every run, the oldest folding in the gap', () => {
  const out = runsToProcess(catalog, '2026-09-01_0000_old');
  assert.deepEqual(out.map(x => [x.run.id, x.prev?.id ?? null, x.since ?? null]),
    [[R1, null, '2026-09-01_0000_old'], [R2, R1, null], [R3, R2, null]]);
});

test('catalogIsBehind: only a handled run newer than everything in the catalog', () => {
  assert.equal(catalogIsBehind(catalog, '2026-10-08_0900_eeee5555'), true, 'restored from an older backup');
  assert.equal(catalogIsBehind(catalog, R3), false);
  assert.equal(catalogIsBehind(catalog, R1), false);
  assert.equal(catalogIsBehind(catalog, '2026-09-01_0000_old'), false, 'older: the window moved on');
  assert.equal(catalogIsBehind({ runs: [] }, R3), false);
});

// The catalog keeps W1, W2. The last handled run, S, and D1, D2 after it have
// left it; per-test histories still show some of them.
const S0 = '2026-09-20_1542_55550000';
const D1 = '2026-09-21_1542_d1d1d1d1';
const D2 = '2026-09-22_1542_d2d2d2d2';
const W1 = '2026-09-23_1542_a1a1a1a1';
const W2 = '2026-09-24_1542_a2a2a2a2';
const gap = {
  runs: [run(W2, 'a2a2a2a2'), run(W1, 'a1a1a1a1')],
  tests: [
    t2('broke-in-d2', [h(W2, 'failed'), h(W1, 'failed'), h(D2, 'failed'), h(S0, 'passed')]),
    t2('short-history', [h(W2, 'passed'), h(W1, 'failed'), h(D2, 'failed'), h(D1, 'passed')]),
    t2('fixed-in-d1', [h(W2, 'passed'), h(W1, 'passed'), h(D1, 'passed'), h(S0, 'failed')]),
    t2('passed-at-s-then-gone', [h(S0, 'passed')]),
    t2('blip-in-d1', [h(W2, 'passed'), h(W1, 'passed'), h(D1, 'failed'), h(S0, 'passed')]),
    t2('steady', [h(W2, 'passed'), h(W1, 'passed'), h(D2, 'passed'), h(D1, 'passed'), h(S0, 'passed')]),
    t2('breaks-in-w2', [h(W2, 'failed'), h(W1, 'passed'), h(D2, 'passed')]),
  ],
};

test('analyzeRun: across a gap, the oldest run left is compared with what the last mail knew', () => {
  const [w1, w2] = runsToProcess(gap, S0).map(({ run: r, prev, since }) => analyzeRun(gap, r, prev, since));
  assert.equal(w1.since, S0);
  assert.equal(w1.folded, 2, 'D1 and D2 still show in histories');
  assert.deepEqual(w1.regressed.map(x => [x.id, x.since]), [['broke-in-d2', S0], ['short-history', D1]],
    'broke in a run that left the catalog: still reported, folded into W1');
  assert.deepEqual(w1.regressed.map(x => x.flaky), [{ fails: 1, of: 2 }, { fails: 1, of: 2 }], 'flaky counts the folded runs too');
  assert.deepEqual(w1.fixed.map(x => x.id), ['fixed-in-d1']);
  assert.deepEqual(w1.stopped.map(x => x.id), ['passed-at-s-then-gone'], 'passed in the last handled run, nothing since');
  assert.equal(w2.since, null);
  assert.deepEqual(w2.regressed.map(x => [x.id, x.since]), [['breaks-in-w2', W1]], 'W2 is compared with W1 as usual');
  assert.deepEqual(w2.fixed.map(x => x.id), ['short-history']);
});

test('composeMail: a folded run says what it was compared with', () => {
  const [w1] = runsToProcess(gap, S0).map(({ run: r, prev, since }) => analyzeRun(gap, r, prev, since));
  const m = composeMail(w1, { boxName: 'b', dashboardUrl: '', repoUrl: 'https://github.com/o/r', maxList: 40 });
  assert.match(m.text, new RegExp(`^Previous: {2}${S0} {2}\\(the last run handled; no longer in the catalog\\)$`, 'm'));
  assert.match(m.text, /^Folded: {4}the runs between the two have left the catalog too \(at least 2 runs show in$/m);
  assert.match(m.text, new RegExp(`compared with its last result at or before ${S0}`));
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

test('analyzeRun: a skip in between neither hides a regression nor a fix; "now skipped" is news once', () => {
  const R0 = '2026-10-03_1542_00000000';
  const c = {
    runs: [run(R3), run(R2), run(R1), run(R0)],
    tests: [
      t2('pass-skip-fail', [h(R3, 'failed'), h(R2, 'skipped'), h(R1, 'passed')]),
      t2('fail-skip-pass', [h(R3, 'passed'), h(R2, 'skipped'), h(R1, 'failed')]),
      t2('pass-skip-skip', [h(R3, 'skipped'), h(R2, 'skipped'), h(R1, 'passed')]),
      t2('fail-pass-skip-fail', [h(R3, 'failed'), h(R2, 'skipped'), h(R1, 'passed'), h(R0, 'failed')]),
    ],
  };
  const a = analyzeRun(c, run(R3), run(R2));
  assert.deepEqual(a.regressed.map(x => [x.id, x.since]), [['fail-pass-skip-fail', R1], ['pass-skip-fail', R1]]);
  assert.deepEqual(a.fixed.map(x => [x.id, x.since]), [['fail-skip-pass', R1]]);
  assert.deepEqual(a.nowSkipped, [], 'skipped again is not news');
  assert.deepEqual(a.regressed.find(x => x.id === 'fail-pass-skip-fail').flaky, { fails: 1, of: 2 }, 'a skip is not a run of the test');
});

test('analyzeRun: in a batch, "flaky" counts only the runs before the one compared', () => {
  const c = { runs: [run(R3), run(R2), run(R1)], tests: [t2('x', [h(R3, 'failed'), h(R2, 'failed'), h(R1, 'passed')])] };
  const a = analyzeRun(c, run(R2), run(R1));
  assert.deepEqual(a.regressed.map(x => x.id), ['x']);
  assert.equal(a.regressed[0].flaky, null, 'R3 came after R2: its failure says nothing about R2');
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

// An RFC 2047 reader, strict: each encoded-word must hold whole UTF-8 characters.
function headerValue(head, field) {
  const line = head.replace(/\r\n(?=[ \t])/g, '').split('\r\n').find(l => l.startsWith(`${field}:`));
  assert.ok(line, `${field}: header present`);
  return line.slice(field.length + 1).trim()
    .replace(/(\?=)\s+(?==\?)/g, '$1') // the space between two encoded-words is not part of the text
    .replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]*)\?=/g, (_, b64) => new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(b64, 'base64')));
}
function assertHeaderShape(head) {
  for (const l of head.split('\r\n')) assert.ok(l.length <= 76, `header line within 76 characters: ${l}`);
  for (const w of head.match(/=\?[^?]+\?B\?[^?]*\?=/g) || []) assert.ok(w.length <= 75, `encoded-word within 75 characters: ${w}`);
}

test('buildMessage: headers, encoded non-ASCII subject, base64 body that round-trips', () => {
  const text = 'Run: x — ✗ regressed\n' + 'y'.repeat(300) + '\n';
  const msg = buildMessage({ from: 'CCRS alerts <alerts@example.org>', to: ['a@x.org', 'b@x.org'], subject: '[x] 1 regressed — r', text, date: new Date('2026-10-08T06:30:00Z') });
  const [head, body] = msg.split('\r\n\r\n');
  assert.match(head, /^From: CCRS alerts <alerts@example\.org>$/m);
  assert.match(head, /^To: a@x\.org, b@x\.org$/m);
  assert.match(head, /^Subject: \[x\] 1 regressed =\?UTF-8\?B\?4oCU\?= r$/m, 'only the non-ASCII word is encoded');
  assert.equal(headerValue(head, 'Subject'), '[x] 1 regressed — r');
  assert.match(head, /^Date: Thu, 08 Oct 2026 06:30:00 \+0000$/m);
  assert.match(head, /^Message-ID: <[0-9a-f-]+@example\.org>$/m);
  assert.ok(body.split('\r\n').every(l => l.length <= 76), 'body lines wrapped for SMTP');
  assert.equal(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8'), text);
});

test('buildMessage: a long subject folds into short encoded-words that never split a character', () => {
  const cfg = { boxName: 'bomet', dashboardUrl: '', repoUrl: 'https://github.com/o/r', maxList: 40 };
  const real = composeMail(analyzeRun(catalog, catalog.runs[0], catalog.runs[1]), cfg).subject;
  const long = `[CCRS tests][Ñairobi-Süd] ${'Übersicht ✗ 😀 '.repeat(8)}— ${R3}`;
  // 4-byte characters (UTF-16 surrogate pairs) back to back: a word boundary
  // must fall between two of them, never inside one
  const emoji = `[CCRS tests] ${'😀'.repeat(30)} ${'äö😀'.repeat(12)} — ${R3}`;
  for (const subject of [real, long, emoji]) {
    const [head] = buildMessage({ from: 'a@x.org', to: ['b@x.org'], subject, text: 't' }).split('\r\n\r\n');
    assertHeaderShape(head);
    assert.equal(headerValue(head, 'Subject'), subject.replace(/\s+/g, ' ').trim());
  }
  const [head] = buildMessage({ from: 'a@x.org', to: ['b@x.org'], subject: long, text: 't' }).split('\r\n\r\n');
  assert.ok(head.split('\r\n').filter(l => /^ /.test(l)).length >= 3, 'continuation lines');
});

test('buildMessage: display names are quoted or encoded; addresses stay bare', () => {
  const msg = buildMessage({
    from: 'Équipe CCRS — alertes <alerts@example.org>',
    to: ['CCRS team <team@x.org>', '"Doe, Jane" <jd@x.org>', 'Dept. of Tests <dt@x.org>', 'plain@x.org', 'Zoë Ñ <z@x.org>'],
    subject: 's', text: 't',
  });
  const [head] = msg.split('\r\n\r\n');
  assertHeaderShape(head);
  assert.match(head, /^From: =\?UTF-8\?B\?[^ ]+\?= <alerts@example\.org>$/m, 'non-ASCII name encoded, address bare');
  assert.equal(headerValue(head, 'From'), 'Équipe CCRS — alertes <alerts@example.org>');
  assert.equal(headerValue(head, 'To'), 'CCRS team <team@x.org>, "Doe, Jane" <jd@x.org>, "Dept. of Tests" <dt@x.org>, plain@x.org, Zoë Ñ <z@x.org>');
  assert.ok(!/[^\x00-\x7f]/.test(head), 'the header block is pure ASCII');
});

test('curlInvocation: STARTTLS on smtp://, password only in the config file', () => {
  const cfg = { smtpUrl: 'smtp://smtp.example.org:587', starttls: true, smtpUser: 'u@x.org', smtpPass: 'p"a\\ss', from: 'A <a@x.org>' };
  const { args, config } = curlInvocation(cfg, ['r1@x.org', 'Team Two <r2@x.org>'], '/tmp/c.conf');
  assert.equal(args[0], '--disable', 'first, so ~/.curlrc is never read');
  assert.ok(args.includes('--ssl-reqd'));
  assert.equal(args[args.indexOf('--write-out') + 1], '%{response_code}', 'the relay\'s reply code is logged');
  assert.deepEqual(args.filter((_, i) => args[i - 1] === '--mail-rcpt'), ['r1@x.org', 'r2@x.org'], 'bare addresses in the envelope');
  assert.equal(args[args.indexOf('--mail-from') + 1], 'a@x.org');
  assert.ok(!args.join(' ').includes('p"a'), 'password never on argv');
  assert.equal(config, 'user = "u@x.org:p\\"a\\\\ss"\n');
  assert.ok(!args.includes('--ssl'), 'required, not merely tried');
  const optional = curlInvocation({ ...cfg, starttls: false }, ['r@x'], '/c').args;
  assert.ok(optional.includes('--ssl') && !optional.includes('--ssl-reqd'), 'starttls false: STARTTLS when offered');
  const smtps = curlInvocation({ ...cfg, smtpUrl: 'smtps://h:465' }, ['r@x'], '/c').args;
  assert.ok(!smtps.includes('--ssl-reqd') && !smtps.includes('--ssl'), 'smtps:// is TLS throughout');
  assert.equal(curlInvocation({ ...cfg, smtpUser: '' }, ['r@x'], '/c').config, '', 'no auth → no config file');
});

test('splitAddressList / isAddress / configProblems: one entry per recipient, each a usable address', () => {
  assert.deepEqual(splitAddressList('a@x.org,b@x.org , ,'), ['a@x.org', 'b@x.org']);
  assert.deepEqual(splitAddressList('CCRS team <team@x.org>'), ['CCRS team <team@x.org>'], 'spaces do not split');
  assert.deepEqual(splitAddressList('"A, B" <ab@x.org>, <odd,one@x.org>'), ['"A, B" <ab@x.org>', '<odd,one@x.org>']);
  assert.deepEqual(splitAddressList(undefined), []);
  assert.ok(isAddress('a.b+c@x.org'));
  for (const bad of ['CCRS', 'team', 'a@', '@x', 'a b@x.org', 'a@x.org,b@x.org']) assert.ok(!isAddress(bad), bad);
  const cfg = readConfig({ ALERT_SMTP_URL: 'smtp://h:587', ALERT_FROM: 'CCRS <a@x.org>', ALERT_TO: 'CCRS team <team@x.org>, ok@x.org' });
  assert.deepEqual(configProblems(cfg), []);
  assert.deepEqual(configProblems({ ...cfg, from: 'CCRS alerts', to: ['ok@x.org', 'team'] }), [
    'ALERT_FROM is not "addr" or "Name <addr>": CCRS alerts',
    'ALERT_TO entry is not "addr" or "Name <addr>": team',
  ]);
  assert.deepEqual(configProblems({ ...cfg, smtpUrl: '', from: '', to: [] }), ['ALERT_SMTP_URL is not set', 'ALERT_FROM is not set', 'ALERT_TO is not set']);
});

test('tick: a recipient that is not an address stops the poll before any login', (t) => {
  const { dir } = box(t, catalog, { lastRunId: R2 });
  const cfg = readConfig({ ALERT_SMTP_URL: 'smtp://h:587', ALERT_FROM: 'a@x.org', ALERT_TO: 'CCRS team', ALERT_WEBROOT: dir, ALERT_STATE_FILE: path.join(dir, 'state.json') });
  const { result, lines } = captureLog(() => tick({ cfg, opts: {}, send: () => assert.fail('must not send') }));
  assert.equal(result, 2);
  assert.match(lines.join('\n'), /ALERT_TO entry is not "addr" or "Name <addr>": CCRS team/);
});

test('curlEnv: drops every ALERT_* variable, keeps the rest', () => {
  assert.deepEqual(curlEnv({ PATH: '/bin', HOME: '/h', ALERT_SMTP_PASS: 's', ALERT_SMTP_USER: 'u', ALERT_TO: 'x' }), { PATH: '/bin', HOME: '/h' });
});

test('readConfig: recipients split on commas only; STATE_DIRECTORY; defaults', () => {
  const c = readConfig({ ALERT_TO: 'CCRS team <team@x.org>, "Doe, Jane" <jd@x.org>,c@x.org', STATE_DIRECTORY: '/var/lib/ccrs-test-alerts', ALERT_SMTP_STARTTLS: 'false' });
  assert.deepEqual(c.to, ['CCRS team <team@x.org>', '"Doe, Jane" <jd@x.org>', 'c@x.org']);
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
  const before = state();
  const held = captureLog(() => tick({ cfg, opts: {}, now: t0 + 60_000, send: ok }));
  assert.equal(held.result, 0, 'holding off is the plan, not a failed poll: the unit stays green');
  assert.match(held.lines.join('\n'), /holding off until 2026-10-09T03:14:00\.000Z: the last send failed/);
  assert.equal(sent.length, 0, 'no login one minute later');
  assert.deepEqual(state(), before, 'holding off changes nothing');
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

test('classifySendError: a 4xx to AUTH is a throttle, a 5xx a rejected login, a 530 wants STARTTLS', () => {
  const err = (curlExit, reply) => Object.assign(new Error('x'), { curlExit, reply });
  assert.equal(classifySendError(err(67, '454')), 'throttled'); // Gmail: Too many login attempts
  assert.equal(classifySendError(err(67, '535')), 'rejected');  // Gmail: Username and Password not accepted
  assert.equal(classifySendError(err(67, '534')), 'rejected');  // Gmail: Application-specific password required
  assert.equal(classifySendError(err(67, '530')), 'starttls');  // Mailpit/Gmail: 530 5.7.0 Must issue a STARTTLS command first (to AUTH)
  assert.equal(classifySendError(Object.assign(new Error('curl exited 55 (last SMTP reply 530): curl: (55) MAIL failed: 530'), { curlExit: 55, reply: '530' })),
    'starttls');                                                 // 530 5.7.0 Authentication required (to MAIL FROM)
  assert.equal(classifySendError(err(7, '')), 'other');         // could not connect
  assert.equal(classifySendError(err(55, '550')), 'other');     // no MAIL/RCPT in the message: not known to be an address
  const curlErr = (curlExit, reply, what) => Object.assign(new Error(`curl exited ${curlExit} (last SMTP reply ${reply}): curl: (${curlExit}) ${what} failed: ${reply}`), { curlExit, reply });
  assert.equal(classifySendError(curlErr(55, '550', 'RCPT')), 'address'); // Mailpit: recipient not allowed
  assert.equal(classifySendError(curlErr(55, '553', 'MAIL')), 'address'); // sender not owned by the account
  assert.equal(classifySendError(curlErr(55, '450', 'RCPT')), 'other');   // 4xx: try again later
  assert.equal(classifySendError(curlErr(55, '554', 'DATA')), 'other');   // the message, not an address
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

test('tick: a 530 says STARTTLS (or a login) is required, not that the password is wrong', (t) => {
  const { cfg, state } = box(t, catalog, { lastRunId: R2 });
  const needsTls = () => { throw Object.assign(new Error('curl exited 67 (last SMTP reply 530): curl: (67) Login denied'), { curlExit: 67, reply: '530' }); };
  const { lines } = captureLog(() => tick({ cfg, opts: {}, now: Date.parse('2026-10-09T03:09:00Z'), send: needsTls }));
  assert.equal(state().sendFailure, 'starttls');
  const out = lines.join('\n');
  assert.match(out, /send failed \(1 in a row, STARTTLS or login required\)/);
  assert.match(out, /not a wrong password.*test_alerts_smtp_starttls: true/s);
  assert.doesNotMatch(out, /app password/);
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
  assert.equal(state().retryAfter, retryAfter, 'the pause still applies to the next mail');
  assert.equal(state().sendFailures, 1);
});

// --- one mail per poll, recorded around the send --------------------------

const catalog4 = (() => {
  const R4 = '2026-10-07_1542_dddd4444';
  return {
    R4,
    runs: [run(R4, 'dddd4444'), run(R3, 'cccc3333'), run(R2, 'bbbb2222'), run(R1, 'aaaa1111')],
    tests: [
      t2('breaks-in-r2', [h(R4, 'failed'), h(R3, 'failed'), h(R2, 'failed'), h(R1, 'passed')]),
      t2('breaks-in-r3', [h(R4, 'failed'), h(R3, 'failed'), h(R2, 'passed'), h(R1, 'passed')]),
      t2('breaks-in-r4', [h(R4, 'failed'), h(R3, 'passed'), h(R2, 'passed'), h(R1, 'passed')]),
    ],
  };
})();
const upTo = (c, runId) => ({ ...c, runs: c.runs.slice(c.runs.findIndex(r => r.id === runId)) });

test('tick: several runs to report go out as ONE digest mail (one login), oldest first', (t) => {
  const { cfg, state } = box(t, catalog4, { lastRunId: R1 });
  const sent = [];
  assert.equal(tick({ cfg, opts: {}, send: (_c, subject, text) => { sent.push({ subject, text }); return '250'; } }), 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, `[CCRS tests][test] 3 runs: 3 regressed — latest ${catalog4.R4}`);
  const sections = sent[0].text.split(/^=== \d of 3 =+$/m).slice(1);
  assert.deepEqual(sections.map(x => x.match(/^Run: +(\S+)/m)[1]), [R2, R3, catalog4.R4]);
  assert.deepEqual(sections.map(x => x.match(/✗ tests\/(\S+)\.spec/)[1]), ['breaks-in-r2', 'breaks-in-r3', 'breaks-in-r4']);
  assert.equal(state().lastRunId, catalog4.R4);
});

test('composeMail: one run to report among several new ones says the others had nothing', () => {
  const c = { runs: catalog4.runs, tests: [t2('x', [h(R3, 'failed'), h(R2, 'passed'), h(R1, 'passed')])] };
  const analyses = runsToProcess(upTo(c, R3), R1).map(({ run: r, prev }) => analyzeRun(c, r, prev));
  const m = composeMail(analyses.filter(needsAlert), { boxName: 'b', dashboardUrl: '', repoUrl: 'https://github.com/o/r', maxList: 40 }, { newRuns: analyses.length });
  assert.equal(m.subject, `[CCRS tests][b] 1 regressed — ${R3}`);
  assert.match(m.text, /^Since: {5}the last mail \(1 other new run had nothing to report\)$/m);
});

test('tick: after a gap longer than the catalog window, every run left is mailed, the gap folded in', (t) => {
  const { cfg, state } = box(t, gap, { lastRunId: S0 });
  const sent = [];
  const { result, lines } = captureLog(() => tick({ cfg, opts: {}, send: (_c, subject, text) => { sent.push({ subject, text }); return '250'; } }));
  assert.equal(result, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, `[CCRS tests][test] 2 runs: 3 regressed, 1 stopped running — latest ${W2}`);
  assert.match(sent[0].text, /=== 1 of 2 =+\nRun: +2026-09-23_1542_a1a1a1a1[^]*Folded:[^]*=== 2 of 2 =+\nRun: +2026-09-24_1542_a2a2a2a2/);
  assert.match(lines.join('\n'), /last handled run 2026-09-20_1542_55550000 has left the catalog: 2026-09-23_1542_a1a1a1a1 is compared with each test's result at or before it \(at least 2 runs in between folded in\)/);
  assert.equal(state().lastRunId, W2);
});

test('tick: a catalog older than the state (restored from a backup) re-baselines without mailing', (t) => {
  const ahead = '2026-10-08_0900_eeee5555';
  const { cfg, state } = box(t, catalog, { lastRunId: ahead, sendFailure: 'other', sendFailures: 2, retryAfter: '2026-10-09T05:00:00.000Z' });
  const { result, lines } = captureLog(() => tick({ cfg, opts: {}, now: Date.parse('2026-10-09T04:00:00Z'), send: () => assert.fail('old news') }));
  assert.equal(result, 0);
  assert.match(lines.join('\n'), /WARNING: the last handled run 2026-10-08_0900_eeee5555 is newer than every run in the catalog \(newest: 2026-10-06_1544_cccc3333\)[^]*Re-baselining/);
  assert.equal(state().lastRunId, R3);
  assert.equal(state().retryAfter, '2026-10-09T05:00:00.000Z', 'a pending pause is kept');
  assert.equal(tick({ cfg, opts: {}, send: () => assert.fail('nothing new') }), 0, 'and the next poll is quiet');
});

test('tick: a mail that was delivered is never sent again when a later one fails', (t) => {
  // The bug this guards: run 2's mail went out, run 3's failed, and the next
  // poll sent run 2 again (twice), then run 3.
  const { dir, cfg, state } = box(t, upTo(catalog4, R2), { lastRunId: R1 });
  const put = c => fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(c));
  const delivered = [];
  const ok = (_c, subject) => { delivered.push(subject); return '250'; };
  const down = () => { throw Object.assign(new Error('curl exited 7: Failed to connect'), { curlExit: 7, reply: '' }); };
  const t0 = Date.parse('2026-10-09T03:00:00Z');
  assert.equal(tick({ cfg, opts: {}, now: t0, send: ok }), 0);
  assert.equal(state().lastRunId, R2, 'progress saved right after the mail');
  put(upTo(catalog4, catalog4.R4));
  assert.equal(tick({ cfg, opts: {}, now: t0 + 60_000, send: down }), 1);
  assert.equal(state().lastRunId, R2, 'the delivered run stays handled');
  assert.equal(tick({ cfg, opts: {}, now: t0 + 10 * 60_000, send: ok }), 0);
  assert.equal(tick({ cfg, opts: {}, now: t0 + 20 * 60_000, send: ok }), 0);
  assert.deepEqual(delivered, [
    `[CCRS tests][test] 1 regressed — ${R2}`,
    `[CCRS tests][test] 2 runs: 2 regressed — latest ${catalog4.R4}`,
  ]);
  assert.equal(state().lastRunId, catalog4.R4);
});

test('tick: "sending" is on disk before curl starts, and gone once the mail is recorded', (t) => {
  const { cfg, state } = box(t, catalog, { lastRunId: R2 });
  let during;
  assert.equal(tick({ cfg, opts: {}, now: Date.parse('2026-10-09T03:00:00Z'), send: () => { during = state(); return '250'; } }), 0);
  assert.equal(during.lastRunId, R2, 'not yet handled while sending');
  assert.deepEqual(Object.keys(during.sending).sort(), ['at', 'lastRunId', 'subject']);
  assert.equal(during.sending.lastRunId, R3, 'the runs this mail covers');
  assert.equal(during.sending.at, '2026-10-09T03:00:00.000Z');
  assert.match(during.sending.subject, /3 regressed/);
  assert.equal(state().sending, undefined);
  assert.equal(state().lastRunId, R3);
});

test('tick: if the state file cannot be written, nothing is sent, poll after poll', (t) => {
  const { dir, cfg, state } = box(t, catalog, { lastRunId: R2 });
  fs.mkdirSync(path.join(dir, 'state.json.tmp')); // blocks the write, even for root
  for (let i = 0; i < 3; i++) {
    const { result, lines } = captureLog(() => tick({ cfg, opts: {}, send: () => assert.fail('must not send') }));
    assert.equal(result, 1);
    assert.match(lines.join('\n'), /ERROR: could not write the state file .* \(before sending\)[^]*not sending/);
  }
  assert.equal(state().lastRunId, R2);
});

test('tick: a mail sent but not recorded is not sent again by the next poll', (t) => {
  const { dir, cfg, state } = box(t, catalog, { lastRunId: R2 });
  const tmp = path.join(dir, 'state.json.tmp');
  const sent = [];
  // The send succeeds; the state write right after it fails.
  const first = captureLog(() => tick({ cfg, opts: {}, now: Date.parse('2026-10-09T03:00:00Z'), send: (_c, s) => { sent.push(s); fs.mkdirSync(tmp); return '250'; } }));
  assert.equal(first.result, 1);
  assert.match(first.lines.join('\n'), /mail went out but is not recorded/);
  assert.equal(state().lastRunId, R2);
  assert.equal(state().sending.lastRunId, R3);
  fs.rmdirSync(tmp);
  const second = captureLog(() => tick({ cfg, opts: {}, now: Date.parse('2026-10-09T03:05:00Z'), send: (_c, s) => { sent.push(s); return '250'; } }));
  assert.equal(second.result, 0);
  assert.equal(sent.length, 1, 'at most once');
  assert.match(second.lines.join('\n'), /WARNING: the poll at 2026-10-09T03:00:00\.000Z was sending "\[CCRS tests\]\[test\] 3 regressed[^"]*" and did not record the result/);
  assert.equal(state().lastRunId, R3);
  assert.equal(state().sending, undefined);
});

test('tick: an operator replay (--since) starts where it is told and clears a leftover "sending" mark', (t) => {
  const stale = { lastRunId: R3, subject: 'old', at: '2026-10-01T00:00:00.000Z' };
  const { cfg, state } = box(t, catalog, { lastRunId: R3, sending: stale });
  const down = () => { throw Object.assign(new Error('curl exited 7'), { curlExit: 7, reply: '' }); };
  captureLog(() => assert.equal(tick({ cfg, opts: { since: R2 }, send: down }), 1));
  assert.equal(state().lastRunId, R2, 'the replay starts at --since');
  assert.equal(state().sending, undefined, 'the old mark must not later pass for this failed mail');
  const sent = [];
  captureLog(() => tick({ cfg, opts: { since: R2 }, now: Date.now() + 3_600_000, send: (_c, s2) => { sent.push(s2); return '250'; } }));
  assert.equal(sent.length, 1);
  assert.equal(state().sending, undefined);
});

test('tick: a state file that exists but is empty or not JSON stops the poll loudly; it is left alone', (t) => {
  for (const [content, why] of [['', /the file is empty/], ['{"lastRunId": "2026-10-0', /not valid JSON/], ['[]', /not a JSON object/]]) {
    const { dir, cfg } = box(t, catalog);
    fs.writeFileSync(path.join(dir, 'state.json'), content);
    const { result, lines } = captureLog(() => tick({ cfg, opts: {}, send: () => assert.fail('must not send') }));
    assert.equal(result, 1);
    assert.match(lines.join('\n'), /ERROR: the state file .* can't be used/);
    assert.match(lines.join('\n'), why);
    assert.match(lines.join('\n'), /Delete it to re-baseline/);
    assert.equal(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'), content, 'not overwritten by a silent re-baseline');
  }
  assert.deepEqual(readState('/nonexistent/state.json'), { state: null }, 'only a missing file is a first poll');
});

test('tick: the failure count is per kind, so a throttle after other failures still starts at 1 hour', (t) => {
  const t0 = Date.parse('2026-10-09T03:00:00Z');
  const { cfg, state } = box(t, catalog, { lastRunId: R2, sendFailure: 'other', sendFailures: 4, retryAfter: new Date(t0 - 1).toISOString() });
  const throttled = () => { throw Object.assign(new Error('curl exited 67 (last SMTP reply 454)'), { curlExit: 67, reply: '454' }); };
  const { lines } = captureLog(() => tick({ cfg, opts: {}, now: t0, send: throttled }));
  assert.match(lines.join('\n'), /send failed \(1 in a row, login throttled\)/);
  assert.equal(state().sendFailures, 1);
  assert.equal(state().retryAfter, new Date(t0 + 60 * 60_000).toISOString(), '1 hour, not the 4-hour cap');
  captureLog(() => tick({ cfg, opts: {}, now: t0 + 60 * 60_000, send: throttled }));
  assert.equal(state().sendFailures, 2);
  assert.equal(state().retryAfter, new Date(t0 + 3 * 60 * 60_000).toISOString(), 'then 2 hours');
});

test('writeState: fsyncs the file and its directory, replaces atomically, leaves no temp file', (t) => {
  const dir = tempDir(t, 'ra-state-');
  const p = path.join(dir, 'state.json');
  const fsyncs = [];
  const orig = fs.fsyncSync;
  fs.fsyncSync = fd => { fsyncs.push(fs.fstatSync(fd).isDirectory() ? 'dir' : 'file'); return orig(fd); };
  try { writeState(p, { lastRunId: R3, skipped: undefined }); } finally { fs.fsyncSync = orig; }
  assert.deepEqual(fsyncs, ['file', 'dir']);
  assert.equal(fs.readFileSync(p, 'utf8'), `{\n  "lastRunId": "${R3}"\n}\n`);
  assert.deepEqual(fs.readdirSync(dir), ['state.json']);
});

test('tick: --dry-run never writes state and never sends', (t) => {
  const { cfg, state } = box(t, catalog, { lastRunId: R2 });
  const orig = console.log; console.log = () => {};
  try { assert.equal(tick({ cfg, opts: { dryRun: true }, send: () => assert.fail('must not send') }), 0); }
  finally { console.log = orig; }
  assert.equal(state().lastRunId, R2);
});
