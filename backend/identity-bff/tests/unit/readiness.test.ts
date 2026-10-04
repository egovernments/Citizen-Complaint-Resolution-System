import { describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { collectReadiness, type ReadinessProbes } from "../../src/modules/operations/readiness.js";
const up = () => vi.fn().mockResolvedValue(undefined);
function probes(): ReadinessProbes {
  return { redis: up(), jwks: up(), keycloakAdmin: up(), digit: up(),
    catalog: { configurator: up(), employee: up(), citizen: null },
    poller: vi.fn().mockResolvedValue({ status: "ok", lagSeconds: 0 }),
    reconcile: vi.fn().mockResolvedValue({ status: "ok", intervalSeconds: 300, lagSeconds: 2 }) };
}
describe("readiness", () => {
  it("reports a hung dependency as down within the readiness deadline", async () => {
    const input = probes();
    input.redis = () => new Promise(() => undefined);
    const savedTimeout = config.digitTimeoutMs;
    config.digitTimeoutMs = 10;
    try {
      const result = await collectReadiness(input);
      expect(result.status).toBe("not_ready");
      expect(result.checks.redis).toBe("down");
      expect(result.checks.digit).toBe("ok");
    } finally { config.digitTimeoutMs = savedTimeout; }
  });
  it("allows an unconfigured surface without hiding any checks", async () => {
    const result = await collectReadiness(probes());
    expect(result).toEqual({ status: "ready", checks: { redis: "ok", jwks: "ok", keycloakAdmin: "ok", digit: "ok", catalog: { configurator: "ok", employee: "ok", citizen: "disabled" }, poller: { status: "ok", lagSeconds: 0 }, reconcile: { status: "ok", intervalSeconds: 300, lagSeconds: 2 } } });
  });
  it("runs every check through simultaneous failures and reports no upstream detail", async () => {
    const input = probes();
    input.redis = vi.fn().mockRejectedValue(new Error("sensitive connection detail"));
    input.keycloakAdmin = vi.fn().mockRejectedValue(new Error("unavailable"));
    input.catalog.employee = vi.fn().mockRejectedValue(new Error("unavailable"));
    input.poller = vi.fn().mockRejectedValue(new Error("unavailable"));
    const result = await collectReadiness(input);
    expect(result.status).toBe("not_ready");
    expect(result.checks).toMatchObject({ redis: "down", keycloakAdmin: "down", digit: "ok", catalog: { employee: "down" }, poller: { status: "down", lagSeconds: null } });
    for (const probe of [input.redis, input.jwks, input.keycloakAdmin, input.digit, input.poller, input.reconcile, input.catalog.configurator, input.catalog.employee]) expect(probe).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("sensitive");
  });
});
