// DIGIT Environment Configuration

export interface Environment {
  name: string;
  url: string;
  description: string;
}

export const ENVIRONMENTS: Environment[] = [
  {
    name: 'Development',
    url: 'https://unified-dev.digit.org',
    description: 'Development environment',
  },
  {
    name: 'Staging',
    url: 'https://staging.digit.org',
    description: 'Staging environment',
  },
  {
    name: 'UAT',
    url: 'https://uat.digit.org',
    description: 'User Acceptance Testing',
  },
];

// Service endpoints
export const ENDPOINTS = {
  // Authentication
  AUTH: '/user/oauth/token',
  USER_SEARCH: '/user/_search',

  // MDMS
  MDMS_SEARCH: '/egov-mdms-service/v2/_search',
  MDMS_CREATE: '/egov-mdms-service/v2/_create',

  // Boundary
  BOUNDARY_SEARCH: '/boundary-service/boundary/_search',
  BOUNDARY_HIERARCHY_SEARCH: '/boundary-service/boundary-hierarchy-definition/_search',
  BOUNDARY_HIERARCHY_CREATE: '/boundary-service/boundary-hierarchy-definition/_create',
  BOUNDARY_CREATE: '/boundary-service/boundary/_create',

  // HRMS
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
  PGR_SERVICE_DEFS: 'RAINMAKER_PGR.ServiceDefs',
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

// Common roles for PGR/CRS
export const PGR_ROLES = [
  { code: 'EMPLOYEE', name: 'Employee', description: 'Basic employee role' },
  { code: 'PGR_LME', name: 'Last Mile Employee', description: 'Handles complaints on ground' },
  { code: 'GRO', name: 'Grievance Routing Officer', description: 'Routes complaints to departments' },
  { code: 'PGR_ADMIN', name: 'PGR Administrator', description: 'Admin access to PGR module' },
  { code: 'SUPERUSER', name: 'Super User', description: 'Full system access' },
];
