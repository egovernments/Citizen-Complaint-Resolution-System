import type { ToolMetadata } from '../types/index.js';
import type { ToolRegistry } from './registry.js';
import { digitApi } from '../services/digit-api.js';
import { ENDPOINTS } from '../config/endpoints.js';

// Service definitions: name, endpoint key, and a minimal probe
interface ServiceProbe {
  name: string;
  service: string;
  endpointKey: keyof typeof ENDPOINTS;
  method: 'POST' | 'GET';
  // Build the probe body/params for this service
  buildProbe: (tenantId: string) => { body?: Record<string, unknown>; params?: Record<string, string> };
  requiresAuth: boolean;
}

const SERVICE_PROBES: ServiceProbe[] = [
  {
    name: 'MDMS v2',
    service: 'egov-mdms-service',
    endpointKey: 'MDMS_SEARCH',
    method: 'POST',
    buildProbe: (tenantId) => ({
      body: {
        MdmsCriteria: { tenantId, schemaCode: 'tenant.tenants', limit: 1, offset: 0 },
      },
    }),
    requiresAuth: true,
  },
  {
    name: 'Boundary Service',
    service: 'boundary-service',
    endpointKey: 'BOUNDARY_SEARCH',
    method: 'POST',
    buildProbe: (tenantId) => ({
      body: { Boundary: { tenantId, limit: 1, offset: 0 } },
    }),
    requiresAuth: true,
  },
  {
    name: 'HRMS',
    service: 'egov-hrms',
    endpointKey: 'HRMS_EMPLOYEES_SEARCH',
    method: 'POST',
    buildProbe: (tenantId) => ({
      params: { tenantId, limit: '1', offset: '0' },
    }),
    requiresAuth: true,
  },
  {
    name: 'Localization',
    service: 'egov-localization',
    endpointKey: 'LOCALIZATION_SEARCH',
    method: 'POST',
    buildProbe: (tenantId) => ({
      params: { tenantId, locale: 'en_IN' },
    }),
    requiresAuth: true,
  },
  {
    name: 'PGR Services',
    service: 'pgr-services',
    endpointKey: 'PGR_SEARCH',
    method: 'POST',
    buildProbe: (tenantId) => ({
      params: { tenantId, limit: '1', offset: '0' },
    }),
    requiresAuth: true,
  },
  {
    name: 'Workflow v2',
    service: 'egov-workflow-v2',
    endpointKey: 'WORKFLOW_BUSINESS_SERVICE_SEARCH',
    method: 'POST',
    buildProbe: (tenantId) => ({
      params: { tenantId },
    }),
    requiresAuth: true,
  },
  {
    name: 'Filestore',
    service: 'egov-filestore',
    endpointKey: 'FILESTORE_URL',
    method: 'GET',
    buildProbe: (tenantId) => ({
      params: { tenantId, fileStoreIds: 'health-check-probe' },
    }),
    requiresAuth: true,
  },
  {
    name: 'Access Control',
    service: 'egov-accesscontrol',
    endpointKey: 'ACCESS_ROLES_SEARCH',
    method: 'POST',
    buildProbe: (tenantId) => ({
      params: { tenantId },
    }),
    requiresAuth: true,
  },
  {
    name: 'ID Generation',
    service: 'egov-idgen',
    endpointKey: 'IDGEN_GENERATE',
    method: 'POST',
    buildProbe: (tenantId) => ({
      body: { idRequests: [{ idName: 'health.check', tenantId }] },
    }),
    requiresAuth: true,
  },
  {
    name: 'Location',
    service: 'egov-location',
    endpointKey: 'LOCATION_BOUNDARY_SEARCH',
    method: 'POST',
    buildProbe: (tenantId) => ({
      body: { tenantId },
    }),
    requiresAuth: true,
  },
  {
    name: 'Encryption',
    service: 'egov-enc-service',
    endpointKey: 'ENC_ENCRYPT',
    method: 'POST',
    buildProbe: (tenantId) => ({
      body: { encryptionRequests: [{ tenantId, type: 'Normal', value: 'healthcheck' }] },
    }),
    requiresAuth: false,
  },
];

interface ProbeResult {
  service: string;
  name: string;
  status: 'healthy' | 'unhealthy' | 'skipped';
  responseTimeMs: number;
  statusCode?: number;
  error?: string;
}

export function registerHealthCheckTools(registry: ToolRegistry): void {
  registry.register({
    name: 'health_check',
    group: 'core',
    category: 'discovery',
    risk: 'read',
    description:
      'Check the health of all DIGIT platform services by probing their API endpoints. Returns the status, response time, and any errors for each service. Requires authentication (call configure first) for most services. The encryption service is checked without auth.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID to use for health check probes (defaults to environment state tenant)',
        },
        timeout_ms: {
          type: 'number',
          description: 'Timeout per service probe in milliseconds (default: 10000)',
        },
      },
    },
    handler: async (args) => {
      const timeoutMs = (args.timeout_ms as number) || 10000;
      const envInfo = digitApi.getEnvironmentInfo();
      const tenantId = (args.tenant_id as string) || envInfo.stateTenantId;
      const authInfo = digitApi.getAuthInfo();
      const baseUrl = envInfo.url;

      const results: ProbeResult[] = [];
      let healthy = 0;
      let unhealthy = 0;
      let skipped = 0;

      for (const probe of SERVICE_PROBES) {
        if (probe.requiresAuth && !authInfo.authenticated) {
          results.push({
            service: probe.service,
            name: probe.name,
            status: 'skipped',
            responseTimeMs: 0,
            error: 'Not authenticated — call configure first',
          });
          skipped++;
          continue;
        }

        const start = Date.now();
        try {
          const probeData = probe.buildProbe(tenantId);
          const endpointPath = envInfo.endpointOverrides?.[probe.endpointKey] || ENDPOINTS[probe.endpointKey];
          let url = `${baseUrl}${endpointPath}`;

          if (probeData.params) {
            url += '?' + new URLSearchParams(probeData.params).toString();
          }

          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (probe.requiresAuth && authInfo.authenticated && authInfo.token) {
            headers['Authorization'] = `Bearer ${authInfo.token}`;
          }

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);

          const body = probe.method === 'POST'
            ? JSON.stringify({
                RequestInfo: {
                  apiId: 'Rainmaker',
                  ver: '1.0',
                  ts: Date.now(),
                  msgId: `${Date.now()}|en_IN`,
                  authToken: authInfo.token || '',
                },
                ...probeData.body,
              })
            : undefined;

          const response = await fetch(url, {
            method: probe.method,
            headers,
            body,
            signal: controller.signal,
          });

          clearTimeout(timer);
          const elapsed = Date.now() - start;

          if (response.ok || response.status === 400 || response.status === 403) {
            // 400/403 means the service is up but rejected the probe request — that's healthy
            results.push({
              service: probe.service,
              name: probe.name,
              status: 'healthy',
              responseTimeMs: elapsed,
              statusCode: response.status,
            });
            healthy++;
          } else {
            results.push({
              service: probe.service,
              name: probe.name,
              status: 'unhealthy',
              responseTimeMs: elapsed,
              statusCode: response.status,
              error: `HTTP ${response.status}`,
            });
            unhealthy++;
          }
        } catch (err) {
          const elapsed = Date.now() - start;
          const message = err instanceof Error ? err.message : String(err);
          results.push({
            service: probe.service,
            name: probe.name,
            status: 'unhealthy',
            responseTimeMs: elapsed,
            error: message.includes('abort') ? `Timeout after ${timeoutMs}ms` : message,
          });
          unhealthy++;
        }
      }

      return JSON.stringify({
        success: true,
        environment: envInfo.name,
        baseUrl,
        tenantId,
        authenticated: authInfo.authenticated,
        summary: {
          total: SERVICE_PROBES.length,
          healthy,
          unhealthy,
          skipped,
        },
        services: results,
      }, null, 2);
    },
  } satisfies ToolMetadata);
}
