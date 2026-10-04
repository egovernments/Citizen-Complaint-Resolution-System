import { config } from "../../infrastructure/config.js";
import { withDigitAdmin } from "../managed-accounts/digit-admin-session.js";
import { searchAccounts, type DigitAccount } from "../managed-accounts/digit-user-client.js";
import { findManagedAccount, isBffManagedAccount, managedIdentity } from "../managed-accounts/managed-account-service.js";
import { staffAccess } from "../bindings/predicate.js";
import { readOrganizationByTenant } from "../onboarding/organization-reader.js";
import { BindingError, type BindingActor } from "../bindings/types.js";

export async function readDigitAccount(tenantId: string, uuid: string, userType = "EMPLOYEE"): Promise<DigitAccount | null> {
  for (const active of [true, false]) {
    const accounts = await withDigitAdmin((token) => searchAccounts(token, { tenantId, uuid: [uuid], userType, active }));
    const account = accounts.find((a) => a.uuid === uuid && a.tenantId === tenantId && a.type === userType);
    if (account) return account;
  }
  return null;
}

export async function staffAccount(subject: string, tenantId: string): Promise<DigitAccount | null> {
  const access = await staffAccess(subject, tenantId);
  if (!access.allowed) return null;
  return access.binding ? readDigitAccount(tenantId, access.binding.uuid)
    : findManagedAccount(managedIdentity(config.keycloakIssuer, subject, tenantId));
}

export async function requireWorkspace(tenantId: string, allowUnpublished = false) {
  const org = await readOrganizationByTenant(tenantId);
  if (!org || (!allowUnpublished && (!org.enabled || (org.lifecycle !== null && org.lifecycle !== "ACTIVE")))) {
    throw new BindingError("WORKSPACE_TENANT_REQUIRED", "An active workspace tenant is required");
  }
  return org;
}

export async function requireAccountAdmin(subject: string, tenantId: string): Promise<DigitAccount> {
  const account = await staffAccount(subject, tenantId);
  if (!account?.active || !account.roles.some((r) => r.tenantId === tenantId && r.code === "ACCOUNT_ADMIN")) {
    throw new BindingError("ADMIN_REQUIRED", "Live ACCOUNT_ADMIN access at this tenant is required");
  }
  return account;
}

export async function validateBinding(input: { subject: string; tenantId: string; uuid: string; actor: BindingActor }): Promise<void> {
  await requireWorkspace(input.tenantId, input.actor.kind === "workload");
  const target = await readDigitAccount(input.tenantId, input.uuid);
  if (!target?.active) throw new BindingError("DIGIT_ACCOUNT_NOT_FOUND", "No active employee exists at the workspace");
  if (isBffManagedAccount(target)) throw new BindingError("DIGIT_ACCOUNT_MANAGED", "Managed accounts cannot be bound");
  if (input.actor.kind !== "browser") return;
  if (input.actor.subject === input.subject) throw new BindingError("SELF_BINDING_FORBIDDEN", "You cannot bind your own account");
  const caller = await requireAccountAdmin(input.actor.subject, input.tenantId);
  const roles = new Set(caller.roles.filter((r) => r.tenantId === input.tenantId).map((r) => r.code));
  if (target.roles.some((r) => r.tenantId === input.tenantId && !roles.has(r.code))) {
    throw new BindingError("ROLE_ESCALATION_FORBIDDEN", "The employee holds a role you do not hold");
  }
}
