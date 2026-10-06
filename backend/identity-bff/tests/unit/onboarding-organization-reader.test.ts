import { afterEach, describe, expect, it, vi } from "vitest";
import { organizationOperationHash } from "../../src/modules/control-plane/operation-hash.js";
import { listOrganizationTenants, readOrganizationByTenant } from "../../src/modules/onboarding/organization-reader.js";

vi.mock("../../src/integrations/keycloak/admin-session.js", () => ({ getAdminToken: async () => "test-admin" }));
afterEach(() => vi.unstubAllGlobals());
const record = (id: string, extra: Record<string, string[]> = {}, enabled = true) => ({
  id, name: "Workspace", alias: id, enabled,
  attributes: { "digit.rootTenantId": ["tenant"], ...(extra["digit.operationId"] ? { "digit.lifecycle": ["PROVISIONING"], "digit.operationHash": [organizationOperationHash({ tenantId: "tenant", slug: id, name: "Workspace" })] } : {}), ...extra },
});
const serve = (records: unknown[]) => vi.stubGlobal("fetch", vi.fn(async () => Response.json(records)));

describe("raw onboarding Organization reader", () => {
  it.each(["PROVISIONING", "ACTIVE", "FAILED"])("returns %s Organizations even when disabled", async (lifecycle) => {
    serve([record("org", { "digit.lifecycle": [lifecycle] }, false)]);
    expect(await readOrganizationByTenant("tenant")).toEqual({ id: "org", alias: "org", name: "Workspace", lifecycle, enabled: false });
  });
  it("preserves absent lifecycle as null and returns null only for absent tenants", async () => {
    serve([record("org")]);
    expect(await readOrganizationByTenant("tenant")).toMatchObject({ lifecycle: null, enabled: true });
    expect(await readOrganizationByTenant("missing")).toBeNull();
  });
  it("ignores superseded records", async () => {
    serve([record("old", { "digit.supersededBy": ["new"] }), record("new")]);
    expect(await readOrganizationByTenant("tenant")).toMatchObject({ id: "new" });
  });
  it("recovers incomplete supersession only for the same operation's highest attempt", async () => {
    serve([record("old", { "digit.operationId": ["op"], "digit.restartNo": ["0"] }),
      record("new", { "digit.operationId": ["op"], "digit.restartNo": ["1"] })]);
    expect(await readOrganizationByTenant("tenant")).toMatchObject({ id: "new" });
  });
  it.each([
    [record("one"), record("two")],
    [record("one", { "digit.operationId": ["one"] }), record("two", { "digit.operationId": ["two"] })],
    [record("one", { "digit.operationId": ["op"], "digit.restartNo": ["1"] }), record("two", { "digit.operationId": ["op"], "digit.restartNo": ["1"] })],
  ])("rejects ambiguous ownership or attempts", async (...records) => {
    serve(records);
    await expect(readOrganizationByTenant("tenant")).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE" });
  });
  it("fails closed for invalid lifecycle", async () => {
    serve([record("bad", { "digit.lifecycle": ["unknown"] })]);
    await expect(readOrganizationByTenant("tenant")).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE" });
  });
  it("enumerates and deduplicates all tenant states, including disabled and superseded records", async () => {
    serve([record("one", { "digit.lifecycle": ["FAILED"] }, false), record("two", { "digit.lifecycle": ["PROVISIONING"] }),
      record("old", { "digit.rootTenantId": ["other"], "digit.supersededBy": ["new"] }),
      { id: "unmapped", alias: "unmapped", name: "Unmapped" }]);
    expect(await listOrganizationTenants()).toEqual(["other", "tenant"]);
  });
  it("rejects corrupt pending replacement metadata even before creation", async () => {
    serve([record("old", { "digit.operationId": ["op"], "digit.restartNo": ["0"], "digit.replacementPending": ["invalid"] })]);
    await expect(readOrganizationByTenant("tenant")).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE" });
  });
  it("selects a created replacement while its old marker still awaits cleanup", async () => {
    const pending = { restartNo: 1, tenantId: "tenant", slug: "new", name: "Workspace", operationHash: organizationOperationHash({ tenantId: "tenant", slug: "new", name: "Workspace" }) };
    serve([record("old", { "digit.operationId": ["op"], "digit.restartNo": ["0"], "digit.lifecycle": ["FAILED"], "digit.replacementPending": [JSON.stringify(pending)] }),
      record("new", { "digit.operationId": ["op"], "digit.restartNo": ["1"] })]);
    expect(await readOrganizationByTenant("tenant")).toMatchObject({ id: "new" });
  });
});
