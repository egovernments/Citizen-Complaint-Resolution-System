import { isActiveDigitTenant } from "../access-context/tenant-directory.js";
import { managedFallbackAccess } from "./managed-fallback.js";
import { isOrganizationMember } from "../organizations/organization-service.js";
import { bindingsFromUser, effectiveBinding, readBindingUser, type Binding } from "./store.js";
import { readOrganizationByTenant } from "../onboarding/organization-reader.js";

export type AccessDenial = "KEYCLOAK_DISABLED" | "NO_ACTIVE_BINDING" | "NOT_A_MEMBER" |
  "ORGANIZATION_INACTIVE" | "TENANT_INACTIVE" | "PHONE_NOT_VERIFIED";
export interface StaffAccess {
  allowed: boolean;
  denial?: AccessDenial;
  binding?: Binding;
  via: "binding" | "managed";
}

/** Authorization always uses fresh identity and membership reads. */
export async function staffAccess(subject: string, tenantId: string): Promise<StaffAccess> {
  const user = await readBindingUser(subject);
  const record = bindingsFromUser(user).find((b) => b.tenantId === tenantId);
  const binding = record && effectiveBinding(record);
  const base = { via: record ? "binding" as const : "managed" as const, ...(binding && { binding }) };
  const deny = (denial: AccessDenial): StaffAccess => ({ ...base, allowed: false, denial });
  if (user.enabled === false) return deny("KEYCLOAK_DISABLED");
  // A pending/removed record must never fall back to a former managed account.
  if (binding && binding.state !== "active") return deny("NO_ACTIVE_BINDING");
  if (!binding) {
    const fallback = await managedFallbackAccess(subject, tenantId);
    return fallback.allowed ? { ...base, allowed: true } : deny(fallback.denial);
  }
  const org = await readOrganizationByTenant(tenantId);
  if (!org || !org.enabled || (org.lifecycle !== null && org.lifecycle !== "ACTIVE")) return deny("ORGANIZATION_INACTIVE");
  if (!await isActiveDigitTenant(tenantId)) return deny("TENANT_INACTIVE");
  if (!await isOrganizationMember(org.id, subject)) return deny("NOT_A_MEMBER");
  return { ...base, allowed: true };
}

export async function citizenAccess(subject: string): Promise<{ allowed: boolean; denial?: AccessDenial }> {
  const user = await readBindingUser(subject);
  if (user.enabled === false) return { allowed: false, denial: "KEYCLOAK_DISABLED" };
  if (user.attributes?.phoneNumberVerified?.[0] !== "true" || !user.attributes?.phoneNumber?.[0]) {
    return { allowed: false, denial: "PHONE_NOT_VERIFIED" };
  }
  return { allowed: true };
}
