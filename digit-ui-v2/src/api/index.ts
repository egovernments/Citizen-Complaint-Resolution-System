// Citizen-UI API surface (slim — operator service modules stripped).
export { apiClient, ApiClientError, DigitApiClient } from './client';
export { getApiBaseUrl, ENDPOINTS, OAUTH_CONFIG, DEFAULT_PASSWORD } from './config';
export type { UserInfo, Role } from './types';
