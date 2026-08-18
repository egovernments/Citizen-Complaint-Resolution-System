// DIGIT Environment Configuration

import { resolveConfig, resolvePositiveNumber } from './runtimeConfig';

/** Auto-detect API base URL from the current origin. Each deployment serves
 *  the configurator and DIGIT APIs from the same domain via nginx. */
export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') return window.location.origin;
  return 'https://localhost';
}

// Root (state-level) tenant the deployment is configured for.
//
// Resolved at RUNTIME from `<base>/config.js` (`window.__CONFIGURATOR_CONFIG__`,
// rendered per-tenant by the ansible deploy from host_vars `state_tenant_id`),
// falling back to the build-time `VITE_STATE_TENANT_ID` so dev and any
// build-with-env workflow are unchanged. See ./runtimeConfig.ts for why this
// moved off build-time-only. A city tenant like "mz.maputo" collapses to its
// root segment "mz".
//
// Defaults to 'pg' — the tenant the seed dump always creates — so an
// unconfigured deployment points at something that exists rather than leaving
// the login form's tenant field blank. This mirrors the other three settings,
// which have always had in-code defaults (public Overpass, '/turbopass', 300);
// STATE_TENANT_ID was the only one without, which is why a blank config.js used
// to mean "retype the tenant on every login".
export const DEFAULT_STATE_TENANT_ID = 'pg';
export const STATE_TENANT_ID: string =
  resolveConfig('STATE_TENANT_ID', import.meta.env.VITE_STATE_TENANT_ID) ||
  DEFAULT_STATE_TENANT_ID;

/** Root (state) tenant code for this deployment, e.g. "mz". A city code
 *  collapses to its root segment. Never empty: falls back to
 *  DEFAULT_STATE_TENANT_ID ('pg', the tenant the seed dump always creates). */
export function getConfiguredRootTenant(): string {
  return STATE_TENANT_ID.split('.')[0];
}

// Service endpoints
export const ENDPOINTS = {
  // Authentication
  AUTH: '/user/oauth/token',
  USER_SEARCH: '/user/_search',

  // MDMS
  MDMS_SEARCH: '/mdms-v2/v2/_search',
  MDMS_CREATE: '/mdms-v2/v2/_create',
  MDMS_UPDATE: '/mdms-v2/v2/_update',
  MDMS_SCHEMA_SEARCH: '/mdms-v2/schema/v1/_search',
  MDMS_SCHEMA_CREATE: '/mdms-v2/schema/v1/_create',
  ANALYTICS_CONFIG_REFRESH: '/pgr-services/v2/analytics/config/_refresh',

  // User (for tenant bootstrap)
  USER_CREATE: '/user/users/_createnovalidate',

  // Encryption (for tenant bootstrap — register a new tenant with egov-enc-service
  // before any encrypt/decrypt call targets it; see tenantBootstrap.ts)
  ENC_GENERATE_KEY: '/egov-enc-service/crypto/v1/_generatekey',

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
  // 2-master complaint hierarchy: the single adjacency-list master holding
  // both interior classification nodes AND leaf complaint types. The old
  // RAINMAKER-PGR.ServiceDefs / .ClassificationNode masters are gone.
  COMPLAINT_HIERARCHY: 'RAINMAKER-PGR.ComplaintHierarchy',
  TENANT: 'tenant.tenants',
  MAP_CONFIG: 'RAINMAKER-PGR.MapConfig',
  DASHBOARD_CONFIG: 'dss.DashboardConfig',
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
// can match it without a code change: set BOUNDARY_SEARCH_LIMIT in config.js
// (or the build-time VITE_BOUNDARY_SEARCH_LIMIT).
//
// The 300 below is applied by resolvePositiveNumber only when the configured
// value is blank, non-numeric, or non-positive — NOT by `|| 300`, which would
// also swallow a deliberately-configured 0 and quietly contradict the
// documented precedence. 0/negatives are still rejected, but explicitly: this
// is a page size, so asking boundary-service for 0 entities yields an empty
// overview map, which no operator means by "set the limit". See
// resolvePositiveNumber in ./runtimeConfig.
export const DEFAULT_BOUNDARY_SEARCH_LIMIT = 300;
export const BOUNDARY_SEARCH_LIMIT: number = resolvePositiveNumber(
  resolveConfig('BOUNDARY_SEARCH_LIMIT', import.meta.env.VITE_BOUNDARY_SEARCH_LIMIT),
  DEFAULT_BOUNDARY_SEARCH_LIMIT,
);

// Default employee password
export const DEFAULT_PASSWORD = 'eGov@123';
