import { describe, expect, it, vi } from "vitest";
import { parseAllowedOrigins, parseTrialDays } from "../../src/infrastructure/config.js";
import { safeIdentityReturnTo, withAuthResult } from "../../src/modules/authentication/redirects.js";

describe("identity configuration", () => {
  it("normalizes allowlisted URLs to exact origins", () => {
    expect(parseAllowedOrigins(
      "https://digit.example.org/, http://localhost:5173,https://digit.example.org",
    )).toEqual(["https://digit.example.org", "http://localhost:5173"]);
  });

  it("falls back to the admin tenant's root for backfill roots only when the variable is unset", async () => {
    const roots = async (value: string | undefined) => {
      const saved = [process.env.IDENTITY_TENANT_ROUTE_BACKFILL_ROOTS, process.env.DIGIT_ADMIN_TENANT_ID];
      process.env.DIGIT_ADMIN_TENANT_ID = "pg.citya";
      if (value === undefined) delete process.env.IDENTITY_TENANT_ROUTE_BACKFILL_ROOTS;
      else process.env.IDENTITY_TENANT_ROUTE_BACKFILL_ROOTS = value;
      try {
        vi.resetModules();
        return (await import("../../src/infrastructure/config.js")).config.identityTenantRouteBackfillRoots;
      } finally {
        for (const [name, before] of [["IDENTITY_TENANT_ROUTE_BACKFILL_ROOTS", saved[0]], ["DIGIT_ADMIN_TENANT_ID", saved[1]]] as const) {
          if (before === undefined) delete process.env[name]; else process.env[name] = before;
        }
      }
    };
    expect(await roots(undefined)).toEqual(["pg"]);
    expect(await roots("")).toEqual([]); // an explicit opt-out, never the admin tenant's root
    expect(await roots(" ke , mz,ke")).toEqual(["ke", "mz"]);
  });

  it("reads the trial length as whole days from 0 to 3650 and refuses anything else at startup", async () => {
    expect(parseTrialDays(undefined)).toBe(0);
    expect(parseTrialDays("")).toBe(0);
    expect(parseTrialDays(" 30 ")).toBe(30);
    expect(parseTrialDays("3650")).toBe(3650);
    // The only switch: a value parseInt can't read must not silently turn every lock off.
    for (const bad of ["thirty", "true", "-1", "1.5", "NaN", "30d", "3651"]) {
      expect(() => parseTrialDays(bad)).toThrow(/IDENTITY_WORKSPACE_TRIAL_DAYS/);
    }
    const saved = process.env.IDENTITY_WORKSPACE_TRIAL_DAYS;
    process.env.IDENTITY_WORKSPACE_TRIAL_DAYS = "thirty";
    try {
      vi.resetModules();
      await expect(import("../../src/infrastructure/config.js")).rejects.toThrow(/IDENTITY_WORKSPACE_TRIAL_DAYS/);
    } finally {
      if (saved === undefined) delete process.env.IDENTITY_WORKSPACE_TRIAL_DAYS; else process.env.IDENTITY_WORKSPACE_TRIAL_DAYS = saved;
      vi.resetModules();
    }
  });

  it("rejects paths, credentials, and non-http schemes in the origin allowlist", () => {
    expect(() => parseAllowedOrigins("https://digit.example.org/configurator")).toThrow(/origins only/);
    expect(() => parseAllowedOrigins("https://user:secret@digit.example.org")).toThrow(/origins only/);
    expect(() => parseAllowedOrigins("javascript:alert(1)")).toThrow(/origins only/);
  });

  it("places result ids before relative URL fragments", () => {
    expect(safeIdentityReturnTo("/client/login?from=keycloak#help"))
      .toBe("/client/login?from=keycloak#help");
    expect(withAuthResult("/client/login?from=keycloak#help", "result-1"))
      .toBe("/client/login?from=keycloak&authResult=result-1#help");
  });

  it("canonicalizes relative destinations and rejects normalized network paths", () => {
    expect(safeIdentityReturnTo("/client/../login?from=keycloak#help"))
      .toBe("/login?from=keycloak#help");
    expect(safeIdentityReturnTo("/..//evil.example")).toBeNull();
    expect(safeIdentityReturnTo("/%2e%2e//evil.example")).toBeNull();
  });
});
