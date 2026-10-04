import {
  liveTenantMapping,
  readTenantMappingForUrlSlug,
} from "../organizations/organization-service.js";
import { isActiveDigitTenant } from "./tenant-directory.js";

const URL_SLUG = /^[a-z0-9-]{2,63}$/;

export function validUrlSlug(value: string): boolean {
  return URL_SLUG.test(value) && (value.match(/[a-z]/g) || []).length >= 2;
}

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

/**
 * True while the route a session was bound to is still mapped, read live
 * from Keycloak: the same Organization (or group) still carries this slug and
 * tenant id, and the Organization is enabled.
 */
export async function isLiveTenantRoute(
  route: { urlSlug: string; tenantId: string },
): Promise<boolean> {
  const mapping = await readTenantMappingForUrlSlug(route.urlSlug);
  if (!mapping || mapping.tenantId !== route.tenantId) return false;
  return (await liveTenantMapping(mapping)) !== null;
}
