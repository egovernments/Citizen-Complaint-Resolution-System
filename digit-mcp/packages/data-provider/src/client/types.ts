/** Error categories for agent-friendly error handling */
export type ErrorCategory = 'validation' | 'auth' | 'api' | 'internal';

/** Standard DIGIT request envelope */
export interface RequestInfo {
  apiId: string;
  ver?: string;
  ts?: number;
  action?: string;
  did?: string;
  key?: string;
  msgId: string;
  authToken: string;
  userInfo?: UserInfo;
}

/** Authenticated user info */
export interface UserInfo {
  id?: number;
  uuid?: string;
  userName: string;
  name: string;
  mobileNumber?: string;
  emailId?: string;
  type?: string;
  tenantId: string;
  roles?: Role[];
}

/** DIGIT role assignment */
export interface Role {
  code: string;
  name: string;
  tenantId?: string;
  description?: string;
}

/** Raw MDMS v2 record envelope */
export interface MdmsRecord {
  id: string;
  tenantId: string;
  schemaCode: string;
  uniqueIdentifier: string;
  data: Record<string, unknown>;
  isActive: boolean;
  auditDetails?: {
    createdBy: string;
    createdTime: number;
    lastModifiedBy: string;
    lastModifiedTime: number;
  };
}

/** API error from DIGIT services */
export interface ApiError {
  code: string;
  message: string;
  description?: string;
}

/** Environment configuration */
export interface Environment {
  name: string;
  url: string;
  stateTenantId: string;
  description?: string;
  /** Endpoint path overrides, keyed by ENDPOINTS constant names */
  endpointOverrides?: Record<string, string>;
}

/** Well-known MDMS schema codes */
export const MDMS_SCHEMAS = {
  DEPARTMENT: 'common-masters.Department',
  DESIGNATION: 'common-masters.Designation',
  GENDER_TYPE: 'common-masters.GenderType',
  EMPLOYEE_STATUS: 'egov-hrms.EmployeeStatus',
  EMPLOYEE_TYPE: 'egov-hrms.EmployeeType',
  ROLES: 'ACCESSCONTROL-ROLES.roles',
  PGR_SERVICE_DEFS: 'RAINMAKER-PGR.ServiceDefs',
  TENANT: 'tenant.tenants',
} as const;
