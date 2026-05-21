import { ENDPOINTS, OAUTH_CONFIG } from '../config/endpoints.js';
import { getEnvironment } from '../config/environments.js';
import type { RequestInfo, UserInfo, MdmsRecord, ApiError, Environment, ErrorCategory } from '../types/index.js';

function deriveErrorCategory(statusCode: number): ErrorCategory {
  if (statusCode === 401 || statusCode === 403) return 'auth';
  if (statusCode >= 400 && statusCode < 500) return 'validation';
  return 'api';
}

export class ApiClientError extends Error {
  public errors: ApiError[];
  public statusCode: number;
  public category: ErrorCategory;

  constructor(errors: ApiError[], statusCode: number) {
    super(errors.map((e) => e.message || e.code || 'Unknown error').join(', '));
    this.name = 'ApiClientError';
    this.errors = errors;
    this.statusCode = statusCode;
    this.category = deriveErrorCategory(statusCode);
  }
}

class DigitApiClient {
  private environment: Environment;
  private stateTenantOverride: string | null = null;
  private authToken: string | null = null;
  private userInfo: UserInfo | null = null;

  constructor() {
    this.environment = getEnvironment();
  }

  getEnvironmentInfo(): Environment {
    if (this.stateTenantOverride) {
      return { ...this.environment, stateTenantId: this.stateTenantOverride };
    }
    return this.environment;
  }

  setEnvironment(envKey: string): void {
    this.environment = getEnvironment(envKey);
    this.stateTenantOverride = null;
    this.authToken = null;
    this.userInfo = null;
  }

  setStateTenant(tenantId: string): void {
    this.stateTenantOverride = tenantId;
  }

  /**
   * Set an ad-hoc environment from a raw base URL (no named env lookup needed).
   * Clears existing auth state so the caller must re-authenticate.
   */
  setAdHocEnvironment(baseUrl: string, endpointOverrides?: Record<string, string>): void {
    // Strip trailing slash
    const url = baseUrl.replace(/\/+$/, '');
    const hostname = new URL(url).hostname;
    this.environment = {
      name: `${hostname} (ad-hoc)`,
      url,
      stateTenantId: 'default', // will be resolved from login response
      description: `Ad-hoc connection to ${url}`,
      endpointOverrides,
    };
    this.stateTenantOverride = null;
    this.authToken = null;
    this.userInfo = null;
  }

  isAuthenticated(): boolean {
    return this.authToken !== null;
  }

  getAuthInfo(): { authenticated: boolean; user: UserInfo | null; stateTenantId: string; token: string | null } {
    return {
      authenticated: this.isAuthenticated(),
      user: this.userInfo,
      stateTenantId: this.getEnvironmentInfo().stateTenantId,
      token: this.authToken,
    };
  }

  /**
   * Snapshot/restore auth state. Used by the REST shim so each request
   * runs under the caller's token without leaking state across requests.
   * Combined with a single-flight mutex this is safe even though the
   * underlying client is a process-level singleton.
   */
  snapshotAuth(): { token: string | null; user: UserInfo | null; stateTenantOverride: string | null } {
    return {
      token: this.authToken,
      user: this.userInfo,
      stateTenantOverride: this.stateTenantOverride,
    };
  }

  restoreAuth(snap: { token: string | null; user: UserInfo | null; stateTenantOverride: string | null }): void {
    this.authToken = snap.token;
    this.userInfo = snap.user;
    this.stateTenantOverride = snap.stateTenantOverride;
  }

  /**
   * Apply a caller-provided bearer token (and optional user/state-tenant
   * context). Used when the REST caller already authenticated upstream
   * and just passes the token via Authorization header.
   */
  applyToken(token: string, user: UserInfo | null, stateTenantOverride: string | null): void {
    this.authToken = token;
    this.userInfo = user;
    this.stateTenantOverride = stateTenantOverride;
  }

  // Resolve endpoint path, applying environment overrides if present
  private endpoint(key: keyof typeof ENDPOINTS): string {
    return this.environment.endpointOverrides?.[key] || ENDPOINTS[key];
  }

  private buildRequestInfo(): RequestInfo {
    return {
      apiId: 'Rainmaker',
      ver: '1.0',
      ts: Date.now(),
      msgId: `${Date.now()}|en_IN`,
      authToken: this.authToken || '',
      userInfo: this.userInfo || undefined,
    };
  }

  async login(username: string, password: string, tenantId: string): Promise<void> {
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);
    formData.append('userType', 'EMPLOYEE');
    formData.append('tenantId', tenantId);
    formData.append('scope', OAUTH_CONFIG.scope);
    formData.append('grant_type', OAUTH_CONFIG.grantType);

    const basicAuth = Buffer.from(
      `${OAUTH_CONFIG.clientId}:${OAUTH_CONFIG.clientSecret}`
    ).toString('base64');

    const response = await fetch(`${this.environment.url}${this.endpoint('AUTH')}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
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

    // Auto-detect state tenant from login tenant ID
    // e.g. "statea.f" → "statea", "pg.citya" → "pg", "pg" → "pg"
    const derivedState = tenantId.includes('.') ? tenantId.split('.')[0] : tenantId;
    // Set override if different from environment default, otherwise clear any previous override
    this.stateTenantOverride = derivedState !== this.environment.stateTenantId ? derivedState : null;
  }

  private static readonly RETRY_STATUS_CODES = new Set([429, 503]);
  private static readonly MAX_RETRIES = 3;

  private async request<T = unknown>(
    endpoint: string,
    body: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.environment.url}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    const jsonBody = JSON.stringify(body);
    let lastResponse: Response | undefined;

    for (let attempt = 0; attempt < DigitApiClient.MAX_RETRIES; attempt++) {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: jsonBody,
      });

      if (!DigitApiClient.RETRY_STATUS_CODES.has(response.status)) {
        // Not a retryable status — process normally
        const data = await response.json() as Record<string, unknown>;

        if (!response.ok || (data.Errors as ApiError[] | undefined)?.length) {
          const errors: ApiError[] = (data.Errors as ApiError[]) || [
            {
              code: `HTTP_${response.status}`,
              message: (data.message as string) || `Request failed: ${response.status}`,
            },
          ];
          throw new ApiClientError(errors, response.status);
        }

        return data as T;
      }

      // Retryable — wait with exponential backoff, respect Retry-After header
      lastResponse = response;
      if (attempt < DigitApiClient.MAX_RETRIES - 1) {
        const retryAfter = response.headers.get('Retry-After');
        const delayMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : (1 << attempt) * 1000; // 1s, 2s, 4s
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    // All retries exhausted — throw with the last response
    const data = await lastResponse!.json().catch(() => ({})) as Record<string, unknown>;
    const errors: ApiError[] = (data.Errors as ApiError[]) || [
      {
        code: `HTTP_${lastResponse!.status}`,
        message: (data.message as string) || `Request failed after ${DigitApiClient.MAX_RETRIES} retries: ${lastResponse!.status}`,
      },
    ];
    throw new ApiClientError(errors, lastResponse!.status);
  }

  // User search
  async userSearch(
    tenantId: string,
    options?: { userName?: string; mobileNumber?: string; uuid?: string[]; roleCodes?: string[]; userType?: string; limit?: number; offset?: number }
  ): Promise<Record<string, unknown>[]> {
    // Only include defined filters — DIGIT user-service throws 500 on certain undefined combos
    const body: Record<string, unknown> = {
      RequestInfo: this.buildRequestInfo(),
      tenantId,
      pageSize: options?.limit || 100,
      pageNumber: options?.offset ? Math.floor(options.offset / (options.limit || 100)) : 0,
    };
    if (options?.userName) body.userName = options.userName;
    if (options?.mobileNumber) body.mobileNumber = options.mobileNumber;
    if (options?.uuid) body.uuid = options.uuid;
    if (options?.roleCodes) body.roleCodes = options.roleCodes;
    if (options?.userType) body.userType = options.userType;

    const data = await this.request<{ user?: Record<string, unknown>[] }>(
      this.endpoint('USER_SEARCH'),
      body
    );

    return data.user || [];
  }

  // User create (no-validate)
  async userCreate(
    user: Record<string, unknown>,
    tenantId: string
  ): Promise<Record<string, unknown>> {
    const data = await this.request<{ user?: Record<string, unknown>[] }>(
      this.endpoint('USER_CREATE'),
      {
        RequestInfo: this.buildRequestInfo(),
        user: { ...user, tenantId },
      }
    );

    return (data.user || [])[0] || {};
  }

  // User update (admin, no validation)
  async userUpdate(
    user: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const data = await this.request<{ user?: Record<string, unknown>[] }>(
      this.endpoint('USER_UPDATE'),
      {
        RequestInfo: this.buildRequestInfo(),
        user,
      }
    );

    return (data.user || [])[0] || {};
  }

  // MDMS v2 Search — returns typed array
  async mdmsV2Search<T = Record<string, unknown>>(
    tenantId: string,
    schemaCode: string,
    options?: { limit?: number; offset?: number; uniqueIdentifiers?: string[] }
  ): Promise<T[]> {
    const data = await this.request<{ mdms?: MdmsRecord[] }>(this.endpoint('MDMS_SEARCH'), {
      RequestInfo: this.buildRequestInfo(),
      MdmsCriteria: {
        tenantId,
        schemaCode,
        limit: options?.limit || 100,
        offset: options?.offset || 0,
        uniqueIdentifiers: options?.uniqueIdentifiers,
      },
    });

    return (data.mdms || []).map((record) => record.data as T);
  }

  // MDMS v2 Search — returns raw MdmsRecord[]
  async mdmsV2SearchRaw(
    tenantId: string,
    schemaCode: string,
    options?: { limit?: number; offset?: number; uniqueIdentifiers?: string[] }
  ): Promise<MdmsRecord[]> {
    const criteria: Record<string, unknown> = {
      tenantId,
      limit: options?.limit || 100,
      offset: options?.offset || 0,
    };
    if (schemaCode) criteria.schemaCode = schemaCode;
    if (options?.uniqueIdentifiers) criteria.uniqueIdentifiers = options.uniqueIdentifiers;

    const data = await this.request<{ mdms?: MdmsRecord[] }>(this.endpoint('MDMS_SEARCH'), {
      RequestInfo: this.buildRequestInfo(),
      MdmsCriteria: criteria,
    });

    return data.mdms || [];
  }

  // MDMS v2 Create
  async mdmsV2Create(
    tenantId: string,
    schemaCode: string,
    uniqueIdentifier: string,
    recordData: Record<string, unknown>
  ): Promise<MdmsRecord> {
    const data = await this.request<{ mdms?: MdmsRecord[] }>(
      `${this.endpoint('MDMS_CREATE')}/${schemaCode}`,
      {
        RequestInfo: this.buildRequestInfo(),
        Mdms: {
          tenantId,
          schemaCode,
          uniqueIdentifier,
          data: recordData,
          isActive: true,
        },
      }
    );

    return (data.mdms || [])[0] as MdmsRecord;
  }

  // MDMS v2 Update (used for soft-delete via isActive=false)
  async mdmsV2Update(record: MdmsRecord, isActive: boolean): Promise<MdmsRecord> {
    const data = await this.request<{ mdms?: MdmsRecord[] }>(
      `${this.endpoint('MDMS_UPDATE')}/${record.schemaCode}`,
      {
        RequestInfo: this.buildRequestInfo(),
        Mdms: {
          tenantId: record.tenantId,
          schemaCode: record.schemaCode,
          uniqueIdentifier: record.uniqueIdentifier,
          id: record.id,
          data: record.data,
          auditDetails: record.auditDetails,
          isActive,
        },
      }
    );

    return (data.mdms || [])[0] as MdmsRecord;
  }

  // MDMS v2 Schema Create
  async mdmsSchemaCreate(
    tenantId: string,
    code: string,
    description: string,
    definition: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const data = await this.request<{ SchemaDefinition?: Record<string, unknown> }>(
      this.endpoint('MDMS_SCHEMA_CREATE'),
      {
        RequestInfo: this.buildRequestInfo(),
        SchemaDefinition: {
          tenantId,
          code,
          description,
          definition,
          isActive: true,
        },
      }
    );

    return data.SchemaDefinition || {};
  }

  // MDMS v2 Schema Search
  async mdmsSchemaSearch(
    tenantId: string,
    codes?: string[],
    options?: { limit?: number; offset?: number }
  ): Promise<Record<string, unknown>[]> {
    const data = await this.request<{ SchemaDefinitions?: Record<string, unknown>[] }>(
      this.endpoint('MDMS_SCHEMA_SEARCH'),
      {
        RequestInfo: this.buildRequestInfo(),
        SchemaDefCriteria: {
          tenantId,
          codes,
          limit: options?.limit || 200,
          offset: options?.offset || 0,
        },
      }
    );

    return data.SchemaDefinitions || [];
  }

  // Boundary entity search (flat list)
  async boundarySearch(
    tenantId: string,
    hierarchyType?: string,
    options?: { limit?: number; offset?: number; codes?: string[] }
  ): Promise<Record<string, unknown>[]> {
    // boundary-service /boundary/_search takes its filters as query-string
    // params; the body is just RequestInfo. tenantId is always passed via
    // query so that route's @RequestParam binding picks it up.
    const params = new URLSearchParams({ tenantId });
    if (hierarchyType) params.set('hierarchyType', hierarchyType);
    if (options?.codes && options.codes.length > 0) {
      params.set('codes', options.codes.join(','));
    }
    if (options?.limit !== undefined) params.set('limit', String(options.limit));
    if (options?.offset !== undefined) params.set('offset', String(options.offset));

    const data = await this.request<{ Boundary?: Record<string, unknown>[] }>(
      `${this.endpoint('BOUNDARY_SEARCH')}?${params.toString()}`,
      {
        RequestInfo: this.buildRequestInfo(),
      }
    );

    return data.Boundary || [];
  }

  // Boundary relationship search (tree structure via TenantBoundary)
  async boundaryRelationshipTreeSearch(
    tenantId: string,
    hierarchyType?: string
  ): Promise<Record<string, unknown>[]> {
    const data = await this.request<{ TenantBoundary?: Record<string, unknown>[] }>(
      this.endpoint('BOUNDARY_RELATIONSHIP_SEARCH'),
      {
        RequestInfo: this.buildRequestInfo(),
        BoundaryRelationship: {
          tenantId,
          hierarchyType,
        },
      }
    );

    return data.TenantBoundary || [];
  }

  // HRMS employee search — criteria as query params
  async employeeSearch(
    tenantId: string,
    options?: { codes?: string[]; departments?: string[]; limit?: number; offset?: number }
  ): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId });
    if (options?.codes?.length) params.append('codes', options.codes.join(','));
    if (options?.departments?.length) params.append('departments', options.departments.join(','));
    params.append('limit', String(options?.limit || 100));
    params.append('offset', String(options?.offset || 0));

    const data = await this.request<{ Employees?: Record<string, unknown>[] }>(
      `${this.endpoint('HRMS_EMPLOYEES_SEARCH')}?${params.toString()}`,
      { RequestInfo: this.buildRequestInfo() }
    );

    return data.Employees || [];
  }

  // HRMS employee create
  async employeeCreate(
    tenantId: string,
    employees: Record<string, unknown>[]
  ): Promise<Record<string, unknown>[]> {
    const data = await this.request<{ Employees?: Record<string, unknown>[] }>(
      this.endpoint('HRMS_EMPLOYEES_CREATE'),
      {
        RequestInfo: this.buildRequestInfo(),
        Employees: employees.map((emp) => ({ ...emp, tenantId })),
      }
    );

    return data.Employees || [];
  }

  // HRMS employee update
  async employeeUpdate(
    tenantId: string,
    employees: Record<string, unknown>[]
  ): Promise<Record<string, unknown>[]> {
    const data = await this.request<{ Employees?: Record<string, unknown>[] }>(
      this.endpoint('HRMS_EMPLOYEES_UPDATE'),
      {
        RequestInfo: this.buildRequestInfo(),
        Employees: employees,
      }
    );

    return data.Employees || [];
  }

  // Boundary hierarchy definition search
  async boundaryHierarchySearch(
    tenantId: string,
    hierarchyType?: string
  ): Promise<Record<string, unknown>[]> {
    const criteria: Record<string, unknown> = {
      tenantId,
      limit: 100,
      offset: 0,
    };
    if (hierarchyType) criteria.hierarchyType = hierarchyType;

    const data = await this.request<{ BoundaryHierarchy?: Record<string, unknown>[] }>(
      this.endpoint('BOUNDARY_HIERARCHY_SEARCH'),
      {
        RequestInfo: this.buildRequestInfo(),
        BoundaryTypeHierarchySearchCriteria: criteria,
      }
    );

    return data.BoundaryHierarchy || [];
  }

  // Filestore upload (multipart)
  async filestoreUpload(
    tenantId: string,
    module: string,
    fileBuffer: Buffer,
    fileName: string,
    contentType: string
  ): Promise<Record<string, unknown>[]> {
    const boundary = `----FormBoundary${Date.now()}`;
    const crlf = '\r\n';

    const bodyParts: Buffer[] = [];
    // tenantId field
    bodyParts.push(Buffer.from(
      `--${boundary}${crlf}Content-Disposition: form-data; name="tenantId"${crlf}${crlf}${tenantId}${crlf}`
    ));
    // module field
    bodyParts.push(Buffer.from(
      `--${boundary}${crlf}Content-Disposition: form-data; name="module"${crlf}${crlf}${module}${crlf}`
    ));
    // file field
    bodyParts.push(Buffer.from(
      `--${boundary}${crlf}Content-Disposition: form-data; name="file"; filename="${fileName}"${crlf}Content-Type: ${contentType}${crlf}${crlf}`
    ));
    bodyParts.push(fileBuffer);
    bodyParts.push(Buffer.from(`${crlf}--${boundary}--${crlf}`));

    const body = Buffer.concat(bodyParts);

    const url = `${this.environment.url}${this.endpoint('FILESTORE_UPLOAD')}`;
    const headers: Record<string, string> = {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    };
    if (this.authToken) headers['Authorization'] = `Bearer ${this.authToken}`;

    const response = await fetch(url, { method: 'POST', headers, body });
    const data = await response.json() as Record<string, unknown>;

    if (!response.ok || (data.Errors as ApiError[] | undefined)?.length) {
      const errors = data.Errors as ApiError[] | undefined;
      const errorMsg = errors?.map((e) => e.message || e.code).join(', ');
      throw new Error(errorMsg || (data.message as string) || `File upload failed: ${response.status}`);
    }

    return (data.files as Record<string, unknown>[]) || [];
  }

  // Localization search — locale & tenantId are query params
  async localizationSearch(
    tenantId: string,
    locale: string,
    module?: string
  ): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId, locale });
    if (module) params.append('module', module);

    const data = await this.request<{ messages?: Record<string, unknown>[] }>(
      `${this.endpoint('LOCALIZATION_SEARCH')}?${params.toString()}`,
      { RequestInfo: this.buildRequestInfo() }
    );

    return data.messages || [];
  }

  // Localization upsert — tenantId in both query params and body (server validates both)
  async localizationUpsert(
    tenantId: string,
    locale: string,
    messages: { code: string; message: string; module: string }[]
  ): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId, locale });

    const data = await this.request<{ messages?: Record<string, unknown>[] }>(
      `${this.endpoint('LOCALIZATION_UPSERT')}?${params.toString()}`,
      {
        RequestInfo: this.buildRequestInfo(),
        tenantId,
        messages: messages.map((m) => ({ ...m, locale })),
      }
    );

    return data.messages || [];
  }

  // PGR complaint search — criteria as query params (Spring @ModelAttribute)
  async pgrSearch(
    tenantId: string,
    options?: { serviceRequestId?: string; status?: string; limit?: number; offset?: number }
  ): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId });
    if (options?.serviceRequestId) params.append('serviceRequestId', options.serviceRequestId);
    if (options?.status) params.append('applicationStatus', options.status);
    params.append('limit', String(options?.limit || 50));
    params.append('offset', String(options?.offset || 0));

    const data = await this.request<{ ServiceWrappers?: Record<string, unknown>[] }>(
      `${this.endpoint('PGR_SEARCH')}?${params.toString()}`,
      { RequestInfo: this.buildRequestInfo() }
    );

    return data.ServiceWrappers || [];
  }

  // PGR complaint create
  async pgrCreate(
    tenantId: string,
    serviceCode: string,
    description: string,
    address: Record<string, unknown>,
    citizen?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    // Build citizen from provided data or from logged-in user
    const env = this.getEnvironmentInfo();
    const citizenInfo = citizen || (this.userInfo ? {
      mobileNumber: this.userInfo.mobileNumber || '0000000000',
      name: this.userInfo.name,
      type: 'CITIZEN',
      roles: [{ code: 'CITIZEN', name: 'Citizen', tenantId: env.stateTenantId }],
      tenantId: env.stateTenantId,
    } : undefined);

    const data = await this.request<{ ServiceWrappers?: Record<string, unknown>[] }>(
      this.endpoint('PGR_CREATE'),
      {
        RequestInfo: this.buildRequestInfo(),
        service: {
          tenantId,
          serviceCode,
          description,
          address: { tenantId, geoLocation: { latitude: 0, longitude: 0 }, ...address },
          citizen: citizenInfo,
          source: 'web',
          active: true,
        },
        workflow: {
          action: 'APPLY',
        },
      }
    );

    return (data.ServiceWrappers || [])[0] || {};
  }

  // PGR complaint update — service and workflow are top-level keys (not wrapped)
  async pgrUpdate(
    service: Record<string, unknown>,
    action: string,
    options?: { comment?: string; assignees?: string[]; rating?: number }
  ): Promise<Record<string, unknown>> {
    const workflow: Record<string, unknown> = {
      action,
      assignes: options?.assignees || [],
      comments: options?.comment,
    };
    if (options?.rating !== undefined) {
      workflow.rating = options.rating;
    }

    const data = await this.request<{ ServiceWrappers?: Record<string, unknown>[] }>(
      this.endpoint('PGR_UPDATE'),
      {
        RequestInfo: this.buildRequestInfo(),
        service,
        workflow,
      }
    );

    return (data.ServiceWrappers || [])[0] || {};
  }

  // Workflow business service search
  async workflowBusinessServiceSearch(
    tenantId: string,
    businessServices?: string[]
  ): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId });
    if (businessServices?.length) {
      params.append('businessServices', businessServices.join(','));
    }

    const data = await this.request<{ BusinessServices?: Record<string, unknown>[] }>(
      `${this.endpoint('WORKFLOW_BUSINESS_SERVICE_SEARCH')}?${params.toString()}`,
      { RequestInfo: this.buildRequestInfo() }
    );

    return data.BusinessServices || [];
  }

  // Workflow business service create
  async workflowBusinessServiceCreate(
    tenantId: string,
    businessService: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const data = await this.request<{ BusinessServices?: Record<string, unknown>[] }>(
      this.endpoint('WORKFLOW_BUSINESS_SERVICE_CREATE'),
      {
        RequestInfo: this.buildRequestInfo(),
        BusinessServices: [{ ...businessService, tenantId }],
      }
    );

    return (data.BusinessServices || [])[0] || {};
  }

  // Workflow process instance search — tenantId and businessIds as query params
  // history=true returns full audit trail; without it only the latest transition is returned
  async workflowProcessSearch(
    tenantId: string,
    businessIds?: string[],
    options?: { limit?: number; offset?: number; moduleName?: string; history?: boolean }
  ): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId });
    if (businessIds?.length) params.append('businessIds', businessIds.join(','));
    params.append('history', String(options?.history ?? true));
    params.append('limit', String(options?.limit || 50));
    params.append('offset', String(options?.offset || 0));

    const data = await this.request<{ ProcessInstances?: Record<string, unknown>[] }>(
      `${this.endpoint('WORKFLOW_PROCESS_SEARCH')}?${params.toString()}`,
      {
        RequestInfo: this.buildRequestInfo(),
      }
    );

    return data.ProcessInstances || [];
  }

  // Filestore get URL
  async filestoreGetUrl(
    tenantId: string,
    fileStoreIds: string[]
  ): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId, fileStoreIds: fileStoreIds.join(',') });

    const url = `${this.environment.url}${this.endpoint('FILESTORE_URL')}?${params.toString()}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authToken) headers['Authorization'] = `Bearer ${this.authToken}`;

    const response = await fetch(url, { method: 'GET', headers });

    // Filestore may return non-JSON for invalid IDs or errors
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await response.text();
      throw new Error(`Filestore returned non-JSON response (${response.status}): ${text.slice(0, 200)}`);
    }

    const data = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      throw new Error((data.message as string) || `Filestore URL fetch failed: ${response.status}`);
    }

    return (data.fileStoreIds as Record<string, unknown>[]) || [];
  }

  // Access control roles search — tenantId as query param
  async accessRolesSearch(
    tenantId: string
  ): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId });

    const data = await this.request<{ roles?: Record<string, unknown>[] }>(
      `${this.endpoint('ACCESS_ROLES_SEARCH')}?${params.toString()}`,
      { RequestInfo: this.buildRequestInfo() }
    );

    return data.roles || [];
  }

  // Access control actions search
  async accessActionsSearch(
    tenantId: string,
    roleCodes?: string[]
  ): Promise<Record<string, unknown>[]> {
    const data = await this.request<{ actions?: Record<string, unknown>[] }>(
      this.endpoint('ACCESS_ACTIONS_SEARCH'),
      {
        RequestInfo: this.buildRequestInfo(),
        roleCodes: roleCodes || [],
        tenantId,
      }
    );

    return data.actions || [];
  }

  // ID Generation — generate IDs using configured formats
  async idgenGenerate(
    tenantId: string,
    idRequests: { idName: string; tenantId?: string; format?: string }[]
  ): Promise<{ id: string }[]> {
    const data = await this.request<{ idResponses?: { id: string }[] }>(
      this.endpoint('IDGEN_GENERATE'),
      {
        RequestInfo: this.buildRequestInfo(),
        idRequests: idRequests.map((r) => ({
          idName: r.idName,
          tenantId: r.tenantId || tenantId,
          format: r.format,
        })),
      }
    );

    return data.idResponses || [];
  }

  // Location — search boundaries via egov-location service
  async locationBoundarySearch(
    tenantId: string,
    boundaryType?: string,
    hierarchyType?: string
  ): Promise<Record<string, unknown>[]> {
    const body: Record<string, unknown> = {
      RequestInfo: this.buildRequestInfo(),
      tenantId,
    };
    if (boundaryType) body.boundaryType = boundaryType;
    if (hierarchyType) body.hierarchyType = hierarchyType;

    const data = await this.request<{ TenantBoundary?: Record<string, unknown>[] }>(
      this.endpoint('LOCATION_BOUNDARY_SEARCH'),
      body
    );

    return data.TenantBoundary || [];
  }

  // Encryption — encrypt values (no RequestInfo needed)
  // Note: enc-service returns a flat JSON array, not the standard {Errors, ...} envelope.
  // We use raw fetch instead of this.request() to handle the non-standard response.
  async encryptData(
    tenantId: string,
    values: string[]
  ): Promise<string[]> {
    const url = `${this.environment.url}${this.endpoint('ENC_ENCRYPT')}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        encryptionRequests: values.map((value) => ({
          tenantId,
          type: 'Normal',
          value,
        })),
      }),
    });

    if (!response.ok) {
      throw new Error(`Encryption failed: HTTP ${response.status}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }

  // Decryption — decrypt encrypted values (no RequestInfo needed)
  // Same non-standard response as encrypt.
  async decryptData(
    tenantId: string,
    encryptedValues: string[]
  ): Promise<string[]> {
    // The decrypt API expects a flat JSON array of encrypted strings, not an envelope
    const url = `${this.environment.url}${this.endpoint('ENC_DECRYPT')}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(encryptedValues),
    });

    if (!response.ok) {
      throw new Error(`Decryption failed: HTTP ${response.status}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }

  // Boundary — create boundary entities (batch)
  async boundaryCreate(
    tenantId: string,
    boundaries: { code: string; tenantId?: string; geometry?: Record<string, unknown> }[]
  ): Promise<Record<string, unknown>[]> {
    const defaultGeometry = { type: 'Point', coordinates: [0, 0] };
    const data = await this.request<{ Boundary?: Record<string, unknown>[] }>(
      this.endpoint('BOUNDARY_CREATE'),
      {
        RequestInfo: this.buildRequestInfo(),
        Boundary: boundaries.map((b) => ({
          tenantId: b.tenantId || tenantId,
          code: b.code,
          geometry: b.geometry || defaultGeometry,
        })),
      }
    );

    return data.Boundary || [];
  }

  // Boundary — create hierarchy definition
  async boundaryHierarchyCreate(
    tenantId: string,
    hierarchyType: string,
    boundaryHierarchy: { boundaryType: string; parentBoundaryType: string | null; active?: boolean }[]
  ): Promise<Record<string, unknown>> {
    const data = await this.request<{ BoundaryHierarchy?: Record<string, unknown> }>(
      this.endpoint('BOUNDARY_HIERARCHY_CREATE'),
      {
        RequestInfo: this.buildRequestInfo(),
        BoundaryHierarchy: {
          tenantId,
          hierarchyType,
          boundaryHierarchy: boundaryHierarchy.map((h) => ({
            boundaryType: h.boundaryType,
            parentBoundaryType: h.parentBoundaryType,
            active: h.active !== false,
          })),
        },
      }
    );

    return data.BoundaryHierarchy || {};
  }

  // Boundary — create a single boundary relationship (parent-child link)
  async boundaryRelationshipCreate(
    tenantId: string,
    code: string,
    hierarchyType: string,
    boundaryType: string,
    parent: string | null
  ): Promise<Record<string, unknown>> {
    const data = await this.request<{ BoundaryRelationship?: Record<string, unknown> }>(
      this.endpoint('BOUNDARY_RELATIONSHIP_CREATE'),
      {
        RequestInfo: this.buildRequestInfo(),
        BoundaryRelationship: {
          tenantId,
          code,
          hierarchyType,
          boundaryType,
          parent: parent || undefined,
        },
      }
    );

    return data.BoundaryRelationship || {};
  }

  // Boundary Management — process (upload/update boundary data)
  async boundaryMgmtProcess(
    tenantId: string,
    resourceDetails: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ tenantId });
    const data = await this.request<Record<string, unknown>>(
      `${this.endpoint('BNDRY_MGMT_PROCESS')}?${params.toString()}`,
      {
        RequestInfo: this.buildRequestInfo(),
        ResourceDetails: resourceDetails,
      }
    );

    return data;
  }

  // Boundary Management — search processed boundaries
  async boundaryMgmtSearch(
    tenantId: string
  ): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId });
    const data = await this.request<{ ResourceDetails?: Record<string, unknown>[] }>(
      `${this.endpoint('BNDRY_MGMT_PROCESS_SEARCH')}?${params.toString()}`,
      {
        RequestInfo: this.buildRequestInfo(),
      }
    );

    return data.ResourceDetails || [];
  }

  // Boundary Management — generate boundary codes
  async boundaryMgmtGenerate(
    tenantId: string,
    resourceDetails: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ tenantId });
    const data = await this.request<Record<string, unknown>>(
      `${this.endpoint('BNDRY_MGMT_GENERATE')}?${params.toString()}`,
      {
        RequestInfo: this.buildRequestInfo(),
        ResourceDetails: resourceDetails,
      }
    );

    return data;
  }

  // Boundary Management — download/search generated boundaries
  async boundaryMgmtDownload(
    tenantId: string
  ): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId });
    const data = await this.request<{ ResourceDetails?: Record<string, unknown>[] }>(
      `${this.endpoint('BNDRY_MGMT_GENERATE_SEARCH')}?${params.toString()}`,
      {
        RequestInfo: this.buildRequestInfo(),
      }
    );

    return data.ResourceDetails || [];
  }
}

// Singleton
export const digitApi = new DigitApiClient();
