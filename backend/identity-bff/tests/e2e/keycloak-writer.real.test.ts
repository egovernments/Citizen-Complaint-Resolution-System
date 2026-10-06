import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { closeCache, initCache } from "../../src/infrastructure/redis.js";
import { resetAdminToken } from "../../src/integrations/keycloak/admin-session.js";
import { withPersonLease } from "../../src/modules/accounts/person-lease.js";
import { updateKeycloakUser, KeycloakConflictError } from "../../src/modules/sync/keycloak-writer.js";
import { keycloakTestClient } from "../fixtures/keycloak/client.js";
import { ensureCitizenEntry, mirrorPerson } from "../../src/modules/sync/mirror.js";
import { propagateIdentifiers } from "../../src/modules/sync/identifiers.js";

const digit = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("../../src/modules/sync/digit-reader.js", () => ({ readDigitAccount: digit.read }));
vi.mock("../../src/modules/accounts/digit-writer.js", () => ({ writeDigitIdentifiers: digit.write }));

describe.skipIf(!process.env.KEYCLOAK_TEST_URL)("real Keycloak 26.7.3 writer", () => {
  let client: Awaited<ReturnType<typeof keycloakTestClient>>;
  const subjects: string[] = [];
  beforeAll(async () => {
    client = await keycloakTestClient();
    Object.assign(config, { keycloakAdminUrl: client.base, keycloakAdminRealm: "master",
      keycloakOrganizationRealm: "identity-test", keycloakAdminClientId: "admin-cli",
      keycloakAdminClientSecret: "", keycloakAdminUsername: "test-admin",
      keycloakAdminPassword: process.env.KEYCLOAK_TEST_ADMIN_PASSWORD });
    resetAdminToken();
    initCache(`redis://127.0.0.1:${process.env.REDIS_PORT || 16379}`);
    const profile = await (await client.request("/users/profile")).json();
    profile.attributes = profile.attributes.map((attribute: {name: string; required?: unknown}) => {
      if (attribute.name === "lastName") delete attribute.required;
      return attribute;
    });
    for (const name of ["digit.accounts", "digit.bindings", "digit.boundUuids", "fixture.keep"]) {
      if (!profile.attributes.some((attribute: {name: string}) => attribute.name === name)) {
        profile.attributes.push({ name, multivalued: true, permissions: { view: ["admin"], edit: ["admin"] } });
      }
    }
    await client.request("/users/profile", "PUT", profile);
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (client) for (const subject of subjects) await client.request(`/users/${subject}`, "DELETE");
    await closeCache();
    resetAdminToken();
  });

  async function createUser() {
    const username = `writer-${randomUUID()}`;
    const response = await client.request("/users", "POST", { username,
      email: `${username}@example.test`, emailVerified: true, enabled: true,
      firstName: "Before", lastName: "Name", attributes: { "fixture.keep": ["preserved"] } });
    const subject = response.headers.get("location")!.split("/").at(-1)!;
    subjects.push(subject);
    return { subject, username };
  }

  it("preserves email, emailVerified, username and unrelated attributes", async () => {
    const { subject, username } = await createUser();
    await withPersonLease(subject, () => updateKeycloakUser(subject, user => ({ ...user,
      firstName: "Whole DIGIT Name", lastName: "", attributes: { ...user.attributes,
        "digit.accounts": [JSON.stringify({ v: 1, entries: [] })] } })));
    const current = await (await client.request(`/users/${subject}`)).json();
    expect(current).toMatchObject({ username, email: `${username}@example.test`, emailVerified: true,
      enabled: true, firstName: "Whole DIGIT Name", attributes: { "fixture.keep": ["preserved"],
        "digit.accounts": [JSON.stringify({ v: 1, entries: [] })] } });
    expect(current.lastName || "").toBe("");
  });

  it("does not undo an admin disable between its fresh GET and PUT", async () => {
    const { subject } = await createUser();
    const original = globalThis.fetch;
    let intercepted = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (!intercepted && String(input).endsWith(`/users/${subject}`) && init?.method === "PUT") {
        intercepted = true;
        // Bypass the spy for the independent admin operation.
        vi.mocked(globalThis.fetch).mockImplementation(original);
        await client.request(`/users/${subject}`, "PUT", { enabled: false });
        expect(JSON.parse(init.body as string)).not.toHaveProperty("enabled");
      }
      return original(input, init);
    });
    try {
      await withPersonLease(subject, () => updateKeycloakUser(subject, user => ({ ...user, firstName: "After" })));
    } finally { vi.restoreAllMocks(); }
    expect(intercepted).toBe(true);
    const current = await (await client.request(`/users/${subject}`)).json();
    expect(current.enabled).toBe(false);
    expect(current.firstName).toBe("After");
  });

  it("never mirrors a masked DIGIT name into the real user profile", async () => {
    const { subject } = await createUser();
    const uuid = randomUUID();
    await withPersonLease(subject, () => updateKeycloakUser(subject, user => ({ ...user,
      attributes: { ...user.attributes, "digit.bindings": [JSON.stringify({ v: 1, bindings: [{ tenantId: "tenant", uuid,
        state: "active", invitationVersion: 1, createdAt: 1, boundAt: 1, createdBy: { kind: "workload" } }] })] },
    })));
    digit.read.mockResolvedValue({ uuid, tenantId: "tenant", type: "EMPLOYEE", userName: "employee",
      name: "****", active: true, roles: [{ code: "EMPLOYEE", tenantId: "tenant" }] });
    await mirrorPerson(subject);
    const current = await (await client.request(`/users/${subject}`)).json();
    expect(current.firstName).toBe("Before");
    expect(current.lastName).toBe("Name");
    expect(JSON.parse(current.attributes["digit.accounts"][0]).entries[0]).toMatchObject({ uuid, active: true });
  });

  it("propagates a changed staff email only after Keycloak reports it verified", async () => {
    const { subject } = await createUser();
    const uuid = randomUUID();
    await withPersonLease(subject, () => updateKeycloakUser(subject, profile => ({ ...profile,
      email: "changed@example.test", emailVerified: false,
      attributes: { ...profile.attributes, "digit.bindings": [JSON.stringify({ v: 1, bindings: [{ tenantId: "tenant", uuid,
        state: "active", invitationVersion: 1, createdAt: 1, boundAt: 1, createdBy: { kind: "workload" } }] })] },
    }), { allowEmailChange: true }));
    digit.write.mockReset().mockResolvedValue({ status: "written" });
    await propagateIdentifiers(subject);
    expect(digit.write).not.toHaveBeenCalled();
    const verified = await (await client.request(`/users/${subject}`)).json();
    await client.request(`/users/${subject}`, "PUT", { ...verified, emailVerified: true });
    expect((await propagateIdentifiers(subject)).written).toBe(1);
    expect(digit.write).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant", uuid }),
      { emailId: "changed@example.test" });
  });

  it("reports a typed conflict when changing to another real user's email", async () => {
    const first = await createUser();
    const second = await createUser();
    await expect(withPersonLease(first.subject, () => updateKeycloakUser(first.subject,
      user => ({ ...user, email: `${second.username}@example.test`, emailVerified: false }),
      { allowEmailChange: true }))).rejects.toBeInstanceOf(KeycloakConflictError);
  });
  it("seeds a resolved citizen once and mirrors it while preserving the real identity", async () => {
    const { subject, username } = await createUser();
    const uuid = randomUUID();
    digit.read.mockResolvedValue({ uuid, tenantId: "tenant", type: "CITIZEN", userName: "citizen",
      name: "Citizen Name", active: true, roles: [{ code: "CITIZEN", tenantId: "tenant" }] });
    await withPersonLease(subject, () => ensureCitizenEntry(subject, { tenantId: "tenant", uuid }));
    await ensureCitizenEntry(subject, { tenantId: "tenant", uuid });
    const current = await (await client.request(`/users/${subject}`)).json();
    expect(current).toMatchObject({ username, email: `${username}@example.test`, emailVerified: true,
      enabled: true, firstName: "Citizen Name", attributes: { "fixture.keep": ["preserved"] } });
    expect(JSON.parse(current.attributes["digit.accounts"][0]).entries).toEqual([
      expect.objectContaining({ kind: "citizen", tenantId: "tenant", uuid, active: true,
        roles: [{ code: "CITIZEN", tenantId: "tenant" }] }),
    ]);
    await expect(ensureCitizenEntry(subject, { tenantId: "tenant", uuid: randomUUID() }))
      .rejects.toMatchObject({ code: "CITIZEN_ACCOUNT_AMBIGUOUS", status: 409 });
  });

});
