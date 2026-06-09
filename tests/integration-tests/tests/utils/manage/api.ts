/**
 * Minimal DIGIT API client for tests.
 *
 * Reads the auth token out of the storageState that auth.setup.ts wrote,
 * then exposes the handful of mdms / pgr / hrms calls the manage specs
 * need for setup, assertion, and teardown. Payload shapes mirror
 * digit-cfg-fix/packages/data-provider/src/client/DigitApiClient.ts so
 * server contracts stay in sync.
 *
 * The token is never logged, even when DEBUG is set.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface AuthInfo {
  token: string;
  user: Record<string, unknown> | null;
  tenant: string;
  baseUrl: string;
}

export interface MdmsRecord {
  id?: string;
  tenantId: string;
  schemaCode: string;
  uniqueIdentifier: string;
  data: Record<string, unknown>;
  isActive?: boolean;
  auditDetails?: Record<string, unknown>;
}

interface StorageState {
  cookies?: unknown[];
  origins?: Array<{
    origin: string;
    localStorage?: Array<{ name: string; value: string }>;
  }>;
}

const DEFAULT_AUTH_FILE = path.resolve('auth.json');

/** Lift the configurator's stored session out of the storageState file. */
export function loadAuth(authFile: string = DEFAULT_AUTH_FILE): AuthInfo {
  const raw = readFileSync(authFile, 'utf-8');
  const state = JSON.parse(raw) as StorageState;

  for (const origin of state.origins || []) {
    const item = (origin.localStorage || []).find(
      (entry) => entry.name === 'crs-auth-state',
    );
    if (!item) continue;
    const parsed = JSON.parse(item.value) as {
      authToken?: string;
      user?: Record<string, unknown>;
      tenant?: string;
      environment?: string;
    };
    if (!parsed.authToken) {
      throw new Error('crs-auth-state present but has no authToken');
    }
    return {
      token: parsed.authToken,
      user: parsed.user || null,
      tenant: parsed.tenant || (process.env.TENANT_CODE || 'ke'),
      baseUrl:
        parsed.environment ||
        process.env.BASE_URL ||
        'https://naipepea.digit.org',
    };
  }

  throw new Error(
    `No crs-auth-state localStorage entry found in ${authFile}. ` +
    'Did the auth.setup.ts setup project run?',
  );
}

function buildRequestInfo(auth: AuthInfo, action?: string): Record<string, unknown> {
  return {
    apiId: 'Rainmaker',
    ver: '1.0',
    ts: Date.now(),
    action,
    msgId: `${Date.now()}|en_IN`,
    authToken: auth.token,
    userInfo: auth.user || undefined,
  };
}

interface ApiError { code?: string; message?: string }

async function postJson<T>(
  auth: AuthInfo,
  pathWithQuery: string,
  body: Record<string, unknown>,
): Promise<T> {
  const url = `${auth.baseUrl}${pathWithQuery}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify(body),
  });

  // The configurator expects JSON for every endpoint we call.
  let parsed: Record<string, unknown> = {};
  try {
    parsed = (await res.json()) as Record<string, unknown>;
  } catch {
    // Fall through — empty bodies are fine for some 204-ish paths.
  }

  if (!res.ok || (parsed.Errors as ApiError[] | undefined)?.length) {
    const errors = (parsed.Errors as ApiError[]) || [
      { code: `HTTP_${res.status}`, message: (parsed.message as string) || res.statusText },
    ];
    const summary = errors.map((e) => `${e.code || '??'}:${e.message || ''}`).join(', ');
    throw new Error(`POST ${pathWithQuery} failed (${res.status}): ${summary}`);
  }

  return parsed as T;
}

// --- MDMS v2 ---

export async function mdmsSearch(
  auth: AuthInfo,
  tenantId: string,
  schemaCode: string,
  options?: { limit?: number; offset?: number; uniqueIdentifiers?: string[] },
): Promise<MdmsRecord[]> {
  const criteria: Record<string, unknown> = {
    tenantId,
    schemaCode,
    limit: options?.limit ?? 100,
    offset: options?.offset ?? 0,
  };
  if (options?.uniqueIdentifiers?.length) {
    criteria.uniqueIdentifiers = options.uniqueIdentifiers;
  }
  const data = await postJson<{ mdms?: MdmsRecord[] }>(
    auth,
    '/mdms-v2/v2/_search',
    { RequestInfo: buildRequestInfo(auth), MdmsCriteria: criteria },
  );
  return data.mdms || [];
}

export async function mdmsCreate(
  auth: AuthInfo,
  tenantId: string,
  schemaCode: string,
  uniqueIdentifier: string,
  recordData: Record<string, unknown>,
): Promise<MdmsRecord> {
  const data = await postJson<{ mdms?: MdmsRecord[] }>(
    auth,
    `/mdms-v2/v2/_create/${schemaCode}`,
    {
      RequestInfo: buildRequestInfo(auth),
      Mdms: {
        tenantId,
        schemaCode,
        uniqueIdentifier,
        data: recordData,
        isActive: true,
      },
    },
  );
  return (data.mdms || [])[0] as MdmsRecord;
}

export async function mdmsUpdate(
  auth: AuthInfo,
  record: MdmsRecord,
  isActive: boolean,
): Promise<MdmsRecord> {
  const data = await postJson<{ mdms?: MdmsRecord[] }>(
    auth,
    `/mdms-v2/v2/_update/${record.schemaCode}`,
    {
      RequestInfo: buildRequestInfo(auth),
      Mdms: {
        tenantId: record.tenantId,
        schemaCode: record.schemaCode,
        uniqueIdentifier: record.uniqueIdentifier,
        id: record.id,
        data: record.data,
        auditDetails: record.auditDetails,
        isActive,
      },
    },
  );
  return (data.mdms || [])[0] as MdmsRecord;
}

// --- PGR ---

export interface PgrSearchOptions {
  serviceRequestId?: string;
  status?: string;
  limit?: number;
  offset?: number;
  fromDate?: number;
  toDate?: number;
}

export async function pgrSearch(
  auth: AuthInfo,
  tenantId: string,
  options?: PgrSearchOptions,
): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({ tenantId });
  if (options?.serviceRequestId) params.append('serviceRequestId', options.serviceRequestId);
  if (options?.status) params.append('applicationStatus', options.status);
  if (options?.fromDate) params.append('fromDate', String(options.fromDate));
  if (options?.toDate) params.append('toDate', String(options.toDate));
  params.append('limit', String(options?.limit ?? 50));
  params.append('offset', String(options?.offset ?? 0));

  const data = await postJson<{ ServiceWrappers?: Record<string, unknown>[] }>(
    auth,
    `/pgr-services/v2/request/_search?${params.toString()}`,
    { RequestInfo: buildRequestInfo(auth) },
  );
  return data.ServiceWrappers || [];
}

export async function pgrCount(
  auth: AuthInfo,
  tenantId: string,
  options?: Pick<PgrSearchOptions, 'status' | 'fromDate' | 'toDate'>,
): Promise<number> {
  const params = new URLSearchParams({ tenantId });
  if (options?.status) params.append('applicationStatus', options.status);
  if (options?.fromDate) params.append('fromDate', String(options.fromDate));
  if (options?.toDate) params.append('toDate', String(options.toDate));

  const data = await postJson<{ count?: number }>(
    auth,
    `/pgr-services/v2/request/_count?${params.toString()}`,
    { RequestInfo: buildRequestInfo(auth) },
  );
  return typeof data.count === 'number' ? data.count : 0;
}

export interface PgrUpdateOptions {
  comment?: string;
  assignees?: string[];
  rating?: number;
}

export async function pgrUpdate(
  auth: AuthInfo,
  service: Record<string, unknown>,
  action: string,
  options?: PgrUpdateOptions,
): Promise<Record<string, unknown>> {
  const workflow: Record<string, unknown> = {
    action,
    assignees: options?.assignees || [],
    comments: options?.comment,
  };
  if (options?.rating !== undefined) workflow.rating = options.rating;

  const data = await postJson<{ ServiceWrappers?: Record<string, unknown>[] }>(
    auth,
    '/pgr-services/v2/request/_update',
    {
      RequestInfo: buildRequestInfo(auth),
      service,
      workflow,
    },
  );
  return (data.ServiceWrappers || [])[0] || {};
}

// --- HRMS ---

export async function employeeSearch(
  auth: AuthInfo,
  tenantId: string,
  options?: { roles?: string[]; limit?: number; offset?: number },
): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({ tenantId });
  if (options?.roles?.length) {
    // The HRMS endpoint accepts `roles` as a comma-joined param.
    params.append('roles', options.roles.join(','));
  }
  params.append('limit', String(options?.limit ?? 100));
  params.append('offset', String(options?.offset ?? 0));

  const data = await postJson<{ Employees?: Record<string, unknown>[] }>(
    auth,
    `/egov-hrms/employees/_search?${params.toString()}`,
    { RequestInfo: buildRequestInfo(auth) },
  );
  return data.Employees || [];
}
