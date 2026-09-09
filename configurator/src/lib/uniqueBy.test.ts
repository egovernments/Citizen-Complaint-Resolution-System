import { describe, it, expect } from 'vitest';
import { uniqueBy } from './uniqueBy';

describe('uniqueBy', () => {
  it('keeps the FIRST item for a repeated key', () => {
    // Keep-first matters: aggregating fetchers list the session tenant's
    // records before its sub-tenants', so the survivor must be the session
    // tenant's definition.
    const hierarchies = [
      { hierarchyType: 'ADMIN', tenantId: 'ke' },
      { hierarchyType: 'ADMIN', tenantId: 'ke.india' },
      { hierarchyType: 'ADMIN', tenantId: 'ke.etoebeta' },
    ];
    expect(uniqueBy(hierarchies, (h) => h.hierarchyType)).toEqual([
      { hierarchyType: 'ADMIN', tenantId: 'ke' },
    ]);
  });

  it('preserves order and leaves distinct keys untouched', () => {
    const codes = ['ADMIN', 'INDIA', 'ADMIN', 'KE-ADMIN', 'INDIA', 'KE-ADMIN', 'ADMIN'];
    expect(uniqueBy(codes, (c) => c)).toEqual(['ADMIN', 'INDIA', 'KE-ADMIN']);
  });

  it('does not collapse distinct codes that share a display name', () => {
    // Two boundaries may legitimately be called "Central" in different
    // counties — only the submitted value may ever be collapsed.
    const boundaries = [
      { code: 'BOMET_CENTRAL', name: 'Central' },
      { code: 'NAIROBI_CENTRAL', name: 'Central' },
    ];
    expect(uniqueBy(boundaries, (b) => b.code)).toHaveLength(2);
  });

  it('treats null/undefined input as an empty list', () => {
    expect(uniqueBy(undefined, String)).toEqual([]);
    expect(uniqueBy(null, String)).toEqual([]);
  });

  it('collapses empty-string keys too — a select cannot tell them apart', () => {
    expect(uniqueBy([{ code: '' }, { code: '' }], (x) => x.code)).toHaveLength(1);
  });
});
