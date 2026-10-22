import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { OnboardingError } from "../../src/modules/onboarding/errors.js";

// The two trial failure paths the contract harness can't reach cheaply: a held onboarding lock
// (it waits 15 s before giving up) and a trial lookup that fails after the slug resolved.
const mocks = vi.hoisted(() => ({ route: vi.fn(), locked: vi.fn(), lock: vi.fn(), organizations: vi.fn() }));
vi.mock("../../src/modules/access-context/tenant-route.js", async (original) =>
  ({ ...await original<object>(), routeForSlug: mocks.route }));
vi.mock("../../src/modules/workspace-trial/access.js", async (original) =>
  ({ ...await original<object>(), isSlugTrialLocked: mocks.locked }));
vi.mock("../../src/modules/onboarding/locks.js", () => ({ withOnboardingLock: mocks.lock }));
vi.mock("../../src/modules/onboarding/organization-reader.js", async (original) => ({ ...await original<object>(),
  readOrganizationByTenant: mocks.organizations,
  onboardingAdminRequest: async () => new Response(JSON.stringify({ id: "org-acme", attributes: { "digit.rootTenantId": ["acme"] } })) }));
const { registerCitizenOtpRoutes } = await import("../../src/modules/citizen-otp/routes.js");
const { registerWorkspaceTrialRoutes } = await import("../../src/modules/workspace-trial/routes.js");

let server: ReturnType<express.Application["listen"]>;
let base = "";
const post = (path: string, body: unknown) => fetch(`${base}${path}`, {
  method: "POST", headers: { "Content-Type": "application/json", Origin: config.identityAllowedOrigins[0] },
  body: JSON.stringify(body),
});

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerCitizenOtpRoutes(app);
  registerWorkspaceTrialRoutes(app, () => "control-plane:test");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((done) => server.close(() => done())));

describe("workspace trial failure answers", () => {
  it("answers a held onboarding lock on _approve and _extend with IDENTITY_BUSY and Retry-After", async () => {
    mocks.organizations.mockResolvedValue({ id: "org-acme", alias: "acme", name: "Acme", enabled: true, lifecycle: "ACTIVE", trial: null });
    mocks.lock.mockRejectedValue(new OnboardingError("IDENTITY_BUSY", "Onboarding is busy; retry the same request"));
    for (const [path, body] of [["_approve", { tenantId: "acme" }], ["_extend", { tenantId: "acme", endsAt: "2026-12-31T23:59:59Z" }]] as const) {
      const response = await post(`/internal/identity/v1/workspace-trials/${path}`, body);
      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("1");
      expect((await response.json()).code).toBe("IDENTITY_BUSY");
    }
  });

  it("answers a failed OTP trial lookup with TENANT_ROUTE_UNAVAILABLE, like a slug that can't be resolved", async () => {
    mocks.route.mockResolvedValue({ urlSlug: "acme", tenantId: "acme", rootTenantId: "acme", parentTenantId: null,
      fallbackTenantIds: [], name: "Acme" });
    mocks.locked.mockRejectedValue(new Error("Keycloak Admin unavailable"));
    const response = await post("/identity/v1/citizen/otp/_send", { tenantSlug: "acme", mobileNumber: "712000001" });
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("TENANT_ROUTE_UNAVAILABLE");
  });
});
