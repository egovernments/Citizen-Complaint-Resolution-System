import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createIdentityApp } from "../../src/app/create-app.js";
import { IdentityAdminError } from "../../src/modules/organizations/organization-service.js";
import { readBindingUser } from "../../src/modules/bindings/store.js";
import { readOrganizationByTenant } from "../../src/modules/onboarding/organization-reader.js";

vi.mock("../../src/modules/accounts/person-lease.js", async original => {
  const actual = await original<typeof import("../../src/modules/accounts/person-lease.js")>();
  // GET /session must never need the write lease: every attempt is busy here.
  return { ...actual, withPersonLease: async () => { throw new actual.LeaseBusyError(); } };
});
vi.mock("../../src/modules/sessions/session-store.js", async original => ({
  ...await original<typeof import("../../src/modules/sessions/session-store.js")>(),
  getIdentitySession: async () => ({ claims: { sub: "person", email: "test@example.test" }, accessToken: "live",
    accessExpiresAt: Date.now() + 600_000, sessionExpiresAt: Date.now() + 600_000 }),
  getSelectedIdentityContext: async () => null,
}));
vi.mock("../../src/modules/bindings/store.js", async original => ({
  ...await original<typeof import("../../src/modules/bindings/store.js")>(), readBindingUser: vi.fn(),
}));
vi.mock("../../src/modules/onboarding/organization-reader.js", async original => ({
  ...await original<typeof import("../../src/modules/onboarding/organization-reader.js")>(), readOrganizationByTenant: vi.fn(),
}));

const bindings = (records: unknown[]) => ({ id: "person", attributes: { "digit.bindings": [JSON.stringify({ v: 1, bindings: records })] } });
const pending = (tenantId: string, expiresAt: number) =>
  ({ tenantId, uuid: `uuid-${tenantId}`, state: "pending", invitationVersion: 1, createdAt: 1, expiresAt });
let server: Server;
let base: string;
beforeAll(() => { server = createIdentityApp().listen(0); base = `http://localhost:${(server.address() as AddressInfo).port}`; });
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
beforeEach(() => {
  vi.mocked(readOrganizationByTenant).mockResolvedValue({ id: "org", alias: "org", name: "Workspace", lifecycle: "ACTIVE", enabled: true });
});
const read = () => fetch(`${base}/identity/v1/session`, { headers: { Cookie: "digit_identity_session=sid" } });

describe("GET /session pending invitations", () => {
  it("lists a live invitation", async () => {
    vi.mocked(readBindingUser).mockResolvedValue(bindings([pending("ug", Date.now() + 60_000)]));
    const response = await read();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ authenticated: true, pendingInvitations: [{ tenantId: "ug", name: "Workspace" }] });
  });
  it.each([
    ["a Keycloak Admin outage", () => vi.mocked(readBindingUser).mockRejectedValue(new IdentityAdminError("Keycloak Admin API returned 503"))],
    ["malformed digit.bindings", () => vi.mocked(readBindingUser).mockResolvedValue({ id: "person", attributes: { "digit.bindings": ["not json"] } })],
    ["an expired invitation while the person lease is busy", () => vi.mocked(readBindingUser).mockResolvedValue(bindings([pending("ug", Date.now() - 1)]))],
    ["an Organization read failure", () => {
      vi.mocked(readBindingUser).mockResolvedValue(bindings([pending("ug", Date.now() + 60_000)]));
      vi.mocked(readOrganizationByTenant).mockRejectedValue(new IdentityAdminError("Keycloak Admin request failed"));
    }],
  ])("answers 200 with no invitations on %s", async (_name, arrange) => {
    arrange();
    const response = await read();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ authenticated: true, pendingInvitations: [] });
  });
  it("does not wait on a hung Keycloak", async () => {
    vi.mocked(readBindingUser).mockImplementation(() => new Promise(() => {}));
    const started = Date.now();
    const response = await read();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ pendingInvitations: [] });
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
