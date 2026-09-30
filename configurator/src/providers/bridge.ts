/**
 * Bridge module: adapts @digit-mcp/data-provider to the CRS UI's patterns.
 *
 * The CRS UI uses a global apiClient singleton pattern. This bridge creates
 * a DigitApiClient instance and exposes the same interface that the rest of
 * the app expects (getResourceConfig, getAllResources, etc).
 */
import { DigitApiClient, createDigitDataProvider, createDigitAuthProvider } from '@digit-mcp/data-provider';
import type { DataProvider, AuthProvider } from 'ra-core';
import type { UserInfo } from '@digit-mcp/data-provider';
import { clearTranslationCache, refreshTranslations } from './i18nProvider';
import { localizationService } from '@/api/services/localization';

// Re-export registry functions so the rest of the app imports from one place
export {
  getResourceConfig,
  getAllResources,
  getDedicatedResources,
  getGenericMdmsResources,
  getResourceIdField,
  getResourceLabel,
  getResourceBySchema,
  isAccessControlGated,
  REGISTRY,
} from '@digit-mcp/data-provider';
export type { ResourceConfig } from '@digit-mcp/data-provider';
export { DigitApiClient } from '@digit-mcp/data-provider';

// Singleton client -- mirrors the existing apiClient pattern.
// Created with an empty URL; configured later when the user logs in
// or when auth is restored from localStorage.
export let digitClient = new DigitApiClient({ url: '' });

// Cached providers -- recreated when tenant changes
let _dataProvider: DataProvider | null = null;
let _dataProviderTenant: string = '';
let _authProvider: AuthProvider | null = null;

const WRITE_METHODS = ['create', 'update', 'updateMany', 'delete', 'deleteMany'] as const;

/**
 * Localization writes can change the configurator's own UI copy, so refresh
 * its translations as soon as one succeeds — an admin who relabels a string
 * in System → Localization sees it change without waiting out the cache.
 * The service's own cache is busted first: its module-scoped `_search` (the
 * one the configurator reads its strings through) otherwise keeps serving
 * the pre-write snapshot.
 */
async function afterLocalizationWrite(): Promise<void> {
  try {
    await localizationService.cacheBust();
  } catch (e) {
    console.warn('localization cache-bust failed', e);
  }
  await refreshTranslations({ force: true });
}

function withTranslationRefresh(dataProvider: DataProvider): DataProvider {
  const wrapped: Record<string, unknown> = { ...dataProvider };
  for (const method of WRITE_METHODS) {
    const original = dataProvider[method] as (resource: string, params: unknown) => Promise<unknown>;
    wrapped[method] = async (resource: string, params: unknown) => {
      const result = await original(resource, params);
      if (resource === 'localization') void afterLocalizationWrite();
      return result;
    };
  }
  return wrapped as unknown as DataProvider;
}

export function getDataProvider(tenantId: string): DataProvider {
  if (!_dataProvider || _dataProviderTenant !== tenantId) {
    _dataProvider = withTranslationRefresh(createDigitDataProvider(digitClient, tenantId));
    _dataProviderTenant = tenantId;
  }
  return _dataProvider;
}

export function getAuthProvider(): AuthProvider {
  if (!_authProvider) {
    _authProvider = createDigitAuthProvider(digitClient);
  }
  return _authProvider;
}

// Re-export i18n provider
export { i18nProvider, clearTranslationCache } from './i18nProvider';

export function resetProviders(): void {
  _dataProvider = null;
  _dataProviderTenant = '';
  _authProvider = null;
  clearTranslationCache();
}

// Auth-change subscription -- lets anything that derives per-user state (e.g.
// MastersCapabilityProvider's masters visibility/edit capability) refetch
// when the logged-in identity actually changes, rather than only once per
// component mount. Needed because a component consuming digitClient's auth
// can outlive a logout/login cycle in the same tab; relying on remount alone
// previously left one user's capability (e.g. an MDMS_ADMIN's "see
// everything") visible for whoever logged in next.
let authChangeListeners: Array<() => void> = [];

export function onAuthChange(listener: () => void): () => void {
  authChangeListeners.push(listener);
  return () => {
    authChangeListeners = authChangeListeners.filter((l) => l !== listener);
  };
}

function notifyAuthChange(): void {
  authChangeListeners.forEach((listener) => listener());
}

/**
 * Configure the digitClient with environment URL, auth, and tenant.
 * Since DigitApiClient.baseUrl is private, we create a new instance
 * when the URL changes and transfer the auth state.
 */
export function configureDigitClient(url: string, token?: string, user?: UserInfo, stateTenant?: string): void {
  // Check if URL changed -- if so, we need a new client instance
  const currentInfo = digitClient.getAuthInfo();
  const previousTenant = digitClient.stateTenantId;
  const currentUrl = (digitClient as unknown as Record<string, unknown>)['baseUrl'] as string | undefined;

  if (currentUrl !== url) {
    // URL changed, create a fresh client
    digitClient = new DigitApiClient({ url, stateTenantId: stateTenant });
    // Reset cached providers since the client changed
    resetProviders();
  }

  if (stateTenant) {
    digitClient.stateTenantId = stateTenant;
  }

  if (token && user) {
    digitClient.setAuth(token, user);
  } else if (!token && currentInfo.token && currentInfo.user) {
    // Preserve existing auth when only URL/tenant changes
    digitClient.setAuth(currentInfo.token, currentInfo.user);
  }

  notifyAuthChange();

  // The app's own strings are fetched per state tenant; the boot-time fetch
  // ran before one was known, so load them now.
  if (stateTenant && stateTenant !== previousTenant) void refreshTranslations();
}
