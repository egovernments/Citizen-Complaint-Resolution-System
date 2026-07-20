/**
 * Platform-admin client helpers — KC master realm auth + scoped JWT decode.
 *
 * Separate from the citizen apiClient on purpose: the admin surface uses
 * a different KC realm (master vs ke) and a different localStorage key
 * (digit_ui_v2_admin_*) so the two sessions don't trample each other.
 *
 * Two persona shapes the SPA cares about:
 *   - god   — built-in master admin OR holds PLATFORM_ADMIN role.
 *             /admin/dashboard with invite form + list.
 *   - scoped — holds bootstrap:<tenantId> role.
 *             /admin/bootstrap wizard for THAT tenant.
 */
import { getApiBaseUrl } from './config';
import { decodeJwtPayload } from './keycloak';

const KC_BASE = (import.meta.env.VITE_KC_BASE as string) || `${window.location.origin}/auth`;
export const PLATFORM_ADMIN_REALM =
  (import.meta.env.VITE_KC_MASTER_REALM as string) || 'master';
const OVERLAY_BASE = `${getApiBaseUrl()}/token-exchange`;
export const PLATFORM_ADMIN_BASE = `${OVERLAY_BASE}/platform-admin`;

const LS_TOKEN = 'digit_ui_v2_admin_token';
const LS_TOKEN_EXP = 'digit_ui_v2_admin_token_exp';

export interface AdminClaims {
  sub: string;
  preferred_username: string;
  email?: string;
  realm_access?: { roles: string[] };
  exp: number;
}

export type AdminScope =
  | { kind: 'god'; sub: string; username: string }
  | { kind: 'scoped'; sub: string; username: string; tenantId: string };

const GOD_ROLE = 'PLATFORM_ADMIN';
const SCOPED_ROLE_PREFIX = 'bootstrap:';

export function deriveScope(claims: AdminClaims): AdminScope | null {
  const roles = claims.realm_access?.roles || [];
  const preferred = claims.preferred_username || '';

  if (preferred === 'admin' || roles.includes(GOD_ROLE)) {
    return { kind: 'god', sub: claims.sub, username: preferred };
  }

  const scopedRole = roles.find((r) => r.startsWith(SCOPED_ROLE_PREFIX));
  if (scopedRole) {
    return {
      kind: 'scoped',
      sub: claims.sub,
      username: preferred,
      tenantId: scopedRole.slice(SCOPED_ROLE_PREFIX.length),
    };
  }
  return null;
}

/**
 * Mint a JWT via KC master realm password grant. admin-cli is the only
 * client guaranteed to allow direct grants on master. The overlay
 * separately gates which JWTs can hit /platform-admin/* — this just
 * gets the token.
 */
export async function adminLogin(username: string, password: string): Promise<{
  token: string;
  claims: AdminClaims;
  scope: AdminScope;
}> {
  const resp = await fetch(
    `${KC_BASE}/realms/${encodeURIComponent(PLATFORM_ADMIN_REALM)}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username,
        password,
      }).toString(),
    },
  );
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    const desc = (body as { error_description?: string }).error_description;
    throw new Error(desc || `Login failed (${resp.status})`);
  }
  const data = (await resp.json()) as { access_token: string };
  const token = data.access_token;
  const claims = decodeJwtPayload(token) as AdminClaims;
  const scope = deriveScope(claims);
  if (!scope) {
    throw new Error(
      'This account has no platform-admin role. Ask a god admin for either PLATFORM_ADMIN or bootstrap:<tenantId>.',
    );
  }
  localStorage.setItem(LS_TOKEN, token);
  localStorage.setItem(LS_TOKEN_EXP, String(claims.exp * 1000));
  return { token, claims, scope };
}

export function adminLogout() {
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_TOKEN_EXP);
}

/**
 * Load the current admin session from localStorage. Returns null on
 * missing or expired token — UI should redirect to /admin/login.
 */
export function loadAdminSession(): {
  token: string;
  claims: AdminClaims;
  scope: AdminScope;
} | null {
  const token = localStorage.getItem(LS_TOKEN);
  const expMs = Number(localStorage.getItem(LS_TOKEN_EXP) || 0);
  if (!token || !expMs || expMs < Date.now()) {
    adminLogout();
    return null;
  }
  try {
    const claims = decodeJwtPayload(token) as AdminClaims;
    const scope = deriveScope(claims);
    if (!scope) return null;
    return { token, claims, scope };
  } catch {
    adminLogout();
    return null;
  }
}

/** Fetch wrapper that auto-injects the admin JWT + handles JSON */
export async function adminFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const session = loadAdminSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${PLATFORM_ADMIN_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
      Authorization: `Bearer ${session.token}`,
    },
  });
  const text = await resp.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: 'invalid_json', raw: text.slice(0, 500) };
  }
  if (!resp.ok) {
    const msg =
      (body as { message?: string; error?: string }).message ||
      (body as { error?: string }).error ||
      `HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return body as T;
}
