import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createIdentityApp } from "../../src/app/create-app.js";
import { LeaseBusyError, LeaseLostError } from "../../src/modules/accounts/person-lease.js";
import { refreshIdentityTokens } from "../../src/modules/authentication/oidc.js";
const state = vi.hoisted(() => ({ busy: false }));
vi.mock("../../src/modules/accounts/person-lease.js", async original => {
  const actual = await original<typeof import("../../src/modules/accounts/person-lease.js")>();
  return { ...actual, withPersonLease: async (_subject: string, operation: () => Promise<unknown>) => {
    if (state.busy) throw new actual.LeaseBusyError();
    return operation();
  } };
});
vi.mock("../../src/modules/authentication/oidc.js", async original => ({ ...await original<typeof import("../../src/modules/authentication/oidc.js")>(), refreshIdentityTokens: vi.fn() }));
vi.mock("../../src/modules/sessions/session-store.js", async original => ({
  ...await original<typeof import("../../src/modules/sessions/session-store.js")>(),
  getIdentitySession: async () => ({ claims: { sub: "person", email: "test@example.test" }, accessToken: "expired", refreshToken: "refresh", accessExpiresAt: 0, sessionExpiresAt: Date.now() + 60000 }),
}));
let server: Server;
let base: string;
beforeAll(() => { server = createIdentityApp().listen(0); base = `http://localhost:${(server.address() as AddressInfo).port}`; });
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
describe("refresh HTTP failure codes", () => {
  it.each(["busy", "lost", "offline"])("returns the frozen response for %s", async mode => {
    state.busy = mode === "busy";
    vi.mocked(refreshIdentityTokens).mockRejectedValue(mode === "lost" ? new LeaseLostError() : new TypeError("offline"));
    const response = await fetch(`${base}/identity/v1/session`, { headers: { Cookie: "digit_identity_session=sid" } });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: mode === "offline" ? "IDENTITY_UNAVAILABLE" : "IDENTITY_BUSY" });
    if (mode !== "offline") expect(response.headers.get("retry-after")).toBe("1");
    state.busy = false;
  });
});
