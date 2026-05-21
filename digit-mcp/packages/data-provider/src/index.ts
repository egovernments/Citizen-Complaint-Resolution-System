// Client
export { DigitApiClient, ApiClientError } from './client/index.js';
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
} from './providers/resourceRegistry.js';
export type { ResourceConfig, ResourceType } from './providers/resourceRegistry.js';

// react-admin providers (optional peer dep on ra-core)
export { createDigitDataProvider } from './providers/dataProvider.js';
export type { DigitDataProvider } from './providers/dataProvider.js';
export { createDigitAuthProvider } from './providers/authProvider.js';
