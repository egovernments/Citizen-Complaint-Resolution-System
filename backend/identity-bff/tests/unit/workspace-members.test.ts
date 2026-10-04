import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initCache, closeCache } from "../../src/infrastructure/redis.js";
import { config } from "../../src/infrastructure/config.js";
import type { UserRepresentation } from "../../src/modules/sync/keycloak-writer.js";
const f = vi.hoisted(() => ({ users: new Map<string, UserRepresentation>(), members: new Set<string>(), crash: "", emails: 0, activations: 0, revoked: [] as string[], createCount: 0, conflict: false }));
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
    ensureOrganizationMembership: vi.fn(async ({ organizationId, userId }: { organizationId: string; userId: string }) => { f.members.add(`${organizationId}:${userId}`); fail("membership"); }),
    sendPasswordSetupEmail: vi.fn(async () => { f.emails++; fail("email"); }),
  };
});
vi.mock("../../src/modules/workspace-members/authority.js", () => ({
  validateBinding: vi.fn(async () => {}), requireAccountAdmin: vi.fn(async () => ({})),
  requireWorkspace: vi.fn(async (tenantId: string) => ({ id: tenantId, alias: tenantId, name: tenantId, lifecycle: "ACTIVE", enabled: true })),
  readDigitAccount: vi.fn(async (tenantId: string, uuid: string) => ({ tenantId, uuid, active: true, userName: "employee", name: "Employee" })),
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
import { acceptWorkspaceInvitation, linkWorkspaceMember, removeWorkspaceMember, updateWorkspaceMemberEmail } from "../../src/modules/workspace-members/service.js";
import { requireWorkspace } from "../../src/modules/workspace-members/authority.js";
import { BindingError } from "../../src/modules/bindings/types.js";
import { activateStaffCredential, StaffLoginError } from "../../src/modules/accounts/credential-service.js";
const uuid = "00000000-0000-4000-8000-000000000001";
const input = { actor: "admin", tenantId: "pg", digitUuid: uuid, email: "employee@example.test" };
beforeAll(() => { Object.assign(config, { cachePrefix: `members-test-${process.pid}`, identityCredentialKeyCurrent: 1 }); initCache(); });
afterAll(() => closeCache());
beforeEach(() => { f.users.clear(); f.members.clear(); f.crash = ""; f.emails = 0; f.activations = 0; f.revoked = []; f.createCount = 0; f.conflict = false; });

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
    f.users.set("existing", { id: "existing", email: input.email, username: input.email, enabled: true, attributes: {} });
    const invite = await linkWorkspaceMember(input);
    expect(invite.binding.state).toBe("pending"); expect(f.members.size).toBe(0); expect(f.activations).toBe(0);
    await acceptWorkspaceInvitation("existing", "pg", invite.binding.invitationVersion);
    await acceptWorkspaceInvitation("existing", "pg", invite.binding.invitationVersion);
    expect(f.members.has("pg:existing")).toBe(true); expect(f.activations).toBe(1);
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
    f.users.set("existing", { id: "existing", email: input.email, username: input.email, enabled: true, attributes: {} });
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
