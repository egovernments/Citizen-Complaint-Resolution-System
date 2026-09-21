/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PLACEHOLDER_VOCABULARY } from '../notification-configure/legacyAdapter';
import { placeholderNames, type EventCatalogueRow } from '../notification-configure/eventCatalogue';

/**
 * PLACEHOLDER PARITY: the tokens the configurator tells operators about must be
 * exactly the tokens the producing module actually fills.
 *
 * The LEFT-HAND side moved. It used to be `PLACEHOLDER_VOCABULARY`, one global
 * TS constant — which could only ever describe one module. It is now the
 * `placeholders` declared by the PGR rows of the shipped
 * NOTIFICATIONS.EventCatalogue seed, so the property reads: *the catalogue rows
 * we ship for PGR declare exactly the tokens `buildPlaceholderValues` fills*.
 * While that seed file does not exist yet the constant stands in for it, and a
 * second test below pins the two together so the swap is a no-op when it lands.
 *
 * The RIGHT-HAND side is unchanged: NotificationService.buildPlaceholderValues,
 * which writes into a local map `v` through a tiny `put(v, "<name>", value)`
 * helper — a shape specific to that method, so a regex for it cannot drift onto
 * an unrelated map. The extraction is now scoped to the METHOD BODY rather than
 * the whole file, so an unrelated `put(v, "x"` elsewhere cannot leak in.
 *
 * Drift in EITHER direction is a bug:
 *   - a token in the vocabulary that Java never fills => we advertise a token
 *     whose braces will ship literally;
 *   - a token Java fills that the vocabulary is missing => the unknown-token
 *     rule warns about a placeholder that actually works, and operators stop
 *     trusting the warnings.
 *
 * ANOTHER MODULE opts in by adding its own parity test against its own
 * producer. The pattern is documented, not enforced: we cannot make a claim
 * about code we do not own.
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

const REPO = repoRoot();
const JAVA = resolve(
  REPO,
  'backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java',
);
const CATALOGUE_SEED = resolve(
  REPO,
  'utilities/default-data-handler/src/main/resources/mdmsData-dev/NOTIFICATIONS/NOTIFICATIONS.EventCatalogue.json',
);

/** The PGR catalogue rows we ship, or null while the seed file does not exist. */
function shippedPgrCatalogue(): EventCatalogueRow[] | null {
  if (!existsSync(CATALOGUE_SEED)) return null;
  const rows = JSON.parse(readFileSync(CATALOGUE_SEED, 'utf8')) as EventCatalogueRow[];
  const pgr = rows.filter((r) => String(r.module ?? '').toUpperCase() === 'COMPLAINTS');
  return pgr.length > 0 ? pgr : null;
}

/**
 * The token vocabulary the Configurator advertises for PGR: the union of the
 * shipped catalogue rows' declared placeholders, or the fallback constant while
 * no catalogue ships.
 */
function configuratorVocabulary(): { tokens: string[]; source: 'catalogue' | 'fallback' } {
  const pgr = shippedPgrCatalogue();
  if (!pgr) return { tokens: [...PLACEHOLDER_VOCABULARY], source: 'fallback' };
  const tokens = new Set<string>();
  for (const row of pgr) for (const name of placeholderNames(row)) tokens.add(name);
  return { tokens: [...tokens], source: 'catalogue' };
}

/** `buildPlaceholderValues`' body, so the extraction cannot match outside it. */
function buildPlaceholderValuesBody(source: string): string {
  const marker = 'private Map<String, String> buildPlaceholderValues(';
  const start = source.indexOf(marker);
  if (start === -1) return '';
  // Brace-match from the method's opening `{` to its closing one.
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return '';
}

describe('placeholder vocabulary parity with the PGR producer', () => {
  const source = readFileSync(JAVA, 'utf8');

  it('still finds buildPlaceholderValues where the regex expects it', () => {
    // If this fails the method was renamed or restructured — fix the extraction
    // below deliberately rather than letting the parity test quietly pass on
    // an empty match set.
    expect(source).toMatch(/private Map<String, String> buildPlaceholderValues\(/);
    expect(buildPlaceholderValuesBody(source).length).toBeGreaterThan(200);
  });

  it('fills exactly the tokens the configurator advertises', () => {
    const body = buildPlaceholderValuesBody(source);
    const fromJava = new Set<string>();
    // `put(v, "name", …)` is the helper inside buildPlaceholderValues; the
    // blank-out fallback writes `v.put("download_link", "")` directly.
    for (const m of body.matchAll(/\bput\(v,\s*"([a-zA-Z0-9_]+)"/g)) fromJava.add(m[1]);
    for (const m of body.matchAll(/\bv\.put\(\s*"([a-zA-Z0-9_]+)"/g)) fromJava.add(m[1]);

    expect(fromJava.size, 'the regex matched nothing — the Java side must have moved').toBeGreaterThan(5);
    const { tokens } = configuratorVocabulary();
    expect([...fromJava].sort()).toEqual([...tokens].sort());
  });

  it('lists every token exactly once', () => {
    const { tokens } = configuratorVocabulary();
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  // TEMPORARY, and deliberately so: it dies with the fallback constant, which is
  // deleted together with the legacy adapter two releases after the copy ships.
  it('keeps the legacy fallback constant equal to the shipped catalogue', () => {
    const pgr = shippedPgrCatalogue();
    if (!pgr) {
      expect(configuratorVocabulary().source).toBe('fallback');
      return;
    }
    const fromCatalogue = new Set<string>();
    for (const row of pgr) for (const name of placeholderNames(row)) fromCatalogue.add(name);
    expect([...fromCatalogue].sort()).toEqual([...PLACEHOLDER_VOCABULARY].sort());
  });
});
