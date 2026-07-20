// Citizen-UI API surface (slim — operator service modules stripped).
export { apiClient, ApiClientError, DigitApiClient } from './client';
export {
  getApiBaseUrl,
  getApiBaseUrlWithTokenExchange,
  getOriginBaseUrl,
  ENDPOINTS,
  OAUTH_CONFIG,
  DEFAULT_PASSWORD,
  AUTH_PROVIDER,
  KEYCLOAK_URL,
  KEYCLOAK_REALM,
  KEYCLOAK_CLIENT_ID,
  TOKEN_EXCHANGE_URL,
  KC_STORAGE_KEYS,
  isKeycloakMode,
  hasKcToken,
} from './config';
export type { UserInfo, Role } from './types';
