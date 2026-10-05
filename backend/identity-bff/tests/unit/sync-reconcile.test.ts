import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { initCache, closeCache, getRedis } from "../../src/infrastructure/redis.js";
import { currentPersonLease, withPersonLease } from "../../src/modules/accounts/person-lease.js";
import { recordToken, readToken } from "../../src/modules/revocation/inventory.js";
import * as digitClient from "../../src/modules/managed-accounts/digit-user-client.js";
import * as credentials from "../../src/modules/accounts/credential-service.js";
import { bindingsFor, indexBindingTenants } from "../../src/modules/bindings/store.js";
import { runReconcile, startReconcile, getReconcileReadiness, requestReconcileNow, reconcileStatsKey, reconcileLeaseKey } from "../../src/modules/sync/reconcile.js";

const mocks = vi.hoisted(() => ({ request: vi.fn(), read: vi.fn(), bindings: vi.fn(), organization: vi.fn(),
  organizations: vi.fn(), active: vi.fn(), name: vi.fn(), member: vi.fn(), revoke: vi.fn(), person: vi.fn(),
  tenant: vi.fn(), identifiers: vi.fn() }));
vi.mock("../../src/modules/organizations/organization-service.js", () => ({ request: mocks.request,
  isOrganizationMember: mocks.member, IdentityAdminError: class extends Error {} }));
vi.mock("../../src/modules/sync/digit-reader.js", () => ({ readDigitAccount: mocks.read }));
vi.mock("../../src/modules/bindings/store.js", () => ({ readBindings: mocks.bindings, bindingsFor: vi.fn(), indexBindingTenants: vi.fn() }));
vi.mock("../../src/modules/revocation/index.js", () => ({ revokeAccount: mocks.revoke,
  revokePerson: mocks.person, revokeTenantMembers: mocks.tenant }));
vi.mock("../../src/modules/onboarding/organization-reader.js", () => ({ readOrganizationByTenant: mocks.organization,
  listOrganizationTenants: mocks.organizations }));
vi.mock("../../src/modules/access-context/tenant-directory.js", () => ({ isActiveDigitTenant: mocks.active,
  digitTenantName: mocks.name, clearTenantCaches: vi.fn() }));
vi.mock("../../src/modules/sync/identifiers.js", () => ({ propagateIdentifiers: mocks.identifiers }));
let user: any;
let account: any;
let organization: any;
let puts: Array<{ path: string; body: any }>;
beforeAll(() => {
  Object.assign(config, { cachePrefix: `reconcile-${process.pid}`, identityReconciliationIntervalSeconds: 300,
    identityReconciliationLeaseSeconds: 300 });
  initCache(`redis://127.0.0.1:${process.env.REDIS_PORT || 16379}`);
});
afterAll(closeCache);
beforeEach(async () => {
  const keys = await getRedis().keys(`reconcile-${process.pid}:*`);
  if (keys.length) await getRedis().del(...keys);
  vi.restoreAllMocks();
  vi.resetAllMocks();
  puts = [];
  const binding = { tenantId: "tenant", uuid: "staff", state: "active", boundAt: 1 };
  const entry = { kind: "staff", tenantId: "tenant", uuid: "staff", boundAt: 1, active: true,
    userName: "employee", roles: [{ code: "EMPLOYEE", tenantId: "tenant" }] };
  user = { id: "person", enabled: true, firstName: "Name", lastName: "", attributes: {
    "digit.bindings": [JSON.stringify({ v: 1, bindings: [binding] })],
    "digit.accounts": [JSON.stringify({ v: 1, entries: [entry] })],
  } };
  account = { uuid: "staff", tenantId: "tenant", name: "Name", userName: "employee",
    type: "EMPLOYEE", active: true, roles: entry.roles };
  organization = { id: "org", alias: "tenant", name: "Tenant", lifecycle: "ACTIVE", enabled: true };
  mocks.request.mockImplementation(async (path, init) => {
    if (init?.method === "PUT") {
      const body = JSON.parse(init.body);
      puts.push({ path, body });
      if (path.startsWith("/users/")) user = { ...user, ...body };
      return new Response(null, { status: 204 });
    }
    if (path.startsWith("/users?")) return new Response(JSON.stringify([{ id: "person" }]));
    if (path.startsWith("/organizations/org/members")) return new Response(JSON.stringify([{ id: "person" }]));
    if (path.startsWith("/organizations/")) return new Response(JSON.stringify({ ...organization, domains: [], attributes: { "digit.lifecycle": ["ACTIVE"] } }));
    return new Response(JSON.stringify(user));
  });
  mocks.bindings.mockImplementation(async () => JSON.parse(user.attributes["digit.bindings"][0]).bindings);
  mocks.read.mockImplementation(async () => structuredClone(account));
  mocks.organization.mockImplementation(async () => organization);
  mocks.organizations.mockResolvedValue(["tenant"]);
  mocks.active.mockResolvedValue(true);
  mocks.name.mockResolvedValue("Tenant");
  mocks.member.mockResolvedValue(true);
  mocks.identifiers.mockResolvedValue({ written: 0, unchanged: 1, skipped: 0 });
  mocks.tenant.mockImplementation(async () => expect(currentPersonLease()).toBeNull());
});

describe("reconciliation", () => {
  async function useRealRevocation() {
    const real = await vi.importActual<typeof import("../../src/modules/revocation/index.js")>("../../src/modules/revocation/index.js");
    mocks.revoke.mockImplementation(real.revokeAccount);
    mocks.person.mockImplementation(real.revokePerson);
    mocks.tenant.mockImplementation(real.revokeTenantMembers);
    vi.mocked(bindingsFor).mockResolvedValue([]);
    const recover = vi.spyOn(credentials, "findLiveStaffToken").mockResolvedValue({
      accessToken: "recovered-token", expiresAt: Date.now() + 3600000, user: {},
    });
    const logout = vi.spyOn(digitClient, "revokeToken").mockResolvedValue();
    return { recover, logout };
  }
  function deny(condition: string) {
    if (condition === "disabled") user.enabled = false;
    if (condition === "inactive") account.active = false;
    if (condition === "missing") account = null;
    if (condition === "nonmember") mocks.member.mockResolvedValue(false);
    if (condition === "FAILED") organization.lifecycle = "FAILED";
  }
  it.each(["disabled", "inactive", "missing", "nonmember", "FAILED"])(
    "a second %s pass performs no password grant or token logout", async condition => {
      const { recover, logout } = await useRealRevocation();
      deny(condition);
      const ref = { tenantId: "tenant", uuid: "staff" };
      await withPersonLease("person", lease => recordToken(lease, ref,
        { accessToken: "first-token", expiresAt: Date.now() + 3600000, user: {} }, "staff"));
      expect((await runReconcile()).failures).toEqual([]);
      expect(logout).toHaveBeenCalledWith("first-token");
      recover.mockClear(); logout.mockClear(); mocks.tenant.mockClear();
      expect((await runReconcile()).failures).toEqual([]);
      expect(recover).not.toHaveBeenCalled();
      expect(logout).not.toHaveBeenCalled();
      expect(mocks.tenant).not.toHaveBeenCalled();
    });
  it.each(["disabled", "inactive", "nonmember", "FAILED"])(
    "a new live token in steady %s state is revoked without a password grant", async condition => {
      const { recover, logout } = await useRealRevocation();
      deny(condition);
      await runReconcile();
      recover.mockClear(); logout.mockClear();
      const ref = { tenantId: "tenant", uuid: "staff" };
      await withPersonLease("person", lease => recordToken(lease, ref,
        { accessToken: "new-token", expiresAt: Date.now() + 3600000, user: {} }, "staff"));
      expect((await runReconcile()).failures).toEqual([]);
      expect(await readToken(ref)).toBeNull();
      expect(logout).toHaveBeenCalledExactlyOnceWith("new-token");
      expect(recover).not.toHaveBeenCalled();
    });
  it("recovers and revokes a token once on an active-to-inactive transition", async () => {
    const { recover, logout } = await useRealRevocation();
    account.active = false;
    expect((await runReconcile()).failures).toEqual([]);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(logout).toHaveBeenCalledExactlyOnceWith("recovered-token");
    recover.mockClear(); logout.mockClear();
    await runReconcile();
    expect(recover).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });
  it("retries a failed transition before advancing the account mirror", async () => {
    account.active = false;
    mocks.revoke.mockRejectedValueOnce(new Error("unavailable"));
    expect((await runReconcile()).failures).toHaveLength(1);
    expect(JSON.parse(user.attributes["digit.accounts"][0]).entries[0].active).toBe(true);
    mocks.revoke.mockClear();
    await runReconcile();
    expect(mocks.revoke).toHaveBeenCalledWith("person", expect.anything(), "DIGIT_INACTIVE", { fallback: true });
  });
  it("checkpoints tenant state only after successful fan-out and detects recovery then failure again", async () => {
    organization.lifecycle = "FAILED";
    mocks.tenant.mockRejectedValueOnce(new Error("unavailable"));
    expect((await runReconcile()).failures).toHaveLength(1);
    expect(await getRedis().hget(reconcileStatsKey(), "tenant:tenant")).toBeNull();
    await runReconcile();
    expect(await getRedis().hget(reconcileStatsKey(), "tenant:tenant")).toBe("ORGANIZATION_DISABLED");
    mocks.tenant.mockClear();
    await runReconcile();
    expect(mocks.tenant).not.toHaveBeenCalled();
    organization.lifecycle = "ACTIVE";
    await runReconcile();
    expect(await getRedis().hget(reconcileStatsKey(), "tenant:tenant")).toBe("active");
    organization.lifecycle = "FAILED";
    await runReconcile();
    expect(mocks.tenant).toHaveBeenCalledTimes(1);
  });

  it.each(["deactivation", "role-change"])("%s removes the actual Redis token inventory through the real revocation provider", async change => {
    const real = await vi.importActual<typeof import("../../src/modules/revocation/index.js")>("../../src/modules/revocation/index.js");
    mocks.revoke.mockImplementation(real.revokeAccount);
    const logout = vi.spyOn(digitClient, "revokeToken").mockResolvedValue();
    const ref = { tenantId: "tenant", uuid: "staff" };
    await withPersonLease("person", lease => recordToken(lease, ref,
      { accessToken: "fixture-digit-token", expiresAt: Date.now() + 3600000, user: {} }, "staff"));
    if (change === "deactivation") account.active = false;
    else account.roles = [{ code: "SUPERVISOR", tenantId: "tenant" }];
    expect((await runReconcile()).failures).toEqual([]);
    expect(await readToken(ref)).toBeNull();
    expect(logout).toHaveBeenCalledWith("fixture-digit-token");
  });
  it("processes cursor pages with bounded concurrency", async () => {
    let readers = 0;
    let maximum = 0;
    mocks.read.mockImplementation(async () => {
      readers++;
      maximum = Math.max(maximum, readers);
      try { await new Promise(resolve => setTimeout(resolve, 5)); return structuredClone(account); }
      finally { readers--; }
    });
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (path, init) => {
      if (path.startsWith("/users?")) {
        const first = Number(new URL(path, "http://test").searchParams.get("first"));
        return new Response(JSON.stringify(Array.from({ length: first === 0 ? 100 : 3 }, (_, index) => ({ id: `person-${first + index}` }))));
      }
      return original(path, init);
    });
    const result = await runReconcile();
    expect(result.subjects).toBe(103);
    expect(result.failures).toEqual([]);
    expect(maximum).toBeGreaterThan(1);
    expect(maximum).toBeLessThanOrEqual(4);
    expect(mocks.request).toHaveBeenCalledWith("/users?first=100&max=100&briefRepresentation=true");
  });
  it("the scheduled pass observes deactivation within its configured interval", async () => {
    const interval = config.identityReconciliationIntervalSeconds;
    const startup = config.identityReconcileOnStartup;
    Object.assign(config, { identityReconciliationIntervalSeconds: 0.05, identityReconcileOnStartup: false });
    account.active = false;
    const stop = startReconcile();
    try {
      await vi.waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith("person", expect.anything(), "DIGIT_INACTIVE", { fallback: true }),
        { timeout: 3000, interval: 10 });
      stop();
      await vi.waitFor(async () => expect(await getRedis().get(reconcileLeaseKey())).toBeNull());
    } finally {
      stop();
      Object.assign(config, { identityReconciliationIntervalSeconds: interval, identityReconcileOnStartup: startup });
    }
  });
  it("reports lag from the last successful full pass and recovers readiness on completion", async () => {
    await getRedis().hset(reconcileStatsKey(), "lastCompleteAt", Date.now() - 601000);
    expect((await getReconcileReadiness()).status).toBe("down");
    await runReconcile();
    expect((await getReconcileReadiness()).status).toBe("ok");
  });
  it("does not checkpoint a run after losing the global lease", async () => {
    mocks.read.mockImplementationOnce(async () => {
      await getRedis().set(reconcileLeaseKey(), "other-holder", "PX", 10000);
      return structuredClone(account);
    });
    await expect(runReconcile()).rejects.toThrow("Reconcile lease lost");
    expect(await getRedis().hget(reconcileStatsKey(), "lastCompleteAt")).toBeNull();
    expect(await getRedis().get(reconcileLeaseKey())).toBe("other-holder");
  });
  it("revokes HRMS deactivation on the next pass and needs no DIGIT write to restore active state", async () => {
    account.active = false;
    const result = await runReconcile();
    expect(result.failures).toEqual([]);
    expect(mocks.revoke).toHaveBeenCalledWith("person", expect.objectContaining({ uuid: "staff" }), "DIGIT_INACTIVE", { fallback: true });
    expect(JSON.parse(user.attributes["digit.accounts"][0]).entries[0].active).toBe(false);
    mocks.revoke.mockClear();
    account.active = true;
    await runReconcile();
    expect(JSON.parse(user.attributes["digit.accounts"][0]).entries[0].active).toBe(true);
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it("revokes a changed role snapshot before replacing the mirror", async () => {
    account.roles = [{ code: "SUPERVISOR", tenantId: "tenant" }];
    await runReconcile();
    expect(mocks.revoke).toHaveBeenCalledWith("person", expect.objectContaining({ uuid: "staff" }), "ROLE_CHANGED", { fallback: true });
  });
  it("marks missing accounts and revokes without deleting bindings", async () => {
    const original = user.attributes["digit.bindings"];
    account = null;
    await runReconcile();
    expect(mocks.revoke).toHaveBeenCalledWith("person", expect.objectContaining({ uuid: "staff" }), "DIGIT_ACCOUNT_MISSING", { fallback: true });
    expect(user.attributes["digit.bindings"]).toEqual(original);
    expect(JSON.parse(user.attributes["digit.accounts"][0]).entries[0].missing).toBe(true);
  });
  it("renames the Organization while preserving its fresh representation", async () => {
    mocks.name.mockResolvedValue("Renamed Tenant");
    await runReconcile();
    expect(puts).toContainEqual({ path: "/organizations/org", body: { ...organization, name: "Renamed Tenant", domains: [], attributes: { "digit.lifecycle": ["ACTIVE"] } } });
  });
  it.each(["disabled", "FAILED", "inactive-tenant"])("revokes tenant members outside person leases for %s", async condition => {
    if (condition === "disabled") organization.enabled = false;
    if (condition === "FAILED") organization.lifecycle = "FAILED";
    if (condition === "inactive-tenant") mocks.active.mockResolvedValue(false);
    await runReconcile();
    expect(mocks.tenant).toHaveBeenCalledWith("tenant", condition === "inactive-tenant" ? "TENANT_INACTIVE" : "ORGANIZATION_DISABLED");
  });
  it("forces a full membership check after an Organization deletion despite unchanged fingerprints", async () => {
    await runReconcile();
    mocks.organization.mockResolvedValue(null);
    await requestReconcileNow("organization-deleted");
    await runReconcile();
    expect(mocks.revoke).toHaveBeenCalledWith("person", expect.objectContaining({ uuid: "staff" }), "MEMBERSHIP_REMOVED", { fallback: false });
    expect(await getRedis().hget(reconcileStatsKey(), "completedGeneration")).toBe("1");
    expect(puts.every(item => item.path.startsWith("/users/") || item.path.startsWith("/organizations/"))).toBe(true);
  });
  it("does not acknowledge a newer forced request that arrives during a pass", async () => {
    await requestReconcileNow("first");
    mocks.identifiers.mockImplementationOnce(async () => {
      await requestReconcileNow("second");
      return { written: 0, unchanged: 0, skipped: 0 };
    });
    await runReconcile();
    expect(await getRedis().hget(reconcileStatsKey(), "requestGeneration")).toBe("2");
    expect(await getRedis().hget(reconcileStatsKey(), "completedGeneration")).toBe("1");
  });
  it("retains forced requests and readiness lag after a failed pass", async () => {
    await requestReconcileNow("retry");
    mocks.read.mockRejectedValue(new Error("DIGIT unavailable"));
    expect((await runReconcile()).failures).toHaveLength(1);
    expect(await getRedis().hget(reconcileStatsKey(), "completedGeneration")).toBeNull();
    expect((await getReconcileReadiness()).status).toBe("down");
  });
  it("backfills the binding-tenant index before, and despite, a failed DIGIT read", async () => {
    mocks.read.mockRejectedValue(new digitClient.DigitUnavailableError("DIGIT unavailable"));
    vi.mocked(indexBindingTenants).mockImplementation(async () => expect(mocks.read).not.toHaveBeenCalled());
    expect((await runReconcile()).failures).toEqual([{ subject: "person", code: "DIGIT_UNAVAILABLE" }]);
    expect(indexBindingTenants).toHaveBeenCalledExactlyOnceWith("person");
  });
  it("returns not acquired instead of running a second sweep", async () => {
    await getRedis().set(reconcileLeaseKey(), "other", "PX", 10000);
    expect((await runReconcile()).acquired).toBe(false);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("renews the run lease while a slow dependency exceeds its initial TTL", async () => {
    const ttl = config.identityReconciliationLeaseSeconds;
    Object.assign(config, { identityReconciliationLeaseSeconds: 1 });
    mocks.read.mockImplementationOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 1400));
      return structuredClone(account);
    });
    try { expect((await runReconcile()).failures).toEqual([]); }
    finally { Object.assign(config, { identityReconciliationLeaseSeconds: ttl }); }
  });
});
