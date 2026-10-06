import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { closeCache, initCache } from "../../src/infrastructure/redis.js";
import { currentPersonLease, withPersonLease } from "../../src/modules/accounts/person-lease.js";
import { createOnboardingDependencies, checkOnboardingIdentifiers, normalizeOrganizationName, readFounderIdentity, type CoreOnboardingDependencies } from "../../src/modules/onboarding/adapter.js";
import { clearTenantCaches } from "../../src/modules/access-context/tenant-directory.js";
import { readTenantMappingForUrlSlug } from "../../src/modules/organizations/organization-service.js";
import type { OnboardingOrganization } from "../../src/modules/onboarding/primitives.js";

vi.mock("../../src/integrations/keycloak/admin-session.js", () => ({ getAdminToken: async () => "test-admin" }));
const input = { operationId: "operation", restartNo: 0, tenantId: "tenant", slug: "workspace", name: "Workspace" };
let orgs: OnboardingOrganization[], requests: Array<{ path: string; method: string; body: any }>;
let identity: Record<string, unknown>, core: CoreOnboardingDependencies;
beforeAll(() => initCache(`redis://127.0.0.1:${process.env.REDIS_PORT || 16389}`));
afterAll(closeCache);
beforeEach(() => {
  config.cachePrefix = `onboarding-adapter-${randomUUID()}`;
  config.digitMdmsSearchUrl = "http://mdms.test/search";
  clearTenantCaches();
  orgs = [];
  requests = [];
  identity = { id: "founder", enabled: true, username: "founder", email: "fresh@example.test", emailVerified: true, firstName: "Founder" };
  core = { withPersonLease, ensureActive: vi.fn(async () => {
    expect(currentPersonLease()?.subject).toBe("founder");
    await currentPersonLease()!.assertHeld();
    return { binding: { tenantId: "tenant", uuid: "founder-uuid", state: "active", boundAt: 123 }, created: true };
  }), revokeTenantMembers: vi.fn(async () => {}) };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    requests.push({ path, method: init.method ?? "GET", body });
    if (url === config.digitMdmsSearchUrl) return Response.json({ MdmsRes: { tenant: { tenants: [{ code: "tenant", name: "Workspace" }] } } });
    if (path.endsWith("/users/founder")) return Response.json(identity);
    if (path.endsWith("/members")) {
      expect(currentPersonLease()?.subject).toBe("founder");
      return new Response(null, { status: 201 });
    }
    if (path.endsWith("/groups")) return Response.json([]);
    if (path.endsWith("/organizations") && init.method === "POST") {
      const org = { ...body, id: `org-${orgs.length}` };
      orgs.push(org);
      return new Response(null, { status: 201, headers: { location: `/organizations/${org.id}` } });
    }
    if (path.endsWith("/organizations")) return Response.json(orgs);
    if (/\/organizations\/org-\d+$/.test(path)) {
      const id = path.split("/").pop();
      if (init.method === "PUT") { orgs[orgs.findIndex((org) => org.id === id)] = body; return new Response(null, { status: 204 }); }
      return Response.json(orgs.find((org) => org.id === id));
    }
    throw new Error(`Unexpected request ${url}`);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); clearTenantCaches(); });

describe("onboarding core adapter with the shared person lease", () => {
  it("serializes membership with core person mutations and performs identity-only effects", async () => {
    const { primitives } = createOnboardingDependencies(core);
    await primitives.ensure(input);
    expect(await primitives.membership({ ...input, subject: "founder" })).toEqual({ tenantId: "tenant", subject: "founder", member: true });
    expect(requests.filter((request) => request.method !== "GET").map((request) => request.path)).toEqual([
      "/search", expect.stringMatching(/\/organizations$/), expect.stringMatching(/\/members$/),
    ]);
    expect(core.ensureActive).not.toHaveBeenCalled();
  });
  it("calls the core workload binding contract and returns the wire UUID field without credential setup", async () => {
    const { primitives } = createOnboardingDependencies(core);
    await primitives.ensure(input);
    const before = requests.length;
    expect(await primitives.binding({ ...input, subject: "founder", digitUuid: "founder-uuid" })).toEqual({
      binding: { subject: "founder", tenantId: "tenant", digitUuid: "founder-uuid", state: "active", boundAt: 123 }, created: true,
    });
    expect(core.ensureActive).toHaveBeenCalledWith({ subject: "founder", tenantId: "tenant", uuid: "founder-uuid", actor: { kind: "workload", operationId: "operation", restartNo: 0 } });
    expect(requests.slice(before).every((request) => request.method === "GET")).toBe(true);
  });
  it("replays the durable revocation publisher on each FAILED call", async () => {
    const { primitives } = createOnboardingDependencies(core);
    await primitives.ensure(input);
    await primitives.lifecycle({ ...input, state: "FAILED" });
    await primitives.lifecycle({ ...input, state: "FAILED" });
    expect(core.revokeTenantMembers).toHaveBeenCalledTimes(2);
    expect(core.revokeTenantMembers).toHaveBeenLastCalledWith("tenant", "ORGANIZATION_DISABLED");
  });
  it("maps a removed core binding to the workload BINDING_CONFLICT without restoring it", async () => {
    const { primitives } = createOnboardingDependencies(core);
    await primitives.ensure(input);
    vi.mocked(core.ensureActive).mockRejectedValue(Object.assign(new Error("Removed"), { code: "BINDING_REMOVED" }));
    await expect(primitives.binding({ ...input, subject: "founder", digitUuid: "founder-uuid" })).rejects.toMatchObject({ code: "BINDING_CONFLICT", status: 409 });
    expect(core.ensureActive).toHaveBeenCalledTimes(1);
  });
  it("invalidates a cached absent mapping when PROVISIONING becomes ACTIVE", async () => {
    const { primitives } = createOnboardingDependencies(core);
    await primitives.ensure(input);
    expect(await readTenantMappingForUrlSlug("workspace")).toBeNull();
    await primitives.lifecycle({ ...input, state: "ACTIVE" });
    expect(await readTenantMappingForUrlSlug("workspace")).toMatchObject({ tenantId: "tenant" });
  });
  it("reads current email verification and hides disabled identities", async () => {
    expect(await readFounderIdentity("founder")).toMatchObject({ email: "fresh@example.test", emailVerified: true });
    identity.emailVerified = false;
    expect(await readFounderIdentity("founder")).toMatchObject({ emailVerified: false });
    identity.enabled = false;
    expect(await readFounderIdentity("founder")).toBeNull();
  });
  it("batches the Organization scan and deduplicates MDMS tenant checks", async () => {
    const identifiers = [{ type: "URL_SLUG", value: "new" }, { type: "TENANT_ID", value: "tenant" }, { type: "TENANT_ID", value: "tenant" }];
    expect(await checkOnboardingIdentifiers(identifiers)).toEqual(identifiers.map((identifier, index) => ({ ...identifier, available: index === 0 })));
    expect(requests.filter((request) => request.path.endsWith("/organizations"))).toHaveLength(1);
    expect(requests.filter((request) => request.path === "/search")).toHaveLength(1);
  });
  it("reports failed MDMS availability checks with the identifiers contract error", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => url === config.digitMdmsSearchUrl
      ? new Response(null, { status: 503 }) : original(url, init));
    await expect(checkOnboardingIdentifiers([{ type: "TENANT_ID", value: "tenant" }]))
      .rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE", status: 503 });
  });
  it.each([
    ["J\u030c Council", "\u01f0 council"],
    ["\u03a5\u0308\u0301 Council", "\u03b0 council"],
    ["\u0130 Council", "i\u0307 council"],
    ["CAFE\u0301 Council", "caf\u00e9 council"],
  ])("reserves canonically equivalent names after lowercasing %s", async (uppercase, composed) => {
    const normalized = normalizeOrganizationName(uppercase);
    expect(normalized).toBe(composed);
    expect(normalizeOrganizationName(normalized)).toBe(normalized);
    for (const [stored, requested] of [[uppercase, composed], [composed, uppercase]]) {
      orgs = [{ id: "legacy", alias: "legacy", name: stored, enabled: false }];
      const identifier = { type: "ORGANIZATION_NAME", value: `  ${requested.replace(" ", "\t  ")}  ` };
      expect(await checkOnboardingIdentifiers([identifier])).toEqual([{ ...identifier, available: false }]);
    }
    expect(requests.some((request) => request.path === "/search")).toBe(false);
  });
});
