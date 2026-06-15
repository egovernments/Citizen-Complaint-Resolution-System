// Boundary Service
import { apiClient } from '../client';
import { ENDPOINTS } from '../config';
import type { Boundary, BoundaryHierarchy, BoundaryLevel } from '../types';

export const boundaryService = {
  // ============================================
  // Hierarchy Methods
  // ============================================

  // Get existing boundary hierarchies for a tenant
  async getHierarchies(tenantId: string): Promise<BoundaryHierarchy[]> {
    const response = await apiClient.post(ENDPOINTS.BOUNDARY_HIERARCHY_SEARCH, {
      RequestInfo: apiClient.buildRequestInfo(),
      BoundaryTypeHierarchySearchCriteria: {
        tenantId,
        limit: 100,
        offset: 0,
      },
    });

    const hierarchies = response.BoundaryHierarchy || [];
    return hierarchies as BoundaryHierarchy[];
  },

  // Create a new boundary hierarchy.
  //
  // Backend quirk: the create endpoint sends a single-object request
  // but responds with BoundaryHierarchy as an ARRAY (the search
  // endpoint uses the same response shape, which is also an array).
  // Casting the array directly to a single BoundaryHierarchy at the
  // type level silently succeeds — TS has no idea the shape is wrong
  // at runtime — and the caller ends up holding an object where
  // `.hierarchyType` is undefined.
  async createHierarchy(
    tenantId: string,
    hierarchyType: string,
    levels: BoundaryLevel[]
  ): Promise<BoundaryHierarchy> {
    const response = await apiClient.post(ENDPOINTS.BOUNDARY_HIERARCHY_CREATE, {
      RequestInfo: apiClient.buildRequestInfo(),
      BoundaryHierarchy: {
        tenantId,
        hierarchyType,
        boundaryHierarchy: levels,
      },
    });

    const raw = response.BoundaryHierarchy;
    if (Array.isArray(raw)) return raw[0] as BoundaryHierarchy;
    return raw as BoundaryHierarchy;
  },

  // Helper to create hierarchy from level names
  async createHierarchyFromLevels(
    tenantId: string,
    hierarchyType: string,
    levelNames: string[]
  ): Promise<BoundaryHierarchy> {
    const levels: BoundaryLevel[] = levelNames.map((name, index) => ({
      boundaryType: name,
      parentBoundaryType: index > 0 ? levelNames[index - 1] : undefined,
      active: true,
    }));

    return this.createHierarchy(tenantId, hierarchyType, levels);
  },

  // ============================================
  // Boundary Methods
  // ============================================

  // Search boundaries — returns the hierarchical tree flattened to a list.
  //
  // Uses /boundary-service/boundary-relationships/_search rather than
  // /boundary-service/boundary/_search: the latter looks up boundary
  // *entities* by code and does not return children, so asking it for
  // "everything under tenant X" comes back with nothing even when the
  // tree is fully seeded. The relationships endpoint walks the hierarchy
  // and accepts filters via query-string params (not body).
  async searchBoundaries(
    tenantId: string,
    options?: {
      hierarchyType?: string;
      boundaryType?: string;
      codes?: string[];
      limit?: number;
      offset?: number;
    }
  ): Promise<Boundary[]> {
    const qs = new URLSearchParams({ tenantId, includeChildren: 'true' });
    if (options?.hierarchyType) qs.set('hierarchyType', options.hierarchyType);
    if (options?.boundaryType)  qs.set('boundaryType',  options.boundaryType);
    if (options?.codes?.length) qs.set('codes',         options.codes.join(','));

    const response = await apiClient.post(
      `${ENDPOINTS.BOUNDARY_RELATIONSHIP_SEARCH}?${qs.toString()}`,
      { RequestInfo: apiClient.buildRequestInfo() },
    );

    // Response shape: TenantBoundary[] where each block has a `boundary`
    // field that may be either a single node or an array of roots. The
    // relationships endpoint also sometimes duplicates children under
    // their parent in the payload, so we dedupe by code as we flatten.
    const tenantBoundaries = response.TenantBoundary || [];
    const boundaries: Boundary[] = [];
    const seen = new Set<string>();

    for (const tb of tenantBoundaries as { boundary: Boundary | Boundary[]; hierarchyType?: string }[]) {
      if (!tb.boundary) continue;
      const items = Array.isArray(tb.boundary) ? tb.boundary : [tb.boundary];
      for (const root of items) {
        this.flattenBoundaries(root, boundaries, seen, tb.hierarchyType);
      }
    }

    return boundaries;
  },

  // Helper to flatten nested boundary tree
  // Flatten a nested boundary tree into a flat list, deduping by code
  // (the relationships endpoint duplicates children under their parent)
  // and carrying hierarchyType down from the parent TenantBoundary wrapper
  // when inner nodes don't have it set.
  flattenBoundaries(
    boundary: Boundary,
    result: Boundary[],
    seen?: Set<string>,
    hierarchyType?: string,
  ): void {
    const code = boundary.code;
    if (seen && code) {
      if (seen.has(code)) return;
      seen.add(code);
    }
    result.push({
      id: boundary.id,
      tenantId: boundary.tenantId,
      code: boundary.code,
      name: boundary.name,
      boundaryType: boundary.boundaryType,
      parent: boundary.parent,
      hierarchyType: boundary.hierarchyType ?? hierarchyType,
      latitude: boundary.latitude,
      longitude: boundary.longitude,
    });

    if (boundary.children) {
      for (const child of boundary.children) {
        this.flattenBoundaries(child, result, seen, hierarchyType);
      }
    }
  },

  // Create a boundary entity (just the entity, not the relationship).
  // If the backend reports "already exists", verify the entity truly lives
  // in the DB before swallowing — the boundary-service occasionally returns
  // a false-positive "already exists" when a prior request is still sitting
  // in its cache but the row never actually landed (also seen right after
  // a direct DB cleanup, before the service's in-memory dedup cache times
  // out). Blanket-swallowing that error made Phase 2 claim success while
  // creating nothing.
  async createBoundaryEntity(
    tenantId: string,
    code: string,
    geometry?: { type: 'Point' | 'Polygon'; coordinates: number[] | number[][][] },
  ): Promise<boolean> {
    // Default unit-square Polygon placeholder when the operator hasn't
    // supplied real geometry. Same shape Naipepea / Bomet have shipped for
    // every boundary to date — kept for compatibility so existing flows
    // don't change. Pass a real Point / Polygon to get an actual outline
    // on the citizen map.
    const PLACEHOLDER = {
      type: 'Polygon' as const,
      coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
    };
    try {
      await apiClient.post(ENDPOINTS.BOUNDARY_CREATE, {
        RequestInfo: apiClient.buildRequestInfo(),
        Boundary: [{
          tenantId,
          code,
          geometry: geometry ?? PLACEHOLDER,
        }],
      });
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.toLowerCase().includes('already exists') || errorMsg.includes('DUPLICATE')) {
        const found = await this.boundaryEntityExists(tenantId, code);
        if (found) return true;
        throw new Error(
          `Backend reported boundary entity ${code} already exists, but a search returned nothing. ` +
          `Retry may be needed, or a stale cache/Kafka state is masking the real error.`
        );
      }
      throw error;
    }
  },

  async boundaryEntityExists(tenantId: string, code: string): Promise<boolean> {
    try {
      const response = await apiClient.post(
        `${ENDPOINTS.BOUNDARY_SEARCH}?tenantId=${encodeURIComponent(tenantId)}&codes=${encodeURIComponent(code)}`,
        { RequestInfo: apiClient.buildRequestInfo() },
      );
      return ((response.Boundary as unknown[] | undefined)?.length ?? 0) > 0;
    } catch {
      return false;
    }
  },

  // Create a boundary relationship (parent-child link in hierarchy).
  // Same verify-before-swallow pattern as createBoundaryEntity — the
  // backend sometimes returns "already exists" for relationships that
  // never persisted. This was the root cause of Phase 2 silently
  // reporting "4 boundaries created" with 0 relationships in the DB.
  async createBoundaryRelationship(
    tenantId: string,
    hierarchyType: string,
    code: string,
    boundaryType: string,
    parentCode?: string
  ): Promise<boolean> {
    try {
      const payload: Record<string, unknown> = {
        RequestInfo: apiClient.buildRequestInfo(),
        BoundaryRelationship: {
          tenantId,
          hierarchyType,
          code,
          boundaryType,
        },
      };

      if (parentCode) {
        (payload.BoundaryRelationship as Record<string, unknown>).parent = parentCode;
      }

      await apiClient.post(ENDPOINTS.BOUNDARY_RELATIONSHIP_CREATE, payload);
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.toLowerCase().includes('already exists') || errorMsg.includes('DUPLICATE')) {
        const found = await this.boundaryRelationshipExists(tenantId, hierarchyType, code);
        if (found) return true;
        throw new Error(
          `Backend reported relationship ${code} (${hierarchyType}) already exists, ` +
          `but a search returned nothing. Likely a stale cache — try again in a few seconds ` +
          `or clean up and re-run.`
        );
      }
      throw error;
    }
  },

  async boundaryRelationshipExists(tenantId: string, hierarchyType: string, code: string): Promise<boolean> {
    try {
      const qs = new URLSearchParams({ tenantId, hierarchyType, codes: code, includeChildren: 'false' });
      const response = await apiClient.post(
        `${ENDPOINTS.BOUNDARY_RELATIONSHIP_SEARCH}?${qs.toString()}`,
        { RequestInfo: apiClient.buildRequestInfo() },
      );
      return ((response.TenantBoundary as unknown[] | undefined)?.length ?? 0) > 0;
    } catch {
      return false;
    }
  },

  // Poll boundary search until the given entity codes are readable. Entity
  // create is Kafka-backed (returns 200 before the row lands), so this gates
  // relationship creation on actual visibility. Searches in chunks with an
  // explicit limit — /boundary/_search defaults to ~50 results even when codes
  // are supplied, so without the limit the gate undercounts and stalls.
  async waitForEntityVisibility(
    tenantId: string,
    codes: string[],
    timeoutMs = 120000
  ): Promise<boolean> {
    const expected = new Set(codes);
    if (expected.size === 0) return true;
    const CHUNK = 100;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const seen = new Set<string>();
      for (let i = 0; i < codes.length; i += CHUNK) {
        const chunk = codes.slice(i, i + CHUNK);
        try {
          const qs = `tenantId=${encodeURIComponent(tenantId)}&codes=${chunk
            .map(encodeURIComponent)
            .join(',')}&limit=${chunk.length}`;
          const response = await apiClient.post(`${ENDPOINTS.BOUNDARY_SEARCH}?${qs}`, {
            RequestInfo: apiClient.buildRequestInfo(),
          });
          for (const b of (response.Boundary as { code: string }[] | undefined) ?? []) {
            if (expected.has(b.code)) seen.add(b.code);
          }
        } catch {
          // transient — keep polling
        }
      }
      if (seen.size >= expected.size) return true;
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  },

  // Create a single boundary (entity + relationship)
  async createBoundary(boundary: Boundary): Promise<Boundary> {
    // Step 1: Create the boundary entity (with geometry if attached, else
    // the unit-square placeholder).
    await this.createBoundaryEntity(boundary.tenantId, boundary.code, boundary.geometry);

    // Step 2: Create the boundary relationship
    if (boundary.hierarchyType && boundary.boundaryType) {
      await this.createBoundaryRelationship(
        boundary.tenantId,
        boundary.hierarchyType,
        boundary.code,
        boundary.boundaryType,
        boundary.parent
      );
    }

    return boundary;
  },

  // Create multiple boundaries: ALL entities first → visibility gate →
  // relationships top-down with retry. Previously this created each boundary's
  // entity+relationship coupled and sequentially, so children raced their
  // parent's not-yet-committed entity/relationship, got PARENT_NOT_FOUND, and
  // were silently dropped — digit-configurator#68, the reason
  // heal-boundary-relationships.py existed. Separating the passes, gating on
  // entity visibility, and retrying the residual lag closes that race.
  async createBoundaries(
    boundaries: Boundary[],
    onProgress?: (created: number, total: number) => void
  ): Promise<{
    success: Boundary[];
    failed: { boundary: Boundary; error: string }[];
  }> {
    const success: Boundary[] = [];
    const failed: { boundary: Boundary; error: string }[] = [];
    const total = boundaries.length;
    if (total === 0) return { success, failed };

    const tenantId = boundaries[0].tenantId;
    const byLevel = this.groupByLevel(boundaries);

    // Pass 1: create ALL entities first (every level). Forward each row's
    // geometry (from GeoJSON sidecar or lat/long) so the citizen UI gets
    // real outlines instead of unit-square placeholders.
    const failedEntities = new Set<string>();
    for (const levelBoundaries of byLevel) {
      for (const b of levelBoundaries) {
        try {
          await this.createBoundaryEntity(b.tenantId, b.code, b.geometry);
        } catch (error) {
          failedEntities.add(b.code);
          failed.push({
            boundary: b,
            error: error instanceof Error ? error.message : 'Unknown error (entity)',
          });
        }
      }
    }

    // Gate: wait until the created entities are readable before any relationship.
    await this.waitForEntityVisibility(
      tenantId,
      boundaries.filter((b) => !failedEntities.has(b.code)).map((b) => b.code)
    );

    // Pass 2: drive every relationship top-down once (best effort). No success
    // accounting here — createBoundaryRelationship returning 200 does NOT mean
    // the row persisted (boundary-service is Kafka-backed), so trusting the
    // return value is exactly how relationships got counted as created while
    // never landing. Accounting is deferred to the verify pass below.
    const expectedRel = boundaries.filter(
      (b) => !failedEntities.has(b.code) && b.hierarchyType && b.boundaryType
    );
    const hierarchyType = boundaries.find((b) => b.hierarchyType)?.hierarchyType;
    for (const levelBoundaries of byLevel) {
      for (const b of levelBoundaries) {
        if (failedEntities.has(b.code) || !b.hierarchyType || !b.boundaryType) continue;
        try {
          await this.createBoundaryRelationship(
            b.tenantId, b.hierarchyType, b.code, b.boundaryType, b.parent
          );
        } catch {
          // deferred to verify — the next pass re-checks ACTUAL presence
        }
      }
    }

    // Pass 3: VERIFY-DRIVEN completion — the bulletproofing. Re-query the real
    // relationship tree, find which expected codes are genuinely absent, and
    // re-drive ONLY those (parents first, so a missing parent is recreated
    // before its child is retried). Loop until nothing is missing. This catches
    // both error failures AND the 200-but-never-persisted case that error-retry
    // can't see, and a missing mid-level node's subtree heals over successive
    // rounds. This is what heal-boundary-relationships.py did out-of-band;
    // folding it in closes the race (#68) instead of mopping up after it.
    const expectedCodes = new Set(expectedRel.map((b) => b.code));
    let present = new Set<string>();
    if (hierarchyType && expectedRel.length > 0) {
      const VERIFY_ROUNDS = 12;
      for (let round = 0; round < VERIFY_ROUNDS; round++) {
        present = new Set<string>();
        try {
          const tree = await this.searchBoundaries(tenantId, { hierarchyType });
          for (const b of tree) if (expectedCodes.has(b.code)) present.add(b.code);
        } catch {
          // transient search failure — next round re-checks
        }
        const missing = expectedRel.filter((b) => !present.has(b.code));
        onProgress?.(total - missing.length, total);
        if (missing.length === 0) break;
        await new Promise((r) => setTimeout(r, 2000 * Math.min(round + 1, 4)));
        for (const levelBoundaries of this.groupByLevel(missing)) {
          for (const b of levelBoundaries) {
            try {
              await this.createBoundaryRelationship(
                b.tenantId, b.hierarchyType as string, b.code,
                b.boundaryType as string, b.parent
              );
            } catch {
              // re-checked next round
            }
          }
        }
      }
    }

    // Finalize from ACTUAL persistence, never from create() return values.
    for (const b of expectedRel) {
      if (present.has(b.code)) success.push(b);
      else
        failed.push({
          boundary: b,
          error:
            'Relationship still absent after verify retries — boundary-service ' +
            'persistence/visibility gap (parent may be missing).',
        });
    }

    return { success, failed };
  },

  // Group boundaries by level (parents first)
  groupByLevel(boundaries: Boundary[]): Boundary[][] {
    const levels: Map<string, Boundary[]> = new Map();
    const parentMap: Map<string, string | undefined> = new Map();

    // Build parent map
    for (const b of boundaries) {
      parentMap.set(b.code, b.parent);
      const type = b.boundaryType;
      if (!levels.has(type)) {
        levels.set(type, []);
      }
      levels.get(type)!.push(b);
    }

    // Sort levels by dependency (parents first)
    const sortedLevels: Boundary[][] = [];
    const processed = new Set<string>();

    const processLevel = (typeKey: string) => {
      if (processed.has(typeKey)) return;

      const levelBoundaries = levels.get(typeKey);
      if (!levelBoundaries || levelBoundaries.length === 0) return;

      // Check if parent level is processed
      const sampleBoundary = levelBoundaries[0];
      if (sampleBoundary.parent) {
        const parentBoundary = boundaries.find((b) => b.code === sampleBoundary.parent);
        if (parentBoundary && !processed.has(parentBoundary.boundaryType)) {
          processLevel(parentBoundary.boundaryType);
        }
      }

      sortedLevels.push(levelBoundaries);
      processed.add(typeKey);
    };

    for (const typeKey of levels.keys()) {
      processLevel(typeKey);
    }

    return sortedLevels;
  },

  // Get boundaries as tree structure
  async getBoundaryTree(
    tenantId: string,
    hierarchyType: string
  ): Promise<Boundary | null> {
    const response = await apiClient.post(ENDPOINTS.BOUNDARY_SEARCH, {
      RequestInfo: apiClient.buildRequestInfo(),
      Boundary: {
        tenantId,
        hierarchyType,
        limit: 1000,
        offset: 0,
      },
    });

    const tenantBoundaries = (response.TenantBoundary || []) as { boundary: Boundary }[];
    if (tenantBoundaries.length === 0) return null;

    return tenantBoundaries[0].boundary;
  },

  // Get boundary codes at a specific level
  async getBoundaryCodesAtLevel(
    tenantId: string,
    hierarchyType: string,
    boundaryType: string
  ): Promise<string[]> {
    const boundaries = await this.searchBoundaries(tenantId, {
      hierarchyType,
      boundaryType,
    });

    return boundaries.map((b) => b.code);
  },
};
