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

  // The dump baseline (local-setup/db/full-dump.sql) hand-carries the same
  // rows so dump-booted stacks get them without DDH tenant-setup. Two copies
  // of one dataset = a drift vector; pin them to each other. COPY text
  // format doubles backslashes, so unescape before parsing.
  // eg_mdms_data columns: id, tenantid, uniqueidentifier, schemacode, data,
  // isactive, … (matching on the schemacode POSITION also excludes the
  // schema-definition row in eg_mdms_schema_definition, whose code sits at
  // index 2). Only active rows count: a dump-booted stack serves no others.
  // Parsed on first use inside the dump tests, so a missing dump or an
  // unparseable row fails only those tests, not the DDH-seed ones above.
  let dumpLines: string[][] | undefined;
  const dumpMdms = (schema: string) => {
    dumpLines ??= readFileSync(resolve(process.cwd(), '../local-setup/db/full-dump.sql'), 'utf8')
      .split('\n')
      .map((l) => l.split('\t'));
    const byTenant = new Map<string, { uniqueidentifier: string; data: Record<string, unknown> }[]>();
    for (const cols of dumpLines.filter((c) => c[3] === schema && c[5] === 't')) {
      const row = { uniqueidentifier: cols[2], data: JSON.parse(cols[4].replace(/\\\\/g, '\\')) };
      byTenant.set(cols[1], [...(byTenant.get(cols[1]) ?? []), row]);
    }
    return byTenant;
  };

  it('full-dump.sql seeds each state tenant the same FormValidations rows as the DDH seed (no drift)', () => {
    const tenants = dumpMdms('common-masters.FormValidations');
    expect(tenants.size).toBeGreaterThan(0);
    for (const [tenantId, dumpRows] of tenants) {
      expect(dumpRows.length, `${tenantId}: FormValidations row count`).toBe(rows.length);
      for (const seedRow of rows) {
        const dumpRow = dumpRows.find((d) => d.data.fieldType === seedRow.fieldType);
        expect(dumpRow, `${tenantId} must carry a ${seedRow.fieldType} row`).toBeDefined();
        expect(dumpRow!.uniqueidentifier).toBe(seedRow.fieldType);
        // postalCode is the one deliberate difference: the dump's pg tenants ship
        // 6-digit pincodes, so its row is 6-digit (ba0eb9ec8). It is pinned to
        // those pincodes in the next test instead of to the generic 5-digit seed.
        if (seedRow.fieldType !== 'postalCode') expect(dumpRow!.data.regex).toBe(seedRow.regex);
      }
    }
  });

  it("full-dump.sql's postalCode rule accepts its own tenants' pincodes and rejects one digit fewer or more", () => {
    const pincodesByTenant = dumpMdms('tenant.tenants');
    for (const [tenantId, dumpRows] of dumpMdms('common-masters.FormValidations')) {
      const row = dumpRows.find((d) => d.data.fieldType === 'postalCode');
      expect(row, `${tenantId} must carry a postalCode row`).toBeDefined();
      const regex = row!.data.regex as string;
      const pincodes = (pincodesByTenant.get(tenantId) ?? []).flatMap((t) => (t.data.pincode ?? []) as (string | number)[]);
      // With no pincodes of its own, a tenant has no reason to differ from the seed.
      if (pincodes.length === 0) {
        expect(regex, `${tenantId} ships no pincodes, so its rule must be the DDH seed's`).toBe(
          rows.find((r) => r.fieldType === 'postalCode')!.regex,
        );
        continue;
      }
      const rule = new RegExp(regex);
      for (const pincode of pincodes.map(String)) {
        expect(pincode, `${tenantId} rule ${regex}`).toMatch(rule);
        expect(pincode.slice(0, -1), `${tenantId} rule ${regex}`).not.toMatch(rule);
        expect(`${pincode}0`, `${tenantId} rule ${regex}`).not.toMatch(rule);
      }
    }
  });
});
