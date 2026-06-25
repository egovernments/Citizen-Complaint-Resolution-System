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

export const mdmsService = {
  // Generic MDMS search
  async search<T>(
    tenantId: string,
    schemaCode: string,
    options?: { limit?: number; offset?: number; uniqueIdentifiers?: string[] }
  ): Promise<T[]> {
    const response = await apiClient.post(ENDPOINTS.MDMS_SEARCH, {
      RequestInfo: apiClient.buildRequestInfo(),
      MdmsCriteria: {
        tenantId,
        schemaCode,
        limit: options?.limit || 100,
        offset: options?.offset || 0,
        uniqueIdentifiers: options?.uniqueIdentifiers,
      },
    });

    const mdmsRecords = (response.mdms || []) as MdmsRecord[];
    return mdmsRecords.map((record) => record.data as T);
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
      logoId: tenant.logoId || null,
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
};
