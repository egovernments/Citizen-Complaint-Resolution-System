/**
 * Probe DIGIT service endpoints to detect availability.
 * Used by `configure` when connecting to an arbitrary base URL.
 */

export interface ServiceProbeResult {
  status: 'available' | 'not_found' | 'unreachable';
  endpoint?: string;
  error?: string;
}

export interface ProbeReport {
  services: Record<string, ServiceProbeResult>;
  detectedEndpointOverrides: Record<string, string>;
}

/**
 * Probe a single HTTP endpoint. Returns availability status.
 * - 2xx or 400 (bad request but service exists) → available
 * - 404 → not_found
 * - connection error / timeout → unreachable
 */
async function probeSingle(
  baseUrl: string,
  authToken: string,
  path: string,
  method: 'GET' | 'POST' = 'POST',
  body?: Record<string, unknown>,
): Promise<ServiceProbeResult> {
  try {
    const url = `${baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    const response = await fetch(url, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
      signal: AbortSignal.timeout(8000),
    });

    if (response.status === 404) {
      return { status: 'not_found' };
    }
    // Extract base service path (e.g. "/pgr-services/v2/request/_search" → "/pgr-services")
    const segments = path.split('/').filter(Boolean);
    const basePath = `/${segments[0]}`;
    return { status: 'available', endpoint: basePath };
  } catch (error) {
    return {
      status: 'unreachable',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Minimal DIGIT RequestInfo for probe requests */
function probeRequestInfo(authToken: string): Record<string, unknown> {
  return {
    apiId: 'Rainmaker',
    ver: '1.0',
    ts: Date.now(),
    msgId: `${Date.now()}|en_IN`,
    authToken,
  };
}

/**
 * Probe all known DIGIT services in two waves:
 * 1. MDMS endpoint detection (sequential — determines correct path)
 * 2. All other services (parallel)
 */
export async function probeServices(baseUrl: string, authToken: string): Promise<ProbeReport> {
  const report: ProbeReport = {
    services: {},
    detectedEndpointOverrides: {},
  };

  const ri = probeRequestInfo(authToken);

  // ── Wave 1: MDMS endpoint detection (sequential) ──
  const mdmsBody = { MdmsCriteria: { tenantId: 'default', schemaCode: 'tenant.tenants', limit: 1 } };

  const mdmsV2 = await probeSingle(baseUrl, authToken, '/mdms-v2/v2/_search', 'POST', mdmsBody);
  if (mdmsV2.status === 'available') {
    report.services.mdms = { status: 'available', endpoint: '/mdms-v2' };
    report.detectedEndpointOverrides.MDMS_SEARCH = '/mdms-v2/v2/_search';
    report.detectedEndpointOverrides.MDMS_CREATE = '/mdms-v2/v2/_create';
    report.detectedEndpointOverrides.MDMS_UPDATE = '/mdms-v2/v2/_update';
  } else {
    const legacy = await probeSingle(baseUrl, authToken, '/egov-mdms-service/v2/_search', 'POST', mdmsBody);
    if (legacy.status === 'available') {
      report.services.mdms = { status: 'available', endpoint: '/egov-mdms-service' };
      report.detectedEndpointOverrides.MDMS_SEARCH = '/egov-mdms-service/v2/_search';
      report.detectedEndpointOverrides.MDMS_CREATE = '/egov-mdms-service/v2/_create';
      report.detectedEndpointOverrides.MDMS_UPDATE = '/egov-mdms-service/v2/_update';
    } else {
      report.services.mdms = mdmsV2; // report original probe result
    }
  }

  // ── Wave 2: All other services (parallel) ──
  const probes: Array<{ name: string; path: string; method?: 'GET' | 'POST'; body?: Record<string, unknown> }> = [
    { name: 'pgr', path: '/pgr-services/v2/request/_search', body: { RequestInfo: ri } },
    { name: 'hrms', path: '/egov-hrms/employees/_search', body: { RequestInfo: ri, criteria: {} } },
    { name: 'boundary', path: '/boundary-service/boundary-hierarchy-definition/_search', body: { RequestInfo: ri } },
    { name: 'workflow', path: '/egov-workflow-v2/egov-wf/businessservice/_search', body: { RequestInfo: ri } },
    { name: 'localization', path: '/localization/messages/v1/_search', body: { RequestInfo: ri, MsgSearchCriteria: { tenantId: 'default', locale: 'en_IN' } } },
    { name: 'filestore', path: '/filestore/v1/files/url', method: 'GET' as const },
    { name: 'idgen', path: '/egov-idgen/id/_generate', body: { RequestInfo: ri, idRequests: [] } },
    { name: 'user', path: '/user/_search', body: { RequestInfo: ri } },
    { name: 'encryption', path: '/egov-enc-service/crypto/v1/_encrypt', body: { RequestInfo: ri } },
    { name: 'inbox', path: '/inbox/v2/_search', body: { RequestInfo: ri } },
  ];

  const results = await Promise.all(
    probes.map(async (p) => ({
      name: p.name,
      result: await probeSingle(baseUrl, authToken, p.path, p.method || 'POST', p.body),
    })),
  );

  for (const { name, result } of results) {
    report.services[name] = result;
  }

  return report;
}
