/// <reference types="node" />
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { postalCode, postalCodeKE } from './validation';

/**
 * Unit coverage for the postal-code rule resolution (PR #1315 / CCRS#722).
 *
 * The same resolution order is implemented twice — here (validation.ts,
 * exercised directly) and in digit-ui's utils/postalCode.js (no unit-test
 * infra in that package; covered end-to-end by
 * tests/integration-tests/tests/citizen/postal-code-alnum-input.spec.ts).
 * These tests pin the semantics both implementations promise:
 *
 *   1. window.__DIGIT_FORM_VALIDATIONS.postalCode — the MDMS channel,
 *      named after common-masters.FormValidations and keyed by fieldType.
 *   2. globalConfigs CORE_POSTAL_CONFIGS.postalCodePattern, with the
 *      legacy CORE_POSTAL_CODE_CONFIGS key reachable by selecting on the
 *      FIELD (the ansible template always renders the primary key as at
 *      least {}, so object-truthiness fallbacks never fire — a regression
 *      KDwevedi caught on the PR).
 *   3. The 5-digit default.
 *
 * The error message is always derived from the resolved pattern: the digit
 * count for a plain ^[0-9]{N}$ shape, a generic message otherwise (never a
 * digit count scraped from an unrelated {N} quantifier in an alnum pattern).
 */

type AnyWindow = Window & {
  __DIGIT_FORM_VALIDATIONS?: Record<string, { pattern: string } | undefined>;
  globalConfigs?: { getConfig?: (key: string) => Record<string, unknown> | undefined };
};

const win = window as unknown as AnyWindow;

function setGlobalConfigs(byKey: Record<string, Record<string, unknown> | undefined>) {
  win.globalConfigs = { getConfig: (key: string) => byKey[key] };
}

afterEach(() => {
  delete win.__DIGIT_FORM_VALIDATIONS;
  delete win.globalConfigs;
});

describe('v.postalCode — resolution order', () => {
  it('falls back to the 5-digit default when nothing is configured', () => {
    expect(postalCode('12345')).toBeUndefined();
    expect(postalCode('1234')).toBe('Enter a valid 5-digit postal code');
  });

  it('honours globalConfigs CORE_POSTAL_CONFIGS and derives the digit count', () => {
    setGlobalConfigs({ CORE_POSTAL_CONFIGS: { postalCodePattern: '^[0-9]{4}$' } });
    expect(postalCode('0101')).toBeUndefined();
    expect(postalCode('00100')).toBe('Enter a valid 4-digit postal code');
  });

  it('reaches the legacy CORE_POSTAL_CODE_CONFIGS key behind an ansible-rendered empty primary', () => {
    // globalConfigs.js.j2 always renders CORE_POSTAL_CONFIGS as at least {} —
    // selection must be on the postalCodePattern field, not object truthiness.
    setGlobalConfigs({
      CORE_POSTAL_CONFIGS: {},
      CORE_POSTAL_CODE_CONFIGS: { postalCodePattern: '^[0-9]{6}$' },
    });
    expect(postalCode('110001')).toBeUndefined();
    expect(postalCode('00100')).toBe('Enter a valid 6-digit postal code');
  });

  it('lets an MDMS FormValidations postalCode row outrank globalConfigs', () => {
    setGlobalConfigs({ CORE_POSTAL_CONFIGS: { postalCodePattern: '^[0-9]{5}$' } });
    win.__DIGIT_FORM_VALIDATIONS = { postalCode: { pattern: '^[0-9]{4}$' } };
    expect(postalCode('0101')).toBeUndefined();
    expect(postalCode('00100')).toBe('Enter a valid 4-digit postal code');
  });

  it('re-resolves per call, so a mirrored MDMS row upgrades validation mid-session', () => {
    setGlobalConfigs({ CORE_POSTAL_CONFIGS: { postalCodePattern: '^[0-9]{5}$' } });
    expect(postalCode('0101')).toBe('Enter a valid 5-digit postal code');
    // usePostalRule lands the tenant's MDMS row after its async fetch:
    win.__DIGIT_FORM_VALIDATIONS = { postalCode: { pattern: '^[0-9]{4}$' } };
    expect(postalCode('0101')).toBeUndefined();
  });
});

describe('v.postalCode — message derivation', () => {
  it('uses the generic message for an alnum pattern instead of misreporting a digit count', () => {
    // The UK pattern ends in a {2} character-class repeat; a bare {N} scrape
    // would misreport "2-digit". The derivation must be anchored to the
    // whole ^[0-9]{N}$ shape.
    setGlobalConfigs({
      CORE_POSTAL_CONFIGS: { postalCodePattern: '^[A-Z]{1,2}[0-9R][0-9A-Z]? ?[0-9][A-Z]{2}$' },
    });
    expect(postalCode('SW1A 1AA')).toBeUndefined();
    expect(postalCode('nope')).toBe('Enter a valid postal code');
  });

  it('accepts dash-suffixed shapes and keeps the generic message for them', () => {
    setGlobalConfigs({ CORE_POSTAL_CONFIGS: { postalCodePattern: '^[0-9]{5}(-[0-9]{4})?$' } });
    expect(postalCode('12345')).toBeUndefined();
    expect(postalCode('12345-6789')).toBeUndefined();
    expect(postalCode('12345-67')).toBe('Enter a valid postal code');
  });
});

describe('v.postalCode — resilience', () => {
  it('treats the field as optional: empty values never error', () => {
    expect(postalCode('')).toBeUndefined();
    expect(postalCode(null)).toBeUndefined();
    expect(postalCode(undefined)).toBeUndefined();
  });

  it('falls back to the default rule instead of throwing on a malformed configured pattern', () => {
    // An unterminated character class is a genuine RegExp SyntaxError (an
    // unclosed {N} quantifier would NOT be — JS treats that as a literal).
    setGlobalConfigs({ CORE_POSTAL_CONFIGS: { postalCodePattern: '^[0-9{5}$' } });
    expect(postalCode('12345')).toBeUndefined();
    expect(postalCode('1234')).toBe('Enter a valid 5-digit postal code');
  });

  it('keeps the postalCodeKE backward-compat alias pointing at the same validator', () => {
    expect(postalCodeKE).toBe(postalCode);
  });
});

describe('DDH seed contract — common-masters.FormValidations', () => {
  // MDMS is the primary per-tenant knob, so the seeded default must stay in
  // lock-step with the code-level fallback: a seed that drifts to a different
  // shape would silently change every newly-created tenant's postal rule.
  // Read via node:fs — the seed lives outside this package, beyond vite's
  // import sandbox, and vitest runs in node anyway. Vitest's cwd is the
  // configurator package root.
  const seedPath = resolve(
    process.cwd(),
    '../utilities/default-data-handler/src/main/resources/mdmsData/common-masters/common-masters.FormValidations.json',
  );
  const rows = JSON.parse(readFileSync(seedPath, 'utf8')) as { fieldType: string; regex: string }[];

  it('seeds a postalCode row whose regex compiles and matches the built-in 5-digit default', () => {
    const row = rows.find((r) => r.fieldType === 'postalCode');
    expect(row).toBeDefined();
    expect(() => new RegExp(row!.regex)).not.toThrow();
    expect(row!.regex).toBe('^[0-9]{5}$');
  });

  it('keeps one row per fieldType (the schema x-unique constraint)', () => {
    const types = rows.map((r) => r.fieldType);
    expect(new Set(types).size).toBe(types.length);
  });

  it('full-dump.sql seeds the same FormValidations rows as the DDH seed (no drift)', () => {
    // The dump baseline (local-setup/db/full-dump.sql) hand-carries the same
    // rows so dump-booted stacks get them without DDH tenant-setup. Two copies
    // of one dataset = a drift vector; pin them to each other. COPY text
    // format doubles backslashes, so unescape before comparing.
    const dump = readFileSync(resolve(process.cwd(), '../local-setup/db/full-dump.sql'), 'utf8');
    const dumpRows = dump
      .split('\n')
      .map((l) => l.split('\t'))
      // eg_mdms_data columns: id, tenantid, uniqueidentifier, schemacode, data, …
      // (matching on the schemacode POSITION also excludes the schema-definition
      // row in eg_mdms_schema_definition, whose code sits at index 2).
      .filter((cols) => cols[3] === 'common-masters.FormValidations')
      .map((cols) => ({
        uniqueidentifier: cols[2],
        data: JSON.parse(cols[4].replace(/\\\\/g, '\\')) as { fieldType: string; regex: string },
      }));
    expect(dumpRows.length).toBe(rows.length);
    for (const seedRow of rows) {
      const dumpRow = dumpRows.find((d) => d.data.fieldType === seedRow.fieldType);
      expect(dumpRow, `full-dump.sql must carry a ${seedRow.fieldType} row`).toBeDefined();
      expect(dumpRow!.data.regex).toBe(seedRow.regex);
      expect(dumpRow!.uniqueidentifier).toBe(seedRow.fieldType);
    }
  });
});
