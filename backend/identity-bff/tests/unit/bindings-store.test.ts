import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeCache, getRedis, initCache } from "../../src/infrastructure/redis.js";
import { config } from "../../src/infrastructure/config.js";
import { withPersonLease } from "../../src/modules/accounts/person-lease.js";
import type { BindingUser } from "../../src/modules/bindings/types.js";
const db = vi.hoisted(() => ({ users: new Map<string, BindingUser>(), puts: [] as BindingUser[], beforeOwnersReturn: null as (() => Promise<void>) | null }));
vi.mock("../../src/modules/organizations/organization-service.js", () => ({
  request: vi.fn(async (path: string, init?: RequestInit) => {
    const url = new URL(path, "http://keycloak");
    if (url.pathname === "/users") {
      const query = url.searchParams.get("q");
      let users = [...db.users.values()];
      if (query) users = users.filter((u) => u.attributes?.["digit.boundUuids"]?.includes(query.slice("digit.boundUuids:".length)));
      if (query && db.beforeOwnersReturn) await db.beforeOwnersReturn();
      const first = Number(url.searchParams.get("first") || 0);
      return Response.json(users.slice(first, first + Number(url.searchParams.get("max") || 100)));
    }
    const id = decodeURIComponent(url.pathname.slice(7));
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body)); db.puts.push(body);
      db.users.set(id, { ...db.users.get(id), ...body });
      return new Response(null, { status: 204 });
    }
    return Response.json(db.users.get(id));
  }),
}));
vi.mock("../../src/modules/workspace-members/authority.js", () => ({ validateBinding: vi.fn(async () => {}) }));
import { accept, bindingsFor, createPending, ensureActive, readBindings, remove } from "../../src/modules/bindings/store.js";
const uuid = "00000000-0000-4000-8000-000000000001";
const otherUuid = "00000000-0000-4000-8000-000000000002";
const input = (subject = "invitee", tenantId = "pg", id = uuid) => ({ subject, tenantId, uuid: id, actor: { kind: "migration" as const } });
const pending = () => createPending({ ...input(), expiresAt: Date.now() + 60_000 });
beforeAll(() => {
  Object.assign(config, { cachePrefix: `bindings-test-${process.pid}` });
  initCache(`redis://${process.env.REDIS_HOST || "localhost"}:${process.env.REDIS_PORT || "16379"}`);
});
afterAll(() => closeCache());
beforeEach(() => {
  db.users.clear(); db.puts.length = 0; db.beforeOwnersReturn = null;
  for (const id of ["invitee", "other"]) db.users.set(id, { id, enabled: true, email: `${id}@example.test`, attributes: { unrelated: ["keep"] } });
});
describe("binding transitions with real person and uuid locks", () => {
  it("ensures once and writes binding and searchable uuid together", async () => {
    expect((await ensureActive(input())).created).toBe(true);
    expect((await ensureActive(input())).created).toBe(false);
    expect(db.puts).toHaveLength(1);
    expect(db.puts[0].attributes?.["digit.boundUuids"]).toEqual([`pg|${uuid}`]);
    expect(db.puts[0].attributes?.unrelated).toEqual(["keep"]);
    expect(db.puts[0]).not.toHaveProperty("enabled");
  });
  it("does not write after losing the uuid lock", async () => {
    const key = `${config.cachePrefix}:identity:uuid-lock:pg:${uuid}`;
    db.beforeOwnersReturn = async () => { await getRedis().set(key, "new-owner", "PX", 5000); };
    try {
      await expect(ensureActive(input())).rejects.toMatchObject({ code: "IDENTITY_BUSY" });
      expect(db.puts).toHaveLength(0);
    } finally { await getRedis().del(key); }
  });
  it("rejects a different uuid at the same key", async () => {
    await ensureActive(input());
    await expect(ensureActive(input("invitee", "pg", otherUuid))).rejects.toMatchObject({ code: "BINDING_CONFLICT" });
  });
  it("allows exactly one winner when two people race for a uuid", async () => {
    const results = await Promise.allSettled([ensureActive(input()), ensureActive(input("other"))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "DIGIT_ACCOUNT_LINKED_ELSEWHERE" } });
  });
  it("accepts an existing user invite and repeats the same version", async () => {
    await pending();
    for (let i = 0; i < 2; i++) expect(await accept({ subject: "invitee", tenantId: "pg", invitationVersion: 1 })).toMatchObject({ state: "active" });
  });
  it("never demotes active or lets ensure implicitly accept pending", async () => {
    await pending();
    await expect(ensureActive(input())).rejects.toMatchObject({ code: "PENDING_INVITATION" });
    await accept({ subject: "invitee", tenantId: "pg", invitationVersion: 1 });
    expect((await createPending({ ...input(), expiresAt: Date.now() + 60_000, reinvite: true })).binding.state).toBe("active");
  });
  it("removing pending releases uuid and keeps a tombstone", async () => {
    await pending();
    expect(await remove({ ...input(), removedBy: { kind: "browser", subject: "admin" } })).toMatchObject({ removed: true });
    expect(db.users.get("invitee")?.attributes?.["digit.boundUuids"]).toEqual([]);
    await ensureActive(input("other"));
    await expect(ensureActive(input())).rejects.toMatchObject({ code: "BINDING_REMOVED" });
    await expect(accept({ subject: "invitee", tenantId: "pg", invitationVersion: 1 })).rejects.toMatchObject({ code: "INVITATION_STALE" });
  });
  it("re-invites a removed key to the person's new DIGIT uuid", async () => {
    await ensureActive(input());
    await remove({ ...input(), removedBy: { kind: "browser", subject: "admin" } });
    await expect(createPending({ ...input("invitee", "pg", otherUuid), expiresAt: Date.now() + 60_000 })).rejects.toMatchObject({ code: "BINDING_CONFLICT" });
    const { binding } = await createPending({ ...input("invitee", "pg", otherUuid), expiresAt: Date.now() + 60_000, reinvite: true });
    expect(binding).toMatchObject({ uuid: otherUuid, state: "pending", invitationVersion: 2 });
    expect(db.users.get("invitee")?.attributes?.["digit.boundUuids"]).toEqual([`pg|${otherUuid}`]);
    expect(await accept({ subject: "invitee", tenantId: "pg", invitationVersion: 2 })).toMatchObject({ uuid: otherUuid, state: "active" });
  });
  it("explicit re-invite invalidates older invitation versions", async () => {
    await pending();
    expect((await createPending({ ...input(), expiresAt: Date.now() + 60_000, reinvite: true })).binding.invitationVersion).toBe(2);
    await expect(accept({ subject: "invitee", tenantId: "pg", invitationVersion: 1 })).rejects.toMatchObject({ code: "INVITATION_STALE" });
  });
  it("expires lazily, releases uuid and rejects expired invitations", async () => {
    await pending();
    const user = db.users.get("invitee")!;
    const doc = JSON.parse(user.attributes!["digit.bindings"][0]); doc.bindings[0].expiresAt = Date.now() - 1;
    user.attributes!["digit.bindings"] = [JSON.stringify(doc)];
    await expect(accept({ subject: "invitee", tenantId: "pg", invitationVersion: 1 })).rejects.toMatchObject({ code: "INVITATION_STALE" });
    expect((await readBindings("invitee"))[0]).toMatchObject({ state: "removed", removedBy: { kind: "expiry" } });
    expect(db.users.get("invitee")?.attributes?.["digit.boundUuids"]).toEqual([]);
    await ensureActive(input("other"));
  });
  it("lists bindings only at the requested tenant", async () => {
    await ensureActive(input()); await createPending({ ...input("other", "other", otherUuid), expiresAt: Date.now() + 60_000 });
    expect(await bindingsFor("pg")).toMatchObject([{ subject: "invitee", binding: { tenantId: "pg" } }]);
  });
  it("reads expired tenant inventory inside another person's lease without writing", async () => {
    await pending();
    const user = db.users.get("invitee")!;
    const doc = JSON.parse(user.attributes!["digit.bindings"][0]);
    doc.bindings[0].expiresAt = Date.now() - 1;
    user.attributes!["digit.bindings"] = [JSON.stringify(doc)];
    db.puts.length = 0;
    const inventory = await withPersonLease("admin", () => bindingsFor("pg"));
    expect(inventory).toEqual([]);
    expect(db.puts).toHaveLength(0);
    expect(JSON.parse(user.attributes!["digit.bindings"][0]).bindings[0].state).toBe("pending");
  });
  it("fails closed on corrupt binding state", async () => {
    db.users.get("invitee")!.attributes!["digit.bindings"] = ["not json"];
    await expect(ensureActive(input())).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE" });
  });
});
