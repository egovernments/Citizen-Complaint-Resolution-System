import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerOperationalRoutes } from "../../src/modules/operations/routes.js";
import { type ReadinessProbes } from "../../src/modules/operations/readiness.js";
import { contractRoute } from "./harness.js";

let server: Server, base: string;
let failed = false;
const up = async () => {};
const probes = (): ReadinessProbes => ({
  redis: async () => { if (failed) throw new Error("redis down"); }, jwks: up, keycloakAdmin: up, digit: up,
  catalog: { configurator: up, employee: up, citizen: null, reviewer: up },
  poller: async () => ({ status: failed ? "down" : "ok", lagSeconds: failed ? 90 : 0 }),
  reconcile: async () => ({ status: "ok", intervalSeconds: 300, lagSeconds: 2 }),
});
beforeAll(() => {
  const app = express(); registerOperationalRoutes(app, probes);
  server = app.listen(0); base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
describe("dependency readiness", () => {
  const route = contractRoute("GET", "/readyz");
  it("reports all checks, including configured extra surfaces", async () => {
    const response = await fetch(`${base}${route.path}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ready", checks: { redis: "ok", jwks: "ok", keycloakAdmin: "ok", digit: "ok", catalog: { configurator: "ok", employee: "ok", citizen: "disabled", reviewer: "ok" }, poller: { status: "ok", lagSeconds: 0 }, reconcile: { status: "ok", intervalSeconds: 300, lagSeconds: 2 } } });
  });
  it("returns 503 for lag or dependency failures while liveness stays up", async () => {
    failed = true;
    const response = await fetch(`${base}${route.path}`);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "not_ready", checks: { redis: "down", digit: "ok", catalog: { reviewer: "ok" }, poller: { status: "down", lagSeconds: 90 }, reconcile: { status: "ok" } } });
    expect((await fetch(`${base}/livez`)).status).toBe(200);
    expect((await fetch(`${base}/healthz`)).status).toBe(404);
  });
});
