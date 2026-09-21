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
  /** MDMS masters the backend reads ONLY at the state root (pgr-services notification
   *  masters, novu-bridge channel policy). Reads and writes go to the state tenant
   *  regardless of the session tenant, so a city-scoped operator can never author rows
   *  nothing reads. */
  stateLevel?: boolean;
  /** Listable, showable, NOT writable — no create/edit/delete affordance anywhere in
   *  the UI (`useMastersCapability.canEditResource` returns false for these, which is
   *  the single choke point the list/show/edit screens already consult).
   *
   *  Used for a master whose configuration has MOVED: the rows are still the live
   *  configuration on a tenant that has not been migrated, so hiding them would be a
   *  lie, but editing them would leave the tenant with two answers to "what is
   *  configured". Rows are never deleted — the resource disappears one release later. */
  readOnly?: boolean;
  /** Shown as a banner on a read-only resource's list and show screens. Says where the
   *  configuration moved to and what to run; never just "this is read-only". */
  readOnlyNotice?: string;
}

/**
 * Shown on every legacy notification master. It has to answer three questions at
 * once: where did the configuration go, is THIS tenant still using these rows,
 * and what do I run to move it.
 */
export const LEGACY_NOTIFICATION_NOTICE =
  'Notification configuration has moved to the shared NOTIFICATIONS.* masters, which every module uses — see Notifications → Configure. '
  + 'These rows are kept and still read by the notification service on a tenant whose copy step has not run yet, so they are shown here, '
  + 'read-only; they are never deleted. To move them, re-run the notification seed step (./deploy.sh <tenant> --tags notifications): it '
  + 'copies what this tenant actually has, is additive, and leaves these rows untouched.';

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
    // `schema` here is a masters-visibility policy key only (see
    // docs/design/masters-configurator-access-policy-design.md §3.2) — this
    // resource still fetches via the accesscontrol role API (`type:
    // 'access-role'`), not a raw MDMS schemaCode search; `config.type` gates
    // every fetch branch in dataProvider.ts before `config.schema` is ever
    // read, so adding it here does not change how this resource is fetched.
    schema: MDMS_SCHEMAS.ROLES,
  },
  'access-actions': {
    type: 'access-action', label: 'Access Actions', idField: 'id',
    nameField: 'displayName', descriptionField: 'url', dedicated: true,
    // Policy key only — see the comment on 'access-roles' above.
    schema: 'ACCESSCONTROL-ACTIONS-TEST.actions-test',
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
  // Analytics destinations for the citizen/employee SPA (one row per destination).
  //
  // `dedicated: true` is load-bearing here, not cosmetic. The generic MDMS CRUD
  // would be actively unsafe for this master: dataProvider's update and delete
  // both re-resolve the record with a mdmsSearch that is NOT scoped to the
  // session tenant, so a city admin editing a row INHERITED from the state
  // tenant would rewrite the state row for every city that inherits it, and one
  // delete click would deactivate analytics everywhere. The dedicated editor
  // writes only rows the current tenant owns and never deletes — turning a
  // destination off is `enabled: false` on a permanent record.
  'analytics-providers': {
    type: 'mdms', label: 'Analytics Providers', schema: 'common-masters.AnalyticsProvider',
    idField: 'code', nameField: 'code', descriptionField: 'type', dedicated: true,
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
  // Generic workflow escalation remains for non-PGR products such as IM/TL.
  // PGR uses the dedicated self-loop policy below; operators must not add PGR here.
  'auto-escalation': { type: 'mdms', label: 'Workflow Auto Escalation (non-PGR)', schema: 'Workflow.AutoEscalation', idField: 'businessService', nameField: 'businessService' },
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
  'auto-escalation-ignore': { type: 'mdms', label: 'Workflow Escalation Ignore (non-PGR)', schema: 'Workflow.AutoEscalationStatesToIgnore', idField: 'businessService', nameField: 'businessService' },
  'workflow-bs-master':     { type: 'mdms', label: 'Workflow BS Master',       schema: 'Workflow.BusinessServiceMasterConfig',     idField: 'active',            nameField: 'businessService' },
  // Keyed on `code` (DEFAULT), NOT on REOPENSLA. mdms-v2 rejects any update that
  // changes a record's x-unique fields (UNIQUE_KEY_UPDATE_ERR), so keying the
  // record on its own only value made the reopen window permanently uneditable —
  // Save always 400'd (#1252). nameField stays REOPENSLA so the list shows the
  // configured window rather than the constant "DEFAULT".
  'pgr-ui-constants':       { type: 'mdms', label: 'PGR UI Constants',         schema: 'RAINMAKER-PGR.UIConstants',                idField: 'code',              nameField: 'REOPENSLA' },
  'pgr-escalation':         { type: 'mdms', label: 'PGR Escalation',           schema: 'RAINMAKER-PGR.EscalationConfig',           idField: 'code',              nameField: 'code' },
  'map-config':             { type: 'mdms', label: 'Map Configuration',        schema: 'RAINMAKER-PGR.MapConfig',                  idField: 'code',              nameField: 'code' },
  // -------------------------------------------------------------------------
  // Notification configuration — the shared NOTIFICATIONS.* namespace.
  //
  // ONE namespace for every module, held at the STATE tenant, read by the box
  // over MDMS v2 `_search` with the schemaCode in the body. Composite-key
  // masters: the react-admin id comes from the MDMS uniqueIdentifier (see
  // mapMdmsRecord), which MDMS derives server-side by joining the `x-unique`
  // values with '.', so idField/nameField here are display-only.
  //
  // `eventName` replaced (businessService, action, toState) as the key: the
  // business-service column had exactly one value ever ("PGR"), fromState was
  // documentation-only, and a dotted module-prefixed event name is globally
  // unique on its own. NOTE that eventName CONTAINS dots, so a uniqueIdentifier
  // from these masters is deterministic but not decomposable — never split one
  // on '.' to recover the key fields.
  // -------------------------------------------------------------------------

  // The event vocabulary: what a module can notify about, which actors each
  // event carries, and which placeholder tokens it fills. Module-owned (PGR's
  // rows are GENERATED from the workflow at seed time), so the Configurator
  // shows it but does not author it.
  'notifications-event-catalogue': {
    type: 'mdms', label: 'Notification Events', schema: 'NOTIFICATIONS.EventCatalogue',
    idField: 'eventName', nameField: 'label', descriptionField: 'module',
    stateLevel: true, readOnly: true,
    readOnlyNotice: 'Events are declared by the module that produces them — PGR\'s rows are generated from its workflow at seed time — so they are shown here but not edited here. A new event arrives with the module that fires it.',
  },
  'notifications-routing':  { type: 'mdms', label: 'Notification Routing',   schema: 'NOTIFICATIONS.Routing',  idField: 'eventName', nameField: 'eventName', descriptionField: 'audience', stateLevel: true },
  'notifications-template': { type: 'mdms', label: 'Notification Templates', schema: 'NOTIFICATIONS.Template', idField: 'eventName', nameField: 'eventName', descriptionField: 'audience', stateLevel: true },
  // Provider-scoped external template mapping (e.g. Twilio WhatsApp ContentSids +
  // ordered variables + per-locale approval). Surfaces the localization linkage:
  // each row carries `locale` and `approvalStatus`, so an operator sees which
  // (provider, channel, event, audience, locale) templates are approved and sendable.
  'notifications-provider-template': { type: 'mdms', label: 'Notification Provider Templates', schema: 'NOTIFICATIONS.ProviderTemplate', idField: 'eventName', nameField: 'templateName', stateLevel: true },
  // Per-tenant channel policy novu-bridge reads on every dispatch (at the STATE tenant).
  // One row per channel: enabled + provider (+ legacy gateway/senderId). The single
  // switch that decides whether a channel delivers — the env allowlist is only a
  // fallback for tenants with no rows.
  'notifications-channel':  { type: 'mdms', label: 'Notification Channels',  schema: 'NOTIFICATIONS.Channel',  idField: 'code', nameField: 'code', descriptionField: 'gateway', stateLevel: true },

  // -------------------------------------------------------------------------
  // LEGACY notification masters (RAINMAKER-PGR.Notification*) — READ-ONLY.
  //
  // Their configuration moved to NOTIFICATIONS.* above. They stay registered,
  // and their rows are never deleted, because on a tenant whose seed step has
  // not run yet these rows ARE the live configuration (the box adapts them on
  // read) and hiding them would show an operator an empty screen for a working
  // tenant. They are removed from the UI one release after the copy ships.
  // -------------------------------------------------------------------------
  'notification-routing':   { type: 'mdms', label: 'Legacy (PGR) Notification Routing',  schema: 'RAINMAKER-PGR.NotificationRouting',  idField: 'action', nameField: 'action' , stateLevel: true, readOnly: true, readOnlyNotice: LEGACY_NOTIFICATION_NOTICE },
  'notification-template':  { type: 'mdms', label: 'Legacy (PGR) Notification Templates', schema: 'RAINMAKER-PGR.NotificationTemplate', idField: 'action', nameField: 'action' , stateLevel: true, readOnly: true, readOnlyNotice: LEGACY_NOTIFICATION_NOTICE },
  'notification-provider-template': { type: 'mdms', label: 'Legacy (PGR) Provider Templates', schema: 'RAINMAKER-PGR.NotificationProviderTemplate', idField: 'action', nameField: 'templateName' , stateLevel: true, readOnly: true, readOnlyNotice: LEGACY_NOTIFICATION_NOTICE },
  'notification-channel':   { type: 'mdms', label: 'Legacy (PGR) Notification Channels',     schema: 'RAINMAKER-PGR.NotificationChannel',   idField: 'code',   nameField: 'code', descriptionField: 'gateway' , stateLevel: true, readOnly: true, readOnlyNotice: LEGACY_NOTIFICATION_NOTICE },

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

/**
 * Non-'mdms' resource types that nonetheless have a real MDMS-v2 schema with genuine
 * `/mdms-v2/v2/_create|_update/<schema>` write actions in the ACCESSCONTROL-ACTIONS-TEST seed, and
 * so must still be checked against ACCESSCONTROL-ROLEACTIONS by {@link isAccessControlGated} —
 * `access-roles`/`access-actions` use a dedicated `type` for their read path (a different fetch
 * shape than the generic MDMS list), but their EDIT gating is identical to any other mdms master.
 * Narrowing the gate to `type === 'mdms'` silently opened these two — the screens that edit the
 * permission system itself — to every role (#1826 review). Add a type here ONLY when you've
 * confirmed it has a real mdms-v2 write action in the seed; do not widen this to "any resource
 * with a `schema` field" — Employees/Boundaries/Complaints/Localization/Users all set `schema`-like
 * identifiers too but write through non-mdms-v2 endpoints (HRMS, boundary-service, PGR,
 * localization) and must stay unrestricted, matching pre-gating behavior.
 */
const EXPLICITLY_GATED_TYPES: ReadonlySet<ResourceType> = new Set(['access-role', 'access-action']);

/**
 * Whether `useMastersCapability.canViewResource`/`canEditResource` should check this resource
 * against the real ACCESSCONTROL-ACTIONS-TEST/ROLEACTIONS policy (accessPolicy.ts) rather than
 * treating it as unrestricted. Every `type: 'mdms'` resource qualifies by construction (it always
 * carries a real schema); a small explicit allowlist ({@link EXPLICITLY_GATED_TYPES}) covers the
 * non-'mdms'-typed exceptions that still need it.
 */
/**
 * Whether this resource may be created, edited or deleted from the UI at all.
 *
 * A `readOnly` resource is still listed and shown — it is live configuration on
 * some tenants — but every write affordance is withheld. This is checked BEFORE
 * the access-control policy, because it is a property of the resource, not of
 * the operator: an MDMS_ADMIN must not be able to edit a legacy notification
 * master either.
 */
export function isReadOnlyResource(resource: string): boolean {
  return REGISTRY[resource]?.readOnly === true;
}

/** The banner a read-only resource shows, or undefined. */
export function readOnlyNoticeFor(resource: string): string | undefined {
  const config = REGISTRY[resource];
  return config?.readOnly ? config.readOnlyNotice : undefined;
}

export function isAccessControlGated(config: ResourceConfig | undefined): boolean {
  if (!config) return false;
  return config.type === 'mdms' || EXPLICITLY_GATED_TYPES.has(config.type);
}
