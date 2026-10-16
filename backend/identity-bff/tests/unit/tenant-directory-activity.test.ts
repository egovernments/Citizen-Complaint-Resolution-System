import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { clearTenantCaches, digitTenantName, isActiveDigitTenant } from "../../src/modules/access-context/tenant-directory.js";

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
