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
        // Batch failed (likely DUPLICATE_MESSAGE_IDENTITY from a system-inserted record).
        // Retry one-by-one so only the true duplicate fails instead of the whole batch.
        for (const msg of batch) {
          try {
            await apiClient.post(ENDPOINTS.LOCALIZATION_UPSERT, {
              RequestInfo: apiClient.buildRequestInfo({ apiId: 'emp', action: 'create' }),
              tenantId,
              locale,
              messages: [{ code: msg.code, message: msg.message, module: msg.module, locale: msg.locale || locale }],
            });
            success += 1;
          } catch {
            failed += 1;
          }
        }
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
    opts: { department?: string; menuPath?: string; menuName?: string } = {}
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
      // Prefer the human group label ("Maternal & Neonatal Emergencies")
      // when the caller carries one; the bare menuPath code is the
      // legacy fallback for callers without a display name.
      push(`SERVICEDEFS.${opts.menuPath.toUpperCase()}`, opts.menuName || opts.menuPath);
    }
    return messages;
  },

  // Create localization for a boundary.
  // Emits two keys per boundary, both in module rainmaker-boundary-{hierarchyType.toLowerCase()}:
  //   1. Bare code (e.g. "PB_AMR") — used by the PGR create-complaint dropdown via t(boundary.code)
  //   2. Prefixed i18nkey (e.g. "MZ_MAPUTO_maputo_hierarchy_type_PB_AMR") — used by BPr/map components
  // Deduped in case code is already uppercase-prefixed and both forms are identical.
  //
  // The module name is LOWER-CASED to match the PGR reader, which is the
  // established convention on the consuming side: both digit-ui-esbuild
  // (products/pgr/src/Module.js:39) and frontend/micro-ui
  // (.../pgr/src/Module.js:57) build the module as
  // `boundary-${hierarchyType.toLowerCase()}`. Without lower-casing here, a
  // mixed-case hierarchy ("BOMET-Hierarchy") lands under
  // `rainmaker-boundary-BOMET-Hierarchy` while the UI requests
  // `rainmaker-boundary-bomet-hierarchy` → 0 hits → every boundary dropdown
  // (Country/County/Ward) renders the raw code instead of the name.
  buildBoundaryLocalizations(
    tenantId: string,
    code: string,
    name: string,
    hierarchyType: string,
    locale: string = 'en_IN'
  ): LocalizationMessage[] {
    const module = `rainmaker-boundary-${hierarchyType.toLowerCase()}`;
    const tenantPrefix = tenantId.toUpperCase().replace(/\./g, '_');
    const prefixedCode = `${tenantPrefix}_${hierarchyType}_${code}`;
    const messages: LocalizationMessage[] = [{ code, message: name, module, locale }];
    if (prefixedCode !== code) {
      messages.push({ code: prefixedCode, message: name, module, locale });
    }
    return messages;
  },

  // Create localization for boundary hierarchy level labels.
  // BoundaryComponent.js (line 257) builds the key as `${hierarchyType}_${key.toUpperCase()}`
  // e.g. "temp_MUNICÍPIO". Three variants are emitted into rainmaker-common (the only module
  // guaranteed loaded at startup via StateInfo.localizationModules):
  //   1. mixed — hierarchyType + "_" + boundaryType.toUpperCase()  ← what BoundaryComponent uses
  //   2. original case — hierarchyType + "_" + boundaryType        ← back-compat
  //   3. fully uppercase                                            ← used by map/BPr components
  buildHierarchyLevelLocalizations(
    hierarchyType: string,
    levels: { boundaryType: string }[],
    locale: string = 'en_IN'
  ): LocalizationMessage[] {
    const messages: LocalizationMessage[] = [];
    const module = 'rainmaker-common';
    const seen = new Set<string>();
    for (const level of levels) {
      const msg = level.boundaryType;
      const push = (code: string) => {
        if (seen.has(code)) return;
        seen.add(code);
        messages.push({ code, message: msg, module, locale });
      };
      push(`${hierarchyType}_${level.boundaryType.toUpperCase()}`); // BoundaryComponent pattern
      push(`${hierarchyType}_${level.boundaryType}`);               // original case
      push(`${hierarchyType}_${level.boundaryType}`.toUpperCase()); // fully uppercase
    }
    return messages;
  },

  async uploadHierarchyLevelLocalizations(
    tenantId: string,
    hierarchyType: string,
    levels: { boundaryType: string }[],
    locale: string = 'en_IN'
  ): Promise<{ success: number; failed: number }> {
    const messages = this.buildHierarchyLevelLocalizations(hierarchyType, levels, locale);
    return this.upsertMessages(tenantId, locale, messages);
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
  // Also always pushes CS_COMPLAINT_LOCATION — a static PGR UI label
  // hardcoded in CreateComplaintConfig.js that no source tenant carries.
  async uploadComplaintTypeLocalizations(
    tenantId: string,
    types: { serviceCode: string; name: string; department?: string; menuPath?: string; menuName?: string }[],
    locale: string = 'en_IN'
  ): Promise<{ success: number; failed: number }> {
    const raw = types.flatMap((t) =>
      this.buildComplaintTypeLocalizations(tenantId, t.serviceCode, t.name, locale, {
        department: t.department,
        menuPath: t.menuPath,
        menuName: t.menuName,
      })
    );
    // Dedupe across all types — multiple types sharing the same menuPath
    // (e.g. "Complaint") each emit SERVICEDEFS.<MENUPATH>, which the upsert
    // endpoint rejects with DUPLICATE_MESSAGE_IDENTITY.
    const seen = new Set<string>();
    const messages = raw.filter((m) => {
      if (seen.has(m.code)) return false;
      seen.add(m.code);
      return true;
    });
    // Static PGR form label — not derived from any MDMS data, never copied
    // by bootstrap, must be seeded explicitly on every tenant.
    if (!seen.has('CS_COMPLAINT_LOCATION')) {
      messages.push({ code: 'CS_COMPLAINT_LOCATION', message: 'Complaint Location', module: 'rainmaker-pgr', locale });
    }
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
