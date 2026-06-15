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
      'Recomputes the ancestralmaterializedpath column (the pipe-separated chain of ANCESTOR ' +
      'codes, root→parent, excluding self; root rows are empty) for every boundary_relationship ' +
      'row of a tenant by walking the parent links. boundary-service builds the ' +
      'includeChildren=true nested tree FROM this path, so when it is empty the citizen ' +
      'create-complaint dropdown shows only the root with no cascade. Run after Phase 2 boundary ' +
      'creation to repair rows the wizard left with an empty path. Idempotent — safe to re-run. ' +
      'NOTE: this tool previously CLEARED the column to suppress a suspected duplicate-node bug; ' +
      'that broke the cascade, and populated paths are in fact the working norm (ke.citya / ' +
      'ke.nairobi carry them and render each boundary exactly once).',
    inputSchema: {
      type: 'object' as const,
      required: ['tenant_id'],
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID whose boundary_relationship paths should be recomputed (e.g. ke.bomet)',
        },
      },
    },
    handler: async (args) => {
      const tenantId = args.tenant_id as string;
      if (!tenantId) throw new Error('tenant_id is required');

      await digitDb.initialize();

      // Walk each tenant+hierarchy tree from its root(s) and set every node's path to
      // its ancestor chain (parent's path + parent's code, '|'-joined). Matches the
      // format boundary-service writes when relationships are created strictly
      // top-down — see ke.citya: B1_ADMIN_BLOCK => 'PG_CITYA_ADMIN_CITY|Z1_ADMIN_ZONE'.
      const rowsAffected = await digitDb.execute(
        `WITH RECURSIVE chain AS (
           SELECT tenantid, hierarchytype, code, ''::text AS path
           FROM boundary_relationship
           WHERE tenantid = $1 AND (parent IS NULL OR parent = '')
           UNION ALL
           SELECT r.tenantid, r.hierarchytype, r.code,
                  CASE WHEN c.path = '' THEN c.code ELSE c.path || '|' || c.code END
           FROM boundary_relationship r
           JOIN chain c
             ON r.parent = c.code
            AND r.tenantid = c.tenantid
            AND r.hierarchytype = c.hierarchytype
           WHERE r.tenantid = $1
         )
         UPDATE boundary_relationship b
         SET ancestralmaterializedpath = chain.path
         FROM chain
         WHERE b.tenantid = chain.tenantid
           AND b.hierarchytype = chain.hierarchytype
           AND b.code = chain.code`,
        [tenantId]
      );

      return JSON.stringify({
        success: true,
        tenant_id: tenantId,
        rowsAffected,
        message: `Recomputed ancestralmaterializedpath for ${rowsAffected} boundary relationship row(s) in tenant ${tenantId}.`,
      }, null, 2);
    },
  } satisfies ToolMetadata);
}
