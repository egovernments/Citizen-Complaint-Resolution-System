import type { ToolMetadata, ValidationResult } from '../types/index.js';
import { MDMS_SCHEMAS } from '../types/index.js';
import type { ToolRegistry } from './registry.js';
import { digitApi } from '../services/digit-api.js';
import { validateTenantId, validateResourceId } from '../utils/validation.js';

/**
 * Build an ordered list of boundary types from a hierarchy definition.
 * Input is an unordered array of { boundaryType, parentBoundaryType }.
 * Returns types ordered root-first (e.g. ["Country", "State", "District", ...]).
 */
export function buildOrderedLevels(
  hierarchy: { boundaryType: string; parentBoundaryType?: string | null }[]
): string[] {
  const childMap = new Map<string, string>();
  let root: string | null = null;

  for (const h of hierarchy) {
    if (!h.parentBoundaryType) {
      root = h.boundaryType;
    } else {
      childMap.set(h.parentBoundaryType, h.boundaryType);
    }
  }

  if (!root) return hierarchy.map((h) => h.boundaryType);

  const ordered: string[] = [];
  const visited = new Set<string>();
  let current: string | undefined = root;
  while (current && !visited.has(current)) {
    visited.add(current);
    ordered.push(current);
    current = childMap.get(current);
  }
  return ordered;
}

export function registerValidatorTools(registry: ToolRegistry): void {
  // ──────────────────────────────────────────
  // boundary group
  // ──────────────────────────────────────────

  registry.register({
    name: 'validate_boundary',
    group: 'boundary',
    category: 'validation',
    risk: 'read',
    description:
      'Validate boundary setup for a tenant. Checks that boundary hierarchy exists and boundaries are defined. Reports missing levels or empty boundary trees.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID to validate boundaries for',
        },
        hierarchy_type: {
          type: 'string',
          description: 'Boundary hierarchy type (default: "ADMIN")',
        },
      },
      required: ['tenant_id'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;
      const hierarchyType = (args.hierarchy_type as string) || 'ADMIN';

      const result: ValidationResult = {
        valid: true,
        errors: [],
        warnings: [],
        summary: '',
      };

      try {
        // Use relationship tree search (returns TenantBoundary with parent-child tree)
        const tenantBoundaries = await digitApi.boundaryRelationshipTreeSearch(tenantId, hierarchyType);

        if (tenantBoundaries.length === 0) {
          // Fallback: check if flat boundary entities exist (created but no relationships yet)
          const entities = await digitApi.boundarySearch(tenantId, hierarchyType);
          if (entities.length > 0) {
            result.warnings.push({
              field: 'boundary',
              message: `Found ${entities.length} boundary entities but no relationship tree. Boundaries may need relationships created.`,
            });
            result.summary = `Found ${entities.length} boundary entity/entities but no relationship tree for hierarchy "${hierarchyType}"`;
          } else {
            result.valid = false;
            result.errors.push({
              field: 'boundary',
              message: `No boundaries found for tenant "${tenantId}" with hierarchy type "${hierarchyType}"`,
              code: 'BOUNDARY_MISSING',
            });
          }
        } else {
          // Count boundary nodes in the tree
          let totalNodes = 0;
          const countNodes = (items: unknown[]): void => {
            for (const item of items) {
              totalNodes++;
              const rec = item as Record<string, unknown>;
              if (Array.isArray(rec.children)) {
                countNodes(rec.children);
              }
            }
          };

          for (const tb of tenantBoundaries) {
            const boundaryList = tb.boundary;
            if (Array.isArray(boundaryList)) {
              countNodes(boundaryList);
            }
          }

          if (totalNodes < 2) {
            result.warnings.push({
              field: 'boundary',
              message: `Only ${totalNodes} boundary node(s) found. A typical setup has multiple levels (state > district > city > ward).`,
            });
          }

          result.summary = `Found ${tenantBoundaries.length} boundary tree(s) with ${totalNodes} total node(s) for hierarchy "${hierarchyType}"`;
        }
      } catch (error) {
        result.valid = false;
        result.errors.push({
          field: 'boundary',
          message: error instanceof Error ? error.message : String(error),
          code: 'BOUNDARY_API_ERROR',
        });
      }

      if (!result.summary) {
        result.summary = result.valid
          ? 'Boundary validation passed'
          : `Boundary validation failed with ${result.errors.length} error(s)`;
      }

      return JSON.stringify({ success: true, validation: result }, null, 2);
    },
  } satisfies ToolMetadata);

  registry.register({
    name: 'boundary_hierarchy_search',
    group: 'boundary',
    category: 'validation',
    risk: 'read',
    description:
      'Search boundary hierarchy definitions for a tenant. Returns the hierarchy type structure showing what boundary levels exist (e.g. Country > State > District > City > Ward > Locality). ' +
      'Useful for understanding the boundary structure before creating or validating boundaries.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID to search hierarchy for',
        },
        hierarchy_type: {
          type: 'string',
          description: 'Filter by hierarchy type (e.g. "ADMIN"). Omit to list all hierarchies.',
        },
      },
      required: ['tenant_id'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      try {
        const hierarchies = await digitApi.boundaryHierarchySearch(
          args.tenant_id as string,
          args.hierarchy_type as string | undefined
        );

        return JSON.stringify(
          {
            success: true,
            tenantId: args.tenant_id,
            count: hierarchies.length,
            hierarchies,
          },
          null,
          2
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return JSON.stringify({
          success: false,
          error: msg,
          hint: 'Boundary hierarchy search failed. Use validate_boundary as an alternative to see the boundary tree for a tenant.',
          alternatives: [
            { tool: 'validate_boundary', purpose: 'Validate and view boundary tree for a tenant' },
          ],
        }, null, 2);
      }
    },
  } satisfies ToolMetadata);

  // ──────────────────────────────────────────
  // masters group — departments, designations, complaint types
  // ──────────────────────────────────────────

  registry.register({
    name: 'validate_departments',
    group: 'masters',
    category: 'validation',
    risk: 'read',
    description:
      'Validate department setup for a tenant. Checks that required departments exist in MDMS and flags any inactive departments.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID to validate departments for',
        },
        required_departments: {
          type: 'array',
          items: { type: 'string' },
          description: 'Department codes that must exist (optional — if omitted, just lists what exists)',
        },
      },
      required: ['tenant_id'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;
      const required = (args.required_departments || []) as string[];

      const departments = await digitApi.mdmsV2Search<Record<string, unknown>>(
        tenantId,
        MDMS_SCHEMAS.DEPARTMENT
      );

      const result: ValidationResult = {
        valid: true,
        errors: [],
        warnings: [],
        summary: '',
      };

      const deptCodes = new Set(departments.map((d) => d.code as string));

      // Check required departments
      for (const code of required) {
        if (!deptCodes.has(code)) {
          result.valid = false;
          result.errors.push({
            field: 'department',
            value: code,
            message: `Required department "${code}" not found`,
            code: 'DEPARTMENT_MISSING',
          });
        }
      }

      // Check for inactive departments
      for (const dept of departments) {
        if (dept.active === false) {
          result.warnings.push({
            field: 'department',
            value: dept.code as string,
            message: `Department "${dept.code}" is inactive`,
          });
        }
      }

      if (departments.length === 0) {
        result.valid = false;
        result.errors.push({
          field: 'department',
          message: `No departments found for tenant "${tenantId}"`,
          code: 'NO_DEPARTMENTS',
        });
      }

      result.summary = `Found ${departments.length} department(s)${required.length ? `, ${required.length - result.errors.length}/${required.length} required present` : ''}`;

      return JSON.stringify(
        {
          success: true,
          validation: result,
          departments: departments.map((d) => ({
            code: d.code,
            name: d.name,
            active: d.active,
          })),
        },
        null,
        2
      );
    },
  } satisfies ToolMetadata);

  registry.register({
    name: 'validate_designations',
    group: 'masters',
    category: 'validation',
    risk: 'read',
    description:
      'Validate designation setup for a tenant. Checks that designations exist in MDMS. Optionally validates that specific designation codes are present.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID to validate designations for',
        },
        required_designations: {
          type: 'array',
          items: { type: 'string' },
          description: 'Designation codes that must exist (optional)',
        },
      },
      required: ['tenant_id'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;
      const required = (args.required_designations || []) as string[];

      const designations = await digitApi.mdmsV2Search<Record<string, unknown>>(
        tenantId,
        MDMS_SCHEMAS.DESIGNATION
      );

      const result: ValidationResult = {
        valid: true,
        errors: [],
        warnings: [],
        summary: '',
      };

      const desigCodes = new Set(designations.map((d) => d.code as string));

      for (const code of required) {
        if (!desigCodes.has(code)) {
          result.valid = false;
          result.errors.push({
            field: 'designation',
            value: code,
            message: `Required designation "${code}" not found`,
            code: 'DESIGNATION_MISSING',
          });
        }
      }

      for (const desig of designations) {
        if (desig.active === false) {
          result.warnings.push({
            field: 'designation',
            value: desig.code as string,
            message: `Designation "${desig.code}" is inactive`,
          });
        }
      }

      if (designations.length === 0) {
        result.valid = false;
        result.errors.push({
          field: 'designation',
          message: `No designations found for tenant "${tenantId}"`,
          code: 'NO_DESIGNATIONS',
        });
      }

      result.summary = `Found ${designations.length} designation(s)${required.length ? `, ${required.length - result.errors.length}/${required.length} required present` : ''}`;

      return JSON.stringify(
        {
          success: true,
          validation: result,
          designations: designations.map((d) => ({
            code: d.code,
            name: d.name,
            active: d.active,
          })),
        },
        null,
        2
      );
    },
  } satisfies ToolMetadata);

  registry.register({
    name: 'validate_complaint_types',
    group: 'masters',
    category: 'validation',
    risk: 'read',
    description:
      'Validate PGR complaint type / service definition setup for a tenant. Checks that service definitions exist in MDMS and that each has a valid department reference.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID to validate complaint types for',
        },
        check_department_refs: {
          type: 'boolean',
          description: 'If true, verify that each complaint type references a valid department (default: true)',
        },
      },
      required: ['tenant_id'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;
      const checkDeptRefs = args.check_department_refs !== false;

      // Complaint types are now LEAF rows of the single RAINMAKER-PGR.ComplaintHierarchy
      // adjacency-list master. A leaf carries 'department' or 'slaHours' (interior
      // grouping nodes omit them) and its 'code' IS the serviceCode. Map each leaf
      // to the legacy ServiceDefs shape so the validation below is unchanged.
      const hierarchyRows = await digitApi.mdmsV2Search<Record<string, unknown>>(
        tenantId,
        MDMS_SCHEMAS.COMPLAINT_HIERARCHY
      );
      const complaintTypes = hierarchyRows
        .filter((r) => r.department != null || r.slaHours != null)
        .map((r) => ({
          ...r,
          serviceCode: r.code,
          serviceName: r.serviceName ?? r.name,
          department: r.department,
          slaHours: r.slaHours,
          active: r.active,
        }));

      const result: ValidationResult = {
        valid: true,
        errors: [],
        warnings: [],
        summary: '',
      };

      if (complaintTypes.length === 0) {
        result.valid = false;
        result.errors.push({
          field: 'complaintType',
          message: `No PGR service definitions found for tenant "${tenantId}"`,
          code: 'NO_COMPLAINT_TYPES',
        });
      }

      // Cross-reference departments
      if (checkDeptRefs && complaintTypes.length > 0) {
        const departments = await digitApi.mdmsV2Search<Record<string, unknown>>(
          tenantId,
          MDMS_SCHEMAS.DEPARTMENT
        );
        const deptCodes = new Set(departments.map((d) => d.code as string));

        for (const ct of complaintTypes) {
          const dept = ct.department as string;
          if (dept && !deptCodes.has(dept)) {
            result.warnings.push({
              field: 'complaintType',
              value: ct.serviceCode as string,
              message: `Complaint type "${ct.serviceCode}" references department "${dept}" which doesn't exist in MDMS`,
            });
          }

          if (!ct.slaHours && ct.slaHours !== 0) {
            result.warnings.push({
              field: 'complaintType',
              value: ct.serviceCode as string,
              message: `Complaint type "${ct.serviceCode}" has no SLA hours defined`,
            });
          }
        }
      }

      result.summary = `Found ${complaintTypes.length} complaint type(s)`;

      return JSON.stringify(
        {
          success: true,
          validation: result,
          complaintTypes: complaintTypes.map((ct) => ({
            serviceCode: ct.serviceCode,
            serviceName: ct.serviceName,
            department: ct.department,
            slaHours: ct.slaHours,
            active: ct.active,
          })),
        },
        null,
        2
      );
    },
  } satisfies ToolMetadata);

  // ──────────────────────────────────────────
  // employees group
  // ──────────────────────────────────────────

  registry.register({
    name: 'validate_employees',
    group: 'employees',
    category: 'validation',
    risk: 'read',
    description:
      'Validate employee setup for a tenant. Checks that employees exist in HRMS, have valid department/designation assignments, and have required PGR roles.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID to validate employees for',
        },
        required_roles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Role codes that at least one employee must have (e.g. ["GRO", "PGR_LME"])',
        },
      },
      required: ['tenant_id'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;
      const requiredRoles = (args.required_roles || []) as string[];

      const employees = await digitApi.employeeSearch(tenantId);

      const result: ValidationResult = {
        valid: true,
        errors: [],
        warnings: [],
        summary: '',
      };

      if (employees.length === 0) {
        result.valid = false;
        result.errors.push({
          field: 'employee',
          message: `No employees found for tenant "${tenantId}"`,
          code: 'NO_EMPLOYEES',
        });
      }

      // Check required roles coverage
      if (requiredRoles.length > 0 && employees.length > 0) {
        const coveredRoles = new Set<string>();

        for (const emp of employees) {
          const user = emp.user as Record<string, unknown> | undefined;
          const roles = (user?.roles || []) as Array<{ code: string }>;
          for (const role of roles) {
            coveredRoles.add(role.code);
          }
        }

        for (const role of requiredRoles) {
          if (!coveredRoles.has(role)) {
            result.valid = false;
            result.errors.push({
              field: 'employee',
              value: role,
              message: `No employee found with required role "${role}"`,
              code: 'ROLE_NOT_COVERED',
            });
          }
        }
      }

      // Check for employees with missing assignments
      for (const emp of employees) {
        const assignments = (emp.assignments || []) as Array<Record<string, unknown>>;
        const code = emp.code as string;

        const currentAssignment = assignments.find((a) => a.isCurrentAssignment === true);
        if (!currentAssignment && assignments.length > 0) {
          result.warnings.push({
            field: 'employee',
            value: code,
            message: `Employee "${code}" has no current assignment`,
          });
        }

        if (assignments.length === 0) {
          result.warnings.push({
            field: 'employee',
            value: code,
            message: `Employee "${code}" has no assignments`,
          });
        }
      }

      result.summary = `Found ${employees.length} employee(s)${requiredRoles.length ? `, ${requiredRoles.length - result.errors.filter((e) => e.code === 'ROLE_NOT_COVERED').length}/${requiredRoles.length} required roles covered` : ''}`;

      return JSON.stringify(
        {
          success: true,
          validation: result,
          employeeCount: employees.length,
          employees: employees.slice(0, 20).map((e) => {
            const user = e.user as Record<string, unknown> | undefined;
            return {
              code: e.code,
              uuid: e.uuid || user?.uuid,
              name: user?.name,
              mobileNumber: user?.mobileNumber,
              status: e.employeeStatus,
              roles: ((user?.roles || []) as Array<{ code: string }>).map((r) => r.code),
            };
          }),
        },
        null,
        2
      );
    },
  } satisfies ToolMetadata);

  // ──────────────────────────────────────────
  // boundary group — direct boundary creation
  // ──────────────────────────────────────────

  // boundary_create — create boundaries from JSON (no Excel needed)
  registry.register({
    name: 'boundary_create',
    group: 'boundary',
    category: 'boundary-mgmt',
    risk: 'write',
    description:
      'Create boundary hierarchy and entities from JSON. No Excel file needed — calls boundary-service APIs directly. ' +
      'Three-step process: (1) create hierarchy definition if needed, (2) create boundary entities, (3) create parent-child relationships. ' +
      'Accepts a flat list of boundaries with their type and parent code. Processes them top-down. ' +
      'TIP: For real-world boundary data (India, Mozambique, etc.), clone https://github.com/ChakshuGautam/DIGIT-Boundaries-OpenData into a temp directory ' +
      '(e.g. `git clone https://github.com/ChakshuGautam/DIGIT-Boundaries-OpenData /tmp/digit-boundaries`) — ' +
      'it has pre-generated hierarchy definitions and boundary lists in DIGIT-compatible format (boundaries-flat.json, boundary-relationships.json) ' +
      'organized by country/state/city (data/{COUNTRY}/{STATE}/{CITY}/). Read the JSON files and pass them directly to this tool instead of manually constructing boundary lists.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID (e.g. "pg.citya", "statea.f")',
        },
        hierarchy_type: {
          type: 'string',
          description: 'Hierarchy type (default: "ADMIN")',
        },
        hierarchy_definition: {
          type: 'array',
          description: 'Optional: define the hierarchy levels top-down. E.g. ["Country", "State", "District", "City", "Ward", "Locality"]. ' +
            'If omitted, uses the existing hierarchy for this tenant. If the tenant has no hierarchy, this is required.',
          items: { type: 'string' },
        },
        boundaries: {
          type: 'array',
          description: 'List of boundaries to create. Each has: code (unique boundary code), type (boundary type matching hierarchy, e.g. "Ward"), parent (parent boundary code, null for root). ' +
            'Process order: top-down by hierarchy level. Duplicates (already existing) are skipped.',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'Unique boundary code' },
              type: { type: 'string', description: 'Boundary type (must match a level in the hierarchy)' },
              parent: { type: 'string', description: 'Parent boundary code (null/omit for root level)' },
            },
            required: ['code', 'type'],
          },
        },
      },
      required: ['tenant_id', 'boundaries'],
    },
    handler: async (args) => {
      validateTenantId(args.tenant_id, 'tenant_id');
      const boundaries = args.boundaries as { code: string; type: string; parent?: string }[];
      for (const b of boundaries) {
        validateResourceId(b.code, 'boundary.code');
      }

      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;
      const hierarchyType = (args.hierarchy_type as string) || 'ADMIN';
      const hierarchyDef = args.hierarchy_definition as string[] | undefined;

      const results: {
        hierarchy: { action: string; detail?: unknown; error?: string };
        entitiesCreated: string[];
        entitiesSkipped: string[];
        relationshipsCreated: string[];
        relationshipsSkipped: string[];
        errors: { code: string; step: string; error: string }[];
      } = {
        hierarchy: { action: 'none' },
        entitiesCreated: [],
        entitiesSkipped: [],
        relationshipsCreated: [],
        relationshipsSkipped: [],
        errors: [],
      };

      // Step 1: Ensure hierarchy definition exists
      let hierarchyLevels: string[] = [];

      if (hierarchyDef && hierarchyDef.length > 0) {
        // User provided hierarchy — create it
        const levels = hierarchyDef.map((type, i) => ({
          boundaryType: type,
          parentBoundaryType: i === 0 ? null : hierarchyDef[i - 1],
          active: true,
        }));

        try {
          const created = await digitApi.boundaryHierarchyCreate(tenantId, hierarchyType, levels);
          results.hierarchy = { action: 'created', detail: created };
          hierarchyLevels = hierarchyDef;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          // If already exists, that's fine — fetch existing
          if (msg.includes('DUPLICATE') || msg.includes('already exists') || msg.includes('unique')) {
            results.hierarchy = { action: 'already_exists' };
            // Fetch existing to get level order
            try {
              const existing = await digitApi.boundaryHierarchySearch(tenantId, hierarchyType);
              if (existing.length > 0) {
                const hier = existing[0] as { boundaryHierarchy?: { boundaryType: string; parentBoundaryType?: string }[] };
                if (hier.boundaryHierarchy) {
                  hierarchyLevels = buildOrderedLevels(hier.boundaryHierarchy);
                }
              }
            } catch (fetchErr) { console.error(`[boundary_create] Hierarchy fetch failed, using user-provided order: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`); }
            if (hierarchyLevels.length === 0) hierarchyLevels = hierarchyDef;
          } else {
            results.hierarchy = { action: 'error', error: msg };
            return JSON.stringify({ success: false, results, tenantId }, null, 2);
          }
        }
      } else {
        // No hierarchy provided — fetch existing
        try {
          const existing = await digitApi.boundaryHierarchySearch(tenantId, hierarchyType);
          if (existing.length > 0) {
            const hier = existing[0] as { boundaryHierarchy?: { boundaryType: string; parentBoundaryType?: string }[] };
            if (hier.boundaryHierarchy) {
              hierarchyLevels = buildOrderedLevels(hier.boundaryHierarchy);
            }
            results.hierarchy = { action: 'existing', detail: hierarchyLevels };
          } else {
            return JSON.stringify({
              success: false,
              error: 'No hierarchy definition found for this tenant. Provide hierarchy_definition parameter.',
              tenantId,
              hierarchyType,
            }, null, 2);
          }
        } catch (error) {
          return JSON.stringify({
            success: false,
            error: `Failed to fetch hierarchy: ${error instanceof Error ? error.message : String(error)}`,
            hint: 'Provide hierarchy_definition parameter to create one.',
          }, null, 2);
        }
      }

      // Step 1b: Ensure hierarchy also exists at the state root tenant.
      // The DIGIT UI queries boundaries at the state level (e.g. tenantId=mz)
      // even when boundaries are defined at city level (e.g. mz.chimoio).
      // Without a hierarchy definition at the root, the boundary-service
      // returns HIERARCHY_DEFINITION_DOES_NOT_EXIST_ERR.
      const stateRoot = tenantId.includes('.') ? tenantId.split('.')[0] : tenantId;
      if (stateRoot !== tenantId && hierarchyLevels.length > 0) {
        try {
          const rootLevels = hierarchyLevels.map((type, i) => ({
            boundaryType: type,
            parentBoundaryType: i === 0 ? null : hierarchyLevels[i - 1],
            active: true,
          }));
          await digitApi.boundaryHierarchyCreate(stateRoot, hierarchyType, rootLevels);
          (results.hierarchy as Record<string, unknown>).rootCreated = stateRoot;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('DUPLICATE') || msg.includes('already exists') || msg.includes('unique')) {
            (results.hierarchy as Record<string, unknown>).rootCreated = `${stateRoot} (already exists)`;
          } else {
            // Non-fatal — log but continue
            console.error(`[boundary_create] Failed to create hierarchy at state root ${stateRoot}: ${msg}`);
          }
        }
      }

      // Step 2: Create boundary entities in batch
      // Split into batches of 50 to avoid payload limits
      const BATCH_SIZE = 50;
      for (let i = 0; i < boundaries.length; i += BATCH_SIZE) {
        const batch = boundaries.slice(i, i + BATCH_SIZE);
        try {
          const created = await digitApi.boundaryCreate(
            tenantId,
            batch.map((b) => ({ code: b.code, tenantId }))
          );
          results.entitiesCreated.push(...created.map((c) => (c.code as string) || 'unknown'));
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          // If some are duplicates, try one by one
          for (const b of batch) {
            try {
              const created = await digitApi.boundaryCreate(tenantId, [{ code: b.code, tenantId }]);
              results.entitiesCreated.push(...created.map((c) => (c.code as string) || b.code));
            } catch (innerError) {
              const innerMsg = innerError instanceof Error ? innerError.message : String(innerError);
              if (innerMsg.includes('DUPLICATE') || innerMsg.includes('already exists') || innerMsg.includes('unique')) {
                results.entitiesSkipped.push(b.code);
              } else {
                results.errors.push({ code: b.code, step: 'entity_create', error: innerMsg });
              }
            }
          }
        }
      }

      // Step 2.5: ENTITY GATE — wait until every entity write is visible before
      // creating relationships. boundary-service entity _create returns 200
      // before the row is consistently readable; relationship _create validates
      // entity existence against the store, so without this barrier a subset of
      // relationship calls outrun their entity and fail BOUNDARY_ENTITY_DOES_NOT_EXIST
      // (and their Quarteirão/leaf children cascade). Poll boundary search until
      // all expected codes are present, then proceed.
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      // /boundary/_search caps results (~300), so verify the exact codes via the
      // `codes` filter in chunks rather than counting one big search.
      const expectedCodeList = boundaries.map((b) => b.code);
      const expectedCount = new Set(expectedCodeList).size;
      const GATE_TIMEOUT_MS = 180000;
      const GATE_INTERVAL_MS = 2000;
      const CODES_CHUNK = 200;
      const countVisibleEntities = async (): Promise<number> => {
        const seen = new Set<string>();
        for (let i = 0; i < expectedCodeList.length; i += CODES_CHUNK) {
          const chunk = expectedCodeList.slice(i, i + CODES_CHUNK);
          // explicit limit: /boundary/_search defaults to 50 results even when
          // codes are supplied, so without this the gate undercounts and stalls.
          const res = await digitApi
            .boundarySearch(tenantId, undefined, { codes: chunk, limit: chunk.length })
            .catch(() => [] as Record<string, unknown>[]);
          const present = new Set((res as Record<string, unknown>[]).map((e) => e.code as string));
          for (const c of chunk) if (present.has(c)) seen.add(c);
        }
        return seen.size;
      };
      const gateStart = Date.now();
      let entitiesVisible = 0;
      while (Date.now() - gateStart < GATE_TIMEOUT_MS) {
        entitiesVisible = await countVisibleEntities();
        if (entitiesVisible >= expectedCount) break;
        await sleep(GATE_INTERVAL_MS);
      }
      const entityGate = {
        expected: expectedCount,
        visible: entitiesVisible,
        complete: entitiesVisible >= expectedCount,
        waitedMs: Date.now() - gateStart,
      };
      if (!entityGate.complete) {
        console.error(
          `[boundary_create] entity gate: only ${entitiesVisible}/${expectedCount} visible after ${entityGate.waitedMs}ms — relationships will retry stragglers`,
        );
      }

      // Step 3: Create relationships top-down (ordered by hierarchy level), with
      // a bounded retry for any entity still not visible / parent not yet linked
      // (cascade) despite the gate.
      const levelOrder = new Map(hierarchyLevels.map((l, i) => [l, i]));
      const sorted = [...boundaries].sort((a, b) => {
        const aOrder = levelOrder.get(a.type) ?? 999;
        const bOrder = levelOrder.get(b.type) ?? 999;
        return aOrder - bOrder;
      });

      const isMissingEntity = (m: string) =>
        m.includes('DOES_NOT_EXIST') || m.includes('does not exist') || m.includes('not found');
      const MAX_PASSES = 4;
      let pending = sorted;
      for (let pass = 0; pass < MAX_PASSES && pending.length > 0; pass++) {
        if (pass > 0) await sleep(2000);
        const stillPending: typeof pending = [];
        for (const b of pending) {
          try {
            await digitApi.boundaryRelationshipCreate(
              tenantId,
              b.code,
              hierarchyType,
              b.type,
              b.parent || null,
            );
            results.relationshipsCreated.push(b.code);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            if (msg.includes('DUPLICATE') || msg.includes('already exists') || msg.includes('unique')) {
              results.relationshipsSkipped.push(b.code);
            } else if (isMissingEntity(msg) && pass < MAX_PASSES - 1) {
              stillPending.push(b); // entity not visible yet or parent cascade — retry next pass
            } else {
              results.errors.push({ code: b.code, step: 'relationship_create', error: msg });
            }
          }
        }
        pending = stillPending;
      }

      return JSON.stringify({
        success: results.errors.length === 0,
        tenantId,
        hierarchyType,
        summary: {
          entitiesCreated: results.entitiesCreated.length,
          entitiesSkipped: results.entitiesSkipped.length,
          entityGate,
          relationshipsCreated: results.relationshipsCreated.length,
          relationshipsSkipped: results.relationshipsSkipped.length,
          errors: results.errors.length,
        },
        results,
      }, null, 2);
    },
  } satisfies ToolMetadata);

  // ──────────────────────────────────────────
  // boundary group — boundary management tools (Excel-based, legacy)
  // ──────────────────────────────────────────

  registry.register({
    name: 'boundary_mgmt_process',
    group: 'boundary',
    category: 'boundary-mgmt',
    risk: 'write',
    description:
      'Process (upload/update) boundary data via the boundary management service (egov-bndry-mgmnt). Submits resource details for boundary data processing. Requires a file with boundary data to be uploaded first via filestore.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID for boundary processing',
        },
        resource_details: {
          type: 'object',
          description: 'Resource details object containing file information, boundary type, hierarchy type, and action',
          properties: {
            type: { type: 'string', description: 'Resource type (e.g. "boundary")' },
            fileStoreId: { type: 'string', description: 'Filestore ID of the uploaded boundary file' },
            action: { type: 'string', description: 'Action to perform (e.g. "create", "update")' },
            hierarchyType: { type: 'string', description: 'Hierarchy type (e.g. "ADMIN")' },
            tenantId: { type: 'string', description: 'Tenant ID for the boundary data' },
          },
        },
      },
      required: ['tenant_id', 'resource_details'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;
      const resourceDetails = args.resource_details as Record<string, unknown>;

      try {
        const result = await digitApi.boundaryMgmtProcess(tenantId, resourceDetails);
        return JSON.stringify({ success: true, result, tenantId }, null, 2);
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
          hint: 'The egov-bndry-mgmnt service returned an error. This service manages boundary data uploads/processing. ' +
            'If you get "invalid path", this tenant has no processed boundary data in egov-bndry-mgmnt. ' +
            'To read existing boundaries, use "validate_boundary" (boundary-service) instead. ' +
            'Available tenants with boundaries can be found via "mdms_get_tenants".',
          alternatives: [
            { tool: 'validate_boundary', purpose: 'Read boundary hierarchy from boundary-service (most environments)' },
            { tool: 'mdms_get_tenants', purpose: 'List available tenants to find correct tenant IDs' },
          ],
        }, null, 2);
      }
    },
  } satisfies ToolMetadata);

  registry.register({
    name: 'boundary_mgmt_search',
    group: 'boundary',
    category: 'boundary-mgmt',
    risk: 'read',
    description:
      'Search for processed boundary data in the boundary management service (egov-bndry-mgmnt). Returns resource details of previously processed boundary uploads for a tenant. Note: if you just want to read boundary hierarchy data, use "validate_boundary" instead — it queries boundary-service which is available in all environments.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID to search boundary processes for',
        },
      },
      required: ['tenant_id'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;

      try {
        const resources = await digitApi.boundaryMgmtSearch(tenantId);
        return JSON.stringify({ success: true, count: resources.length, resources, tenantId }, null, 2);
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
          hint: 'The egov-bndry-mgmnt service returned an error for this tenant. ' +
            'This typically means no boundary data has been uploaded/processed for this tenant via egov-bndry-mgmnt. ' +
            'To read existing boundary hierarchy data, use "validate_boundary" with the correct tenant ID instead. ' +
            'Use "mdms_get_tenants" to list tenants and find the correct tenant ID (e.g. pg.citya, statea.f).',
          alternatives: [
            { tool: 'validate_boundary', purpose: 'Read boundary hierarchy from boundary-service (recommended)' },
            { tool: 'mdms_get_tenants', purpose: 'List available tenants to find correct tenant IDs' },
          ],
        }, null, 2);
      }
    },
  } satisfies ToolMetadata);

  registry.register({
    name: 'boundary_mgmt_generate',
    group: 'boundary',
    category: 'boundary-mgmt',
    risk: 'write',
    description:
      'Generate boundary codes via the boundary management service (egov-bndry-mgmnt). Creates boundary code mappings based on resource details. Typically used after processing boundary data.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID for boundary code generation',
        },
        resource_details: {
          type: 'object',
          description: 'Resource details for boundary generation (type, hierarchy, tenant)',
          properties: {
            type: { type: 'string', description: 'Resource type (e.g. "boundary")' },
            hierarchyType: { type: 'string', description: 'Hierarchy type (e.g. "ADMIN")' },
            tenantId: { type: 'string', description: 'Tenant ID for the boundary data' },
          },
        },
      },
      required: ['tenant_id', 'resource_details'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;
      const resourceDetails = args.resource_details as Record<string, unknown>;

      try {
        const result = await digitApi.boundaryMgmtGenerate(tenantId, resourceDetails);
        return JSON.stringify({ success: true, result, tenantId }, null, 2);
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
          hint: 'Boundary code generation failed. Ensure boundary data was first processed via "boundary_mgmt_process". ' +
            'If you get "invalid path", this tenant has no data in egov-bndry-mgmnt. ' +
            'To read existing boundaries, use "validate_boundary" instead.',
          alternatives: [
            { tool: 'validate_boundary', purpose: 'Read existing boundary hierarchy from boundary-service' },
            { tool: 'boundary_mgmt_process', purpose: 'Upload/process boundary data first before generating codes' },
          ],
        }, null, 2);
      }
    },
  } satisfies ToolMetadata);

  registry.register({
    name: 'boundary_mgmt_download',
    group: 'boundary',
    category: 'boundary-mgmt',
    risk: 'read',
    description:
      'Search/download generated boundary data from the boundary management service (egov-bndry-mgmnt). Returns resource details of boundary code generation results for a tenant. Note: if you just want to read boundary hierarchy data, use "validate_boundary" instead.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID to search generated boundaries for',
        },
      },
      required: ['tenant_id'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;

      try {
        const resources = await digitApi.boundaryMgmtDownload(tenantId);
        return JSON.stringify({ success: true, count: resources.length, resources, tenantId }, null, 2);
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
          hint: 'No generated boundary data found for this tenant in egov-bndry-mgmnt. ' +
            'To read existing boundary hierarchy, use "validate_boundary" with the correct tenant ID. ' +
            'Use "mdms_get_tenants" to list available tenants.',
          alternatives: [
            { tool: 'validate_boundary', purpose: 'Read boundary hierarchy from boundary-service (recommended)' },
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
