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

  // Create a new boundary hierarchy
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

    return response.BoundaryHierarchy as BoundaryHierarchy;
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

  // Search boundaries
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
    const response = await apiClient.post(ENDPOINTS.BOUNDARY_SEARCH, {
      RequestInfo: apiClient.buildRequestInfo(),
      Boundary: {
        tenantId,
        hierarchyType: options?.hierarchyType,
        boundaryType: options?.boundaryType,
        codes: options?.codes,
        limit: options?.limit || 100,
        offset: options?.offset || 0,
      },
    });

    // Flatten the nested boundary structure
    const tenantBoundaries = response.TenantBoundary || [];
    const boundaries: Boundary[] = [];

    for (const tb of tenantBoundaries as { boundary: Boundary }[]) {
      if (tb.boundary) {
        this.flattenBoundaries(tb.boundary, boundaries);
      }
    }

    return boundaries;
  },

  // Helper to flatten nested boundary tree
  flattenBoundaries(boundary: Boundary, result: Boundary[]): void {
    result.push({
      id: boundary.id,
      tenantId: boundary.tenantId,
      code: boundary.code,
      name: boundary.name,
      boundaryType: boundary.boundaryType,
      parent: boundary.parent,
      hierarchyType: boundary.hierarchyType,
      latitude: boundary.latitude,
      longitude: boundary.longitude,
    });

    if (boundary.children) {
      for (const child of boundary.children) {
        this.flattenBoundaries(child, result);
      }
    }
  },

  // Create a single boundary
  async createBoundary(boundary: Boundary): Promise<Boundary> {
    const response = await apiClient.post(ENDPOINTS.BOUNDARY_CREATE, {
      RequestInfo: apiClient.buildRequestInfo(),
      Boundary: boundary,
    });

    return response.Boundary as Boundary;
  },

  // Create multiple boundaries in order (respecting parent-child relationships)
  async createBoundaries(
    boundaries: Boundary[],
    onProgress?: (created: number, total: number) => void
  ): Promise<{
    success: Boundary[];
    failed: { boundary: Boundary; error: string }[];
  }> {
    const success: Boundary[] = [];
    const failed: { boundary: Boundary; error: string }[] = [];

    // Group boundaries by type/level for ordered creation
    const byLevel = this.groupByLevel(boundaries);

    let created = 0;
    for (const levelBoundaries of byLevel) {
      for (const boundary of levelBoundaries) {
        try {
          const result = await this.createBoundary(boundary);
          success.push(result);
          created++;
          onProgress?.(created, boundaries.length);
        } catch (error) {
          failed.push({
            boundary,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
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
