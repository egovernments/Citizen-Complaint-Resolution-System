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
