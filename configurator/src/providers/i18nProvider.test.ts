import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A founder on /signup has no session tenant yet. The deploy seeds the configurator-ui bundle at
 * the root tenant config.js names, so translations come from there, and never from a 'pg' guess.
 */
const config = vi.hoisted(() => ({ CONFIGURED_STATE_TENANT_ID: '' }));
const client = vi.hoisted(() => ({ stateTenantId: undefined as string | undefined, localizationSearch: vi.fn() }));
vi.mock('@/api/config', () => config);
vi.mock('./bridge', () => ({ digitClient: client }));

async function loadFrench() {
  vi.resetModules();
  const { i18nProvider } = await import('./i18nProvider');
  await i18nProvider.changeLocale('fr_FR');
  return i18nProvider;
}

describe('translations before sign-in', () => {
  beforeEach(() => {
    localStorage.clear();
    client.stateTenantId = undefined;
    client.localizationSearch.mockReset().mockResolvedValue([
      { code: 'app.onboarding.signup.try_again', message: 'Réessayer' },
    ]);
  });

  it("reads the configured root tenant's bundle, without caching it for the session tenant", async () => {
    config.CONFIGURED_STATE_TENANT_ID = 'ke';
    const i18n = await loadFrench();

    expect(client.localizationSearch).toHaveBeenCalledWith('ke', 'fr_FR', 'configurator-ui');
    expect(i18n.translate('app.onboarding.signup.try_again')).toBe('Réessayer');
    expect(Object.keys(localStorage)).toEqual([]);
  });

  it('asks no tenant when config names none', async () => {
    config.CONFIGURED_STATE_TENANT_ID = '';
    await loadFrench();

    expect(client.localizationSearch).not.toHaveBeenCalled();
  });
});
