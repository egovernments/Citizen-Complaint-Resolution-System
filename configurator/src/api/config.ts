// DIGIT Environment Configuration

/** Auto-detect API base URL from the current origin. Each deployment serves
 *  the configurator and DIGIT APIs from the same domain via nginx. */
export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') return window.location.origin;
  return 'https://localhost';
}

// Service endpoints
export const ENDPOINTS = {
  // Authentication
  AUTH: '/user/oauth/token',
  USER_SEARCH: '/user/_search',

  // MDMS
  MDMS_SEARCH: '/mdms-v2/v2/_search',
  MDMS_CREATE: '/mdms-v2/v2/_create',
  MDMS_SCHEMA_SEARCH: '/mdms-v2/schema/v1/_search',
  MDMS_SCHEMA_CREATE: '/mdms-v2/schema/v1/_create',

  // User (for tenant bootstrap)
  USER_CREATE: '/user/users/_createnovalidate',

  // Workflow (for tenant bootstrap — PGR state machine clone)
  WORKFLOW_BS_SEARCH: '/egov-workflow-v2/egov-wf/businessservice/_search',
  WORKFLOW_BS_CREATE: '/egov-workflow-v2/egov-wf/businessservice/_create',

  // Boundary
  BOUNDARY_SEARCH: '/boundary-service/boundary/_search',
  BOUNDARY_HIERARCHY_SEARCH: '/boundary-service/boundary-hierarchy-definition/_search',
  BOUNDARY_HIERARCHY_CREATE: '/boundary-service/boundary-hierarchy-definition/_create',
  BOUNDARY_CREATE: '/boundary-service/boundary/_create',
  BOUNDARY_RELATIONSHIP_CREATE: '/boundary-service/boundary-relationships/_create',
  BOUNDARY_RELATIONSHIP_SEARCH: '/boundary-service/boundary-relationships/_search',

  // HRMS
  // KEEP IN SYNC with packages/data-provider/src/client/endpoints.ts
  HRMS_EMPLOYEES_SEARCH: '/egov-hrms/employees/_search',
  HRMS_EMPLOYEES_CREATE: '/egov-hrms/employees/_create',
  HRMS_EMPLOYEES_UPDATE: '/egov-hrms/employees/_update',

  // Localization
  LOCALIZATION_SEARCH: '/localization/messages/v1/_search',
  LOCALIZATION_UPSERT: '/localization/messages/v1/_upsert',
  // Localization service caches per-tenant in memory; without this call
  // after a write, `_search` (and the digit-ui's localStorage cache) keep
  // returning the pre-write snapshot until restart.
  LOCALIZATION_CACHE_BUST: '/localization/messages/cache-bust',

  // Filestore
  FILESTORE_UPLOAD: '/filestore/v1/files',
  FILESTORE_URL: '/filestore/v1/files/url',
};

// MDMS Schema codes
export const MDMS_SCHEMAS = {
  DEPARTMENT: 'common-masters.Department',
  DESIGNATION: 'common-masters.Designation',
  GENDER_TYPE: 'common-masters.GenderType',
  EMPLOYEE_STATUS: 'egov-hrms.EmployeeStatus',
  EMPLOYEE_TYPE: 'egov-hrms.EmployeeType',
  ROLES: 'ACCESSCONTROL-ROLES.roles',
  PGR_SERVICE_DEFS: 'RAINMAKER-PGR.ServiceDefs',
  TENANT: 'tenant.tenants',
};

// OAuth credentials
export const OAUTH_CONFIG = {
  clientId: 'egov-user-client',
  clientSecret: '',
  grantType: 'password',
  scope: 'read',
};

// Max boundary entities to pull in a single /boundary/_search.
//
// boundary-service limits to be aware of:
//  - The endpoint DEFAULTS to ~50 results even when criteria are supplied,
//    so you must pass an explicit `limit` to get more than a partial set.
//  - It CAPS the page at ~300 — a larger `limit` is clamped server-side, so
//    one request returns at most ~300 entities. A tenant with more boundaries
//    than this needs offset pagination (not done today; the overview map only
//    needs a representative set, and city/county hierarchies are well under).
//
// Configurable so a deployment whose boundary-service raises/lowers the cap
// can match it without a code change: set VITE_BOUNDARY_SEARCH_LIMIT.
export const BOUNDARY_SEARCH_LIMIT: number =
  Number(import.meta.env.VITE_BOUNDARY_SEARCH_LIMIT) || 300;

// Default employee password
export const DEFAULT_PASSWORD = 'eGov@123';
