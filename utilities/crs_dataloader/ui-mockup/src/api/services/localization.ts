// Localization Service
import { apiClient } from '../client';
import { ENDPOINTS } from '../config';
import type { LocalizationMessage } from '../types';

export const localizationService = {
  // Batch size for upsert operations
  BATCH_SIZE: 500,

  // ============================================
  // Search Messages
  // ============================================

  async searchMessages(
    tenantId: string,
    locale: string = 'en_IN',
    module?: string
  ): Promise<LocalizationMessage[]> {
    const response = await apiClient.post(ENDPOINTS.LOCALIZATION_SEARCH, {
      RequestInfo: apiClient.buildRequestInfo(),
      tenantId,
      locale,
      module,
    });

    return (response.messages || []) as LocalizationMessage[];
  },

  // ============================================
  // Upsert Messages
  // ============================================

  async upsertMessages(
    tenantId: string,
    locale: string,
    messages: LocalizationMessage[]
  ): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    // Process in batches
    const batches = this.chunkArray(messages, this.BATCH_SIZE);

    for (const batch of batches) {
      try {
        await apiClient.post(ENDPOINTS.LOCALIZATION_UPSERT, {
          RequestInfo: apiClient.buildRequestInfo({
            apiId: 'emp',
            action: 'create',
          }),
          tenantId,
          locale,
          messages: batch.map((m) => ({
            code: m.code,
            message: m.message,
            module: m.module,
            locale: m.locale || locale,
          })),
        });
        success += batch.length;
      } catch {
        failed += batch.length;
      }
    }

    return { success, failed };
  },

  // ============================================
  // Helper Methods for Different Entity Types
  // ============================================

  // Create localization for a department
  buildDepartmentLocalizations(
    _tenantId: string,
    code: string,
    name: string,
    locale: string = 'en_IN'
  ): LocalizationMessage[] {
    return [
      {
        code: `COMMON_MASTERS_DEPARTMENT_${code}`,
        message: name,
        module: 'rainmaker-common-masters',
        locale,
      },
    ];
  },

  // Create localization for a designation
  buildDesignationLocalizations(
    _tenantId: string,
    code: string,
    name: string,
    locale: string = 'en_IN'
  ): LocalizationMessage[] {
    return [
      {
        code: `COMMON_MASTERS_DESIGNATION_${code}`,
        message: name,
        module: 'rainmaker-common-masters',
        locale,
      },
    ];
  },

  // Create localization for a complaint type
  buildComplaintTypeLocalizations(
    _tenantId: string,
    serviceCode: string,
    serviceName: string,
    locale: string = 'en_IN'
  ): LocalizationMessage[] {
    return [
      {
        code: `SERVICEDEFS.${serviceCode}`,
        message: serviceName,
        module: 'rainmaker-pgr',
        locale,
      },
      {
        code: `SERVICEDEFS.${serviceCode.toUpperCase()}`,
        message: serviceName,
        module: 'rainmaker-pgr',
        locale,
      },
    ];
  },

  // Create localization for a boundary
  buildBoundaryLocalizations(
    tenantId: string,
    code: string,
    name: string,
    hierarchyType: string,
    locale: string = 'en_IN'
  ): LocalizationMessage[] {
    const tenantPrefix = tenantId.toUpperCase().replace(/\./g, '_');
    return [
      {
        code: `${tenantPrefix}_${hierarchyType}_${code}`,
        message: name,
        module: 'rainmaker-common',
        locale,
      },
    ];
  },

  // Create localization for tenant name
  buildTenantLocalizations(
    tenantCode: string,
    tenantName: string,
    locale: string = 'en_IN'
  ): LocalizationMessage[] {
    const codeUpper = tenantCode.toUpperCase().replace(/\./g, '_');
    return [
      {
        code: `TENANT_TENANTS_${codeUpper}`,
        message: tenantName,
        module: 'rainmaker-common',
        locale,
      },
    ];
  },

  // ============================================
  // Bulk Localization Methods
  // ============================================

  // Upload localizations for all departments
  async uploadDepartmentLocalizations(
    tenantId: string,
    departments: { code: string; name: string }[],
    locale: string = 'en_IN'
  ): Promise<{ success: number; failed: number }> {
    const messages = departments.flatMap((d) =>
      this.buildDepartmentLocalizations(tenantId, d.code, d.name, locale)
    );
    return this.upsertMessages(tenantId, locale, messages);
  },

  // Upload localizations for all designations
  async uploadDesignationLocalizations(
    tenantId: string,
    designations: { code: string; name: string }[],
    locale: string = 'en_IN'
  ): Promise<{ success: number; failed: number }> {
    const messages = designations.flatMap((d) =>
      this.buildDesignationLocalizations(tenantId, d.code, d.name, locale)
    );
    return this.upsertMessages(tenantId, locale, messages);
  },

  // Upload localizations for all complaint types
  async uploadComplaintTypeLocalizations(
    tenantId: string,
    types: { serviceCode: string; serviceName: string }[],
    locale: string = 'en_IN'
  ): Promise<{ success: number; failed: number }> {
    const messages = types.flatMap((t) =>
      this.buildComplaintTypeLocalizations(tenantId, t.serviceCode, t.serviceName, locale)
    );
    return this.upsertMessages(tenantId, locale, messages);
  },

  // Upload localizations for all boundaries
  async uploadBoundaryLocalizations(
    tenantId: string,
    boundaries: { code: string; name: string }[],
    hierarchyType: string,
    locale: string = 'en_IN'
  ): Promise<{ success: number; failed: number }> {
    const messages = boundaries.flatMap((b) =>
      this.buildBoundaryLocalizations(tenantId, b.code, b.name, hierarchyType, locale)
    );
    return this.upsertMessages(tenantId, locale, messages);
  },

  // ============================================
  // Utility Methods
  // ============================================

  chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  },
};
