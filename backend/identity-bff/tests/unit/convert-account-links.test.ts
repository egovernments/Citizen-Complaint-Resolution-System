import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initCache, closeCache } from "../../src/infrastructure/redis.js";
import { config } from "../../src/infrastructure/config.js";
import type { UserRepresentation } from "../../src/modules/sync/keycloak-writer.js";
import type { DigitAccount } from "../../src/modules/managed-accounts/digit-user-client.js";
const f = vi.hoisted(() => ({ users: new Map<string, UserRepresentation>(), accounts: new Map<string, DigitAccount>(), puts: [] as UserRepresentation[], members: new Set<string>(), broken: "" }));
vi.mock("../../src/modules/organizations/organization-service.js", () => ({
  request: vi.fn(async (path: string, init?: RequestInit) => {
    const url = new URL(path, "http://kc");
    if (url.pathname === "/users") {
      let users = [...f.users.values()];
      const q = url.searchParams.get("q");
      if (q) users = users.filter((u) => u.attributes?.["digit.boundUuids"]?.includes(q.slice("digit.boundUuids:".length)));
      const first = Number(url.searchParams.get("first") || 0);
      return Response.json(users.slice(first, first + 100));
    }
    const subject = decodeURIComponent(url.pathname.slice(7));
    if (subject === f.broken) throw new Error("Keycloak read failed");
    if (init?.method === "PUT") {
      const user = JSON.parse(String(init.body)); f.users.set(subject, { ...f.users.get(subject), ...user }); f.puts.push(user);
      return new Response(null, { status: 204 });
    }
    return Response.json(f.users.get(subject));
  }),
  ensureOrganizationMembership: vi.fn(async ({ organizationId, userId }: { organizationId: string; userId: string }) => { f.members.add(`${organizationId}:${userId}`); }),
}));
vi.mock("../../src/modules/workspace-members/authority.js", () => ({
  validateBinding: vi.fn(async () => {}),
  requireWorkspace: vi.fn(async (tenantId: string) => ({ id: tenantId, alias: tenantId, name: tenantId })),
  readDigitAccount: vi.fn(async (tenantId: string, uuid: string, type = "EMPLOYEE") => {
    const account = f.accounts.get(uuid); return account?.tenantId === tenantId && account.type === type ? account : null;
  }),
}));
vi.mock("../../src/modules/sync/digit-reader.js", () => ({ readDigitAccount: vi.fn(async ({ uuid }: { uuid: string }) => f.accounts.get(uuid) || null) }));
import { convertAccountLinks } from "../../src/modules/jobs/convert-account-links.js";
import { expectSchema } from "../contract/harness.js";
const staffUuid = "00000000-0000-4000-8000-000000000001";
const citizenUuid = "00000000-0000-4000-8000-000000000002";
function person(id: string, type = "EMPLOYEE", uuid = staffUuid) {
  f.users.set(id, { id, username: id, enabled: true, attributes: {
    "digit.accountLinks": [`${type}|pg|${uuid}`], phoneNumber: ["+254712345678"], phoneNumberVerified: ["true"], untouched: ["keep"],
  } });
}
beforeAll(() => { Object.assign(config, { cachePrefix: `conversion-test-${process.pid}` }); initCache(); });
afterAll(() => closeCache());
beforeEach(() => {
  f.users.clear(); f.accounts.clear(); f.puts = []; f.members.clear(); f.broken = "";
  f.accounts.set(staffUuid, { uuid: staffUuid, userName: "legacy-employee", type: "EMPLOYEE", tenantId: "pg", name: "Employee", active: false, roles: [{ code: "EMPLOYEE", tenantId: "pg" }] });
  f.accounts.set(citizenUuid, { uuid: citizenUuid, userName: "legacy-citizen", type: "CITIZEN", tenantId: "pg", name: "Citizen", active: true, roles: [{ code: "CITIZEN", tenantId: "pg" }], countryCode: "+254", mobileNumber: "712345678" });
});
describe("one-time account-link conversion", () => {
  it("converts inactive employees into bindings, membership and a mirror; rerun writes nothing", async () => {
    person("staff");
    expect(await convertAccountLinks()).toMatchObject([{ subject: "staff", status: "converted" }]);
    const user = f.users.get("staff")!;
    expectSchema("digit.bindings", JSON.parse(user.attributes!["digit.bindings"][0]));
    expectSchema("digit.accounts", JSON.parse(user.attributes!["digit.accounts"][0]));
    expect(JSON.parse(user.attributes!["digit.accounts"][0]).entries[0]).toMatchObject({ active: false, kind: "staff", uuid: staffUuid });
    expect(f.members.has("pg:staff")).toBe(true);
    const writes = f.puts.length;
    expect(await convertAccountLinks()).toEqual([]); expect(f.puts).toHaveLength(writes);
  });
  it("seeds schema-valid verified-phone citizen entries before mirroring", async () => {
    person("citizen", "CITIZEN", citizenUuid);
    expect(await convertAccountLinks()).toMatchObject([{ status: "converted" }]);
    for (const put of f.puts) if (put.attributes?.["digit.accounts"]) expectSchema("digit.accounts", JSON.parse(put.attributes["digit.accounts"][0]));
    expect(f.users.get("citizen")?.attributes?.untouched).toEqual(["keep"]);
    expect(JSON.parse(f.users.get("citizen")!.attributes!["digit.accounts"][0]).entries[0]).toMatchObject({ kind: "citizen", uuid: citizenUuid, roles: [{ code: "CITIZEN", tenantId: "pg" }] });
  });
  it.each([["799999999", "PHONE_MISMATCH"], ["71*****78", "DIGIT_PII_MASKED"]])("skips citizen mobile %s with %s", async (mobile, reason) => {
    person("citizen", "CITIZEN", citizenUuid); f.accounts.get(citizenUuid)!.mobileNumber = mobile;
    expect(await convertAccountLinks()).toMatchObject([{ status: "skipped", reason }]);
    expect(f.users.get("citizen")?.attributes?.["digit.accounts"]).toBeUndefined();
    expect(f.users.get("citizen")?.attributes?.["digit.accountLinks"]).toHaveLength(1);
  });
  it("does not overwrite a different citizen account already at the tenant", async () => {
    person("citizen", "CITIZEN", citizenUuid);
    const entries = [{ kind: "citizen", tenantId: "pg", uuid: staffUuid, boundAt: 1, active: true, roles: [] }];
    f.users.get("citizen")!.attributes!["digit.accounts"] = [JSON.stringify({ v: 1, entries })];
    expect(await convertAccountLinks()).toMatchObject([{ status: "skipped", reason: "CITIZEN_ACCOUNT_AMBIGUOUS" }]);
    expect(JSON.parse(f.users.get("citizen")!.attributes!["digit.accounts"][0]).entries).toEqual(entries);
  });
  it("continues independently after one person's Keycloak read fails", async () => {
    person("broken"); person("good", "CITIZEN", citizenUuid); f.broken = "broken";
    expect(await convertAccountLinks()).toMatchObject([{ subject: "broken", status: "failed" }, { subject: "good", status: "converted" }]);
  });
  it("emits identity.account_link audit records for converted links", async () => {
    person("staff"); const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try { await convertAccountLinks(); expect(log).toHaveBeenCalledWith(expect.stringContaining('"audit":"identity.account_link"')); }
    finally { log.mockRestore(); }
  });
});
