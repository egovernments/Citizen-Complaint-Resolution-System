import { config } from "../../infrastructure/config.js";
import { withPersonLease, type PersonLease } from "../accounts/person-lease.js";
import { activateStaffCredential, staffCredentialMode, StaffLoginError } from "../accounts/credential-service.js";
import { linkRequestId, normalizeLinkEmail } from "../bindings/link-request-id.js";
import { invitationExpiryHours } from "../bindings/invitations.js";
import { accept, bindingsFromUser, createPending, effectiveBinding, ensureActive, readBindings, readBindingUser, remove, type Binding } from "../bindings/store.js";
import { BindingConflictError, BindingError, type BindingUser } from "../bindings/types.js";
import { ensureOrganizationMembership, inspectPasswordSetupAccountById, isOrganizationMember, request } from "../organizations/organization-service.js";
import { acquireRedisLease, getRedis } from "../../infrastructure/redis.js";
import { createdId, paged, readUser } from "../../integrations/keycloak/admin-api.js";
import { readOnboardingOrganizations } from "../onboarding/organization-reader.js";
import { organizationAttribute } from "../onboarding/primitives.js";
import { updateKeycloakUser } from "../sync/keycloak-writer.js";
import { accountEntries } from "../sync/state.js";
import { mirrorPerson } from "../sync/mirror.js";
import { sendPasswordSetup } from "../authentication/password-setup.js";
import { audit } from "../citizen-otp/audit.js";
import { readDigitAccount, requireAccountAdmin, requireWorkspace, validateBinding } from "./authority.js";
import { revokeAccount } from "../revocation/index.js";

export function publicBinding(subject: string, binding: Binding) {
  const { uuid, createdAt: _at, createdBy: _by, removedBy: _removedBy, ...rest } = binding;
  return { subject, digitUuid: uuid, ...rest };
}

async function findPerson(email: string, emailOnly = false): Promise<BindingUser | null> {
  for (const field of emailOnly ? ["email"] : ["email", "username"]) {
    const query = new URLSearchParams({ [field]: email, exact: "true", briefRepresentation: "false", max: "100" });
    const users = await (await request(`/users?${query}`)).json() as BindingUser[];
    const matches = users.filter((u) => (field === "email" ? u.email : u.username)?.toLowerCase() === email);
    if (matches.length > 1) throw new BindingError("IDENTITY_UNAVAILABLE", "Identity ownership is ambiguous");
    if (matches[0]) {
      if (normalizeLinkEmail(matches[0].email || "") !== email) throw new BindingError("IDENTITY_EMAIL_CHANGED", "This identity now uses a different email");
      return matches[0];
    }
  }
  return null;
}

function pendingMarker(user: BindingUser): { requestId: string } | null {
  const value = user.attributes?.["digit.linkPending"]?.[0];
  if (!value) return null;
  try { return JSON.parse(value); } catch { throw new BindingError("IDENTITY_UNAVAILABLE", "The link marker is invalid"); }
}

async function activate(binding: Binding, lease: PersonLease): Promise<void> {
  if (staffCredentialMode() !== "derived") return;
  const recorded = accountEntries(await readBindingUser(lease.subject)).find((e) => e.kind === "staff" && e.tenantId === binding.tenantId && e.uuid === binding.uuid);
  if (recorded?.credential?.keyVersion === config.identityCredentialKeyCurrent) return;
  const account = await readDigitAccount(binding.tenantId, binding.uuid);
  if (!account?.active) throw new BindingError("DIGIT_UNAVAILABLE", "The employee is not available for activation");
  try {
    await activateStaffCredential({ tenantId: binding.tenantId, uuid: binding.uuid, userName: account.userName }, lease);
  } catch (error) {
    // Workspace activation exposes dependency failure, not the sign-in route's
    // account-lock/PII codes. Retain the binding/marker so a retry can resume.
    if (error instanceof StaffLoginError || (error as { code?: string }).code === "DIGIT_PII_MASKED") {
      throw new BindingError("DIGIT_UNAVAILABLE", "Employee activation is temporarily unavailable");
    }
    throw error;
  }
}

async function linkAudit(subject: string, tenantId: string, uuid: string, actor: string, event: "ACCOUNT_LINK_CREATE" | "ACCOUNT_LINK_REVOKE") {
  console.info(JSON.stringify({ audit: "identity.account_link", event, subject, tenantId, digitUserUuid: uuid, actor }));
  await audit({ event, outcome: "SUCCESS", subject, tenantId, digitUserUuid: uuid, actor, method: "ADMIN", userType: "EMPLOYEE" });
}

export async function linkWorkspaceMember(input: { actor: string; tenantId: string; digitUuid: string; email: string; reinvite?: boolean; resend?: boolean }) {
  if (input.resend) return resendActivation(input);
  const email = normalizeLinkEmail(input.email);
  const requestId = linkRequestId(input.actor, input.tenantId, input.digitUuid, email);
  const actor = { kind: "browser" as const, subject: input.actor, requestId };
  // Validate role escalation before creating any identity.
  await validateBinding({ subject: "", tenantId: input.tenantId, uuid: input.digitUuid, actor });
  let user = await findPerson(email);
  if (!user) {
    const created = await request("/users", { method: "POST", body: JSON.stringify({
      username: email, email, enabled: true, emailVerified: false,
      requiredActions: ["VERIFY_EMAIL", "UPDATE_PASSWORD"], attributes: {
        "digit.linkPending": [JSON.stringify({ v: 1, tenantId: input.tenantId, digitUuid: input.digitUuid,
          email, requestId, actor: input.actor, createdAt: Date.now() })],
      },
    }) }, [201, 409]);
    const id = createdId(created);
    user = id ? await readBindingUser(id) : await findPerson(email);
    if (!user?.id) throw new BindingError("IDENTITY_UNAVAILABLE", "Identity creation did not return a user");
  }
  if (!user.id || user.enabled === false) throw new BindingError("IDENTITY_UNAVAILABLE", "The identity is not available");
  const subject = user.id;
  return withPersonLease(subject, async (lease) => {
    const fresh = await readBindingUser(subject);
    if (normalizeLinkEmail(fresh.email || "") !== email) throw new BindingError("IDENTITY_EMAIL_CHANGED", "This identity now uses a different email");
    await validateBinding({ subject, tenantId: input.tenantId, uuid: input.digitUuid, actor });
    const previous = (await readBindings(subject)).find((b) => b.tenantId === input.tenantId);
    const resumeNew = pendingMarker(fresh)?.requestId === requestId && previous?.state !== "pending" && !(previous?.state === "removed" && input.reinvite);
    if (!resumeNew) {
      const { binding } = await createPending({ subject, tenantId: input.tenantId, uuid: input.digitUuid, actor,
        expiresAt: Date.now() + await invitationExpiryHours(input.tenantId) * 3600_000, reinvite: input.reinvite });
      await mirrorPerson(subject);
      await linkAudit(subject, input.tenantId, input.digitUuid, input.actor, "ACCOUNT_LINK_CREATE");
      // _accept requires a verified email; give an unverified invitee the way to verify it,
      // unless a BFF-created account's own setup email (VERIFY_EMAIL pending) already does.
      if (fresh.emailVerified !== true && !fresh.requiredActions?.includes("VERIFY_EMAIL")) await sendVerifyEmail(subject);
      return { binding: publicBinding(subject, binding), identityUserCreated: false };
    }
    if (previous?.state === "removed") throw new BindingError("BINDING_REMOVED", "This binding was removed");
    if (previous && previous.uuid !== input.digitUuid) throw new BindingConflictError();
    const org = await requireWorkspace(input.tenantId);
    await lease.assertHeld();
    await ensureOrganizationMembership({ organizationId: org.id, userId: subject });
    const { binding } = await ensureActive({ subject, tenantId: input.tenantId, uuid: input.digitUuid, actor });
    await activate(binding, lease);
    await lease.assertHeld();
    await sendPasswordSetup({ userId: subject, hadPassword: false, emailVerified: fresh.emailVerified === true,
      returnTo: config.identityPostLoginRedirect, clientId: config.keycloakBffClientId });
    await mirrorPerson(subject);
    await updateKeycloakUser(subject, (current) => {
      if (pendingMarker(current)?.requestId !== requestId) return null;
      const attributes = { ...current.attributes }; delete attributes["digit.linkPending"];
      return { ...current, attributes };
    });
    await linkAudit(subject, input.tenantId, input.digitUuid, input.actor, "ACCOUNT_LINK_CREATE");
    return { binding: publicBinding(subject, binding), identityUserCreated: true, activationEmailSent: true };
  });
}

const RESEND_COOLDOWN_SECONDS = 60;

export class ResendTooSoonError extends BindingError {
  constructor(readonly retryAfter: number) { super("RESEND_TOO_SOON", "An activation email was sent recently"); }
}

/** `_link` with `resend: true`: re-sends sign-in setup for a live binding; the binding itself never changes. */
async function resendActivation(input: { actor: string; tenantId: string; digitUuid: string; email: string }) {
  const email = normalizeLinkEmail(input.email);
  const actor = { kind: "browser" as const, subject: input.actor, requestId: linkRequestId(input.actor, input.tenantId, input.digitUuid, email) };
  await validateBinding({ subject: "", tenantId: input.tenantId, uuid: input.digitUuid, actor });
  const subject = (await findPerson(email))?.id;
  if (!subject) throw new BindingError("DIGIT_ACCOUNT_NOT_FOUND", "No binding matches the employee and email");
  return withPersonLease(subject, async (lease) => {
    const user = await readBindingUser(subject);
    const record = bindingsFromUser(user).find((b) => b.tenantId === input.tenantId);
    const binding = record && effectiveBinding(record);
    if (normalizeLinkEmail(user.email || "") !== email || binding?.uuid !== input.digitUuid) throw new BindingError("DIGIT_ACCOUNT_NOT_FOUND", "No binding matches the employee and email");
    if (binding.state === "removed") throw new BindingError("BINDING_REMOVED", "This binding was removed");
    // A disabled person can't use either email; the condition won't change on retry.
    if (user.enabled === false) throw new BindingError("IDENTITY_DISABLED", "The member's identity is disabled");
    const account = await inspectPasswordSetupAccountById(subject);
    if (!account) throw new BindingError("IDENTITY_UNAVAILABLE", "The identity is not available");
    const needsPassword = user.requiredActions?.includes("UPDATE_PASSWORD") || (!account.hasPassword && !account.federatedProviders.length);
    if (!needsPassword && account.emailVerified) throw new BindingError("ACTIVATION_NOT_NEEDED", "The member has already set up sign-in");
    const key = `${config.cachePrefix}:identity:member-resend:${input.tenantId}:${input.digitUuid}`;
    // Token-owned window: a success lets it expire; a failed send releases only its own window.
    const window = await acquireRedisLease(key, { ttlMs: RESEND_COOLDOWN_SECONDS * 1000 });
    if (!window) throw new ResendTooSoonError(Math.max(1, await getRedis().ttl(key)));
    try {
      await lease.assertHeld();
      if (needsPassword) await sendPasswordSetup({ userId: subject, hadPassword: account.hasPassword, emailVerified: account.emailVerified,
        returnTo: config.identityPostLoginRedirect, clientId: config.keycloakBffClientId });
      else await sendVerifyEmail(subject);
    } catch (error) { await window.release(); throw error; }
    return { binding: publicBinding(subject, binding), identityUserCreated: false, activationEmailSent: true,
      activationEmail: needsPassword ? "password_setup" as const : "verify_email" as const };
  });
}

export async function acceptWorkspaceInvitation(subject: string, tenantId: string, invitationVersion: number) {
  return withPersonLease(subject, async (lease) => {
    const pending = (await readBindings(subject)).find((b) => b.tenantId === tenantId);
    if (!pending || pending.state === "removed" || pending.invitationVersion !== invitationVersion) throw new BindingError("INVITATION_STALE", "The invitation is no longer current");
    // Invitations are matched by email; only a person who proved that email may take the binding.
    if ((await readUser(subject)).emailVerified !== true) throw new BindingError("INVITATION_EMAIL_UNVERIFIED", "Verify your email before accepting the invitation");
    const org = await requireWorkspace(tenantId).catch((error) => {
      if (error instanceof BindingError && error.code === "WORKSPACE_TENANT_REQUIRED") {
        throw new BindingError("INVITATION_STALE", "The inviting workspace is unavailable");
      }
      throw error;
    });
    await lease.assertHeld();
    await ensureOrganizationMembership({ organizationId: org.id, userId: subject });
    const binding = await accept({ subject, tenantId, invitationVersion });
    await activate(binding, lease);
    await mirrorPerson(subject);
    return { binding: publicBinding(subject, binding) };
  });
}

/** Includes tombstones so retries finish removal side effects after a crash. */
async function membersAt(tenantId: string) {
  const result: Array<{ user: BindingUser; binding: Binding }> = [];
  for (const user of await paged<BindingUser>("/users?briefRepresentation=false")) {
    const binding = bindingsFromUser(user).find((b) => b.tenantId === tenantId);
    if (user.id && binding) result.push({ user, binding });
  }
  return result;
}

export type MemberState = Binding["state"];

/**
 * One indexed Keycloak page (`digit.bindingTenants`), so the cost is O(max), not O(realm).
 * Read-only: expiry is applied in the response, never written, and no lease is taken.
 * DIGIT status and roles come from the `digit.accounts` mirror (active bindings only).
 */
export async function listWorkspaceMembers(actor: string, tenantId: string, first = 0, max = 100, state?: MemberState) {
  await requireAccountAdmin(actor, tenantId);
  const query = new URLSearchParams({ q: `digit.bindingTenants:${tenantId}`, exact: "true", briefRepresentation: "false", first: String(first), max: String(max) });
  const users = await (await request(`/users?${query}`)).json() as BindingUser[];
  const members = users.flatMap((user) => {
    const record = bindingsFromUser(user).find((b) => b.tenantId === tenantId);
    const binding = record && effectiveBinding(record);
    if (!user.id || !binding || (state ? binding.state !== state : binding.state === "removed")) return [];
    let entry;
    try { entry = accountEntries(user).find((e) => e.kind === "staff" && e.tenantId === tenantId && e.uuid === binding.uuid); } catch { /* unmirrored */ }
    return [{ subject: user.id, email: user.email, name: user.firstName || "", digitUuid: binding.uuid, state: binding.state,
      invitationVersion: binding.invitationVersion, ...(binding.boundAt !== undefined && { boundAt: binding.boundAt }),
      ...(binding.expiresAt !== undefined && { expiresAt: binding.expiresAt }), ...(binding.removedAt !== undefined && { removedAt: binding.removedAt }),
      ...(entry && { digitActive: entry.active, roles: entry.roles }), ...(entry?.missing && { missing: true as const }) }];
  });
  return { members, ...(users.length === max && { nextFirst: first + max }) };
}

export async function removeWorkspaceMember(actor: string, tenantId: string, digitUuid: string) {
  await requireAccountAdmin(actor, tenantId);
  const rows = (await membersAt(tenantId)).filter((r) => r.binding.uuid === digitUuid);
  if (rows.some((r) => r.user.id === actor)) throw new BindingError("SELF_REMOVAL_FORBIDDEN", "You cannot remove your own binding");
  let removed = false;
  for (const { user } of rows) await withPersonLease(user.id!, async (lease) => {
    const result = await remove({ subject: user.id!, tenantId, uuid: digitUuid, removedBy: { kind: "browser", subject: actor } });
    removed ||= result.removed;
    const org = await requireWorkspace(tenantId);
    await lease.assertHeld();
    await request(`/organizations/${encodeURIComponent(org.id)}/members/${encodeURIComponent(user.id!)}`, { method: "DELETE" }, [204, 404]);
    await revokeAccount(user.id!, { tenantId, uuid: digitUuid }, "BINDING_REMOVED");
    await mirrorPerson(user.id!);
    await linkAudit(user.id!, tenantId, digitUuid, actor, "ACCOUNT_LINK_REVOKE");
  });
  return { removed, state: "removed" as const };
}

export async function updateWorkspaceMemberEmail(actor: string, tenantId: string, digitUuid: string, value: string) {
  await requireAccountAdmin(actor, tenantId);
  const email = normalizeLinkEmail(value);
  const rows = (await membersAt(tenantId)).filter((r) => r.binding.uuid === digitUuid && r.binding.state === "active");
  if (rows.length !== 1) throw new BindingError("DIGIT_ACCOUNT_NOT_FOUND", "No active binding matches the employee");
  const subject = rows[0].user.id!;
  return withPersonLease(subject, async (lease) => {
    const bindings = await readBindings(subject);
    const active = bindings.find((b) => b.tenantId === tenantId && b.uuid === digitUuid && b.state === "active");
    if (!active) throw new BindingError("DIGIT_ACCOUNT_NOT_FOUND", "The binding is no longer active");
    const denied = () => new BindingError("ADMIN_EMAIL_CHANGE_NOT_ALLOWED", "Use self-service UPDATE_EMAIL or operator global recovery");
    // Any live claim elsewhere blocks a tenant admin from redirecting the global
    // recovery email: an active binding, or an unexpired pending invitation that
    // the new address could accept (security review 2).
    const liveElsewhere = (b: (typeof bindings)[number]) => b.tenantId !== tenantId && (b.state === "active"
      || (b.state === "pending" && (!b.expiresAt || Number(b.expiresAt) > Date.now())));
    if (actor === subject || bindings.some(liveElsewhere)) throw denied();
    // Re-read live authority under the lease: email is a global recovery identifier.
    const caller = await requireAccountAdmin(actor, tenantId);
    const target = await readDigitAccount(tenantId, digitUuid);
    if (!target) throw new BindingError("DIGIT_ACCOUNT_NOT_FOUND", "The employee is no longer available");
    const roles = new Set(caller.roles.filter((r) => r.tenantId === tenantId).map((r) => r.code));
    if (target.roles.some((r) => r.tenantId === tenantId && !roles.has(r.code))) throw denied();
    // Membership can exist without a binding (including managed founder accounts).
    // Disabled workspaces are included: their membership can later be reactivated.
    for (const org of await readOnboardingOrganizations()) {
      if (organizationAttribute(org, "rootTenantId") !== tenantId && await isOrganizationMember(org.id, subject)) throw denied();
    }
    const owner = await findPerson(email, true);
    if (owner?.id && owner.id !== subject) throw new BindingError("IDENTITY_EMAIL_CHANGED", "This email belongs to another identity");
    await lease.assertHeld();
    try {
      await updateKeycloakUser(subject, (user) => ({ ...user, email, emailVerified: false }), { allowEmailChange: true });
    } catch (error) {
      if ((error as { status?: number }).status === 409) throw new BindingError("IDENTITY_EMAIL_CHANGED", "This email belongs to another identity");
      throw error;
    }
    await lease.assertHeld();
    await sendVerifyEmail(subject);
    return { status: "verification_sent" as const };
  });
}

async function sendVerifyEmail(subject: string) {
  const query = new URLSearchParams({ client_id: config.keycloakBffClientId, lifespan: String(config.identityPasswordSetupTtlSeconds) });
  await request(`/users/${encodeURIComponent(subject)}/execute-actions-email?${query}`, { method: "PUT", body: JSON.stringify(["VERIFY_EMAIL"]) });
}
