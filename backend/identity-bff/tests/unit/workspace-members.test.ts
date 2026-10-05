import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initCache, closeCache } from "../../src/infrastructure/redis.js";
import { config } from "../../src/infrastructure/config.js";
import type { UserRepresentation } from "../../src/modules/sync/keycloak-writer.js";
const f = vi.hoisted(() => ({ users: new Map<string, UserRepresentation>(), members: new Set<string>(), crash: "", emails: 0, activations: 0, revoked: [] as string[], createCount: 0, conflict: false, targetRoles: [] as Array<{code: string; tenantId: string}>, callerRoles: [] as Array<{code: string; tenantId: string}> }));
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
        if (q) users = users.filter((u) => u.attributes?.["digit.boundUuids"]?.includes(q.slice("digit.boundUuids:".length)));
        const first = Number(url.searchParams.get("first") || 0);
        return Response.json(users.slice(first, first + 100));
      }
      if (url.pathname.includes("/execute-actions-email")) { f.emails++; fail("email"); return new Response(null, { status: 204 }); }
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
import { acceptWorkspaceInvitation, linkWorkspaceMember, listWorkspaceMembers, removeWorkspaceMember, updateWorkspaceMemberEmail } from "../../src/modules/workspace-members/service.js";
import { readOnboardingOrganizations } from "../../src/modules/onboarding/organization-reader.js";
import { isOrganizationMember } from "../../src/modules/organizations/organization-service.js";
import { readDigitAccount, requireWorkspace } from "../../src/modules/workspace-members/authority.js";
import { BindingError } from "../../src/modules/bindings/types.js";
import { activateStaffCredential, StaffLoginError } from "../../src/modules/accounts/credential-service.js";
const uuid = "00000000-0000-4000-8000-000000000001";
const input = { actor: "admin", tenantId: "pg", digitUuid: uuid, email: "employee@example.test" };
beforeAll(() => { Object.assign(config, { cachePrefix: `members-test-${process.pid}`, identityCredentialKeyCurrent: 1 }); initCache(); });
afterAll(() => closeCache());
beforeEach(() => { f.users.clear(); f.members.clear(); f.crash = ""; f.emails = 0; f.activations = 0; f.revoked = []; f.createCount = 0; f.conflict = false; f.targetRoles = [{ code: "EMPLOYEE", tenantId: "pg" }]; f.callerRoles = [{ code: "ACCOUNT_ADMIN", tenantId: "pg" }, ...f.targetRoles]; });

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
  it("pages members before the per-member DIGIT lookups", async () => {
    const bind = (id: string, state: string, extra: object = {}) => f.users.set(id, { id, email: `${id}@example.test`, attributes: {
      "digit.bindings": [JSON.stringify({ v: 1, bindings: [{ tenantId: "pg", uuid: `uuid-${id}`, state, invitationVersion: 1, createdAt: 1, createdBy: { kind: "conversion" }, ...extra }] })] } });
    for (const id of ["m5", "m3", "m1", "m4", "m2"]) bind(id, "active", { boundAt: 2 });
    bind("m0", "removed", { removedAt: 3 });
    bind("m15", "pending", { expiresAt: Date.now() - 1 });
    vi.mocked(readDigitAccount).mockClear();
    const { members } = await listWorkspaceMembers("admin", "pg", 1, 2);
    expect(members.map((m) => m.subject)).toEqual(["m2", "m3"]);
    expect(members[0]).toEqual({ subject: "m2", email: "m2@example.test", name: "Employee", digitUuid: "uuid-m2", state: "active", invitationVersion: 1, boundAt: 2 });
    expect(readDigitAccount).toHaveBeenCalledTimes(2);
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
  it.each(["self", "higher role", "admin role at a sub-tenant", "same role in another tenant", "founder, role at another root", "other binding", "other membership"])("denies admin email recovery for %s without changing the identity or sending email", async (reason) => {
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
    if (reason === "other membership") f.members.add("other:new-1");
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
  // Same rule as _link: operational roles are not guarded, and the founder may act on any role within the workspace.
  it.each([
    ["an operational role the caller lacks", [{ code: "GRO", tenantId: "pg" }, { code: "PGR_LME", tenantId: "pg.citya" }], []],
    ["an administrative role the caller holds", [{ code: "HRMS_ADMIN", tenantId: "pg.citya" }], [{ code: "HRMS_ADMIN", tenantId: "pg" }]],
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
  it("maps a concurrent Keycloak email conflict to IDENTITY_EMAIL_CHANGED", async () => {
    await linkWorkspaceMember(input); f.conflict = true;
    await expect(updateWorkspaceMemberEmail("admin", "pg", uuid, "new@example.test")).rejects.toMatchObject({ code: "IDENTITY_EMAIL_CHANGED" });
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
