/**
 * Stable per-test code generator.
 *
 * Two parallel runs hitting the same shared tenant must not collide on
 * created MDMS rows, and within a single test we want the same `kind` to
 * return the same code on repeated calls (so beforeAll-created records
 * match what afterAll cleans up).
 *
 * The hash mixes test title + worker index + the test's start time so the
 * code is unique per test invocation but stable across calls within it.
 */
import { createHash } from 'node:crypto';
import type { TestInfo } from '@playwright/test';

const cache = new WeakMap<TestInfo, string>();

function hash8(seed: string): string {
  return createHash('sha1').update(seed).digest('hex').slice(0, 8).toUpperCase();
}

function getOrCreateRunHash(test: TestInfo): string {
  let h = cache.get(test);
  if (h) return h;
  // testId is deterministic per spec position; combine with workerIndex so
  // sharded runs don't collide.
  const seed = [
    test.testId,
    test.workerIndex,
    test.project.name,
    process.env.PW_RUN_SALT || '',
    Date.now(),
  ].join('|');
  h = hash8(seed);
  cache.set(test, h);
  return h;
}

/**
 * Produce a `PW_${hash8}_${kind}` code for this test. Stable within the
 * test (same `kind` → same code) so create / verify / teardown line up.
 */
export function testCode(test: TestInfo, kind: string): string {
  const safeKind = kind.replace(/[^A-Z0-9]+/gi, '').toUpperCase() || 'X';
  return `PW_${getOrCreateRunHash(test)}_${safeKind}`;
}

/** Convenience: e.g. `PW_${hash}_DEPT_001`, `_002`, ... */
export function testCodeIndexed(test: TestInfo, kind: string, index: number): string {
  const padded = String(index).padStart(3, '0');
  return testCode(test, `${kind}_${padded}`);
}
