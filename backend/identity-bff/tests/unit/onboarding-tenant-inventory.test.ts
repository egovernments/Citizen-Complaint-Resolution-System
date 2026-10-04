import { afterEach, describe, expect, it, vi } from "vitest";
import { listOrganizationTenants } from "../../src/modules/onboarding/organization-reader.js";
vi.mock("../../src/integrations/keycloak/admin-session.js", () => ({ getAdminToken: async () => "test-admin" }));
afterEach(() => vi.unstubAllGlobals());
describe("raw tenant inventory for sync and revocation", () => {
  it("paginates and includes disabled, failed, provisioning and superseded tenants once", async () => {
    const records = Array.from({ length: 101 }, (_, index) => ({ id: String(index), name: "Workspace", alias: String(index),
      enabled: index % 2 === 0,
      attributes: { "digit.rootTenantId": [index === 100 ? "last" : "shared"],
        "digit.lifecycle": [index % 2 ? "FAILED" : "PROVISIONING"], "digit.supersededBy": ["replacement"] } }));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const first = Number(new URL(url).searchParams.get("first"));
      return Response.json(records.slice(first, first + 100));
    }));
    expect(await listOrganizationTenants()).toEqual(["last", "shared"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("ignores unmapped Organizations", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([{ id: "unmapped", alias: "unmapped", name: "Unmapped" }])));
    expect(await listOrganizationTenants()).toEqual([]);
  });
});
