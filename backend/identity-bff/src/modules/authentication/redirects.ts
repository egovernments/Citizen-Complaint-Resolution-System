import { config } from "../../infrastructure/config.js";

/** Shared CORS/redirect policy: relative application paths or exact origins. */
export function safeIdentityReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const candidate = value.trim();
  if (/^\/(?!\/)[^\u0000-\u001f\u007f\\]*$/.test(candidate)) return candidate;
  try {
    const parsed = new URL(candidate);
    return config.identityAllowedOrigins.includes(parsed.origin) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function withAuthResult(destination: string, id: string): string {
  if (destination.startsWith("/") && !destination.startsWith("//")) {
    return `${destination}${destination.includes("?") ? "&" : "?"}authResult=${encodeURIComponent(id)}`;
  }
  const url = new URL(destination);
  url.searchParams.set("authResult", id);
  return url.toString();
}
