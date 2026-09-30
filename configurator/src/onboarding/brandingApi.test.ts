import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient, localizationService, mdmsService } from '@/api';
import type { MdmsRecord } from '@/api/types';
import { BRAND_THEMES } from './brandThemes';
import { loadBranding, matchBrandTheme, saveBranding, ThemeSaveError, type Branding } from './brandingApi';

vi.mock('@/api', () => ({
  ENDPOINTS: { FILESTORE_FILE: '/filestore/v1/files/id' },
  MDMS_SCHEMAS: { TENANT: 'tenant.tenants' },
  apiClient: { uploadFile: vi.fn(), getEnvironment: vi.fn(() => 'https://digit.example') },
  mdmsService: { searchRecords: vi.fn(), update: vi.fn(), create: vi.fn() },
  localizationService: {
    upsertMessages: vi.fn(),
    cacheBust: vi.fn(async () => undefined),
    buildTenantLocalizations: vi.fn((code: string, name: string) => [{ code: `TENANT_TENANTS_${code}`, message: name }]),
  },
}));

const search = vi.mocked(mdmsService.searchRecords);
const update = vi.mocked(mdmsService.update);
const create = vi.mocked(mdmsService.create);
const upload = vi.mocked(apiClient.uploadFile);
const upsertMessages = vi.mocked(localizationService.upsertMessages);

const record = (over: Partial<MdmsRecord>): MdmsRecord => ({
  id: 'uuid',
  tenantId: 'acme',
  schemaCode: 'tenant.tenants',
  uniqueIdentifier: 'acme',
  data: {},
  isActive: true,
  ...over,
});

const tenantRecord = record({ data: { code: 'acme', name: 'acme', imageId: null, tenantId: 'acme' } });
const cmsBlue = BRAND_THEMES.find((theme) => theme.id === 'cms-blue')!;
const digitOrange = BRAND_THEMES.find((theme) => theme.id === 'digit-orange')!;

const branding = (over: Partial<Branding> = {}): Branding => ({
  tenantId: 'acme',
  tenantRecord,
  themeRecord: null,
  name: 'acme',
  logoUrl: null,
  themeId: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  update.mockImplementation(async (rec, data) => ({ ...rec, data }));
  create.mockImplementation(async (tenantId, schemaCode, uniqueIdentifier, data) =>
    record({ tenantId, schemaCode, uniqueIdentifier, data }),
  );
  upsertMessages.mockResolvedValue({ success: 1, failed: 0 });
});

describe('loadBranding', () => {
  it('reads the workspace record and ignores a theme owned by a parent tenant', async () => {
    search.mockImplementation(async (_tenant, schema) =>
      schema === 'tenant.tenants'
        ? [tenantRecord]
        : [record({ tenantId: 'root', schemaCode: 'common-masters.ThemeConfig', uniqueIdentifier: 'themeconfig' })],
    );
    const loaded = await loadBranding('acme');
    expect(loaded.name).toBe('acme');
    expect(loaded.logoUrl).toBeNull();
    expect(loaded.themeRecord).toBeNull();
  });

  it('fails clearly when the workspace has no tenant record', async () => {
    search.mockResolvedValue([]);
    await expect(loadBranding('acme')).rejects.toThrow(/no tenant record/);
  });
});

describe('matchBrandTheme', () => {
  it('recognises a preset by its colours even under another name', () => {
    const live = record({ data: { name: 'Bomet County Blue', colors: { ...cmsBlue.colors } } });
    expect(matchBrandTheme(live)).toBe('cms-blue');
  });

  it('leaves a custom theme unmatched', () => {
    expect(matchBrandTheme(record({ data: { name: 'Mine', colors: { brand: '#123456' } } }))).toBeNull();
  });
});

describe('saveBranding', () => {
  it('renames the tenant, relabels it, and creates the first theme record', async () => {
    const saved = await saveBranding(branding(), { name: '  Acme Council ', logo: null, theme: cmsBlue });

    expect(update).toHaveBeenCalledWith(tenantRecord, expect.objectContaining({ name: 'Acme Council' }));
    expect(upsertMessages).toHaveBeenCalledWith('acme', 'en_IN', [
      { code: 'TENANT_TENANTS_acme', message: 'Acme Council' },
    ]);
    expect(create).toHaveBeenCalledWith(
      'acme',
      'common-masters.ThemeConfig',
      'themeconfig',
      expect.objectContaining({ code: 'themeconfig', name: 'CMS Blue', version: cmsBlue.version, colors: cmsBlue.colors }),
    );
    expect(saved.themeId).toBe('cms-blue');
  });

  it('points the logo at a lasting filestore link, not a signed one', async () => {
    upload.mockResolvedValue({ fileStoreId: 'file-1', fileName: 'logo.png' });
    const file = new File(['x'], 'logo.png', { type: 'image/png' });

    const saved = await saveBranding(branding(), { name: 'acme', logo: { kind: 'upload', file }, theme: null });

    const link = 'https://digit.example/filestore/v1/files/id?tenantId=acme&fileStoreId=file-1';
    expect(update).toHaveBeenCalledWith(tenantRecord, expect.objectContaining({ logoId: link, imageId: 'file-1' }));
    expect(saved.logoUrl).toBe(link);
    // The name did not change, so its label is left alone
    expect(upsertMessages).not.toHaveBeenCalled();
  });

  it('drops logoId (not nullable) when the logo is removed', async () => {
    const withLogo = record({ data: { ...tenantRecord.data, logoId: 'https://old', imageId: 'old' } });
    await saveBranding(branding({ tenantRecord: withLogo, logoUrl: 'https://old' }), {
      name: 'acme',
      logo: { kind: 'remove' },
      theme: null,
    });
    const data = update.mock.calls[0][1];
    expect(data).not.toHaveProperty('logoId');
    expect(data.imageId).toBeNull();
  });

  it('rewrites the existing theme record in place when the theme changes', async () => {
    const themeRecord = record({
      schemaCode: 'common-masters.ThemeConfig',
      uniqueIdentifier: 'bomet-county',
      data: { code: 'bomet-county', name: 'CMS Blue', version: '3', colors: cmsBlue.colors },
    });
    await saveBranding(branding({ themeRecord, themeId: 'cms-blue' }), { name: 'acme', logo: null, theme: digitOrange });

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      themeRecord,
      expect.objectContaining({ code: 'bomet-county', name: 'DIGIT Orange', colors: digitOrange.colors }),
    );
  });

  it('writes nothing when nothing changed', async () => {
    await saveBranding(branding({ themeId: 'cms-blue' }), { name: 'acme', logo: null, theme: cmsBlue });
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(upsertMessages).not.toHaveBeenCalled();
  });
});

describe('saveBranding when only the theme fails', () => {
  it('reports what did save, so a retry does not upload the logo again', async () => {
    upload.mockResolvedValue({ fileStoreId: 'file-2', fileName: 'logo.png' });
    create.mockRejectedValueOnce(new Error('Schema definition against which data is being created is not found'));
    const file = new File(['x'], 'logo.png', { type: 'image/png' });

    const failure = await saveBranding(branding(), { name: 'Acme', logo: { kind: 'upload', file }, theme: cmsBlue }).catch(
      (err) => err,
    );

    expect(failure).toBeInstanceOf(ThemeSaveError);
    expect(failure.saved.name).toBe('Acme');
    expect(failure.saved.logoUrl).toBe('https://digit.example/filestore/v1/files/id?tenantId=acme&fileStoreId=file-2');
    expect(failure.saved.themeId).toBeNull();
  });
});
