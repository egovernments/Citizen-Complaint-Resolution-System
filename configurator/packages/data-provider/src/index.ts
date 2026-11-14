// Client
export { DigitApiClient, ApiClientError, withCsrRole, inTenant, employeesByCodeInTenant, exactTenantRow } from './client/index.js';
export type { DigitApiClientConfig } from './client/index.js';
export { ENDPOINTS, OAUTH_CONFIG, MDMS_SCHEMAS } from './client/index.js';
export type {
  RequestInfo, UserInfo, Role, MdmsRecord, ApiError,
  Environment, ErrorCategory,
} from './client/index.js';

// Resource registry
export {
  REGISTRY, getResourceConfig, getAllResources,
  getDedicatedResources, getMdmsResources, getGenericMdmsResources,
  getResourceIdField, getResourceLabel, getResourceBySchema,
  isAccessControlGated, isReadOnlyResource, readOnlyNoticeFor, LEGACY_NOTIFICATION_NOTICE,
} from './providers/resourceRegistry.js';
export type { ResourceConfig, ResourceType } from './providers/resourceRegistry.js';

// react-admin providers (optional peer dep on ra-core)
export { createDigitDataProvider, DUPLICATE_ACTIVE_KEYS } from './providers/dataProvider.js';
export type { DigitDataProvider } from './providers/dataProvider.js';
export { createDigitAuthProvider } from './providers/authProvider.js';
export type { DigitPermissions } from './providers/authProvider.js';
export type { MastersCapability } from './providers/accessPolicy.js';
// which tenants below a state override its county-scoped rows / boundary tree
export { countyOverrides, boundaryTreeOverrides, countyScopedKey, isCountyScoped, countiesOf, COUNTY_SCOPED_KEYS } from './providers/countyScoped.js';
export type { CountyOverride } from './providers/countyScoped.js';
