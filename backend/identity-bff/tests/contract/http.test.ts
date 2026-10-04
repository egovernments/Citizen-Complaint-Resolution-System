import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { getIdentityAppPort, startIdentityTestApp, stopIdentityTestApp } from "../e2e/identity-test-app.js";
import { contractRoute, expectContractError } from "./harness.js";

// Contract tests for the routes whose codes are already live. The lane that
// changes a route (see its `items` in src/contract/routes.ts) extends its tests here.

const TRUSTED = "http://localhost:5173";
const saved: Record<string, unknown> = {};
let base = "";

beforeAll(async () => {
  const overrides = {
    cachePrefix: `identity-contract-${process.pid}`,
    identityAllowedOrigins: [TRUSTED],
    identityControlPlaneToken: "contract-control-plane",
    identitySessionIntrospectionToken: "contract-introspection",
  };
  for (const key of Object.keys(overrides)) saved[key] = (config as any)[key];
  Object.assign(config as any, overrides);
  await startIdentityTestApp();
  base = `http://127.0.0.1:${getIdentityAppPort()}`;
});

afterAll(async () => {
  await stopIdentityTestApp();
  Object.assign(config as any, saved);
});

function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: TRUSTED, ...headers },
    body: JSON.stringify(body),
  });
}

describe("probes", () => {
  it("GET /livez answers {status: ok}", async () => {
    contractRoute("GET", "/livez");
    const response = await fetch(`${base}/livez`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});

describe.each([
  contractRoute("POST", "/identity/v1/citizen/otp/_send"),
  contractRoute("POST", "/identity/v1/citizen/otp/_verify"),
])("$method $path", (route) => {
  it("refuses an untrusted Origin with UNTRUSTED_ORIGIN", async () => {
    const response = await post(route.path, { tenantSlug: "pg" }, { Origin: "https://evil.example" });
    await expectContractError(response, route, "UNTRUSTED_ORIGIN");
  });

  it("refuses a missing tenantSlug with INVALID_REQUEST", async () => {
    await expectContractError(await post(route.path, {}), route, "INVALID_REQUEST");
  });

  it("sends Cache-Control: no-store", async () => {
    expect((await post(route.path, {})).headers.get("cache-control")).toBe("no-store");
  });
});

describe("internal routes: bearer auth", () => {
  const internal = [
    contractRoute("POST", "/internal/identity/v1/sessions/_introspect"),
    contractRoute("POST", "/internal/identity/v1/identifiers/_check"),
    contractRoute("POST", "/internal/identity/v1/organizations/_ensure"),
    contractRoute("POST", "/internal/identity/v1/memberships/_ensure"),
    contractRoute("POST", "/internal/identity/v1/reconciliation/_run"),
    contractRoute("POST", "/internal/identity/v1/account-links/_link"),
    contractRoute("POST", "/internal/identity/v1/account-links/_unlink"),
    contractRoute("GET", "/internal/identity/v1/account-links"),
  ];

  it.each(internal)("$method $path refuses a missing or wrong token with WORKLOAD_UNAUTHORIZED", async (route) => {
    for (const authorization of [undefined, "Bearer wrong-token", "contract-control-plane"]) {
      const response = await fetch(`${base}${route.path}`, {
        method: route.method,
        headers: { "Content-Type": "application/json", ...(authorization && { Authorization: authorization }) },
        ...(route.method === "POST" && { body: "{}" }),
      });
      await expectContractError(response, route, "WORKLOAD_UNAUTHORIZED");
    }
  });

  it("does not accept the introspection token on operator routes", async () => {
    const route = contractRoute("POST", "/internal/identity/v1/reconciliation/_run");
    const response = await post(route.path, {}, { Authorization: "Bearer contract-introspection" });
    await expectContractError(response, route, "WORKLOAD_UNAUTHORIZED");
  });

  it.each(internal)("$method $path answers CONTROL_PLANE_NOT_CONFIGURED without its token", async (route) => {
    const tokens = {
      identityControlPlaneToken: config.identityControlPlaneToken,
      identitySessionIntrospectionToken: config.identitySessionIntrospectionToken,
    };
    Object.assign(config as any, { identityControlPlaneToken: "", identitySessionIntrospectionToken: "" });
    try {
      const response = await fetch(`${base}${route.path}`, {
        method: route.method,
        headers: { "Content-Type": "application/json", Authorization: "Bearer anything" },
        ...(route.method === "POST" && { body: "{}" }),
      });
      await expectContractError(response, route, "CONTROL_PLANE_NOT_CONFIGURED");
    } finally {
      Object.assign(config as any, tokens);
    }
  });
});
