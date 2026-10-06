import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { config } from "../../src/infrastructure/config.js";
import { startIdentityTestApp, stopIdentityTestApp, getIdentityAppPort } from "./identity-test-app.js";

beforeAll(async () => {
  config.cachePrefix = `onboarding-signin-${randomUUID()}`;
  await startIdentityTestApp();
});
afterAll(stopIdentityTestApp);
afterEach(() => vi.restoreAllMocks());

describe("sign-in independence from PGR onboarding", () => {
  it("serves authentication methods and starts sign-in without contacting PGR", async () => {
    const realFetch = globalThis.fetch;
    const calls = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("pgr-services")) throw new Error("PGR unavailable");
      return realFetch(input, init);
    });
    const response = await fetch(`http://localhost:${getIdentityAppPort()}/identity/v1/auth-methods`);
    expect(response.status).toBe(200);
    const authorize = await fetch(`http://localhost:${getIdentityAppPort()}/identity/v1/authorize?method=password`, { redirect: "manual" });
    expect(authorize.status).toBe(302);
    expect(new URL(authorize.headers.get("location")!).pathname).toMatch(/\/protocol\/openid-connect\/auth$/);
    expect(authorize.headers.get("set-cookie")).toContain("_login=");
    expect(calls.mock.calls.some(([input]) => String(input).includes("pgr-services"))).toBe(false);
  });
});
