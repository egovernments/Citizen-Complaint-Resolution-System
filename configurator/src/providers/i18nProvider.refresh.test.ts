import { describe, it, expect, vi, beforeEach } from 'vitest';

// Backend messages the mocked localization search returns for configurator-ui,
// per tenant and locale.
const backend: Record<string, Record<string, Record<string, string>>> = {};
type Search = (tenant: string, locale: string, module: string) => Promise<unknown[]>;
const serveBackend: Search = async (tenant, locale, module) =>
  module === 'configurator-ui'
    ? Object.entries(backend[tenant]?.[locale] ?? {}).map(([code, message]) => ({ code, message }))
    : [];

vi.mock('./bridge', () => ({
  digitClient: {
    stateTenantId: '',
    localizationSearch: vi.fn(),
  },
}));

const { digitClient } = await import('./bridge');
const { i18nProvider, refreshTranslations, clearTranslationCache } = await import('./i18nProvider');
const client = digitClient as unknown as { stateTenantId: string; localizationSearch: ReturnType<typeof vi.fn> };

function setBackend(tenant: string, locale: string, sla: string) {
  backend[tenant] = { ...backend[tenant], [locale]: { 'app.fields.sla': sla } };
}

/** A search that waits until `release()` is called. */
function deferredSearch(): { search: Search; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { search: async (...args) => { await gate; return serveBackend(...args); }, release };
}

describe('refreshTranslations (#1880 self-service relabel)', () => {
  beforeEach(async () => {
    // Every test starts from the same state, whatever ran before it.
    for (const k of Object.keys(backend)) delete backend[k];
    client.localizationSearch.mockReset();
    client.localizationSearch.mockImplementation(serveBackend);
    localStorage.clear();
    client.stateTenantId = '';
    clearTranslationCache();
    await i18nProvider.changeLocale('en_IN');
    client.stateTenantId = 'ke';
  });

  it('boots on the bundled English because no tenant is known yet', async () => {
    client.stateTenantId = '';
    await refreshTranslations();
    expect(i18nProvider.translate('app.fields.sla')).toBe('SLA');
  });

  it('loads the backend English strings once the tenant is known', async () => {
    setBackend('ke', 'en_IN', 'SLA (from backend)');
    await refreshTranslations();
    expect(i18nProvider.translate('app.fields.sla')).toBe('SLA (from backend)');
  });

  it('a forced refresh bypasses the 24h cache, so an admin edit shows at once', async () => {
    setBackend('ke', 'en_IN', 'SLA');
    await refreshTranslations({ force: true });
    expect(i18nProvider.translate('app.fields.sla')).toBe('SLA');

    setBackend('ke', 'en_IN', 'Default SLA');
    // Unforced: the localStorage cache written above still wins.
    await refreshTranslations();
    expect(i18nProvider.translate('app.fields.sla')).toBe('SLA');
    // Forced (what a Localization write triggers): the edit is picked up.
    await refreshTranslations({ force: true });
    expect(i18nProvider.translate('app.fields.sla')).toBe('Default SLA');
  });

  it('a failed forced refresh keeps the current non-English strings and their cache', async () => {
    setBackend('ke', 'hi_IN', 'एसएलए');
    await i18nProvider.changeLocale('hi_IN');
    expect(i18nProvider.translate('app.fields.sla')).toBe('एसएलए');

    client.localizationSearch.mockRejectedValue(new Error('502 Bad Gateway'));
    await refreshTranslations({ force: true });
    expect(i18nProvider.getLocale()).toBe('hi_IN');
    expect(i18nProvider.translate('app.fields.sla')).toBe('एसएलए');
    expect(localStorage.getItem('digit-i18n-ke-hi_IN')).toContain('एसएलए');

    // An empty answer is treated the same way.
    client.localizationSearch.mockResolvedValue([]);
    await refreshTranslations({ force: true });
    expect(i18nProvider.translate('app.fields.sla')).toBe('एसएलए');
  });

  it('drops a refresh that finishes after a newer one', async () => {
    setBackend('ke', 'en_IN', 'Before edit 2');
    const slow = deferredSearch();
    client.localizationSearch.mockImplementation(slow.search);
    const first = refreshTranslations({ force: true });

    setBackend('ke', 'en_IN', 'After edit 2');
    client.localizationSearch.mockImplementation(serveBackend);
    await refreshTranslations({ force: true });
    expect(i18nProvider.translate('app.fields.sla')).toBe('After edit 2');

    // The first fetch now resolves with what was there before edit 2.
    setBackend('ke', 'en_IN', 'Before edit 2');
    slow.release();
    await first;
    expect(i18nProvider.translate('app.fields.sla')).toBe('After edit 2');
    expect(localStorage.getItem('digit-i18n-ke-en_IN')).toContain('After edit 2');
  });

  it('does not undo a locale switch made while it was fetching', async () => {
    setBackend('ke', 'en_IN', 'SLA');
    setBackend('ke', 'fr_FR', 'Délai SLA');
    const slow = deferredSearch();
    client.localizationSearch.mockImplementation((tenant: string, locale: string, module: string) =>
      locale === 'en_IN' ? slow.search(tenant, locale, module) : serveBackend(tenant, locale, module),
    );
    const refresh = refreshTranslations({ force: true });
    await i18nProvider.changeLocale('fr_FR');
    slow.release();
    await refresh;
    expect(i18nProvider.getLocale()).toBe('fr_FR');
    expect(i18nProvider.translate('app.fields.sla')).toBe('Délai SLA');
  });

  it("keys the cache by tenant, so a new tenant's refresh never gets the previous tenant's strings", async () => {
    setBackend('ke', 'en_IN', 'SLA (ke)');
    await refreshTranslations();
    expect(i18nProvider.translate('app.fields.sla')).toBe('SLA (ke)');

    // Another session on tenant mz in the same browser: unforced, as bridge.ts runs it.
    setBackend('mz', 'en_IN', 'SLA (mz)');
    client.stateTenantId = 'mz';
    await refreshTranslations();
    expect(i18nProvider.translate('app.fields.sla')).toBe('SLA (mz)');
  });
});
