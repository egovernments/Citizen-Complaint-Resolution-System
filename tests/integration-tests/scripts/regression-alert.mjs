#!/usr/bin/env node
/**
 * regression-alert.mjs — mail the recipients when a new integration-test run
 * regressed.
 *
 * Run every 5 minutes on the box by ccrs-test-alerts.timer, which the deploy
 * installs when `test_alerts_enabled: true` (see the test_alerts_* variables in
 * local-setup/ansible/inventory/host_vars/_example.yml). Plain Node with no npm
 * dependencies: a broken `npm install` of the suite must not also silence the
 * alerts about it. Mail goes out through curl's SMTP support.
 *
 * Each tick:
 *   1. Read <webroot>/catalog.json, which runner/run-cycle.sh publishes at the
 *      end of a run.
 *   2. If its newest run was already handled (state file), exit quietly.
 *   3. For every run newer than the last handled one, oldest first, compare
 *      each test with the run before it:
 *        regressed       failed or timed out now; the last time it RAN (a skip
 *                        doesn't count) it passed
 *        now skipped     skipped now; its last earlier verdict passed
 *        stopped running passed in the previous run; no result now
 *        fixed           passed now; the last time it ran it failed/timed out
 *      ("Verdict" excludes `interrupted`: the global timeout killed the test.)
 *      If the last handled run has left the catalog, the oldest run still in it
 *      is compared with each test's result at or before the last handled run
 *      instead (the runs in between are folded into it). If the last handled
 *      run is newer than the whole catalog (restored from a backup), the poll
 *      re-baselines on the catalog's newest run and mails nothing.
 *   4. If anything regressed, became skipped or stopped running, mail it to
 *      ALERT_TO: ONE mail per poll, so one SMTP login. Several runs that need
 *      a mail (runs piled up between polls, or while sends were failing) go
 *      out together as a digest with a section per run.
 *   5. Record the runs as handled. The state file says "sending" before curl
 *      starts (no send at all if that can't be written) and is updated right
 *      after, so a mail goes out at most once: a poll that finds a leftover
 *      "sending" mark (the previous one died, or could not record the result)
 *      logs it and does not resend. A failed send leaves the runs unhandled
 *      and is retried after a pause that grows with each failure OF THE SAME
 *      KIND: 5, 10, 20, 40, then every 60 minutes; for a login the relay
 *      refuses for now (a 4xx to AUTH, e.g. Gmail's "454 4.7.0 Too many login
 *      attempts" account lock) 1, 2, then 4 hours, because every attempt can
 *      extend that lock. The log says which kind, in plain words.
 *
 * Exit codes: 0 when the poll did what it should (including "nothing new" and
 * "holding off" during a pause), 1 when a send or the state file failed, 2 for
 * missing or malformed settings.
 *
 * The first tick on a box (no state file) only records the newest run as the
 * baseline and sends nothing, so enabling alerts doesn't mail old news. A state
 * file that exists but can't be read or parsed is NOT a first tick: the poll
 * logs an error and sends nothing until it is deleted (re-baseline) or fixed.
 *
 * Works on catalogs from before and after the not-run tracking change: it
 * compares runs through each test's runId-tagged history, which both have.
 *
 * Configuration (environment; the deploy writes /etc/ccrs-test-alerts.env):
 *   ALERT_SMTP_URL        smtp://host:587 (STARTTLS) or smtps://host:465
 *   ALERT_SMTP_STARTTLS   on smtp://: true (default) requires STARTTLS; false uses it
 *                         only when the relay offers it (see curlInvocation)
 *   ALERT_SMTP_USER       SMTP login (omit for an unauthenticated relay)
 *   ALERT_SMTP_PASS       SMTP password
 *   ALERT_FROM            "Name <addr>" or addr
 *   ALERT_TO              recipients, comma-separated, each "Name <addr>" or addr
 *                         (a display name with a comma must be "quoted")
 *   ALERT_BOX_NAME        label in the subject, e.g. bomet
 *   ALERT_DASHBOARD_URL   e.g. https://bometfeedbackhub.digit.org/tests/
 *   ALERT_REPO_URL        for compare links (default: the egovernments repo)
 *   ALERT_WEBROOT         where catalog.json lives (default /var/www/integration-tests)
 *   ALERT_STATE_FILE      default $STATE_DIRECTORY/state.json, else /var/lib/ccrs-test-alerts/state.json
 *   ALERT_MAX_LIST        max tests listed per group (default 40)
 *   ALERT_STALE_AFTER_HOURS  mail once if no new run for this long (0 = off, default)
 *
 * CLI (for operators and replays):
 *   node regression-alert.mjs [--dry-run] [--catalog <path>] [--state <path>] [--since <runId>]
 *   --dry-run prints the mail instead of sending and never writes state.
 *   --since <runId> treats that run as the last handled one (replays).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPO_URL = 'https://github.com/egovernments/Citizen-Complaint-Resolution-System';
const FAILED = new Set(['failed', 'timedOut']);

// ---------------------------------------------------------------------------
// Analysis (pure — unit-tested in regression-alert.test.mjs)
// ---------------------------------------------------------------------------

/** "2026-10-06_1544_4ee72cdb" → "2026-10-06_1544": run ids sort chronologically by this prefix. */
export function runKey(runId) {
  return String(runId).slice(0, 15);
}

/** A history entry's status, or undefined when it reached no verdict. */
function verdict(entry) {
  return entry && entry.status !== 'interrupted' ? entry.status : undefined;
}

/**
 * The runs newer than `lastRunId`, oldest first, each paired with the run
 * before it in the catalog.
 *
 * When `lastRunId` is no longer in the catalog (alerts were off, or sends kept
 * failing, for longer than the catalog's run window), every run newer than it
 * is returned. The oldest of those has no predecessor left in the catalog, so
 * it carries `since: lastRunId`: analyzeRun then compares it with each test's
 * result at or before that run, which folds the runs in between into it.
 */
export function runsToProcess(catalog, lastRunId) {
  const runs = Array.isArray(catalog?.runs) ? catalog.runs : []; // newest first
  if (!runs.length || !lastRunId || runs[0].id === lastRunId) return [];
  const idx = runs.findIndex(r => r.id === lastRunId);
  const fresh = idx !== -1 ? runs.slice(0, idx) : runs.filter(r => runKey(r.id) > runKey(lastRunId));
  return fresh.reverse().map(run => {
    const prev = runs[runs.indexOf(run) + 1] ?? null;
    return prev || idx !== -1 ? { run, prev } : { run, prev: null, since: lastRunId };
  });
}

/**
 * Is the last handled run newer than every run in the catalog? Then the
 * catalog went back in time (restored from a backup, or rebuilt), and its
 * newest run is old news: re-baseline on it rather than mail it again.
 */
export function catalogIsBehind(catalog, lastRunId) {
  const runs = Array.isArray(catalog?.runs) ? catalog.runs : [];
  return Boolean(runs.length && lastRunId) && !runs.some(r => r.id === lastRunId) && runKey(lastRunId) >= runKey(runs[0].id);
}

/** First line of a Playwright error message, ANSI stripped, capped. */
function firstErrorLine(message) {
  if (!message) return '';
  const line = String(message).replace(/\x1b\[[0-9;]*m/g, '').split('\n').find(l => l.trim()) ?? '';
  return line.trim().slice(0, 200);
}

/**
 * Compare one run with the run before it, test by test.
 * Returns the four groups plus the run summaries for the mail.
 *
 * With `since` (see runsToProcess) the run's predecessor has left the catalog:
 * each test is compared with its last result at or before `since`, the last
 * run the alerts handled, or, when its history no longer reaches back that
 * far, with the earliest result it still has. So a test that broke in a run
 * that has since left the catalog is still reported, here. `folded` counts the
 * runs between the two that test histories still show (a lower bound).
 */
export function analyzeRun(catalog, run, prev, since = null) {
  const regressed = [];
  const nowSkipped = [];
  const stopped = [];
  const fixed = [];
  const key = runKey(run.id);
  const sinceKey = since ? runKey(since) : null;
  const between = new Set();
  for (const t of catalog.tests || []) {
    const history = Array.isArray(t.history) ? t.history : []; // newest first
    const here = verdict(history.find(h => h.runId === run.id));
    // Every earlier result with a verdict, newest first. Only runs BEFORE this
    // one: when a batch of runs is compared, the newer ones are already in history.
    const allEarlier = history.filter(h => runKey(h.runId) < key && verdict(h));
    const lastPassed = allEarlier.find(h => h.status === 'passed');
    let earlier = allEarlier;
    if (since) {
      for (const h of allEarlier) if (runKey(h.runId) > sinceKey) between.add(h.runId);
      const known = allEarlier.filter(h => runKey(h.runId) <= sinceKey);
      earlier = known.length ? known : allEarlier.slice().reverse(); // reversed: the earliest result first
    }
    const last = earlier[0];                                  // a skip counts: "now skipped" is news once
    const lastRan = earlier.find(h => h.status !== 'skipped'); // passed → skipped → failed is still a regression
    const before = verdict(last);
    const ran = verdict(lastRan);
    const ref = { id: t.id, title: t.title, file: t.file, line: t.line };
    if (here && FAILED.has(here) && ran === 'passed') {
      const ranBefore = allEarlier.filter(h => h.status !== 'skipped');
      const priorFails = ranBefore.filter(h => FAILED.has(h.status)).length;
      const err = t.latestRun && t.latestRun.runId === run.id ? firstErrorLine(t.latestRun.errorMessage) : '';
      regressed.push({ ...ref, status: here, since: lastPassed.runId, error: err, flaky: priorFails > 0 ? { fails: priorFails, of: ranBefore.length } : null });
    } else if (here === 'skipped' && before === 'passed') {
      nowSkipped.push({ ...ref, since: lastPassed.runId });
    } else if (here === 'passed' && ran && FAILED.has(ran)) {
      fixed.push({ ...ref, since: lastRan.runId });
    } else if (!here && (since || prev) && verdict(history.find(h => h.runId === (since || prev.id))) === 'passed') {
      stopped.push(ref);
    }
  }
  const byFile = (a, b) => `${a.file}:${a.line}`.localeCompare(`${b.file}:${b.line}`, undefined, { numeric: true });
  return { run, prev, since, folded: between.size, regressed: regressed.sort(byFile), nowSkipped: nowSkipped.sort(byFile), stopped: stopped.sort(byFile), fixed: fixed.sort(byFile) };
}

/** Does this analysis warrant a mail? */
export function needsAlert(a) {
  return a.regressed.length + a.nowSkipped.length + a.stopped.length > 0;
}

// ---------------------------------------------------------------------------
// Mail composition
// ---------------------------------------------------------------------------

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function summaryLine(r) {
  if (!r) return '';
  const parts = [`${r.passed} passed`, `${r.failed} failed`, `${r.skipped} skipped`];
  if (typeof r.notRun === 'number' && r.notRun > 0) parts.push(`${r.notRun} not run`);
  return `${parts.join(' · ')} of ${r.total}`;
}

function testLink(cfg, id) {
  if (!cfg.dashboardUrl) return '';
  return `${cfg.dashboardUrl.replace(/\/?$/, '/')}#test/${encodeURIComponent(id)}`;
}

function listGroup(lines, title, items, cfg, render) {
  if (!items.length) return;
  lines.push('', `${title} (${items.length})`, '-'.repeat(Math.min(72, title.length + 6)));
  for (const it of items.slice(0, cfg.maxList)) render(it);
  if (items.length > cfg.maxList) lines.push(`  … and ${items.length - cfg.maxList} more (see the dashboard)`);
}

/** The lines for one analysed run: what ran, against what, and each group. */
function runLines(a, cfg) {
  const { run, prev } = a;
  const lines = [];
  lines.push(`Run:       ${run.id}  (${run.branch || '?'}@${run.sha || '?'})`);
  lines.push(`Result:    ${summaryLine(run)}`);
  if (run.cutShort) lines.push(`Cut short: ${run.cutShort}`);
  if (prev) {
    lines.push(`Previous:  ${prev.id}  (${prev.branch || '?'}@${prev.sha || '?'})`);
    lines.push(`           ${summaryLine(prev)}`);
    if (prev.sha && run.sha && prev.sha !== run.sha) {
      lines.push(`Changes:   ${cfg.repoUrl.replace(/\/$/, '')}/compare/${prev.sha}...${run.sha}`);
    }
  } else if (a.since) {
    const seen = a.folded ? `at least ${plural(a.folded, 'run')} show` : 'none shows';
    lines.push(`Previous:  ${a.since}  (the last run handled; no longer in the catalog)`);
    lines.push(`Folded:    the runs between the two have left the catalog too (${seen} in`,
      '           test histories), so they are not compared one by one. Each test is',
      `           compared with its last result at or before ${a.since}, or the`,
      '           earliest one it still has: what changed in those runs shows up here.');
  }

  listGroup(lines, 'REGRESSED — passed before, failing now', a.regressed, cfg, t => {
    lines.push(`  ✗ ${t.file}:${t.line} — ${t.title}`);
    lines.push(`      ${t.status}; last passed in ${t.since}${t.flaky ? ` · flaky: failed ${t.flaky.fails} of the last ${t.flaky.of} runs` : ''}`);
    if (t.error) lines.push(`      ${t.error}`);
    const link = testLink(cfg, t.id);
    if (link) lines.push(`      ${link}`);
  });
  listGroup(lines, 'NOW SKIPPED — passed before, skipped now', a.nowSkipped, cfg, t => {
    lines.push(`  ○ ${t.file}:${t.line} — ${t.title}  (last passed in ${t.since})`);
  });
  listGroup(lines, 'STOPPED RUNNING — passed in the previous run, no result now', a.stopped, cfg, t => {
    lines.push(`  · ${t.file}:${t.line} — ${t.title}`);
  });
  listGroup(lines, 'FIXED — failing before, passing now', a.fixed, cfg, t => {
    lines.push(`  ✓ ${t.file}:${t.line} — ${t.title}`);
  });
  return lines;
}

/** "3 regressed, 1 now skipped, 2 stopped running", summed over the analyses. */
function countsLine(list) {
  const n = k => list.reduce((sum, a) => sum + a[k].length, 0);
  return [[n('regressed'), 'regressed'], [n('nowSkipped'), 'now skipped'], [n('stopped'), 'stopped running']]
    .filter(([c]) => c > 0).map(([c, what]) => `${c} ${what}`).join(', ');
}

/**
 * Subject + plain-text body for the analysed runs that need a mail, oldest
 * first (one analysis or an array). One run gives that run's mail; several give
 * one digest with a section per run, so a backlog costs one SMTP login rather
 * than one per run. `newRuns` (how many runs the poll compared) lets the mail
 * say when other new runs had nothing to report.
 */
export function composeMail(analyses, cfg, { newRuns = 0 } = {}) {
  const list = Array.isArray(analyses) ? analyses : [analyses];
  const newest = list[list.length - 1].run;
  const lines = [`Box:       ${cfg.boxName}${cfg.dashboardUrl ? `  (${cfg.dashboardUrl})` : ''}`];
  const quiet = Math.max(0, newRuns - list.length);
  const quietNote = quiet ? ` (${plural(quiet, 'other new run')} had nothing to report)` : '';
  let subject;
  if (list.length === 1) {
    subject = `[CCRS tests][${cfg.boxName}] ${countsLine(list)} — ${newest.id}`;
    if (quiet) lines.push(`Since:     the last mail${quietNote}`);
    lines.push(...runLines(list[0], cfg));
  } else {
    subject = `[CCRS tests][${cfg.boxName}] ${list.length} runs: ${countsLine(list)} — latest ${newest.id}`;
    lines.push(`Runs:      ${list.length} runs to report since the last mail, oldest first${quietNote}`);
    list.forEach((a, i) => {
      lines.push('', `=== ${i + 1} of ${list.length} ${'='.repeat(60)}`, ...runLines(a, cfg));
    });
  }
  lines.push('', '—', 'Sent by tests/integration-tests/scripts/regression-alert.mjs on the box.',
    'Recipients and SMTP are the test_alerts_* settings in that box\'s host_vars.');
  return { subject, text: lines.join('\n') + '\n' };
}

/** The "no new run" watchdog mail. */
export function composeStaleMail(latest, hours, cfg) {
  const subject = `[CCRS tests][${cfg.boxName}] no new test run for ${hours}h — last ${latest.id}`;
  const text = [
    `Box:      ${cfg.boxName}${cfg.dashboardUrl ? `  (${cfg.dashboardUrl})` : ''}`,
    `Last run: ${latest.id}, started ${latest.startedAt}`,
    '',
    `No newer run has been published for more than ${hours} hours.`,
    'The usual causes: the nightly redeploy failed its smoke check (tests only',
    'start after a green deploy), the redeploy cron did not fire, or run-cycle.sh',
    'crashed before publishing. The redeploy log on the box says which.',
    '',
    '—', 'Sent once per stale run by regression-alert.mjs (ALERT_STALE_AFTER_HOURS).',
  ].join('\n') + '\n';
  return { subject, text };
}

/** The bare address out of "Name <addr>" (or addr itself). */
export function bareAddress(value) {
  const m = String(value).match(/<([^>]+)>/);
  return (m ? m[1] : String(value)).trim();
}

/** A bare address the relay can take in MAIL FROM / RCPT TO: local@domain, no spaces. */
export function isAddress(value) {
  return /^[^\s<>@,"]+@[^\s<>@,"]+$/.test(String(value));
}

/**
 * Split a recipient list on commas, but not on one inside a "quoted" display
 * name or <angle brackets>:
 *   'CCRS team <team@x.org>, "Doe, Jane" <jd@x.org>' → two entries.
 * Not on whitespace: "CCRS team <team@x.org>" is one recipient, not three.
 */
export function splitAddressList(value) {
  const out = [];
  let cur = '';
  let quoted = false;
  let angle = false;
  for (const ch of String(value ?? '')) {
    if (ch === '"' && !angle) quoted = !quoted;
    else if (ch === '<' && !quoted) angle = true;
    else if (ch === '>' && !quoted) angle = false;
    else if (ch === ',' && !quoted && !angle) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(e => e.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Headers: RFC 5322 folding, RFC 2047 encoded-words for anything not ASCII
// ---------------------------------------------------------------------------

/** RFC 2047 §2: a header line that carries an encoded-word stays within 76 characters. */
const MAX_HEADER_LINE = 76;
/**
 * UTF-8 bytes per encoded-word: 39 bytes are 52 base64 characters, so a word is
 * 64 characters (the limit is 75) and "Subject: " plus one word still fits a line.
 */
const WORD_BYTES = 39;

/** Text as "B" encoded-words of at most WORD_BYTES bytes each, never splitting a character. */
function encodedWords(text) {
  const words = [];
  let chunk = '';
  for (const ch of text) { // by code point: a multi-byte character stays in one word
    if (chunk && Buffer.byteLength(chunk + ch, 'utf8') > WORD_BYTES) { words.push(chunk); chunk = ''; }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map(w => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`);
}

/**
 * Unstructured text (the Subject) as header tokens: ASCII words stay as they
 * are, each run of other words becomes encoded-words. A decoder drops the
 * space between two encoded-words, so a run is encoded together, its own
 * spaces included.
 */
function textTokens(text) {
  const tokens = [];
  let run = [];
  const flush = () => { if (run.length) tokens.push(...encodedWords(run.join(' '))); run = []; };
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (/^[\x21-\x7e]+$/.test(word) && !word.includes('=?')) { flush(); tokens.push(word); } else run.push(word);
  }
  flush();
  return tokens;
}

/** A display name as header tokens: plain words as they are, other ASCII quoted, anything else encoded. */
function phraseTokens(name) {
  if (/^[\w!#$%&'*+\-/=?^`{|}~]+( [\w!#$%&'*+\-/=?^`{|}~]+)*$/.test(name) && /^[\x20-\x7e]*$/.test(name) && !name.includes('=?')) {
    return name.split(' ');
  }
  if (/^[\x20-\x7e]*$/.test(name)) return [`"${name.replace(/[\\"]/g, '\\$&')}"`];
  return encodedWords(name);
}

/** "Name <addr>", '"Doe, Jane" <addr>' or "addr" as header tokens. */
function mailboxTokens(value) {
  const m = String(value).trim().match(/^(.*?)\s*<([^<>]*)>$/s);
  if (!m) return [String(value).trim()];
  let name = m[1].trim();
  if (name.length >= 2 && name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1).replace(/\\(.)/g, '$1');
  return name ? [...phraseTokens(name), `<${m[2].trim()}>`] : [`<${m[2].trim()}>`];
}

/** "Field: tok tok …", folded onto continuation lines so no line passes MAX_HEADER_LINE. */
function foldHeader(field, tokens) {
  const lines = [];
  let line = `${field}:`;
  for (const tok of tokens) {
    if (line.length + 1 + tok.length > MAX_HEADER_LINE && line.trim() !== `${field}:`) { lines.push(line); line = ''; }
    line += ` ${tok}`;
  }
  lines.push(line);
  return lines.join('\r\n');
}

/** Address-list header (To:): mailboxes separated by commas. */
function addressHeader(field, mailboxes) {
  const tokens = [];
  mailboxes.forEach((mb, i) => {
    const toks = mailboxTokens(mb);
    if (i < mailboxes.length - 1) toks[toks.length - 1] += ',';
    tokens.push(...toks);
  });
  return foldHeader(field, tokens);
}

/** RFC 5322 message: UTF-8 text body, base64 so long lines and symbols survive any relay. */
export function buildMessage({ from, to, subject, text, date = new Date() }) {
  const domain = bareAddress(from).split('@')[1] || 'localhost';
  const body = Buffer.from(text, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return [
    addressHeader('From', [from]),
    addressHeader('To', to),
    foldHeader('Subject', textTokens(subject)),
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    'Auto-Submitted: auto-generated',
    '',
    body,
    '',
  ].join('\r\n');
}

// ---------------------------------------------------------------------------
// Sending (curl)
// ---------------------------------------------------------------------------

/** Quote a value for a curl config file (-K): backslash and double quote escaped. */
function curlQuote(v) {
  return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * curl argv + config-file contents for one send. The password goes in a
 * config file (mode 0600), never on argv where `ps` would show it.
 */
export function curlInvocation(cfg, recipients, configPath) {
  // --disable must come first: it stops curl reading ~/.curlrc, where a stray
  // `verbose` would print the AUTH exchange (the password, base64) into the
  // error text and from there into the journal.
  // --write-out prints the server's last reply code (250 once it accepted the
  // message after DATA), so the log shows what the relay said, not just "sent".
  const args = ['--disable', '--silent', '--show-error', '--connect-timeout', '20', '--max-time', '90',
    '--write-out', '%{response_code}',
    '--url', cfg.smtpUrl, '--mail-from', bareAddress(cfg.from), '--upload-file', '-'];
  // smtp://: --ssl-reqd fails unless STARTTLS succeeds; --ssl (starttls false)
  // upgrades when the relay offers STARTTLS and otherwise carries on in clear,
  // login included. Anyone on the path can strip that offer, so false is a
  // downgrade risk. smtps:// is TLS from the first byte either way.
  if (/^smtp:/i.test(cfg.smtpUrl)) args.push(cfg.starttls ? '--ssl-reqd' : '--ssl');
  // The envelope takes bare addresses; display names only go in the To: header.
  for (const r of recipients) args.push('--mail-rcpt', bareAddress(r));
  let config = '';
  if (cfg.smtpUser) {
    config = `user = ${curlQuote(`${cfg.smtpUser}:${cfg.smtpPass ?? ''}`)}\n`;
    args.push('--config', configPath);
  }
  return { args, config };
}

/**
 * The environment curl runs with: ours minus every ALERT_* variable. curl reads
 * the login from the 0600 config file; ALERT_SMTP_PASS / ALERT_SMTP_USER in its
 * environment would only be one more place to leak them from.
 */
export function curlEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('ALERT_')));
}

/**
 * Send one mail; returns the relay's final SMTP reply code (e.g. "250"). On
 * failure the thrown error carries curl's exit code and that reply
 * (`curlExit`, `reply`) for classifySendError.
 */
export function sendMail(cfg, subject, text) {
  const message = buildMessage({ from: cfg.from, to: cfg.to, subject, text });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccrs-alert-'));
  const configPath = path.join(dir, 'curl.conf');
  try {
    const { args, config } = curlInvocation(cfg, cfg.to, configPath);
    if (config) fs.writeFileSync(configPath, config, { mode: 0o600 });
    const r = spawnSync('curl', args, { input: message, encoding: 'utf8', timeout: 120_000, env: curlEnv() });
    if (r.error) throw r.error;
    const reply = (r.stdout || '').trim();
    if (r.status !== 0) {
      const err = new Error(`curl exited ${r.status} (last SMTP reply ${reply || 'none'}): ${(r.stderr || '').trim()}`);
      Object.assign(err, { curlExit: r.status, reply });
      throw err;
    }
    return reply;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

export function readConfig(env = process.env) {
  const to = splitAddressList(env.ALERT_TO);
  const stateDir = env.STATE_DIRECTORY ? env.STATE_DIRECTORY.split(':')[0] : '/var/lib/ccrs-test-alerts';
  return {
    smtpUrl: env.ALERT_SMTP_URL || '',
    starttls: !/^(0|false|no|off)$/i.test(env.ALERT_SMTP_STARTTLS || 'true'),
    smtpUser: env.ALERT_SMTP_USER || '',
    smtpPass: env.ALERT_SMTP_PASS || '',
    from: env.ALERT_FROM || '',
    to,
    boxName: env.ALERT_BOX_NAME || os.hostname(),
    dashboardUrl: env.ALERT_DASHBOARD_URL || '',
    repoUrl: env.ALERT_REPO_URL || DEFAULT_REPO_URL,
    webroot: env.ALERT_WEBROOT || '/var/www/integration-tests',
    stateFile: env.ALERT_STATE_FILE || path.join(stateDir, 'state.json'),
    maxList: Math.max(1, Number(env.ALERT_MAX_LIST) || 40),
    staleAfterHours: Math.max(0, Number(env.ALERT_STALE_AFTER_HOURS) || 0),
  };
}

/** What is missing or malformed in the mail settings (empty when they can be used). */
export function configProblems(cfg) {
  const problems = [];
  if (!cfg.smtpUrl) problems.push('ALERT_SMTP_URL is not set');
  if (!cfg.from) problems.push('ALERT_FROM is not set');
  else if (!isAddress(bareAddress(cfg.from))) problems.push(`ALERT_FROM is not "addr" or "Name <addr>": ${cfg.from}`);
  if (!cfg.to.length) problems.push('ALERT_TO is not set');
  for (const r of cfg.to) {
    if (!isAddress(bareAddress(r))) problems.push(`ALERT_TO entry is not "addr" or "Name <addr>": ${r}`);
  }
  return problems;
}

function parseArgs(argv) {
  const out = { dryRun: false, catalog: null, state: null, since: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--catalog') out.catalog = argv[++i];
    else if (a === '--state') out.state = argv[++i];
    else if (a === '--since') out.since = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * Read the state file: `{ state: null }` when there is none yet (first poll),
 * `{ state }` when it parses to an object, `{ error }` when it exists but can't
 * be trusted (unreadable, empty, not JSON). Only a missing file re-baselines:
 * silently starting over on a damaged one would skip every run since.
 */
export function readState(p) {
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (e) {
    return e.code === 'ENOENT' ? { state: null } : { error: e.message };
  }
  if (!raw.trim()) return { error: 'the file is empty' };
  try {
    const state = JSON.parse(raw);
    return state && typeof state === 'object' && !Array.isArray(state) ? { state } : { error: 'not a JSON object' };
  } catch (e) {
    return { error: `not valid JSON (${e.message})` };
  }
}

/**
 * Replace the state file durably: write a temp file, fsync it, rename it over
 * the old one, fsync the directory. A crash or power cut leaves the old state
 * or the new one, never an empty or half-written file.
 */
export function writeState(p, state) {
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${p}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o644);
  try {
    fs.writeSync(fd, `${JSON.stringify(state, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, p);
  let dirFd;
  try {
    dirFd = fs.openSync(dir, 'r');
    fs.fsyncSync(dirFd);
  } catch { /* not every platform can fsync a directory; the rename is still atomic */ } finally {
    if (dirFd !== undefined) fs.closeSync(dirFd);
  }
}

const log = (...m) => console.log('[regression-alert]', ...m);

/**
 * What kind of send failure this was, from curl's exit code and the relay's
 * last reply. curl exits 67 (CURLE_LOGIN_DENIED) when the relay refuses AUTH.
 *   starttls   a 530 (5.7.0), to AUTH or to MAIL FROM: the relay wants STARTTLS
 *              ("Must issue a STARTTLS command first") or a login ("Authentication
 *              required") before it takes mail. Not a wrong password.
 *   throttled  a 4xx to AUTH: refused for now, e.g. Gmail's "454 4.7.0 Too many
 *              login attempts" lock on the account. The password may be right.
 *   rejected   a 5xx to AUTH: wrong user/password, or an app password is needed.
 *   address    a 5xx to MAIL FROM or RCPT TO: the relay refuses the sender or a
 *              recipient for good (curl: "MAIL failed: 553", "RCPT failed: 550").
 *              A settings problem; retrying will not fix it.
 *   other      connection, TLS, a 4xx (try later), …
 */
export function classifySendError(e) {
  const reply = e?.reply || '';
  if (reply === '530') return 'starttls';
  if (e?.curlExit === 67 && /^4\d\d$/.test(reply)) return 'throttled';
  if (e?.curlExit === 67 && /^5\d\d$/.test(reply)) return 'rejected';
  if (/^5\d\d$/.test(reply) && /\b(MAIL|RCPT) failed\b/.test(e?.message || '')) return 'address';
  return 'other';
}

/** What the log adds to "send failed (N in a row…)", and to "holding off", per kind. */
const FAILURE_LABELS = {
  throttled: ', login throttled', rejected: ', login rejected', starttls: ', STARTTLS or login required',
  address: ', sender or recipient refused',
};
const HOLD_OFF_REASONS = {
  throttled: ' (the relay is throttling logins)', rejected: ' (the relay rejected the login)',
  starttls: ' (the relay wants STARTTLS or a login first)', address: ' (the relay refused the sender or a recipient)',
};

const SEND_FAILURE_HINTS = {
  throttled: 'The SMTP relay refused the login for now: it is throttling logins to the sender account '
    + '(Gmail: "454 4.7.0 Too many login attempts, please try again later"). That is not necessarily a '
    + 'wrong password, and every attempt can extend the lock, so retries wait 1, 2, then 4 hours. '
    + 'Check the sender account for a security alert or lock; do not retry by hand.',
  rejected: 'The SMTP relay rejected the login: test_alerts_smtp_user / test_alerts_smtp_password are '
    + 'wrong, or the account needs an app password. Fix them in host_vars or OpenBao and redeploy.',
  starttls: 'The SMTP relay answered 530: it wants STARTTLS, or a login, before it takes mail. That is not a '
    + 'wrong password. Set test_alerts_smtp_starttls: true (port 587) or test_alerts_smtp_tls: true (port 465) so '
    + 'the connection is always encrypted: with starttls false the poll only uses STARTTLS when the relay offers '
    + 'it, so a 530 then means it was not offered (or the offer was stripped on the way). If the relay needs a '
    + 'login, set test_alerts_smtp_user and the password. Then redeploy.',
  address: 'The SMTP relay refused the sender (MAIL FROM) or a recipient (RCPT TO). Check test_alerts_from '
    + '(an address the SMTP account may send as) and every test_alerts_to address in host_vars, then redeploy. '
    + 'Retrying will not help until they are fixed.',
};

/**
 * Pause after the nth failed send in a row of the same kind: 5, 10, 20, 40
 * minutes, then hourly; for a throttled login 1, 2, then 4 hours, so the
 * relay's lock can run out. tick() restarts the count when the kind changes.
 */
export function retryDelayMs(failures, kind = 'other') {
  const [first, cap] = kind === 'throttled' ? [60, 240] : [5, 60];
  return Math.min(first * 2 ** Math.max(0, failures - 1), cap) * 60_000;
}

/** One poll. Returns the process exit code. */
export function tick({ cfg, opts, now = Date.now(), send = sendMail }) {
  const catalogPath = opts.catalog || path.join(cfg.webroot, 'catalog.json');
  const statePath = opts.state || cfg.stateFile;
  const problems = opts.dryRun ? [] : configProblems(cfg);
  if (problems.length) {
    for (const p of problems) log(p);
    log('nothing can be sent: fix the test_alerts_* settings in host_vars and redeploy (they become /etc/ccrs-test-alerts.env)');
    return 2;
  }
  let catalog;
  try {
    catalog = readJson(catalogPath);
  } catch (e) {
    // run-cycle.sh copies catalog.json into place non-atomically; a half-written
    // file is simply retried on the next tick.
    log(`catalog not readable yet (${catalogPath}): ${e.message}`);
    return 0;
  }
  const latest = catalog.runs?.[0];
  if (!latest?.id) { log('catalog has no runs yet'); return 0; }

  const read = readState(statePath);
  if (read.error) {
    const fix = 'Delete it to re-baseline on the newest run (sends nothing), or restore it to carry on where it was.';
    if (!opts.dryRun) {
      log(`ERROR: the state file ${statePath} can't be used: ${read.error}. Nothing is sent until it is fixed. ${fix}`);
      return 1;
    }
    log(`warning: the state file ${statePath} can't be used (${read.error}); the dry run carries on without it`);
  }
  let state = read.state || {};
  const at = new Date(now).toISOString();
  const save = (next, when) => {
    if (opts.dryRun) return true;
    try {
      writeState(statePath, next);
      return true;
    } catch (e) {
      log(`ERROR: could not write the state file ${statePath} (${when}): ${e.message}`);
      return false;
    }
  };

  let lastRunId = opts.since || state.lastRunId;
  if (!lastRunId) {
    log(`no state yet — baseline is ${latest.id}; alerting starts with the next run`);
    return save({ lastRunId: latest.id, baselinedAt: at }, 'recording the baseline') ? 0 : 1;
  }

  // A "sending" mark left behind: an earlier poll handed a mail to curl and
  // never recorded how that ended (it was killed, or the state write after the
  // send failed). The mail may have gone out, so it is not sent again: at most
  // once beats a copy on every poll.
  if (state.sending && !opts.since && !opts.dryRun) {
    const { sending } = state;
    log(`WARNING: the poll at ${sending.at} was sending "${sending.subject}" and did not record the result, `
      + 'so it is unknown whether that mail arrived. It is not sent again; the runs it covered count as handled.');
    state = { ...state, lastRunId: sending.lastRunId || lastRunId, staleAlertedFor: sending.staleAlertedFor, sending: undefined };
    if (!save(state, 'clearing the interrupted send')) return 1;
    lastRunId = state.lastRunId;
  }

  // An unresolved send failure (its kind, count and pause) outlives runs that
  // need no mail, so the next mail still waits out the pause.
  const failure = { sendFailure: state.sendFailure, sendFailures: state.sendFailures, retryAfter: state.retryAfter };

  if (catalogIsBehind(catalog, lastRunId)) {
    log(`WARNING: the last handled run ${lastRunId} is newer than every run in the catalog (newest: ${latest.id}). `
      + `Was the catalog restored from a backup? Re-baselining on ${latest.id}; nothing is mailed.`);
    return save({ ...failure, lastRunId: latest.id, rebaselinedAt: at }, 're-baselining') ? 0 : 1;
  }
  const plan = runsToProcess(catalog, lastRunId);
  const analyses = plan.map(({ run, prev, since }) => analyzeRun(catalog, run, prev, since));
  for (const a of analyses) {
    if (a.since) {
      const seen = a.folded ? `at least ${plural(a.folded, 'run')} in between folded in` : 'no run in between shows in test histories';
      log(`last handled run ${a.since} has left the catalog: ${a.run.id} is compared with each test's result at or before it (${seen})`);
    }
    log(`${a.run.id} vs ${a.prev?.id ?? a.since}: ${a.regressed.length} regressed, ${a.nowSkipped.length} now skipped, ${a.stopped.length} stopped running, ${a.fixed.length} fixed`);
  }
  const toMail = analyses.filter(needsAlert);
  const newLast = plan.length ? plan[plan.length - 1].run.id : lastRunId;

  let staleFor = state.staleAlertedFor;
  let mail = null;
  if (toMail.length) {
    mail = composeMail(toMail, cfg, { newRuns: plan.length });
  } else if (cfg.staleAfterHours > 0 && !plan.length && latest.id === lastRunId && staleFor !== latest.id) {
    const age = (now - Date.parse(latest.startedAt)) / 3_600_000;
    if (Number.isFinite(age) && age > cfg.staleAfterHours) {
      mail = composeStaleMail(latest, cfg.staleAfterHours, cfg);
      staleFor = latest.id;
    }
  }
  if (!mail) {
    if (newLast !== state.lastRunId && !save({ ...failure, lastRunId: newLast, staleAlertedFor: staleFor, updatedAt: at }, 'recording the runs')) return 1;
    return 0;
  }
  if (opts.dryRun) {
    console.log(`\n===== DRY RUN — would mail ${cfg.to.join(', ') || '(no ALERT_TO)'} =====\nSubject: ${mail.subject}\n\n${mail.text}`);
    return 0;
  }

  // Waiting out a pause is the plan, not a failure: exit 0, or the unit would
  // show "failed" on every poll of a 4-hour backoff. The 30 s slack: the timer
  // fires a few hundred ms before retryAfter (stamped after node started), and
  // holding off then would add a whole poll.
  if (state.retryAfter && now + 30_000 < Date.parse(state.retryAfter)) {
    const lastSends = (state.sendFailures || 1) > 1 ? `the last ${state.sendFailures} sends` : 'the last send';
    log(`holding off until ${state.retryAfter}: ${lastSends} failed${HOLD_OFF_REASONS[state.sendFailure] ?? ''}`);
    return 0;
  }

  // Say "sending" first, and don't send if that can't be written: a mail that
  // went out but could not be recorded would go out again on every poll.
  const sending = { lastRunId: newLast, staleAlertedFor: staleFor, subject: mail.subject, at };
  if (!save({ ...state, lastRunId, sending }, 'before sending')) {
    log('not sending: without a record of it, the same mail would go out again on every poll');
    return 1;
  }
  let reply;
  try {
    reply = send(cfg, mail.subject, mail.text);
  } catch (e) {
    // The runs stay unhandled; a later poll retries them after the pause. The
    // count is per kind: a throttled login after three connection errors is the
    // first throttle (1 hour), not the fourth failure (4 hours).
    const sendFailure = classifySendError(e);
    const sendFailures = state.sendFailure === sendFailure ? (state.sendFailures || 0) + 1 : 1;
    const retryAfter = new Date(now + retryDelayMs(sendFailures, sendFailure)).toISOString();
    log(`send failed (${sendFailures} in a row${FAILURE_LABELS[sendFailure] ?? ''}), retrying after ${retryAfter}: ${e.message}`);
    if (SEND_FAILURE_HINTS[sendFailure]) log(SEND_FAILURE_HINTS[sendFailure]);
    if (!save({ ...state, lastRunId, sending: undefined, sendFailure, sendFailures, retryAfter }, 'recording the failed send')) {
      log('the failed send could not be recorded; the next poll will take this mail as possibly sent and not retry it');
    }
    return 1;
  }
  log(`mailed ${cfg.to.length} recipient(s)${typeof reply === 'string' && reply ? ` (SMTP ${reply})` : ''}: ${mail.subject}`);
  if (!save({ lastRunId: newLast, staleAlertedFor: staleFor, updatedAt: at }, 'after sending')) {
    log('the mail went out but is not recorded; the "sending" mark stops the next poll from sending it again');
    return 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  process.exitCode = tick({ cfg: readConfig(), opts });
}
