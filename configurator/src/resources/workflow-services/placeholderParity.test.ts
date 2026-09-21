/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PLACEHOLDER_VOCABULARY } from './validateNotifications';

/**
 * PLACEHOLDER PARITY: the tokens the configurator tells operators about must be
 * exactly the tokens pgr-services actually fills.
 *
 * PLACEHOLDER_VOCABULARY is the ONE place the configurator lists them (the
 * Configure form's hint, the unknown-token rule and the operator doc all read
 * it). The producing side is
 * NotificationService.buildPlaceholderValues, which writes into a local map
 * `v` through a tiny `put(v, "<name>", value)` helper — a shape specific to
 * that method, so a regex for it cannot drift onto an unrelated map.
 *
 * Drift in EITHER direction is a bug:
 *   - a token in the vocabulary that Java never fills => we advertise a token
 *     whose braces will ship literally;
 *   - a token Java fills that the vocabulary is missing => the unknown-token
 *     rule warns about a placeholder that actually works, and operators stop
 *     trusting the warnings.
 */

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(resolve(dir, 'backend/pgr-services'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate the repo root from ${process.cwd()}`);
}

const JAVA = resolve(
  repoRoot(),
  'backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java',
);

describe('placeholder vocabulary parity with pgr-services', () => {
  const source = readFileSync(JAVA, 'utf8');

  it('still finds buildPlaceholderValues where the regex expects it', () => {
    // If this fails the method was renamed or restructured — fix the regex
    // below deliberately rather than letting the parity test quietly pass on
    // an empty match set.
    expect(source).toMatch(/private Map<String, String> buildPlaceholderValues\(/);
  });

  it('fills exactly the tokens the configurator advertises', () => {
    const fromJava = new Set<string>();
    // `put(v, "name", …)` is the helper inside buildPlaceholderValues; the
    // blank-out fallback writes `v.put("download_link", "")` directly.
    for (const m of source.matchAll(/\bput\(v,\s*"([a-zA-Z0-9_]+)"/g)) fromJava.add(m[1]);
    for (const m of source.matchAll(/\bv\.put\(\s*"([a-zA-Z0-9_]+)"/g)) fromJava.add(m[1]);

    expect(fromJava.size, 'the regex matched nothing — the Java side must have moved').toBeGreaterThan(5);
    expect([...fromJava].sort()).toEqual([...PLACEHOLDER_VOCABULARY].sort());
  });

  it('lists every token exactly once', () => {
    const seen = [...PLACEHOLDER_VOCABULARY];
    expect(new Set(seen).size).toBe(seen.length);
  });
});
