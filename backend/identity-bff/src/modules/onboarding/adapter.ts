import { clearTenantCaches, isActiveDigitTenant } from "../access-context/tenant-directory.js";
import { OnboardingError } from "./errors.js";
import { OnboardingPrimitives, organizationAttribute, type OnboardingOrganization } from "./primitives.js";
import { onboardingAdminRequest, readOnboardingOrganizations } from "./organization-reader.js";
import { createdId } from "../../integrations/keycloak/admin-api.js";
import type { OnboardingFence } from "./locks.js";
import type { FounderIdentity, Identifier, OnboardingRouteDependencies } from "./routes.js";

/** Supplied by core. No credential or binding implementation belongs here. */
export interface CoreOnboardingDependencies {
  withPersonLease<T>(subject: string, operation: (lease: OnboardingFence) => Promise<T>): Promise<T>;
  ensureActive(input: { subject: string; tenantId: string; uuid: string;
    actor: { kind: "workload"; operationId: string; restartNo: number };
  }): Promise<{ binding: { tenantId: string; uuid: string; state: string; boundAt?: number }; created: boolean }>;
  revokeTenantMembers(tenantId: string, reason: "ORGANIZATION_DISABLED"): Promise<void>;
}

export async function readFounderIdentity(subject: string): Promise<FounderIdentity | null> {
  const response = await onboardingAdminRequest(`/users/${encodeURIComponent(subject)}`, {}, [200, 404]);
  if (response.status === 404) return null;
  const user = await response.json() as { id: string; enabled?: boolean; email?: string; emailVerified?: boolean; firstName?: string; lastName?: string; username?: string };
  if (user.enabled === false) return null;
  return { subject: user.id, email: user.email, emailVerified: user.emailVerified === true,
    name: [user.firstName, user.lastName].filter(Boolean).join(" "), preferredUsername: user.username };
}

export function normalizeOrganizationName(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en").normalize("NFC");
}

/** One raw Organization scan for the whole batch, and one lookup per distinct tenant. */
export async function checkOnboardingIdentifiers(identifiers: Identifier[]) {
  const organizations = await readOnboardingOrganizations();
  const tenants = new Map<string, boolean>();
  if (identifiers.some((identifier) => identifier.type === "TENANT_ID")) clearTenantCaches();
  const results: Array<Identifier & { available: boolean }> = [];
  for (const identifier of identifiers) {
    const { type, value } = identifier;
    const normalized = value.trim().toLowerCase();
    let available = !organizations.some((org) => {
      if (type === "ORGANIZATION_NAME") return normalizeOrganizationName(org.name) === normalizeOrganizationName(value);
      if (type === "ORGANIZATION_ALIAS") return org.alias?.toLowerCase() === normalized;
      if (type === "URL_SLUG") return org.alias?.toLowerCase() === normalized || organizationAttribute(org, "urlSlug")?.toLowerCase() === normalized;
      if (type === "ACCOUNT_CODE") return organizationAttribute(org, "accountCode")?.toUpperCase() === value.toUpperCase();
      return organizationAttribute(org, "rootTenantId") === value;
    });
    if (available && type === "TENANT_ID") {
      if (!tenants.has(value)) {
        try { tenants.set(value, await isActiveDigitTenant(value)); }
        catch { throw new OnboardingError("IDENTITY_UNAVAILABLE", "Identifier availability could not be checked"); }
      }
      available = !tenants.get(value);
    }
    results.push({ ...identifier, available });
  }
  return results;
}

export function createOnboardingDependencies(core: CoreOnboardingDependencies): OnboardingRouteDependencies {
  const primitives = new OnboardingPrimitives({
    organizations: readOnboardingOrganizations,
    async create(organization) {
      const response = await onboardingAdminRequest("/organizations", { method: "POST", body: JSON.stringify(organization) }, [201, 409]);
      if (response.status === 409) throw new OnboardingError("SLUG_TAKEN", "The Organization name or slug is already reserved");
      const id = createdId(response);
      if (!id) {
        const created = (await readOnboardingOrganizations()).find((org) => org.alias === organization.alias &&
          organizationAttribute(org, "operationId") === organizationAttribute({ ...organization, id: "" }, "operationId"));
        if (!created) throw new OnboardingError("IDENTITY_UNAVAILABLE", "Keycloak did not identify the Organization it created");
        return created;
      }
      return { ...organization, id };
    },
    async update(organization: OnboardingOrganization) {
      // Send only representation fields: raw mock/admin extensions aren't writable.
      const { id, alias, name, enabled, attributes } = organization;
      await onboardingAdminRequest(`/organizations/${encodeURIComponent(id)}`, {
        method: "PUT", body: JSON.stringify({ id, alias, name, enabled, attributes }),
      });
    },
    async tenantExists(tenantId) { clearTenantCaches(); return isActiveDigitTenant(tenantId); },
    async identityExists(subject) { return Boolean(await readFounderIdentity(subject)); },
    async membership(organizationId, subject, operationFence) {
      await core.withPersonLease(subject, async (lease) => {
        if (!await readFounderIdentity(subject)) throw new OnboardingError("IDENTITY_NOT_FOUND", "The founder identity was not found");
        await operationFence.assertHeld();
        await lease.assertHeld();
        await onboardingAdminRequest(`/organizations/${encodeURIComponent(organizationId)}/members`, {
          method: "POST", body: JSON.stringify(subject),
        }, [201, 204, 409]);
      });
    },
    async binding(input, operationFence) {
      return core.withPersonLease(input.subject, async (lease) => {
        await operationFence.assertHeld();
        await lease.assertHeld();
        let result: Awaited<ReturnType<CoreOnboardingDependencies["ensureActive"]>>;
        try {
          result = await core.ensureActive({ subject: input.subject, tenantId: input.tenantId, uuid: input.digitUuid,
            actor: { kind: "workload", operationId: input.operationId, restartNo: input.restartNo } });
        } catch (error) {
          if (error && typeof error === "object" && "code" in error && error.code === "BINDING_REMOVED") {
            throw new OnboardingError("BINDING_CONFLICT", "The founder binding was removed and cannot be restored by onboarding");
          }
          throw error;
        }
        const { binding, created } = result;
        return { binding: { subject: input.subject, tenantId: binding.tenantId, digitUuid: binding.uuid, state: binding.state, boundAt: binding.boundAt }, created };
      });
    },
    revoke: (tenantId) => core.revokeTenantMembers(tenantId, "ORGANIZATION_DISABLED"),
    invalidate: clearTenantCaches,
  });
  return { primitives, identity: readFounderIdentity, identifiers: checkOnboardingIdentifiers };
}
