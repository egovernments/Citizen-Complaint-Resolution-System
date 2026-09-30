import { describe, it, expect, vi, beforeEach } from 'vitest';

// Backend messages the mocked localization search returns (configurator-ui).
const backend: Record<string, string> = {};

vi.mock('./bridge', () => ({
  digitClient: {
    stateTenantId: '',
    localizationSearch: vi.fn(async (_tenant: string, locale: string, module: string) =>
      module === 'configurator-ui' && locale === 'en_IN'
        ? Object.entries(backend).map(([code, message]) => ({ code, message }))
        : [],
    ),
  },
}));

const { digitClient } = await import('./bridge');
const { i18nProvider, refreshTranslations } = await import('./i18nProvider');

describe('refreshTranslations (#1880 self-service relabel)', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const k of Object.keys(backend)) delete backend[k];
  });

  it('boots on the bundled English because no tenant is known yet', () => {
    expect(i18nProvider.translate('app.fields.sla')).toBe('SLA');
  });

  it('loads the backend English strings once the tenant is known', async () => {
    backend['app.fields.sla'] = 'SLA (from backend)';
    (digitClient as { stateTenantId: string }).stateTenantId = 'ke';
    await refreshTranslations();
    expect(i18nProvider.translate('app.fields.sla')).toBe('SLA (from backend)');
  });

  it('a forced refresh bypasses the 24h cache, so an admin edit shows at once', async () => {
    backend['app.fields.sla'] = 'SLA';
    await refreshTranslations({ force: true });
    expect(i18nProvider.translate('app.fields.sla')).toBe('SLA');

    backend['app.fields.sla'] = 'Default SLA';
    // Unforced: the localStorage cache written above still wins.
    await refreshTranslations();
    expect(i18nProvider.translate('app.fields.sla')).toBe('SLA');
    // Forced (what a Localization write triggers): the edit is picked up.
    await refreshTranslations({ force: true });
    expect(i18nProvider.translate('app.fields.sla')).toBe('Default SLA');
  });
});
