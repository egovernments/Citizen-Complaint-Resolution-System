import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { initCache, closeCache, getRedis } from "../../src/infrastructure/redis.js";
import { ensureCitizenEntry, mirrorPerson } from "../../src/modules/sync/mirror.js";
import { withPersonLease } from "../../src/modules/accounts/person-lease.js";
import type { UserRepresentation } from "../../src/modules/sync/keycloak-writer.js";
import type { DigitAccount } from "../../src/modules/managed-accounts/digit-user-client.js";

const mocks = vi.hoisted(() => ({ request: vi.fn(), read: vi.fn() }));
vi.mock("../../src/modules/organizations/organization-service.js", () => ({ request: mocks.request }));
vi.mock("../../src/modules/sync/digit-reader.js", () => ({ readDigitAccount: mocks.read }));
let user: UserRepresentation;
let accounts: Record<string, DigitAccount | null>;
let writes: UserRepresentation[];
let sequence = 0;
let subject: string;
const account = (uuid: string, name = "Staff Name"): DigitAccount => ({ uuid, name,
  userName: `employee-${uuid}`, tenantId: "tenant", type: "EMPLOYEE", active: true,
  roles: [{ code: "EMPLOYEE", tenantId: "tenant" }] });
const entry = (uuid: string, kind = "staff", tenantId = "tenant") => ({ kind, tenantId, uuid,
  boundAt: 10, active: true, roles: [{ code: "EMPLOYEE", tenantId }] });
const bindings = (...items: object[]) => JSON.stringify({ v: 1, bindings: items.map(item => ({
  invitationVersion: 1, createdAt: 1, createdBy: { kind: "workload" }, ...item,
})) });
const mirrorEntries = () => JSON.parse(user.attributes!["digit.accounts"][0]).entries;

beforeAll(() => {
  Object.assign(config, { cachePrefix: `sync-mirror-${process.pid}` });
  initCache(`redis://127.0.0.1:${process.env.REDIS_PORT || 16379}`);
});
afterAll(async () => {
  const keys = await getRedis().keys(`sync-mirror-${process.pid}:*`);
  if (keys.length) await getRedis().del(...keys);
  await closeCache();
});
beforeEach(() => {
  subject = `mirror-${++sequence}`;
  writes = [];
  user = { id: subject, username: "identity", email: "verified@example.test", emailVerified: true,
    enabled: true, firstName: "Before", lastName: "Name", attributes: {
      "digit.bindings": [bindings({ tenantId: "tenant", uuid: "staff", state: "active", boundAt: 10 })],
      unrelated: ["keep"],
    } };
  accounts = { staff: account("staff") };
  mocks.request.mockReset().mockImplementation(async (_path, init) => {
    if (init?.method === "PUT") {
      const body = JSON.parse(init.body);
      writes.push(body);
      user = { ...user, ...body };
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify(user));
  });
  mocks.read.mockReset().mockImplementation(async entry => accounts[entry.uuid] ?? null);
});

describe("DIGIT mirror", () => {
  it("mirrors roles/status and whole staff name, preserving identity and binding state", async () => {
    const before = user.attributes!["digit.bindings"];
    await mirrorPerson(subject);
    expect(user).toMatchObject({ firstName: "Staff Name", lastName: "", emailVerified: true, username: "identity" });
    expect(mirrorEntries()).toEqual([{ ...entry("staff"), userName: "employee-staff", name: "Staff Name" }]);
    expect(user.attributes!["digit.bindings"]).toEqual(before);
    expect(writes[0]).not.toHaveProperty("enabled");
  });

  it("does no second PUT for its own mirror event or an unchanged periodic pass", async () => {
    await mirrorPerson(subject);
    await mirrorPerson(subject);
    expect(writes).toHaveLength(1);
  });

  it("repairs an external admin name edit even when the DIGIT fingerprint is unchanged", async () => {
    await mirrorPerson(subject);
    user.firstName = "External admin edit";
    await mirrorPerson(subject);
    expect(writes).toHaveLength(2);
    expect(user.firstName).toBe("Staff Name");
  });

  it("does not mirror masked names or citizen mobile placeholders", async () => {
    accounts.staff!.name = "****";
    await mirrorPerson(subject);
    expect(user.firstName).toBe("Before");
    expect(mirrorEntries()[0]).not.toHaveProperty("name");
    user.attributes!["digit.bindings"] = [bindings()];
    user.attributes!["digit.accounts"] = [JSON.stringify({ v: 1, entries: [entry("citizen", "citizen")] })];
    accounts.citizen = { ...account("citizen", "712345678"), type: "CITIZEN" };
    await mirrorPerson(subject);
    expect(user.firstName).toBe("Before");
  });

  it.each(["", "   ", "****"])("drops a stored entry name when DIGIT later returns %j", async (name) => {
    await mirrorPerson(subject);
    expect(mirrorEntries()[0].name).toBe("Staff Name");
    accounts.staff!.name = name;
    await mirrorPerson(subject);
    expect(mirrorEntries()[0]).not.toHaveProperty("name");
  });

  it("records each staff entry's own tenant name, never another tenant's or the citizen's", async () => {
    user.attributes!["digit.bindings"] = [bindings(
      { tenantId: "tenant", uuid: "staff", state: "active", boundAt: 10 },
      { tenantId: "other", uuid: "staff-b", state: "active", boundAt: 20 })];
    user.attributes!["digit.accounts"] = [JSON.stringify({ v: 1, entries: [{ ...entry("citizen", "citizen"), boundAt: 1 }] })];
    accounts["staff-b"] = { ...account("staff-b", "Name At Other"), tenantId: "other" };
    accounts.citizen = { ...account("citizen", "Citizen Name"), type: "CITIZEN" };
    await mirrorPerson(subject);
    expect(user.firstName).toBe("Staff Name");
    const byTenant = (kind: string, tenantId: string) => mirrorEntries().find((item: any) => item.kind === kind && item.tenantId === tenantId);
    expect(byTenant("staff", "tenant").name).toBe("Staff Name");
    expect(byTenant("staff", "other").name).toBe("Name At Other");
    expect(byTenant("citizen", "tenant")).not.toHaveProperty("name");
    accounts.staff!.name = "Renamed In HRMS";
    await mirrorPerson(subject);
    expect(byTenant("staff", "tenant").name).toBe("Renamed In HRMS");
    expect(byTenant("staff", "other").name).toBe("Name At Other");
  });

  it("uses oldest active staff before citizen, and citizen after staff is inactive", async () => {
    user.attributes!["digit.accounts"] = [JSON.stringify({ v: 1, entries: [
      { ...entry("citizen", "citizen"), boundAt: 1 },
    ] })];
    accounts.citizen = { ...account("citizen", "Citizen Name"), type: "CITIZEN" };
    await mirrorPerson(subject);
    expect(user.firstName).toBe("Staff Name");
    accounts.staff!.active = false;
    await mirrorPerson(subject);
    expect(user.firstName).toBe("Citizen Name");
    expect(mirrorEntries().find((item: any) => item.uuid === "staff").active).toBe(false);
  });

  it("drops removed staff entries and never restores bindings or invents citizens", async () => {
    await mirrorPerson(subject);
    user.attributes!["digit.bindings"] = [bindings({ tenantId: "tenant", uuid: "staff", state: "removed" })];
    await mirrorPerson(subject);
    expect(mirrorEntries()).toEqual([]);
    expect(JSON.parse(user.attributes!["digit.bindings"][0]).bindings[0].state).toBe("removed");
  });

  it("marks missing accounts without dropping their binding and clears missing on recovery", async () => {
    accounts.staff = null;
    await mirrorPerson(subject);
    expect(mirrorEntries()[0]).toMatchObject({ uuid: "staff", active: false, missing: true });
    accounts.staff = account("staff");
    await mirrorPerson(subject);
    expect(mirrorEntries()[0]).not.toHaveProperty("missing");
  });

  it("preserves credential metadata and boundAt across mirror passes", async () => {
    await mirrorPerson(subject, { credential: { tenantId: "tenant", keyVersion: 2, setAt: 100 } });
    await mirrorPerson(subject);
    expect(mirrorEntries()[0]).toMatchObject({ boundAt: 10, credential: { keyVersion: 2, setAt: 100 } });
  });

  it("observes an HRMS edit made during a mirror pass on the next pass, without a DIGIT write", async () => {
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (...args) => {
      if (args[1]?.method === "PUT") accounts.staff = account("staff", "Edited by HRMS");
      return original(...args);
    });
    await mirrorPerson(subject);
    await mirrorPerson(subject);
    expect(user.firstName).toBe("Edited by HRMS");
  });

  it("refuses malformed state before replacing any attribute", async () => {
    user.attributes!["digit.accounts"] = ['{"v":2,"entries":[]}'];
    await expect(mirrorPerson(subject)).rejects.toThrow("Unsupported");
    expect(writes).toEqual([]);
  });
});


describe("resolved citizen entry", () => {
  it("seeds and mirrors an existing citizen under a re-entrant lease, preserving staff and identity", async () => {
    await mirrorPerson(subject);
    const binding = user.attributes!["digit.bindings"];
    accounts.citizen = { ...account("citizen", "Citizen Name"), type: "CITIZEN",
      roles: [{ code: "CITIZEN", tenantId: "tenant" }] };
    await withPersonLease(subject, () => ensureCitizenEntry(subject, { tenantId: "tenant", uuid: "citizen" }));
    expect(mirrorEntries()).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "staff", uuid: "staff" }),
      expect.objectContaining({ kind: "citizen", uuid: "citizen", tenantId: "tenant", active: true,
        roles: [{ code: "CITIZEN", tenantId: "tenant" }] }),
    ]));
    expect(user.attributes!["digit.bindings"]).toEqual(binding);
    expect(user).toMatchObject({ username: "identity", email: "verified@example.test", emailVerified: true });
    writes = [];
    await ensureCitizenEntry(subject, { tenantId: "tenant", uuid: "citizen" });
    expect(writes).toHaveLength(0);
  });
  it("refuses a different citizen UUID for the same tenant without writing", async () => {
    user.attributes!["digit.accounts"] = [JSON.stringify({ v: 1, entries: [entry("old", "citizen")] })];
    await expect(ensureCitizenEntry(subject, { tenantId: "tenant", uuid: "other" }))
      .rejects.toMatchObject({ status: 409, code: "CITIZEN_ACCOUNT_AMBIGUOUS" });
    expect(writes).toHaveLength(0);
  });
  it("keeps a missing resolved citizen marked inactive and never grants a binding", async () => {
    user.attributes!["digit.bindings"] = [bindings()];
    await ensureCitizenEntry(subject, { tenantId: "tenant", uuid: "missing" });
    expect(mirrorEntries()[0]).toMatchObject({ kind: "citizen", uuid: "missing", active: false, missing: true });
    expect(JSON.parse(user.attributes!["digit.bindings"][0]).bindings).toEqual([]);
  });
  it("preserves the seed for retry if the authoritative mirror read fails", async () => {
    user.attributes!["digit.bindings"] = [bindings()];
    mocks.read.mockRejectedValueOnce(new Error("DIGIT unavailable"));
    await expect(ensureCitizenEntry(subject, { tenantId: "tenant", uuid: "citizen" })).rejects.toThrow("DIGIT unavailable");
    expect(mirrorEntries()[0]).toMatchObject({ kind: "citizen", uuid: "citizen", active: false });
    accounts.citizen = { ...account("citizen"), type: "CITIZEN" };
    await ensureCitizenEntry(subject, { tenantId: "tenant", uuid: "citizen" });
    expect(mirrorEntries().filter((item: any) => item.kind === "citizen")).toHaveLength(1);
    expect(mirrorEntries()[0].active).toBe(true);
  });
});
