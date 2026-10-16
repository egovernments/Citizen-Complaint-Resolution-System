import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, index, markdown, verdict } from './ci-compare.mjs';

// A Playwright JSON report: one file suite, a describe, and specs with one test each.
const res = (...statuses) => statuses.map(status => ({ status, duration: 1, error: status === 'failed' ? { message: `\x1b[31mError: ${status}\x1b[0m\n  at x` } : undefined }));
function report(tests, errors = []) {
  return {
    config: { rootDir: '/repo/tests' },
    errors,
    suites: [{
      title: 'citizen/a.spec.ts', file: 'citizen/a.spec.ts',
      suites: [{
        title: 'Complaint', file: 'citizen/a.spec.ts',
        specs: Object.entries(tests).map(([title, [status, results]], i) => ({
          title, file: 'citizen/a.spec.ts', line: 10 + i,
          tests: [{ projectName: 'chromium', status, results }],
        })),
      }],
    }],
  };
}
const PASS = ['expected', res('passed')];
const FAIL = ['unexpected', res('failed', 'failed')];
const FLAKY = ['flaky', res('failed', 'passed')];
const SKIP = ['skipped', res('skipped')];
const NOTRUN = ['skipped', []];

test('verdicts', () => {
  assert.equal(verdict({ status: 'expected', results: res('passed') }), 'pass');
  assert.equal(verdict({ status: 'flaky', results: res('failed', 'passed') }), 'flaky');
  assert.equal(verdict({ status: 'unexpected', results: res('failed', 'timedOut') }), 'fail');
  assert.equal(verdict({ status: 'skipped', results: res('skipped') }), 'skip');
  assert.equal(verdict({ status: 'skipped', results: [] }), 'notrun');
  assert.equal(verdict({ status: 'unexpected', results: res('interrupted') }), 'notrun');
});

test('only a test that passed on develop and fails now fails the check', () => {
  const base = report({ a: PASS, b: FAIL, c: PASS, d: FAIL, e: PASS, f: FLAKY });
  const cur = report({ a: FAIL, b: FAIL, c: SKIP, d: PASS, e: FLAKY, f: FAIL, g: FAIL });
  const r = compare(cur, base);
  const titles = g => r.groups[g].map(t => t.title.split(' › ').pop().replace(' [chromium]', ''));
  assert.deepEqual(titles('regressed'), ['a', 'f']);
  assert.deepEqual(titles('stillFailing'), ['b']);
  assert.deepEqual(titles('nowSkipped'), ['c']);
  assert.deepEqual(titles('fixed'), ['d']);
  assert.deepEqual(titles('flaky'), ['e']);
  assert.deepEqual(titles('newFailing'), ['g']);
  assert.equal(r.failed, true);
  assert.deepEqual(r.counts, { pass: 1, flaky: 1, fail: 4, skip: 1, notrun: 0 });
});

test('failures that also fail on develop keep the check green', () => {
  const r = compare(report({ a: FAIL, b: PASS }), report({ a: FAIL, b: PASS }));
  assert.equal(r.failed, false);
  assert.equal(r.groups.stillFailing.length, 1);
});

test('without a baseline nothing fails the check', () => {
  const r = compare(report({ a: FAIL, b: FAIL }), null);
  assert.equal(r.failed, false);
  assert.equal(r.hasBaseline, false);
  assert.match(markdown(r), /no develop baseline yet/);
});

test('a test develop passed that is gone from this run is listed, not failed', () => {
  const r = compare(report({ a: PASS }), report({ a: PASS, gone: PASS }));
  assert.equal(r.failed, false);
  assert.deepEqual(r.groups.nowSkipped.map(t => t.verdict), ['missing']);
});

test('lines moving does not change which test it is', () => {
  const base = report({ a: PASS });
  const cur = report({ x: PASS, a: FAIL }); // `a` is now on line 11
  assert.equal(compare(cur, base).groups.regressed.length, 1);
});

test('a run cut short by the global timeout fails only if develop finished', () => {
  const timeout = [{ message: 'Timed out waiting 4800s for the test suite to run' }];
  assert.equal(compare(report({ a: PASS, b: NOTRUN }, timeout), report({ a: PASS, b: PASS })).failed, true);
  assert.equal(compare(report({ a: PASS, b: NOTRUN }, timeout), report({ a: PASS, b: NOTRUN }, timeout)).failed, false);
});

test('keys carry the project, and errors are one clean line', () => {
  const idx = index(report({ a: FAIL }));
  const [key] = idx.keys();
  assert.equal(key, 'chromium | citizen/a.spec.ts | Complaint › a');
  assert.equal(idx.get(key).error, 'Error: failed');
  assert.match(markdown(compare(report({ a: FAIL }), report({ a: PASS }))), /Regressed.*\(1\)[\s\S]*Error: failed/);
});
