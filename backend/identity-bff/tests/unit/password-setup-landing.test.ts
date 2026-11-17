import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #2801: an invited GRO who sets their password lands on their workspace's employee app sign-in,
 * not on the Configurator's "Choose a workspace" screen; workspace admins still land on the
 * Configurator. The workspace's route is resolved as forgot-password resolves a slug, then
 * re-read live, and any doubt about it keeps the Configurator link.
 */
vi.mock("../../src/modules/organizations/organization-service.js", async (original) => ({
  ...await original<typeof import("../../src/modules/organizations/organization-service.js")>(),
  readTenantMappingForTenant: vi.fn(),
  readTenantMappingForUrlSlug: vi.fn(),
  liveTenantMapping: vi.fn(),
}));
vi.mock("../../src/modules/access-context/tenant-directory.js", async (original) => ({
  ...await original<typeof import("../../src/modules/access-context/tenant-directory.js")>(),
  isActiveDigitTenant: vi.fn(),
}));

import { config } from "../../src/infrastructure/config.js";
import {
  IdentityAdminError, liveTenantMapping, readTenantMappingForTenant, readTenantMappingForUrlSlug, type TenantMapping,
} from "../../src/modules/organizations/organization-service.js";
import { isActiveDigitTenant } from "../../src/modules/access-context/tenant-directory.js";
import { DigitUnavailableError } from "../../src/modules/managed-accounts/digit-user-client.js";
import { passwordSetupLanding } from "../../src/modules/workspace-members/service.js";

const saved = {
  keycloakEmployeeClientSecret: config.keycloakEmployeeClientSecret,
  identityPostLoginRedirect: config.identityPostLoginRedirect,
  digitConfiguratorRoles: config.digitConfiguratorRoles,
};
const mapping: TenantMapping = { organizationId: "org-ke", alias: "ke", urlSlug: "nairobi", name: "Nairobi", tenantId: "ke",
  rootTenantId: "ke", parentTenantId: null, fallbackTenantIds: [], mappingType: "organization", trial: null };
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  Object.assign(config, { keycloakEmployeeClientSecret: "employee-secret", identityPostLoginRedirect: "https://site.example/configurator/login" });
  vi.mocked(readTenantMappingForTenant).mockReset().mockResolvedValue(mapping);
  vi.mocked(readTenantMappingForUrlSlug).mockReset().mockImplementation(async (slug) => slug === mapping.urlSlug ? mapping : null);
  vi.mocked(liveTenantMapping).mockReset().mockImplementation(async (cached) => cached);
  vi.mocked(isActiveDigitTenant).mockReset().mockResolvedValue(true);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { Object.assign(config, saved); warn.mockRestore(); });

const configurator = { returnTo: "https://site.example/configurator/login", clientId: config.keycloakBffClientId, tenantSlug: undefined };
const gro = [{ code: "GRO", tenantId: "ke" }];

describe("passwordSetupLanding", () => {
  it("sends operational staff to their workspace's employee app, through the employee client", async () => {
    expect(await passwordSetupLanding("ke", [...gro, { code: "EMPLOYEE", tenantId: "ke" }])).toEqual({
      returnTo: "/nairobi/digit-ui/employee/",
      clientId: config.keycloakEmployeeClientId,
      tenantSlug: "nairobi",
    });
    expect(readTenantMappingForTenant).toHaveBeenCalledWith("ke");
    expect(liveTenantMapping).toHaveBeenCalledWith(mapping);
    expect(isActiveDigitTenant).toHaveBeenCalledWith("ke");
  });

  it.each(["ACCOUNT_ADMIN", "SUPERUSER", "MDMS_ADMIN"])("keeps a workspace admin (%s) on the Configurator", async (code) => {
    expect(await passwordSetupLanding("ke", [...gro, { code, tenantId: "ke" }])).toEqual(configurator);
    expect(readTenantMappingForTenant).not.toHaveBeenCalled();
  });

  it("counts only admin roles held at this workspace", async () => {
    const landing = await passwordSetupLanding("ke", [...gro, { code: "ACCOUNT_ADMIN", tenantId: "other" }]);
    expect(landing.returnTo).toBe("/nairobi/digit-ui/employee/");
  });

  it("falls back to the Configurator when the workspace has no route", async () => {
    vi.mocked(readTenantMappingForTenant).mockResolvedValue(null);
    expect(await passwordSetupLanding("ke", gro)).toEqual(configurator);
  });

  it("never emails a slug renamed since the directory was cached: the Configurator instead", async () => {
    vi.mocked(liveTenantMapping).mockResolvedValue(null);
    expect(await passwordSetupLanding("ke", gro)).toEqual(configurator);
  });

  it("never emails a slug that now resolves to another tenant", async () => {
    vi.mocked(readTenantMappingForUrlSlug).mockResolvedValue({ ...mapping, tenantId: "ug", rootTenantId: "ug" });
    vi.mocked(liveTenantMapping).mockImplementation(async (cached) => cached);
    expect(await passwordSetupLanding("ke", gro)).toEqual(configurator);
  });

  it("falls back to the Configurator when the DIGIT tenant is no longer active", async () => {
    vi.mocked(isActiveDigitTenant).mockResolvedValue(false);
    expect(await passwordSetupLanding("ke", gro)).toEqual(configurator);
  });

  it.each([
    ["Keycloak Admin", () => vi.mocked(liveTenantMapping).mockRejectedValue(new IdentityAdminError("Keycloak Admin unavailable", 503))],
    ["DIGIT", () => vi.mocked(isActiveDigitTenant).mockRejectedValue(new DigitUnavailableError("DIGIT MDMS unavailable"))],
  ])("falls back to the Configurator, with a warning, when the route lookup fails (%s)", async (_name, fail) => {
    fail();
    expect(await passwordSetupLanding("ke", gro)).toEqual(configurator);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Configurator"), expect.objectContaining({ tenantId: "ke" }));
  });

  it("falls back to the Configurator when the employee client isn't configured, without looking anything up", async () => {
    config.keycloakEmployeeClientSecret = "";
    expect(await passwordSetupLanding("ke", gro)).toEqual(configurator);
    expect(readTenantMappingForTenant).not.toHaveBeenCalled();
  });
});
