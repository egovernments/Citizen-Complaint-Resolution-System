import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * #2805: the sign-up link and password link routes count per address first, then per IP with a
 * much higher limit, and answer an explicit 429 instead of a "we've sent you an email" 202 when
 * either is spent. Redis is replaced by an in-memory copy of the two counter scripts.
 */
const counters = vi.hoisted(() => new Map<string, { count: number; expiresAt: number }>());
vi.mock("../../src/infrastructure/redis.js", async (original) => ({
  ...await original<typeof import("../../src/infrastructure/redis.js")>(),
  getRedis: () => ({
    eval: async (script: string, _keys: number, key: string, windowSeconds?: number) => {
      const now = Date.now();
      let entry = counters.get(key);
      if (entry && entry.expiresAt <= now) { counters.delete(key); entry = undefined; }
      if (script.includes("INCR")) {
        if (!entry) { entry = { count: 0, expiresAt: now + Number(windowSeconds) * 1000 }; counters.set(key, entry); }
        entry.count += 1;
        return [entry.count, Math.ceil((entry.expiresAt - now) / 1000)];
      }
      if (entry && entry.count > 0) entry.count -= 1;
      return 0;
    },
  }),
}));
vi.mock("../../src/modules/organizations/organization-service.js", async (original) => ({
  ...await original<typeof import("../../src/modules/organizations/organization-service.js")>(),
  inspectPasswordSetupAccount: vi.fn(async (email: string) => ({ userId: `user:${email}`, hasPassword: true, federatedProviders: [], emailVerified: true })),
  sendPasswordSetupEmail: vi.fn(async () => {}),
  ensureMagicLinkSignupIdentity: vi.fn(async () => {}),
}));
vi.mock("../../src/modules/sessions/session-store.js", async (original) => ({
  ...await original<typeof import("../../src/modules/sessions/session-store.js")>(),
  createPasswordSetupAttempt: vi.fn(async () => "state"),
  createLoginAttempt: vi.fn(async () => ({ state: "state", nonce: "nonce", codeChallenge: "challenge" })),
}));
vi.mock("../../src/modules/authentication/methods.js", async (original) => ({
  ...await original<typeof import("../../src/modules/authentication/methods.js")>(),
  enabledIdentityMethods: vi.fn(async () => [{ id: "magic_link", type: "magic_link" }]),
}));
vi.mock("../../src/integrations/keycloak/admin-session.js", async (original) => ({
  ...await original<typeof import("../../src/integrations/keycloak/admin-session.js")>(),
  getAdminToken: vi.fn(async () => "admin-token"),
}));

import { config } from "../../src/infrastructure/config.js";
import { reserveEmailRequest } from "../../src/infrastructure/rate-limit.js";
import { createIdentityApp } from "../../src/app/create-app.js";
import { sendPasswordSetupEmail } from "../../src/modules/organizations/organization-service.js";

const limits = { addressLimit: 3, ipLimit: 5, windowSeconds: 900 };
const reserve = (address: string, ip = "ip-a") =>
  reserveEmailRequest({ addressKey: `address:${address}`, ipKey: `ip:${ip}`, ...limits });

beforeEach(() => counters.clear());

describe("reserveEmailRequest", () => {
  it("refuses an address over its limit with the window's remaining seconds, and other addresses carry on", async () => {
    for (let i = 0; i < 3; i++) expect(await reserve("a@example.test")).toEqual({ allowed: true });
    expect(await reserve("a@example.test")).toEqual({ allowed: false, code: "EMAIL_RATE_LIMITED", retryAfter: 900 });
    expect(await reserve("b@example.test")).toEqual({ allowed: true });
  });

  it("charges a request the address limit refuses nothing from the shared IP budget", async () => {
    for (let i = 0; i < 10; i++) await reserve("a@example.test");
    expect(counters.get("ip:ip-a")?.count).toBe(3);
  });

  it("refuses the network once its higher limit is spent, gives back the address charge, and leaves other IPs alone", async () => {
    for (let i = 0; i < 5; i++) expect(await reserve(`person${i}@example.test`)).toEqual({ allowed: true });
    expect(await reserve("late@example.test")).toEqual({ allowed: false, code: "NETWORK_RATE_LIMITED", retryAfter: 900 });
    expect(counters.get("address:late@example.test")?.count).toBe(0);
    expect(await reserve("late@example.test", "ip-b")).toEqual({ allowed: true });
  });
});

describe("email routes over their limits", () => {
  let server: Server;
  let base: string;
  const saved = {
    identityPasswordSetupLimit: config.identityPasswordSetupLimit,
    identityPasswordSetupIpLimit: config.identityPasswordSetupIpLimit,
    identityMagicLinkRequestLimit: config.identityMagicLinkRequestLimit,
    identityMagicLinkRequestIpLimit: config.identityMagicLinkRequestIpLimit,
  };
  beforeAll(() => {
    Object.assign(config, { identityPasswordSetupLimit: 3, identityPasswordSetupIpLimit: 5, identityMagicLinkRequestLimit: 3, identityMagicLinkRequestIpLimit: 5 });
    server = createIdentityApp().listen(0);
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    Object.assign(config, saved);
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const post = (path: string, body: Record<string, unknown>) => fetch(`${base}${path}`, {
    method: "POST",
    headers: { Origin: config.identityAllowedOrigins[0]!, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const passwordHelp = (email: string) => post("/identity/v1/password/setup-requests", { email });
  const signupLink = (email: string) => post("/identity/v1/authentication/magic-link-requests", { email, firstName: "Amina", lastName: "Otieno" });

  it("password help: the 4th request for one address is a 429 with Retry-After, and only 3 emails go", async () => {
    vi.mocked(sendPasswordSetupEmail).mockClear();
    for (let i = 0; i < 3; i++) expect((await passwordHelp("gro@example.test")).status).toBe(202);
    const refused = await passwordHelp("gro@example.test");
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("900");
    const body = await refused.json();
    expect(body).toMatchObject({ code: "EMAIL_RATE_LIMITED", retryAfter: 900 });
    expect(body).not.toHaveProperty("message");
    await new Promise((resolve) => setImmediate(resolve));
    await vi.waitFor(() => expect(sendPasswordSetupEmail).toHaveBeenCalledTimes(3));
  });

  it("password help: once the office's IP is spent, a new address is told so instead of getting a silent 202", async () => {
    for (let i = 0; i < 5; i++) expect((await passwordHelp(`staff${i}@example.test`)).status).toBe(202);
    const refused = await passwordHelp("someone.else@example.test");
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: "NETWORK_RATE_LIMITED", retryAfter: 900 });
  });

  it("sign-up link: the 4th request for one address is a 429, not \"Check your email\"", async () => {
    for (let i = 0; i < 3; i++) expect((await signupLink("founder@example.test")).status).toBe(202);
    const refused = await signupLink("founder@example.test");
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("1800");
    expect(await refused.json()).toMatchObject({ code: "EMAIL_RATE_LIMITED", retryAfter: 1800 });
  });

  it("sign-up link: an office of founders gets past the old 3-per-IP limit", async () => {
    for (let i = 0; i < 5; i++) expect((await signupLink(`founder${i}@example.test`)).status).toBe(202);
    expect(await (await signupLink("founder5@example.test")).json()).toMatchObject({ code: "NETWORK_RATE_LIMITED" });
  });
});
