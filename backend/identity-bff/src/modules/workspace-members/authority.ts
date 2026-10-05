import { config } from "../../infrastructure/config.js";
import { withDigitAdmin } from "../managed-accounts/digit-admin-session.js";
import { searchAccounts, type DigitAccount, type DigitRole } from "../managed-accounts/digit-user-client.js";
import { findManagedAccount, isBffManagedAccount, managedIdentity } from "../managed-accounts/managed-account-service.js";
import { staffAccess } from "../bindings/predicate.js";
import { readOrganizationByTenant } from "../onboarding/organization-reader.js";
import { BindingError, type BindingActor } from "../bindings/types.js";
import { isAdministrativeRole } from "../../contract/roles.js";

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
  if (!mayManageRoles(caller.roles, target.roles, input.tenantId)) {
    throw new BindingError("ROLE_ESCALATION_FORBIDDEN", "The employee holds an administrative role you do not hold");
  }
}

/**
 * The role rule shared by `_link` and `_updateEmail`. Only administrative target roles count (ADMINISTRATIVE_ROLES or
 * `*_ADMIN`), including HRMS roles at sub-tenants (pg.citya under pg): the caller must hold the same code at the
 * role's tenant or a tenant above it (pg covers pg and pg.citya, never pgx or another root). A SUPERUSER at the workspace (the founder) skips that
 * check for target roles inside the workspace subtree, so may grant any role there; roles at another root still need it.
 */
export function mayManageRoles(callerRoles: DigitRole[], targetRoles: DigitRole[], tenantId: string): boolean {
  const founder = callerRoles.some((c) => c.code === "SUPERUSER" && c.tenantId === tenantId);
  const inWorkspace = (roleTenant: string) => roleTenant === tenantId || roleTenant.startsWith(`${tenantId}.`);
  const covers = (callerTenant: string, roleTenant: string) =>
    callerTenant === roleTenant || roleTenant.startsWith(`${callerTenant}.`);
  return !targetRoles.some((r) => isAdministrativeRole(r.code) && !(founder && inWorkspace(r.tenantId))
    && !callerRoles.some((c) => c.code === r.code && covers(c.tenantId, r.tenantId)));
}
