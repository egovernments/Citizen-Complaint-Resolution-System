/**
 * Identity BFF login helpers shared by the employee and citizen adapters on
 * canonical tenant routes (`/{tenantSlug}/digit-ui/{employee|citizen}/...`).
 *
 * The tenant comes only from the route. The BFF binds the Keycloak login to
 * `surface` + `tenantSlug` server-side; these helpers build the requests and
 * validate the DIGIT session it hands back. They are framework-free so they
 * can be unit tested without React.
 */

// The citizen surface names no method: the BFF starts the first sign-in
// method configured on the digit-ui-citizen Keycloak client (open, #2189).
export const IDENTITY_BFF_SURFACES = Object.freeze({
  employee: Object.freeze({ method: "password", userType: "EMPLOYEE", selectPath: "/identity/v1/contexts/_select" }),
  citizen: Object.freeze({ userType: "CITIZEN", selectPath: "/identity/v1/contexts/citizen/_select" }),
});

/**
 * The tenant egov-user keeps a CITIZEN account at: the first dotted segment
 * of the route tenant (egov-user `getStateLevelTenantForCitizen`), so
 * `ke.bomet.ulb1` -> `ke`. The citizen token's `UserRequest.tenantId` is this
 * root; business requests still use the route tenant.
 */
export function citizenAccountTenantId(tenantId) {
  return typeof tenantId === "string" ? tenantId.split(".")[0] : "";
}

export function surfaceBase(tenant, surface) {
  return `/${tenant.appBasePath}/${surface}`;
}

// Sign-in entry pages per surface. A `from` pointing back at one of them would
// make the login page redirect to itself after every session exchange.
const SIGNIN_ENTRY_PATHS = Object.freeze({
  employee: Object.freeze(["user/login", "user/language-selection"]),
  citizen: Object.freeze(["login", "register", "select-language"]),
});

const isSigninEntry = (requested, base) => {
  const surface = base.endsWith("/employee") ? "employee" : "citizen";
  const path = requested.split(/[?#]/)[0].replace(/\/+$/, "");
  return SIGNIN_ENTRY_PATHS[surface].some((entry) =>
    path === `${base}/${entry}` || path.startsWith(`${base}/${entry}/`));
};

/**
 * Only same-tenant, same-surface relative paths are accepted as `from`; the
 * surface's own login/register/language pages collapse to the surface base.
 */
export function restrictDestination(requested, base) {
  if (typeof requested !== "string") return base;
  if (requested === base || requested.startsWith(`${base}/`) || requested.startsWith(`${base}?`)) {
    // Reject dot segments (plain or percent-encoded) that would let the
    // browser normalise the path back out of the surface base.
    const segments = requested.split(/[?#]/)[0].split(/[/\\]/);
    const isDotSegment = (segment) => {
      let decoded = segment;
      try { decoded = decodeURIComponent(segment); } catch (e) { return true; }
      return decoded === "." || decoded === "..";
    };
    if (segments.some(isDotSegment)) return base;
    if (isSigninEntry(requested, base)) return base;
    return requested;
  }
  return base;
}

export function buildAuthorizeUrl({ surface, tenant, pathname, destination }) {
  const base = surfaceBase(tenant, surface);
  const returnParams = new URLSearchParams();
  if (destination && destination !== base) returnParams.set("from", destination);
  const query = returnParams.toString();
  const returnTo = `${pathname}${query ? `?${query}` : ""}`;
  const { method } = IDENTITY_BFF_SURFACES[surface];
  const params = new URLSearchParams({
    surface,
    tenantSlug: tenant.urlSlug,
    ...(method ? { method } : {}),
    intent: "signin",
    returnTo,
  });
  return `/identity/v1/authorize?${params.toString()}`;
}

const requestJson = async (fetchImpl, url, init) => {
  const response = await fetchImpl(url, {
    ...init,
    credentials: "include",
    headers: { Accept: "application/json", ...(init?.headers || {}) },
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, body };
};

/**
 * Runs authResult → session → context select for `surface` on `tenant`.
 *
 * Resolves to one of:
 *   { status: "authenticated", user: { info, ...tokens } }
 *   { status: "signed-out", fromAuthResult, messageKey?, message? }
 *   { status: "forbidden" | "error", messageKey, message }
 * `message` is a BFF-supplied or English fallback text for `messageKey`.
 */
export async function establishIdentityBffSession({ surface, tenant, authResultId, fetchImpl }) {
  const config = IDENTITY_BFF_SURFACES[surface];
  if (!config) throw new Error(`Unsupported identity surface: ${surface}`);
  const request = (url, init) => requestJson(fetchImpl, url, init);

  if (authResultId) {
    const { response, body } = await request(
      `/identity/v1/auth-results/${encodeURIComponent(authResultId)}`,
    );
    if (!response.ok || body?.status === "failed") {
      return {
        status: "signed-out",
        fromAuthResult: true,
        messageKey: "CORE_IDENTITY_SIGNIN_FAILED",
        message: body?.message || "Sign-in could not be completed. Please try again.",
      };
    }
  }

  const session = await request(`/identity/v1/session?surface=${encodeURIComponent(surface)}`);
  if (session.response.status === 401) {
    return { status: "signed-out", fromAuthResult: Boolean(authResultId) };
  }
  if (!session.response.ok || !session.body?.authenticated) {
    return {
      status: "error",
      messageKey: "CORE_IDENTITY_SIGNIN_UNAVAILABLE",
      message: "Sign-in is temporarily unavailable. Please try again.",
    };
  }
  // The session cookie is per surface, not per tenant: a session bound to
  // another tenant must not be exchanged here. Start a fresh sign-in for the
  // route tenant instead; after an authResult round trip, stop (no loop).
  const boundTenant = session.body.tenant;
  if (boundTenant?.tenantId !== tenant.tenantId || boundTenant?.urlSlug !== tenant.urlSlug) {
    return authResultId
      ? {
        status: "signed-out",
        fromAuthResult: true,
        messageKey: "CORE_IDENTITY_TENANT_SESSION_MISMATCH",
        message: `Sign in again to continue to ${tenant.name}.`,
      }
      : { status: "signed-out", fromAuthResult: false };
  }

  const selected = await request(config.selectPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // The BFF reads the session cookie for `surface`; without it the employee
    // select defaults to the Configurator surface and answers 401.
    body: JSON.stringify(surface === "employee" ? { surface, tenantId: tenant.tenantId } : {}),
  });
  if (selected.response.status === 401) {
    return { status: "signed-out", fromAuthResult: Boolean(authResultId) };
  }
  if (selected.response.status === 403) {
    return {
      status: "forbidden",
      messageKey: "CORE_IDENTITY_TENANT_FORBIDDEN",
      message: `Your account does not have access to ${tenant.name}.`,
    };
  }
  if (!selected.response.ok) {
    return {
      status: "error",
      messageKey: "CORE_IDENTITY_CONTEXT_FAILED",
      message: "Your tenant session could not be prepared. Please try again.",
    };
  }

  const { UserRequest: info, tenant: selectedTenant, ...tokens } = selected.body || {};
  // Employees get a token at the route tenant itself. A citizen token is
  // issued at the route tenant's root (one DIGIT citizen account per root),
  // and the BFF echoes the bound route tenant, which must be this route.
  const tokenTenantOk = surface === "citizen"
    ? info?.tenantId === citizenAccountTenantId(tenant.tenantId) &&
      selectedTenant?.tenantId === tenant.tenantId && selectedTenant?.urlSlug === tenant.urlSlug
    : info?.tenantId === tenant.tenantId;
  if (!info || info.type !== config.userType || !tokenTenantOk || !tokens.access_token) {
    return {
      status: "error",
      messageKey: "CORE_IDENTITY_INVALID_SESSION",
      message: `The signed-in account did not produce a valid ${surface} session for this tenant.`,
    };
  }
  const scopedInfo = surface === "employee"
    ? { ...info, roles: (info.roles || []).filter((role) => role.tenantId === tenant.tenantId) }
    : info;
  return { status: "authenticated", user: { info: scopedInfo, ...tokens } };
}

/** Where to land after logout for `surface` under `appBasePath`. */
export function identityBffLogoutRedirect(appBasePath, surface) {
  return surface === "citizen"
    ? `/${appBasePath}/citizen/login`
    : `/${appBasePath}/employee/user/login`;
}

export function identityBffLogout({ surface, fetchImpl }) {
  return fetchImpl("/identity/v1/logout", {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ surface: surface === "citizen" ? "citizen" : "employee" }),
  });
}
