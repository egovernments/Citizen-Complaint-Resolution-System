import { config } from "../../infrastructure/config.js";
import { getRedis } from "../../infrastructure/redis.js";
import { surfaceRegistry } from "../authentication/surfaces.js";
import { checkIdentityMethodCatalog } from "../authentication/methods.js";
import { request } from "../organizations/organization-service.js";
import { withDigitAdmin } from "../managed-accounts/digit-admin-session.js";
import { searchAccounts } from "../managed-accounts/digit-user-client.js";

export type Check = "ok" | "down" | "disabled";
export interface BackgroundReadiness {
  poller(): Promise<{ status: Check; lagSeconds: number | null }>;
  reconcile(): Promise<{ status: Check; intervalSeconds: number; lagSeconds: number | null }>;
}
export interface ReadinessProbes extends BackgroundReadiness {
  redis(): Promise<unknown>;
  jwks(): Promise<unknown>;
  keycloakAdmin(): Promise<unknown>;
  digit(): Promise<unknown>;
  catalog: Record<string, (() => Promise<unknown>) | null>;
}
async function bounded<T>(probe: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(probe), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Readiness deadline exceeded")), config.digitTimeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
async function check(probe: () => Promise<unknown>): Promise<Check> {
  try { await bounded(probe); return "ok"; } catch { return "down"; }
}

/** All checks run even when an earlier dependency fails. No upstream errors leak. */
export async function collectReadiness(probes: ReadinessProbes) {
  const [redis, jwks, keycloakAdmin, digit, catalog, poller, reconcile] = await Promise.all([
    check(probes.redis), check(probes.jwks), check(probes.keycloakAdmin), check(probes.digit),
    Promise.all(Object.entries(probes.catalog).map(async ([surface, probe]) =>
      [surface, probe ? await check(probe) : "disabled"] as const)).then(Object.fromEntries),
    bounded(probes.poller).catch(() => ({ status: "down" as const, lagSeconds: null })),
    bounded(probes.reconcile).catch(() => ({ status: "down" as const, intervalSeconds: config.identityReconciliationIntervalSeconds, lagSeconds: null })),
  ]);
  const checks = { redis, jwks, keycloakAdmin, digit, catalog, poller, reconcile };
  const ready = [redis, jwks, keycloakAdmin, digit, ...Object.values(catalog), poller.status, reconcile.status].every(status => status !== "down");
  return { status: ready ? "ready" as const : "not_ready" as const, checks };
}

export function dependencyProbes(background: BackgroundReadiness): ReadinessProbes {
  return {
    ...background,
    redis: () => getRedis().ping(),
    jwks: async () => {
      const response = await fetch(config.keycloakJwksUri, { signal: AbortSignal.timeout(config.digitTimeoutMs) });
      if (!response.ok) throw new Error("JWKS unavailable");
      const { keys } = await response.json();
      if (!Array.isArray(keys) || !keys.length) throw new Error("JWKS unavailable");
    },
    keycloakAdmin: async () => {
      const response = await request("/clients?first=0&max=1", { signal: AbortSignal.timeout(config.digitTimeoutMs) });
      if (!Array.isArray(await response.json())) throw new Error("Keycloak Admin unavailable");
    },
    digit: () => withDigitAdmin(async token => {
      const results = await Promise.allSettled([
        searchAccounts(token, { tenantId: config.digitAdminTenantId, active: true, userName: config.digitAdminUsername, userType: config.digitAdminUserType }),
        (async () => {
          if (!config.digitMdmsSearchUrl) throw new Error("MDMS unavailable");
          const response = await fetch(config.digitMdmsSearchUrl, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ RequestInfo: { apiId: "digit-identity-bff-readiness", authToken: token }, MdmsCriteria: { tenantId: config.digitAdminTenantId.split(".")[0], moduleDetails: [{ moduleName: "tenant", masterDetails: [{ name: "tenants" }] }] } }),
            signal: AbortSignal.timeout(config.digitTimeoutMs),
          });
          if (!response.ok || !(await response.json()).MdmsRes) throw new Error("MDMS unavailable");
        })(),
      ]);
      if (results.some(result => result.status === "rejected")) throw new Error("DIGIT unavailable");
    }),
    catalog: Object.fromEntries(Object.entries(surfaceRegistry()).map(([surface, entry]) =>
      [surface, entry.clientSecret ? () => checkIdentityMethodCatalog(surface) : null])),
  };
}
