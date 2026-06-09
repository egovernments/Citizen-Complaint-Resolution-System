import type { ToolMetadata } from '../types/index.js';
import type { ToolRegistry } from './registry.js';
import { digitDb } from '../services/digit-db.js';

export function registerBoundaryTools(registry: ToolRegistry): void {
  registry.register({
    name: 'fix_boundary_paths',
    group: 'boundary',
    category: 'boundary-mgmt',
    risk: 'write',
    description:
      'Clears the ancestralmaterializedpath column for all boundary relationships of a tenant. ' +
      'Required after Phase 2 boundary creation to prevent the boundary-service includeChildren=true ' +
      'query from returning each node twice (the service combines a parent= query and an ' +
      'array-overlap query on ancestralmaterializedpath; emptying the column disables the second ' +
      'query so the citizen create-complaint dropdown shows each boundary exactly once).',
    inputSchema: {
      type: 'object' as const,
      required: ['tenant_id'],
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID whose boundary_relationship rows should be cleared (e.g. mz.maputo)',
        },
      },
    },
    handler: async (args) => {
      const tenantId = args.tenant_id as string;
      if (!tenantId) throw new Error('tenant_id is required');

      await digitDb.initialize();

      const rowsAffected = await digitDb.execute(
        `UPDATE boundary_relationship SET ancestralmaterializedpath = '' WHERE tenantid = $1`,
        [tenantId]
      );

      return JSON.stringify({
        success: true,
        tenant_id: tenantId,
        rowsAffected,
        message: `Cleared ancestralmaterializedpath for ${rowsAffected} boundary relationship row(s) in tenant ${tenantId}.`,
      }, null, 2);
    },
  } satisfies ToolMetadata);
}
