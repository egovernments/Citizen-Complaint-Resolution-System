import { describe, expect, it, vi } from "vitest";
import { parseAllowedOrigins } from "../../src/infrastructure/config.js";
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

  describe("workspace trial settings", () => {
    const names = [
      "IDENTITY_WORKSPACE_TRIAL_DAYS",
      "IDENTITY_WORKSPACE_TRIAL_NOTICE_TITLE",
      "IDENTITY_WORKSPACE_TRIAL_NOTICE_MESSAGE",
      "IDENTITY_WORKSPACE_TRIAL_NOTICE_LINK_LABEL",
      "IDENTITY_WORKSPACE_TRIAL_NOTICE_LINK_URL",
    ];
    // config is read at import time, so load a fresh copy under the given env.
    const load = async (env: Record<string, string>) => {
      const saved = names.map((name) => [name, process.env[name]] as const);
      for (const name of names) delete process.env[name];
      Object.assign(process.env, env);
      try {
        vi.resetModules();
        return (await import("../../src/infrastructure/config.js")).config;
      } finally {
        for (const [name, before] of saved) {
          if (before === undefined) delete process.env[name]; else process.env[name] = before;
        }
      }
    };

    it("is off by default with the default notice", async () => {
      const loaded = await load({});
      expect(loaded.workspaceTrialDays).toBe(0);
      expect(loaded.workspaceTrialNotice).toEqual({
        title: "This workspace's trial has ended",
        message: "Sign-in is paused until the workspace is approved. Contact the platform team to continue.",
      });
    });

    it("reads the number of days", async () => {
      expect((await load({ IDENTITY_WORKSPACE_TRIAL_DAYS: "30" })).workspaceTrialDays).toBe(30);
      expect((await load({ IDENTITY_WORKSPACE_TRIAL_DAYS: "3650" })).workspaceTrialDays).toBe(3650);
    });

    it("refuses more than 3650 days, which would make every activation fail", async () => {
      for (const bad of ["3651", "100000000"]) {
        await expect(load({ IDENTITY_WORKSPACE_TRIAL_DAYS: bad })).rejects.toThrow(/IDENTITY_WORKSPACE_TRIAL_DAYS/);
      }
    });

    it("refuses an invalid day count instead of silently turning the trial off", async () => {
      for (const bad of ["-1", "abc", "1.5", "", " "]) {
        await expect(load({ IDENTITY_WORKSPACE_TRIAL_DAYS: bad })).rejects.toThrow(/IDENTITY_WORKSPACE_TRIAL_DAYS/);
      }
    });

    it("refuses a notice link that is not an absolute http(s) URL", async () => {
      for (const bad of ["javascript:alert(1)", "/relative"]) {
        await expect(load({ IDENTITY_WORKSPACE_TRIAL_NOTICE_LINK_URL: bad }))
          .rejects.toThrow(/IDENTITY_WORKSPACE_TRIAL_NOTICE_LINK_URL/);
      }
      expect((await load({ IDENTITY_WORKSPACE_TRIAL_NOTICE_LINK_URL: "https://x.org/help" })).workspaceTrialNotice)
        .not.toHaveProperty("linkUrl");
      expect((await load({
        IDENTITY_WORKSPACE_TRIAL_NOTICE_LINK_LABEL: "Help",
        IDENTITY_WORKSPACE_TRIAL_NOTICE_LINK_URL: "https://x.org/help",
      })).workspaceTrialNotice).toMatchObject({ linkUrl: "https://x.org/help" });
    });

    it("keeps the notice link only when both label and url are set", async () => {
      expect((await load({ IDENTITY_WORKSPACE_TRIAL_NOTICE_LINK_LABEL: "Contact us" })).workspaceTrialNotice)
        .not.toHaveProperty("linkLabel");
      expect((await load({ IDENTITY_WORKSPACE_TRIAL_NOTICE_LINK_URL: "https://x.example" })).workspaceTrialNotice)
        .not.toHaveProperty("linkUrl");
      expect((await load({
        IDENTITY_WORKSPACE_TRIAL_NOTICE_LINK_LABEL: "Contact us",
        IDENTITY_WORKSPACE_TRIAL_NOTICE_LINK_URL: "https://x.example",
      })).workspaceTrialNotice).toMatchObject({ linkLabel: "Contact us", linkUrl: "https://x.example" });
    });
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
