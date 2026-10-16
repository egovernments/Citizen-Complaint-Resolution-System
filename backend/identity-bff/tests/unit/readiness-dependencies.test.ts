import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { dependencyProbes } from "../../src/modules/operations/readiness.js";
import { searchAccounts } from "../../src/modules/managed-accounts/digit-user-client.js";
vi.mock("../../src/modules/managed-accounts/digit-admin-session.js", () => ({ withDigitAdmin: (operation: (token: string) => Promise<unknown>) => operation("service-token") }));
vi.mock("../../src/modules/managed-accounts/digit-user-client.js", () => ({ searchAccounts: vi.fn() }));
const saved = { ...config };
afterEach(() => { Object.assign(config, saved); vi.unstubAllGlobals(); vi.resetAllMocks(); });
const background = { poller: async () => ({ status: "ok" as const, lagSeconds: 0 }), reconcile: async () => ({ status: "ok" as const, intervalSeconds: 300, lagSeconds: 0 }) };
describe("readiness dependencies", () => {
  it("authenticates both DIGIT checks and never calls PGR", async () => {
    config.digitMdmsSearchUrl = "https://mdms.test/search";
    config.digitAdminTenantId = "ke.bomet";
    vi.mocked(searchAccounts).mockResolvedValue([]);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ MdmsRes: { tenant: { tenants: [] } } }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    await dependencyProbes(background).digit();
    expect(searchAccounts).toHaveBeenCalledWith("service-token", expect.objectContaining({ active: true, tenantId: config.digitAdminTenantId }));
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(config.digitMdmsSearchUrl);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).RequestInfo.authToken).toBe("service-token");
    // MDMS is read at the admin's own root tenant, never a fixed source tenant.
    expect(JSON.parse(fetcher.mock.calls[0][1].body).MdmsCriteria.tenantId).toBe("ke");
  });
  it.each([401, 403, 500])("fails on MDMS HTTP %s while still checking users", async status => {
    config.digitMdmsSearchUrl = "https://mdms.test/search";
    vi.mocked(searchAccounts).mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
    await expect(dependencyProbes(background).digit()).rejects.toThrow();
    expect(searchAccounts).toHaveBeenCalledOnce();
  });
  it("still checks MDMS when the authenticated user request fails", async () => {
    config.digitMdmsSearchUrl = "https://mdms.test/search";
    vi.mocked(searchAccounts).mockRejectedValue(new Error("user service down"));
    const fetcher = vi.fn().mockResolvedValue(new Response('{"MdmsRes":{}}'));
    vi.stubGlobal("fetch", fetcher);
    await expect(dependencyProbes(background).digit()).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
