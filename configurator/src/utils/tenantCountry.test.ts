import { beforeEach, describe, expect, it, vi } from 'vitest';

const search = vi.fn();
const getMobileValidation = vi.fn();
vi.mock('@/api', () => ({ mdmsService: { search, getMobileValidation } }));

const { readTenantProfile } = await import('./tenantCountry');

describe('readTenantProfile', () => {
  beforeEach(() => {
    search.mockReset();
    getMobileValidation.mockReset();
  });

  it('reads the signup country and the workspace name from the tenant record', async () => {
    search.mockResolvedValue([{ code: 'riverside', country: 'ke', name: ' Riverside Council ' }]);
    expect(await readTenantProfile('riverside')).toEqual({ country: 'KE', name: 'Riverside Council' });
    expect(search).toHaveBeenCalledWith('riverside', 'tenant.tenants', { uniqueIdentifiers: ['riverside'] });
  });

  it("takes a city tenant's country from its root record, and its own name", async () => {
    search.mockResolvedValue([{ code: 'mz', country: 'MZ', name: 'Mozambique' }, { code: 'mz.maputo', name: 'Maputo' }]);
    expect(await readTenantProfile('mz.maputo')).toEqual({ country: 'MZ', name: 'Maputo' });
    expect(search).toHaveBeenCalledWith('mz', 'tenant.tenants', { uniqueIdentifiers: ['mz.maputo', 'mz'] });
  });

  it('never guesses the country from the phone rule: a deploy-seeded +91 is not "India"', async () => {
    search.mockResolvedValue([{ code: 'pg', name: 'Demo' }]);
    getMobileValidation.mockResolvedValue({ countryCode: '+91' });
    expect(await readTenantProfile('pg')).toEqual({ country: null, name: 'Demo' });
    expect(getMobileValidation).not.toHaveBeenCalled();
  });

  it('knows nothing when the record cannot be read', async () => {
    search.mockRejectedValue(new Error('403'));
    expect(await readTenantProfile('ke')).toEqual({ country: null, name: null });
  });
});
