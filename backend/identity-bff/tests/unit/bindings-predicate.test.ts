import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BindingUser } from "../../src/modules/bindings/types.js";
const f = vi.hoisted(() => ({
  user: { enabled: true, attributes: {} } as BindingUser,
  org: { id: "org", enabled: true, lifecycle: null as string | null },
  member: true, tenant: true, managed: null as object | null,
}));
vi.mock("../../src/modules/organizations/organization-service.js", () => ({
  request: vi.fn(async () => Response.json(f.user)), isOrganizationMember: vi.fn(async () => f.member),
}));
vi.mock("../../src/modules/onboarding/organization-reader.js", () => ({ readOrganizationByTenant: vi.fn(async () => f.org) }));
vi.mock("../../src/modules/access-context/tenant-directory.js", () => ({ isActiveDigitTenant: vi.fn(async () => f.tenant) }));
vi.mock("../../src/modules/managed-accounts/managed-account-service.js", () => ({
  managedIdentity: vi.fn(), findManagedAccount: vi.fn(async () => f.managed),
}));
vi.mock("../../src/modules/bindings/managed-fallback.js", () => ({ managedFallbackAccess: vi.fn(async () => f.managed ? { allowed: true } : { allowed: false, denial: "NO_ACTIVE_BINDING" }) }));
import { citizenAccess, staffAccess } from "../../src/modules/bindings/predicate.js";
function binding(state = "active") {
  f.user.attributes!["digit.bindings"] = [JSON.stringify({ v: 1, bindings: [{
    tenantId: "pg", uuid: "00000000-0000-4000-8000-000000000001", state,
    invitationVersion: 1, createdAt: 1, createdBy: { kind: "conversion" }, boundAt: 1,
    ...(state === "pending" && { expiresAt: Date.now() + 60_000 }),
  }] })];
}
beforeEach(() => {
  f.user = { enabled: true, attributes: {} }; f.org = { id: "org", enabled: true, lifecycle: null };
  f.member = true; f.tenant = true; f.managed = null;
});
describe("fresh identity-side access predicate", () => {
  it("allows an active binding with live membership and lifecycle-less Organization", async () => {
    binding(); expect(await staffAccess("person", "pg")).toMatchObject({ allowed: true, via: "binding" });
  });
  it("denies a disabled person", async () => {
    binding(); f.user.enabled = false;
    expect(await staffAccess("person", "pg")).toMatchObject({ allowed: false, denial: "KEYCLOAK_DISABLED" });
  });
  it.each(["pending", "removed"])("never uses managed fallback for %s bindings", async (state) => {
    binding(state); f.managed = { active: true };
    expect(await staffAccess("person", "pg")).toMatchObject({ allowed: false, denial: "NO_ACTIVE_BINDING" });
  });
  it("uses managed fallback only when no binding exists", async () => {
    f.managed = { active: true };
    expect(await staffAccess("person", "pg")).toEqual({ allowed: true, via: "managed" });
  });
  it.each(["PROVISIONING", "FAILED"])("denies %s Organizations", async (state) => {
    binding(); f.org.lifecycle = state;
    expect(await staffAccess("person", "pg")).toMatchObject({ allowed: false, denial: "ORGANIZATION_INACTIVE" });
  });
  it("rechecks live membership on every call", async () => {
    binding(); expect((await staffAccess("person", "pg")).allowed).toBe(true); f.member = false;
    expect(await staffAccess("person", "pg")).toMatchObject({ allowed: false, denial: "NOT_A_MEMBER" });
  });
  it("denies inactive tenants", async () => {
    binding(); f.tenant = false;
    expect(await staffAccess("person", "pg")).toMatchObject({ allowed: false, denial: "TENANT_INACTIVE" });
  });
  it("citizen requires a live enabled identity with a verified phone", async () => {
    expect(await citizenAccess("person")).toEqual({ allowed: false, denial: "PHONE_NOT_VERIFIED" });
    f.user.attributes = { phoneNumber: ["+15551234567"], phoneNumberVerified: ["true"] };
    expect(await citizenAccess("person")).toEqual({ allowed: true });
    f.user.enabled = false;
    expect(await citizenAccess("person")).toEqual({ allowed: false, denial: "KEYCLOAK_DISABLED" });
  });
});
