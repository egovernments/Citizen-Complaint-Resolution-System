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
    identityOnboardingToken: "contract-onboarding",
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

describe("sign-in results", () => {
  it("GET /identity/v1/auth-results/:id answers AUTH_RESULT_NOT_FOUND for an unknown id", async () => {
    const route = contractRoute("GET", "/identity/v1/auth-results/:id");
    await expectContractError(await fetch(`${base}/identity/v1/auth-results/unknown-result-id`), route, "AUTH_RESULT_NOT_FOUND");
  });

  async function resultOf(response: Response): Promise<Record<string, unknown>> {
    expect(response.status).toBe(303);
    const id = new URL(response.headers.get("location")!, base).searchParams.get("authResult");
    const result = await fetch(`${base}/identity/v1/auth-results/${encodeURIComponent(id!)}`);
    expect(result.status).toBe(200);
    return await result.json() as Record<string, unknown>;
  }

  it("GET /identity/v1/callback hands a failure to auth-results as a result code, never an HTTP error", async () => {
    const route = contractRoute("GET", "/identity/v1/callback");
    const body = await resultOf(await fetch(`${base}/identity/v1/callback?code=x&state=unknown-state`, { redirect: "manual" }));
    expect(route.results).toContain(body.code);
    expect(body).toMatchObject({ status: "failed", code: "SIGN_IN_FAILED" });
  });

  it("GET /identity/v1/password/setup-complete/:state hands an unknown state to auth-results as AUTH_ATTEMPT_EXPIRED", async () => {
    const route = contractRoute("GET", "/identity/v1/password/setup-complete/:state");
    const body = await resultOf(await fetch(`${base}/identity/v1/password/setup-complete/unknown-state`, { redirect: "manual" }));
    expect(route.results).toContain(body.code);
    expect(body).toMatchObject({ status: "failed", code: "AUTH_ATTEMPT_EXPIRED" });
  });
});

describe("POST /identity/v1/authentication/magic-link-requests", () => {
  const route = contractRoute("POST", "/identity/v1/authentication/magic-link-requests");
  const valid = { email: "new.founder@example.org", firstName: "New", lastName: "Founder" };

  it("refuses an untrusted Origin, a missing name and a foreign returnTo with their codes", async () => {
    await expectContractError(await post(route.path, valid, { Origin: "https://evil.example" }), route, "UNTRUSTED_ORIGIN");
    await expectContractError(await post(route.path, { email: valid.email }), route, "INVALID_REQUEST");
    await expectContractError(await post(route.path, { ...valid, returnTo: "https://evil.example/x" }), route, "UNSUPPORTED_RETURN_TO");
  });
});

describe("POST /identity/v1/password/setup-requests", () => {
  const route = contractRoute("POST", "/identity/v1/password/setup-requests");

  it("refuses an untrusted Origin, an unknown surface and a foreign returnTo with their codes", async () => {
    await expectContractError(await post(route.path, {}, { Origin: "https://evil.example" }), route, "UNTRUSTED_ORIGIN");
    await expectContractError(await post(route.path, { surface: "admin" }), route, "UNSUPPORTED_SURFACE");
    await expectContractError(await post(route.path, { returnTo: "https://evil.example/x" }), route, "UNSUPPORTED_RETURN_TO");
  });

  it("answers 202 {message} whether or not the account exists", async () => {
    const response = await post(route.path, { email: "nobody@example.org" });
    expect(response.status).toBe(202);
    expect(Object.keys(await response.json())).toEqual(["message"]);
  });
});

describe.each([
  contractRoute("POST", "/identity/v1/contexts/_select"),
  contractRoute("POST", "/identity/v1/contexts/citizen/_select"),
])("$method $path", (route) => {
  const surface = route.path.includes("citizen") ? "citizen" : "employee";

  it("refuses an untrusted Origin with UNTRUSTED_ORIGIN", async () => {
    await expectContractError(await post(route.path, { surface }, { Origin: "https://evil.example" }), route, "UNTRUSTED_ORIGIN");
  });

  it("refuses an unknown surface with UNSUPPORTED_SURFACE", async () => {
    await expectContractError(await post(route.path, { surface: "admin", tenantId: "pg" }), route, "UNSUPPORTED_SURFACE");
  });

  it("refuses a request without a session with SESSION_REQUIRED", async () => {
    await expectContractError(await post(route.path, { surface, tenantId: "pg" }), route, "SESSION_REQUIRED");
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
    contractRoute("POST", "/internal/identity/v1/tenant-routes/_backfill"),
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
      identityOnboardingToken: config.identityOnboardingToken,
      identitySessionIntrospectionToken: config.identitySessionIntrospectionToken,
    };
    Object.assign(config as any, { identityControlPlaneToken: "", identityOnboardingToken: "", identitySessionIntrospectionToken: "" });
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

describe("browser account boundaries", () => {
  it("rejects unsupported method selectors with contract errors", async () => {
    const route = contractRoute("GET", "/identity/v1/auth-methods");
    await expectContractError(await fetch(`${base}${route.path}?surface=unknown-surface`), route, "UNSUPPORTED_SURFACE");
    await expectContractError(await fetch(`${base}${route.path}?intent=invalid`), route, "UNSUPPORTED_INTENT");
  });
  it("requires a session for account actions and metadata", async () => {
    const authorize = contractRoute("GET", "/identity/v1/authorize");
    await expectContractError(await fetch(`${base}${authorize.path}?action=UPDATE_PASSWORD`), authorize, "SESSION_REQUIRED");
    const session = contractRoute("GET", "/identity/v1/session");
    await expectContractError(await fetch(`${base}${session.path}?include=account`), session, "SESSION_REQUIRED");
  });
  it("protects provider unlink with origin and session checks", async () => {
    const route = contractRoute("POST", "/identity/v1/account/providers/_unlink");
    await expectContractError(await post(route.path, { alias: "google" }, { Origin: "https://evil.example" }), route, "UNTRUSTED_ORIGIN");
    await expectContractError(await post(route.path, { alias: "google" }), route, "SESSION_REQUIRED");
  });
  it("validates logout scopes before clearing the session cookie", async () => {
    const route = contractRoute("POST", "/identity/v1/logout");
    const response = await post(route.path, { scope: "everyone" });
    await expectContractError(response, route, "INVALID_REQUEST");
    expect(response.headers.has("set-cookie")).toBe(false);
  });
});
