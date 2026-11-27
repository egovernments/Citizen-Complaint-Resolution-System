import {
  IdentityAdminError,
  liveTenantMapping,
  readTenantMappingForTenant,
  readTenantMappingForUrlSlug,
  type TenantMapping,
} from "../organizations/organization-service.js";
import { DigitUnavailableError } from "../managed-accounts/digit-user-client.js";
import type { BoundTenant } from "../authentication/surfaces.js";
import { isActiveDigitTenant } from "./tenant-directory.js";

export { RESERVED_URL_SLUGS, validUrlSlug } from "./url-slug.js";
import { validUrlSlug } from "./url-slug.js";

/** Already-public routing metadata for one `/{urlSlug}/...` entry point. */
export interface PublicTenantRoute {
  urlSlug: string;
  tenantId: string;
  rootTenantId: string;
  parentTenantId: string | null;
  fallbackTenantIds: string[];
  name: string;
}

/**
 * Resolves a public URL slug to its mapped, live DIGIT tenant, or null when
 * the slug is malformed, unmapped or its tenant is not active in DIGIT.
 *
 * This is the single resolution used by `GET /tenant-contexts/{slug}`, by
 * employee/citizen `/authorize` (which binds the result to the login
 * attempt) and by branding. It grants nothing: authorization still happens
 * at context selection. Keycloak Admin (`IdentityAdminError`) and DIGIT
 * (`DigitUnavailableError`) failures propagate so callers answer 503.
 */
export async function resolvePublicTenantRoute(
  rawUrlSlug: string,
): Promise<PublicTenantRoute | null> {
  const urlSlug = rawUrlSlug.trim().toLowerCase();
  if (!validUrlSlug(urlSlug)) return null;
  const mapping = await readTenantMappingForUrlSlug(urlSlug);
  if (!mapping || !await isActiveDigitTenant(mapping.tenantId)) return null;
  return {
    urlSlug: mapping.urlSlug,
    tenantId: mapping.tenantId,
    rootTenantId: mapping.rootTenantId,
    parentTenantId: mapping.parentTenantId,
    fallbackTenantIds: mapping.fallbackTenantIds,
    name: mapping.name,
  };
}

export interface TenantRouteRefusal {
  status: 400 | 404 | 503;
  code: "INVALID_REQUEST" | "TENANT_ROUTE_NOT_FOUND" | "TENANT_ROUTE_UNAVAILABLE";
  error: string;
}

/** The route for a request's `tenantSlug`, or why it is refused (Admin or DIGIT outage: 503). */
export async function routeForSlug(tenantSlug: unknown): Promise<PublicTenantRoute | TenantRouteRefusal> {
  if (typeof tenantSlug !== "string" || !tenantSlug) {
    return { status: 400, code: "INVALID_REQUEST", error: "tenantSlug is required" };
  }
  try {
    return await resolvePublicTenantRoute(tenantSlug) ??
      { status: 404, code: "TENANT_ROUTE_NOT_FOUND", error: "Tenant route is not available" };
  } catch (error) {
    if (!(error instanceof IdentityAdminError || error instanceof DigitUnavailableError)) throw error;
    console.warn("Tenant route resolution failed:", error.message);
    return { status: 503, code: "TENANT_ROUTE_UNAVAILABLE", error: "Tenant routes are temporarily unavailable" };
  }
}

/**
 * The live mapping while the route a session was bound to is still mapped,
 * read from Keycloak: the same Organization (or group) still carries this slug
 * and tenant id, and the Organization is enabled. Null otherwise.
 */
export async function liveTenantRoute(
  route: { urlSlug: string; tenantId: string },
): Promise<TenantMapping | null> {
  const mapping = await readTenantMappingForUrlSlug(route.urlSlug);
  if (!mapping || mapping.tenantId !== route.tenantId) return null;
  return liveTenantMapping(mapping);
}

/**
 * The public route of a tenant id, for a link the BFF emails (#2801). The directory's slug for the
 * tenant is resolved as a request's slug is (`resolvePublicTenantRoute`: mapped, DIGIT tenant
 * active), then re-read live from Keycloak (`liveTenantRoute`), so a slug renamed or an
 * Organization disabled since this replica cached the directory is never emailed. Null otherwise;
 * Admin and DIGIT failures propagate.
 */
export async function liveRouteForTenant(tenantId: string): Promise<PublicTenantRoute | null> {
  const mapping = await readTenantMappingForTenant(tenantId);
  const route = mapping && await resolvePublicTenantRoute(mapping.urlSlug);
  return route?.tenantId === tenantId && await liveTenantRoute(route) ? route : null;
}

/** The tenant a sign-in is bound to, from its resolved route. */
export function boundTenantOf(route: PublicTenantRoute): BoundTenant {
  return { urlSlug: route.urlSlug, tenantId: route.tenantId, rootTenantId: route.rootTenantId, name: route.name };
}
