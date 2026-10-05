import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { clearTenantCaches, digitTenantName, isActiveDigitTenant, liveMembershipsForSubject } from "../../src/modules/access-context/tenant-directory.js";

vi.mock("../../src/modules/organizations/organization-service.js", async (original) => ({
  ...await original<typeof import("../../src/modules/organizations/organization-service.js")>(),
  listTenantMappings: vi.fn(async () => [{ mappingType: "organization", organizationId: "org", alias: "ws", tenantId: "workspace", name: "Workspace" }]),
  isOrganizationMember: vi.fn(async () => true),
}));

beforeEach(() => { clearTenantCaches(); Object.assign(config, { digitMdmsSearchUrl: "http://mdms.test/search" }); });
afterEach(() => vi.restoreAllMocks());
const body = (tenants: unknown[]) => new Response(JSON.stringify({ MdmsRes: { tenant: { tenants } } }));

it("excludes explicit inactive records while preserving seeds without an activity flag", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => body([
    { code: "row", isActive: false }, { code: "legacy", isactive: false }, { code: "data", active: false },
    { code: "seed", name: "Seed Tenant" }, { code: "enabled", active: true },
  ]));
  for (const tenant of ["row", "legacy", "data"]) expect(await isActiveDigitTenant(tenant)).toBe(false);
  expect(await isActiveDigitTenant("seed")).toBe(true);
  expect(await isActiveDigitTenant("enabled")).toBe(true);
  expect(await digitTenantName("seed")).toBe("Seed Tenant");
});

it("fresh reads bypass the 300-second cache and refresh the cached result", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(body([{ code: "tenant", active: true }]))
    .mockResolvedValueOnce(body([{ code: "tenant", active: false }]));
  expect(await isActiveDigitTenant("tenant")).toBe(true);
  expect(await isActiveDigitTenant("tenant")).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await isActiveDigitTenant("tenant", { fresh: true })).toBe(false);
  expect(await isActiveDigitTenant("tenant")).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(2);
});

describe("root list cache (#2303)", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
  afterEach(() => vi.useRealTimers());

  it("refetches a cached root list once a missing tenant's miss window has passed", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(body([]))
      .mockResolvedValueOnce(body([{ code: "workspace", name: "Workspace" }]));
    expect(await isActiveDigitTenant("workspace")).toBe(false);
    vi.advanceTimersByTime(5_001);
    expect(await isActiveDigitTenant("workspace")).toBe(true);
    expect(await digitTenantName("workspace")).toBe("Workspace");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refetches a miss at most once per window, even for fresh reads", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => body([{ code: "root" }]));
    expect(await isActiveDigitTenant("root.unknown")).toBe(false);
    expect(await isActiveDigitTenant("root.unknown")).toBe(false);
    expect(await isActiveDigitTenant("root.other", { fresh: true })).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_001);
    expect(await isActiveDigitTenant("root.unknown")).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("serves a hit from cache for 300 seconds, and a fresh hit refetches", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => body([{ code: "root" }]));
    expect(await isActiveDigitTenant("root")).toBe(true);
    vi.advanceTimersByTime(299_000);
    expect(await isActiveDigitTenant("root")).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await isActiveDigitTenant("root", { fresh: true })).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(300_001);
    expect(await isActiveDigitTenant("root")).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("live memberships reread a cached tenant's activity", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(body([{ code: "workspace" }]))
      .mockResolvedValueOnce(body([{ code: "workspace", isActive: false }]));
    expect((await liveMembershipsForSubject("person")).map((m) => m.tenantId)).toEqual(["workspace"]);
    expect((await liveMembershipsForSubject("person")).map((m) => m.tenantId)).toEqual(["workspace"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await liveMembershipsForSubject("person", true)).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight fetch per root", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => body([{ code: "root" }, { code: "root.city" }]));
    expect(await Promise.all([isActiveDigitTenant("root"), isActiveDigitTenant("root.city", { fresh: true })])).toEqual([true, true]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
