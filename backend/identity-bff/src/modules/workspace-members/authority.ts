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
  if (!target || (!target.active && input.actor.kind !== "migration")) {
    throw new BindingError("DIGIT_ACCOUNT_NOT_FOUND", "No eligible employee exists at the workspace");
  }
  if (isBffManagedAccount(target)) throw new BindingError("DIGIT_ACCOUNT_MANAGED", "Managed accounts cannot be bound");
  if (input.actor.kind !== "browser") return;
  if (input.actor.subject === input.subject) throw new BindingError("SELF_BINDING_FORBIDDEN", "You cannot bind your own account");
  const caller = await requireAccountAdmin(input.actor.subject, input.tenantId);
  // Every target role counts, including HRMS roles at sub-tenants (pg.citya under pg): the caller
  // must hold the same code at the workspace or at a tenant covering the target role's tenant.
  const covers = (callerTenant: string, roleTenant: string) =>
    callerTenant === input.tenantId || callerTenant === roleTenant || roleTenant.startsWith(`${callerTenant}.`);
  if (target.roles.some((r) => !caller.roles.some((c) => c.code === r.code && covers(c.tenantId, r.tenantId)))) {
    throw new BindingError("ROLE_ESCALATION_FORBIDDEN", "The employee holds a role you do not hold");
  }
}
