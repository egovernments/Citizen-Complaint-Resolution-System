import { config } from "../../infrastructure/config.js";
import { clearTenantCaches, digitTenantName, isActiveDigitTenant } from "../access-context/tenant-directory.js";
import { validUrlSlug } from "../access-context/tenant-route.js";
import { audit } from "../citizen-otp/audit.js";
import {
  ensureOrganization,
  IdentityAdminError,
  readTenantMappingForTenant,
  readTenantMappingForUrlSlug,
} from "../organizations/organization-service.js";

export interface TenantRouteBackfillResult {
  created: string[];
  skipped: Array<{ tenantId: string; reason: "NOT_ROOT" | "NOT_ACTIVE" | "ALREADY_MAPPED" }>;
  conflicts: Array<{ tenantId: string; reason: "INVALID_SLUG" | "SLUG_TAKEN" | "ALIAS_TAKEN" }>;
}

/**
 * Routes for existing tenants (#2167): every active DIGIT ROOT tenant that no
 * Organization or Organization group maps gets an Organization whose alias
 * and URL slug are the tenant id, unchanged (`ke` -> `/ke/digit-ui/...`).
 * Idempotent. A tenant that is already mapped is left exactly as it is, slug
 * or no slug; nothing is ever renamed or overwritten. Subtenants are ignored.
 */
export async function backfillTenantRoutes(options: { dryRun?: boolean; actor?: string } = {}): Promise<TenantRouteBackfillResult> {
  const result: TenantRouteBackfillResult = { created: [], skipped: [], conflicts: [] };
  clearTenantCaches();
  for (const tenantId of [...new Set(config.identityTenantRouteBackfillRoots)]) {
    if (tenantId.includes(".")) {
      result.skipped.push({ tenantId, reason: "NOT_ROOT" });
      continue;
    }
    if (!validUrlSlug(tenantId)) {
      result.conflicts.push({ tenantId, reason: "INVALID_SLUG" });
      continue;
    }
    if (!await isActiveDigitTenant(tenantId)) {
      result.skipped.push({ tenantId, reason: "NOT_ACTIVE" });
      continue;
    }
    if (await readTenantMappingForTenant(tenantId)) {
      result.skipped.push({ tenantId, reason: "ALREADY_MAPPED" });
      continue;
    }
    if (await readTenantMappingForUrlSlug(tenantId)) {
      result.conflicts.push({ tenantId, reason: "SLUG_TAKEN" });
      continue;
    }
    if (!options.dryRun) {
      try {
        await ensureOrganization({
          tenantId,
          alias: tenantId,
          name: await digitTenantName(tenantId) || tenantId,
          urlSlug: tenantId,
          adoptExisting: false,
        });
      } catch (error) {
        // Another Organization already owns the alias, or a slug/tenant
        // reservation appeared since the reads above: report, never adopt.
        if (!(error instanceof IdentityAdminError) || error.status !== 409) throw error;
        result.conflicts.push({ tenantId, reason: "ALIAS_TAKEN" });
        continue;
      }
    }
    result.created.push(tenantId);
  }
  clearTenantCaches();
  await audit({
    event: "TENANT_ROUTE_BACKFILL",
    outcome: result.conflicts.length ? "REFUSED" : "SUCCESS",
    actor: options.actor || "startup",
    detail: JSON.stringify({ dryRun: Boolean(options.dryRun), ...result }),
  });
  return result;
}
