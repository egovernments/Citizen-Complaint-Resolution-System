import { beforeEach, describe, expect, it, vi } from 'vitest';

const search = vi.fn();
const getMobileValidation = vi.fn();
vi.mock('@/api', () => ({ mdmsService: { search, getMobileValidation } }));

const { countryFromDialCode, resolveTenantCountry } = await import('./tenantCountry');

describe('countryFromDialCode', () => {
  it('maps the priority countries, with or without the plus', () => {
    expect(countryFromDialCode('+254')).toBe('KE');
    expect(countryFromDialCode('258')).toBe('MZ');
    expect(countryFromDialCode('+27')).toBe('ZA');
    expect(countryFromDialCode('+1')).toBeNull();
    expect(countryFromDialCode(undefined)).toBeNull();
  });
});

describe('resolveTenantCountry', () => {
  beforeEach(() => {
    search.mockReset();
    getMobileValidation.mockReset();
  });

  it('prefers the country signup wrote on the tenant record', async () => {
    search.mockResolvedValue([{ code: 'riverside', country: 'ke' }]);
    getMobileValidation.mockResolvedValue({ countryCode: '+258' });
    expect(await resolveTenantCountry('riverside')).toEqual({ country: 'KE', from: 'tenant' });
    expect(search).toHaveBeenCalledWith('riverside', 'tenant.tenants', { uniqueIdentifiers: ['riverside'] });
    expect(getMobileValidation).not.toHaveBeenCalled();
  });

  it("falls back to a city tenant's root record", async () => {
    search.mockResolvedValue([{ code: 'mz', country: 'MZ' }]);
    expect(await resolveTenantCountry('mz.maputo')).toEqual({ country: 'MZ', from: 'tenant' });
    expect(search).toHaveBeenCalledWith('mz', 'tenant.tenants', { uniqueIdentifiers: ['mz.maputo', 'mz'] });
  });

  it('falls back to the phone rule when the record has no country, or cannot be read', async () => {
    search.mockResolvedValue([{ code: 'ke', name: 'Kenya' }]);
    getMobileValidation.mockResolvedValue({ countryCode: '+254' });
    expect(await resolveTenantCountry('ke')).toEqual({ country: 'KE', from: 'dial-code' });
    search.mockRejectedValue(new Error('403'));
    expect(await resolveTenantCountry('ke')).toEqual({ country: 'KE', from: 'dial-code' });
  });

  it('gives up when neither says', async () => {
    search.mockResolvedValue([]);
    getMobileValidation.mockResolvedValue({ countryCode: '+1' });
    expect(await resolveTenantCountry('acme')).toBeNull();
    getMobileValidation.mockRejectedValue(new Error('down'));
    expect(await resolveTenantCountry('acme')).toBeNull();
  });
});
