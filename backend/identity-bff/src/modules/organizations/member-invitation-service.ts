import { config } from "../../infrastructure/config.js";
import type { SelectedIdentityContext } from "../sessions/types.js";
import { syncSubjectTenant } from "../reconciliation/subject-sync.js";
import {
  ensureInvitedIdentityUser,
  ensureOrganizationMembership,
  ensureOrganizationRoleAssignment,
  IdentityAdminError,
  readOrganizationMapping,
  readOrganizationReconciliation,
  sendInvitedIdentityUserActivation,
} from "./organization-service.js";

export interface InviteOrganizationMemberInput {
  actorSubject: string;
  context: SelectedIdentityContext;
  email: string;
  name: string;
  mobileNumber: string;
  countryCode?: string;
  roles: string[];
}

export interface OrganizationMemberInvitation {
  member: {
    identityUserId: string;
    organizationId: string;
    tenantId: string;
    email: string;
    name: string;
    roles: string[];
    digitUserUuid: string;
  };
  identityUserCreated: boolean;
  digitAccountCreated: boolean;
  activationEmailSent: boolean;
}

async function canManageOrganization(organizationId: string, subject: string): Promise<boolean> {
  // Subject-scoped: only the caller's own membership and groups decide this,
  // so an invite must not page every member of the Organization.
  // (Dhruv review, #2088.)
  const state = await readOrganizationReconciliation(
    organizationId,
    config.digitRoleClientId,
    subject,
  );
  if (!state?.enabled) return false;
  const roles = state.memberRoles.get(subject);
  if (!roles) return false;
  return roles.some((role) => config.identityOrganizationAdminRoles.includes(role));
}

function splitName(name: string): { firstName: string; lastName: string } {
  const [firstName, ...rest] = name.trim().split(/\s+/);
  return { firstName, lastName: rest.join(" ") || "-" };
}

/**
 * Grants one person access to the selected Organization and creates the
 * tenant-local DIGIT compatibility account. Provisioning is idempotent, so a
 * dependency failure can be retried without creating another identity.
 */
export async function inviteOrganizationMember(
  input: InviteOrganizationMemberInput,
): Promise<OrganizationMemberInvitation> {
  const mapping = await readOrganizationMapping(input.context.organizationId);
  if (!mapping || mapping.tenantId !== input.context.tenantId) {
    throw new IdentityAdminError("The selected Organization is no longer available", 403);
  }
  if (!await canManageOrganization(mapping.organizationId, input.actorSubject)) {
    throw new IdentityAdminError("Organization administrator access is required", 403);
  }

  const identity = await ensureInvitedIdentityUser({
    email: input.email,
    ...splitName(input.name),
  });
  await ensureOrganizationMembership({
    organizationId: mapping.organizationId,
    userId: identity.id,
  });
  await ensureOrganizationRoleAssignment({
    organizationId: mapping.organizationId,
    userId: identity.id,
    groupName: config.identityOrganizationMemberGroup,
    clientId: config.digitRoleClientId,
    roles: input.roles,
  });

  const outcome = await syncSubjectTenant(
    identity.id,
    mapping.tenantId,
    input.mobileNumber,
    input.countryCode,
  );
  if (!outcome.account?.active) {
    throw new IdentityAdminError("The DIGIT employee account could not be provisioned");
  }

  let activationEmailSent = false;
  if (identity.activationRequired) {
    await sendInvitedIdentityUserActivation(identity.id);
    activationEmailSent = true;
  }
  return {
    member: {
      identityUserId: identity.id,
      organizationId: mapping.organizationId,
      tenantId: mapping.tenantId,
      email: identity.email,
      name: identity.name,
      roles: outcome.account.roles.map((role) => role.code).sort(),
      digitUserUuid: outcome.account.uuid,
    },
    identityUserCreated: identity.created,
    digitAccountCreated: outcome.created,
    activationEmailSent,
  };
}
