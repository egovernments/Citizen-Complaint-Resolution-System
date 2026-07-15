import { ENDPOINTS } from '../client/endpoints.js';
import { MDMS_SCHEMAS } from '../client/types.js';

export type ResourceType = 'mdms' | 'hrms' | 'boundary' | 'pgr' | 'localization' | 'user' | 'workflow-bs' | 'workflow-process' | 'access-role' | 'access-action' | 'mdms-schema' | 'boundary-hierarchy'
  // 'custom' resources are NOT MDMS-backed. They are read-only lists fetched
  // from an out-of-band DIGIT service (today: the novu-bridge read proxy) via
  // a plain GET to `endpoint.search`, using the same DIGIT auth token the rest
  // of the provider carries. The data provider maps react-admin filters onto
  // query params and returns the service's {data,total} envelope verbatim.
  | 'custom';

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
  /** For `type: 'custom'` resources only: the origin-relative path of the
   *  read-only GET endpoint on the out-of-band service (e.g.
   *  `/novu-bridge/novu-adapter/v1/logs`). The data provider prefixes it with
   *  the current origin and attaches the DIGIT Bearer token. Routed by Kong
   *  (local-setup/kong/kong.yml); novu-bridge validates the Bearer token
   *  server-side against egov-user /user/_details and masks recipient PII in
   *  responses. */
  customPath?: string;
  /** For `type: 'custom'` resources: when true, the fetcher appends the session
   *  tenantId as a `tenantId` query param (the novu-bridge /logs endpoint
   *  requires it). Providers/integrations don't take a tenant, so omit it. */
  customTenantScoped?: boolean;
  /** 2-master complaint hierarchy: when set, the MDMS fetcher keeps only the
   *  LEAF rows of RAINMAKER-PGR.ComplaintHierarchy (rows carrying `department`
   *  or `slaHours`) and maps each to the legacy ServiceDefs shape
   *  (serviceCode/menuPath/menuPathName from parentCode) so downstream
   *  complaint-type UI keeps working unchanged. */
  leafServiceDefAdapter?: boolean;
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
  // Complaint types are now the LEAF rows of the single ComplaintHierarchy
  // adjacency-list master (interior nodes share the same schema). The fetcher
  // filters to leaves and maps each to the legacy ServiceDefs shape, so the
  // dedicated complaint-type List/Show/Edit/Create and the complaint pickers
  // keep reading `serviceCode`/`department`/`slaHours` unchanged. idField is
  // the leaf row's `code` (== the serviceCode stored verbatim on a complaint).
  'complaint-hierarchy': {
    type: 'mdms', label: 'Complaint Types', schema: 'RAINMAKER-PGR.ComplaintHierarchy',
    idField: 'code', nameField: 'name', descriptionField: 'levelCode',
    dedicated: true, leafServiceDefAdapter: true,
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
  // Complaint classification hierarchy (configurable N levels) — dedicated Create
  // uses a custom level editor; backed by a plain MDMS master.
  'complaint-hierarchies': {
    type: 'mdms', label: 'Complaint Hierarchies', schema: 'RAINMAKER-PGR.ComplaintHierarchyDefinition',
    idField: 'hierarchyType', nameField: 'hierarchyType', dedicated: true,
  },

  // Generic MDMS Resources
  // (RAINMAKER-PGR.ClassificationNode is gone — interior nodes now live in the
  // ComplaintHierarchy master alongside the leaves; cascade pickers read it
  // directly. No standalone classification-nodes resource anymore.)
  'state-info': { type: 'mdms', label: 'State Info', schema: 'common-masters.StateInfo', idField: 'code', nameField: 'name' },
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

  // Added by Stage-0 registry hygiene: schemas live on `ke` but had no UI surface.
  // These get the same generic CRUD as the entries above; richer per-field widgets
  // are layered on later via src/admin/schemaDescriptors/ (Stage 1+).
  'theme-config':           { type: 'mdms', label: 'Theme Config',             schema: 'common-masters.ThemeConfig',               idField: 'code',              nameField: 'name' },
  'mobile-number-validation': { type: 'mdms', label: 'Mobile Number Validation', schema: 'common-masters.MobileNumberValidation', idField: 'countryCode',       nameField: 'countryCode' },
  'tenant-boundary':        { type: 'mdms', label: 'Tenant Boundary (HRMS)',   schema: 'egov-location.TenantBoundary',             idField: 'hierarchyType.code', nameField: 'hierarchyType.code' },
  'auto-escalation-ignore': { type: 'mdms', label: 'Auto-Escalation Ignored',  schema: 'Workflow.AutoEscalationStatesToIgnore',    idField: 'businessService',   nameField: 'businessService' },
  'workflow-bs-master':     { type: 'mdms', label: 'Workflow BS Master',       schema: 'Workflow.BusinessServiceMasterConfig',     idField: 'active',            nameField: 'businessService' },
  'pgr-ui-constants':       { type: 'mdms', label: 'PGR UI Constants',         schema: 'RAINMAKER-PGR.UIConstants',                idField: 'REOPENSLA',         nameField: 'REOPENSLA' },
  // Composite-key masters: react-admin id comes from the MDMS uniqueIdentifier
  // (see mapMdmsRecord), so idField/nameField here are display-only.
  'notification-routing':   { type: 'mdms', label: 'PGR Notification Routing',  schema: 'RAINMAKER-PGR.NotificationRouting',  idField: 'action', nameField: 'action' },
  'notification-template':  { type: 'mdms', label: 'PGR Notification Templates', schema: 'RAINMAKER-PGR.NotificationTemplate', idField: 'action', nameField: 'action' },
  // Provider-scoped external template mapping (e.g. Twilio WhatsApp ContentSids +
  // ordered variables + per-locale approval). Surfaces the localization linkage:
  // each row carries `locale` and `approvalStatus`, so an operator sees which
  // (provider, channel, key, locale) templates are approved and sendable.
  'notification-provider-template': { type: 'mdms', label: 'PGR Provider Templates', schema: 'RAINMAKER-PGR.NotificationProviderTemplate', idField: 'action', nameField: 'templateName' },

  // Non-MDMS, read-only resources served by the novu-bridge proxy (not egov-mdms).
  // Routed by Kong (local-setup/kong/kong.yml); novu-bridge validates the Bearer
  // token server-side against egov-user /user/_details and masks recipient PII.
  // notification-log      -> GET /novu-bridge/novu-adapter/v1/logs         (nb_dispatch_log delivery logs)
  // notification-provider -> GET /novu-bridge/novu-adapter/v1/integrations (Novu integrations, allowlisted fields only)
  'notification-log': {
    type: 'custom', label: 'Notification Logs', idField: 'transactionId', nameField: 'referenceNumber',
    descriptionField: 'status', dedicated: true,
    customPath: '/novu-bridge/novu-adapter/v1/logs', customTenantScoped: true,
  },
  'notification-provider': {
    type: 'custom', label: 'Notification Providers', idField: '_id', nameField: 'providerId',
    descriptionField: 'channel', dedicated: true,
    customPath: '/novu-bridge/novu-adapter/v1/integrations', customTenantScoped: false,
  },
  // notification-preference -> GET /novu-bridge/novu-adapter/v1/preferences
  // (per-user consent per channel + preferredLanguage; same {data,total} envelope
  // as integrations). Keyed by the row's `userId`, which is always present, so
  // react-admin gets a stable id straight from the response. Tenant-scoped like
  // notification-log: the backend's tenantId query param is optional, but
  // omitting it returns CROSS-TENANT rows (capped at 100), so the screen leaked
  // other tenants' preferences and could miss the session tenant's own.
  'notification-preference': {
    type: 'custom', label: 'User Preferences', idField: 'userId', nameField: 'userId',
    descriptionField: 'preferredLanguage', dedicated: true,
    customPath: '/novu-bridge/novu-adapter/v1/preferences', customTenantScoped: true,
  },
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
