#!/usr/bin/env node
/**
 * ci-compare.mjs — judge a CI run of this suite against the latest develop run.
 *
 * The suite has never been all-green on a fresh stack, so "any failure fails
 * the check" would be red on every PR and teach people to ignore it. The check
 * fails only for what the change made worse:
 *
 *   regressed      fails now; passed (or was flaky) on develop       → FAILS
 *   cut short      the run hit its global timeout and develop's did not → FAILS
 *   still failing  fails now and on develop                          → listed
 *   new failing    fails now; develop has no pass/fail for it (a new or
 *                  renamed test, or one develop skipped)              → listed
 *   now skipped    skipped or not run now; passed on develop          → listed
 *   fixed          passes now; failed on develop                      → listed
 *
 * With no develop run to compare against yet, nothing fails the check: the
 * summary says so and only lists results.
 *
 * Tests are matched by project + file + describe path + title, not line: a PR
 * that edits a spec moves lines, and the test is still the same test.
 * Retries are on in CI, so `flaky` (failed, then passed) counts as a pass.
 *
 * Usage:
 *   node scripts/ci-compare.mjs --current report.json [--baseline base/report.json]
 *        [--baseline-label "develop @ abc1234"] [--summary $GITHUB_STEP_SUMMARY]
 * Exit 0 = nothing got worse (or no baseline), 1 = it did, 2 = bad input.
 * No npm dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Run-level errors that mean the run stopped before every test ran (build-catalog.ts). */
const CUT_SHORT = [
  /^Timed out waiting [\d.]+s for the .+ to run/,
  /^Testing stopped early after \d+ maximum allowed failures/,
];

function stripAnsi(s) {
  return String(s || '').replace(/\x1b\[[0-9;]*m/g, '');
}

export function cutShort(report) {
  return (report.errors || [])
    .map(e => stripAnsi(e.message).split('\n')[0].trim())
    .find(m => CUT_SHORT.some(re => re.test(m))) ?? null;
}

/**
 * pass | flaky | fail | skip | notrun for one Playwright test entry.
 * notrun: no result at all (after a global timeout), or interrupted mid-flight.
 */
export function verdict(test) {
  const results = test.results || [];
  const last = results[results.length - 1];
  if (!last || last.status === 'interrupted') return 'notrun';
  if (test.status === 'flaky') return 'flaky';
  if (test.status === 'unexpected') return 'fail';
  if (test.status === 'skipped' || last.status === 'skipped') return 'skip';
  return 'pass';
}

/** Map of test key → { verdict, error, title } for a Playwright JSON report. */
export function index(report) {
  const rootDir = report.config?.rootDir || '';
  const out = new Map();
  const walk = (suite, describe) => {
    // A file's own suite is titled with its path; every other suite is a describe.
    const here = suite.title && suite.title !== suite.file ? [...describe, suite.title] : describe;
    for (const spec of suite.specs || []) {
      const file = (rootDir && path.isAbsolute(spec.file) ? path.relative(rootDir, spec.file) : spec.file).replace(/\\/g, '/');
      for (const t of spec.tests || []) {
        const title = [...here, spec.title].join(' › ');
        const key = `${t.projectName || ''} | ${file} | ${title}`;
        const results = t.results || [];
        const err = results.map(r => r.error?.message).filter(Boolean).pop();
        out.set(key, {
          verdict: verdict(t),
          title: `${file} › ${title}${t.projectName ? ` [${t.projectName}]` : ''}`,
          error: err ? stripAnsi(err).split('\n').find(l => l.trim())?.trim().slice(0, 200) : '',
        });
      }
    }
    for (const child of suite.suites || []) walk(child, here);
  };
  for (const s of report.suites || []) walk(s, []);
  return out;
}

const PASSED = new Set(['pass', 'flaky']);

export function compare(current, baseline) {
  const cur = index(current);
  const base = baseline ? index(baseline) : null;
  const counts = { pass: 0, flaky: 0, fail: 0, skip: 0, notrun: 0 };
  for (const t of cur.values()) counts[t.verdict]++;
  const groups = { regressed: [], stillFailing: [], newFailing: [], nowSkipped: [], fixed: [], flaky: [] };
  for (const [key, t] of cur) {
    const b = base?.get(key)?.verdict;
    if (t.verdict === 'flaky') groups.flaky.push(t);
    if (t.verdict === 'fail') {
      if (b && PASSED.has(b)) groups.regressed.push(t);
      else if (b === 'fail') groups.stillFailing.push(t);
      else groups.newFailing.push(t);
    } else if (PASSED.has(t.verdict) && b === 'fail') groups.fixed.push(t);
    else if ((t.verdict === 'skip' || t.verdict === 'notrun') && b && PASSED.has(b)) groups.nowSkipped.push(t);
  }
  // Passed on develop and missing from this run entirely (deleted or renamed):
  // listed with "now skipped" so a silently vanished test is visible.
  if (base) for (const [key, b] of base) if (!cur.has(key) && PASSED.has(b.verdict)) groups.nowSkipped.push({ ...b, verdict: 'missing' });
  const curCut = cutShort(current);
  const baseCut = baseline ? cutShort(baseline) : null;
  const reasons = [];
  if (base && groups.regressed.length) reasons.push(`${groups.regressed.length} test(s) passed on develop and fail here`);
  if (base && curCut && !baseCut) reasons.push(`the run was cut short (${curCut}) and develop's was not`);
  return { counts, groups, cutShort: curCut, hasBaseline: !!base, failed: reasons.length > 0, reasons };
}

export function markdown(r, { baselineLabel = 'develop', limit = 50 } = {}) {
  const c = r.counts;
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  const out = [];
  out.push(`### Integration tests: ${!r.hasBaseline ? 'results (no develop baseline yet)' : r.failed ? 'worse than develop' : 'no regressions vs develop'}`, '');
  out.push(`${total} tests: ${c.pass} passed, ${c.flaky} flaky, ${c.fail} failed, ${c.skip} skipped, ${c.notrun} not run.`);
  if (r.cutShort) out.push('', `Run cut short: ${r.cutShort}`);
  if (r.hasBaseline) out.push('', `Compared with ${baselineLabel}.`);
  else out.push('', 'No develop run to compare with yet, so failures are listed but do not fail this check.');
  if (r.reasons.length) out.push('', ...r.reasons.map(x => `- **${x}**`));
  const section = (title, items, withError) => {
    if (!items.length) return;
    out.push('', `<details${title.startsWith('Regressed') ? ' open' : ''}><summary>${title} (${items.length})</summary>`, '');
    for (const t of items.slice(0, limit)) out.push(`- \`${t.title}\`${withError && t.error ? ` — ${t.error.replace(/`/g, "'")}` : ''}`);
    if (items.length > limit) out.push(`- …and ${items.length - limit} more (see report.json)`);
    out.push('', '</details>');
  };
  const g = r.groups;
  if (r.hasBaseline) {
    section('Regressed: passed on develop, fail here', g.regressed, true);
    section('New failing: no develop result to compare', g.newFailing, true);
    section('Now skipped or missing: passed on develop', g.nowSkipped, false);
    section('Fixed: failed on develop, pass here', g.fixed, false);
    section('Still failing (also fail on develop)', g.stillFailing, true);
  } else {
    section('Failing', [...g.newFailing, ...g.stillFailing, ...g.regressed], true);
  }
  section('Flaky: failed, then passed on retry', g.flaky, false);
  return out.join('\n') + '\n';
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function main() {
  const currentPath = arg('--current');
  const baselinePath = arg('--baseline');
  if (!currentPath) { console.error('usage: ci-compare.mjs --current report.json [--baseline base.json]'); process.exit(2); }
  let current, baseline = null;
  try { current = JSON.parse(fs.readFileSync(currentPath, 'utf8')); }
  catch (e) { console.error(`[ci-compare] cannot read ${currentPath}: ${e.message}`); process.exit(2); }
  if (baselinePath && fs.existsSync(baselinePath)) {
    try { baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')); }
    catch (e) { console.error(`[ci-compare] baseline ${baselinePath} unreadable (${e.message}); judging without it`); }
  }
  const r = compare(current, baseline);
  const md = markdown(r, { baselineLabel: arg('--baseline-label') || 'develop' });
  const summaryPath = arg('--summary');
  if (summaryPath) fs.appendFileSync(summaryPath, md);
  process.stdout.write(md);
  process.exit(r.failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
