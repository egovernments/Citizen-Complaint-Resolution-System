import { expect, it } from 'vitest';
import { orgChartTenants } from './orgChartTenants';

// digit-3 P0 (2026-10-14): at ke.bomet the org chart is Bomet's (it opened at the first tenant, the state).
const tenants = [{ code: 'ke' }, { code: 'ke.bomet' }, { code: 'ke.bomet.health' }, { code: 'ke.nairobi' }];
it('offers the working tenant first, then its subtree', () => {
  expect(orgChartTenants(tenants, 'ke.bomet').map((t) => t.code)).toEqual(['ke.bomet', 'ke.bomet.health']);
});
it('at the state: every tenant, the state first', () => {
  expect(orgChartTenants(tenants, 'ke').map((t) => t.code)).toEqual(['ke', 'ke.bomet', 'ke.bomet.health', 'ke.nairobi']);
});
