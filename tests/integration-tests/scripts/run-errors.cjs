/**
 * run-errors.cjs — what a Playwright JSON report's run-level errors say about
 * the run. One copy for scripts/build-catalog.ts (the dashboard) and
 * scripts/ci-compare.mjs (the PR check), so the two cannot disagree about
 * which runs were cut short.
 *
 * CommonJS so both can load it on any Node: build-catalog.ts runs under tsx as
 * CommonJS on the test boxes, and ci-compare.mjs imports it as ESM.
 * No npm dependencies. Types: run-errors.d.cts.
 */

/**
 * Playwright's run-level messages when the run stopped before every test got
 * a turn: the global timeout or --max-failures. Matched on those two only, so
 * an unrelated run-level error (a fixture, a teardown) isn't read as cut
 * short. The global timeout names whichever task was running when it fired
 * (taskRunner.js: `for the ${currentTaskName} to run`): "test suite", "global
 * setup", "start dev server", "teardown for test suite"…
 */
const CUT_SHORT = [
  /^Timed out waiting [\d.]+s for the .+ to run/,
  /^Testing stopped early after \d+ maximum allowed failures/,
];

/** First line of each run-level error, colour codes stripped. */
function runErrors(report) {
  return (report.errors || [])
    .map(e => String(e.message || '').replace(/\x1b\[[0-9;]*m/g, '').split('\n')[0].trim());
}

/** The message that cut the run short, else null. */
function cutShortOf(report) {
  return runErrors(report).find(m => CUT_SHORT.some(re => re.test(m))) ?? null;
}

module.exports = { CUT_SHORT, runErrors, cutShortOf };
