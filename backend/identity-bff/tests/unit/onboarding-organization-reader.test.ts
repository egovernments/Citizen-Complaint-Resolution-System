import { afterEach, describe, expect, it, vi } from "vitest";
import { readOrganizationByTenant } from "../../src/modules/onboarding/organization-reader.js";

vi.mock("../../src/integrations/keycloak/admin-session.js", () => ({ getAdminToken: async () => "test-admin" }));
afterEach(() => vi.unstubAllGlobals());
const record = (id: string, extra: Record<string, string[]> = {}, enabled = true) => ({
  id, name: "Workspace", alias: id, enabled,
  attributes: { "digit.rootTenantId": ["tenant"], ...extra },
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
});
