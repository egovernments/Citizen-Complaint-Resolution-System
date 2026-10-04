import { config } from "../../infrastructure/config.js";
import { getAdminToken } from "../../integrations/keycloak/admin-session.js";
import { OnboardingError } from "./errors.js";
import { organizationAttribute, type OnboardingOrganization } from "./primitives.js";

/** Raw reads deliberately include disabled, FAILED and PROVISIONING records. */
export async function onboardingAdminRequest(path: string, init: RequestInit = {}, accepted?: number[]): Promise<Response> {
  try {
    const response = await fetch(`${config.keycloakAdminUrl}/admin/realms/${encodeURIComponent(config.keycloakOrganizationRealm)}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await getAdminToken()}`, ...init.headers },
    });
    if (accepted ? accepted.includes(response.status) : response.ok) return response;
    throw new OnboardingError("IDENTITY_UNAVAILABLE", `Keycloak onboarding request failed (${response.status})`);
  } catch (error) {
    if (error instanceof OnboardingError) throw error;
    throw new OnboardingError("IDENTITY_UNAVAILABLE", "Keycloak onboarding request failed");
  }
}

export async function readOnboardingOrganizations(): Promise<OnboardingOrganization[]> {
  const result: OnboardingOrganization[] = [];
  for (let first = 0; ; first += 100) {
    const response = await onboardingAdminRequest(`/organizations?briefRepresentation=false&first=${first}&max=100`);
    const page = await response.json() as OnboardingOrganization[];
    result.push(...page);
    if (page.length < 100) return result;
  }
}

export interface RawTenantOrganization {
  id: string;
  alias: string;
  name: string;
  lifecycle: "PROVISIONING" | "ACTIVE" | "FAILED" | null;
  enabled: boolean;
}

/** Inventory for sync/revocation; visibility filtering must never hide a tenant here. */
export async function listOrganizationTenants(): Promise<string[]> {
  return [...new Set((await readOnboardingOrganizations()).flatMap((org) => {
    const tenantId = organizationAttribute(org, "rootTenantId");
    return tenantId ? [tenantId] : [];
  }))].sort();
}

export async function readOrganizationByTenant(tenantId: string): Promise<RawTenantOrganization | null> {
  const candidates = (await readOnboardingOrganizations()).filter((org) =>
    organizationAttribute(org, "rootTenantId") === tenantId && !organizationAttribute(org, "supersededBy"));
  if (!candidates.length) return null;
  // A crash may leave the supersession marker unpublished. Select the highest
  // attempt only when all records have one explicit operation owner.
  const owners = new Set(candidates.map((org) => organizationAttribute(org, "operationId")));
  if (candidates.length > 1 && (owners.size !== 1 || owners.has(undefined))) {
    throw new OnboardingError("IDENTITY_UNAVAILABLE", "Ambiguous Organization ownership for tenant");
  }
  candidates.sort((a, b) => Number(organizationAttribute(b, "restartNo") ?? -1) - Number(organizationAttribute(a, "restartNo") ?? -1));
  if (candidates.length > 1 && organizationAttribute(candidates[0], "restartNo") === organizationAttribute(candidates[1], "restartNo")) {
    throw new OnboardingError("IDENTITY_UNAVAILABLE", "Ambiguous Organization attempt for tenant");
  }
  const org = candidates[0];
  const lifecycle = organizationAttribute(org, "lifecycle");
  if (lifecycle !== undefined && !["PROVISIONING", "ACTIVE", "FAILED"].includes(lifecycle)) {
    throw new OnboardingError("IDENTITY_UNAVAILABLE", "Invalid Organization lifecycle");
  }
  return { id: org.id, alias: org.alias, name: org.name, enabled: org.enabled !== false,
    lifecycle: lifecycle as RawTenantOrganization["lifecycle"] ?? null };
}
