import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { currentSession } from "../../src/modules/sessions/current-session.js";
import { registerOnboardingRoutes, onboardingAuthorization, type OnboardingRouteDependencies } from "../../src/modules/onboarding/routes.js";
import { OnboardingError } from "../../src/modules/onboarding/errors.js";
import { contractRoute, expectContractError } from "./harness.js";

vi.mock("../../src/modules/sessions/current-session.js", () => ({ currentSession: vi.fn() }));
const routes = [
  contractRoute("POST", "/internal/identity/v1/sessions/_introspect"),
  contractRoute("POST", "/internal/identity/v1/identifiers/_check"),
  contractRoute("POST", "/internal/identity/v1/organizations/_ensure"),
  contractRoute("POST", "/internal/identity/v1/organizations/_lifecycle"),
  contractRoute("POST", "/internal/identity/v1/memberships/_ensure"),
  contractRoute("POST", "/internal/identity/v1/bindings/_ensure"),
];
let server: Server, base: string;
const dependencies: OnboardingRouteDependencies = {
  primitives: { ensure: vi.fn(), lifecycle: vi.fn(), membership: vi.fn(), binding: vi.fn() },
  identity: vi.fn(), identifiers: vi.fn(),
};
beforeAll(() => {
  config.identityOnboardingToken = "test-onboarding";
  config.identitySessionIntrospectionToken = "test-introspection";
  const app = express();
  app.use(express.json());
  app.use("/internal/identity/v1", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (onboardingAuthorization(req, res) === true) next();
    else if (!res.headersSent) res.status(401).json({ code: "WORKLOAD_UNAUTHORIZED", error: "Operator token required" });
  });
  registerOnboardingRoutes(app, dependencies);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => vi.clearAllMocks());
const post = (path: string, body: unknown = {}, token = "test-onboarding") => fetch(`${base}${path}`, {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
});

describe("onboarding HTTP contract", () => {
  it.each(routes)("$path rejects operator and invalid credentials", async (route) => {
    for (const token of ["test-operator", "invalid", ""]) await expectContractError(await post(route.path, {}, token), route, "WORKLOAD_UNAUTHORIZED");
  });
  it.each(routes)("$path reports absent workload configuration", async (route) => {
    const saved = [config.identityOnboardingToken, config.identitySessionIntrospectionToken];
    config.identityOnboardingToken = "";
    config.identitySessionIntrospectionToken = "";
    try { await expectContractError(await post(route.path), route, "CONTROL_PLANE_NOT_CONFIGURED"); }
    finally { [config.identityOnboardingToken, config.identitySessionIntrospectionToken] = saved; }
  });
  it.each(routes.slice(2))("$path rejects the introspection-only credential and malformed attempts", async (route) => {
    await expectContractError(await post(route.path, {}, "test-introspection"), route, "WORKLOAD_UNAUTHORIZED");
    await expectContractError(await post(route.path), route, "INVALID_REQUEST");
  });
  it("does not let case or trailing-slash variants bypass dedicated workload auth", async () => {
    await expectContractError(await post("/internal/identity/v1/Organizations/_ensure/", {}, "test-operator"), routes[2], "WORKLOAD_UNAUTHORIZED");
  });
  it("introspects live founder emailVerified with both read credentials", async () => {
    vi.mocked(currentSession).mockResolvedValue({ sessionId: "session", session: { claims: { sub: "founder", email: "old@example.test", email_verified: false } } } as any);
    vi.mocked(dependencies.identity).mockResolvedValue({ subject: "founder", email: "fresh@example.test", emailVerified: true, name: "Founder", preferredUsername: "founder" });
    for (const token of ["test-onboarding", "test-introspection"]) {
      const response = await post(routes[0].path, {}, token);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ active: true, identity: { issuer: config.keycloakIssuer, subject: "founder", email: "fresh@example.test", emailVerified: true, name: "Founder", preferredUsername: "founder" } });
    }
    expect(currentSession).toHaveBeenCalledWith(undefined, "configurator");
  });
  it("rejects missing sessions and disabled or missing live founders", async () => {
    vi.mocked(currentSession).mockResolvedValue(null);
    await expectContractError(await post(routes[0].path), routes[0], "SESSION_REQUIRED");
    vi.mocked(currentSession).mockResolvedValue({ sessionId: "session", session: { claims: { sub: "founder" } } } as any);
    vi.mocked(dependencies.identity).mockResolvedValue(null);
    await expectContractError(await post(routes[0].path), routes[0], "SESSION_REQUIRED");
  });
  it("checks 1–20 identifiers in order and preserves the temporary single form", async () => {
    vi.mocked(dependencies.identifiers).mockImplementation(async (items) => items.map((item, index) => ({ ...item, available: index % 2 === 0 })));
    const identifiers = [{ type: "URL_SLUG", value: "new" }, { type: "TENANT_ID", value: "existing" }];
    const response = await post(routes[1].path, { identifiers });
    expect(await response.json()).toEqual({ results: [{ ...identifiers[0], available: true }, { ...identifiers[1], available: false }] });
    expect(await (await post(routes[1].path, identifiers[0])).json()).toEqual({ ...identifiers[0], available: true });
    for (const invalid of [null, [], Array(21).fill(identifiers[0]), [{ type: "UNKNOWN", value: "x" }], [null]]) {
      await expectContractError(await post(routes[1].path, { identifiers: invalid }), routes[1], "INVALID_REQUEST");
    }
  });
  it("returns the ensure schema and validates the restart counter", async () => {
    const organization = { id: "org", alias: "workspace", urlSlug: "workspace", tenantId: "tenant", name: "Workspace", lifecycle: "PROVISIONING", operationId: "operation", restartNo: 0 };
    vi.mocked(dependencies.primitives.ensure).mockResolvedValue({ organization, created: true });
    const input = { operationId: "operation", restartNo: 0, tenantId: "tenant", slug: "WORKSPACE", name: "Workspace" };
    expect(await (await post(routes[2].path, input)).json()).toEqual({ organization, created: true });
    expect(dependencies.primitives.ensure).toHaveBeenCalledWith({ ...input, slug: "workspace" });
    for (const restartNo of [-1, 1.2, "1", Number.MAX_SAFE_INTEGER + 1, null]) await expectContractError(await post(routes[2].path, { ...input, restartNo }), routes[2], "INVALID_REQUEST");
  });
  it("returns lifecycle, membership and binding response shapes", async () => {
    const input = { operationId: "operation", restartNo: 0, subject: "founder", tenantId: "tenant", digitUuid: "digit-founder" };
    const lifecycle = { organization: { id: "org", tenantId: "tenant", lifecycle: "ACTIVE" as const, restartNo: 0 } };
    vi.mocked(dependencies.primitives.lifecycle).mockResolvedValue(lifecycle);
    expect(await (await post(routes[3].path, { ...input, state: "ACTIVE" })).json()).toEqual(lifecycle);
    const membership = { tenantId: "tenant", subject: "founder", member: true as const };
    vi.mocked(dependencies.primitives.membership).mockResolvedValue(membership);
    expect(await (await post(routes[4].path, input)).json()).toEqual(membership);
    const binding = { binding: { subject: "founder", tenantId: "tenant", digitUuid: "digit-founder", state: "active", boundAt: 123 }, created: true };
    vi.mocked(dependencies.primitives.binding).mockResolvedValue(binding);
    expect(await (await post(routes[5].path, input)).json()).toEqual(binding);
  });
  it("returns frozen conflict codes without changing provider errors", async () => {
    vi.mocked(dependencies.primitives.binding).mockRejectedValue(new OnboardingError("BINDING_CONFLICT", "The founder UUID changed"));
    await expectContractError(await post(routes[5].path, { operationId: "operation", restartNo: 0, subject: "founder", tenantId: "tenant", digitUuid: "other" }), routes[5], "BINDING_CONFLICT");
    vi.mocked(dependencies.primitives.lifecycle).mockRejectedValue(new OnboardingError("ATTEMPT_STALE", "A newer attempt exists"));
    await expectContractError(await post(routes[3].path, { operationId: "operation", restartNo: 0, state: "ACTIVE" }), routes[3], "ATTEMPT_STALE");
  });
  it("returns the shared busy envelope and retry header for binding contention", async () => {
    vi.mocked(dependencies.primitives.binding).mockRejectedValue(new OnboardingError("IDENTITY_BUSY", "Busy"));
    await expectContractError(await post(routes[5].path, { operationId: "operation", restartNo: 0, subject: "founder", tenantId: "tenant", digitUuid: "uuid" }), routes[5], "IDENTITY_BUSY");
  });
  it("keeps live introspection dependency failures distinct from session absence", async () => {
    vi.mocked(currentSession).mockResolvedValue({ sessionId: "session", session: { claims: { sub: "founder" } } } as any);
    vi.mocked(dependencies.identity).mockRejectedValue(new OnboardingError("IDENTITY_UNAVAILABLE", "Keycloak is unavailable"));
    await expectContractError(await post(routes[0].path), routes[0], "IDENTITY_UNAVAILABLE");
  });
  it.each([
    [2, "ensure"], [3, "lifecycle"], [4, "membership"],
  ] as const)("returns retryable lock contention for mutation %s", async (index, method) => {
    vi.mocked(dependencies.primitives[method]).mockRejectedValue(new OnboardingError("IDENTITY_BUSY", "The operation lease was lost"));
    await expectContractError(await post(routes[index].path, {
      operationId: "operation", restartNo: 0, tenantId: "tenant", slug: "workspace", name: "Workspace", state: "ACTIVE", subject: "founder",
    }), routes[index], "IDENTITY_BUSY");
  });
});
