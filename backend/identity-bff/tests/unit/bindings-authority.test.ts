import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DigitAccount, DigitRole } from "../../src/modules/managed-accounts/digit-user-client.js";
const f = vi.hoisted(() => ({ accounts: [] as DigitAccount[], access: true, org: true }));
vi.mock("../../src/modules/managed-accounts/digit-admin-session.js", () => ({
  withDigitAdmin: (fn: (token: string) => unknown) => fn("test-admin"),
}));
vi.mock("../../src/modules/managed-accounts/digit-user-client.js", () => ({
  searchAccounts: vi.fn(async (_token: string, query: { uuid: string[]; active: boolean }) =>
    f.accounts.filter((account) => query.uuid.includes(account.uuid) && account.active === query.active)),
}));
vi.mock("../../src/modules/bindings/predicate.js", () => ({
  staffAccess: vi.fn(async () => ({ allowed: f.access, binding: { uuid: "admin-uuid" } })),
}));
vi.mock("../../src/modules/onboarding/organization-reader.js", () => ({
  readOrganizationByTenant: vi.fn(async () => f.org ? { id: "org", enabled: true, lifecycle: "ACTIVE" } : null),
}));
import { validateBinding } from "../../src/modules/workspace-members/authority.js";
const target = (): DigitAccount => ({ uuid: "employee-uuid", userName: "employee", name: "Employee", tenantId: "pg", type: "EMPLOYEE", active: false, roles: [{ code: "EMPLOYEE", tenantId: "pg" }] });
const input = () => ({ subject: "employee", tenantId: "pg", uuid: "employee-uuid", actor: { kind: "migration" as const } });
beforeEach(() => { f.accounts = [target()]; f.access = true; f.org = true; });

describe("binding actor validation", () => {
  it("converts an existing inactive employee so HRMS reactivation needs no BFF rebind", async () => {
    await expect(validateBinding(input())).resolves.toBeUndefined();
    f.accounts[0].active = true;
    await expect(validateBinding(input())).resolves.toBeUndefined();
  });
  it.each(["missing", "wrong-type", "wrong-tenant", "managed"])("rejects %s targets even for migration", async (caseName) => {
    if (caseName === "missing") f.accounts = [];
    if (caseName === "wrong-type") f.accounts[0].type = "CITIZEN";
    if (caseName === "wrong-tenant") f.accounts[0].tenantId = "elsewhere";
    if (caseName === "managed") f.accounts[0].userName = "kcbff-managed";
    await expect(validateBinding(input())).rejects.toMatchObject({ code: caseName === "managed" ? "DIGIT_ACCOUNT_MANAGED" : "DIGIT_ACCOUNT_NOT_FOUND" });
  });
  it("still rejects an inactive employee for workload binding", async () => {
    await expect(validateBinding({ ...input(), actor: { kind: "workload", operationId: "op", restartNo: 0 } })).rejects.toMatchObject({ code: "DIGIT_ACCOUNT_NOT_FOUND" });
  });
  it("rejects non-workspace tenant binding", async () => {
    f.org = false;
    await expect(validateBinding(input())).rejects.toMatchObject({ code: "WORKSPACE_TENANT_REQUIRED" });
  });
  it("rejects browser self-binding", async () => {
    f.accounts[0].active = true;
    await expect(validateBinding({ ...input(), actor: { kind: "browser", subject: "employee", requestId: "request" } })).rejects.toMatchObject({ code: "SELF_BINDING_FORBIDDEN" });
  });
  it("rechecks live admin role and guards only administrative roles", async () => {
    f.accounts[0].active = true;
    f.accounts[0].roles = [{ code: "EMPLOYEE", tenantId: "pg" }, { code: "GRO", tenantId: "pg" }, { code: "PGR_LME", tenantId: "pg.citya" }];
    const admin: DigitAccount = { ...target(), uuid: "admin-uuid", active: true, roles: [{ code: "ACCOUNT_ADMIN", tenantId: "pg" }] };
    f.accounts.push(admin);
    const call = () => validateBinding({ ...input(), actor: { kind: "browser" as const, subject: "admin", requestId: "request" } });
    await expect(call()).resolves.toBeUndefined();                       // operational roles need no matching caller role
    f.accounts[0].roles.push({ code: "HRMS_ADMIN", tenantId: "pg" });
    await expect(call()).rejects.toMatchObject({ code: "ROLE_ESCALATION_FORBIDDEN" });
    admin.roles.push({ code: "HRMS_ADMIN", tenantId: "pg" });
    await expect(call()).resolves.toBeUndefined();
    // A workspace role never covers a role held at another root.
    f.accounts[0].roles.push({ code: "SUPERUSER", tenantId: "other" });
    await expect(call()).rejects.toMatchObject({ code: "ROLE_ESCALATION_FORBIDDEN" });
    admin.roles.push({ code: "SUPERUSER", tenantId: "other" });
    await expect(call()).resolves.toBeUndefined();
    f.accounts[0].roles.push({ code: "SUPERUSER", tenantId: "pgx" });
    await expect(call()).rejects.toMatchObject({ code: "ROLE_ESCALATION_FORBIDDEN" });
    f.accounts[0].roles.pop();
    admin.roles = [{ code: "ACCOUNT_ADMIN", tenantId: "elsewhere" }];
    await expect(call()).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
  });
  // Each case gives the target an administrative role the caller lacks, so only the rule under test can let it through.
  const linkAs = (callerRoles: DigitRole[], targetRoles: DigitRole[]) => {
    f.accounts[0].active = true;
    f.accounts[0].roles = [{ code: "EMPLOYEE", tenantId: "pg" }, ...targetRoles];
    f.accounts.push({ ...target(), uuid: "admin-uuid", active: true, roles: [{ code: "ACCOUNT_ADMIN", tenantId: "pg" }, ...callerRoles] });
    return validateBinding({ ...input(), actor: { kind: "browser" as const, subject: "admin", requestId: "request" } });
  };
  // Listed literally (not read from ADMINISTRATIVE_ROLES) so dropping a code from the constant fails a case.
  it.each(["SUPERUSER", "INTERNAL_MICROSERVICE_ROLE", "SYSTEM", "REINDEXING_ROLE", "QA_AUTOMATION", "HRMS_ADMIN", "TENANT_ADMIN"])(
    "guards the administrative role %s", async (code) => {
      await expect(linkAs([], [{ code, tenantId: "pg" }])).rejects.toMatchObject({ code: "ROLE_ESCALATION_FORBIDDEN" });
    });
  it.each(["EMPLOYEE", "GRO", "CSR", "PGR_LME", "SUPERVISOR"])("does not guard the operational role %s", async (code) => {
    await expect(linkAs([], [{ code, tenantId: "pg.citya" }])).resolves.toBeUndefined();
  });
  it("checks administrative roles at sub-tenants: a sibling tenant does not cover pg.citya", async () => {
    await expect(linkAs([], [{ code: "SUPERUSER", tenantId: "pg.citya" }])).rejects.toMatchObject({ code: "ROLE_ESCALATION_FORBIDDEN" });
    f.accounts.pop();
    await expect(linkAs([{ code: "SUPERUSER", tenantId: "pg.cityb" }], [{ code: "SUPERUSER", tenantId: "pg.citya" }])).rejects.toMatchObject({ code: "ROLE_ESCALATION_FORBIDDEN" });
  });
  it("a sub-tenant role covers only its own subtree, not a tenant sharing its name prefix", async () => {
    await expect(linkAs([{ code: "HRMS_ADMIN", tenantId: "pg.city" }], [{ code: "HRMS_ADMIN", tenantId: "pg.citya" }])).rejects.toMatchObject({ code: "ROLE_ESCALATION_FORBIDDEN" });
    f.accounts.pop();
    await expect(linkAs([{ code: "HRMS_ADMIN", tenantId: "pg.city" }], [{ code: "HRMS_ADMIN", tenantId: "pg.city.ward1" }])).resolves.toBeUndefined();
  });
  it("a sub-tenant role does not cover its parent", async () => {
    await expect(linkAs([{ code: "HRMS_ADMIN", tenantId: "pg.citya" }], [{ code: "HRMS_ADMIN", tenantId: "pg" }])).rejects.toMatchObject({ code: "ROLE_ESCALATION_FORBIDDEN" });
  });
  describe("the founder (SUPERUSER at the workspace) may grant any role within the workspace", () => {
    it.each([["HRMS_ADMIN", "pg.citya"], ["INTERNAL_MICROSERVICE_ROLE", "pg"], ["SYSTEM", "pg.citya.ward1"]])("links %s@%s", async (code, tenantId) => {
      await expect(linkAs([{ code: "SUPERUSER", tenantId: "pg" }], [{ code, tenantId }])).resolves.toBeUndefined();
    });
    it("a SUPERUSER at a sibling sub-tenant is not the founder", async () => {
      await expect(linkAs([{ code: "SUPERUSER", tenantId: "pg.cityb" }], [{ code: "HRMS_ADMIN", tenantId: "pg.citya" }])).rejects.toMatchObject({ code: "ROLE_ESCALATION_FORBIDDEN" });
    });
    it.each(["otherroot", "pgx"])("still checks administrative roles at another root (%s)", async (tenantId) => {
      await expect(linkAs([{ code: "SUPERUSER", tenantId: "pg" }], [{ code: "HRMS_ADMIN", tenantId }])).rejects.toMatchObject({ code: "ROLE_ESCALATION_FORBIDDEN" });
    });
    it.each(["otherroot", "pgx"])("rejects SUPERUSER@%s: a workspace role never covers another root", async (tenantId) => {
      await expect(linkAs([{ code: "SUPERUSER", tenantId: "pg" }], [{ code: "SUPERUSER", tenantId }])).rejects.toMatchObject({ code: "ROLE_ESCALATION_FORBIDDEN" });
    });
    it.each(["otherroot", "pgx"])("still checks operational roles at another root (%s)", async (tenantId) => {
      await expect(linkAs([{ code: "SUPERUSER", tenantId: "pg" }], [{ code: "GRO", tenantId }])).rejects.toMatchObject({ code: "ROLE_ESCALATION_FORBIDDEN" });
    });
  });
  describe("operational roles outside the workspace subtree are checked", () => {
    it.each(["otherroot", "pgx", "otherroot.citya"])("rejects GRO@%s unless the caller holds GRO there or above", async (tenantId) => {
      await expect(linkAs([], [{ code: "GRO", tenantId }])).rejects.toMatchObject({ code: "ROLE_ESCALATION_FORBIDDEN" });
      f.accounts.pop();
      await expect(linkAs([{ code: "GRO", tenantId: "pg" }], [{ code: "GRO", tenantId }])).rejects.toMatchObject({ code: "ROLE_ESCALATION_FORBIDDEN" });
      f.accounts.pop();
      await expect(linkAs([{ code: "GRO", tenantId: tenantId.split(".")[0] }], [{ code: "GRO", tenantId }])).resolves.toBeUndefined();
    });
  });
});
