import { describe, it, expect } from 'vitest';
import { parseCsv, recordsToCsv } from './csvParser';
import type { CategorySlaRecord } from './types';

// Import headers are lowercased for case-insensitive matching, but the
// row-builder (and REQUIRED_COLS) read the camelCase key `subcategoryL1`.
// Before the canonicalization fix, even a header spelled exactly
// `subcategoryL1` was lowercased to `subcategoryl1`, so every import row
// failed with `missing required column "subcategoryL1"` — including files
// produced by our own Export CSV button.
const HEADER =
  'path,category,subcategoryL1,sla_new,sla_triage,sla_forwarded,sla_investigation,sla_awaiting,sla_resolved';

function csvWithSubcatHeader(subcatHeader: string): string {
  return [
    `path,category,${subcatHeader},sla_new,sla_triage,sla_forwarded,sla_investigation,sla_awaiting,sla_resolved`,
    'health,Sanitation,Garbage,24,48,,,,',
  ].join('\n');
}

describe('parseCsv header casing (subcategoryL1)', () => {
  it('parses when the header is exactly "subcategoryL1"', () => {
    const { rows, totalValid, totalInvalid } = parseCsv(csvWithSubcatHeader('subcategoryL1'));
    expect(totalInvalid).toBe(0);
    expect(totalValid).toBe(1);
    expect(rows[0]?.record?.subcategoryL1).toBe('Garbage');
  });

  it('parses when the header is "SUBCATEGORYL1"', () => {
    const { rows, totalValid, totalInvalid } = parseCsv(csvWithSubcatHeader('SUBCATEGORYL1'));
    expect(totalInvalid).toBe(0);
    expect(totalValid).toBe(1);
    expect(rows[0]?.record?.subcategoryL1).toBe('Garbage');
  });

  it('parses when the header is "subcategoryl1"', () => {
    const { rows, totalValid, totalInvalid } = parseCsv(csvWithSubcatHeader('subcategoryl1'));
    expect(totalInvalid).toBe(0);
    expect(totalValid).toBe(1);
    expect(rows[0]?.record?.subcategoryL1).toBe('Garbage');
  });
});

describe('parseCsv cell values', () => {
  it('parses a range cell "24-120" as [24, 120]', () => {
    const csv = [HEADER, 'health,Sanitation,Garbage,24-120,,,,,'].join('\n');
    const { rows, totalInvalid } = parseCsv(csv);
    expect(totalInvalid).toBe(0);
    expect(rows[0]?.record?.slaHoursByState.new).toEqual([24, 120]);
  });

  it('parses an empty cell as null (StateSLA fallback)', () => {
    const csv = [HEADER, 'health,Sanitation,Garbage,,72,,,,'].join('\n');
    const { rows, totalInvalid } = parseCsv(csv);
    expect(totalInvalid).toBe(0);
    expect(rows[0]?.record?.slaHoursByState.new).toBeNull();
    expect(rows[0]?.record?.slaHoursByState.triage).toBe(72);
  });

  it('still errors when a required column is missing', () => {
    const csv = ['path,subcategoryL1,sla_new', 'health,Garbage,24'].join('\n');
    const { rows, totalValid, totalInvalid } = parseCsv(csv);
    expect(totalValid).toBe(0);
    expect(totalInvalid).toBe(1);
    expect(rows[0]?.record).toBeUndefined();
    expect(rows[0]?.errors).toContain('missing required column "category"');
  });
});

describe('export → import round-trip', () => {
  it('recordsToCsv output re-parses to identical records', () => {
    // The exported header spells `subcategoryL1` in camelCase — this
    // round-trip is exactly what the casing bug broke.
    const records: CategorySlaRecord[] = [
      {
        path: 'health',
        category: 'Sanitation',
        subcategoryL1: 'Garbage Collection',
        slaHoursByState: { new: 24, triage: [24, 120], forwarded: null, investigation: 72, awaiting: null, resolved: 360 },
        isActive: true,
      },
      {
        // Comma in path forces CSV quoting on export.
        path: 'water, sewer',
        category: 'Water',
        subcategoryL1: 'Leakage',
        slaHoursByState: { new: null, triage: null, forwarded: null, investigation: null, awaiting: null, resolved: null },
        isActive: true,
      },
    ];
    const { rows, totalValid, totalInvalid } = parseCsv(recordsToCsv(records));
    expect(totalInvalid).toBe(0);
    expect(totalValid).toBe(2);
    expect(rows.map((r) => r.record)).toEqual(records);
  });
});
