import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTenantMappingCache, listOrganizationMappings, liveTenantMapping, readOrganizationMapping, readTenantMappingForUrlSlug } from "../../src/modules/organizations/organization-service.js";
import { clearTenantCaches } from "../../src/modules/access-context/tenant-directory.js";

vi.mock("../../src/integrations/keycloak/admin-session.js", () => ({ getAdminToken: async () => "test-admin" }));
let org: { id: string; alias: string; name: string; enabled: boolean; attributes: Record<string, string[]> };
beforeEach(() => {
  clearTenantMappingCache();
  org = { id: "org", alias: "workspace", name: "Workspace", enabled: true, attributes: { "digit.rootTenantId": ["tenant"], "digit.urlSlug": ["workspace"] } };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("/groups") ? [] : url.endsWith("/organizations/org") ? org : [org])));
});
afterEach(() => { vi.unstubAllGlobals(); clearTenantCaches(); });
describe("Organization lifecycle visibility", () => {
  it.each([undefined, "ACTIVE"])("routes and discovers lifecycle %s", async (lifecycle) => {
    if (lifecycle) org.attributes["digit.lifecycle"] = [lifecycle];
    expect(await readOrganizationMapping("org")).toMatchObject({ tenantId: "tenant" });
    expect(await listOrganizationMappings()).toHaveLength(1);
    expect(await readTenantMappingForUrlSlug("workspace")).toMatchObject({ organizationId: "org" });
  });
  it.each(["PROVISIONING", "FAILED", "unknown"])("hides lifecycle %s from routing, discovery and live selection", async (lifecycle) => {
    const oldMapping = (await readOrganizationMapping("org"))!;
    await readTenantMappingForUrlSlug("workspace");
    org.attributes["digit.lifecycle"] = [lifecycle];
    expect(await liveTenantMapping(oldMapping)).toBeNull();
    expect(await listOrganizationMappings()).toEqual([]);
    clearTenantCaches();
    expect(await readTenantMappingForUrlSlug("workspace")).toBeNull();
  });
  it("keeps disabled Organizations hidden even when ACTIVE", async () => {
    org.enabled = false;
    org.attributes["digit.lifecycle"] = ["ACTIVE"];
    expect(await readOrganizationMapping("org")).toBeNull();
  });
});
