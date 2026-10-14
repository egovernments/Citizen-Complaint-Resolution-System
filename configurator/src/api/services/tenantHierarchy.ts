// The boundary hierarchy a screen starts on, per tenant: the configurator's
// side of digit-ui's products/pgr/src/services/tenantHierarchy.js. Lives apart
// from boundary.ts because it reads MDMS, and mdms.ts already imports boundary.ts.
import type { BoundaryHierarchy } from '../types';
import { boundaryService, getConfiguredHierarchyType, pickDefaultHierarchy } from './boundary';
import { mdmsService } from './mdms';

export interface TenantHierarchies {
  /** Every hierarchy defined on the tenant; empty when listing them failed. */
  hierarchies: BoundaryHierarchy[];
  /** The hierarchy to start on; undefined only when the tenant has none. */
  hierarchyType?: string;
  /** Why listing failed, so a screen can say so rather than report that none exist. */
  listError?: Error;
}

/**
 * Lists the tenant's hierarchies and picks the one to start on
 * (see pickDefaultHierarchy). When the list can't be read, the pick falls back
 * to what digit-ui and PGR use without one, the recorded hierarchy or else the
 * deployment's HIERARCHY_TYPE, so a failed walk never discards a known answer.
 */
export async function loadTenantHierarchies(tenantId: string): Promise<TenantHierarchies> {
  const [listed, recorded] = await Promise.all([
    boundaryService.getHierarchies(tenantId).then(
      (hierarchies) => ({ hierarchies, listError: undefined }),
      (err: unknown) => ({
        hierarchies: [] as BoundaryHierarchy[],
        listError: err instanceof Error ? err : new Error(String(err)),
      }),
    ),
    mdmsService.getRecordedHierarchyType(tenantId).catch(() => undefined),
  ]);
  if (listed.listError) {
    return { ...listed, hierarchyType: recorded ?? getConfiguredHierarchyType() };
  }
  return { hierarchies: listed.hierarchies, hierarchyType: pickDefaultHierarchy(listed.hierarchies, recorded)?.hierarchyType };
}
