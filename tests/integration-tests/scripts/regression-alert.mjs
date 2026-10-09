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
 *        regressed       failed or timed out now; its last earlier verdict passed
 *        now skipped     skipped now; its last earlier verdict passed
 *        stopped running passed in the previous run; no result now
 *        fixed           passed now; its last earlier verdict failed/timed out
 *      ("Verdict" excludes `interrupted`: the global timeout killed the test.)
 *   4. If anything regressed, became skipped or stopped running, mail the
 *      summary to ALERT_TO. Then record the run as handled. A failed send is
 *      retried, because the state is only advanced after it, but with a
 *      growing pause (5, 10, 20, 40, then every 60 minutes): a relay that
 *      throttles logins (Gmail: "454 4.7.0 Too many login attempts") stays
 *      throttled if it is retried every tick.
 *
 * The first tick on a box (no state file) only records the newest run as the
 * baseline and sends nothing, so enabling alerts doesn't mail old news.
 *
 * Works on catalogs from before and after the not-run tracking change: it
 * compares runs through each test's runId-tagged history, which both have.
 *
 * Configuration (environment; the deploy writes /etc/ccrs-test-alerts.env):
 *   ALERT_SMTP_URL        smtp://host:587 (STARTTLS) or smtps://host:465
 *   ALERT_SMTP_STARTTLS   true|false — require STARTTLS on smtp:// (default true)
 *   ALERT_SMTP_USER       SMTP login (omit for an unauthenticated relay)
 *   ALERT_SMTP_PASS       SMTP password
 *   ALERT_FROM            "Name <addr>" or addr
 *   ALERT_TO              recipients, comma- or space-separated
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
 *   --dry-run prints the mail(s) instead of sending and never writes state.
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
 * before it in the catalog. If `lastRunId` has left the catalog's window (the
 * poller was down for a while), only the newest run is compared.
 */
export function runsToProcess(catalog, lastRunId) {
  const runs = Array.isArray(catalog?.runs) ? catalog.runs : []; // newest first
  if (!runs.length || !lastRunId || runs[0].id === lastRunId) return [];
  const idx = runs.findIndex(r => r.id === lastRunId);
  const fresh = idx === -1 ? [runs[0]] : runs.slice(0, idx);
  return fresh.reverse().map(run => {
    const i = runs.findIndex(r => r.id === run.id);
    return { run, prev: runs[i + 1] ?? null };
  });
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
 */
export function analyzeRun(catalog, run, prev) {
  const regressed = [];
  const nowSkipped = [];
  const stopped = [];
  const fixed = [];
  const key = runKey(run.id);
  for (const t of catalog.tests || []) {
    const history = Array.isArray(t.history) ? t.history : []; // newest first
    const here = verdict(history.find(h => h.runId === run.id));
    const earlier = history.find(h => runKey(h.runId) < key && verdict(h));
    const before = verdict(earlier);
    const ref = { id: t.id, title: t.title, file: t.file, line: t.line };
    if (here && FAILED.has(here) && before === 'passed') {
      const priorFails = history.filter(h => h.runId !== run.id && FAILED.has(h.status)).length;
      const priorRuns = history.filter(h => h.runId !== run.id && verdict(h)).length;
      const err = t.latestRun && t.latestRun.runId === run.id ? firstErrorLine(t.latestRun.errorMessage) : '';
      regressed.push({ ...ref, status: here, since: earlier.runId, error: err, flaky: priorFails > 0 ? { fails: priorFails, of: priorRuns } : null });
    } else if (here === 'skipped' && before === 'passed') {
      nowSkipped.push({ ...ref, since: earlier.runId });
    } else if (here === 'passed' && before && FAILED.has(before)) {
      fixed.push({ ...ref, since: earlier.runId });
    } else if (!here && prev && verdict(history.find(h => h.runId === prev.id)) === 'passed') {
      stopped.push(ref);
    }
  }
  const byFile = (a, b) => `${a.file}:${a.line}`.localeCompare(`${b.file}:${b.line}`, undefined, { numeric: true });
  return { run, prev, regressed: regressed.sort(byFile), nowSkipped: nowSkipped.sort(byFile), stopped: stopped.sort(byFile), fixed: fixed.sort(byFile) };
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

/** Subject + plain-text body for one analysed run. */
export function composeMail(a, cfg) {
  const { run, prev } = a;
  const counts = [];
  if (a.regressed.length) counts.push(`${a.regressed.length} regressed`);
  if (a.nowSkipped.length) counts.push(`${a.nowSkipped.length} now skipped`);
  if (a.stopped.length) counts.push(`${a.stopped.length} stopped running`);
  const subject = `[CCRS tests][${cfg.boxName}] ${counts.join(', ')} — ${run.id}`;

  const lines = [];
  lines.push(`Box:       ${cfg.boxName}${cfg.dashboardUrl ? `  (${cfg.dashboardUrl})` : ''}`);
  lines.push(`Run:       ${run.id}  (${run.branch || '?'}@${run.sha || '?'})`);
  lines.push(`Result:    ${summaryLine(run)}`);
  if (run.cutShort) lines.push(`Cut short: ${run.cutShort}`);
  if (prev) {
    lines.push(`Previous:  ${prev.id}  (${prev.branch || '?'}@${prev.sha || '?'})`);
    lines.push(`           ${summaryLine(prev)}`);
    if (prev.sha && run.sha && prev.sha !== run.sha) {
      lines.push(`Changes:   ${cfg.repoUrl.replace(/\/$/, '')}/compare/${prev.sha}...${run.sha}`);
    }
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

/** RFC 2047 encoded-word for non-ASCII header values. */
function encodeHeader(value) {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** The bare address out of "Name <addr>" (or addr itself). */
export function bareAddress(value) {
  const m = String(value).match(/<([^>]+)>/);
  return (m ? m[1] : String(value)).trim();
}

/** RFC 5322 message: UTF-8 text body, base64 so long lines and symbols survive any relay. */
export function buildMessage({ from, to, subject, text, date = new Date() }) {
  const domain = bareAddress(from).split('@')[1] || 'localhost';
  const body = Buffer.from(text, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return [
    `From: ${from}`,
    `To: ${to.join(', ')}`,
    `Subject: ${encodeHeader(subject)}`,
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
  // --write-out prints the server's last reply code (250 once it accepted the
  // message after DATA), so the log shows what the relay said, not just "sent".
  const args = ['--silent', '--show-error', '--connect-timeout', '20', '--max-time', '90',
    '--write-out', '%{response_code}',
    '--url', cfg.smtpUrl, '--mail-from', bareAddress(cfg.from), '--upload-file', '-'];
  if (cfg.starttls && /^smtp:/i.test(cfg.smtpUrl)) args.push('--ssl-reqd');
  for (const r of recipients) args.push('--mail-rcpt', r);
  let config = '';
  if (cfg.smtpUser) {
    config = `user = ${curlQuote(`${cfg.smtpUser}:${cfg.smtpPass ?? ''}`)}\n`;
    args.push('--config', configPath);
  }
  return { args, config };
}

/** Send one mail; returns the relay's final SMTP reply code (e.g. "250"). */
function sendMail(cfg, subject, text) {
  const message = buildMessage({ from: cfg.from, to: cfg.to, subject, text });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccrs-alert-'));
  const configPath = path.join(dir, 'curl.conf');
  try {
    const { args, config } = curlInvocation(cfg, cfg.to, configPath);
    if (config) fs.writeFileSync(configPath, config, { mode: 0o600 });
    const r = spawnSync('curl', args, { input: message, encoding: 'utf8', timeout: 120_000 });
    if (r.error) throw r.error;
    const reply = (r.stdout || '').trim();
    if (r.status !== 0) throw new Error(`curl exited ${r.status} (last SMTP reply ${reply || 'none'}): ${(r.stderr || '').trim()}`);
    return reply;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

export function readConfig(env = process.env) {
  const to = String(env.ALERT_TO || '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
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

function writeState(p, state) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, p);
}

const log = (...m) => console.log('[regression-alert]', ...m);

/** Pause after the nth failed send in a row: 5, 10, 20, 40 minutes, then hourly. */
export function retryDelayMs(failures) {
  return Math.min(5 * 2 ** Math.max(0, failures - 1), 60) * 60_000;
}

/** One poll. Returns the process exit code. */
export function tick({ cfg, opts, now = Date.now(), send = sendMail }) {
  const catalogPath = opts.catalog || path.join(cfg.webroot, 'catalog.json');
  const statePath = opts.state || cfg.stateFile;
  if (!opts.dryRun && (!cfg.smtpUrl || !cfg.from || !cfg.to.length)) {
    log('ALERT_SMTP_URL, ALERT_FROM and ALERT_TO are required (see /etc/ccrs-test-alerts.env)');
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

  let state = {};
  try { state = readJson(statePath); } catch { /* first tick on this box */ }
  const lastRunId = opts.since || state.lastRunId;
  if (!lastRunId) {
    log(`no state yet — baseline is ${latest.id}; alerting starts with the next run`);
    if (!opts.dryRun) writeState(statePath, { lastRunId: latest.id, baselinedAt: new Date(now).toISOString() });
    return 0;
  }

  const mails = [];
  if (latest.id !== lastRunId && !catalog.runs.some(r => r.id === lastRunId)) {
    log(`last handled run ${lastRunId} has left the catalog window; comparing only the newest run`);
  }
  for (const { run, prev } of runsToProcess(catalog, lastRunId)) {
    const a = analyzeRun(catalog, run, prev);
    log(`${run.id} vs ${prev?.id ?? '(none)'}: ${a.regressed.length} regressed, ${a.nowSkipped.length} now skipped, ${a.stopped.length} stopped running, ${a.fixed.length} fixed`);
    if (needsAlert(a)) mails.push(composeMail(a, cfg));
  }
  let staleFor = state.staleAlertedFor;
  if (cfg.staleAfterHours > 0 && latest.id === lastRunId && staleFor !== latest.id) {
    const age = (now - Date.parse(latest.startedAt)) / 3_600_000;
    if (Number.isFinite(age) && age > cfg.staleAfterHours) {
      mails.push(composeStaleMail(latest, cfg.staleAfterHours, cfg));
      staleFor = latest.id;
    }
  }

  // The 30 s slack: the timer fires a few hundred ms before retryAfter (which was
  // stamped after node started), and holding off then would add a whole poll.
  if (!opts.dryRun && mails.length && state.retryAfter && now + 30_000 < Date.parse(state.retryAfter)) {
    log(`holding off until ${state.retryAfter}: the last ${plural(state.sendFailures || 1, 'send')} failed`);
    return 1;
  }
  for (const m of mails) {
    if (opts.dryRun) {
      console.log(`\n===== DRY RUN — would mail ${cfg.to.join(', ') || '(no ALERT_TO)'} =====\nSubject: ${m.subject}\n\n${m.text}`);
      continue;
    }
    try {
      const reply = send(cfg, m.subject, m.text);
      log(`mailed ${cfg.to.length} recipient(s)${typeof reply === 'string' && reply ? ` (SMTP ${reply})` : ''}: ${m.subject}`);
    } catch (e) {
      // Don't advance lastRunId: a later tick retries the whole batch, after a pause.
      const sendFailures = (state.sendFailures || 0) + 1;
      const retryAfter = new Date(now + retryDelayMs(sendFailures)).toISOString();
      writeState(statePath, { ...state, lastRunId, sendFailures, retryAfter });
      log(`send failed (${sendFailures} in a row), retrying after ${retryAfter}: ${e.message}`);
      return 1;
    }
  }
  if (!opts.dryRun) writeState(statePath, { lastRunId: latest.id, staleAlertedFor: staleFor, updatedAt: new Date(now).toISOString() });
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  process.exitCode = tick({ cfg: readConfig(), opts });
}
