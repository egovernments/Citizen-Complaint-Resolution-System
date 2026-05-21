import type { ToolMetadata } from '../types/index.js';
import type { ToolRegistry } from './registry.js';
import { digitApi } from '../services/digit-api.js';

export function registerIdgenLocationTools(registry: ToolRegistry): void {
  // ──────────────────────────────────────────
  // idgen group
  // ──────────────────────────────────────────

  registry.register({
    name: 'idgen_generate',
    group: 'idgen',
    category: 'idgen',
    risk: 'write',
    description:
      'Generate unique IDs using DIGIT ID generation service. Produces formatted IDs (e.g. complaint numbers, application numbers) based on pre-configured ID formats. Requires an idName that matches a configured format in the target environment.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID for ID generation',
        },
        id_name: {
          type: 'string',
          description: 'ID format name (e.g. "pgr.servicerequestid", "rainmaker.pgr.count")',
        },
        id_format: {
          type: 'string',
          description: 'Optional custom ID format string (e.g. "PG-PGR-[cy:yyyy-MM-dd]-[SEQ_PGR]")',
        },
        count: {
          type: 'number',
          description: 'Number of IDs to generate (default: 1)',
        },
      },
      required: ['tenant_id', 'id_name'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;
      const idName = args.id_name as string;
      const format = args.id_format as string | undefined;
      const count = (args.count as number) || 1;

      const idRequests = Array.from({ length: count }, () => ({
        idName,
        tenantId,
        format,
      }));

      const responses = await digitApi.idgenGenerate(tenantId, idRequests);

      return JSON.stringify(
        {
          success: true,
          count: responses.length,
          ids: responses.map((r) => r.id),
          idName,
          tenantId,
        },
        null,
        2
      );
    },
  } satisfies ToolMetadata);

  // ──────────────────────────────────────────
  // location group
  // ──────────────────────────────────────────

  registry.register({
    name: 'location_search',
    group: 'location',
    category: 'location',
    risk: 'read',
    description:
      'Search geographic boundaries using the legacy egov-location service. This service is NOT available in all environments. For boundary data, prefer "validate_boundary" (boundary-service) which is available everywhere.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID to search boundaries for',
        },
        boundary_type: {
          type: 'string',
          description: 'Boundary type filter (e.g. "City", "Ward", "Block")',
        },
        hierarchy_type: {
          type: 'string',
          description: 'Hierarchy type (e.g. "ADMIN", "REVENUE")',
        },
      },
      required: ['tenant_id'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;
      const boundaryType = args.boundary_type as string | undefined;
      const hierarchyType = args.hierarchy_type as string | undefined;

      try {
        const boundaries = await digitApi.locationBoundarySearch(
          tenantId,
          boundaryType,
          hierarchyType
        );

        return JSON.stringify(
          { success: true, count: boundaries.length, boundaries, tenantId },
          null,
          2
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const isDnsError = msg.includes('dns') || msg.includes('ENOTFOUND') || msg.includes('resolve');
        return JSON.stringify({
          success: false,
          error: msg,
          hint: isDnsError
            ? 'The egov-location service is not deployed in this environment. ' +
              'Use "validate_boundary" instead — it queries boundary-service which is available in all environments.'
            : 'The egov-location service returned an error. ' +
              'This is a legacy service. Use "validate_boundary" (boundary-service) as the preferred alternative.',
          alternatives: [
            { tool: 'validate_boundary', purpose: 'Read boundary hierarchy from boundary-service (recommended, works in all environments)' },
            { tool: 'mdms_get_tenants', purpose: 'List available tenants to find correct tenant IDs' },
          ],
        }, null, 2);
      }
    },
  } satisfies ToolMetadata);
}

// Auto-login helper
async function ensureAuthenticated(): Promise<void> {
  if (digitApi.isAuthenticated()) return;

  const username = process.env.CRS_USERNAME;
  const password = process.env.CRS_PASSWORD;
  const tenantId = process.env.CRS_TENANT_ID || digitApi.getEnvironmentInfo().stateTenantId;

  if (!username || !password) {
    throw new Error(
      'Not authenticated. Call the "configure" tool first, or set CRS_USERNAME/CRS_PASSWORD env vars.'
    );
  }

  await digitApi.login(username, password, tenantId);
}
