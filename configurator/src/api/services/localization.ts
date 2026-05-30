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
    // Build query params - locale and tenantId are required as query params
    const params = new URLSearchParams({
      locale,
      tenantId,
    });
    if (module) {
      params.append('module', module);
    }

    const url = `${ENDPOINTS.LOCALIZATION_SEARCH}?${params.toString()}`;
    const response = await apiClient.post(url, {
      RequestInfo: apiClient.buildRequestInfo(),
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
  // Cache Bust
  // ============================================

  /** Tell the localization service to drop its in-memory per-tenant cache.
   *  Required after every write — without it `_search` keeps returning the
   *  pre-write snapshot, and the digit-ui's localStorage cache will be
   *  populated from stale data on next refresh. */
  async cacheBust(): Promise<void> {
    await apiClient.post(ENDPOINTS.LOCALIZATION_CACHE_BUST, {
      RequestInfo: apiClient.buildRequestInfo(),
    });
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
        module: 'rainmaker-common',
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
        module: 'rainmaker-common',
        locale,
      },
    ];
  },

  // Create localization for a complaint type.
  //
  // Emits up to four keys per record, deduped:
  //   1. `SERVICEDEFS.<serviceCode>`        — citizen, exact-case (back-compat)
  //   2. `SERVICEDEFS.<SERVICECODE>`        — citizen, uppercase (what the
  //      runtime hooks actually query via `serviceCode.toUpperCase()`)
  //   3. `SERVICEDEFS.<SERVICECODE>.<DEPT>` — employee form, department-
  //      qualified. The employee `useServiceDefs` hook builds the key as
  //      `SERVICEDEFS.<CODE_UPPER>.<DEPT>`; the citizen `getMenu` /
  //      `getSubMenu` path uses just `SERVICEDEFS.<CODE_UPPER>`. Both must
  //      resolve or one side renders the raw key (see
  //      egovernments/Citizen-Complaint-Resolution-System#539).
  //   4. `SERVICEDEFS.<MENUPATH_UPPER>`     — parent menu label that the
  //      citizen top-level menu builds via `t("SERVICEDEFS." +
  //      def.menuPath.toUpperCase())`. Without this a new menuPath renders
  //      as the raw key in the citizen create flow.
  //
  // Deduped because the backend's upsert rejects the whole batch on
  // core.DUPLICATE_MESSAGE_IDENTITY when it sees a repeat (e.g. an
  // already-uppercase serviceCode would otherwise emit two identical rows
  // for keys 1 and 2).
  //
  // `name` is the message for the serviceCode keys; `menuPath` (verbatim,
  // since the operator's display label isn't a separate field) is used
  // for the parent-menu key.
  buildComplaintTypeLocalizations(
    _tenantId: string,
    serviceCode: string,
    name: string,
    locale: string = 'en_IN',
    opts: { department?: string; menuPath?: string } = {}
  ): LocalizationMessage[] {
    const messages: LocalizationMessage[] = [];
    const seen = new Set<string>();
    const push = (code: string, message: string) => {
      if (seen.has(code)) return;
      seen.add(code);
      messages.push({ code, message, module: 'rainmaker-pgr', locale });
    };

    push(`SERVICEDEFS.${serviceCode}`, name);
    push(`SERVICEDEFS.${serviceCode.toUpperCase()}`, name);
    if (opts.department) {
      push(`SERVICEDEFS.${serviceCode.toUpperCase()}.${opts.department.toUpperCase()}`, name);
    }
    if (opts.menuPath) {
      push(`SERVICEDEFS.${opts.menuPath.toUpperCase()}`, opts.menuPath);
    }
    return messages;
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

  // Upload localizations for all complaint types. `department` and
  // `menuPath`, when present on each record, drive the emission of the
  // dept-qualified and menuPath-parent keys — see
  // `buildComplaintTypeLocalizations` for the full key list.
  async uploadComplaintTypeLocalizations(
    tenantId: string,
    types: { serviceCode: string; name: string; department?: string; menuPath?: string }[],
    locale: string = 'en_IN'
  ): Promise<{ success: number; failed: number }> {
    const messages = types.flatMap((t) =>
      this.buildComplaintTypeLocalizations(tenantId, t.serviceCode, t.name, locale, {
        department: t.department,
        menuPath: t.menuPath,
      })
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
