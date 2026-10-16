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
  stateInfoRecord: null,
  name: 'acme',
  logoUrl: null,
  bannerUrl: null,
  themeId: null,
  ...over,
});

const stateInfoRecord = record({
  schemaCode: 'common-masters.StateInfo',
  data: { code: 'acme', name: 'Acme Council', bannerUrl: '', languages: [{ label: 'ENGLISH', value: 'en_IN' }] },
});

beforeEach(() => {
  vi.clearAllMocks();
  search.mockImplementation(async (_tenant, schema) => schema === 'tenant.tenants' ? [tenantRecord] : []);
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
  it('requires the PGR rename flow and never writes the name directly', async () => {
    await expect(saveBranding(branding(), { name: 'Acme Council', logo: null, theme: cmsBlue })).rejects.toThrow('Workspace settings');
    expect(update).not.toHaveBeenCalled();
    expect(upsertMessages).not.toHaveBeenCalled();
  });

  it('points the logo at a lasting filestore link, not a signed one', async () => {
    upload.mockResolvedValue({ fileStoreId: 'file-1', fileName: 'logo.png' });
    const file = new File(['x'], 'logo.png', { type: 'image/png' });

    const saved = await saveBranding(branding(), { name: 'acme', logo: { kind: 'upload', file }, theme: null });

    const link = 'https://digit.example/filestore/v1/files/id?tenantId=acme&fileStoreId=file-1';
    expect(update).toHaveBeenCalledWith(tenantRecord, expect.objectContaining({ logoId: link, imageId: 'file-1' }));
    expect(saved.logoUrl).toBeNull(); // Re-read is authoritative; the mocked MDMS search still returns the old record.
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

    const failure = await saveBranding(branding(), { name: 'acme', logo: { kind: 'upload', file }, theme: cmsBlue }).catch(
      (err) => err,
    );

    expect(failure).toBeInstanceOf(ThemeSaveError);
    expect(failure.saved.name).toBe('acme');
    expect(failure.saved.logoUrl).toBeNull(); // The returned search record wins over the write echo.
    expect(failure.saved.themeId).toBeNull();
  });
});

describe('the citizen banner', () => {
  it('reads the banner from the state root\'s StateInfo, treating "" as none', async () => {
    search.mockImplementation(async (_tenant, schema) =>
      schema === 'tenant.tenants' ? [tenantRecord] : schema === 'common-masters.StateInfo' ? [stateInfoRecord] : [],
    );
    expect((await loadBranding('acme')).bannerUrl).toBeNull();

    const withBanner = record({ ...stateInfoRecord, data: { ...stateInfoRecord.data, bannerUrl: 'https://img/banner.jpg' } });
    search.mockImplementation(async (_tenant, schema) =>
      schema === 'tenant.tenants' ? [tenantRecord] : schema === 'common-masters.StateInfo' ? [withBanner] : [],
    );
    const loaded = await loadBranding('acme');
    expect(loaded.bannerUrl).toBe('https://img/banner.jpg');
    expect(loaded.stateInfoRecord).toBe(withBanner);
  });

  it('still loads the step when StateInfo cannot be read; the banner is just unavailable', async () => {
    search.mockImplementation(async (_tenant, schema) => {
      if (schema === 'common-masters.StateInfo') throw new Error('503');
      return schema === 'tenant.tenants' ? [tenantRecord] : [];
    });
    const loaded = await loadBranding('acme');
    expect(loaded.stateInfoRecord).toBeNull();
    expect(loaded.bannerUrl).toBeNull();
  });

  it('uploads the banner and points StateInfo at a lasting link, keeping its other fields', async () => {
    search.mockImplementation(async (_tenant, schema) =>
      schema === 'tenant.tenants' ? [tenantRecord] : schema === 'common-masters.StateInfo' ? [stateInfoRecord] : [],
    );
    upload.mockResolvedValue({ fileStoreId: 'banner-1', fileName: 'banner.jpg' });
    const file = new File(['x'], 'banner.jpg', { type: 'image/jpeg' });

    await saveBranding(branding({ stateInfoRecord }), { name: 'acme', logo: null, theme: null, banner: { kind: 'upload', file } });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(stateInfoRecord, {
      ...stateInfoRecord.data,
      bannerUrl: 'https://digit.example/filestore/v1/files/id?tenantId=acme&fileStoreId=banner-1',
    });
  });

  it('clears the banner to "" when it is removed', async () => {
    const withBanner = record({ ...stateInfoRecord, data: { ...stateInfoRecord.data, bannerUrl: 'https://img/banner.jpg' } });
    search.mockImplementation(async (_tenant, schema) =>
      schema === 'tenant.tenants' ? [tenantRecord] : schema === 'common-masters.StateInfo' ? [withBanner] : [],
    );
    await saveBranding(branding({ stateInfoRecord: withBanner, bannerUrl: 'https://img/banner.jpg' }), {
      name: 'acme',
      logo: null,
      theme: null,
      banner: { kind: 'remove' },
    });
    expect(update.mock.calls[0][1]).toEqual(expect.objectContaining({ bannerUrl: '', name: 'Acme Council' }));
  });

  it('refuses a banner when the workspace has no StateInfo, before writing anything', async () => {
    upload.mockResolvedValue({ fileStoreId: 'logo-1', fileName: 'logo.png' });
    const banner = new File(['x'], 'banner.jpg', { type: 'image/jpeg' });
    const logo = new File(['x'], 'logo.png', { type: 'image/png' });

    await expect(
      saveBranding(branding(), { name: 'acme', logo: { kind: 'upload', file: logo }, theme: null, banner: { kind: 'upload', file: banner } }),
    ).rejects.toThrow(/no State Info record/);
    expect(upload).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
