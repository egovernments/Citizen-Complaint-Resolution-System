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
 * BOTH SIDES MOVED, and the property survived both moves.
 *
 * The LEFT-HAND side used to be `PLACEHOLDER_VOCABULARY`, one global TS constant
 * that could only ever describe one module. It is now the `placeholders`
 * declared by the PGR rows of the shipped NOTIFICATIONS.EventCatalogue seed —
 * the per-event vocabulary an operator actually sees in the screens. The
 * constant is now only the FALLBACK for a tenant whose catalogue has not been
 * seeded yet, and a test below pins it to the catalogue so the two cannot drift
 * apart before it is deleted.
 *
 * The RIGHT-HAND side used to be `NotificationService.buildPlaceholderValues`,
 * which rendered messages inside pgr-services. The thin-event cutover deleted
 * it: pgr-services renders nothing any more, it emits ONE thin event per
 * workflow transition and the placeholder values travel on that event in two
 * maps built by `ThinEventBuilder`:
 *
 *   - `data`      — the LITERALS the producer already holds;
 *   - `localized` — the localization CODES only the producer can construct,
 *                   which novu-bridge resolves once per event.
 *
 * A token is fillable iff the producer sends it in ONE of those two maps, so the
 * producer-side set is their UNION. Four tokens (`ulb`, `ao_designation`,
 * `emp_department`, `emp_designation`) live only in `localized` and two
 * (`complaint_type`, `status`) live in both, which is why a union — not either
 * map alone — is the honest right-hand side.
 *
 * HOW THE KEYS ARE EXTRACTED, and why it cannot drift onto an unrelated map:
 * the extraction brace-matches the body of the specific method that builds each
 * map, then matches only writes through THAT method's local map variable
 * (`put(data, "…"` / `data.put("…"`). `ThinEventBuilder` builds four maps this
 * way — `actors`, `data`, `localized`, `payload` — and `payload` in particular
 * has a key named `status` too; scoping by method body AND by variable name is
 * what keeps `payload`'s and `actors`' keys out of the vocabulary.
 *
 * Drift in EITHER direction is a bug:
 *   - a token in the vocabulary the producer never sends => we advertise a token
 *     whose braces will ship literally;
 *   - a token the producer sends that the vocabulary is missing => the
 *     unknown-token rule warns about a placeholder that actually works, and
 *     operators stop trusting the warnings.
 *
 * ANOTHER MODULE opts in by adding its own parity test against its own producer.
 * The pattern is documented, not enforced: we cannot make a claim about code we
 * do not own.
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
  'backend/pgr-services/src/main/java/org/egov/pgr/service/notification/ThinEventBuilder.java',
);
const CATALOGUE_SEED = resolve(
  REPO,
  'utilities/default-data-handler/src/main/resources/mdmsData-dev/NOTIFICATIONS/NOTIFICATIONS.EventCatalogue.json',
);

/**
 * The two map-building methods, by the signature the extraction anchors on and
 * the local variable each one writes through.
 */
const PRODUCER_MAPS = [
  { what: 'data', marker: 'private Map<String, Object> data(', variable: 'data' },
  { what: 'localized', marker: 'private Map<String, Object> localized(', variable: 'localized' },
] as const;

/** Tokens no PGR message has ever gone without; the non-vacuity canaries. */
const WELL_KNOWN = ['id', 'complaint_type', 'status', 'emp_name', 'download_link'];

/** A method's body, brace-matched from its signature, so nothing outside it matches. */
function methodBody(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start === -1) return '';
  const open = source.indexOf('{', start);
  if (open === -1) return '';
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

/**
 * Keys written into `variable` inside `body`, through either shape the builder
 * uses: the null-skipping helper `put(<var>, "name", value)` and the direct
 * `<var>.put("name", value)` (which is how a deliberately-blank or list-valued
 * entry is written).
 */
function mapKeys(body: string, variable: string): Set<string> {
  const keys = new Set<string>();
  const re = new RegExp(
    `\\b(?:put\\(\\s*${variable}\\s*,\\s*|${variable}\\.put\\(\\s*)"([A-Za-z0-9_]+)"`,
    'g',
  );
  for (const m of body.matchAll(re)) keys.add(m[1]);
  return keys;
}

/** Every token the producer can put on an event: `data` keys ∪ `localized` keys. */
function producerTokens(source: string): Set<string> {
  const union = new Set<string>();
  for (const { marker, variable } of PRODUCER_MAPS) {
    for (const key of mapKeys(methodBody(source, marker), variable)) union.add(key);
  }
  return union;
}

/** The PGR rows of the catalogue seed we ship. */
function shippedPgrCatalogue(): EventCatalogueRow[] {
  const rows = JSON.parse(readFileSync(CATALOGUE_SEED, 'utf8')) as EventCatalogueRow[];
  return rows.filter((r) => String(r.module ?? '').toUpperCase() === 'COMPLAINTS');
}

const sorted = (values: Iterable<string>) => [...values].sort();

describe('placeholder vocabulary parity with the PGR producer', () => {
  const source = readFileSync(JAVA, 'utf8');

  it('still finds the producer maps where the extraction expects them', () => {
    // The non-vacuity guard. If this fails, `ThinEventBuilder` moved, a method
    // was renamed, or the maps are no longer built by writing string-literal
    // keys — fix the extraction above DELIBERATELY rather than letting the
    // parity assertions below quietly pass on an empty set.
    for (const { what, marker, variable } of PRODUCER_MAPS) {
      const body = methodBody(source, marker);
      expect(body.length, `${what}(): '${marker}' no longer appears in ThinEventBuilder.java`)
        .toBeGreaterThan(200);
      expect(mapKeys(body, variable).size, `${what}(): the key extraction matched nothing`)
        .toBeGreaterThan(4);
    }

    const tokens = producerTokens(source);
    expect(tokens.size, 'the producer union collapsed — the extraction must have gone stale')
      .toBeGreaterThanOrEqual(13);
    for (const token of WELL_KNOWN) {
      expect(tokens, `the producer no longer appears to send {${token}}`).toContain(token);
    }
  });

  it('sends exactly the tokens the shipped catalogue advertises for PGR', () => {
    const fromJava = producerTokens(source);
    const rows = shippedPgrCatalogue();
    expect(rows.length, 'the shipped catalogue seed declares no PGR events').toBeGreaterThan(0);

    // Per event: an event may never advertise a token the producer cannot fill.
    // (Today every PGR row declares the same 13, because every transition
    // carries the same thin event; the assertion is written per row anyway so
    // that a future event with a narrower vocabulary stays legal.)
    for (const row of rows) {
      const declared = placeholderNames(row);
      expect(declared.length, `${row.eventName} declares no placeholders`).toBeGreaterThan(0);
      const unfillable = declared.filter((name) => !fromJava.has(name));
      expect(unfillable, `${row.eventName} advertises tokens the producer never sends`).toEqual([]);
    }

    // Across the catalogue: every token the producer sends must be advertised by
    // at least one event, or it is a working placeholder the screens warn about.
    const fromCatalogue = new Set<string>();
    for (const row of rows) for (const name of placeholderNames(row)) fromCatalogue.add(name);
    expect(sorted(fromCatalogue)).toEqual(sorted(fromJava));
  });

  it('splits those tokens between literals and localization codes as documented', () => {
    // The union is the contract, but the SPLIT is the design, and getting it
    // backwards is silent: a token moved out of `localized` into `data` alone
    // would keep the union intact while changing what survives a localization
    // outage. These four exist only as codes; these two exist as both.
    const dataKeys = mapKeys(methodBody(source, PRODUCER_MAPS[0].marker), 'data');
    const localizedKeys = mapKeys(methodBody(source, PRODUCER_MAPS[1].marker), 'localized');

    for (const token of ['ulb', 'ao_designation', 'emp_department', 'emp_designation']) {
      expect(localizedKeys, `{${token}} must be sent as a localization code`).toContain(token);
      expect(dataKeys, `{${token}} has no literal to fall back on`).not.toContain(token);
    }
    for (const token of ['complaint_type', 'status']) {
      expect(dataKeys, `{${token}} must keep its raw literal`).toContain(token);
      expect(localizedKeys, `{${token}} must also carry a localization code`).toContain(token);
    }
  });

  it('lists every token exactly once', () => {
    for (const row of shippedPgrCatalogue()) {
      const declared = placeholderNames(row);
      const raw = (row.placeholders ?? []).map((p) => String(p?.name ?? '').trim()).filter(Boolean);
      expect(raw.length, `${row.eventName} declares a placeholder twice`).toBe(declared.length);
    }
  });

  // TEMPORARY, and deliberately so: it dies with the fallback constant, which is
  // deleted together with the legacy adapter two releases after the copy ships.
  // Until then an un-migrated tenant sees the constant, so it must say the same
  // thing the catalogue does.
  it('keeps the legacy fallback constant equal to the shipped catalogue', () => {
    const fromCatalogue = new Set<string>();
    for (const row of shippedPgrCatalogue()) {
      for (const name of placeholderNames(row)) fromCatalogue.add(name);
    }
    expect(sorted(fromCatalogue)).toEqual(sorted(PLACEHOLDER_VOCABULARY));
  });
});
