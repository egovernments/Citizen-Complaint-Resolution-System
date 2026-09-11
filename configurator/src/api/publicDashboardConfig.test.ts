import { describe, expect, it } from 'vitest';
import type { MdmsRecord } from './types';
import { buildPublicDashboardUrl, selectOwnedDashboardConfig } from './publicDashboardConfig';

const record = (
  tenantId: string,
  id: string,
  isActive = true,
): MdmsRecord => ({
  id: `${tenantId}-${id}`,
  tenantId,
  schemaCode: 'dss.DashboardConfig',
  uniqueIdentifier: id,
  data: { id },
  isActive,
});

describe('public dashboard configuration', () => {
  it('builds the canonical URL without duplicate slashes', () => {
    expect(buildPublicDashboardUrl('https://example.test/'))
      .toBe('https://example.test/digit-ui/public-dashboard');
  });

  it('selects the active owned default record and never an inherited record', () => {
    const inherited = record('ke', 'default');
    const alternate = record('ke.bomet', 'alpha');
    const selected = record('ke.bomet', 'default');

    expect(selectOwnedDashboardConfig(
      [inherited, alternate, selected],
      'ke.bomet',
    )).toBe(selected);
  });

  it('ignores soft-deleted records', () => {
    expect(selectOwnedDashboardConfig([record('ke', 'default', false)], 'ke')).toBeNull();
  });

  it('preserves response order for malformed duplicates like pgr-services and digit-ui', () => {
    const lowercase = record('ke', 'alpha');
    const uppercase = record('ke', 'Zulu');

    expect(selectOwnedDashboardConfig([lowercase, uppercase], 'ke')).toBe(lowercase);
    expect(selectOwnedDashboardConfig([uppercase, lowercase], 'ke')).toBe(uppercase);
  });
});
