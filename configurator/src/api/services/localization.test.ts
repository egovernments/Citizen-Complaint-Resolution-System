import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localizationService } from './localization';

const types = [{ serviceCode: 'WaterLeak', name: 'Leak' }];

describe('uploadComplaintTypeLocalizationsForLocales', () => {
  const upsert = vi.spyOn(localizationService, 'upsertMessages');
  const search = vi.spyOn(localizationService, 'searchMessages');

  beforeEach(() => {
    upsert.mockReset().mockResolvedValue({ success: 1, failed: 0 });
    search.mockReset().mockResolvedValue([]);
  });

  const codesFor = (locale: string) => upsert.mock.calls.find((c) => c[1] === locale)?.[2].map((m) => m.code) ?? [];

  it('writes CS_COMPLAINT_LOCATION only under en_IN', async () => {
    await localizationService.uploadComplaintTypeLocalizationsForLocales('t', types, ['en_IN', 'pt_MZ']);
    expect(codesFor('en_IN')).toContain('CS_COMPLAINT_LOCATION');
    expect(codesFor('pt_MZ')).not.toContain('CS_COMPLAINT_LOCATION');
  });

  it('does not overwrite existing translations in non-English locales, but always writes en_IN', async () => {
    search.mockResolvedValue([{ code: 'COMPLAINT_HIERARCHY.WaterLeak', message: 'Vazamento', module: 'rainmaker-pgr', locale: 'pt_MZ' }]);
    await localizationService.uploadComplaintTypeLocalizationsForLocales('t', types, ['en_IN', 'pt_MZ']);
    expect(codesFor('en_IN')).toContain('COMPLAINT_HIERARCHY.WaterLeak');
    expect(codesFor('pt_MZ')).not.toContain('COMPLAINT_HIERARCHY.WaterLeak');
  });

  it('keeps going when one locale fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    search.mockRejectedValue(new Error('boom'));
    await localizationService.uploadComplaintTypeLocalizationsForLocales('t', types, ['en_IN', 'pt_MZ']);
    expect(codesFor('en_IN').length).toBeGreaterThan(0);
  });
});
