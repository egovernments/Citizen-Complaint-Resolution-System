import { config } from "../../infrastructure/config.js";

/** Shared CORS/redirect policy: relative application paths or exact origins. */
export function safeIdentityReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const candidate = value.trim();
  if (/^\/(?!\/)[^\u0000-\u001f\u007f\\]*$/.test(candidate)) {
    const normalized = new URL(candidate, "http://identity.invalid");
    const relative = `${normalized.pathname}${normalized.search}${normalized.hash}`;
    // URL normalization collapses dot segments. Reject a path such as
    // /..//evil.example when that produces a network-path reference.
    return relative.startsWith("//") ? null : relative;
  }
  try {
    const parsed = new URL(candidate);
    return config.identityAllowedOrigins.includes(parsed.origin) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Relative destinations under the surface's own tenant route. Normalization
 * (dot segments, percent-encoding) happens first, so `/slug/digit-ui/employee/../x`
 * cannot escape the prefix.
 */
export function tenantBoundReturnTo(value: unknown, prefix: string): string | null {
  const safe = safeIdentityReturnTo(value);
  if (!safe || !safe.startsWith("/") || safe.startsWith("//")) return null;
  const path = new URL(safe, "http://identity.invalid").pathname;
  return path.startsWith(prefix) ? safe : null;
}

/**
 * A request's validated `returnTo`, or null when one was given but is unsafe.
 * With a tenant prefix the default is the prefix; otherwise the post-login page.
 */
export function returnDestination(value: unknown, tenantPrefix?: string): string | null {
  if (tenantPrefix !== undefined) return value === undefined ? tenantPrefix : tenantBoundReturnTo(value, tenantPrefix);
  return value === undefined ? config.identityPostLoginRedirect : safeIdentityReturnTo(value);
}

export function withAuthResult(destination: string, id: string): string {
  if (destination.startsWith("/") && !destination.startsWith("//")) {
    const relative = new URL(destination, "http://identity.invalid");
    relative.searchParams.set("authResult", id);
    return `${relative.pathname}${relative.search}${relative.hash}`;
  }
  const url = new URL(destination);
  url.searchParams.set("authResult", id);
  return url.toString();
}
