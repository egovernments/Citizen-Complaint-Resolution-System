import { config } from "../../infrastructure/config.js";

/** A configured browser surface; its context kind selects existing behavior. */
export type IdentitySurface = string;
export type SurfaceContextKind = "configurator" | "employee" | "citizen";
export interface SurfaceConfig {
  contextKind: SurfaceContextKind;
  clientId: string;
  clientSecret: string;
  scope: string;
  cookieName: string;
  prompt?: string;
}
export const DEFAULT_SURFACE: IdentitySurface = "configurator";

const registryInputs = () => [config.identitySurfacesJson,
  config.keycloakBffClientId, config.keycloakBffClientSecret, config.identityScope, config.identityCookieName,
  config.keycloakEmployeeClientId, config.keycloakEmployeeClientSecret, config.identityEmployeeScope, config.identityEmployeeCookieName,
  config.keycloakCitizenClientId, config.keycloakCitizenClientSecret, config.identityCitizenScope, config.identityCitizenCookieName];
let cached: { inputs: unknown[]; registry: Record<string, SurfaceConfig> } | null = null;

/**
 * Parsed and validated once per configuration (createIdentityApp calls it at startup, so a
 * malformed IDENTITY_SURFACES_JSON fails boot). Keyed by the raw inputs so a config change
 * (tests) rebuilds it; per-request callers only compare a few strings.
 */
export function surfaceRegistry(): Record<string, SurfaceConfig> {
  const inputs = registryInputs();
  if (cached && cached.inputs.every((value, i) => value === inputs[i])) return cached.registry;
  const registry = buildSurfaceRegistry();
  cached = { inputs, registry };
  return registry;
}

function buildSurfaceRegistry(): Record<string, SurfaceConfig> {
  const registry: Record<string, SurfaceConfig> = {
    configurator: { contextKind: "configurator", clientId: config.keycloakBffClientId, clientSecret: config.keycloakBffClientSecret, scope: config.identityScope, cookieName: config.identityCookieName },
    employee: { contextKind: "employee", clientId: config.keycloakEmployeeClientId, clientSecret: config.keycloakEmployeeClientSecret, scope: config.identityEmployeeScope, cookieName: config.identityEmployeeCookieName, prompt: "login" },
    citizen: { contextKind: "citizen", clientId: config.keycloakCitizenClientId, clientSecret: config.keycloakCitizenClientSecret, scope: config.identityCitizenScope, cookieName: config.identityCitizenCookieName, prompt: "login" },
  };
  const overrides: unknown = config.identitySurfacesJson ? JSON.parse(config.identitySurfacesJson) : {};
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) throw new Error("IDENTITY_SURFACES_JSON must be an object");
  for (const [key, value] of Object.entries(overrides)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(key) || !value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid surface registry entry");
    registry[key] = { ...(Object.hasOwn(registry, key) ? registry[key] : {}), ...value } as SurfaceConfig;
  }
  const cookies = new Set<string>();
  const clients = new Set<string>();
  for (const value of Object.values(registry)) {
    if (!["configurator", "employee", "citizen"].includes(value.contextKind) ||
        ![value.clientId, value.scope, value.cookieName].every(v => typeof v === "string" && v.length > 0) ||
        typeof value.clientSecret !== "string" || !/^[A-Za-z0-9_-]+$/.test(value.cookieName) ||
        (value.prompt !== undefined && !["", "none", "login", "consent", "select_account"].includes(value.prompt))) throw new Error("Invalid surface registry configuration");
    if (cookies.has(value.cookieName) || cookies.has(`${value.cookieName}_login`)) throw new Error("Surface cookies must be distinct");
    if (clients.has(value.clientId)) throw new Error("Surface clients must be distinct");
    cookies.add(value.cookieName); cookies.add(`${value.cookieName}_login`); clients.add(value.clientId);
  }
  return registry;
}

export function surfaceConfig(surface: IdentitySurface): SurfaceConfig {
  const registry = surfaceRegistry();
  if (!Object.hasOwn(registry, surface)) throw new Error("Unknown identity surface");
  return registry[surface];
}
export function surfaceContextKind(surface: IdentitySurface): SurfaceContextKind {
  return surfaceConfig(surface).contextKind;
}
export function parseSurface(value: unknown): IdentitySurface | null {
  if (value === undefined) return DEFAULT_SURFACE;
  return typeof value === "string" && Object.hasOwn(surfaceRegistry(), value) ? value : null;
}
export function isTenantBoundSurface(surface: IdentitySurface): boolean {
  return surfaceContextKind(surface) !== "configurator";
}
export function sessionCookieName(surface: IdentitySurface): string {
  return surfaceConfig(surface).cookieName;
}
export function surfaceReturnPrefix(surface: IdentitySurface, urlSlug: string): string {
  return `/${urlSlug}/digit-ui/${surface}/`;
}

/** Tenant bound to an employee/citizen login attempt and session. */
export interface BoundTenant {
  urlSlug: string;
  tenantId: string;
  rootTenantId: string;
  name: string;
}
