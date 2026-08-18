import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { isIPv4, isIPv6 } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { getEnvironment } from '../config/environments.js';
import { digitApi, TokenIntrospectionError } from './digit-api.js';
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
 * MCP_TRUSTED_PROXIES: comma-separated IP addresses or CIDRs (IPv4 and IPv6
 * both supported), or `*` to trust any peer (only correct behind an ingress
 * that overwrites the header). Unset => never trust the header.
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
  // Strip a zone index (fe80::1%eth0) first, so it never reaches the parser.
  const zoneless = value.split('%')[0];
  if (!isIPv6(zoneless)) return zoneless;

  // Any IPv4-mapped form collapses to its IPv4 spelling — ::ffff:10.0.0.1 and
  // 0:0:0:0:0:ffff:0a00:0001 are the same peer, and only handling the shorthand
  // meant a fully-spelled one never matched an IPv4 entry.
  const groups = ipv6Groups(zoneless);
  if (groups && groups[5] === 0xffff && groups.slice(0, 5).every((g) => g === 0)) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.');
  }
  return expandIpv6(zoneless);
}

/** Canonical fully-expanded IPv6 form, so `::1` and `0:0:...:1` compare equal. */
function expandIpv6(value: string): string {
  const groups = ipv6Groups(value);
  return groups ? groups.map((g) => g.toString(16).padStart(4, '0')).join(':') : value.toLowerCase();
}

/** Parse an IPv6 literal into its eight 16-bit groups, or null if malformed. */
function ipv6Groups(value: string): number[] | null {
  if (!isIPv6(value)) return null;
  const [head, tail] = value.split('::') as [string, string | undefined];
  // A trailing dotted quad (::ffff:1.2.3.4, 64:ff9b::192.0.2.1) is two groups,
  // not one hex number: parseInt('1.2.3.4', 16) is 1, which silently produced a
  // wrong address and could false-match an IPv6 CIDR.
  const parse = (part: string): number[] => {
    if (!part) return [];
    const out: number[] = [];
    for (const piece of part.split(':').filter(Boolean)) {
      if (piece.includes('.')) {
        const octets = piece.split('.').map(Number);
        if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return [NaN];
        out.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      } else {
        out.push(parseInt(piece, 16));
      }
    }
    return out;
  };
  const left = parse(head);
  const right = tail === undefined ? [] : parse(tail);
  if ([...left, ...right].some((n) => !Number.isInteger(n))) return null;
  if (tail === undefined) return left.length === 8 ? left : null;
  const fill = 8 - left.length - right.length;
  if (fill < 0) return null;
  return [...left, ...new Array(fill).fill(0), ...right];
}

function isTrustedProxy(peer: string): boolean {
  const entries = (process.env.MCP_TRUSTED_PROXIES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0) return false;
  if (entries.includes('*')) return true;
  return entries.some((entry) =>
    entry.includes('/') ? ipInCidr(peer, entry) : normalizeIp(entry) === peer,
  );
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [rangeRaw = '', bitsRaw = ''] = cidr.split('/');
  const rawRange = rangeRaw.trim();
  const range = normalizeIp(rawRange);

  // Validate the range BEFORE anything can short-circuit to `true`. A truncated
  // or typo'd entry must mean "ignore this entry", never "trust every peer" —
  // `garbage/0` and `/0` both used to return true for any address.
  if (!isIPv4(range) && !isIPv6(range)) return false;
  // Reject a prefix that isn't a bare decimal integer: parseInt is lenient
  // enough to read '0x0' and '-0' as 0.
  if (!/^\d+$/.test(bitsRaw.trim())) return false;

  const bits = parseInt(bitsRaw, 10);
  if (!Number.isInteger(bits) || bits < 0) return false;

  // A /0 prefix means "every address" — but only when the range is actually
  // all-zeros. `10.0.0.1/0` is numerically a wildcard and is, in a config file,
  // a typo for /32; reading it as "trust every peer" is the wrong way to be
  // wrong. `0.0.0.0/0` and `::/0` still mean what they say.
  if (bits === 0) return range === '0.0.0.0' || /^[0:]+$/.test(range);

  // IPv6 is matched group-wise rather than via 32-bit ints. A dual-stack
  // cluster hands us IPv6 peers, and silently failing to match them would
  // put every client behind the ingress under one recorded address.
  if (isIPv6(ip) || isIPv6(range)) {
    if (bits > 128) return false;
    const a = ipv6Groups(ip);
    const b = ipv6Groups(range);
    if (!a || !b) return false;
    for (let i = 0; i < 8; i++) {
      const groupBits = Math.min(16, Math.max(0, bits - i * 16));
      if (groupBits === 0) break;
      const mask = groupBits === 16 ? 0xffff : (0xffff << (16 - groupBits)) & 0xffff;
      if ((a[i] & mask) !== (b[i] & mask)) return false;
    }
    return true;
  }

  // ::ffff:10.0.0.0/104 means 10.0.0.0/8 once the peer has been collapsed to
  // its IPv4 form. Rebase the prefix rather than rejecting it — but gate that
  // on the range having ACTUALLY been written in IPv6 form. Testing the
  // normalized value cannot tell `::ffff:10.0.0.0/104` (intended) from
  // `10.0.0.0/104` (a typo), and silently reading the typo as /8 turns one
  // mistyped digit into trust for a whole network.
  let v4bits = bits;
  if (bits > 32 && isIPv4(ip) && isIPv4(range) && isIPv6(rawRange)) v4bits = bits - 96;
  if (v4bits < 0 || v4bits > 32 || !isIPv4(ip) || !isIPv4(range)) return false;
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
  const mask = v4bits === 0 ? 0 : (0xffffffff << (32 - v4bits)) >>> 0;
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
  // Create the base before resolving it: realpath needs the directory to exist,
  // and on first use of a fresh container it does not.
  const configured = resolve(artifactDir());
  mkdirSync(configured, { recursive: true });
  const base = realPath(configured);

  const lexical = isAbsolute(userPath) ? resolve(userPath) : resolve(base, userPath);

  // Compare real paths on BOTH sides. Comparing a lexical candidate against a
  // real base rejects legitimate input whenever any ancestor is a symlink
  // (/var -> /private/var on macOS, or a mounted artifact volume); comparing
  // lexically on both sides would miss a symlink *inside* the directory
  // pointing out of it. Resolving both is what makes the check mean
  // "the same place", rather than "the same spelling".
  //
  // `realPath` handles a leaf that doesn't exist yet, so this needs no mkdir —
  // which matters, because creating the caller's directories BEFORE deciding
  // whether the path is allowed would let a rejected call still author
  // directories anywhere the process can write.
  const real = realPath(lexical);
  if (!isInside(real, base)) {
    throw new Error(
      `Path "${userPath}" is outside the permitted artifact directory (${base}). ` +
      'Pass a bare filename, or set MCP_ARTIFACT_DIR to change the location.'
    );
  }

  // Reject a symlink at the destination outright.
  //
  // A LIVE symlink is already caught by the realPath comparison above. A
  // DANGLING one is not: realpathSync throws on it, so realPath() treats it as
  // a leaf that does not exist yet and hands back a path that sits inside the
  // base — which writeFileSync then happily follows out of the directory.
  // Creating a *new* file elsewhere is the case that matters, so this is the
  // gap that has to close, not the one the prefix check already covers.
  if (isSymlink(real)) {
    throw new Error(
      `Path "${userPath}" resolves to a symbolic link, which artifact paths may not be. ` +
      `Remove the link at ${real}, or pass a different filename.`
    );
  }

  // Only now, once the destination is known to be confined, create it.
  mkdirSync(dirname(real), { recursive: true });
  return real;
}

function isInside(candidate: string, base: string): boolean {
  return candidate === base || candidate.startsWith(base + sep);
}

/** True when `p` is a symlink. A path that does not exist is not a symlink. */
function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false; // ENOENT — a new file, which is the normal case
  }
}

/**
 * realpath for a path whose leaf may not exist yet (the first write of a run).
 * Walks up to the deepest existing ancestor, resolves that, and re-appends the
 * segments below it — so a symlinked ancestor is followed while a not-yet-
 * created file still resolves.
 */
function realPath(target: string): string {
  const missing: string[] = [];
  let current = target;
  for (;;) {
    try {
      return missing.length ? join(realpathSync(current), ...missing) : realpathSync(current);
    } catch {
      const parent = dirname(current);
      if (parent === current) return target; // reached the root without success
      missing.unshift(basename(current));
      current = parent;
    }
  }
}

/**
 * Hosts a caller may point the client at via `configure`'s `base_url`.
 * Defaults to the host of the configured DIGIT API only, so the SSRF /
 * credential-exfiltration path is closed unless an operator opts in.
 * Empty entry list + ambient mode = unrestricted (local dev convenience).
 *
 * Derived from `getEnvironment()` — the immutable startup config — rather than
 * `digitApi.getEnvironmentInfo()`. The live client's environment is mutable by
 * `configure` itself, so reading it here would let one accepted call widen the
 * allow-list that guards the next one.
 */
export function allowedBaseUrlHosts(): string[] {
  const configured = (process.env.MCP_ALLOWED_BASE_URLS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeHost);

  // The configured DIGIT host is ALWAYS allowed. Making the env var replace it
  // meant that authorising one extra instance silently de-authorised the
  // server's own CRS_API_URL — a surprising way to break `configure`.
  let own: string[] = [];
  try {
    own = [normalizeHost(getEnvironment().url)];
  } catch {
    own = [];
  }
  return [...new Set([...own, ...configured])];
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
    // A path prefix is legitimate — DIGIT is sometimes mounted under one — and
    // `..` needs no guard here because the URL parser has already collapsed it
    // (`https://h/a/../..` parses with pathname `/`).
    //
    // Embedded credentials do need one: they are a classic way to make a URL
    // read as one host to a human and resolve to another.
    if (url.username || url.password) {
      return 'base_url must not embed credentials.';
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

// ───────────────────────────────────────────────────────────────────────────
// Bearer-token authentication
// ───────────────────────────────────────────────────────────────────────────

/** A caller whose bearer token egov-user resolved to a real account. */
export interface ValidatedCaller {
  token: string;
  user: UserInfo;
}

export type BearerAuthResult =
  | { ok: true; caller: ValidatedCaller }
  | { ok: false; status: number; error: string };

/**
 * Introspection cache. Short-lived on purpose: it exists to keep a burst of
 * tool calls from one client turn into a single `/user/_details` round trip,
 * not to hold sessions open. A revoked token keeps working for at most TTL.
 *
 * Only *successful* validations are cached, so a caller cannot fill or evict
 * the map by sending junk tokens.
 */
const TOKEN_CACHE_TTL_MS = 30_000;
const TOKEN_CACHE_MAX = 500;
const tokenCache = new Map<string, { user: UserInfo; at: number }>();

/**
 * True when this bearer is ALREADY a known-good token, without going to the
 * wire. For endpoints that want to reveal a little more to a real caller but
 * must not let an anonymous one drive traffic to egov-user.
 */
export function isCachedCaller(authHeader: string | string[] | undefined): boolean {
  const token = parseBearer(authHeader);
  if (!token) return false;
  const cached = tokenCache.get(token);
  return !!cached && Date.now() - cached.at < TOKEN_CACHE_TTL_MS;
}

/** Test/ops hook: drop every cached introspection result. */
export function clearTokenCache(): void {
  tokenCache.clear();
}

/** Extract the token from an Authorization header value, or null. */
export function parseBearer(authHeader: string | string[] | undefined): string | null {
  const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!raw || !/^Bearer\s+/i.test(raw)) return null;
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  return token || null;
}

/**
 * Resolve an `Authorization: Bearer <token>` header to a validated caller.
 *
 * This is the single implementation behind /mcp, /v1/* and /api/*. Each route
 * previously had its own idea of what a token meant — /v1 in particular
 * accepted any non-empty string — so "authenticated" meant something different
 * depending on which door you knocked on.
 */
export async function authenticateBearer(
  authHeader: string | string[] | undefined,
): Promise<BearerAuthResult> {
  const token = parseBearer(authHeader);
  if (!token) {
    return {
      ok: false,
      status: 401,
      error:
        'Authentication required: send Authorization: Bearer <DIGIT access token>. ' +
        'Mint one from your DIGIT instance at POST /user/oauth/token.',
    };
  }

  const now = Date.now();
  const cached = tokenCache.get(token);
  if (cached && now - cached.at < TOKEN_CACHE_TTL_MS) {
    return { ok: true, caller: { token, user: cloneUser(cached.user) } };
  }

  let user: UserInfo | null;
  try {
    // Single-flight: N concurrent requests bearing the same cold token would
    // otherwise fire N introspections, which is exactly the load an egov-user
    // brownout least needs.
    user = await introspectOnce(token);
  } catch (err) {
    if (err instanceof TokenIntrospectionError) {
      return {
        ok: false,
        status: 503,
        error:
          'Cannot verify your token right now: the identity service is unreachable. ' +
          'This is not a problem with your credentials — retry shortly. ' +
          `(${err.message})`,
      };
    }
    throw err;
  }

  if (!user) {
    tokenCache.delete(token);
    return {
      ok: false,
      status: 401,
      error: 'Invalid or expired access token. Mint a new one from /user/oauth/token.',
    };
  }

  if (tokenCache.size >= TOKEN_CACHE_MAX) tokenCache.clear();
  tokenCache.set(token, { user, at: now });
  return { ok: true, caller: { token, user: cloneUser(user) } };
}

/** In-flight introspections, so one cold token costs one round trip. */
const inFlight = new Map<string, Promise<UserInfo | null>>();

function introspectOnce(token: string): Promise<UserInfo | null> {
  const existing = inFlight.get(token);
  if (existing) return existing;
  const p = digitApi.validateToken(token).finally(() => inFlight.delete(token));
  inFlight.set(token, p);
  return p;
}

/**
 * Hand each caller its own copy of the cached identity.
 *
 * The cache holds one object per token, and `applyToken` stores that reference
 * on a request-scoped client. Sharing the reference across concurrent requests
 * would put mutable state back across the boundary `runWithIsolatedClient`
 * exists to draw, so the copy is what keeps that guarantee honest.
 */
function cloneUser(user: UserInfo): UserInfo {
  return { ...user, roles: user.roles ? user.roles.map((r) => ({ ...r })) : undefined };
}

/**
 * Bind a validated caller to the current (request-scoped) DIGIT client, so
 * every tool it runs acts as that caller. The state tenant is derived from the
 * token's own tenant rather than a caller-supplied header.
 */
export function applyValidatedCaller(caller: ValidatedCaller): void {
  const tenantId = caller.user.tenantId || '';
  const root = tenantId.includes('.') ? tenantId.split('.')[0] : tenantId;
  digitApi.applyToken(caller.token, caller.user, root || null);
}

/**
 * Does this caller hold one of MCP_ADMIN_ROLES?
 *
 * Used by the /api/* observability routes, which aren't tool dispatch and so
 * don't pass through `checkToolAccess`, but expose the same class of data as
 * the admin-tier tools.
 */
export function isAdminCaller(user: UserInfo | null): boolean {
  if (!user) return false;
  const admin = adminRoleCodes();
  return (user.roles || [])
    .map((r) => (r.code || '').toUpperCase())
    .some((code) => admin.includes(code));
}
