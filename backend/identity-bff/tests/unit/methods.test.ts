import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { checkIdentityMethodCatalog, enabledIdentityMethods, resetIdentityMethodCatalog } from "../../src/modules/authentication/methods.js";
import { identityClient, enabledIdentityProviders, IdentityAdminError } from "../../src/modules/organizations/organization-service.js";
vi.mock("../../src/modules/organizations/organization-service.js", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/modules/organizations/organization-service.js")>(),
  identityClient: vi.fn(), enabledIdentityProviders: vi.fn(),
}));
const saved = { ...config };
afterEach(() => { Object.assign(config, saved); resetIdentityMethodCatalog(); vi.resetAllMocks(); });
const client = (methods: string) => ({ enabled: true, standardFlowEnabled: true, attributes: { "digit.auth.signin.methods": methods, "digit.auth.signup.methods": "" } }) as Awaited<ReturnType<typeof identityClient>>;
describe("method capability catalogue", () => {
  it("readiness bypasses cache and fails for a configured client that disappeared", async () => {
    config.keycloakCitizenClientSecret = "configured";
    vi.mocked(identityClient).mockResolvedValueOnce(client("password")).mockResolvedValue(null);
    expect(await enabledIdentityMethods("signin", "citizen")).toHaveLength(1);
    await expect(checkIdentityMethodCatalog("citizen")).rejects.toThrow();
    expect(identityClient).toHaveBeenCalledTimes(2);
  });
  it("declares hosted methods without treating them as IdPs", async () => {
    vi.mocked(identityClient).mockResolvedValue(client("hosted:passkey,password"));
    expect(await enabledIdentityMethods("signin")).toEqual([
      { id: "hosted:passkey", type: "hosted", labelKey: "IDENTITY_METHOD_HOSTED_PASSKEY", label: "passkey", intents: ["signin"] },
      { id: "password", type: "password", labelKey: "IDENTITY_METHOD_PASSWORD", label: "Email and password", intents: ["signin"] },
    ]);
    expect(enabledIdentityProviders).not.toHaveBeenCalled();
  });
  it("returns an empty list for an absent or disabled citizen client", async () => {
    config.keycloakCitizenClientSecret = "";
    expect(await enabledIdentityMethods("signin", "citizen")).toEqual([]);
    resetIdentityMethodCatalog();
    config.keycloakCitizenClientSecret = "configured";
    vi.mocked(identityClient).mockResolvedValue(null);
    expect(await enabledIdentityMethods("signin", "citizen")).toEqual([]);
  });
  it("does not hide or cache a configured citizen client's Admin outage", async () => {
    config.keycloakCitizenClientSecret = "configured";
    vi.mocked(identityClient).mockRejectedValueOnce(new IdentityAdminError("unavailable", 503)).mockResolvedValue(client("password"));
    await expect(enabledIdentityMethods("signin", "citizen")).rejects.toThrow("unavailable");
    expect(await enabledIdentityMethods("signin", "citizen")).toHaveLength(1);
  });
});
