import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initCache, closeCache, getRedis } from "../../src/infrastructure/redis.js";
import { withPersonLease } from "../../src/modules/accounts/person-lease.js";
import { indexBindingTenants } from "../../src/modules/bindings/store.js";
import { config } from "../../src/infrastructure/config.js";
import type { UserRepresentation } from "../../src/modules/sync/keycloak-writer.js";
const f = vi.hoisted(() => ({ users: new Map<string, UserRepresentation>(), members: new Set<string>(), crash: "", emails: 0, activations: 0, revoked: [] as string[], createCount: 0, conflict: false, targetRoles: [] as Array<{code: string; tenantId: string}>, callerRoles: [] as Array<{code: string; tenantId: string}>, passwords: new Set<string>(), duringEmail: undefined as undefined | (() => Promise<void>) }));
function bindingDoc(user: UserRepresentation) { return JSON.parse(user.attributes?.["digit.bindings"]?.[0] || '{"v":1,"bindings":[]}'); }
vi.mock("../../src/modules/organizations/organization-service.js", () => {
  const fail = (step: string) => { if (f.crash === step) { f.crash = ""; throw new Error(`crash:${step}`); } };
  return {
    request: vi.fn(async (path: string, init?: RequestInit) => {
      const url = new URL(path, "http://kc");
      if (url.pathname === "/users" && init?.method === "POST") {
        const user = { ...JSON.parse(String(init.body)), id: `new-${++f.createCount}` };
        f.users.set(user.id, user); fail("create");
        return new Response(null, { status: 201, headers: { location: `/users/${user.id}` } });
      }
      if (url.pathname === "/users") {
        let users = [...f.users.values()];
        for (const field of ["email", "username"]) if (url.searchParams.has(field)) users = users.filter((u) => u[field] === url.searchParams.get(field));
        const q = url.searchParams.get("q");
        if (q) users = users.filter((u) => u.attributes?.[q.slice(0, q.indexOf(":"))]?.includes(q.slice(q.indexOf(":") + 1)));
        const first = Number(url.searchParams.get("first") || 0);
        return Response.json(users.slice(first, first + Number(url.searchParams.get("max") || 100)));
      }
      if (url.pathname.includes("/execute-actions-email")) { f.emails++; await f.duringEmail?.(); fail("email"); return new Response(null, { status: 204 }); }
      if (url.pathname.startsWith("/organizations/") && init?.method === "DELETE") {
        const parts = url.pathname.split("/"); f.members.delete(`${parts[2]}:${parts[4]}`); fail("remove-membership"); return new Response(null, { status: 204 });
      }
      const id = decodeURIComponent(url.pathname.slice(7));
      if (init?.method === "PUT") {
        const value = JSON.parse(String(init.body));
        if (f.conflict && value.email !== f.users.get(id)?.email) throw Object.assign(new Error("email collision"), { status: 409 });
        const previous = f.users.get(id)!;
        const firstBinding = !previous.attributes?.["digit.bindings"] && value.attributes?.["digit.bindings"];
        const cleared = previous.attributes?.["digit.linkPending"] && !value.attributes?.["digit.linkPending"];
        f.users.set(id, { ...previous, ...value });
        if (firstBinding) fail("binding");
        if (cleared) fail("clear");
        return new Response(null, { status: 204 });
      }
      return Response.json(f.users.get(id));
    }),
    isOrganizationMember: vi.fn(async (org: string, subject: string) => f.members.has(`${org}:${subject}`)),
    ensureOrganizationMembership: vi.fn(async ({ organizationId, userId }: { organizationId: string; userId: string }) => { f.members.add(`${organizationId}:${userId}`); fail("membership"); }),
    sendPasswordSetupEmail: vi.fn(async () => { f.emails++; fail("email"); }),
    inspectPasswordSetupAccountById: vi.fn(async (id: string) => ({ userId: id, hasPassword: f.passwords.has(id), federatedProviders: [], emailVerified: f.users.get(id)?.emailVerified === true })),
  };
});
vi.mock("../../src/modules/workspace-members/authority.js", async (importOriginal) => ({
  mayManageRoles: (await importOriginal<typeof import("../../src/modules/workspace-members/authority.js")>()).mayManageRoles,
  validateBinding: vi.fn(async () => {}), requireAccountAdmin: vi.fn(async () => ({ roles: f.callerRoles })),
  requireWorkspace: vi.fn(async (tenantId: string) => ({ id: tenantId, alias: tenantId, name: tenantId, lifecycle: "ACTIVE", enabled: true })),
  readDigitAccount: vi.fn(async (tenantId: string, uuid: string) => ({ tenantId, uuid, active: true, userName: "employee", name: "Employee", roles: f.targetRoles })),
}));
vi.mock("../../src/modules/onboarding/organization-reader.js", () => ({
  readOnboardingOrganizations: vi.fn(async () => ["pg", "other"].map((id) => ({ id, alias: id, name: id, enabled: false, attributes: { "digit.rootTenantId": [id] } }))),
}));
vi.mock("../../src/modules/bindings/invitations.js", () => ({ invitationExpiryHours: vi.fn(async () => 336) }));
vi.mock("../../src/modules/accounts/credential-service.js", () => ({
  StaffLoginError: class StaffLoginError extends Error {},
  staffCredentialMode: () => "derived",
  activateStaffCredential: vi.fn(async (account: { tenantId: string; uuid: string }, lease: { subject: string }) => {
    f.activations++;
    const user = f.users.get(lease.subject)!;
    user.attributes!["digit.accounts"] = [JSON.stringify({ v: 1, entries: [{ ...account, kind: "staff", boundAt: 1, active: true, roles: [], credential: { keyVersion: 1 } }] })];
    if (f.crash === "activation") { f.crash = ""; throw new Error("crash:activation"); }
    return { keyVersion: 1 };
  }),
}));
vi.mock("../../src/modules/sync/mirror.js", () => ({ mirrorPerson: vi.fn(async () => { if (f.crash === "mirror") { f.crash = ""; throw new Error("crash:mirror"); } }) }));
vi.mock("../../src/modules/revocation/index.js", () => ({ revokeAccount: vi.fn(async (subject: string) => { f.revoked.push(subject); }) }));
vi.mock("../../src/modules/citizen-otp/audit.js", () => ({ audit: vi.fn(async () => {}) }));
import { acceptWorkspaceInvitation, declineWorkspaceInvitation, linkWorkspaceMember, listWorkspaceMembers, removeWorkspaceMember, updateWorkspaceMemberEmail } from "../../src/modules/workspace-members/service.js";
import { readOnboardingOrganizations } from "../../src/modules/onboarding/organization-reader.js";
import { isOrganizationMember, request } from "../../src/modules/organizations/organization-service.js";
import { readDigitAccount, requireWorkspace } from "../../src/modules/workspace-members/authority.js";
import { BindingError } from "../../src/modules/bindings/types.js";
import { audit } from "../../src/modules/citizen-otp/audit.js";
import { activateStaffCredential, StaffLoginError } from "../../src/modules/accounts/credential-service.js";
const uuid = "00000000-0000-4000-8000-000000000001";
const input = { actor: "admin", tenantId: "pg", digitUuid: uuid, email: "employee@example.test" };
beforeAll(() => { Object.assign(config, { cachePrefix: `members-test-${process.pid}`, identityCredentialKeyCurrent: 1 }); initCache(); });
afterAll(() => closeCache());
beforeEach(async () => { await getRedis().del(`${config.cachePrefix}:identity:member-resend:pg:${uuid}`); f.passwords.clear(); f.users.clear(); f.members.clear(); f.crash = ""; f.duringEmail = undefined; f.emails = 0; f.activations = 0; f.revoked = []; f.createCount = 0; f.conflict = false; f.targetRoles = [{ code: "EMPLOYEE", tenantId: "pg" }]; f.callerRoles = [{ code: "ACCOUNT_ADMIN", tenantId: "pg" }, ...f.targetRoles]; });

describe("resumable workspace membership", () => {
  it.each(["create", "membership", "binding", "activation", "email", "mirror", "clear"])("resumes after a crash at %s without creating another identity", async (step) => {
    f.crash = step;
    await expect(linkWorkspaceMember(input)).rejects.toThrow(`crash:${step}`);
    const result = await linkWorkspaceMember(input);
    expect(result.binding.state).toBe("active");
    expect(f.createCount).toBe(1);
    expect(f.members.has("pg:new-1")).toBe(true);
    expect(f.users.get("new-1")?.attributes?.["digit.linkPending"]).toBeUndefined();
    expect(f.activations).toBe(1);
    expect(bindingDoc(f.users.get("new-1")!).bindings).toHaveLength(1);
  });
  it("pages members from the index without per-member DIGIT lookups", async () => {
    const bind = (id: string, state: string, extra: object = {}) => f.users.set(id, { id, email: `${id}@example.test`, attributes: { "digit.bindingTenants": ["pg"],
      "digit.bindings": [JSON.stringify({ v: 1, bindings: [{ tenantId: "pg", uuid: `uuid-${id}`, state, invitationVersion: 1, createdAt: 1, createdBy: { kind: "conversion" }, ...extra }] })] } });
    for (const id of ["m1", "m2", "m3"]) bind(id, "active", { boundAt: 2 });
    bind("m0", "removed", { removedAt: 3 });
    bind("m15", "pending", { expiresAt: Date.now() - 1 });
    vi.mocked(readDigitAccount).mockClear();
    const { members } = await listWorkspaceMembers("admin", "pg");
    expect(members.map((m) => m.subject).sort()).toEqual(["m1", "m2", "m3"]);   // removed and expired invitations are left out
    expect(readDigitAccount).not.toHaveBeenCalled();
  });
  it("uses the existing-user branch for another workspace's in-flight user", async () => {
    f.crash = "create"; await expect(linkWorkspaceMember(input)).rejects.toThrow();
    const result = await linkWorkspaceMember({ ...input, tenantId: "other" });
    expect(result).toMatchObject({ identityUserCreated: false, binding: { state: "pending" } });
    expect(f.members.size).toBe(0); expect(f.activations).toBe(0); expect(f.emails).toBe(0);
  });
  it("rejects a username match whose email changed without duplicating the user", async () => {
    f.users.set("existing", { id: "existing", username: input.email, email: "new@example.test" });
    await expect(linkWorkspaceMember(input)).rejects.toMatchObject({ code: "IDENTITY_EMAIL_CHANGED" });
    expect(f.createCount).toBe(0);
  });
  it("accepts an existing user's invitation, grants membership and activates once", async () => {
    f.users.set("existing", { id: "existing", email: input.email, username: input.email, enabled: true, emailVerified: true, attributes: {} });
    const invite = await linkWorkspaceMember(input);
    expect(invite.binding.state).toBe("pending"); expect(f.members.size).toBe(0); expect(f.activations).toBe(0);
    await acceptWorkspaceInvitation("existing", "pg", invite.binding.invitationVersion);
    await acceptWorkspaceInvitation("existing", "pg", invite.binding.invitationVersion);
    expect(f.members.has("pg:existing")).toBe(true); expect(f.activations).toBe(1);
  });
  const existing = (id = "existing", email = input.email) => f.users.set(id, { id, email, username: email, enabled: true, emailVerified: true, attributes: {} });
  it("lets the invitee decline their own pending invitation, audited, and re-invite works after", async () => {
    existing();
    const invite = await linkWorkspaceMember(input);
    vi.mocked(audit).mockClear();
    expect(await declineWorkspaceInvitation("existing", "pg", invite.binding.invitationVersion)).toEqual({ declined: true });
    const stored = bindingDoc(f.users.get("existing")!).bindings[0];
    expect(stored).toMatchObject({ state: "removed", removedBy: { kind: "browser", subject: "existing" } });
    expect(f.users.get("existing")?.attributes?.["digit.boundUuids"]).toEqual([]);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ event: "ACCOUNT_LINK_REVOKE", subject: "existing", actor: "existing", tenantId: "pg", detail: "INVITATION_DECLINED" }));
    expect(f.members.size).toBe(0); expect(f.revoked).toEqual([]);
    // A repeat is idempotent; accepting the declined version is not possible.
    expect(await declineWorkspaceInvitation("existing", "pg", invite.binding.invitationVersion)).toEqual({ declined: true });
    await expect(acceptWorkspaceInvitation("existing", "pg", invite.binding.invitationVersion)).rejects.toMatchObject({ code: "INVITATION_STALE" });
    expect((await linkWorkspaceMember({ ...input, reinvite: true })).binding).toMatchObject({ state: "pending", invitationVersion: 2 });
  });
  it("refuses to decline an active binding, a stale version, or another person's invitation", async () => {
    existing();
    const invite = await linkWorkspaceMember(input);
    existing("other", "other@example.test");
    await expect(declineWorkspaceInvitation("other", "pg", invite.binding.invitationVersion)).rejects.toMatchObject({ code: "INVITATION_STALE", status: 409 });
    await expect(declineWorkspaceInvitation("existing", "pg", invite.binding.invitationVersion + 1)).rejects.toMatchObject({ code: "INVITATION_STALE" });
    await expect(declineWorkspaceInvitation("existing", "other", invite.binding.invitationVersion)).rejects.toMatchObject({ code: "INVITATION_STALE" });
    expect(bindingDoc(f.users.get("existing")!).bindings[0].state).toBe("pending");
    await acceptWorkspaceInvitation("existing", "pg", invite.binding.invitationVersion);
    await expect(declineWorkspaceInvitation("existing", "pg", invite.binding.invitationVersion)).rejects.toMatchObject({ code: "INVITATION_STALE" });
    expect(bindingDoc(f.users.get("existing")!).bindings[0].state).toBe("active");
    expect(f.members.has("pg:existing")).toBe(true);
  });
  it("does not report an admin removal as the invitee's decline", async () => {
    existing();
    const invite = await linkWorkspaceMember(input);
    await removeWorkspaceMember("admin", "pg", uuid);
    await expect(declineWorkspaceInvitation("existing", "pg", invite.binding.invitationVersion)).rejects.toMatchObject({ code: "INVITATION_STALE" });
  });
  it("refuses acceptance by an account whose email is not verified", async () => {
    f.users.set("existing", { id: "existing", email: input.email, username: input.email, enabled: true, emailVerified: false, attributes: {} });
    const invite = await linkWorkspaceMember(input);
    expect(f.emails).toBe(1);
    await expect(acceptWorkspaceInvitation("existing", "pg", invite.binding.invitationVersion)).rejects.toMatchObject({ code: "INVITATION_EMAIL_UNVERIFIED", status: 403 });
    expect(bindingDoc(f.users.get("existing")!).bindings[0].state).toBe("pending");
    expect(f.members.has("pg:existing")).toBe(false); expect(f.activations).toBe(0);
  });
  it("retries removal side effects even after the tombstone released its uuid", async () => {
    await linkWorkspaceMember(input);
    f.crash = "remove-membership";
    await expect(removeWorkspaceMember("admin", "pg", uuid)).rejects.toThrow();
    expect(await removeWorkspaceMember("admin", "pg", uuid)).toEqual({ removed: false, state: "removed" });
    expect(f.revoked).toEqual(["new-1"]); expect(f.members.has("pg:new-1")).toBe(false);
  });
  it("uses the identity.account_link audit tag", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try { await linkWorkspaceMember(input); expect(log).toHaveBeenCalledWith(expect.stringContaining('"audit":"identity.account_link"')); }
    finally { log.mockRestore(); }
  });
  it("changes only Keycloak email, clears verification and sends verification", async () => {
    await linkWorkspaceMember(input);
    const before = f.activations;
    expect(await updateWorkspaceMemberEmail("admin", "pg", uuid, "new@example.test")).toEqual({ status: "verification_sent" });
    expect(f.users.get("new-1")).toMatchObject({ email: "new@example.test", emailVerified: false, username: input.email });
    expect(f.activations).toBe(before);
  });
  it.each(["self", "higher role", "admin role at a sub-tenant", "same role in another tenant", "founder, role at another root", "operational role at another root", "other binding", "other membership", "citizen account", "verified phone", "legacy citizen account link", "citizen registration"])("denies admin email recovery for %s without changing the identity or sending email", async (reason) => {
    await linkWorkspaceMember(input);
    if (reason === "higher role") f.targetRoles.push({ code: "SUPERUSER", tenantId: "pg" });
    if (reason === "admin role at a sub-tenant") f.targetRoles.push({ code: "HRMS_ADMIN", tenantId: "pg.citya" });
    if (reason === "same role in another tenant") {
      f.targetRoles.push({ code: "HRMS_ADMIN", tenantId: "pg" });
      f.callerRoles.push({ code: "HRMS_ADMIN", tenantId: "other.city" });
    }
    if (reason === "founder, role at another root") {
      f.targetRoles.push({ code: "HRMS_ADMIN", tenantId: "other" });
      f.callerRoles.push({ code: "SUPERUSER", tenantId: "pg" });
    }
    if (reason === "operational role at another root") f.targetRoles.push({ code: "GRO", tenantId: "other" });
    if (reason === "other membership") f.members.add("other:new-1");
    if (reason === "verified phone") Object.assign(f.users.get("new-1")!.attributes!, { phoneNumber: ["+254712345678"], phoneNumberVerified: ["true"] });
    if (reason === "legacy citizen account link") Object.assign(f.users.get("new-1")!.attributes!, { "digit.accountLinks": ["CITIZEN|pg|citizen-uuid"] });
    if (reason === "citizen registration") Object.assign(f.users.get("new-1")!.attributes!, { "digit.citizenRegistrations": ["pg"] });
    if (reason === "citizen account") {
      const user = f.users.get("new-1")!;
      const entries = JSON.parse(user.attributes!["digit.accounts"]![0]).entries;
      entries.push({ kind: "citizen", tenantId: "pg", uuid: "citizen-uuid", boundAt: 1, active: true, roles: [] });
      user.attributes!["digit.accounts"] = [JSON.stringify({ v: 1, entries })];
    }
    if (reason === "other binding") {
      const user = f.users.get("new-1")!;
      const doc = bindingDoc(user);
      doc.bindings.push({ ...doc.bindings[0], tenantId: "other" });
      user.attributes!["digit.bindings"] = [JSON.stringify(doc)];
    }
    const before = structuredClone(f.users.get("new-1"));
    const emails = f.emails;
    await expect(updateWorkspaceMemberEmail(reason === "self" ? "new-1" : "admin", "pg", uuid, "attacker@example.test"))
      .rejects.toMatchObject({ code: "ADMIN_EMAIL_CHANGE_NOT_ALLOWED", status: 403 });
    expect(f.users.get("new-1")).toEqual(before);
    expect(f.emails).toBe(emails);
  });
  // Same rule as _link: operational roles inside the workspace are not guarded, and the founder may act on any role within the workspace.
  it.each([
    ["an operational role the caller lacks", [{ code: "GRO", tenantId: "pg" }, { code: "PGR_LME", tenantId: "pg.citya" }], []],
    ["an administrative role the caller holds", [{ code: "HRMS_ADMIN", tenantId: "pg.citya" }], [{ code: "HRMS_ADMIN", tenantId: "pg" }]],
    ["an operational role at another root the caller holds", [{ code: "GRO", tenantId: "other.city" }], [{ code: "GRO", tenantId: "other" }]],
    ["any role, for the founder", [{ code: "HRMS_ADMIN", tenantId: "pg.citya" }, { code: "INTERNAL_MICROSERVICE_ROLE", tenantId: "pg" }], [{ code: "SUPERUSER", tenantId: "pg" }]],
  ])("allows admin email recovery for %s", async (_reason, targetRoles, callerRoles) => {
    await linkWorkspaceMember(input);
    f.targetRoles.push(...targetRoles);
    f.callerRoles.push(...callerRoles);
    await expect(updateWorkspaceMemberEmail("admin", "pg", uuid, "new@example.test")).resolves.toEqual({ status: "verification_sent" });
  });
  it.each(["inventory", "membership"])("fails closed if the other-workspace %s check is unavailable", async (reason) => {
    await linkWorkspaceMember(input);
    const before = structuredClone(f.users.get("new-1"));
    const emails = f.emails;
    const dependency = reason === "inventory" ? vi.mocked(readOnboardingOrganizations) : vi.mocked(isOrganizationMember);
    dependency.mockRejectedValueOnce(new Error("dependency unavailable"));
    await expect(updateWorkspaceMemberEmail("admin", "pg", uuid, "attacker@example.test")).rejects.toThrow("dependency unavailable");
    expect(f.users.get("new-1")).toEqual(before);
    expect(f.emails).toBe(emails);
  });
  const withOtherBinding = (state: string, expiresAt: number) => {
    const user = f.users.get("new-1")!;
    const doc = bindingDoc(user);
    doc.bindings.push({ ...doc.bindings[0], tenantId: "other", state, expiresAt });
    user.attributes!["digit.bindings"] = [JSON.stringify(doc)];
  };
  // Security review 2: a pending invitation elsewhere could be accepted by
  // whoever controls the new email, so it blocks tenant-admin recovery.
  it("rejects recovery when an unexpired pending invitation exists in another workspace", async () => {
    await linkWorkspaceMember(input);
    withOtherBinding("pending", Date.now() + 3600_000);
    const before = structuredClone(f.users.get("new-1"));
    await expect(updateWorkspaceMemberEmail("admin", "pg", uuid, "attacker@example.test"))
      .rejects.toMatchObject({ code: "ADMIN_EMAIL_CHANGE_NOT_ALLOWED" });
    expect(f.users.get("new-1")).toEqual(before);
  });
  it.each([["removed", Date.now() + 3600_000], ["pending", Date.now() - 1000]])(
    "allows recovery with only a %s binding elsewhere (expired invitations don't count)", async (state, expiresAt) => {
      await linkWorkspaceMember(input);
      withOtherBinding(state as string, expiresAt as number);
      await expect(updateWorkspaceMemberEmail("admin", "pg", uuid, "new@example.test")).resolves.toEqual({ status: "verification_sent" });
    });
  it("allows recovery with an unverified Keycloak phone", async () => {
    await linkWorkspaceMember(input);
    Object.assign(f.users.get("new-1")!.attributes!, { phoneNumber: ["+254712345678"], phoneNumberVerified: ["false"] });
    await expect(updateWorkspaceMemberEmail("admin", "pg", uuid, "new@example.test")).resolves.toEqual({ status: "verification_sent" });
  });
  it("maps a concurrent Keycloak email conflict to IDENTITY_EMAIL_CHANGED", async () => {
    await linkWorkspaceMember(input); f.conflict = true;
    await expect(updateWorkspaceMemberEmail("admin", "pg", uuid, "new@example.test")).rejects.toMatchObject({ code: "IDENTITY_EMAIL_CHANGED" });
  });
  it("records the new address on the binding, so a member removed afterwards is listed with it", async () => {
    await linkWorkspaceMember(input);
    await updateWorkspaceMemberEmail("admin", "pg", uuid, "new@example.test");
    expect(bindingDoc(f.users.get("new-1")!).bindings[0]).toMatchObject({ state: "active", email: "new@example.test" });
    await removeWorkspaceMember("admin", "pg", uuid);
    const { members } = await listWorkspaceMembers("admin", "pg", 0, 100, "removed");
    expect(members).toEqual([expect.objectContaining({ subject: "new-1", email: "new@example.test" })]);
  });
  it("allows returning to the target's original username email", async () => {
    await linkWorkspaceMember(input);
    await updateWorkspaceMemberEmail("admin", "pg", uuid, "new@example.test");
    await expect(updateWorkspaceMemberEmail("admin", "pg", uuid, input.email)).resolves.toEqual({ status: "verification_sent" });
    expect(f.users.get("new-1")?.email).toBe(input.email);
  });
  it("keeps explicit reinvites pending after an interrupted new-user flow was removed", async () => {
    f.crash = "mirror";
    await expect(linkWorkspaceMember(input)).rejects.toThrow("crash:mirror");
    await removeWorkspaceMember("admin", "pg", uuid);
    const reinvite = await linkWorkspaceMember({ ...input, reinvite: true });
    expect(reinvite.binding.state).toBe("pending");
    expect((await linkWorkspaceMember({ ...input, reinvite: true })).binding.state).toBe("pending");
    expect(f.members.has("pg:new-1")).toBe(false);
  });
  it("keeps a workspace dependency failure retryable during acceptance", async () => {
    f.users.set("existing", { id: "existing", email: input.email, username: input.email, enabled: true, emailVerified: true, attributes: {} });
    const invite = await linkWorkspaceMember(input);
    vi.mocked(requireWorkspace).mockRejectedValueOnce(new BindingError("IDENTITY_UNAVAILABLE", "Temporary read failure"));
    await expect(acceptWorkspaceInvitation("existing", "pg", invite.binding.invitationVersion)).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE" });
    expect(bindingDoc(f.users.get("existing")!).bindings[0].state).toBe("pending");
    await expect(acceptWorkspaceInvitation("existing", "pg", invite.binding.invitationVersion)).resolves.toMatchObject({ binding: { state: "active" } });
  });
  it.each(["locked", "masked"])("maps %s activation failure to the workspace dependency contract", async (kind) => {
    vi.mocked(activateStaffCredential).mockRejectedValueOnce(kind === "locked" ? new StaffLoginError("ACCOUNT_LOCKED")
      : Object.assign(new Error("masked"), { code: "DIGIT_PII_MASKED" }));
    await expect(linkWorkspaceMember(input)).rejects.toMatchObject({ code: "DIGIT_UNAVAILABLE" });
    expect(f.users.get("new-1")?.attributes?.["digit.linkPending"]).toBeDefined();
    await expect(linkWorkspaceMember(input)).resolves.toMatchObject({ binding: { state: "active" } });
  });
});

describe("admin resend of the activation email", () => {
  const resend = { ...input, resend: true };
  it("re-sends password setup to a new employee who has not set a password, then cools down", async () => {
    await linkWorkspaceMember(input);
    const before = structuredClone(f.users.get("new-1")); const emails = f.emails;
    await expect(linkWorkspaceMember(resend)).resolves.toMatchObject({ activationEmailSent: true, activationEmail: "password_setup", binding: { state: "active" } });
    expect(f.emails).toBe(emails + 1);
    await expect(linkWorkspaceMember(resend)).rejects.toMatchObject({ code: "RESEND_TOO_SOON", status: 429, retryAfter: expect.any(Number) });
    expect(f.emails).toBe(emails + 1);
    expect(f.users.get("new-1")).toEqual(before);
  });
  it("sends the verify email to an unverified invitee who already has a password", async () => {
    f.users.set("existing", { id: "existing", email: input.email, username: input.email, enabled: true, emailVerified: false, attributes: {} });
    f.passwords.add("existing");
    await linkWorkspaceMember(input);
    await expect(linkWorkspaceMember(resend)).resolves.toMatchObject({ activationEmail: "verify_email", binding: { state: "pending" } });
  });
  it("refuses a member who is already set up, without sending or starting the cooldown", async () => {
    f.users.set("existing", { id: "existing", email: input.email, username: input.email, enabled: true, emailVerified: true, attributes: {} });
    f.passwords.add("existing");
    await linkWorkspaceMember(input); const emails = f.emails;
    await expect(linkWorkspaceMember(resend)).rejects.toMatchObject({ code: "ACTIVATION_NOT_NEEDED", status: 409 });
    expect(f.emails).toBe(emails);
    expect(await getRedis().exists(`${config.cachePrefix}:identity:member-resend:pg:${uuid}`)).toBe(0);
  });
  it("refuses a plain _link to a disabled person with IDENTITY_DISABLED, without binding or sending", async () => {
    f.users.set("existing", { id: "existing", email: input.email, username: input.email, enabled: false, emailVerified: false, attributes: {} });
    const emails = f.emails;
    await expect(linkWorkspaceMember(input)).rejects.toMatchObject({ code: "IDENTITY_DISABLED", status: 403 });
    expect(f.users.get("existing")!.attributes).toEqual({});
    expect(f.emails).toBe(emails);
  });
  it("refuses removed and unknown members", async () => {
    await expect(linkWorkspaceMember(resend)).rejects.toMatchObject({ code: "DIGIT_ACCOUNT_NOT_FOUND" });
    await linkWorkspaceMember(input); await removeWorkspaceMember("admin", "pg", uuid);
    await expect(linkWorkspaceMember(resend)).rejects.toMatchObject({ code: "BINDING_REMOVED" });
  });
  it("refuses an email that no longer matches the person, and a disabled person, without sending", async () => {
    await linkWorkspaceMember(input); const emails = f.emails;
    const user = f.users.get("new-1")!;
    // Found by username = the old email, but the email has changed.
    f.users.set("new-1", { ...user, email: "changed@example.test" });
    await expect(linkWorkspaceMember(resend)).rejects.toMatchObject({ code: "IDENTITY_EMAIL_CHANGED" });
    // A stale search hit whose fresh read under the lease no longer has the email.
    vi.mocked(request).mockImplementationOnce(async () => Response.json([user]));
    await expect(linkWorkspaceMember(resend)).rejects.toMatchObject({ code: "DIGIT_ACCOUNT_NOT_FOUND" });
    f.users.set("new-1", { ...user, enabled: false });
    await expect(linkWorkspaceMember(resend)).rejects.toMatchObject({ code: "IDENTITY_DISABLED", status: 403 });
    expect(f.emails).toBe(emails);
    expect(await getRedis().exists(`${config.cachePrefix}:identity:member-resend:pg:${uuid}`)).toBe(0);
  });
  it("a failed send does not release a window another request now owns", async () => {
    const key = `${config.cachePrefix}:identity:member-resend:pg:${uuid}`;
    f.users.set("existing", { id: "existing", email: input.email, username: input.email, enabled: true, emailVerified: false, attributes: {} });
    f.passwords.add("existing");
    await linkWorkspaceMember(input);
    // Simulate this request's window expiring mid-send and another request taking it.
    f.duringEmail = async () => { await getRedis().set(key, "other-request", "EX", 60); };
    f.crash = "email";
    await expect(linkWorkspaceMember(resend)).rejects.toThrow("crash:email");
    expect(await getRedis().get(key)).toBe("other-request");
  });
  it("releases the cooldown when the send fails", async () => {
    await linkWorkspaceMember(input);
    f.crash = "email";
    await expect(linkWorkspaceMember(resend)).rejects.toThrow("crash:email");
    await expect(linkWorkspaceMember(resend)).resolves.toMatchObject({ activationEmail: "password_setup" });
  });
});

describe("workspace member list", () => {
  const bind = (id: string, binding: Record<string, unknown>, entries?: unknown[]) => f.users.set(id, { id, email: `${id}@example.test`, firstName: id, attributes: {
    "digit.bindings": [JSON.stringify({ v: 1, bindings: [{ tenantId: "pg", invitationVersion: 1, createdAt: 1, createdBy: { kind: "conversion" }, ...binding }] })],
    "digit.bindingTenants": ["pg"], ...(entries && { "digit.accounts": [JSON.stringify({ v: 1, entries })] }) } });
  beforeEach(() => {
    bind("a-active", { uuid: "u1", state: "active", boundAt: 5 }, [{ kind: "staff", tenantId: "pg", uuid: "u1", boundAt: 5, active: false, name: "PG Name", roles: [{ code: "GRO", tenantId: "pg" }] }]);
    bind("b-pending", { uuid: "u2", state: "pending", expiresAt: Date.now() + 3600_000 });
    bind("c-expired", { uuid: "u3", state: "pending", expiresAt: 10 });
    bind("d-removed", { uuid: "u4", state: "removed", removedAt: 20 });
  });
  it("lists live members with mirrored DIGIT status and roles, by default", async () => {
    const { members, nextFirst } = await listWorkspaceMembers("admin", "pg");
    expect(members.map((m) => [m.subject, m.state])).toEqual([["a-active", "active"], ["b-pending", "pending"]]);
    expect(members[0]).toMatchObject({ digitActive: false, roles: [{ code: "GRO", tenantId: "pg" }], name: "PG Name", email: "a-active@example.test" });
    expect(members[1]).not.toHaveProperty("digitActive");
    expect(members[1]).not.toHaveProperty("name");
    expect(nextFirst).toBeUndefined();
  });
  it("filters removed members, reporting an expired invitation as removed without writing it", async () => {
    const before = structuredClone(f.users.get("c-expired"));
    const { members } = await listWorkspaceMembers("admin", "pg", 0, 100, "removed");
    expect(members.map((m) => [m.subject, m.removedAt])).toEqual([["c-expired", 10], ["d-removed", 20]]);
    expect(f.users.get("c-expired")).toEqual(before);
  });
  it("never shows another tenant's name, the person-wide firstName, or a non-member's current email", async () => {
    const two = (id: string, pgBinding: Record<string, unknown>) => f.users.set(id, { id, email: `${id}-now@example.test`, firstName: "Name At Other", attributes: {
      "digit.bindings": [JSON.stringify({ v: 1, bindings: [
        { tenantId: "other", uuid: `o-${id}`, state: "active", boundAt: 1, invitationVersion: 1, createdAt: 1, createdBy: { kind: "conversion" } },
        { tenantId: "pg", uuid: `p-${id}`, invitationVersion: 1, createdAt: 1, createdBy: { kind: "conversion" }, ...pgBinding }] })],
      "digit.bindingTenants": ["other", "pg"],
      "digit.accounts": [JSON.stringify({ v: 1, entries: [
        { kind: "staff", tenantId: "other", uuid: `o-${id}`, boundAt: 1, active: true, name: "Name At Other", roles: [] },
        ...(pgBinding.state === "active" ? [{ kind: "staff", tenantId: "pg", uuid: `p-${id}`, boundAt: 2, active: true, roles: [] }] : [])] })] } });
    f.users.clear();
    two("active-unnamed", { state: "active", boundAt: 2 });
    two("invited", { state: "pending", expiresAt: Date.now() + 3600_000, email: "invited-then@example.test" });
    two("legacy-invite", { state: "pending", expiresAt: Date.now() + 3600_000 });
    two("left", { state: "removed", removedAt: 3, removedBy: { kind: "browser" }, email: "left-then@example.test" });
    two("left-legacy", { state: "removed", removedAt: 3, removedBy: { kind: "browser" } });
    const pg = [...(await listWorkspaceMembers("admin", "pg")).members, ...(await listWorkspaceMembers("admin", "pg", 0, 100, "removed")).members];
    expect(pg.map(({ subject, email, name }) => ({ subject, email, name }))).toEqual([
      { subject: "active-unnamed", email: "active-unnamed-now@example.test", name: undefined },
      { subject: "invited", email: "invited-then@example.test", name: undefined },
      { subject: "legacy-invite", email: undefined, name: undefined },
      { subject: "left", email: "left-then@example.test", name: undefined },
      { subject: "left-legacy", email: undefined, name: undefined },
    ]);
    expect(pg.filter((m) => "email" in m && m.email === undefined)).toEqual([]);
    expect((await listWorkspaceMembers("admin", "other")).members.find((m) => m.subject === "invited")).toMatchObject({ name: "Name At Other", email: "invited-now@example.test" });
  });
  it("records the invited address on the binding, but keeps it out of _link responses", async () => {
    f.users.set("existing", { id: "existing", email: input.email, username: input.email, enabled: true, emailVerified: true, attributes: {} });
    const { binding } = await linkWorkspaceMember(input);
    expect(binding).not.toHaveProperty("email");
    expect(bindingDoc(f.users.get("existing")!).bindings[0]).toMatchObject({ state: "pending", email: input.email });
    await linkWorkspaceMember({ ...input, digitUuid: "00000000-0000-4000-8000-000000000002", email: "new.person@example.test" });
    expect(bindingDoc(f.users.get("new-1")!).bindings[0]).toMatchObject({ state: "active", email: "new.person@example.test" });
  });
  it("pages the indexed search and returns the next offset", async () => {
    const page = await listWorkspaceMembers("admin", "pg", 0, 2, "active");
    expect(page).toEqual({ members: [expect.objectContaining({ subject: "a-active" })], nextFirst: 2 });
    expect((await listWorkspaceMembers("admin", "pg", 2, 2, "active")).members).toEqual([]);
  });
  it("indexes every binding tenant on write, and backfills older records", async () => {
    await linkWorkspaceMember(input);
    expect(f.users.get("new-1")?.attributes?.["digit.bindingTenants"]).toEqual(["pg"]);
    delete f.users.get("a-active")!.attributes!["digit.bindingTenants"];
    await withPersonLease("a-active", () => indexBindingTenants("a-active"));
    expect(f.users.get("a-active")?.attributes?.["digit.bindingTenants"]).toEqual(["pg"]);
  });
  it("skips the Keycloak read for an already-indexed snapshot, and backfills a stale one", async () => {
    const indexedUser = structuredClone(f.users.get("a-active")!);
    vi.mocked(request).mockClear();
    await withPersonLease("a-active", () => indexBindingTenants("a-active", indexedUser));
    expect(request).not.toHaveBeenCalled();
    delete f.users.get("a-active")!.attributes!["digit.bindingTenants"];
    await withPersonLease("a-active", () => indexBindingTenants("a-active", structuredClone(f.users.get("a-active")!)));
    expect(f.users.get("a-active")?.attributes?.["digit.bindingTenants"]).toEqual(["pg"]);
  });
});
