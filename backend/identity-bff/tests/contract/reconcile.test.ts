import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { registerControlPlaneRoutes } from "../../src/modules/control-plane/routes.js";
import { contractRoute, expectContractError } from "./harness.js";

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../../src/modules/sync/reconcile.js", () => ({ runReconcile: mocks.run }));
let server: Server;
let url: string;
beforeAll(async () => {
  Object.assign(config, { identityControlPlaneToken: "reconcile-contract" });
  const app = express();
  app.use(express.json());
  registerControlPlaneRoutes(app);
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/internal/identity/v1/reconciliation/_run`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

describe("operator reconcile contract", () => {
  const route = contractRoute("POST", "/internal/identity/v1/reconciliation/_run");
  it("requires the operator credential", async () => {
    await expectContractError(await fetch(url, { method: "POST" }), route, "WORKLOAD_UNAUTHORIZED");
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each([true, false])("returns frozen counters with acquired=%s", async acquired => {
    const result = { acquired, subjects: 3, mirrored: 1, revoked: 1, propagated: 1, unchanged: 1,
      failures: [], lagSeconds: 0 };
    mocks.run.mockResolvedValue(result);
    const response = await fetch(url, { method: "POST", headers: { Authorization: "Bearer reconcile-contract" } });
    expect(response.status).toBe(acquired ? 200 : 202);
    expect(await response.json()).toEqual(result);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(result).not.toHaveProperty("deactivated");
    expect(result).not.toHaveProperty("unprovisioned");
  });
});
