import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { registerControlPlaneRoutes } from "../../src/modules/control-plane/routes.js";
import { IdentityAdminError } from "../../src/modules/organizations/organization-service.js";
import { DigitUnavailableError } from "../../src/modules/managed-accounts/digit-user-client.js";
import { contractRoute, expectContractError } from "./harness.js";

// A plain stub, not vi.fn: here vitest reported a vi.fn rejection as a test
// failure even though the route caught it and answered 503.
const stub = vi.hoisted(() => ({ calls: [] as unknown[], run: async (): Promise<unknown> => ({}) }));
vi.mock("../../src/modules/tenant-routes/backfill.js", () => ({
  backfillTenantRoutes: (options: unknown) => { stub.calls.push(options); return stub.run(); },
}));
let server: Server;
let url: string;
beforeAll(async () => {
  Object.assign(config, { identityControlPlaneToken: "backfill-contract" });
  const app = express();
  app.use(express.json());
  registerControlPlaneRoutes(app);
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/internal/identity/v1/tenant-routes/_backfill`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
beforeEach(() => { stub.calls = []; });

const post = (body: unknown) => fetch(url, {
  method: "POST",
  headers: { Authorization: "Bearer backfill-contract", "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

describe("operator tenant-route backfill contract", () => {
  const route = contractRoute("POST", "/internal/identity/v1/tenant-routes/_backfill");
  it("requires the operator credential", async () => {
    await expectContractError(await fetch(url, { method: "POST" }), route, "WORKLOAD_UNAUTHORIZED");
    expect(stub.calls).toEqual([]);
  });
  it("returns the backfill result and passes dryRun and the actor through", async () => {
    const result = { created: ["ke"], skipped: [{ tenantId: "ke.bomet", reason: "NOT_ROOT" }],
      conflicts: [{ tenantId: "zz", reason: "SLUG_TAKEN" }] };
    stub.run = async () => result;
    const response = await post({ dryRun: true, actor: "deploy" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(result);
    expect(stub.calls).toEqual([{ dryRun: true, actor: "control-plane:deploy" }]);
  });
  it("maps a Keycloak failure to IDENTITY_UNAVAILABLE", async () => {
    stub.run = async () => { throw new IdentityAdminError("Keycloak down", 502); };
    await expectContractError(await post({}), route, "IDENTITY_UNAVAILABLE");
  });
  it("maps a DIGIT failure to DIGIT_UNAVAILABLE", async () => {
    stub.run = async () => { throw new DigitUnavailableError("DIGIT tenant lookup failed"); };
    await expectContractError(await post({}), route, "DIGIT_UNAVAILABLE");
  });
});
