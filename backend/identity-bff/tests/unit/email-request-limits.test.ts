import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * #2805: the sign-up link and password link routes count per network (IPv6 by /64) and per
 * address in one atomic step, and answer an explicit 429 instead of a "we've sent you an email"
 * 202 when either is spent. The counters run on the test Redis, so the Lua script itself is
 * what is tested.
 */
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
import { closeCache, getRedis, initCache } from "../../src/infrastructure/redis.js";
import { rateLimitNetwork, reserveInWindows } from "../../src/infrastructure/rate-limit.js";
import { reserveEmailRequest } from "../../src/modules/authentication/email-request-limits.js";
import { createIdentityApp } from "../../src/app/create-app.js";
import { sendPasswordSetupEmail } from "../../src/modules/organizations/organization-service.js";

const PREFIX = `email-limits-test-${process.pid}`;
const limits = { addressLimit: 3, ipLimit: 5, windowSeconds: 900 };
const addressKey = (address: string) => `${PREFIX}:address:${address}`;
const networkKey = (ip: string) => `${PREFIX}:ip:${ip}`;
const reserve = (address: string, ip = "203.0.113.1") =>
  reserveEmailRequest({ addressKey: addressKey(address), networkKeyPrefix: `${PREFIX}:ip`, ip, ...limits });

beforeAll(() => {
  Object.assign(config, { cachePrefix: PREFIX });
  initCache(`redis://${process.env.REDIS_HOST || "localhost"}:${process.env.REDIS_PORT || "16379"}`);
});
afterAll(async () => {
  const keys = await getRedis().keys(`${PREFIX}:*`);
  if (keys.length) await getRedis().del(...keys);
  await closeCache();
});
beforeEach(async () => {
  const keys = await getRedis().keys(`${PREFIX}:*`);
  if (keys.length) await getRedis().del(...keys);
});

describe("reserveEmailRequest", () => {
  it("refuses an address over its limit with the window's remaining seconds, and other addresses carry on", async () => {
    for (let i = 0; i < 3; i++) expect(await reserve("a@example.test")).toEqual({ allowed: true });
    expect(await reserve("a@example.test")).toEqual({ allowed: false, code: "EMAIL_RATE_LIMITED", retryAfter: 900 });
    expect(await reserve("b@example.test")).toEqual({ allowed: true });
  });

  it("charges the network for a request the address limit refuses, so probing addresses is not free", async () => {
    const answers = [];
    for (let i = 0; i < 5; i++) answers.push(await reserve("a@example.test"));
    expect(answers.map((answer) => answer.allowed ? "sent" : answer.code))
      .toEqual(["sent", "sent", "sent", "EMAIL_RATE_LIMITED", "EMAIL_RATE_LIMITED"]);
    expect(await getRedis().get(networkKey("203.0.113.1"))).toBe("5");
    expect(await reserve("b@example.test")).toEqual({ allowed: false, code: "NETWORK_RATE_LIMITED", retryAfter: 900 });
  });

  it("refuses the network once its higher limit is spent, charges the address nothing, and leaves other networks alone", async () => {
    for (let i = 0; i < 5; i++) expect(await reserve(`person${i}@example.test`)).toEqual({ allowed: true });
    expect(await reserve("late@example.test")).toEqual({ allowed: false, code: "NETWORK_RATE_LIMITED", retryAfter: 900 });
    // Not even an expired-later zero: a refused request never starts the address's window.
    expect(await getRedis().exists(addressKey("late@example.test"))).toBe(0);
    expect(await reserve("late@example.test", "203.0.113.2")).toEqual({ allowed: true });
  });

  it("answers NETWORK_RATE_LIMITED on a spent network even for an address over its own limit", async () => {
    for (let i = 0; i < 3; i++) await reserve("a@example.test");
    await reserve("b@example.test");
    await reserve("c@example.test");
    // The network is spent: it says nothing more about which addresses had requests.
    expect(await reserve("a@example.test")).toMatchObject({ allowed: false, code: "NETWORK_RATE_LIMITED" });
  });

  it("reserves both limits in one Redis call, so a failure can't leave half a charge", async () => {
    const calls = vi.spyOn(getRedis(), "eval");
    try {
      await reserve("a@example.test");
      for (let i = 0; i < 5; i++) await reserve(`person${i}@example.test`);
      expect(calls).toHaveBeenCalledTimes(6);
    } finally {
      calls.mockRestore();
    }
  });

  it("refuses concurrent requests on a spent network by the network, never by an address charge about to be given back", async () => {
    for (let i = 0; i < 5; i++) await reserve(`person${i}@example.test`);
    const answers = await Promise.all(Array.from({ length: 6 }, () => reserve("busy@example.test")));
    expect(answers.map((answer) => !answer.allowed && answer.code)).toEqual(new Array(6).fill("NETWORK_RATE_LIMITED"));
    expect(await getRedis().exists(addressKey("busy@example.test"))).toBe(0);
  });
});

describe("reserveInWindows", () => {
  const bucket = (name: string, limit: number, keepOnRefusal = false) =>
    ({ key: `${PREFIX}:bucket:${name}`, limit, windowSeconds: 60, keepOnRefusal });

  it("gives back an earlier bucket's charge on a refusal unless it keeps refusals, and never counts later buckets", async () => {
    await reserveInWindows([bucket("first", 5), bucket("kept", 5), bucket("full", 1)]);
    expect(await reserveInWindows([bucket("first", 5), bucket("kept", 5, true), bucket("full", 1), bucket("later", 5)]))
      .toEqual({ allowed: false, refusedBy: 2, retryAfter: 60 });
    expect(await getRedis().mget(...["first", "kept", "full", "later"].map((name) => `${PREFIX}:bucket:${name}`)))
      .toEqual(["1", "2", "2", null]);
  });

  it("deletes a counter given back to zero, so a refused request never starts its window", async () => {
    await reserveInWindows([bucket("full", 0)]);
    expect(await reserveInWindows([bucket("fresh", 5), bucket("full", 0)])).toMatchObject({ allowed: false, refusedBy: 1 });
    expect(await getRedis().exists(`${PREFIX}:bucket:fresh`)).toBe(0);
  });
});

describe("rateLimitNetwork", () => {
  it("keys IPv4 by the address, also when written as IPv4-mapped IPv6", () => {
    expect(rateLimitNetwork("203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitNetwork("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitNetwork("0:0:0:0:0:FFFF:cb00:7107")).toBe("203.0.113.7");
    expect(rateLimitNetwork("::ffff:203.0.113.7%eth0")).toBe("203.0.113.7");
  });

  it("keys IPv6 by its /64, however the address is written", () => {
    const network = "2001:db8:0:1::/64";
    expect(rateLimitNetwork("2001:db8:0:1::1")).toBe(network);
    expect(rateLimitNetwork("2001:DB8:0:1:ffff:ffff:ffff:ffff")).toBe(network);
    expect(rateLimitNetwork("2001:0db8:0000:0001::")).toBe(network);
    expect(rateLimitNetwork("2001:db8:0:2::1")).toBe("2001:db8:0:2::/64");
    expect(rateLimitNetwork("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(rateLimitNetwork("64:ff9b::192.0.2.33")).toBe("64:ff9b:0:0::/64");
    expect(rateLimitNetwork("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(rateLimitNetwork("::1")).toBe("0:0:0:0::/64");
  });

  it("gives a caller without an address one shared key", () => {
    expect(rateLimitNetwork(undefined)).toBe("unknown");
    expect(rateLimitNetwork("")).toBe("unknown");
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
    identityTrustProxyHops: config.identityTrustProxyHops,
  };
  beforeAll(() => {
    Object.assign(config, {
      identityPasswordSetupLimit: 3, identityPasswordSetupIpLimit: 5, identityMagicLinkRequestLimit: 3, identityMagicLinkRequestIpLimit: 5,
      // One trusted proxy hop, so a test can say which address a request comes from.
      identityTrustProxyHops: 1,
    });
    server = createIdentityApp().listen(0);
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    Object.assign(config, saved);
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const post = (path: string, body: Record<string, unknown>, from?: string) => fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      Origin: config.identityAllowedOrigins[0]!,
      "Content-Type": "application/json",
      ...(from && { "X-Forwarded-For": from }),
    },
    body: JSON.stringify(body),
  });
  const passwordHelp = (email: string, from?: string) => post("/identity/v1/password/setup-requests", { email }, from);
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

  it("password help: requests the address limit refuses spend the network's budget too", async () => {
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await passwordHelp("target@example.test")).status);
    expect(statuses).toEqual([202, 202, 202, 429, 429]);
    expect(await (await passwordHelp("next@example.test")).json()).toMatchObject({ code: "NETWORK_RATE_LIMITED" });
  });

  it("password help: an IPv6 client shares one budget across its /64", async () => {
    for (let i = 0; i < 5; i++) expect((await passwordHelp(`staff${i}@example.test`, `2001:db8:1:2::${i + 1}`)).status).toBe(202);
    const refused = await passwordHelp("staff5@example.test", "2001:db8:1:2:ffff:ffff:ffff:fff0");
    expect(await refused.json()).toMatchObject({ code: "NETWORK_RATE_LIMITED" });
    expect((await passwordHelp("staff5@example.test", "2001:db8:1:3::1")).status).toBe(202);
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
