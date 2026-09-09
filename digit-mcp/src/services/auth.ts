import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { digitApi } from './digit-api.js';
import type { ToolAccess, UserInfo } from '../types/index.js';

/**
 * How the server decides who a caller is.
 *
 * - `ambient` — when the caller supplied no token, fall back to
 *   CRS_USERNAME / CRS_PASSWORD. Correct for **stdio**: the process was
 *   spawned by the developer whose credentials those are, so using them
 *   grants the caller nothing they didn't already have.
 *
 * - `token` — the caller MUST have presented a token that we validated.
 *   The server's own credentials are never substituted. Correct for any
 *   network-facing transport, where the caller is an unknown peer.
 *
 * The default is derived from the transport, so an HTTP deployment is
 * secure without extra configuration. `MCP_AUTH_MODE` overrides it —
 * setting `ambient` on an HTTP transport restores the old behaviour and
 * is logged loudly, because it makes every anonymous caller an admin.
 */
export type AuthMode = 'ambient' | 'token';

let ambientWarningLogged = false;

export function getAuthMode(): AuthMode {
  const explicit = (process.env.MCP_AUTH_MODE || '').trim().toLowerCase();
  if (explicit === 'ambient' || explicit === 'token') {
    if (explicit === 'ambient' && process.env.MCP_TRANSPORT === 'http' && !ambientWarningLogged) {
      ambientWarningLogged = true;
      console.error(
        '[auth] WARNING: MCP_AUTH_MODE=ambient with the HTTP transport. Any caller that ' +
        'reaches this port acts as CRS_USERNAME. Only use this on a loopback-bound socket.'
      );
    }
    return explicit;
  }
  return process.env.MCP_TRANSPORT === 'http' ? 'token' : 'ambient';
}

/** Thrown when a caller must authenticate but hasn't. Surfaced as a 401 / auth-category error. */
export class AuthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

/**
 * Password assigned to accounts this server *creates*. Never applied to an
 * account that already existed — see the C4/C5 notes in hrms.ts and
 * pgr-workflow.ts. Override per deployment so it isn't a published default.
 */
export function defaultProvisioningPassword(): string {
  return process.env.MCP_DEFAULT_PROVISIONING_PASSWORD || 'eGov@123';
}

/**
 * Establish an authenticated DIGIT session for the current call.
 *
 * Replaces eight near-identical copies of this helper that each fell back to
 * env credentials unconditionally — which meant that on a network transport,
 * supplying *no* credentials elevated the caller to ADMIN.
 *
 * @param opts.optional when true, returns quietly instead of throwing if no
 *   credentials are available (used by snapshot_capture, whose API-backed
 *   layers are designed to degrade rather than fail the whole capture).
 */
export async function ensureAuthenticated(opts?: { optional?: boolean }): Promise<void> {
  if (digitApi.isAuthenticated()) return;

  if (getAuthMode() === 'token') {
    if (opts?.optional) return;
    throw new AuthRequiredError(
      'Not authenticated. Send Authorization: Bearer <token> with your request. ' +
      'This server does not act on its own credentials for network callers.'
    );
  }

  const username = process.env.CRS_USERNAME;
  const password = process.env.CRS_PASSWORD;
  const tenantId = process.env.CRS_TENANT_ID || digitApi.getEnvironmentInfo().stateTenantId;

  if (!username || !password) {
    if (opts?.optional) return;
    throw new AuthRequiredError(
      'Not authenticated. Call the "configure" tool first, or set CRS_USERNAME/CRS_PASSWORD env vars.'
    );
  }

  await digitApi.login(username, password, tenantId);
}

/**
 * Role codes that satisfy `access: 'admin'`. Configurable because the code used
 * for a super-user differs across DIGIT deployments; the default covers the
 * common ones. A misconfiguration here is self-diagnosing: the denial message
 * names both the required roles and the roles the caller actually holds.
 */
export function adminRoleCodes(): string[] {
  const configured = (process.env.MCP_ADMIN_ROLES || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return configured.length > 0
    ? configured
    : ['SUPERUSER', 'MDMS_ADMIN', 'SYSTEM_ADMIN', 'STADMIN'];
}

/** Roles that, on their own, mark an account as citizen-only (not staff). */
const CITIZEN_ROLE_CODES = new Set(['CITIZEN']);

/**
 * Authorize a tool call against the caller's validated identity.
 * Returns null when allowed, or a human-readable denial reason.
 *
 * Only meaningful in `token` mode. In `ambient` mode the process owner supplied
 * the credentials, so there is no second party to authorize — the check is
 * skipped, exactly as with the other ambient-mode exemptions.
 */
export function checkToolAccess(
  toolName: string,
  access: ToolAccess | undefined,
  user: UserInfo | null,
): string | null {
  if (getAuthMode() !== 'token') return null;

  const required: ToolAccess = access ?? 'employee';
  if (required === 'public') return null;

  if (!user) {
    return `Tool "${toolName}" requires an authenticated ${required} caller, but the token carried no user context.`;
  }

  const roles = (user.roles || []).map((r) => (r.code || '').toUpperCase()).filter(Boolean);
  const isCitizenOnly =
    roles.length > 0 && roles.every((code) => CITIZEN_ROLE_CODES.has(code));

  if (required === 'employee') {
    // A self-registered citizen must not reach staff tooling. Note we check
    // roles rather than user.type: pgr_create provisions citizens with
    // type EMPLOYEE so they can use password auth, so type is not a boundary.
    if (isCitizenOnly || roles.length === 0) {
      return (
        `Tool "${toolName}" requires a staff (non-citizen) account. ` +
        `Caller "${user.userName}" holds roles: ${roles.join(', ') || '(none)'}.`
      );
    }
    return null;
  }

  // required === 'admin'
  const adminRoles = adminRoleCodes();
  if (!roles.some((code) => adminRoles.includes(code))) {
    return (
      `Tool "${toolName}" requires one of these roles: ${adminRoles.join(', ')}. ` +
      `Caller "${user.userName}" holds: ${roles.join(', ') || '(none)'}. ` +
      'Set MCP_ADMIN_ROLES if this deployment uses different admin role codes.'
    );
  }
  return null;
}

/**
 * Resolve the client IP to record for a request.
 *
 * X-Forwarded-For is only honoured when the immediate peer is a configured
 * trusted proxy. Otherwise the socket address wins. Previously the header was
 * preferred unconditionally, so with nothing in front of the port every caller
 * chose the IP that appeared in the audit trail.
 *
 * MCP_TRUSTED_PROXIES: comma-separated IPv4 addresses, IPv4 CIDRs, or `*` to
 * trust any peer (only correct behind an ingress that overwrites the header).
 * Unset => never trust the header.
 */
export function resolveClientIp(
  socketAddress: string | undefined,
  forwardedFor: string | undefined,
): { ip: string; claimed?: string; trusted: boolean } {
  const peer = normalizeIp(socketAddress || '');
  const claim = (forwardedFor || '').split(',')[0].trim();

  if (!claim) return { ip: peer, trusted: true };
  if (!isTrustedProxy(peer)) {
    // Keep the claim for forensics, but do not let it masquerade as the source.
    return { ip: peer, claimed: claim, trusted: false };
  }
  return { ip: normalizeIp(claim), trusted: true };
}

function normalizeIp(value: string): string {
  // ::ffff:10.0.0.1 -> 10.0.0.1
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(value);
  return m ? m[1] : value;
}

function isTrustedProxy(peer: string): boolean {
  const entries = (process.env.MCP_TRUSTED_PROXIES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0) return false;
  if (entries.includes('*')) return true;
  return entries.some((entry) => (entry.includes('/') ? ipInCidr(peer, entry) : entry === peer));
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bitsRaw] = cidr.split('/');
  const bits = parseInt(bitsRaw, 10);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const toInt = (v: string): number | null => {
    const parts = v.split('.');
    if (parts.length !== 4) return null;
    let out = 0;
    for (const p of parts) {
      const n = Number(p);
      if (!Number.isInteger(n) || n < 0 || n > 255) return null;
      out = (out << 8) | n;
    }
    return out >>> 0;
  };
  const a = toInt(ip);
  const b = toInt(range);
  if (a === null || b === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

/**
 * Directory that snapshot artifacts may be read from and written to.
 *
 * `snapshot_capture`'s `output_path` used to flow straight into writeFileSync,
 * and the container runs as root — so a caller could write anywhere in the
 * filesystem, including over the server's own `dist/*.js`. Confining it to one
 * directory keeps the feature (large artifacts written to disk instead of
 * returned inline) without handing out arbitrary filesystem writes.
 */
export function artifactDir(): string {
  return (
    process.env.MCP_ARTIFACT_DIR ||
    join(process.env.SESSION_DATA_DIR || tmpdir(), 'artifacts')
  );
}

/**
 * Resolve a caller-supplied artifact path inside `artifactDir()`.
 * Returns the absolute path to use, or throws if it escapes the directory.
 * Rejects traversal both by normalising and by re-checking the resolved
 * prefix with a trailing separator (so `/data/artifacts-evil` cannot pass a
 * naive startsWith on `/data/artifacts`).
 */
export function resolveArtifactPath(userPath: string): string {
  const base = resolve(artifactDir());
  const candidate = isAbsolute(userPath) ? resolve(userPath) : resolve(base, userPath);
  if (candidate !== base && !candidate.startsWith(base + sep)) {
    throw new Error(
      `Path "${userPath}" is outside the permitted artifact directory (${base}). ` +
      'Pass a bare filename, or set MCP_ARTIFACT_DIR to change the location.'
    );
  }
  mkdirSync(dirname(candidate), { recursive: true });
  return candidate;
}

/**
 * Hosts a caller may point the client at via `configure`'s `base_url`.
 * Defaults to the host of the configured DIGIT API only, so the SSRF /
 * credential-exfiltration path is closed unless an operator opts in.
 * Empty entry list + ambient mode = unrestricted (local dev convenience).
 */
export function allowedBaseUrlHosts(): string[] {
  const configured = (process.env.MCP_ALLOWED_BASE_URLS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeHost);

  if (configured.length > 0) return configured;

  try {
    return [normalizeHost(digitApi.getEnvironmentInfo().url)];
  } catch {
    return [];
  }
}

function normalizeHost(value: string): string {
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).host.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

/**
 * Guard for `configure`'s `base_url`. Returns an error string to surface to
 * the caller, or null when the target is acceptable.
 *
 * In `token` mode the allow-list is always enforced. In `ambient` mode (stdio)
 * it is enforced only when the operator set MCP_ALLOWED_BASE_URLS explicitly,
 * so a developer pointing their own CLI at an arbitrary environment still works.
 */
export function checkBaseUrlAllowed(baseUrl: string): string | null {
  const enforce = getAuthMode() === 'token' || !!process.env.MCP_ALLOWED_BASE_URLS;
  if (!enforce) return null;

  let host: string;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return `base_url must use http or https (got "${url.protocol}").`;
    }
    host = url.host.toLowerCase();
  } catch {
    return `base_url is not a valid URL: "${baseUrl}".`;
  }

  const allowed = allowedBaseUrlHosts();
  if (!allowed.includes(host)) {
    return (
      `base_url host "${host}" is not allowed. Permitted: ${allowed.join(', ') || '(none)'}. ` +
      'Set MCP_ALLOWED_BASE_URLS to authorise additional DIGIT instances. ' +
      'This guard exists because pointing the server at an arbitrary host would send it credentials.'
    );
  }
  return null;
}
