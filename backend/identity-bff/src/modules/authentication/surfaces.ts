import { config } from "../../infrastructure/config.js";

/**
 * The browser application a sign-in belongs to (#2167).
 *
 * - `configurator`: the existing Organization-based admin journey. It is the
 *   default whenever a request carries no `surface`, so every pre-#2167 caller
 *   keeps its behaviour, cookie and Keycloak client.
 * - `employee` / `citizen`: digit-ui under `/{tenantSlug}/digit-ui/{surface}/`.
 *   The tenant is resolved from that route before the Keycloak redirect and
 *   bound to the login attempt and session; it is never chosen afterwards.
 */
export type IdentitySurface = "configurator" | "employee" | "citizen";

export const DEFAULT_SURFACE: IdentitySurface = "configurator";

/** `undefined` means the default surface; any other unknown value is rejected. */
export function parseSurface(value: unknown): IdentitySurface | null {
  if (value === undefined) return DEFAULT_SURFACE;
  return value === "configurator" || value === "employee" || value === "citizen"
    ? value
    : null;
}

/** Surfaces whose sign-in is bound to one route-resolved tenant. */
export function isTenantBoundSurface(
  surface: IdentitySurface,
): surface is "employee" | "citizen" {
  return surface !== "configurator";
}

/** The opaque browser-session cookie for a surface. */
export function sessionCookieName(surface: IdentitySurface): string {
  if (surface === "employee") return config.identityEmployeeCookieName;
  if (surface === "citizen") return config.identityCitizenCookieName;
  return config.identityCookieName;
}

/**
 * The only destinations a tenant-bound surface may return to. Built from the
 * resolved slug, never from the returnTo value itself.
 */
export function surfaceReturnPrefix(surface: "employee" | "citizen", urlSlug: string): string {
  return `/${urlSlug}/digit-ui/${surface}/`;
}

/** Tenant bound to an employee/citizen login attempt and session. */
export interface BoundTenant {
  urlSlug: string;
  tenantId: string;
  rootTenantId: string;
  name: string;
}
