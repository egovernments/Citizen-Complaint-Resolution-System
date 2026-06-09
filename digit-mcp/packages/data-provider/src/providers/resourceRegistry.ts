import { ENDPOINTS } from '../client/endpoints.js';
import { MDMS_SCHEMAS } from '../client/types.js';

export type ResourceType = 'mdms' | 'hrms' | 'boundary' | 'pgr' | 'localization' | 'user' | 'workflow-bs' | 'workflow-process' | 'access-role' | 'access-action' | 'mdms-schema' | 'boundary-hierarchy';

export interface ResourceConfig {
  type: ResourceType;
  label: string;
  schema?: string;
  idField: string;
  nameField: string;
  descriptionField?: string;
  endpoint?: {
    search: string;
    create?: string;
    update?: string;
  };
  dedicated?: boolean;
}

export const REGISTRY: Record<string, ResourceConfig> = {
  // Dedicated Resources
  tenants: {
    type: 'mdms', label: 'Tenants', schema: MDMS_SCHEMAS.TENANT,
    idField: 'code', nameField: 'name', descriptionField: 'description', dedicated: true,
  },
  departments: {
    type: 'mdms', label: 'Departments', schema: MDMS_SCHEMAS.DEPARTMENT,
    idField: 'code', nameField: 'name', descriptionField: 'description', dedicated: true,
  },
  designations: {
    type: 'mdms', label: 'Designations', schema: MDMS_SCHEMAS.DESIGNATION,
    idField: 'code', nameField: 'name', descriptionField: 'description', dedicated: true,
  },
  'complaint-types': {
    type: 'mdms', label: 'Complaint Types', schema: 'RAINMAKER-PGR.ServiceDefs',
    idField: 'serviceCode', nameField: 'serviceName', descriptionField: 'department', dedicated: true,
  },
  employees: {
    type: 'hrms', label: 'Employees', idField: 'uuid', nameField: 'name', descriptionField: 'designation',
    endpoint: { search: ENDPOINTS.HRMS_EMPLOYEES_SEARCH, create: ENDPOINTS.HRMS_EMPLOYEES_CREATE, update: ENDPOINTS.HRMS_EMPLOYEES_UPDATE },
    dedicated: true,
  },
  boundaries: {
    type: 'boundary', label: 'Boundaries', idField: 'code', nameField: 'name', descriptionField: 'boundaryType',
    endpoint: { search: ENDPOINTS.BOUNDARY_SEARCH, create: ENDPOINTS.BOUNDARY_CREATE },
    dedicated: true,
  },
  complaints: {
    type: 'pgr', label: 'Complaints', idField: 'serviceRequestId', nameField: 'serviceRequestId',
    descriptionField: 'description', dedicated: true,
  },
  localization: {
    type: 'localization', label: 'Localization Messages', idField: 'code', nameField: 'code',
    descriptionField: 'message',
    endpoint: { search: ENDPOINTS.LOCALIZATION_SEARCH, create: ENDPOINTS.LOCALIZATION_UPSERT },
    dedicated: true,
  },
  users: {
    type: 'user', label: 'Users', idField: 'uuid', nameField: 'userName',
    descriptionField: 'name', dedicated: true,
  },
  'workflow-business-services': {
    type: 'workflow-bs', label: 'Workflow Business Services', idField: 'businessService',
    nameField: 'businessService', descriptionField: 'business', dedicated: true,
  },
  'workflow-processes': {
    type: 'workflow-process', label: 'Workflow Processes', idField: 'id',
    nameField: 'businessId', descriptionField: 'action', dedicated: true,
  },
  'access-roles': {
    type: 'access-role', label: 'Access Roles', idField: 'code',
    nameField: 'name', descriptionField: 'description', dedicated: true,
  },
  'access-actions': {
    type: 'access-action', label: 'Access Actions', idField: 'id',
    nameField: 'displayName', descriptionField: 'url', dedicated: true,
  },
  'mdms-schemas': {
    type: 'mdms-schema', label: 'MDMS Schemas', idField: 'code',
    nameField: 'code', descriptionField: 'description', dedicated: true,
  },
  'boundary-hierarchies': {
    type: 'boundary-hierarchy', label: 'Boundary Hierarchies', idField: 'hierarchyType',
    nameField: 'hierarchyType', dedicated: true,
  },

  // Generic MDMS Resources
  'state-info': { type: 'mdms', label: 'State Info', schema: 'common-masters.StateInfo', idField: 'code', nameField: 'name' },
  branding: { type: 'mdms', label: 'Tenant Branding', schema: 'tenant.branding', idField: 'code', nameField: 'name' },
  'city-modules': { type: 'mdms', label: 'City Modules', schema: 'tenant.citymodule', idField: 'code', nameField: 'module' },
  'id-formats': { type: 'mdms', label: 'ID Formats', schema: 'common-masters.IdFormat', idField: 'idname', nameField: 'idname' },
  'workflow-services': { type: 'mdms', label: 'Business Services', schema: 'Workflow.BusinessService', idField: 'businessService', nameField: 'business' },
  'workflow-config': { type: 'mdms', label: 'Workflow Config', schema: 'Workflow.BusinessServiceConfig', idField: 'code', nameField: 'code' },
  'auto-escalation': { type: 'mdms', label: 'Auto Escalation', schema: 'Workflow.AutoEscalation', idField: 'businessService', nameField: 'businessService' },
  'sla-config': { type: 'mdms', label: 'SLA Config', schema: 'common-masters.wfSlaConfig', idField: 'slotPercentage', nameField: 'slotPercentage' },
  'role-actions': { type: 'mdms', label: 'Role Actions', schema: 'ACCESSCONTROL-ROLEACTIONS.roleactions', idField: 'id', nameField: 'rolecode', descriptionField: 'actionid' },
  roles: { type: 'mdms', label: 'Roles', schema: MDMS_SCHEMAS.ROLES, idField: 'code', nameField: 'name', descriptionField: 'description' },
  'action-mappings': { type: 'mdms', label: 'Action Mappings', schema: 'ACCESSCONTROL-ACTIONS-TEST.actions-test', idField: 'id', nameField: 'displayName', descriptionField: 'url' },
  'encryption-policy': { type: 'mdms', label: 'Encryption Policy', schema: 'DataSecurity.EncryptionPolicy', idField: 'key', nameField: 'key' },
  'decryption-abac': { type: 'mdms', label: 'Decryption ABAC', schema: 'DataSecurity.DecryptionABAC', idField: 'model', nameField: 'model' },
  'masking-patterns': { type: 'mdms', label: 'Masking Patterns', schema: 'DataSecurity.MaskingPatterns', idField: 'patternId', nameField: 'patternId' },
  'security-policy': { type: 'mdms', label: 'Security Policy', schema: 'DataSecurity.SecurityPolicy', idField: 'model', nameField: 'model' },
  'inbox-config': { type: 'mdms', label: 'Inbox Config', schema: 'INBOX.InboxQueryConfiguration', idField: 'module', nameField: 'module' },
  'deactivation-reasons': { type: 'mdms', label: 'Deactivation Reasons', schema: 'egov-hrms.DeactivationReason', idField: 'code', nameField: 'code' },
  degrees: { type: 'mdms', label: 'Degrees', schema: 'egov-hrms.Degree', idField: 'code', nameField: 'code' },
  'employment-tests': { type: 'mdms', label: 'Employment Tests', schema: 'egov-hrms.EmploymentTest', idField: 'code', nameField: 'code' },
  specializations: { type: 'mdms', label: 'Specializations', schema: 'egov-hrms.Specalization', idField: 'code', nameField: 'code' },
  'gender-types': { type: 'mdms', label: 'Gender Types', schema: MDMS_SCHEMAS.GENDER_TYPE, idField: 'code', nameField: 'code' },
  'employee-status': { type: 'mdms', label: 'Employee Status', schema: MDMS_SCHEMAS.EMPLOYEE_STATUS, idField: 'code', nameField: 'code' },
  'employee-type': { type: 'mdms', label: 'Employee Type', schema: MDMS_SCHEMAS.EMPLOYEE_TYPE, idField: 'code', nameField: 'code' },
  'cron-jobs': { type: 'mdms', label: 'Cron Jobs', schema: 'common-masters.CronJobAPIConfig', idField: 'jobName', nameField: 'jobName' },
  'ui-homepage': { type: 'mdms', label: 'UI Homepage', schema: 'common-masters.uiHomePage', idField: 'redirectURL', nameField: 'redirectURL' },
};

export function getResourceConfig(resource: string): ResourceConfig | undefined {
  return REGISTRY[resource];
}

export function getAllResources(): Record<string, ResourceConfig> {
  return { ...REGISTRY };
}

export function getDedicatedResources(): Record<string, ResourceConfig> {
  const result: Record<string, ResourceConfig> = {};
  for (const [name, config] of Object.entries(REGISTRY)) {
    if (config.dedicated) result[name] = config;
  }
  return result;
}

export function getMdmsResources(): Record<string, ResourceConfig> {
  const result: Record<string, ResourceConfig> = {};
  for (const [name, config] of Object.entries(REGISTRY)) {
    if (config.type === 'mdms') result[name] = config;
  }
  return result;
}

export function getGenericMdmsResources(): Record<string, ResourceConfig> {
  const result: Record<string, ResourceConfig> = {};
  for (const [name, config] of Object.entries(REGISTRY)) {
    if (config.type === 'mdms' && !config.dedicated) result[name] = config;
  }
  return result;
}

export function getResourceIdField(resource: string): string {
  return REGISTRY[resource]?.idField ?? 'id';
}

export function getResourceLabel(resource: string): string {
  if (REGISTRY[resource]) return REGISTRY[resource].label;
  return resource.charAt(0).toUpperCase() + resource.slice(1);
}

export function getResourceBySchema(schemaCode: string): string | undefined {
  for (const [name, config] of Object.entries(REGISTRY)) {
    if (config.schema === schemaCode) return name;
  }
  return undefined;
}
