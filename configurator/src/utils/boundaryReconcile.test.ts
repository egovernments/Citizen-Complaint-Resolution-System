import { describe, expect, it } from 'vitest';
import type { BoundaryExcelRow } from '@/api/types';
import { compareWithExisting, type ExistingBoundary } from './boundaryReconcile';

const row = (code: string, name: string, parentCode?: string, sheetRow?: number): BoundaryExcelRow => ({
  code,
  name,
  boundaryType: parentCode ? 'Emirate' : 'Country',
  parentCode,
  row: sheetRow,
});

const existing: ExistingBoundary[] = [
  { code: 'COUNTRY_001', name: 'UAE' },
  { code: 'EMIRATE_001', parent: 'COUNTRY_001', name: 'Dubai' },
];

describe('compareWithExisting (#2456)', () => {
  it('leaves an exact re-list alone', () => {
    const result = compareWithExisting([row('COUNTRY_001', 'UAE'), row('EMIRATE_001', ' Dubai ', 'COUNTRY_001')], existing);
    expect(result.alreadyThere.map((r) => r.code)).toEqual(['COUNTRY_001', 'EMIRATE_001']);
    expect(result.toCreate).toEqual([]);
    expect(result.toLabel).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it('refuses a code already there under another name', () => {
    const result = compareWithExisting([row('EMIRATE_001', 'Abudhabi', 'COUNTRY_001', 6)], existing);
    expect(result.conflicts).toEqual([
      { code: 'EMIRATE_001', row: 6, current: { name: 'Dubai', parent: 'COUNTRY_001' }, sheet: { name: 'Abudhabi', parent: 'COUNTRY_001' } },
    ]);
    expect(result.toCreate).toEqual([]);
  });

  it('refuses a code already there under another parent, top level included', () => {
    const result = compareWithExisting([row('EMIRATE_001', 'Dubai', 'COUNTRY_002', 3), row('COUNTRY_001', 'UAE', 'WORLD', 2)], existing);
    expect(result.conflicts.map((c) => [c.code, c.current.parent, c.sheet.parent])).toEqual([
      ['EMIRATE_001', 'COUNTRY_001', 'COUNTRY_002'],
      ['COUNTRY_001', undefined, 'WORLD'],
    ]);
  });

  it('lets a retry after a partial failure create only what is missing', () => {
    const sheet = [
      row('COUNTRY_001', 'UAE'),
      row('EMIRATE_001', 'Dubai', 'COUNTRY_001'),
      row('EMIRATE_002', 'Abudhabi', 'COUNTRY_001'),
      { ...row('DEIRA', 'Deira', 'EMIRATE_001'), boundaryType: 'Area' },
    ];
    const result = compareWithExisting(sheet, existing);
    expect(result.toCreate.map((r) => r.code)).toEqual(['EMIRATE_002', 'DEIRA']);
    expect(result.alreadyThere.map((r) => r.code)).toEqual(['COUNTRY_001', 'EMIRATE_001']);
    expect(result.conflicts).toEqual([]);
  });

  it('labels an exact re-list whose boundary has no en_IN name, and leaves a named one alone', () => {
    const result = compareWithExisting(
      [row('EMIRATE_001', 'Dubai', 'COUNTRY_001'), row('EMIRATE_009', 'Ajman', 'COUNTRY_001')],
      [...existing, { code: 'EMIRATE_009', parent: 'COUNTRY_001' }],
    );
    expect(result.alreadyThere.map((r) => r.code)).toEqual(['EMIRATE_001', 'EMIRATE_009']);
    expect(result.toLabel.map((r) => r.code)).toEqual(['EMIRATE_009']);
    expect(result.conflicts).toEqual([]);
  });
});
