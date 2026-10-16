import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mdmsService } from '@/api';
import { i18nProvider } from '@/providers/i18nProvider';
import { labelLocales, readLocales } from './labelLocales';

vi.mock('@/api', () => ({ mdmsService: { getStateInfoLocales: vi.fn() } }));
vi.mock('@/providers/i18nProvider', () => ({ i18nProvider: { getLocale: vi.fn() } }));

const stateInfoLocales = vi.mocked(mdmsService.getStateInfoLocales);
const getLocale = vi.mocked(i18nProvider.getLocale);

beforeEach(() => vi.clearAllMocks());

describe('labelLocales', () => {
  it("writes under en_IN and the workspace's StateInfo locales, once each", async () => {
    stateInfoLocales.mockResolvedValue(['en_KE', 'sw_KE', 'en_IN', 'en_KE']);
    expect(await labelLocales('ke.nairobi')).toEqual(['en_IN', 'en_KE', 'sw_KE']);
    expect(stateInfoLocales).toHaveBeenCalledWith('ke.nairobi');
  });

  it('still writes en_IN when StateInfo has no languages or cannot be read', async () => {
    stateInfoLocales.mockResolvedValueOnce([]);
    expect(await labelLocales('acme')).toEqual(['en_IN']);
    stateInfoLocales.mockRejectedValueOnce(new Error('down'));
    expect(await labelLocales('acme')).toEqual(['en_IN']);
  });
});

describe('readLocales', () => {
  it('reads the active UI locale first, falling back to en_IN', () => {
    getLocale.mockReturnValue('en_KE');
    expect(readLocales()).toEqual(['en_KE', 'en_IN']);
    getLocale.mockReturnValue('en_IN');
    expect(readLocales()).toEqual(['en_IN']);
    getLocale.mockReturnValue('');
    expect(readLocales()).toEqual(['en_IN']);
  });
});
