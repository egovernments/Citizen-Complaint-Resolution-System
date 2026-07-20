import { ENDPOINTS, OAUTH_CONFIG } from './endpoints.js';
import { ApiClientError } from './errors.js';
import type {
  RequestInfo, UserInfo, MdmsRecord, ApiError,
} from './types.js';

export interface DigitApiClientConfig {
  url: string;
  stateTenantId?: string;
  endpointOverrides?: Record<string, string>;
}

export class DigitApiClient {
  private baseUrl: string;
  private _stateTenantId: string;
  private overrides: Record<string, string>;
  private authToken: string | null = null;
  private userInfo: UserInfo | null = null;

  private static readonly RETRY_STATUS_CODES = new Set([429, 503]);
  private static readonly MAX_RETRIES = 3;

  constructor(config: DigitApiClientConfig) {
    this.baseUrl = config.url;
    this._stateTenantId = config.stateTenantId || '';
    this.overrides = config.endpointOverrides || {};
  }

  // --- Auth ---

  isAuthenticated(): boolean {
    return this.authToken !== null;
  }

  get stateTenantId(): string {
    return this._stateTenantId;
  }

  set stateTenantId(id: string) {
    this._stateTenantId = id;
  }

  getAuthInfo(): { authenticated: boolean; user: UserInfo | null; token: string | null; stateTenantId: string } {
    return { authenticated: this.isAuthenticated(), user: this.userInfo, token: this.authToken, stateTenantId: this._stateTenantId };
  }

  setAuth(token: string, user: UserInfo): void {
    this.authToken = token;
    this.userInfo = user;
  }

  clearAuth(): void {
    this.authToken = null;
    this.userInfo = null;
  }

  // --- Request infrastructure ---

  endpoint(key: keyof typeof ENDPOINTS): string {
    return this.overrides[key] || ENDPOINTS[key];
  }

  buildRequestInfo(action?: string): RequestInfo {
    return {
      apiId: 'Rainmaker',
      ver: '1.0',
      ts: Date.now(),
      action,
      msgId: `${Date.now()}|en_IN`,
      authToken: this.authToken || '',
      userInfo: this.userInfo || undefined,
    };
  }

  basicAuthEncode(user: string, pass: string): string {
    return btoa(`${user}:${pass}`);
  }

  async request<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authToken) headers['Authorization'] = `Bearer ${this.authToken}`;

    const jsonBody = JSON.stringify(body);
    let lastResponse: Response | undefined;

    for (let attempt = 0; attempt < DigitApiClient.MAX_RETRIES; attempt++) {
      const response = await fetch(url, { method: 'POST', headers, body: jsonBody });

      if (!DigitApiClient.RETRY_STATUS_CODES.has(response.status)) {
        const data = await response.json() as Record<string, unknown>;
        if (!response.ok || (data.Errors as ApiError[] | undefined)?.length) {
          const errors: ApiError[] = (data.Errors as ApiError[]) || [
            { code: `HTTP_${response.status}`, message: (data.message as string) || `Request failed: ${response.status}` },
          ];
          throw new ApiClientError(errors, response.status);
        }
        return data as T;
      }

      lastResponse = response;
      if (attempt < DigitApiClient.MAX_RETRIES - 1) {
        const retryAfter = response.headers.get('Retry-After');
        const delayMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : (1 << attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    const data = await lastResponse!.json().catch(() => ({})) as Record<string, unknown>;
    const errors: ApiError[] = (data.Errors as ApiError[]) || [
      { code: `HTTP_${lastResponse!.status}`, message: (data.message as string) || `Request failed after ${DigitApiClient.MAX_RETRIES} retries` },
    ];
    throw new ApiClientError(errors, lastResponse!.status);
  }

  // --- Login ---

  async login(username: string, password: string, tenantId: string, userType = 'EMPLOYEE'): Promise<{ access_token: string; UserRequest: UserInfo }> {
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);
    formData.append('userType', userType);
    formData.append('tenantId', tenantId);
    formData.append('scope', OAUTH_CONFIG.scope);
    formData.append('grant_type', OAUTH_CONFIG.grantType);

    const basicAuth = this.basicAuthEncode(OAUTH_CONFIG.clientId, OAUTH_CONFIG.clientSecret);

    const response = await fetch(`${this.baseUrl}${this.endpoint('AUTH')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basicAuth}` },
      body: formData.toString(),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        (error as Record<string, string>).error_description ||
        (error as Record<string, string>).message ||
        `Login failed: ${response.status}`
      );
    }

    const data = await response.json() as { access_token: string; UserRequest: UserInfo };
    this.authToken = data.access_token;
    this.userInfo = data.UserRequest;
    const derivedState = tenantId.includes('.') ? tenantId.split('.')[0] : tenantId;
    this._stateTenantId = derivedState;
    return data;
  }

  // --- User service ---

  async userSearch(tenantId: string, options?: {
    userName?: string; mobileNumber?: string; uuid?: string[];
    roleCodes?: string[]; userType?: string; limit?: number; offset?: number;
  }): Promise<Record<string, unknown>[]> {
    const body: Record<string, unknown> = {
      RequestInfo: this.buildRequestInfo(), tenantId,
      pageSize: options?.limit || 100,
      pageNumber: options?.offset ? Math.floor(options.offset / (options.limit || 100)) : 0,
    };
    if (options?.userName) body.userName = options.userName;
    if (options?.mobileNumber) body.mobileNumber = options.mobileNumber;
    if (options?.uuid) body.uuid = options.uuid;
    if (options?.roleCodes) body.roleCodes = options.roleCodes;
    if (options?.userType) body.userType = options.userType;

    const data = await this.request<{ user?: Record<string, unknown>[] }>(this.endpoint('USER_SEARCH'), body);
    return data.user || [];
  }

  async userCreate(user: Record<string, unknown>, tenantId: string): Promise<Record<string, unknown>> {
    const data = await this.request<{ user?: Record<string, unknown>[] }>(this.endpoint('USER_CREATE'), {
      RequestInfo: this.buildRequestInfo(), user: { ...user, tenantId },
    });
    return (data.user || [])[0] || {};
  }

  async userUpdate(user: Record<string, unknown>): Promise<Record<string, unknown>> {
    const data = await this.request<{ user?: Record<string, unknown>[] }>(this.endpoint('USER_UPDATE'), {
      RequestInfo: this.buildRequestInfo(), user,
    });
    return (data.user || [])[0] || {};
  }

  // --- MDMS v2 ---

  async mdmsSearch(tenantId: string, schemaCode: string, options?: {
    limit?: number; offset?: number; uniqueIdentifiers?: string[];
  }): Promise<MdmsRecord[]> {
    const criteria: Record<string, unknown> = { tenantId, limit: options?.limit || 100, offset: options?.offset || 0 };
    if (schemaCode) criteria.schemaCode = schemaCode;
    if (options?.uniqueIdentifiers) criteria.uniqueIdentifiers = options.uniqueIdentifiers;

    const data = await this.request<{ mdms?: MdmsRecord[] }>(this.endpoint('MDMS_SEARCH'), {
      RequestInfo: this.buildRequestInfo(), MdmsCriteria: criteria,
    });
    return data.mdms || [];
  }

  async mdmsCreate(tenantId: string, schemaCode: string, uniqueIdentifier: string, recordData: Record<string, unknown>): Promise<MdmsRecord> {
    const data = await this.request<{ mdms?: MdmsRecord[] }>(`${this.endpoint('MDMS_CREATE')}/${schemaCode}`, {
      RequestInfo: this.buildRequestInfo(),
      Mdms: { tenantId, schemaCode, uniqueIdentifier, data: recordData, isActive: true },
    });
    return (data.mdms || [])[0] as MdmsRecord;
  }

  async mdmsUpdate(record: MdmsRecord, isActive: boolean): Promise<MdmsRecord> {
    const data = await this.request<{ mdms?: MdmsRecord[] }>(`${this.endpoint('MDMS_UPDATE')}/${record.schemaCode}`, {
      RequestInfo: this.buildRequestInfo(),
      Mdms: { tenantId: record.tenantId, schemaCode: record.schemaCode, uniqueIdentifier: record.uniqueIdentifier, id: record.id, data: record.data, auditDetails: record.auditDetails, isActive },
    });
    return (data.mdms || [])[0] as MdmsRecord;
  }

  async mdmsSchemaSearch(tenantId: string, codes?: string[], options?: { limit?: number; offset?: number }): Promise<Record<string, unknown>[]> {
    const data = await this.request<{ SchemaDefinitions?: Record<string, unknown>[] }>(this.endpoint('MDMS_SCHEMA_SEARCH'), {
      RequestInfo: this.buildRequestInfo(),
      SchemaDefCriteria: { tenantId, codes, limit: options?.limit || 200, offset: options?.offset || 0 },
    });
    return data.SchemaDefinitions || [];
  }

  async mdmsSchemaCreate(tenantId: string, code: string, description: string, definition: Record<string, unknown>): Promise<Record<string, unknown>> {
    const data = await this.request<{ SchemaDefinition?: Record<string, unknown> }>(this.endpoint('MDMS_SCHEMA_CREATE'), {
      RequestInfo: this.buildRequestInfo(),
      SchemaDefinition: { tenantId, code, description, definition, isActive: true },
    });
    return data.SchemaDefinition || {};
  }

  // --- HRMS ---

  async employeeSearch(tenantId: string, options?: {
    codes?: string[]; uuids?: string[]; departments?: string[]; limit?: number; offset?: number;
  }): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId });
    if (options?.codes?.length) params.append('codes', options.codes.join(','));
    if (options?.uuids?.length) params.append('uuids', options.uuids.join(','));
    if (options?.departments?.length) params.append('departments', options.departments.join(','));
    params.append('limit', String(options?.limit || 100));
    params.append('offset', String(options?.offset || 0));

    const data = await this.request<{ Employees?: Record<string, unknown>[] }>(
      `${this.endpoint('HRMS_EMPLOYEES_SEARCH')}?${params.toString()}`,
      { RequestInfo: this.buildRequestInfo() },
    );
    return data.Employees || [];
  }

  async employeeCreate(tenantId: string, employees: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
    const data = await this.request<{ Employees?: Record<string, unknown>[] }>(this.endpoint('HRMS_EMPLOYEES_CREATE'), {
      RequestInfo: this.buildRequestInfo(), Employees: employees.map((emp) => ({ ...emp, tenantId })),
    });
    return data.Employees || [];
  }

  async employeeUpdate(tenantId: string, employees: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
    const data = await this.request<{ Employees?: Record<string, unknown>[] }>(this.endpoint('HRMS_EMPLOYEES_UPDATE'), {
      RequestInfo: this.buildRequestInfo(), Employees: employees,
    });
    return data.Employees || [];
  }

  // --- Boundary ---

  async boundarySearch(tenantId: string, codesOrHierarchyType?: string | string[], options?: { limit?: number; offset?: number }): Promise<Record<string, unknown>[]> {
    // Support searching by codes (array) or hierarchy type (string)
    const isCodes = Array.isArray(codesOrHierarchyType);
    // Spring @ModelAttribute reads ALL fields from query params
    const queryParams = new URLSearchParams();
    queryParams.set('tenantId', tenantId);
    queryParams.set('limit', String(options?.limit || 100));
    queryParams.set('offset', String(options?.offset || 0));
    if (isCodes && codesOrHierarchyType.length) {
      // Spring binds repeated params: ?codes=A&codes=B (NOT comma-separated)
      for (const code of codesOrHierarchyType) queryParams.append('codes', code);
    }
    const url = `${this.endpoint('BOUNDARY_SEARCH')}?${queryParams.toString()}`;
    const data = await this.request<{ Boundary?: Record<string, unknown>[] }>(url, {
      RequestInfo: this.buildRequestInfo(),
    });
    return data.Boundary || [];
  }

  async boundaryRelationshipSearch(tenantId: string, hierarchyType?: string): Promise<Record<string, unknown>[]> {
    const data = await this.request<{ TenantBoundary?: Record<string, unknown>[] }>(this.endpoint('BOUNDARY_RELATIONSHIP_SEARCH'), {
      RequestInfo: this.buildRequestInfo(), BoundaryRelationship: { tenantId, hierarchyType },
    });
    return data.TenantBoundary || [];
  }

  async boundaryHierarchySearch(tenantId: string, hierarchyType?: string): Promise<Record<string, unknown>[]> {
    const criteria: Record<string, unknown> = { tenantId, limit: 100, offset: 0 };
    if (hierarchyType) criteria.hierarchyType = hierarchyType;
    const data = await this.request<{ BoundaryHierarchy?: Record<string, unknown>[] }>(this.endpoint('BOUNDARY_HIERARCHY_SEARCH'), {
      RequestInfo: this.buildRequestInfo(), BoundaryTypeHierarchySearchCriteria: criteria,
    });
    return data.BoundaryHierarchy || [];
  }

  async boundaryCreate(tenantId: string, boundaries: { code: string; geometry?: Record<string, unknown> }[]): Promise<Record<string, unknown>[]> {
    const defaultGeometry = { type: 'Point', coordinates: [0, 0] };
    const data = await this.request<{ Boundary?: Record<string, unknown>[] }>(this.endpoint('BOUNDARY_CREATE'), {
      RequestInfo: this.buildRequestInfo(),
      Boundary: boundaries.map((b) => ({ tenantId, code: b.code, geometry: b.geometry || defaultGeometry })),
    });
    return data.Boundary || [];
  }

  async boundaryHierarchyCreate(tenantId: string, hierarchyType: string, levels: { boundaryType: string; parentBoundaryType: string | null }[]): Promise<Record<string, unknown>> {
    const data = await this.request<{ BoundaryHierarchy?: Record<string, unknown> }>(this.endpoint('BOUNDARY_HIERARCHY_CREATE'), {
      RequestInfo: this.buildRequestInfo(),
      BoundaryHierarchy: { tenantId, hierarchyType, boundaryHierarchy: levels.map((h) => ({ ...h, active: true })) },
    });
    return data.BoundaryHierarchy || {};
  }

  async boundaryRelationshipCreate(tenantId: string, code: string, hierarchyType: string, boundaryType: string, parent: string | null): Promise<Record<string, unknown>> {
    const data = await this.request<{ BoundaryRelationship?: Record<string, unknown> }>(this.endpoint('BOUNDARY_RELATIONSHIP_CREATE'), {
      RequestInfo: this.buildRequestInfo(),
      BoundaryRelationship: { tenantId, code, hierarchyType, boundaryType, parent: parent || undefined },
    });
    return data.BoundaryRelationship || {};
  }

  async boundaryUpdate(tenantId: string, boundaries: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
    const data = await this.request<{ Boundary?: Record<string, unknown>[] }>(this.endpoint('BOUNDARY_UPDATE'), {
      RequestInfo: this.buildRequestInfo(),
      Boundary: boundaries.map((b) => ({ ...b, tenantId })),
    });
    return data.Boundary || [];
  }

  async boundaryDelete(tenantId: string, boundaryCodes: string[]): Promise<Record<string, unknown>[]> {
    const data = await this.request<{ Boundary?: Record<string, unknown>[] }>(this.endpoint('BOUNDARY_DELETE'), {
      RequestInfo: this.buildRequestInfo(),
      Boundary: boundaryCodes.map((code) => ({ tenantId, code })),
    });
    return data.Boundary || [];
  }

  async boundaryRelationshipDelete(tenantId: string, code: string, hierarchyType: string): Promise<Record<string, unknown>> {
    const data = await this.request<{ BoundaryRelationship?: Record<string, unknown> }>(this.endpoint('BOUNDARY_RELATIONSHIP_DELETE'), {
      RequestInfo: this.buildRequestInfo(),
      BoundaryRelationship: { tenantId, code, hierarchyType },
    });
    return data.BoundaryRelationship || {};
  }

  async boundaryRelationshipUpdate(tenantId: string, relationship: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    const data = await this.request<{ TenantBoundary?: Record<string, unknown>[] }>(this.endpoint('BOUNDARY_RELATIONSHIP_UPDATE'), {
      RequestInfo: this.buildRequestInfo(),
      BoundaryRelationship: { tenantId, ...relationship },
    });
    return data.TenantBoundary || [];
  }

  // --- Boundary Management ---

  async boundaryMgmtProcess(tenantId: string, resourceDetails: Record<string, unknown>): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ tenantId });
    const data = await this.request<Record<string, unknown>>(
      `${this.endpoint('BNDRY_MGMT_PROCESS')}?${params.toString()}`,
      { RequestInfo: this.buildRequestInfo(), ResourceDetails: resourceDetails },
    );
    return data;
  }

  async boundaryMgmtProcessSearch(tenantId: string): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId });
    try {
      const data = await this.request<{ ResourceDetails?: Record<string, unknown>[] }>(
        `${this.endpoint('BNDRY_MGMT_PROCESS_SEARCH')}?${params.toString()}`,
        { RequestInfo: this.buildRequestInfo() },
      );
      return data.ResourceDetails || [];
    } catch (e: unknown) {
      // "invalid path" means no boundary data has been uploaded/processed for this tenant — return empty
      if (e instanceof Error && e.message?.includes('invalid path')) return [];
      throw e;
    }
  }

  async boundaryMgmtGenerate(tenantId: string, resourceDetails: Record<string, unknown>): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ tenantId });
    const data = await this.request<Record<string, unknown>>(
      `${this.endpoint('BNDRY_MGMT_GENERATE')}?${params.toString()}`,
      { RequestInfo: this.buildRequestInfo(), ResourceDetails: resourceDetails },
    );
    return data;
  }

  async boundaryMgmtGenerateSearch(tenantId: string): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId });
    try {
      const data = await this.request<{ ResourceDetails?: Record<string, unknown>[] }>(
        `${this.endpoint('BNDRY_MGMT_GENERATE_SEARCH')}?${params.toString()}`,
        { RequestInfo: this.buildRequestInfo() },
      );
      return data.ResourceDetails || [];
    } catch (e: unknown) {
      // "invalid path" means no generated boundary data for this tenant — return empty
      if (e instanceof Error && e.message?.includes('invalid path')) return [];
      throw e;
    }
  }

  // --- PGR ---

  async pgrSearch(tenantId: string, options?: {
    serviceRequestId?: string; status?: string; limit?: number; offset?: number;
  }): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId });
    if (options?.serviceRequestId) params.append('serviceRequestId', options.serviceRequestId);
    if (options?.status) params.append('applicationStatus', options.status);
    params.append('limit', String(options?.limit || 50));
    params.append('offset', String(options?.offset || 0));

    const data = await this.request<{ ServiceWrappers?: Record<string, unknown>[] }>(
      `${this.endpoint('PGR_SEARCH')}?${params.toString()}`,
      { RequestInfo: this.buildRequestInfo() },
    );
    return data.ServiceWrappers || [];
  }

  async pgrCreate(tenantId: string, serviceCode: string, description: string, address: Record<string, unknown>, citizen?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const citizenInfo = citizen || (this.userInfo ? {
      mobileNumber: this.userInfo.mobileNumber || '0000000000', name: this.userInfo.name, type: 'CITIZEN',
      roles: [{ code: 'CITIZEN', name: 'Citizen', tenantId: this._stateTenantId }], tenantId: this._stateTenantId,
    } : undefined);

    const data = await this.request<{ ServiceWrappers?: Record<string, unknown>[] }>(this.endpoint('PGR_CREATE'), {
      RequestInfo: this.buildRequestInfo(),
      service: { tenantId, serviceCode, description, address: { tenantId, geoLocation: { latitude: 0, longitude: 0 }, ...address }, citizen: citizenInfo, source: 'web', active: true },
      workflow: { action: 'APPLY' },
    });
    return (data.ServiceWrappers || [])[0] || {};
  }

  async pgrUpdate(service: Record<string, unknown>, action: string, options?: {
    comment?: string; assignees?: string[]; rating?: number;
  }): Promise<Record<string, unknown>> {
    const workflow: Record<string, unknown> = { action, assignees: options?.assignees || [], comments: options?.comment };
    if (options?.rating !== undefined) workflow.rating = options.rating;

    const data = await this.request<{ ServiceWrappers?: Record<string, unknown>[] }>(this.endpoint('PGR_UPDATE'), {
      RequestInfo: this.buildRequestInfo(), service, workflow,
    });
    return (data.ServiceWrappers || [])[0] || {};
  }

  // --- Localization ---

  async localizationSearch(tenantId: string, locale: string, module?: string): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId, locale });
    if (module) params.append('module', module);
    const data = await this.request<{ messages?: Record<string, unknown>[] }>(
      `${this.endpoint('LOCALIZATION_SEARCH')}?${params.toString()}`,
      { RequestInfo: this.buildRequestInfo() },
    );
    return data.messages || [];
  }

  async localizationUpsert(tenantId: string, locale: string, messages: { code: string; message: string; module: string }[]): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId, locale });
    const data = await this.request<{ messages?: Record<string, unknown>[] }>(
      `${this.endpoint('LOCALIZATION_UPSERT')}?${params.toString()}`,
      { RequestInfo: this.buildRequestInfo(), tenantId, messages: messages.map((m) => ({ ...m, locale })) },
    );
    return data.messages || [];
  }

  async localizationDelete(tenantId: string, locale: string, messages: { code: string; module: string }[]): Promise<boolean> {
    const data = await this.request<{ successful?: boolean }>(this.endpoint('LOCALIZATION_DELETE'), {
      RequestInfo: this.buildRequestInfo(),
      tenantId,
      messages: messages.map((m) => ({ code: m.code, module: m.module, locale })),
    });
    return data.successful === true;
  }

  // --- Workflow ---

  async workflowBusinessServiceSearch(tenantId: string, businessServices?: string[]): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId });
    if (businessServices?.length) params.append('businessServices', businessServices.join(','));
    const data = await this.request<{ BusinessServices?: Record<string, unknown>[] }>(
      `${this.endpoint('WORKFLOW_BUSINESS_SERVICE_SEARCH')}?${params.toString()}`,
      { RequestInfo: this.buildRequestInfo() },
    );
    return data.BusinessServices || [];
  }

  async workflowBusinessServiceCreate(tenantId: string, businessService: Record<string, unknown>): Promise<Record<string, unknown>> {
    const data = await this.request<{ BusinessServices?: Record<string, unknown>[] }>(this.endpoint('WORKFLOW_BUSINESS_SERVICE_CREATE'), {
      RequestInfo: this.buildRequestInfo(), BusinessServices: [{ ...businessService, tenantId }],
    });
    return (data.BusinessServices || [])[0] || {};
  }

  async workflowProcessSearch(tenantId: string, businessIds?: string[], options?: {
    limit?: number; offset?: number; history?: boolean;
  }): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId });
    if (businessIds?.length) params.append('businessIds', businessIds.join(','));
    params.append('history', String(options?.history ?? true));
    params.append('limit', String(options?.limit || 50));
    params.append('offset', String(options?.offset || 0));

    const data = await this.request<{ ProcessInstances?: Record<string, unknown>[] }>(
      `${this.endpoint('WORKFLOW_PROCESS_SEARCH')}?${params.toString()}`,
      { RequestInfo: this.buildRequestInfo() },
    );
    return data.ProcessInstances || [];
  }

  // --- Access Control ---

  async accessRolesSearch(tenantId: string): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId });
    const data = await this.request<{ roles?: Record<string, unknown>[] }>(
      `${this.endpoint('ACCESS_ROLES_SEARCH')}?${params.toString()}`,
      { RequestInfo: this.buildRequestInfo() },
    );
    return data.roles || [];
  }

  async accessActionsSearch(tenantId: string, roleCodes: string[], actionMaster = 'actions-test'): Promise<Record<string, unknown>[]> {
    const data = await this.request<{ actions?: Record<string, unknown>[] }>(this.endpoint('ACCESS_ACTIONS_SEARCH'), {
      RequestInfo: this.buildRequestInfo(),
      roleCodes,
      tenantId,
      actionMaster,
    });
    return data.actions || [];
  }

  // --- ID Generation ---

  async idgenGenerate(tenantId: string, idRequests: { idName: string; tenantId?: string; format?: string }[]): Promise<{ id: string }[]> {
    const data = await this.request<{ idResponses?: { id: string }[] }>(this.endpoint('IDGEN_GENERATE'), {
      RequestInfo: this.buildRequestInfo(),
      idRequests: idRequests.map((r) => ({ idName: r.idName, tenantId: r.tenantId || tenantId, format: r.format })),
    });
    return data.idResponses || [];
  }

  // --- Filestore ---

  async filestoreGetUrl(tenantId: string, fileStoreIds: string[]): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId, fileStoreIds: fileStoreIds.join(',') });
    const url = `${this.baseUrl}${this.endpoint('FILESTORE_URL')}?${params.toString()}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authToken) headers['Authorization'] = `Bearer ${this.authToken}`;

    const response = await fetch(url, { method: 'GET', headers });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await response.text();
      throw new Error(`Filestore returned non-JSON (${response.status}): ${text.slice(0, 200)}`);
    }
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error((data.message as string) || `Filestore URL fetch failed: ${response.status}`);
    return (data.fileStoreIds as Record<string, unknown>[]) || [];
  }

  async filestoreUpload(tenantId: string, module: string, fileName: string, fileContent: Buffer | Uint8Array, contentType?: string): Promise<string> {
    const url = `${this.baseUrl}${this.endpoint('FILESTORE_UPLOAD')}`;
    const formData = new FormData();
    // Cast to BlobPart — Buffer/Uint8Array are valid at runtime but strict TS typing conflicts with ArrayBufferLike
    const blob = new Blob([fileContent as unknown as BlobPart], { type: contentType || 'application/octet-stream' });
    formData.append('file', blob, fileName);
    formData.append('tenantId', tenantId);
    formData.append('module', module);

    const headers: Record<string, string> = {};
    if (this.authToken) headers['Authorization'] = `Bearer ${this.authToken}`;

    const response = await fetch(url, { method: 'POST', headers, body: formData });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      const errors = data.Errors as { code?: string; message?: string }[] | undefined;
      const errorMsg = errors?.map((e) => e.message || e.code).join(', ');
      throw new Error(errorMsg || (data.message as string) || `File upload failed: ${response.status}`);
    }
    const files = data.files as { fileStoreId?: string }[] | undefined;
    return files?.[0]?.fileStoreId || '';
  }

  // --- Encryption ---

  async encryptData(tenantId: string, values: string[]): Promise<string[]> {
    const url = `${this.baseUrl}${this.endpoint('ENC_ENCRYPT')}`;
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encryptionRequests: values.map((value) => ({ tenantId, type: 'Normal', value })) }),
    });
    if (!response.ok) throw new Error(`Encryption failed: HTTP ${response.status}`);
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }

  async decryptData(tenantId: string, encryptedValues: string[]): Promise<string[]> {
    const url = `${this.baseUrl}${this.endpoint('ENC_DECRYPT')}`;
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(encryptedValues),
    });
    if (!response.ok) throw new Error(`Decryption failed: HTTP ${response.status}`);
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }

  // --- Inbox ---

  async inboxSearch(tenantId: string, options?: {
    module?: string; businessService?: string; limit?: number; offset?: number;
  }): Promise<Record<string, unknown>[]> {
    const data = await this.request<{ items?: Record<string, unknown>[]; inbox?: Record<string, unknown>[] }>(this.endpoint('INBOX_V2_SEARCH'), {
      RequestInfo: this.buildRequestInfo(),
      inbox: {
        tenantId,
        processSearchCriteria: {
          tenantId,
          moduleName: options?.module,
          businessService: options?.businessService ? [options.businessService] : undefined,
        },
        moduleSearchCriteria: { tenantId },
        limit: options?.limit || 50,
        offset: options?.offset || 0,
      },
    });
    return data.items || data.inbox || [];
  }
}
