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
    return this.search<Department>(tenantId, MDMS_SCHEMAS.DEPARTMENT);
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
    return this.search<Designation>(tenantId, MDMS_SCHEMAS.DESIGNATION);
  },

  async createDesignation(tenantId: string, designation: Designation): Promise<MdmsRecord> {
    return this.create(tenantId, MDMS_SCHEMAS.DESIGNATION, designation.code, {
      code: designation.code,
      name: designation.name,
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

  async getComplaintTypes(tenantId: string): Promise<ComplaintType[]> {
    const results = await this.search<Record<string, unknown>>(
      tenantId,
      MDMS_SCHEMAS.PGR_SERVICE_DEFS
    );

    return results.map((r) => ({
      serviceCode: r.serviceCode as string,
      serviceName: r.serviceName as string,
      department: r.department as string,
      slaHours: r.slaHours as number,
      menuPath: r.menuPath as string | undefined,
      active: r.active as boolean,
      order: r.order as number | undefined,
    }));
  },

  async createComplaintType(
    tenantId: string,
    complaintType: ComplaintType
  ): Promise<MdmsRecord> {
    return this.create(
      tenantId,
      MDMS_SCHEMAS.PGR_SERVICE_DEFS,
      complaintType.serviceCode,
      {
        serviceCode: complaintType.serviceCode,
        serviceName: complaintType.serviceName,
        department: complaintType.department,
        slaHours: complaintType.slaHours,
        menuPath: complaintType.menuPath || 'Complaint',
        active: complaintType.active,
        order: complaintType.order || 1,
      }
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
    return this.create(stateTenantId, MDMS_SCHEMAS.TENANT, tenant.code, {
      code: tenant.code,
      name: tenant.name,
      description: tenant.description,
      logoId: tenant.logoId,
      emailId: tenant.emailId,
      address: tenant.address,
      contactNumber: tenant.contactNumber,
      city: tenant.city,
    });
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
};
