import { getTenantId } from "../config/dashboardConfig";
import { isPublicDashboardRuntime } from "./dashboardRuntime";

/**
 * Single source of truth for dashboard auth: token storage, RequestInfo
 * construction, and the 401 -> refresh -> retry cycle.
 *
 * Before this module, getEmployeeToken / getEmployeeInfo / buildRequestInfo were
 * duplicated verbatim in analyticsService, boundaryService and
 * complaintHierarchyService, and no caller inspected response.status. A 401
 * therefore surfaced as the raw string "Analytics request failed (401)" in a
 * banner, and the auth gate (evaluated once at mount) never re-ran (#1466).
 *
 * Behaviour verified against egov-user on bomet, not assumed:
 *   - grant_type=refresh_token is supported and returns a new access_token.
 *   - The refresh token is NOT rotated: the same value comes back.
 *   - Refreshing IMMEDIATELY invalidates the previous access token — a request
 *     still in flight with the old token gets 401. This is why refresh must be
 *     single-flight and why we retry the original request afterwards, rather
 *     than letting each 401 refresh independently.
 *   - A dead refresh token returns HTTP 400 invalid_grant (not 401), so the
 *     refresh call's own failure must never be fed back into this retry path.
 *   - Tokens are opaque UUIDs, not JWTs, so expiry cannot be inspected client
 *     side. Refresh is necessarily reactive (on 401), never pre-emptive.
 *
 * ---------------------------------------------------------------------------
 * CONTRACT — what authFetch() does with a 401, and what callers should expect.
 *
 * A 401 has four distinct causes and they are NOT interchangeable. Collapsing
 * them is what made the first cut of this module dangerous: it treated every
 * one as "session dead" and wiped storage shared with the co-hosted digit-ui
 * app. Each outcome now throws a differently-flagged error:
 *
 *   another caller already refreshed  -> replay with the new token, no error
 *   token dead, refresh succeeded     -> replay, no error
 *   raced a refresh on every attempt  -> err.refreshRaced, session KEPT
 *   auth server unreachable           -> err.refreshUnavailable, session KEPT
 *   fresh token but endpoint 401s     -> err.endpointUnauthorized, session KEPT
 *   non-critical call, token refused  -> err.endpointUnauthorized, session KEPT
 *   CRITICAL call, refresh REJECTED   -> err.sessionExpired, storage CLEARED
 *   CRITICAL call, no refresh token   -> err.sessionExpired, storage KEPT,
 *                                        token marked dead for this tab
 *
 * Only the last row dispatches SESSION_EXPIRED_EVENT and drops the user to the
 * login gate. Two rules govern it:
 *
 *   1. Never destroy a session we have not PROVEN is dead — the keys are shared
 *      with the co-hosted digit-ui app, so a wrong guess signs the user out of
 *      the whole product.
 *   2. Only a SESSION-CRITICAL call may form that verdict. Pass
 *      `sessionCritical: false` for auxiliary data (boundary geometry,
 *      hierarchy labels): those endpoints can 401 for their own reasons (an ACL
 *      gap, a gateway answering 401 instead of 403) and must not be able to tear
 *      the dashboard down to a login screen that falsely blames expiry.
 *
 * Storage is destroyed only on a positive auth-server verdict. Without a refresh
 * token there is no verdict — only one endpoint's 401 — so the refused token is
 * instead marked dead for THIS TAB (sessionStorage). That keeps the gate closed
 * across a reload, which was #1466's "reloading did not help" symptom, without
 * deleting keys the co-hosted app may still be using.
 *
 * Likewise clearSession only drops the unprefixed aliases and the
 * Digit.SessionStorage cache when they actually hold the employee token being
 * torn down — on a shared browser they may belong to a live citizen session. An
 * explicit sign-out overrides that (it must leave no employee session behind on
 * a kiosk) with one exception: aliases carrying a DIFFERENT identity are proven
 * to be someone else's and are still spared. The mirror-image rule governs
 * writes: persistSession seizes the aliases only on a deliberate sign-in, never
 * on a silent background refresh (#1535, #1536).
 *
 * Guarantees: at most three sends and at most one refresh per call (cannot
 * loop); concurrent 401s share a single refresh; a refresh never re-enters this
 * path; the refresh token is owner-stamped so a previous user's token on the
 * same browser is never used.
 *
 * Caller error contract:
 *   analyticsService        — critical; propagates (the dashboard shows it)
 *   boundaryService         — non-critical; partial data, throws only if NOTHING
 *                             loaded so the map can show its error state
 *   complaintHierarchyService — non-critical; returns null (labels fall back)
 * ---------------------------------------------------------------------------
 */

/**
 * Every localStorage key this module owns, in one table.
 *
 * `shared: true` marks keys the co-hosted digit-ui app also reads — index.js
 * copies them into Digit.SessionStorage at boot to seed the employee session.
 * Writing them affects the whole product, not just the dashboard, which is why
 * clearing is gated (see announceSessionExpired).
 *
 * The previous code kept "keys login writes" and "keys signout clears" as two
 * hand-maintained lists and they had already drifted apart once — the refresh
 * token was written but never cleared. Deriving both from this table makes that
 * class of bug structurally impossible.
 */
const KEYS = {
  token: { key: "Employee.token", shared: true },
  refreshToken: { key: "Employee.refresh-token", shared: false },
  userInfo: { key: "Employee.user-info", shared: true },
  tenantId: { key: "Employee.tenant-id", shared: true },
  // Unprefixed aliases the main UI's boot path reads for login detection.
  tokenAlias: { key: "token", shared: true },
  userInfoAlias: { key: "user-info", shared: true },
};

const TOKEN_KEY = KEYS.token.key;
const REFRESH_KEY = KEYS.refreshToken.key;
const USER_INFO_KEY = KEYS.userInfo.key;
const TENANT_KEY = KEYS.tenantId.key;

/** Every key this module writes — so signout can never fall behind login. */
const SESSION_KEYS = Object.values(KEYS).map((k) => k.key);

export const SESSION_EXPIRED_EVENT = "dashboard:session-expired";

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function readStorage(key) {
  try {
    const raw = window.localStorage?.getItem(key);
    return raw && raw !== "undefined" && raw !== "null" ? parseJson(raw) : null;
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — non-fatal, the session just won't survive reload */
  }
}

export function getEmployeeToken() {
  return readStorage(TOKEN_KEY);
}

/**
 * The ownership predicates, defined ONCE.
 *
 * These rules were hand-copied into persistSession and clearSession, and the
 * copies drifting apart is precisely what produced #1535 (the write side never
 * got the clear side's ownership check) and #1536. Two mirrored files times two
 * functions gave eight sites that had to change in lockstep; now there is one
 * definition per rule.
 */
function readAliasToken() {
  return readStorage(KEYS.tokenAlias.key);
}

/**
 * True when the shared unprefixed aliases still hold `token`.
 *
 * Encoding is NOT a hazard here despite the two writers disagreeing about it:
 * the main digit-ui login stores the token raw while this module JSON-stringifies
 * it, but readStorage -> parseJson falls back to the raw string when JSON.parse
 * throws, and an opaque UUID is never valid JSON. So the comparison holds across
 * both encodings, and a mismatch always means a DIFFERENT VALUE — someone else's
 * token, or a leftover.
 */
function ownsSharedAliases(token, aliasToken = readAliasToken()) {
  return token != null && aliasToken === token;
}

/** The token a Digit.SessionStorage "User" entry authenticates with, if any. */
function getCachedSessionToken(cached) {
  return cached?.token ?? cached?.access_token ?? null;
}

/**
 * The refresh token, but only if it belongs to the user currently signed in.
 * A token stamped for a different uuid is a leftover from a previous session on
 * this browser; using it would swap the whole product to that user's identity.
 */
export function getRefreshToken() {
  const stored = readStorage(REFRESH_KEY);
  if (!stored) return null;
  // Legacy shape: a bare string written before owner-stamping existed. It has no
  // provable owner, so it is not trusted.
  if (typeof stored === "string") return null;
  // Fail CLOSED: a missing uuid on either side is not proof of ownership. The
  // open form trusted the token whenever user-info was absent (partial clear,
  // storage eviction, or a stamp written before any UserRequest was seen) —
  // which is exactly the identity swap the stamp exists to prevent.
  const currentUuid = getEmployeeInfo()?.uuid ?? null;
  if (!stored.userUuid || !currentUuid || stored.userUuid !== currentUuid) return null;
  return stored.token || null;
}

export function getEmployeeInfo() {
  return readStorage(USER_INFO_KEY);
}

// Re-exported, NOT re-implemented. A second copy here had a different fallback
// ("ke" vs dashboardConfig's "default"); DashboardLogin uses dashboardConfig's,
// so on a deployment with neither config set, login would authenticate as
// "default" while refresh posted "ke" — egov-user rejects that, which this
// module classifies as a positive rejection and answers by clearing storage
// shared with the co-hosted app. One definition, one fallback.
export { getTenantId };

/**
 * True when a token is PRESENT. Deliberately not a validity check — tokens are
 * opaque, so validity is only knowable by calling the API. Session death is
 * detected reactively via SESSION_EXPIRED_EVENT.
 */
/**
 * Tab-scoped record of a token the server has already refused. Lets the auth
 * gate stay closed across a reload WITHOUT deleting keys the co-hosted digit-ui
 * app is using — the alternative (clearing shared storage on a 401 we could not
 * corroborate with an auth-server verdict) signs the user out of the whole
 * product on the strength of one endpoint's answer.
 */
const DEAD_TOKEN_KEY = "dashboard:dead-token";

function markTokenDead(token) {
  if (!token) return;
  try {
    window.sessionStorage?.setItem(DEAD_TOKEN_KEY, JSON.stringify(token));
  } catch {
    /* private mode — the in-memory gate flip still applies for this view */
  }
}

function isTokenKnownDead(token) {
  if (!token) return false;
  try {
    const raw = window.sessionStorage?.getItem(DEAD_TOKEN_KEY);
    return Boolean(raw) && parseJson(raw) === token;
  } catch {
    return false;
  }
}

export function hasAuth() {
  const token = getEmployeeToken();
  return Boolean(token) && !isTokenKnownDead(token);
}

/** Order roles so the first non-EMPLOYEE role leads (drives the scoping badge). */
export function withSignificantRoleFirst(userInfo) {
  if (!userInfo || !Array.isArray(userInfo.roles)) return userInfo;
  const roles = [...userInfo.roles].sort(
    (a, b) => (a.code === "EMPLOYEE" ? 1 : 0) - (b.code === "EMPLOYEE" ? 1 : 0)
  );
  return { ...userInfo, roles };
}

/**
 * The dashboard is NOT a standalone app: App.js routes /employee/dashboard to
 * AdminDashboard inside the same SPA that renders DigitUI, and index.js copies
 * Employee.token into Digit.SessionStorage's "User" at boot. That cache is what
 * the rest of the employee UI authenticates from, and it is never re-read.
 *
 * Since refreshing invalidates the previous access token server-side, a silent
 * refresh would otherwise kill the token the surrounding app is still holding —
 * every main-UI call would 401 until a full reload. Push the new token into
 * that cache so both surfaces stay on the same session.
 */
function syncDigitSession(accessToken, userInfo, { claim = false, previousToken = null } = {}) {
  const session = window.Digit?.SessionStorage;
  if (!session?.set || !session?.get) return; // standalone build — nothing to sync
  try {
    const existing = session.get("User") || {};
    // The "User" slot is a SINGLE shared cache — the co-hosted citizen portal
    // authenticates from it too. Overwriting it on a background refresh would
    // swap an actively-signed-in citizen to the employee identity without any
    // user action (#1535). Only write when this is a deliberate sign-in, or
    // when the cache is provably ours.
    //
    // Token equality alone does NOT prove that: the cache is sessionStorage
    // (per-tab) while previousToken comes from localStorage (shared), so a
    // sibling tab that refreshed first leaves THIS tab's cache one vintage
    // behind — indistinguishable, by token, from a stranger's. Refusing to
    // write there strands the tab on a token the earlier refresh already
    // invalidated, and a reload does not heal it because index.js boots from
    // this cache and skips the localStorage re-seed while it looks populated.
    // Identity is the tab-independent proof; a citizen's cache still fails it.
    const cachedToken = getCachedSessionToken(existing);
    const cachedUuid = existing?.info?.uuid ?? null;
    // A refresh usually carries no UserRequest, so fall back to stored identity.
    const ourUuid = userInfo?.uuid ?? getEmployeeInfo()?.uuid ?? null;
    const ownsCache =
      cachedToken === previousToken ||
      (cachedUuid != null && ourUuid != null && cachedUuid === ourUuid);
    if (!claim && !ownsCache) return;
    session.set("User", {
      ...existing,
      token: accessToken,
      access_token: accessToken,
      ...(userInfo != null && { info: userInfo }),
    });
  } catch {
    /* best-effort — localStorage remains the source of truth */
  }
}

/**
 * @param claimAliases  true only for an explicit sign-in through the dashboard
 *   login form, where taking ownership of the shared unprefixed aliases IS the
 *   intent. A silent background refresh passes false: it may refresh OUR
 *   session, but it must never seize aliases that now belong to someone else.
 */
export function persistSession({ accessToken, refreshToken, userInfo, tenantId, claimAliases = false }) {
  // Normalise here rather than at the call site so a refresh cannot silently
  // revert the role order that login established.
  const normalisedUser = userInfo != null ? withSignificantRoleFirst(userInfo) : null;

  // Read BEFORE writing: the token the aliases must currently hold for us to
  // still own them. This is the write-side counterpart of clearSession's
  // ownsAliases check — without it, a stale tab that 401s and silently
  // refreshes clobbers a citizen's live session on the co-hosted portal with
  // the employee identity, an identity swap with no user action (#1535).
  const previousToken = getEmployeeToken();
  // Read the alias ONCE: two reads of a value that cannot change between them
  // are a wasted parse, and they let a later edit make the two expressions
  // disagree — silently splitting one ownership decision into two.
  const aliasToken = readAliasToken();
  const mayWriteAliases =
    claimAliases || ownsSharedAliases(previousToken, aliasToken) || aliasToken == null;

  if (accessToken != null) {
    writeStorage(TOKEN_KEY, accessToken);
    if (mayWriteAliases) writeStorage("token", accessToken);
  }
  if (refreshToken != null) {
    // Stored WITH its owner. Only this dashboard writes the refresh token, and
    // the main digit-ui login neither knows nor clears it — so without an owner
    // stamp, user A's refresh token can survive user B signing in on the same
    // browser and silently re-authenticate the whole product as A.
    writeStorage(REFRESH_KEY, {
      token: refreshToken,
      userUuid: normalisedUser?.uuid ?? getEmployeeInfo()?.uuid ?? null,
    });
  }
  if (normalisedUser != null) {
    writeStorage(USER_INFO_KEY, normalisedUser);
    // The two aliases move as a pair — a `token` from one identity beside a
    // `user-info` from another is worse than either alone.
    if (mayWriteAliases) writeStorage("user-info", normalisedUser);
  }
  if (tenantId != null) writeStorage(TENANT_KEY, tenantId);

  if (accessToken != null) {
    // A newly issued token is by definition not the dead one.
    try {
      window.sessionStorage?.removeItem(DEAD_TOKEN_KEY);
    } catch {
      /* ignore */
    }
    // Pass mayWriteAliases, not claimAliases: an EMPTY "User" cache is not ours
    // to take while the aliases belong to someone else. Digit's storage expires
    // entries after 24h, so a kiosk left overnight nulls a citizen's cache while
    // their aliases stay live — and writing the employee identity into it would
    // re-enter #1535 through the cache door, since index.js boots from the cache
    // first and would then serve the employee session under the citizen's aliases.
    syncDigitSession(accessToken, normalisedUser, { claim: mayWriteAliases, previousToken });
  }
}

/**
 * @param force  true for an explicit user-initiated sign-out, which must ALWAYS
 *   leave this browser with no employee session — see clearDashboardSession.
 *   Left false for an automatic teardown (a server-rejected refresh), where the
 *   aliases may since have been taken over by a citizen on the co-hosted portal
 *   and silently signing them out would be the greater harm.
 */
export function clearSession({ force = false } = {}) {
  // The unprefixed aliases and the single Digit.SessionStorage "User" slot are
  // not necessarily OURS: on a shared browser a citizen may be signed into the
  // co-hosted portal while a stale Employee.token lingers. Outside an explicit
  // sign-out, only drop them when they actually hold the employee token we are
  // tearing down, or we would sign an unrelated user out of a session they are
  // actively using.
  const employeeToken = getEmployeeToken();
  const ownsAliases = ownsSharedAliases(employeeToken);

  // A forced sign-out must leave no employee session behind, so it drops the
  // aliases even when they no longer match our token — that mismatch is usually
  // a leftover, and leaving it stranded is what #1536 was about. But "not
  // provably ours" is not "provably someone else's": when the `user-info` alias
  // carries a DIFFERENT uuid, the aliases are positively identified as another
  // live session, and deleting them would sign a citizen out of the co-hosted
  // portal mid-flow — breaking rule 1 above to fix a leftover. A missing uuid on
  // either side proves nothing, so those still clear.
  const employeeUuid = getEmployeeInfo()?.uuid ?? null;
  const aliasUuid = readStorage(KEYS.userInfoAlias.key)?.uuid ?? null;
  const aliasesAreForeign =
    !ownsAliases && aliasUuid != null && employeeUuid != null && aliasUuid !== employeeUuid;
  const mayDropAliases = ownsAliases || (force && !aliasesAreForeign);

  SESSION_KEYS.forEach((k) => {
    if (!mayDropAliases && (k === KEYS.tokenAlias.key || k === KEYS.userInfoAlias.key)) return;
    try {
      window.localStorage?.removeItem(k);
    } catch {
      /* ignore */
    }
  });
  // Symmetric with syncDigitSession. Clearing only localStorage would leave the
  // co-hosted UI authenticating from a cached dead token — and index.js boots
  // from SessionStorage FIRST, skipping the localStorage re-seed when "User"
  // exists, so even a reload would re-enter the employee UI "logged in" on a
  // token that no longer works.
  //
  // Gated on what the cache actually HOLDS, not on alias ownership (#1536): if
  // a citizen rewrote the unprefixed alias, ownsAliases is false while the
  // cache still holds the employee's dead token, and keying off ownership would
  // strand exactly the token this teardown exists to remove.
  const session = window.Digit?.SessionStorage;
  if (session?.set) {
    try {
      const cached = session.get?.("User");
      const cachedToken = getCachedSessionToken(cached);
      // Never null a cache holding a DIFFERENT live session — but on an
      // explicit sign-out an empty cache is the required end state. A cache with
      // no token authenticates nobody, so it is safe to drop UNLESS it still
      // carries a foreign identity payload the co-hosted UI is rendering from.
      if (force || cachedToken === employeeToken || (cachedToken == null && !cached?.info))
        session.set("User", null);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Show the login gate.
 *
 * `clearStorage` is deliberately opt-in and, per the single call site, is true
 * ONLY for REFRESH_REJECTED — a positive verdict from the auth server.
 * Employee.token / user-info / token are SHARED with the co-hosted digit-ui app,
 * so wiping them signs the user out of the whole product. The only writer of
 * Employee.refresh-token is this dashboard's own login form; a session seeded by
 * the main digit-ui login has none, so NO_TOKEN is the common path and carries
 * no server verdict — it marks the token dead for this tab instead.
 */
function announceSessionExpired({ clearStorage } = { clearStorage: false }) {
  if (clearStorage) clearSession();
  try {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  } catch {
    /* CustomEvent unavailable — the auth gate still re-checks on next render */
  }
}

export function buildRequestInfo(msgIdPrefix = "dashboard") {
  // A public entry may share this origin with an employee session. Never let
  // those credentials change the public endpoint's audience or leave storage.
  const authToken = isPublicDashboardRuntime() ? null : getEmployeeToken();
  const userInfo = isPublicDashboardRuntime() ? null : getEmployeeInfo();
  return {
    apiId: "Rainmaker",
    ver: ".01",
    ts: Date.now(),
    action: "_search",
    msgId: `${msgIdPrefix}-${Date.now()}`,
    ...(authToken && { authToken }),
    ...(userInfo && { userInfo }),
  };
}

/**
 * OAuth client credentials header. globalConfigs stores JWT_TOKEN as the bare
 * base64 of "egov-user-client:" WITHOUT the scheme, so the "Basic " prefix is
 * added here — matching what DashboardLogin sends on the password grant.
 */
export function getOAuthBasic() {
  const configured = window.globalConfigs?.getConfig?.("JWT_TOKEN");
  const raw = configured || "ZWdvdi11c2VyLWNsaWVudDo=";
  return /^Basic\s/i.test(raw) ? raw : `Basic ${raw}`;
}

/**
 * In-flight refresh, shared by every caller that 401s in the same window.
 * Without this, N concurrent batch queries would fire N refreshes, and since
 * each refresh invalidates the prior access token they would invalidate each
 * other's tokens in turn.
 */
let refreshInFlight = null;

/**
 * Bumped on every successful refresh. Single-flight alone is NOT sufficient:
 * it only merges 401s that overlap the refresh window. A request whose 401
 * lands just AFTER a refresh settled would see refreshInFlight === null and
 * start a SECOND refresh, which immediately invalidates the token the first
 * caller is already retrying with — turning a recovered session into a false
 * logout. The generation lets a caller tell "my token is stale because someone
 * else already refreshed" (just retry) apart from "the current token is dead"
 * (refresh).
 */
let tokenGeneration = 0;

/** Refresh must not hang the whole dashboard: every 401'd caller waits on it. */
const REFRESH_TIMEOUT_MS = 15000;

/**
 * Refresh outcomes are three-valued, not boolean. Collapsing them loses the
 * distinction that decides whether the shared session may be destroyed:
 *   REFRESHED   — new token in hand, replay the request.
 *   REJECTED    — the server positively refused the refresh token (400
 *                 invalid_grant). The session really is dead; clearing is right.
 *   NO_TOKEN    — we never had a refresh token. The 401 is authoritative, but
 *                 the keys belong to the co-hosted app; flip the gate, keep them.
 *   UNAVAILABLE — the refresh call itself never got an answer (offline, DNS,
 *                 gateway reset, timeout). We cannot conclude anything, so the
 *                 session must survive. Waking a laptop from sleep hits this.
 */
export const REFRESH_REFRESHED = "refreshed";
export const REFRESH_REJECTED = "rejected";
export const REFRESH_NO_TOKEN = "no_token";
export const REFRESH_UNAVAILABLE = "unavailable";

async function requestRefresh() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return REFRESH_NO_TOKEN;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    tenantId: getTenantId(),
  });

  // Without this, a stalled /user/oauth/token leaves every waiting caller
  // pending forever and the dashboard sits on a permanent loading state.
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS) : null;

  let res;
  try {
    res = await fetch("/user/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: getOAuthBasic(),
      },
      body,
      ...(controller && { signal: controller.signal }),
    });
  } catch {
    // Network failure or the 15s abort — NOT a verdict on the refresh token.
    // Treating this as rejection would delete a still-valid session over a
    // transient blip.
    return REFRESH_UNAVAILABLE;
  } finally {
    if (timer) clearTimeout(timer);
  }

  // Only a client-error answer is the server REFUSING the token (a dead one
  // gives 400 invalid_grant). A 5xx, a 429, or a gateway error page is the auth
  // server failing — not a verdict on our credentials — and must not be allowed
  // to wipe storage shared with the co-hosted digit-ui app. Getting this wrong
  // would sign every user out of the product on a deploy blip.
  if (!res.ok) {
    const refused = res.status === 400 || res.status === 401 || res.status === 403;
    return refused ? REFRESH_REJECTED : REFRESH_UNAVAILABLE;
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return REFRESH_UNAVAILABLE;
  }
  // A 2xx with no token is a malformed/intercepted response (proxy login page,
  // truncated body), not a rejection. Same reasoning as above: do not destroy.
  if (!data?.access_token) return REFRESH_UNAVAILABLE;

  // The refresh token was read up to 15s ago. A sign-out — in this tab or, since
  // localStorage is shared and nothing broadcasts the event, in another one —
  // may have wiped the session in the meantime. Persisting now would write a
  // freshly issued employee token back into keys the user just cleared, and
  // because the wipe leaves the aliases vacant, mayWriteAliases would let it
  // take those too: the next person at a shared kiosk boots straight into the
  // signed-out employee's session. clearSession always drops REFRESH_KEY, so its
  // absence is the marker. Nothing to clean up — we wrote nothing.
  if (readStorage(REFRESH_KEY) == null) return REFRESH_UNAVAILABLE;

  persistSession({
    accessToken: data.access_token,
    // Not rotated today, but honour a rotated value if the server ever sends one.
    refreshToken: data.refresh_token || refreshToken,
    userInfo: data.UserRequest || undefined,
  });
  tokenGeneration += 1;
  return REFRESH_REFRESHED;
}

/** Single-flight wrapper around requestRefresh. Resolves to a REFRESH_* value. */
function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = requestRefresh()
      .catch(() => REFRESH_UNAVAILABLE)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

/**
 * fetch() for authenticated dashboard APIs.
 *
 * `buildBody` is a function, not a value: on retry the RequestInfo must be
 * rebuilt so the request carries the NEW token. Passing a pre-serialised body
 * would replay the dead one and 401 again.
 *
 * On a 401 it either refreshes (shared across callers) or, when another caller
 * has already refreshed since this request was sent, simply replays with the
 * newer token. At most two sends happen, so this cannot loop. If refresh fails,
 * or the replay 401s again, the session is announced dead and the error is
 * thrown with `status` and `sessionExpired` set for callers.
 */
export async function authFetch(
  url,
  { buildBody, method = "POST", headers, sessionCritical = true, signal } = {}
) {
  const send = () =>
    fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      credentials: "omit",
      signal,
      body: buildBody ? JSON.stringify(buildBody()) : undefined,
    });

  // Public requests are never part of employee session ownership. One send,
  // no refresh, no dead-token marker, no storage clear and no expiry event.
  if (isPublicDashboardRuntime()) return send();

  // Three sends max, still at most ONE refresh per call. Three because there are
  // two independent reasons to replay and a caller can need both: a
  // generation-mismatch replay (someone else refreshed mid-flight) and the
  // guaranteed retry after this caller's OWN refresh. With a cap of two, a
  // mismatch replay could consume the budget and the loop would exit having
  // never sent the token it just minted — reporting failure on a session it had
  // successfully repaired. The refresh itself stays capped, so this cannot loop.
  let didRefresh = false;
  let outcome = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const generationAtSend = tokenGeneration;
    const response = await send();
    if (response.status !== 401) return response;

    // If the generation has already moved, another caller refreshed while this
    // request was in flight — our token was merely stale, so replay with the
    // new one instead of refreshing again (a second refresh would invalidate
    // the token that caller is using).
    if (tokenGeneration !== generationAtSend) continue;

    if (didRefresh) break;
    didRefresh = true;
    outcome = await refreshSession();
    if (outcome !== REFRESH_REFRESHED) break;

    // Replay HERE rather than looping, so the retry after our own refresh is
    // guaranteed and not contingent on an attempt remaining. Relying on the
    // loop meant a refresh that succeeded on the final iteration exited without
    // ever sending the token it had just minted — the same defect the attempt
    // cap was raised to fix, merely moved to the last iteration.
    const replayed = await send();
    if (replayed.status !== 401) return replayed;
    break; // fresh token still refused: an endpoint problem, not a dead session
  }

  // Could not reach the auth server: say nothing about the session. Leaving it
  // intact lets the next attempt succeed once connectivity returns, instead of
  // signing the user out of the whole product over a dropped packet.
  if (outcome === REFRESH_UNAVAILABLE) {
    const error = new Error("Could not reach the sign-in service. Please retry.");
    error.status = 401;
    error.refreshUnavailable = true;
    throw error;
  }

  // Every attempt exited on a generation mismatch — a concurrent refresh landed
  // during each send — so we never formed a verdict of our own. The session was
  // just refreshed by somebody else and is alive; treat this as transient rather
  // than falling through to the expiry branch on a healthy session.
  if (outcome === null) {
    const error = new Error("Request raced a token refresh. Please retry.");
    error.status = 401;
    error.refreshRaced = true;
    throw error;
  }

  // We refreshed successfully and the replay STILL 401'd. The token is provably
  // fresh, so this endpoint is rejecting us for its own reason (an auth gap, a
  // misrouted service, a role check answering 401 instead of 403) — not because
  // the session died. Reporting expiry here would sign the user out on every
  // load and re-login would change nothing: a loop.
  if (outcome === REFRESH_REFRESHED) {
    const error = new Error(`Request failed (401) with a valid session: ${url}`);
    error.status = 401;
    error.endpointUnauthorized = true;
    throw error;
  }

  // Reaching here means REJECTED or NO_TOKEN: the server refused this token and
  // we could not renew it.
  //
  // Only a SESSION-CRITICAL call may conclude the session is dead. Auxiliary
  // layers (boundary geometry, hierarchy labels) can 401 for their own reasons —
  // an ACL gap, a gateway answering 401 instead of 403 — and previously that was
  // a per-widget banner. Letting them tear the whole dashboard down to a login
  // screen that falsely blames session expiry is a worse regression than the bug
  // being fixed.
  if (!sessionCritical) {
    const error = new Error(`Request failed (401): ${url}`);
    error.status = 401;
    error.endpointUnauthorized = true;
    throw error;
  }

  // Storage is destroyed ONLY on a positive auth-server verdict (REJECTED). With
  // NO_TOKEN there is no verdict — just one endpoint's 401 — and the keys belong
  // to the co-hosted app, so wiping them would sign the user out of the whole
  // product on evidence we do not have. Instead the refused token is marked dead
  // for this tab, which keeps the gate closed across a reload (the original
  // "reloading did not help" symptom) without touching anyone else's session.
  if (outcome === REFRESH_NO_TOKEN) markTokenDead(getEmployeeToken());
  announceSessionExpired({ clearStorage: outcome === REFRESH_REJECTED });
  const error = new Error("Your session has expired. Please sign in again.");
  error.status = 401;
  error.sessionExpired = true;
  throw error;
}

/** Shared non-401 error shape so every service reports failures identically. */
export async function toRequestError(response, label) {
  const error = new Error(`${label} failed (${response.status})`);
  error.status = response.status;
  // Read the body ONCE. Calling .text() after a failed .json() throws "body
  // already read", so the old fallback could never succeed and every non-JSON
  // error body (e.g. an HTML gateway page on a 502) was silently lost.
  try {
    const raw = await response.text();
    try {
      error.payload = JSON.parse(raw);
    } catch {
      error.payload = raw;
    }
  } catch {
    error.payload = null;
  }
  return error;
}
