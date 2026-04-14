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
import { clearTranslationCache } from './i18nProvider';

// Re-export registry functions so the rest of the app imports from one place
export {
  getResourceConfig,
  getAllResources,
  getDedicatedResources,
  getGenericMdmsResources,
  getResourceIdField,
  getResourceLabel,
  getResourceBySchema,
  REGISTRY,
} from '@digit-mcp/data-provider';
export type { ResourceConfig } from '@digit-mcp/data-provider';

// Singleton client -- mirrors the existing apiClient pattern.
// Created with an empty URL; configured later when the user logs in
// or when auth is restored from localStorage.
export let digitClient = new DigitApiClient({ url: '' });

// Cached providers -- recreated when tenant changes
let _dataProvider: DataProvider | null = null;
let _dataProviderTenant: string = '';
let _authProvider: AuthProvider | null = null;

export function getDataProvider(tenantId: string): DataProvider {
  if (!_dataProvider || _dataProviderTenant !== tenantId) {
    _dataProvider = createDigitDataProvider(digitClient, tenantId);
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

/**
 * Configure the digitClient with environment URL, auth, and tenant.
 * Since DigitApiClient.baseUrl is private, we create a new instance
 * when the URL changes and transfer the auth state.
 */
export function configureDigitClient(url: string, token?: string, user?: UserInfo, stateTenant?: string): void {
  // Check if URL changed -- if so, we need a new client instance
  const currentInfo = digitClient.getAuthInfo();
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
}
