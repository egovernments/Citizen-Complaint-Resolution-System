import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { initCache, closeCache, getRedis } from "../../src/infrastructure/redis.js";
import { resetAdminToken } from "../../src/integrations/keycloak/admin-session.js";
import { withPersonLease } from "../../src/modules/accounts/person-lease.js";
import { runReconcile } from "../../src/modules/sync/reconcile.js";
import { recordToken, readToken } from "../../src/modules/revocation/inventory.js";
import * as digitClient from "../../src/modules/managed-accounts/digit-user-client.js";
import * as credentials from "../../src/modules/accounts/credential-service.js";
import { keycloakTestClient } from "../fixtures/keycloak/client.js";

const mocks = vi.hoisted(() => ({ read: vi.fn(), active: vi.fn(), name: vi.fn(), propagate: vi.fn() }));
vi.mock("../../src/modules/sync/digit-reader.js", () => ({ readDigitAccount: mocks.read }));
vi.mock("../../src/modules/access-context/tenant-directory.js", () => ({ isActiveDigitTenant: mocks.active, digitTenantName: mocks.name }));
vi.mock("../../src/modules/sync/identifiers.js", () => ({ propagateIdentifiers: mocks.propagate }));
describe.skipIf(!process.env.KEYCLOAK_TEST_URL)("real Keycloak reconciliation", () => {
  let client: Awaited<ReturnType<typeof keycloakTestClient>>;
  let subject: string;
  let organizationId: string;
  let tenantId: string;
  let uuid: string;
  let account: any;
  beforeAll(async () => {
    client = await keycloakTestClient();
    Object.assign(config, { keycloakAdminUrl: client.base, keycloakAdminRealm: "master", keycloakOrganizationRealm: "identity-test",
      keycloakAdminClientId: "admin-cli", keycloakAdminClientSecret: "", keycloakAdminUsername: "test-admin",
      keycloakAdminPassword: process.env.KEYCLOAK_TEST_ADMIN_PASSWORD, identityStaffCredentialMode: "rotate",
      cachePrefix: `real-reconcile-${process.pid}` });
    resetAdminToken();
    initCache(`redis://127.0.0.1:${process.env.REDIS_PORT || 16379}`);
    const profile = await (await client.request("/users/profile")).json();
    for (const attribute of profile.attributes) if (attribute.name === "lastName") delete attribute.required;
    for (const name of ["digit.accounts", "digit.bindings", "digit.boundUuids"]) {
      if (!profile.attributes.some((attribute: {name: string}) => attribute.name === name)) {
        profile.attributes.push({ name, multivalued: true, permissions: { view: ["admin"], edit: ["admin"] } });
      }
    }
    await client.request("/users/profile", "PUT", profile);
  });
  beforeEach(async () => {
    tenantId = `sync_${randomUUID().slice(0, 8)}`;
    uuid = randomUUID();
    const roles = [{ code: "EMPLOYEE", tenantId }];
    account = { uuid, tenantId, active: true, name: "Employee Name", userName: "employee", type: "EMPLOYEE", roles };
    const created = await client.request("/users", "POST", { username: `person-${randomUUID()}`, enabled: true,
      firstName: "Employee Name", lastName: "", attributes: {
        "digit.bindings": [JSON.stringify({ v: 1, bindings: [{ tenantId, uuid, state: "active", boundAt: 1,
          createdAt: 1, invitationVersion: 1, createdBy: { kind: "workload" } }] })],
        "digit.boundUuids": [`${tenantId}|${uuid}`],
        "digit.accounts": [JSON.stringify({ v: 1, entries: [{ kind: "staff", tenantId, uuid, boundAt: 1,
          active: true, userName: "employee", roles }] })],
      } });
    subject = created.headers.get("location")!.split("/").at(-1)!;
    const org = await client.request("/organizations", "POST", { name: tenantId, alias: tenantId, enabled: true,
      attributes: { "digit.rootTenantId": [tenantId], "digit.lifecycle": ["ACTIVE"] } });
    organizationId = org.headers.get("location")!.split("/").at(-1)!;
    await client.request(`/organizations/${organizationId}/members`, "POST", subject);
    mocks.read.mockImplementation(async () => structuredClone(account));
    mocks.active.mockResolvedValue(true);
    mocks.name.mockResolvedValue(tenantId);
    mocks.propagate.mockResolvedValue({ written: 0, unchanged: 0, skipped: 0 });
    vi.spyOn(digitClient, "revokeToken").mockResolvedValue();
    vi.spyOn(credentials, "findLiveStaffToken").mockResolvedValue(null);
    await withPersonLease(subject, lease => recordToken(lease, { tenantId, uuid },
      { accessToken: "real-kc-fixture-digit-token", expiresAt: Date.now() + 3600000, user: {} }, "staff"));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (subject) await client.request(`/users/${subject}`, "DELETE");
    if (organizationId) await client.request(`/organizations/${organizationId}`, "DELETE");
    const keys = await getRedis().keys(`real-reconcile-${process.pid}:*`);
    if (keys.length) await getRedis().del(...keys);
  });
  afterAll(async () => { await closeCache(); resetAdminToken(); });

  it("mirrors an MDMS tenant rename without changing Organization lifecycle or membership", async () => {
    mocks.name.mockResolvedValue("Renamed workspace");
    expect((await runReconcile()).failures).toEqual([]);
    const org = await (await client.request(`/organizations/${organizationId}`)).json();
    expect(org).toMatchObject({ name: "Renamed workspace", enabled: true,
      attributes: { "digit.lifecycle": ["ACTIVE"], "digit.rootTenantId": [tenantId] } });
    expect((await client.request(`/organizations/${organizationId}/members/${subject}`)).status).toBe(200);
  });
  it("revokes a disabled Organization's inventoried token without changing its binding", async () => {
    const org = await (await client.request(`/organizations/${organizationId}`)).json();
    await client.request(`/organizations/${organizationId}`, "PUT", { ...org, enabled: false });
    const result = await runReconcile();
    expect(result.failures).toEqual([]);
    expect(await readToken({ tenantId, uuid })).toBeNull();
    expect(digitClient.revokeToken).toHaveBeenCalledWith("real-kc-fixture-digit-token");
    const user = await (await client.request(`/users/${subject}`)).json();
    expect(JSON.parse(user.attributes["digit.bindings"][0]).bindings[0].state).toBe("active");
    vi.mocked(credentials.findLiveStaffToken).mockClear();
    vi.mocked(digitClient.revokeToken).mockClear();
    expect((await runReconcile()).failures).toEqual([]);
    expect(credentials.findLiveStaffToken).not.toHaveBeenCalled();
    expect(digitClient.revokeToken).not.toHaveBeenCalled();
  });
  it("revokes removed membership without recreating it or changing the binding", async () => {
    await client.request(`/organizations/${organizationId}/members/${subject}`, "DELETE");
    expect((await runReconcile()).failures).toEqual([]);
    expect(await readToken({ tenantId, uuid })).toBeNull();
    await expect(client.request(`/organizations/${organizationId}/members/${subject}`)).rejects.toThrow("404");
    const user = await (await client.request(`/users/${subject}`)).json();
    expect(JSON.parse(user.attributes["digit.bindings"][0]).bindings[0].state).toBe("active");
    vi.mocked(credentials.findLiveStaffToken).mockClear();
    vi.mocked(digitClient.revokeToken).mockClear();
    expect((await runReconcile()).failures).toEqual([]);
    expect(credentials.findLiveStaffToken).not.toHaveBeenCalled();
    expect(digitClient.revokeToken).not.toHaveBeenCalled();
  });
});
