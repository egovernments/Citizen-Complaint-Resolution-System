// MDMS Service - Master Data Management
import { apiClient } from '../client';
import { ENDPOINTS, MDMS_SCHEMAS } from '../config';
import type {
  Department,
  Designation,
  ComplaintType,
  MdmsRecord,
  Tenant,
} from '../types';
import {
  selectOwnedDashboardConfig,
  type DashboardConfigData,
} from '../publicDashboardConfig';

// MapConfig is a singleton per tenant, keyed on `code` (the schema's x-unique).
// The key must NOT be derived from any configured value: the one hand-seeded
// record in the wild keyed itself on its own ward colour, so changing the colour
// either left the key contradicting the data or minted a second record — and the
// UI reads MapConfig[0], which then picks between them arbitrarily.
const MAP_CONFIG_KEY = 'DEFAULT';
const DASHBOARD_CONFIG_KEY = 'default';

export const mdmsService = {
  /**
   * Generic MDMS search. **Returns ACTIVE records only** unless
   * `options.includeInactive` is set.
   *
   * mdms-v2 soft-deletes: a "removed" record keeps its row and its `data`
   * verbatim (including `data.active: true`, which is a *business* flag owned by
   * the schema and has nothing to do with deletion) and only flips the
   * record-level `isActive` to false. This function used to send no `isActive`
   * criterion AND then throw the flag away by mapping straight down to
   * `record.data`, so every caller silently received deleted records with no way
   * to tell — the complaint-type cascade offered four soft-deleted
   * `*_CTPARITY` sub-types, and picking one got the operator an opaque
   * `400 INVALID_SERVICECODE: … not present in MDMS` from pgr-services, which
   * resolves the hierarchy with `isActive = true`.
   *
   * The filter is pushed to the SERVER (verified: 263 active of 267 rows on
   * mz/RAINMAKER-PGR.ComplaintHierarchy) so paging stays honest, and re-applied
   * client-side as a defensive fallback for any MDMS build that ignores the
   * criterion. The record-level flag is also preserved on each result as
   * `_isActive` (the `_`-prefixed metadata convention the data-provider already
   * uses) so a caller that opts into inactive rows can still tell them apart.
   *
   * Need the raw records (uniqueIdentifier / id / auditDetails / isActive)?
   * Use `searchRecords()` — it is deliberately unfiltered.
   */
  async search<T>(
    tenantId: string,
    schemaCode: string,
    options?: {
      limit?: number;
      offset?: number;
      uniqueIdentifiers?: string[];
      /** Opt in to soft-deleted records (e.g. an admin list with a "show removed" toggle). */
      includeInactive?: boolean;
    }
  ): Promise<T[]> {
    const includeInactive = options?.includeInactive === true;
    const response = await apiClient.post(ENDPOINTS.MDMS_SEARCH, {
      RequestInfo: apiClient.buildRequestInfo(),
      MdmsCriteria: {
        tenantId,
        schemaCode,
        limit: options?.limit || 100,
        offset: options?.offset || 0,
        uniqueIdentifiers: options?.uniqueIdentifiers,
        ...(includeInactive ? {} : { isActive: true }),
      },
    });

    const mdmsRecords = (response.mdms || []) as MdmsRecord[];
    const kept = includeInactive
      ? mdmsRecords
      : mdmsRecords.filter((record) => record.isActive !== false);
    return kept.map(
      (record) =>
        ({ ...(record.data as Record<string, unknown>), _isActive: record.isActive !== false }) as T
    );
  },

  // Generic MDMS create
  async create(
    tenantId: string,
    schemaCode: string,
    uniqueIdentifier: string,
    data: Record<string, unknown>
  ): Promise<MdmsRecord> {
    const response = await apiClient.post(`${ENDPOINTS.MDMS_CREATE}/${schemaCode}`, {
      RequestInfo: apiClient.buildRequestInfo(),
      Mdms: {
        tenantId,
        schemaCode,
        uniqueIdentifier,
        data,
        isActive: true,
      },
    });

    return response.Mdms as MdmsRecord;
  },

  // Raw search: keeps `uniqueIdentifier` / `id` / `auditDetails` / `isActive`,
  // which the generic search() drops when it maps records down to their `data`.
  // An update has to round-trip the first three. Deliberately UNFILTERED — this
  // is the escape hatch for the flows that must see soft-deleted rows
  // (upsertMapConfig has to know a uid is occupied before it mints a new one).
  async searchRecords(
    tenantId: string,
    schemaCode: string,
    options?: { limit?: number }
  ): Promise<MdmsRecord[]> {
    const response = await apiClient.post(ENDPOINTS.MDMS_SEARCH, {
      RequestInfo: apiClient.buildRequestInfo(),
      MdmsCriteria: { tenantId, schemaCode, limit: options?.limit || 100, offset: 0 },
    });
    return (response.mdms || []) as MdmsRecord[];
  },

  // Generic MDMS update. `uniqueIdentifier` is immutable — mdms-v2 keys the row
  // on it — so it is round-tripped, not recomputed from the new data.
  async update(record: MdmsRecord, data: Record<string, unknown>): Promise<MdmsRecord> {
    const response = await apiClient.post(`${ENDPOINTS.MDMS_UPDATE}/${record.schemaCode}`, {
      RequestInfo: apiClient.buildRequestInfo(),
      Mdms: {
        tenantId: record.tenantId,
        schemaCode: record.schemaCode,
        uniqueIdentifier: record.uniqueIdentifier,
        id: record.id,
        data,
        auditDetails: record.auditDetails,
        isActive: true,
      },
    });
    return response.Mdms as MdmsRecord;
  },

  /**
   * Merges `patch` into this tenant's MapConfig, creating the record if it has
   * none.
   *
   * mdms-v2 resolves up the tenant tree, so a search at `ke.bomet` happily
   * returns a record owned by `ke`. Updating THAT would rewrite the state root
   * and silently change every other city inheriting from it — so a record only
   * counts as ours when its `tenantId` matches exactly. Anything else is the
   * parent's, and we shadow it with a new record at this tenant instead.
   */
  async upsertMapConfig(tenantId: string, patch: Record<string, unknown>): Promise<MdmsRecord> {
    const existing = await this.searchRecords(tenantId, MDMS_SCHEMAS.MAP_CONFIG).catch(() => []);
    const own = existing.find((r) => r.tenantId === tenantId && r.isActive !== false);

    if (own) {
      return this.update(own, { ...(own.data as Record<string, unknown>), ...patch });
    }

    // Inherit the parent's values as the base so shadowing it doesn't silently
    // drop a colour or basemap the operator set further up the tree.
    const inherited = existing.find((r) => r.isActive !== false)?.data as Record<string, unknown> | undefined;
    const data = { ...(inherited || {}), ...patch, code: MAP_CONFIG_KEY };
    return this.create(tenantId, MDMS_SCHEMAS.MAP_CONFIG, MAP_CONFIG_KEY, data);
  },

  /** Load the active DashboardConfig owned by the state root (never an inherited row). */
  async getDashboardConfig(tenantId: string): Promise<MdmsRecord | null> {
    const records = await this.searchRecords(tenantId, MDMS_SCHEMAS.DASHBOARD_CONFIG);
    return selectOwnedDashboardConfig(records, tenantId);
  },

  /**
   * Patch the singleton DashboardConfig without dropping its existing timezone,
   * number formatting, or scoping. Route and data access are capabilities owned by
   * egov-accesscontrol, not fields in this tenant configuration record.
   */
  async upsertDashboardConfig(
    tenantId: string,
    patch: Partial<DashboardConfigData>,
  ): Promise<MdmsRecord> {
    const records = await this.searchRecords(tenantId, MDMS_SCHEMAS.DASHBOARD_CONFIG);
    const own = selectOwnedDashboardConfig(records, tenantId);

    if (own) {
      return this.update(own, { ...(own.data as Record<string, unknown>), ...patch });
    }

    const data: DashboardConfigData = {
      id: DASHBOARD_CONFIG_KEY,
      ...patch,
    };
    return this.create(
      tenantId,
      MDMS_SCHEMAS.DASHBOARD_CONFIG,
      DASHBOARD_CONFIG_KEY,
      data,
    );
  },

  /** Force pgr-services to re-read DashboardConfig after a successful MDMS write. */
  async refreshDashboardConfig(tenantId: string): Promise<boolean> {
    const response = await apiClient.post(ENDPOINTS.ANALYTICS_CONFIG_REFRESH, {
      RequestInfo: apiClient.buildRequestInfo(),
      tenantId,
    });
    return response.publicDashboardEnabled === true;
  },

  // ============================================
  // Department Methods
  // ============================================

  async getDepartments(tenantId: string): Promise<Department[]> {
    // Pull the full master, not the search() default page (100). Tenants like
    // mz.ige have 120+ departments; a partial fetch makes bulk-employee
    // validation wrongly flag the unloaded ones as "Department not found".
    return this.search<Department>(tenantId, MDMS_SCHEMAS.DEPARTMENT, { limit: 5000 });
  },

  async createDepartment(tenantId: string, department: Department): Promise<MdmsRecord> {
    return this.create(tenantId, MDMS_SCHEMAS.DEPARTMENT, department.code, {
      code: department.code,
      name: department.name,
      active: department.active,
    });
  },

  async createDepartments(
    tenantId: string,
    departments: Department[]
  ): Promise<{ success: MdmsRecord[]; failed: { dept: Department; error: string }[] }> {
    const success: MdmsRecord[] = [];
    const failed: { dept: Department; error: string }[] = [];

    for (const dept of departments) {
      try {
        const result = await this.createDepartment(tenantId, dept);
        success.push(result);
      } catch (error) {
        failed.push({
          dept,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return { success, failed };
  },

  // ============================================
  // Designation Methods
  // ============================================

  async getDesignations(tenantId: string): Promise<Designation[]> {
    // Same as getDepartments: fetch the full master so employee-bulk validation
    // doesn't false-negative on designations beyond the default page.
    return this.search<Designation>(tenantId, MDMS_SCHEMAS.DESIGNATION, { limit: 5000 });
  },

  async createDesignation(tenantId: string, designation: Designation): Promise<MdmsRecord> {
    return this.create(tenantId, MDMS_SCHEMAS.DESIGNATION, designation.code, {
      code: designation.code,
      name: designation.name,
      description: designation.description,
      department: designation.department,
      active: designation.active,
    });
  },

  async createDesignations(
    tenantId: string,
    designations: Designation[]
  ): Promise<{ success: MdmsRecord[]; failed: { desig: Designation; error: string }[] }> {
    const success: MdmsRecord[] = [];
    const failed: { desig: Designation; error: string }[] = [];

    for (const desig of designations) {
      try {
        const result = await this.createDesignation(tenantId, desig);
        success.push(result);
      } catch (error) {
        failed.push({
          desig,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return { success, failed };
  },

  // ============================================
  // Complaint Type / Service Definition Methods
  // ============================================

  // Read complaint types from the single ComplaintHierarchy master, keeping
  // only LEAF rows (a row is a leaf iff it carries `department` or `slaHours`;
  // interior classification nodes omit them) and mapping each to the legacy
  // ComplaintType shape so callers stay unchanged. A leaf's `code` IS the
  // serviceCode; grouping derives from `parentCode` (no more menuPath).
  async getComplaintTypes(tenantId: string): Promise<ComplaintType[]> {
    const results = await this.search<Record<string, unknown>>(
      tenantId,
      MDMS_SCHEMAS.COMPLAINT_HIERARCHY,
      { limit: 5000 } // full hierarchy can be thousands of leaves; don't truncate at the 100 default
    );

    const isLeaf = (r: Record<string, unknown>) =>
      r.department != null || r.slaHours != null;

    return results.filter(isLeaf).map((r) => ({
      serviceCode: (r.code ?? r.serviceCode) as string,
      name: (r.name || r.serviceName) as string,
      keywords: (r.keywords as string) || '',
      department: r.department as string,
      departments: Array.isArray(r.departments) ? (r.departments as string[]) : undefined,
      slaHours: r.slaHours as number,
      levelCode: r.levelCode as string | undefined,
      parentCode: r.parentCode as string | undefined,
      path: r.path as string | undefined,
      active: r.active as boolean,
      order: r.order as number | undefined,
    }));
  },

  // Write a complaint type as a ComplaintHierarchy LEAF row. The unique
  // identifier and `code` are the serviceCode; leaf fields (department/
  // departments/slaHours/keywords) mark it as a leaf. `menuPath` is gone —
  // grouping is carried by `parentCode`. levelCode/path are written verbatim
  // when the caller has them (the bulk-hierarchy flow computes them).
  async createComplaintType(
    tenantId: string,
    complaintType: ComplaintType
  ): Promise<MdmsRecord> {
    const data: Record<string, unknown> = {
      code: complaintType.serviceCode,
      name: complaintType.name,
      keywords: complaintType.keywords,
      department: complaintType.department,
      slaHours: complaintType.slaHours,
      active: complaintType.active,
      order: complaintType.order || 1,
    };
    if (complaintType.departments) data.departments = complaintType.departments;
    if (complaintType.levelCode) data.levelCode = complaintType.levelCode;
    if (complaintType.parentCode) data.parentCode = complaintType.parentCode;
    if (complaintType.path) data.path = complaintType.path;
    return this.create(
      tenantId,
      MDMS_SCHEMAS.COMPLAINT_HIERARCHY,
      complaintType.serviceCode,
      data
    );
  },

  async createComplaintTypes(
    tenantId: string,
    types: ComplaintType[]
  ): Promise<{ success: MdmsRecord[]; failed: { type: ComplaintType; error: string }[] }> {
    const success: MdmsRecord[] = [];
    const failed: { type: ComplaintType; error: string }[] = [];

    for (const type of types) {
      try {
        const result = await this.createComplaintType(tenantId, type);
        success.push(result);
      } catch (error) {
        failed.push({
          type,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return { success, failed };
  },

  // ============================================
  // Tenant Methods
  // ============================================

  async getTenants(stateTenantId: string): Promise<Tenant[]> {
    const results = await this.search<Record<string, unknown>>(
      stateTenantId,
      MDMS_SCHEMAS.TENANT
    );

    return results.map((r) => ({
      code: r.code as string,
      name: r.name as string,
      description: r.description as string | undefined,
      logoId: r.logoId as string | undefined,
      emailId: r.emailId as string | undefined,
      address: r.address as string | undefined,
      contactNumber: r.contactNumber as string | undefined,
      city: r.city as Tenant['city'],
    }));
  },

  async createTenant(stateTenantId: string, tenant: Tenant): Promise<MdmsRecord> {
    // Build the full tenant data structure matching MDMS schema.
    // tenant.tenants requires `tenantId` inside data (in addition to the
    // Mdms.tenantId wrapper) — it stores the *parent* tenant this city lives
    // under, e.g. for `ke.testzone` the parent is `ke`. Setting it to the
    // tenant's own code (as the previous implementation did) is semantically
    // wrong — MDMS inheritance relies on this being the parent.
    const tenantData = {
      tenantId: stateTenantId,
      code: tenant.code,
      name: tenant.name,
      type: tenant.city?.ulbGrade || 'CITY',
      description: tenant.description || tenant.name,
      // Schema note (tenant.tenants): `logoId` is an OPTIONAL non-nullable
      // String — sending `logoId: null` fails validation with
      // "expected type: String, found: Null", which blocked every Phase 1
      // "Upload to DIGIT". Omit it entirely when the wizard has no logo yet
      // (the branding step patches it in later). `imageId` is REQUIRED but
      // nullable (["string","null"]), so `null` is the correct placeholder.
      ...(tenant.logoId ? { logoId: tenant.logoId } : {}),
      imageId: tenant.logoId || null,
      emailId: tenant.emailId || `info@${tenant.code.toLowerCase().replace(/\./g, '-')}.gov.in`,
      address: tenant.address || `${tenant.city?.name || tenant.name}, ${tenant.city?.districtName || 'District'}`,
      domainUrl: `https://${tenant.code.toLowerCase().replace(/\./g, '-')}.digit.org`,
      contactNumber: tenant.contactNumber || '1800-000-0000',
      OfficeTimings: {
        'Mon - Fri': '9:00 AM - 6:00 PM',
      },
      city: {
        code: tenant.city?.code || tenant.code.toUpperCase().replace(/\./g, '_'),
        name: tenant.city?.name || tenant.name,
        latitude: tenant.city?.latitude || 0,
        longitude: tenant.city?.longitude || 0,
        ulbGrade: tenant.city?.ulbGrade || 'Municipal Corporation',
        districtCode: tenant.city?.districtCode || tenant.code.split('.').pop()?.toUpperCase() || 'DISTRICT',
        districtName: tenant.city?.districtName || 'District',
        districtTenantCode: stateTenantId,
      },
    };

    return this.create(stateTenantId, MDMS_SCHEMAS.TENANT, tenant.code, tenantData);
  },

  // ============================================
  // Roles Methods
  // ============================================

  async getRoles(tenantId: string): Promise<{ code: string; name: string; description?: string }[]> {
    const results = await this.search<Record<string, unknown>>(
      tenantId,
      MDMS_SCHEMAS.ROLES
    );

    return results.map((r) => ({
      code: r.code as string,
      name: r.name as string,
      description: r.description as string | undefined,
    }));
  },

  // ============================================
  // Mobile validation rule (common-masters.MobileNumberValidation)
  // ============================================

  async getMobileValidation(tenantId: string): Promise<{
    mobileNumberRegex: string;
    pattern: string;   // backward-compat alias
    countryCode?: string;
    prefix?: string;   // backward-compat alias
    errorMessage: string;
  } | null> {
    // Flat schema: { countryCode, mobileNumberRegex, default, isActive }.
    // Pick the record with default:true (the tenant's primary rule).
    const results = await this.search<Record<string, unknown>>(
      tenantId,
      'common-masters.MobileNumberValidation'
    );
    const preferred =
      results.find((r) => r['default'] === true && r.isActive !== false) ??
      results.find((r) => r.isActive !== false) ??
      null;
    if (!preferred) return null;
    const regex =
      typeof preferred.mobileNumberRegex === 'string'
        ? preferred.mobileNumberRegex
        : '^\\d{9,10}$';
    const countryCode =
      typeof preferred.countryCode === 'string' ? preferred.countryCode : undefined;
    return {
      mobileNumberRegex: regex,
      pattern: regex,
      countryCode,
      prefix: countryCode,
      errorMessage: 'Mobile number does not match the configured format',
    };
  },

  // ============================================
  // Postal-code rule (common-masters.FormValidations, fieldType: postalCode)
  // ============================================

  /**
   * The MDMS-authored postal-code pattern — the PRIMARY per-tenant rule.
   * DDH seeds a default 5-digit `fieldType: "postalCode"` row at tenant
   * creation; editing it (Studio's FormValidations editor) changes the
   * tenant's rule, outranking the host_vars pattern with the same
   * precedence in the PGR create-complaint flows (see digit-ui-esbuild
   * utils/postalCode.js). Returns null when no row exists (dump-booted
   * stacks, pre-FormValidations tenants) — the effective rule then comes
   * from globalConfigs CORE_POSTAL_CONFIGS (host_vars
   * `core_postal_configs`).
   */
  async getPostalValidation(tenantId: string): Promise<{ pattern: string } | null> {
    const results = await this.search<Record<string, unknown>>(
      tenantId,
      'common-masters.FormValidations'
    );
    const row = results.find(
      (r) => r.fieldType === 'postalCode' && r.isActive !== false && typeof r.regex === 'string'
    );
    return row ? { pattern: row.regex as string } : null;
  },

  // ============================================
  // Configured UI locales (common-masters.StateInfo.languages)
  // ============================================

  // Returns the locale codes the tenant actually serves — the `value` of each
  // StateInfo.languages entry (e.g. ["en_KE", "sw_KE"]). This is the single
  // source of truth for the digit-ui language switcher and the configurator's
  // locale dropdowns (see schemaDescriptors/state-info.ts), so any content we
  // localize (boundaries, hierarchy levels) must be seeded under THESE locales
  // — not a hardcoded en_IN, which a non-India tenant's UI never reads, leaving
  // every boundary dropdown/map tooltip showing the raw code.
  //
  // StateInfo lives at the state-root tenant; callers pass a tenant whose root
  // segment we resolve. Returns [] when StateInfo/languages is absent so callers
  // can fall back to their own default rather than silently seeding nothing.
  async getStateInfoLocales(tenantId: string): Promise<string[]> {
    const rootTenant = tenantId.split('.')[0];
    try {
      const records = await this.search<{ languages?: { value?: string }[] }>(
        rootTenant,
        'common-masters.StateInfo'
      );
      const langs = records.find((r) => Array.isArray(r.languages))?.languages ?? [];
      return langs
        .map((l) => (typeof l?.value === 'string' ? l.value : undefined))
        .filter((v): v is string => !!v);
    } catch {
      return [];
    }
  },
};
