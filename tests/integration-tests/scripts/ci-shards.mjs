#!/usr/bin/env node
/**
 * ci-shards.mjs — split the suite over the "Integration tests" shards by time.
 *
 * Playwright's --shard cuts the suite into runs of equal test COUNT, in file
 * order. This suite's slow specs sit next to each other (citizen UI flows that
 * time out on develop, twice with the retry), so on 2026-10-15 --shard=k/4 gave
 * shards of 14, 32, 45+ (cut off by the global timeout) and 9 minutes.
 *
 * This packs whole spec files into N lists of about equal TIME instead, the
 * longest file first into the emptiest list. A test's time is what it cost on
 * an earlier run (its report.json, every attempt added up): the develop run
 * Verdict compares with or, before develop has one, the newest run on any
 * branch. A test that run has no time for counts as its median: a new test,
 * one that did not run, and one it skipped (0 ms there, and the change may
 * make it run; at 0 ms every such file would land in the same list). With no
 * earlier run every test counts the same. Files are never split: a serial
 * describe or a beforeAll belongs to one run.
 *
 * Setup files (*.setup.ts) are left out: Playwright runs a project's setup
 * dependencies in every shard anyway.
 *
 * Each list is a Playwright --test-list file: one spec path per line, relative
 * to testDir, in the suite's own order.
 *
 * Usage:
 *   npx playwright test --config playwright.ci.config.ts --list --reporter=json > list.json
 *   node scripts/ci-shards.mjs --list list.json --shards 4 [--baseline report.json]
 *        [--baseline-label "develop @ abc1234"] [--github]
 * Prints {"1": [files], ...}. --github also writes $GITHUB_OUTPUT (matrix =
 * [1..N], lists = that JSON) and a table to $GITHUB_STEP_SUMMARY.
 * No npm dependencies.
 */
import fs from 'node:fs';
import { index } from './ci-compare.mjs';

const SETUP = /\.setup\.[cm]?[jt]s$/;
/** Verdicts whose duration is what the test costs when it runs. */
const RAN = new Set(['pass', 'flaky', 'fail']);

/** [{ shard, files: [path], tests, ms }] for N shards. */
export function split(list, baseline, shards) {
  const base = baseline ? index(baseline) : new Map();
  const timed = [...base.values()].filter(t => RAN.has(t.verdict)).map(t => t.duration).sort((a, b) => a - b);
  const fallback = timed.length ? timed[Math.floor(timed.length / 2)] : 1;

  const files = new Map();
  for (const [key, t] of index(list)) {
    if (SETUP.test(t.file)) continue;
    const b = base.get(key);
    const ms = b && RAN.has(b.verdict) ? b.duration : fallback;
    if (!files.has(t.file)) files.set(t.file, { file: t.file, order: files.size, tests: 0, ms: 0 });
    const f = files.get(t.file);
    f.tests++;
    f.ms += ms;
  }

  const bins = Array.from({ length: shards }, (_, i) => ({ shard: i + 1, picked: [], tests: 0, ms: 0 }));
  for (const f of [...files.values()].sort((a, b) => b.ms - a.ms || a.order - b.order)) {
    const bin = bins.reduce((min, b) => (b.ms < min.ms ? b : min));
    bin.picked.push(f);
    bin.tests += f.tests;
    bin.ms += f.ms;
  }
  return bins.map(({ shard, picked, tests, ms }) => ({
    shard,
    files: picked.sort((a, b) => a.order - b.order).map(f => f.file),
    tests,
    ms,
  }));
}

export function summary(bins, { timed, baselineLabel }) {
  const basis = timed
    ? `Spec files packed by their time on ${baselineLabel || 'an earlier run'}.`
    : 'No earlier run to time the specs by: spec files packed by test count.';
  const rows = bins.map(b => `| ${b.shard} | ${b.files.length} | ${b.tests} | ${timed ? `${(b.ms / 60000).toFixed(1)} min` : '–'} |`);
  return ['### Shards', '', basis, '', '| Shard | Spec files | Tests | Time on that run |', '|---|---|---|---|', ...rows, ''].join('\n') + '\n';
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function main() {
  const shards = Number(arg('--shards'));
  const listPath = arg('--list');
  if (!listPath || !Number.isInteger(shards) || shards < 1) {
    console.error('usage: ci-shards.mjs --list list.json --shards N [--baseline report.json]');
    process.exit(2);
  }
  const list = JSON.parse(fs.readFileSync(listPath, 'utf8'));
  const baselinePath = arg('--baseline');
  const baseline = baselinePath && fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : null;
  const bins = split(list, baseline, shards);
  const lists = Object.fromEntries(bins.map(b => [b.shard, b.files]));
  if (process.argv.includes('--github')) {
    const { GITHUB_OUTPUT, GITHUB_STEP_SUMMARY } = process.env;
    if (!GITHUB_OUTPUT) throw new Error('--github needs GITHUB_OUTPUT');
    fs.appendFileSync(GITHUB_OUTPUT, `matrix=${JSON.stringify(bins.map(b => b.shard))}\nlists=${JSON.stringify(lists)}\n`);
    if (GITHUB_STEP_SUMMARY) fs.appendFileSync(GITHUB_STEP_SUMMARY, summary(bins, { timed: !!baseline, baselineLabel: arg('--baseline-label') }));
  }
  process.stdout.write(JSON.stringify(lists, null, 2) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
