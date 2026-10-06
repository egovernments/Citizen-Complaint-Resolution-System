import { beforeEach, describe, expect, it, vi } from 'vitest';

const search = vi.fn();
const getMobileValidation = vi.fn();
vi.mock('@/api', () => ({ mdmsService: { search, getMobileValidation } }));

const { resolveTenantCountry } = await import('./tenantCountry');

describe('resolveTenantCountry', () => {
  beforeEach(() => {
    search.mockReset();
    getMobileValidation.mockReset();
  });

  it('reads the country signup wrote on the tenant record', async () => {
    search.mockResolvedValue([{ code: 'riverside', country: 'ke' }]);
    expect(await resolveTenantCountry('riverside')).toBe('KE');
    expect(search).toHaveBeenCalledWith('riverside', 'tenant.tenants', { uniqueIdentifiers: ['riverside'] });
  });

  it("falls back to a city tenant's root record", async () => {
    search.mockResolvedValue([{ code: 'mz', country: 'MZ' }]);
    expect(await resolveTenantCountry('mz.maputo')).toBe('MZ');
    expect(search).toHaveBeenCalledWith('mz', 'tenant.tenants', { uniqueIdentifiers: ['mz.maputo', 'mz'] });
  });

  it('never guesses from the phone rule: a deploy-seeded +91 is not "India"', async () => {
    search.mockResolvedValue([{ code: 'pg', name: 'Demo' }]);
    getMobileValidation.mockResolvedValue({ countryCode: '+91' });
    expect(await resolveTenantCountry('pg')).toBeNull();
    expect(getMobileValidation).not.toHaveBeenCalled();
  });

  it('is null when the record cannot be read', async () => {
    search.mockRejectedValue(new Error('403'));
    expect(await resolveTenantCountry('ke')).toBeNull();
  });
});
