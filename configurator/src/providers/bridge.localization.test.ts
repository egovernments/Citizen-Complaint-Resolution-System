import { describe, it, expect, vi, beforeEach } from 'vitest';

// #1880 review (PR #2211): which localization writes refresh the configurator's
// own strings, and when a session change reloads them.
const { refreshTranslations, cacheBust, baseUpdate } = vi.hoisted(() => ({
  refreshTranslations: vi.fn(async () => {}),
  cacheBust: vi.fn(async () => {}),
  baseUpdate: vi.fn(async () => ({ data: { id: 'x' } })),
}));

vi.mock('./i18nProvider', () => ({
  i18nProvider: {},
  clearTranslationCache: vi.fn(),
  refreshTranslations,
}));
vi.mock('@/api/services/localization', () => ({ localizationService: { cacheBust } }));
vi.mock('@/identity/memberProvider', () => ({ withIdentityMembers: (dp: unknown) => dp }));
vi.mock('@digit-mcp/data-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@digit-mcp/data-provider')>()),
  createDigitDataProvider: () => ({ update: baseUpdate, create: baseUpdate, delete: baseUpdate, deleteMany: baseUpdate, updateMany: baseUpdate }),
}));

const { getDataProvider, configureDigitClient, afterLocalizationWrite } = await import('./bridge');

const USER = { id: 1, uuid: 'u', userName: 'admin', name: 'Admin', mobileNumber: '', type: 'EMPLOYEE', roles: [], tenantId: 'ke' };

/** Let the fire-and-forget afterLocalizationWrite settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('localization writes', () => {
  beforeEach(() => {
    refreshTranslations.mockClear();
    cacheBust.mockClear();
  });

  it('skip the cache-bust and refresh when the module is not one the configurator reads', async () => {
    await getDataProvider('ke').update('localization', {
      id: 'PGR_X', data: { code: 'PGR_X', module: 'rainmaker-pgr', message: 'x' }, previousData: { id: 'PGR_X', module: 'rainmaker-pgr' },
    });
    await settle();
    expect(cacheBust).not.toHaveBeenCalled();
    expect(refreshTranslations).not.toHaveBeenCalled();
  });

  it('bust the cache, then force a refresh, for configurator-ui and rainmaker-common', async () => {
    for (const module of ['configurator-ui', 'rainmaker-common']) {
      await getDataProvider('ke').update('localization', {
        id: 'app.fields.sla', data: { code: 'app.fields.sla', module, message: 'Default SLA' }, previousData: { id: 'app.fields.sla', module },
      });
    }
    await settle();
    expect(cacheBust).toHaveBeenCalledTimes(2);
    expect(refreshTranslations).toHaveBeenCalledTimes(2);
    expect(refreshTranslations).toHaveBeenCalledWith({ force: true });
  });

  it('refresh when the write names no module (a bulk delete by id)', async () => {
    await getDataProvider('ke').deleteMany('localization', { ids: ['a', 'b'] });
    await settle();
    expect(refreshTranslations).toHaveBeenCalledWith({ force: true });
  });

  it('bulk import: always busts the cache, refreshes only for the UI modules', async () => {
    await afterLocalizationWrite(['rainmaker-pgr', 'rainmaker-pgr']);
    expect(cacheBust).toHaveBeenCalledTimes(1);
    expect(refreshTranslations).not.toHaveBeenCalled();

    await afterLocalizationWrite(['rainmaker-pgr', 'configurator-ui']);
    expect(refreshTranslations).toHaveBeenCalledWith({ force: true });
  });
});

describe('configureDigitClient', () => {
  beforeEach(() => refreshTranslations.mockClear());

  it('reloads the strings on a new server even when the tenant code is the same', () => {
    configureDigitClient('https://env-a.example', 'tok', USER, 'ke');
    refreshTranslations.mockClear();
    // Same tab, logged out of env A, logged in to env B, also tenant `ke`.
    configureDigitClient('https://env-b.example', 'tok2', USER, 'ke');
    expect(refreshTranslations).toHaveBeenCalledTimes(1);
  });

  it('reloads the strings on a sign-in to the same server and tenant', () => {
    configureDigitClient('https://env-a.example', 'tok', USER, 'ke');
    refreshTranslations.mockClear();
    configureDigitClient('https://env-a.example', 'tok3', USER, 'ke');
    expect(refreshTranslations).toHaveBeenCalledTimes(1);
  });

  it('leaves them alone when nothing about the session changed', () => {
    configureDigitClient('https://env-a.example', 'tok', USER, 'ke');
    refreshTranslations.mockClear();
    configureDigitClient('https://env-a.example', undefined, undefined, 'ke');
    expect(refreshTranslations).not.toHaveBeenCalled();
  });
});
