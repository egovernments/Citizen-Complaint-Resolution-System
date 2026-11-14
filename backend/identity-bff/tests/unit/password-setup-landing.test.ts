import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #2801: an invited GRO who sets their password lands on their workspace's employee app sign-in,
 * not on the Configurator's "Choose a workspace" screen; workspace admins still land on the
 * Configurator.
 */
vi.mock("../../src/modules/organizations/organization-service.js", async (original) => ({
  ...await original<typeof import("../../src/modules/organizations/organization-service.js")>(),
  readTenantMappingForTenant: vi.fn(),
}));

import { config } from "../../src/infrastructure/config.js";
import { readTenantMappingForTenant } from "../../src/modules/organizations/organization-service.js";
import { passwordSetupLanding } from "../../src/modules/workspace-members/service.js";

const saved = { keycloakEmployeeClientSecret: config.keycloakEmployeeClientSecret, identityPostLoginRedirect: config.identityPostLoginRedirect };
const route = { urlSlug: "nairobi", tenantId: "ke" } as Awaited<ReturnType<typeof readTenantMappingForTenant>>;

beforeEach(() => {
  Object.assign(config, { keycloakEmployeeClientSecret: "employee-secret", identityPostLoginRedirect: "https://site.example/configurator/login" });
  vi.mocked(readTenantMappingForTenant).mockReset().mockResolvedValue(route);
});
afterEach(() => { Object.assign(config, saved); });

const configurator = { returnTo: "https://site.example/configurator/login", clientId: config.keycloakBffClientId, tenantSlug: undefined };

describe("passwordSetupLanding", () => {
  it("sends operational staff to their workspace's employee app, through the employee client", async () => {
    expect(await passwordSetupLanding("ke", [{ code: "GRO", tenantId: "ke" }, { code: "EMPLOYEE", tenantId: "ke" }])).toEqual({
      returnTo: "/nairobi/digit-ui/employee/",
      clientId: config.keycloakEmployeeClientId,
      tenantSlug: "nairobi",
    });
    expect(readTenantMappingForTenant).toHaveBeenCalledWith("ke");
  });

  it.each(["ACCOUNT_ADMIN", "SUPERUSER", "MDMS_ADMIN"])("keeps a workspace admin (%s) on the Configurator", async (code) => {
    expect(await passwordSetupLanding("ke", [{ code: "GRO", tenantId: "ke" }, { code, tenantId: "ke" }])).toEqual(configurator);
  });

  it("counts only admin roles held at this workspace", async () => {
    const landing = await passwordSetupLanding("ke", [{ code: "GRO", tenantId: "ke" }, { code: "ACCOUNT_ADMIN", tenantId: "other" }]);
    expect(landing.returnTo).toBe("/nairobi/digit-ui/employee/");
  });

  it("falls back to the Configurator when the workspace has no route", async () => {
    vi.mocked(readTenantMappingForTenant).mockResolvedValue(null);
    expect(await passwordSetupLanding("ke", [{ code: "GRO", tenantId: "ke" }])).toEqual(configurator);
  });

  it("falls back to the Configurator when the employee client isn't configured", async () => {
    config.keycloakEmployeeClientSecret = "";
    expect(await passwordSetupLanding("ke", [{ code: "GRO", tenantId: "ke" }])).toEqual(configurator);
    expect(readTenantMappingForTenant).not.toHaveBeenCalled();
  });
});
