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

  // Citizen self-service (OTP-based).
  // /user-otp/v1/_send is fronted by Kong's request-termination plugin and
  // returns 200 unconditionally — no real OTP is sent. egov-user has
  // CITIZEN_LOGIN_PASSWORD_OTP_FIXED_ENABLED=true (value 123456), so the
  // citizen login flow is fixed-OTP-mocked end-to-end on this deploy.
  OTP_SEND: '/user-otp/v1/_send',
  CITIZEN_REGISTER: '/user/citizen/_create',

  // MDMS
  MDMS_SEARCH: '/mdms-v2/v2/_search',
  MDMS_CREATE: '/mdms-v2/v2/_create',

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

// Default employee password
export const DEFAULT_PASSWORD = 'eGov@123';
