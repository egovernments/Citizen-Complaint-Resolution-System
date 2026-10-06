# Identity BFF: frozen contract v1

**Status:** frozen (item 0), 2026-10-04. It implements design revision 7.1 (`IDENTITY-BFF-BOUNDARY-FREEZE.md`), including decisions D1–D26.
**Changing it:** send a `contract.proposal` on thread `identity-contract` to the root and the affected lanes, and wait for agreement before changing code. That applies to anything below: route shapes, error codes, the `digit.*` attributes, Redis key families, the person lease and lock order, `encode_v1`, and the payload hash.

**Machine-readable copies (the tests keep them in step with this page):**

| What | File |
|---|---|
| Error codes | `src/contract/error-codes.ts` |
| Routes, auth and codes per route | `src/contract/routes.ts` |
| Administrative roles (role-escalation rule, §3.3.6) | `src/contract/roles.ts` |
| Keycloak attribute schemas | `docs/contract/schemas/*.schema.json` |
| `encode_v1` reference implementation | `src/modules/accounts/credential.ts` |
| Payload hash reference implementation | `src/modules/control-plane/operation-hash.ts` |
| `_link` request id reference implementation | `src/modules/bindings/link-request-id.ts` |

**Contents:**
1. [Boundary](#1-boundary)
2. [Conventions](#2-conventions)
3. [Routes](#3-routes)
4. [Error codes](#4-error-codes)
5. [Keycloak state](#5-keycloak-state)
6. [Sessions](#6-sessions)
7. [Redis keyspace](#7-redis-keyspace)
8. [Derived staff credential (`encode_v1`)](#8-derived-staff-credential-encode_v1)
9. [Onboarding: payload hash, `restartNo` and lifecycle](#9-onboarding-payload-hash-restartno-and-lifecycle)
10. [Keycloak events the BFF reacts to](#10-keycloak-events-the-bff-reacts-to)
11. [Configuration added by the contract](#11-configuration-added-by-the-contract)
12. [Operations](#12-operations)

## 1. Boundary

The BFF is a **credential-to-account broker** (design §1). It turns a Keycloak sign-in, or a verified citizen phone, into one DIGIT account and its token for the tenant the URL names. It keeps that binding, and Keycloak's mirror of DIGIT roles, profile and status, consistent. And it enforces and revokes access.

| Owner | Owns |
|---|---|
| Keycloak | Credentials, identity providers, MFA, sign-in flows, the person record, Organization membership |
| BFF | Browser sessions; tenant binding; account bindings; token issuance and revocation; citizen phone OTP; the DIGIT→Keycloak mirror; Keycloak→DIGIT login identifiers |
| DIGIT (egov-user, HRMS, MDMS) | Roles, employment status, descriptive profile, the tenant's name, everything a token may do |
| PGR onboarding | The onboarding steps and their order, tenant foundation, platform baseline, readiness, retries |

**The BFF never:** writes MDMS, localisation, encryption keys or HRMS records; runs the onboarding steps; holds a role catalogue; accepts a person's password; knows an SMS provider; proxies DIGIT business calls; is called on a signed-in page load; writes DIGIT `active`, roles or account locks; modifies realm configuration; or writes from session claims (every write starts from a fresh Keycloak read under the person lease).

**Access** to a tenant = DIGIT `active` AND the identity-side predicate (D4):
- **staff:** the Keycloak user is enabled, has an `active` binding at the tenant, and is a member of that tenant's Organization (D10);
- **citizen:** the Keycloak user is enabled and holds a verified phone.

Only `ACTIVE` Organizations are routed, listed or selectable. An Organization **without** a lifecycle attribute counts as `ACTIVE`.

Until item 14 removes it, staff resolution is **binding, else the managed `kcbff-` account** (design §3).

## 2. Conventions

### 2.1 Errors

- Every JSON error body is **`{code, error, ...details}`** (D25/B5). `code` is stable and comes from §4; `error` is English display text, and clients must not parse it. Details are named fields such as `attemptsRemaining`.
- A code is always sent with the **same HTTP status** (§4).
- `429`, `IDENTITY_BUSY` and `BINDING_BUSY` responses carry `Retry-After` (seconds).
- Sign-in failures during a browser redirect are not HTTP errors. The BFF answers `303` to `returnTo` with `?authResult=<id>`, and the page reads the result once from `GET /identity/v1/auth-results/:id` (§3.2.4).
- Clients show text from their own localisation keyed by `code`, never from `error` (items 2 and 6).

### 2.2 Auth kinds

| Kind | How | Failure |
|---|---|---|
| none | — | — |
| session | The surface's session cookie (`<IDENTITY_COOKIE_NAME>`, `_employee`, `_citizen`). Writes also check `Origin` when it is present | 401 `SESSION_REQUIRED` / `SESSION_REVOKED`; 403 `UNTRUSTED_ORIGIN` |
| login-attempt | The per-surface login cookie plus the one-time `state` (Keycloak redirects only) | result `AUTH_ATTEMPT_EXPIRED` / `SIGN_IN_FAILED` |
| workload | `Authorization: Bearer <IDENTITY_ONBOARDING_TOKEN>`, compared in constant time. Only PGR holds it, and it opens only the onboarding primitives (D25/B6) | 401 `WORKLOAD_UNAUTHORIZED`; 503 `CONTROL_PLANE_NOT_CONFIGURED` |
| introspection | The onboarding token, or `IDENTITY_SESSION_INTROSPECTION_TOKEN` until PGR moves to the onboarding token | same |
| operator | `Authorization: Bearer <IDENTITY_CONTROL_PLANE_TOKEN>`. Ops tooling only; PGR stops using it | same |

### 2.3 Headers

- Every `/identity/v1/*` and `/internal/*` response sends `Cache-Control: no-store`, except `GET /identity/v1/tenant-contexts/:urlSlug`, which sends `public, max-age=60, stale-while-revalidate=300` (item 15).
- CORS is credentialed and allowed only for `IDENTITY_ALLOWED_ORIGINS`, for GET, POST and OPTIONS.

### 2.4 Persons, tenants and ids

- **Person** = one Keycloak user (`sub`). One person may be both staff and a citizen (D25/C1).
- **Tenant** = a plain DIGIT tenant id such as `pg` (D16). Every binding, membership, citizen account and role tenant uses the workspace's tenant id.
- **Slug** = the Organization `alias` = `digit.urlSlug`, lower-case. Rules: §2.4.1.
- Times are epoch **milliseconds** unless a field ends in `Seconds` or `expiresIn`.

### 2.4.1 URL slug rules (source of truth)

A slug is the first path segment of `/{slug}/digit-ui/...`. This section is the one definition; every layer that accepts or routes a slug enforces exactly it and is tested against the list below:

- the SPA, `digit-ui-esbuild/packages/libraries/src/services/tenant/tenantRoute.js` (`isValidTenantSlug`);
- this BFF, `src/modules/access-context/url-slug.ts` (`validUrlSlug`), used by tenant-context resolution, `/authorize`, the tenant-route backfill and `organizations/_ensure`;
- pgr-services, `OnboardingIdentifierService` (signup and identifier checks).

A valid slug:

- is lower-case, 2–63 characters of `a-z`, `0-9` and `-`, and starts with a letter or digit (`^[a-z0-9][a-z0-9-]{1,62}$`);
- contains at least two letters (`a1` is invalid);
- is not reserved.

Reserved slugs are the SPA's own path words plus every top-level path prefix that nginx (`local-setup/ansible/templates/nginx-site.conf.j2`) or Kong (`local-setup/kong/kong.yml`) routes on the same host. A static test fails when either config gains a slug-shaped prefix that is missing here. Adding a route prefix means adding it here and in all three layers.

<!-- reserved-url-slugs:begin -->
```text
access
api
assets
auth
boundary-service
brand
citizen
common-persist
configurator
dashboard
digit-ui
egov-bndry-mgmnt
egov-enc-service
egov-hrms
egov-idgen
egov-indexer
egov-location
egov-mdms-service
egov-user-event
egov-workflow-v2
employee
env
file-store
filestore
gatus
grafana
health
identity
images
inbox
kc
keycloak
localization
matomo
mcp
mdms-v2
novu
novu-api
novu-bridge
novu-ws
otel
otp
pgr-services
static
status
tests
tests-v2
turbopass
user
user-otp
user-preference
v1
xstate-chatbot
```
<!-- reserved-url-slugs:end -->

A valid slug can still be unavailable for signup. Its tenant id (the slug with every non-letter removed, so `de-fault` is `default`) must not be a platform tenant: `default`, the tenant egov-localization falls back to, and the deployment's state roots. pgr-services owns that list (`OnboardingIdentifierService.reservedTenantId`, from `STATE_LEVEL_TENANT_ID`, `EGOV_STATE_LEVEL_TENANT_ID`, `DIGIT_PROVISIONER_TENANT_ID` and `PGR_ONBOARDING_RESERVED_TENANT_IDS`, default `pg`). Its identifier check answers `available: false` with `conflictingType: TENANT_ID`, and submit refuses with `ONBOARDING_IDENTIFIER_TAKEN`.

### 2.5 Locks and the person lease

All locks are Redis leases: `SET key token NX PX ttl`, released by compare-and-delete, renewed by compare-and-pexpire. **Lock order** (D25/A2), outermost first:

**operation → tenant → slug → person → phone → uuid**

- Never take an outer lock while holding an inner one.
- The **person lease** is the only lock around a person's Keycloak read-modify-write, `_select`, revocation, provider `_unlink` and binding transitions. Every lane takes it through `src/modules/accounts/person-lease.ts` (`withPersonLease`, `currentPersonLease`), never with its own code.
  - `SET NX PX 30000`, renewed every 10 s; a caller waits at most 15 s, then gets 503 `IDENTITY_BUSY` with `Retry-After`.
  - Re-entry for the **same** person within one async chain is allowed. Taking a **different** person's lease while holding one throws.
  - The uuid lock and the phone lock are taken only **inside** a person lease.
  - Anonymous phone bootstrap first makes an advisory ownership lookup. With no owner it takes a prospective random-subject lease, then the normalized phone lock, and checks ownership again. If still unowned, it creates an opaque Keycloak user through the plain Admin API; it does not call actual-person writers, mirrors or revocation under the prospective lease. It releases both locks, then takes the actual owner's person lease and phone lock, checks ownership fresh, and creates the session. If an owner appeared, it releases both locks and retries under that owner instead. Distinct-person leases are never nested (accepted item 13 ruling).
- Writes made under the person lease are **fenced**: a Lua script checks that the lease token still matches before it writes. A lease lost mid-request answers 503 `IDENTITY_BUSY`, and a token minted under the lost lease is revoked before the error is returned.
- Key names are in §7.

## 3. Routes

**States** (from `src/contract/routes.ts`):
- **live:** built, and the code matches this contract;
- **changing:** built, but the listed items still change it;
- **planned:** not built yet.

| Method | Path | Auth | State | Items |
|---|---|---|---|---|
| GET | `/livez` | none | live | — |
| GET | `/readyz` | none | changing | 15 |
| GET | `/identity/v1/auth-methods` | none | changing | 1, 2 |
| GET | `/identity/v1/authorize` | none (session for `action`) | changing | 1, 4 |
| GET | `/identity/v1/callback` | login-attempt | changing | 4, 15 |
| GET | `/identity/v1/auth-results/:id` | none | live | — |
| POST | `/identity/v1/authentication/magic-link-requests` | none | live | — |
| POST | `/identity/v1/password/setup-requests` | none (optional session) | live | — |
| GET | `/identity/v1/password/setup-complete/:state` | login-attempt | live | — |
| GET | `/identity/v1/tenant-contexts/:urlSlug` | none | changing | 11, 15 |
| POST | `/identity/v1/citizen/otp/_send` | none (session for step-up and change) | changing | 3, 13 |
| POST | `/identity/v1/citizen/otp/_verify` | none (session for step-up and change) | changing | 13 |
| GET | `/identity/v1/session` | session | changing | 4, 9, 10, 15 |
| POST | `/identity/v1/logout` | session | changing | 4, 10 |
| GET | `/identity/v1/tenants` | session | changing | 8, 15 |
| POST | `/identity/v1/contexts/_select` | session | changing | 7, 8, 10, 12 |
| POST | `/identity/v1/contexts/citizen/_select` | session | changing | 10, 12, 13 |
| POST | `/identity/v1/workspace-members/_link` | session | live | 8, 9 |
| GET | `/identity/v1/workspace-members` | session | live | 9 |
| POST | `/identity/v1/workspace-members/_remove` | session | live | 9, 10 |
| POST | `/identity/v1/workspace-members/_updateEmail` | session | live | 9 |
| POST | `/identity/v1/workspace-invitations/_accept` | session | live | 9 |
| POST | `/identity/v1/workspace-invitations/_decline` | session | live | 9 |
| POST | `/identity/v1/account/providers/_unlink` | session | changing | 4 |
| POST | `/internal/identity/v1/sessions/_introspect` | introspection | live | 11 |
| POST | `/internal/identity/v1/identifiers/_check` | introspection | live | 11 |
| POST | `/internal/identity/v1/organizations/_ensure` | workload | live | 11 |
| POST | `/internal/identity/v1/organizations/_lifecycle` | workload | live | 11 |
| POST | `/internal/identity/v1/memberships/_ensure` | workload | live | 11, 14 |
| POST | `/internal/identity/v1/bindings/_ensure` | workload | live | 8, 11 |
| POST | `/internal/identity/v1/reconciliation/_run` | operator | live | 12 |

| POST | `/internal/identity/v1/account-links/_link` | operator | changing | 14 |
| POST | `/internal/identity/v1/account-links/_unlink` | operator | changing | 14 |
| GET | `/internal/identity/v1/account-links` | operator | changing | 14 |
| POST | `/internal/identity/v1/tenant-routes/_backfill` | operator | live | — |

**Dropped from the design:** `memberships/_remove` (D25/B9: a signup's founder can't change).

**Deleted by item 14:** `tenant-groups/_ensure` (D15) and `role-assignments/_ensure` (D1: roles come from DIGIT/HRMS, mirrored to Keycloak). Groups they created on existing boxes are still read until the Keycloak group clean-up. `tenant-routes/_backfill` stays (§3.5). There are no separate phone step-up or change routes (D25/B4: they use `citizen/otp/_send|_verify` with `purpose`).

Each route's possible error codes are listed in `src/contract/routes.ts`. The contract tests assert them.

### 3.1 Probes

**`GET /livez`** → `200 {status:"ok"}`. Process only.

**`GET /readyz`** (item 15) runs **every** check and reports each one:

```
200 | 503 {
  status: "ready" | "not_ready",
  checks: {
    redis: Check, jwks: Check, keycloakAdmin: Check, digit: Check,
    catalog: {configurator: Check, employee: Check, citizen: Check},
    poller: {status: Check, lagSeconds: number | null},
    reconcile: {status: Check, intervalSeconds: number, lagSeconds: number | null}
  }
}
Check = "ok" | "down" | "disabled"
```

- `digit` covers egov-user and MDMS.
- `disabled` is used for a surface without a configured client; it does not fail readiness.
- Poller lag above `IDENTITY_POLLER_MAX_LAG_SECONDS` makes the poller check `down`. A reconcile lag above twice the interval makes the reconcile check `down`.
- PGR is never a readiness dependency.

`GET /healthz` was removed by item 15. Use `/livez` for process liveness and `/readyz` for dependencies.

### 3.2 Browser, anonymous

#### 3.2.1 `GET /identity/v1/auth-methods` (items 1, 2)

Query: `surface` = a surface-registry key (`configurator` default, `employee`, `citizen`); `intent` = `signin` (default) | `signup`.

```
200 {methods: [{
  id: string,                        // "password", an IdP alias, "magic_link", "phone_otp", or "hosted:<id>"
  type: "password" | "idp" | "magic_link" | "phone_otp" | "hosted",
  labelKey: string,                  // IDENTITY_METHOD_<ID>: upper-case id, non-alphanumerics → "_"
  label?: string,                    // idp only: the IdP displayName
  idpHint?: string,                  // idp only
  intents: ("signin" | "signup")[]
}]}
```

- The method list is the surface client's `digit.auth.signin.methods` / `digit.auth.signup.methods` attribute, in order, filtered by live capability. A Keycloak-hosted authenticator is declared there as `hosted:<id>`.
- **Breaking:** `oauth` is renamed `idp` (item 2).
- A citizen surface without a configured or enabled client gives **`200 {methods: []}`**, not 503.
- Errors: `UNSUPPORTED_SURFACE` 400, `UNSUPPORTED_INTENT` 400, `SIGNIN_METHODS_UNAVAILABLE` 503 (a transient Admin API failure on a configured surface).

#### 3.2.2 `GET /identity/v1/authorize` (items 1, 4)

Starts Authorization Code + PKCE, answering `302` to Keycloak and setting the login cookie.

| Param | Rule |
|---|---|
| `surface` | Surface-registry key; default `configurator` |
| `intent` | `signin` (default) \| `signup`. Mutually exclusive with `action` |
| `tenantSlug` | Required for `employee` and `citizen`; forbidden for `configurator` |
| `returnTo` | Bound surfaces: the normalized path must start with `/{slug}/digit-ui/{surface}/`. Configurator: relative, or an allowlisted origin |
| `method` | A method id from `auth-methods`. `phone_otp` and `magic_link` are refused |
| `ui_locales` | ≤ 64 characters |
| `action` | `UPDATE_PASSWORD` \| `CONFIGURE_TOTP` \| `delete_credential` \| `UPDATE_EMAIL` \| `idp_link`. Allowed only if listed in the surface client's `digit.auth.account.actions`. Sent to Keycloak as `kc_action` |
| `credentialId` | Required with `delete_credential`: a **second-factor** credential (OTP or WebAuthn) of this person |
| `provider` | Required with `idp_link`: an enabled IdP not yet linked to this person |

- `prompt` comes from the surface registry entry, never a literal (item 1).
- An `action` needs a session on that surface. The attempt stores `{sid, sub, action}`, and the callback refuses a different `sub`.
- Errors: `INVALID_REQUEST`, `UNSUPPORTED_SURFACE`, `UNSUPPORTED_INTENT`, `UNSUPPORTED_METHOD`, `UNSUPPORTED_RETURN_TO`, `ACTION_NOT_ALLOWED` (all 400); `SESSION_REQUIRED` 401; `TENANT_ROUTE_NOT_FOUND` 404; `CREDENTIAL_NOT_SECOND_FACTOR`, `PROVIDER_ALREADY_LINKED` (409); `TENANT_ROUTE_UNAVAILABLE`, `SIGNIN_METHODS_UNAVAILABLE`, `IDENTITY_UNAVAILABLE` (503).

#### 3.2.3 `GET /identity/v1/callback` (items 4, 15)

The Keycloak redirect target. It always answers `303`: to `returnTo` on success, or to `returnTo?authResult=<id>` with one of `AUTH_CANCELLED`, `AUTH_ATTEMPT_EXPIRED`, `IDENTITY_PROVIDER_UNAVAILABLE`, `ACCOUNT_LINK_REQUIRED`, `ACCOUNT_LINK_FAILED`, `IDENTITY_ALREADY_LINKED`, `EMAIL_VERIFICATION_REQUIRED`, `SIGN_IN_FAILED`.

- **The callback never emits DIGIT-side codes** (D25/B5). Locked, inactive and pending-invitation outcomes appear at `_select`.
- **Action attempts:** `kc_action_status` = `success` | `cancelled` | `error` gives the results `ACTION_COMPLETE` | `ACTION_CANCELLED` | `ACTION_FAILED`. The **same** session's tokens are replaced (an update-only write); no new session is created.
- A new session records the person's current revocation generation and the Keycloak `sid` (§6).
- The discarded discovery call is removed (item 15).

#### 3.2.4 `GET /identity/v1/auth-results/:id`

One-time read (GETDEL).

```
200 {status: "failed" | "complete", code: ResultCode, actions: ("TRY_AGAIN" | "TRY_EXISTING_METHOD" | "SETUP_PASSWORD")[], message?: string}
404 {code: "AUTH_RESULT_NOT_FOUND", error}
```

- `status` is `complete` for `PASSWORD_SETUP_COMPLETE` and `ACTION_COMPLETE`, and `failed` otherwise.
- `message` is **deprecated** display text. It stays until both UIs localize by `code`, and then it is dropped.

#### 3.2.5 `POST /identity/v1/authentication/magic-link-requests`

Unchanged. Body `{email, firstName, lastName, returnTo?}`. Always `202 {message}`; existing, new, rate-limited and failed requests are indistinguishable. Errors: `INVALID_REQUEST`, `UNSUPPORTED_RETURN_TO` (400); `UNTRUSTED_ORIGIN` 403; `SIGNIN_METHODS_UNAVAILABLE` (the method catalogue can't be read), `SIGNUP_UNAVAILABLE` (magic link not enabled) (503).

#### 3.2.6 `POST /identity/v1/password/setup-requests` (item 5)

Body `{email?, returnTo?, surface?, tenantSlug?}`.

- `surface` defaults to `configurator`. It picks the Keycloak `client_id` of the setup email, so the action pages use that surface's theme, and setup-complete returns to that surface.
- On `employee` and `citizen`, `tenantSlug` is required, and `returnTo` is checked against the surface prefix exactly as in `/authorize`.
- A signed-in caller (the cookie of the chosen surface) may omit `email`.
- Always `202 {message}`, also when rate-limited. Errors: `INVALID_REQUEST`, `UNSUPPORTED_SURFACE`, `UNSUPPORTED_RETURN_TO` (400); `UNTRUSTED_ORIGIN` 403; `TENANT_ROUTE_NOT_FOUND` 404; `TENANT_ROUTE_UNAVAILABLE` 503.
- The same email is sent in-process by `workspace-members/_link` for a new user.

#### 3.2.7 `GET /identity/v1/password/setup-complete/:state`

Answers `303` to the attempt's `returnTo` with a result: `PASSWORD_SETUP_COMPLETE`, `PASSWORD_SETUP_FAILED` or `AUTH_ATTEMPT_EXPIRED`. It doesn't burn the state during an Admin API outage.

#### 3.2.8 `GET /identity/v1/tenant-contexts/:urlSlug` (items 11, 15)

```
200 {tenant: {urlSlug, tenantId, rootTenantId, parentTenantId: null, fallbackTenantIds: [], name}}
```

- `rootTenantId` = `tenantId`. `parentTenantId` and `fallbackTenantIds` are kept for compatibility, always `null` and `[]` (D16).
- `name` is the Organization `name`, which mirrors MDMS `tenant.tenants.name` (D21).
- An Organization in `PROVISIONING` or `FAILED` answers 404.
- `Cache-Control: public, max-age=60, stale-while-revalidate=300`.
- Errors: `TENANT_ROUTE_NOT_FOUND` 404, `TENANT_ROUTE_UNAVAILABLE` 503.

#### 3.2.9 `POST /identity/v1/citizen/otp/_send` (items 3, 13)

```
{tenantSlug?, mobileNumber, locale?, purpose?: "signin" | "stepup" | "change_phone"}
→ 202 {challengeId, expiresIn, resendAfter}
```

- `purpose` defaults to `signin`, and `signin` requires `tenantSlug`.
- `stepup` and `change_phone` need a citizen session and take the tenant from that session (`tenantSlug` is ignored).
- `mobileNumber` is national (`^\d{4,15}$`) and must pass the tenant's `MobileNumberValidation` rule.
- The challenge is bound to `(challengeId, phone, tenant, purpose)`, plus the session and person for `stepup` and `change_phone`.
- The answer does not depend on whether the number has an account, for any `purpose`. A `stepup` or `change_phone` code for a number another person owns is still sent (and charged to the send limits); `_verify` refuses it with 409 `PHONE_IN_USE`, checked under the phone lock.
- Delivery goes through `HttpOtpSender` (item 3, see below), or `log` on dev boxes.
- Errors: `INVALID_REQUEST`, `PHONE_OTP_DISABLED`, `INVALID_MOBILE_NUMBER` (400); `SESSION_REQUIRED` 401; `UNTRUSTED_ORIGIN` 403; `TENANT_ROUTE_NOT_FOUND` 404; `OTP_RESEND_TOO_SOON`, `OTP_RATE_LIMITED` (429, `Retry-After`); `TENANT_ROUTE_UNAVAILABLE`, `CITIZEN_SIGNIN_NOT_CONFIGURED`, `OTP_CHANNEL_UNAVAILABLE`, `IDENTITY_UNAVAILABLE` (503).

**`HttpOtpSender`** POSTs to `IDENTITY_OTP_SENDER_URL`:

```
{phone: "+<E.164>", code, purpose, tenantId, locale, expiresIn}
```

- 2xx = sent.
- 429 → `OTP_RATE_LIMITED`.
- Anything else, including a timeout → `OTP_CHANNEL_UNAVAILABLE`, and the challenge is dropped and the quota refunded.

#### 3.2.10 `POST /identity/v1/citizen/otp/_verify` (item 13)

```
{tenantSlug?, challengeId, code, purpose?}
signin       → 200 {authenticated: true, tenant: {urlSlug, tenantId}}  + Set-Cookie (citizen session)
stepup       → 200 {phoneNumber, phoneNumberVerified: true}
change_phone → 200 {phoneNumber, phoneNumberVerified: true}
```

- Identity resolution and creation run under the **phone lock** (§2.5).
- New phone identities get an **opaque** Keycloak username. Existing usernames stay, and lookup always follows the current verified phone (design §8).
- A **phone change** keeps the citizen account's uuid. It updates Keycloak, then DIGIT. It ends the person's other sessions that carry the old number.
- A new citizen without a given name gets the national mobile number as their DIGIT name (D17).
- Errors: `INVALID_REQUEST`, `PHONE_OTP_DISABLED`, `OTP_EXPIRED`, `OTP_INVALID` (+ `attemptsRemaining`) (400); `SESSION_REQUIRED` 401; `UNTRUSTED_ORIGIN`, `IDENTITY_DISABLED` (403); `TENANT_ROUTE_NOT_FOUND` 404; `IDENTITY_CONFLICT`, `PHONE_IN_USE` (409); `TENANT_ROUTE_UNAVAILABLE`, `IDENTITY_UNAVAILABLE` (503).

### 3.3 Browser, signed in

#### 3.3.1 `GET /identity/v1/session` (items 4, 9, 10, 15)

Query: `surface`; `include=account` (optional).

```
200 {
  authenticated: true,
  user: {id, email, name, preferredUsername, phoneNumber?, phoneNumberVerified?},
  context: {tenantId, name, organizationAlias} | null,
  surface?, tenant?: {urlSlug, tenantId, name} | null,        // employee and citizen surfaces
  pendingInvitations: [{tenantId, invitationVersion, name, invitedAt, expiresAt}],
  account?: {                                                // only with include=account
    actions: string[],                                      // the client's digit.auth.account.actions
    credentials: [{id, type, label}],
    providers: [{alias}]
  },
  sessions?: [{id, current, surface, createdAt, lastSeenAt}], // only with include=account
  expiresAt
}
401 {authenticated: false, code: "SESSION_REQUIRED" | "SESSION_REVOKED", error}
```

- `pendingInvitations` is on every staff surface (D25/B2) and `[]` for citizens. It is read without the person lease, and any failure reading it (Keycloak Admin unavailable or slower than 3 s, malformed `digit.bindings`) gives `[]`, never an error: the session read does not depend on it.
- `include=account` costs Keycloak Admin reads, so only the account menu asks for it (§1: the BFF is not called on a signed-in page load).
- Phone-only citizens get empty `account` arrays.
- A refresh failure caused by Keycloak being **unavailable** keeps the session. Only `invalid_grant` ends it (item 15).
- Errors: `UNSUPPORTED_SURFACE` 400, `IDENTITY_UNAVAILABLE` 503.

#### 3.3.2 `POST /identity/v1/logout` (items 4, 10)

Body or query `{surface, scope?: "current" | "others" | "all"}`, default `current` → **`204`**, and clears the cookie for `current` and `all`.

- `current`: ends this session and its Keycloak session, and revokes this session's DIGIT token claim.
- `others`: ends every **other** BFF and Keycloak session of the person. It skips DIGIT logout for accounts whose token is held by the current session; tokens used only by the ended sessions are revoked. See the shared-token limitation in §8.
- `all`: both, and raises the person's revocation generation (§6).
- Failed DIGIT logouts go on the revocation retry set. They never fail the request.
- The BFF session is deleted before Keycloak is called. Ending the Keycloak session is best-effort: the request waits at most 2 s for it, and one that fails or times out goes on the Keycloak logout retry set (§7.4). A Keycloak outage never fails the request.
- Errors: `INVALID_REQUEST`, `UNSUPPORTED_SURFACE` (400); `UNTRUSTED_ORIGIN` 403. A missing session is still `204`.

#### 3.3.3 `GET /identity/v1/tenants` (items 8, 15)

Configurator surface.

```
200 {tenants: [{organizationAlias, tenantId, name, roles: string[], code?: "DIGIT_ACCOUNT_INACTIVE"}], selectionRequired, onboardingRequired}
```

- It lists the `ACTIVE` Organizations where the staff predicate holds. The read is targeted from `digit.bindings` and memberships; it no longer probes every Organization (item 15).
- `roles` are the role codes of the mirrored `digit.accounts` entry.
- **Inactive staff** (DIGIT `active=false`) still see the tenant, with `code: "DIGIT_ACCOUNT_INACTIVE"`, and can't select it.
- Pending invitations are **not** listed here; they are in `/session`.
- Errors: `SESSION_REQUIRED` / `SESSION_REVOKED` 401, `DIGIT_UNAVAILABLE` / `IDENTITY_UNAVAILABLE` 503.

#### 3.3.4 `POST /identity/v1/contexts/_select` (items 6, 7, 8, 10, 12)

Body `{surface: "configurator" | "employee", tenantId}`. An employee's `tenantId` must equal the session's bound tenant.

```
200 {access_token, token_type: "bearer", expires_in, scope: "read", UserRequest: {...egov-user user...}}
```

**Order (design §6), all inside the person lease:**
1. Re-read the session. Gone → `SESSION_EXPIRED`; generation behind → `SESSION_REVOKED`.
2. The staff predicate and Organization `ACTIVE`, else `TENANT_CONTEXT_UNAVAILABLE`. A `pending` binding → `PENDING_INVITATION`. No binding (and no managed account until item 14), or no membership → `EMPLOYEE_ACCOUNT_NOT_LINKED`. An entry marked `missing` → `DIGIT_ACCOUNT_NOT_FOUND`.
3. DIGIT `active`, else `DIGIT_ACCOUNT_INACTIVE`.
4. Return the cached token if egov-user still accepts it. A dependency error is not treated as an invalid token.
5. Otherwise mint with the derived credential (§8). The typed login outcomes are:
   - invalid credentials → one repair per lease, then retry;
   - locked → `ACCOUNT_LOCKED`, no repair;
   - inactive → `DIGIT_ACCOUNT_INACTIVE`, no repair;
   - anything else → `DIGIT_UNAVAILABLE`.
6. Record the token in the inventory until its real expiry (§7).
7. Mirror DIGIT→Keycloak, and write the verified email Keycloak→DIGIT.

- The BFF never returns a refresh token (D25/B7). Clients call `_select` again on expiry.
- Errors: `INVALID_REQUEST`, `UNSUPPORTED_SURFACE` (400); `SESSION_REQUIRED`, `SESSION_EXPIRED`, `SESSION_REVOKED` (401); `UNTRUSTED_ORIGIN`, `TENANT_CONTEXT_UNAVAILABLE`, `EMPLOYEE_ACCOUNT_NOT_LINKED`, `PENDING_INVITATION`, `ACCOUNT_LOCKED`, `DIGIT_ACCOUNT_INACTIVE` (403); `DIGIT_ACCOUNT_NOT_FOUND` 404; `TENANT_ROLES_MISSING`, `DIGIT_PII_MASKED`, `DIGIT_ACCOUNT_INVALID`, `DIGIT_UNAVAILABLE`, `IDENTITY_UNAVAILABLE`, `IDENTITY_BUSY` (503).

#### 3.3.5 `POST /identity/v1/contexts/citizen/_select` (items 6, 10, 12, 13)

Body `{surface?: "citizen"}`. The tenant comes only from the session's bound tenant. The response is the `_select` shape plus `tenant: {urlSlug, tenantId}`.

- The same steps as staff `_select`, with the citizen predicate. Issuance is the egov-otp-backed citizen grant.
- Resolution: the `digit.accounts` citizen entry, then the citizen link, then a CITIZEN search by the verified phone. An ambiguous match → `CITIZEN_ACCOUNT_AMBIGUOUS`.
- The per-tenant registration `DISABLED` status is removed (D6). Blocking a citizen = disabling their Keycloak user.
- Errors: as staff `_select`, plus `PHONE_NOT_VERIFIED`, `CITIZEN_CONTEXT_UNAVAILABLE` (403); `CITIZEN_ACCOUNT_AMBIGUOUS`, `CITIZEN_ACCOUNT_LINK_BLOCKED` (409); `DIGIT_ACCOUNT_MISMATCH` 502; `CITIZEN_SIGNIN_NOT_CONFIGURED`, `ACCOUNT_LINK_BUSY` (503).

#### 3.3.6 `POST /identity/v1/workspace-members/_link` (items 8, 9)

Caller: a session with **live DIGIT `ACCOUNT_ADMIN`** at `tenantId` (D5), read live from egov-user and never from Keycloak.

```
{tenantId, digitUuid, email, reinvite?: boolean, resend?: boolean}
201 {binding: {subject, tenantId, digitUuid, state: "active", boundAt}, identityUserCreated: true, activationEmailSent: boolean}
200 {binding: {subject, tenantId, digitUuid, state: "pending" | "active", invitationVersion, expiresAt?}, identityUserCreated: false}
200 {binding, identityUserCreated: false, activationEmailSent: true, activationEmail: "password_setup" | "verify_email"}   (resend)
```

- `tenantId` must be the workspace tenant of an `ACTIVE` Organization (`WORKSPACE_TENANT_REQUIRED`). `digitUuid` must be an active EMPLOYEE account there and not a `kcbff-` account. `email` is required (D18) and is normalized by trimming and lower-casing.
- **Rules:**
  - binding yourself → `SELF_BINDING_FORBIDDEN`;
  - the account holds a checked role that the caller doesn't hold at that role's tenant or a tenant above it (a workspace role covers the workspace and its sub-tenants, never another root) → `ROLE_ESCALATION_FORBIDDEN`. Inside the workspace subtree only **administrative** roles are checked: the codes in `ADMINISTRATIVE_ROLES` (`src/contract/roles.ts`): `SUPERUSER`, `INTERNAL_MICROSERVICE_ROLE`, `SYSTEM`, `REINDEXING_ROLE`, `QA_AUTOMATION`; plus every other `*_ADMIN` code. Operational roles there (GRO, CSR, PGR_LME, SUPERVISOR, …) are not checked. Outside the subtree (another root, including a prefix-sharing one such as `pgx`) every role is checked, operational ones too, because the linked account's DIGIT token would carry it. A caller holding `SUPERUSER` at the tenant itself (the founder, D11) skips this check for target roles at the tenant or its sub-tenants, so may link an account with any role there; a target role outside the subtree is still checked. `_updateEmail` (§3.3.11) applies the same rule;
  - the uuid is bound to another person → `DIGIT_ACCOUNT_LINKED_ELSEWHERE`;
  - this person already has a different uuid at the tenant → `BINDING_CONFLICT`;
  - the person found by email is disabled in Keycloak → 403 `IDENTITY_DISABLED` (nothing is created or sent).
- **Find the person** by email, then by username = email. A username match with a different email → `IDENTITY_EMAIL_CHANGED`.
- **New person:**
  1. Create the user with `digit.linkPending` in the same POST.
  2. Add Organization membership.
  3. Create an `active` binding.
  4. Set the derived credential (§8).
  5. Send the password-setup email (surface client per item 5).
  6. Mirror, and clear the marker in the final PUT.

  Keycloak blocks any session until the password is set.
- **Existing person:** a `pending` binding with `invitationVersion` and `expiresAt` = now + the tenant's invitation expiry (D22, §5.2). No membership until `_accept`. The invitation appears in `/session`; the only email is Keycloak's `VERIFY_EMAIL` to an unverified invitee (`_accept` needs a verified email).
- **Repeats:**
  - The request id is `linkRequestId(caller, tenantId, digitUuid, email)` (`src/modules/bindings/link-request-id.ts`). Only a person whose `digit.linkPending.requestId` equals it resumes the new-user branch. Any other existing person takes the existing-user branch.
  - A repeat returns the current state. It never demotes `active` and never resurrects `removed`.
  - `reinvite: true` on a `pending` or `removed` key issues `invitationVersion + 1` with a fresh expiry, which makes the old version stale. On a `removed` key the re-invite may name a different uuid (the person's new DIGIT record). Without it, a `removed` key → `BINDING_REMOVED`.
- **Resend** (`resend: true`; not with `reinvite`): re-sends sign-in setup for the person found by `email` whose `pending` or `active` binding at `tenantId` is `digitUuid`. The binding is never changed, so a retry is safe.
  - The admin and target checks above apply. No person with that email, no binding at `tenantId`, a binding to another uuid, or a person whose email, read fresh under the lease, no longer equals `email` → `DIGIT_ACCOUNT_NOT_FOUND` (a username match whose email has changed → `IDENTITY_EMAIL_CHANGED`, as above); a `removed` (or expired) binding → `BINDING_REMOVED`; a disabled Keycloak user → 403 `IDENTITY_DISABLED` (nothing is sent).
  - Under the person lease, read fresh: if Keycloak still has `UPDATE_PASSWORD` pending, or the person has neither a password nor a linked provider, it sends the password-setup email (§3.2.6, with `VERIFY_EMAIL` when unverified) → `activationEmail: "password_setup"`. Else, if the email is unverified, it sends `VERIFY_EMAIL` → `"verify_email"`. Else → 409 `ACTIVATION_NOT_NEEDED` (nothing is sent; a pending invitee then accepts from `/session`).
  - At most one `resend` per binding (tenant + `digitUuid`) per 60 s (`{p}:identity:member-resend:{tenantId}:{uuid}`, §7.2); a repeat inside the window → 429 `RESEND_TOO_SOON` with `Retry-After`. The window is token-owned: a successful send lets it expire, and a failed send deletes it only if it is still that request's. The window covers `resend` only: a plain `_link` repeat for an unverified existing invitee re-sends `VERIFY_EMAIL` without it (above), and a person bound at several tenants has one window per tenant.
- **Locks:** person → uuid (resend: person only).
- Errors: as listed in `routes.ts`, including `BINDING_BUSY`, `IDENTITY_BUSY`, `DIGIT_UNAVAILABLE` and `IDENTITY_UNAVAILABLE` (503).

#### 3.3.7 `GET /identity/v1/workspace-members?tenantId=&first=&max=&state=` (item 9)

Caller: live `ACCOUNT_ADMIN` at `tenantId`. `first` defaults to 0, and `max` to 100 (at most 500). `state` is `active`, `pending` or `removed`; without it, `pending` and `active` are listed.

```
200 {members: [{subject, email?, name?, digitUuid, state: "active" | "pending" | "removed", invitationVersion,
                boundAt?, expiresAt?, removedAt?, digitActive?, roles?: [{code, tenantId}], missing?: true}],
     nextFirst?}
```

- `first`/`max` page the Keycloak search `q=digit.bindingTenants:<tenantId>&exact=true` (§5.1), so one request reads at most `max` users, whatever the realm size. Order is Keycloak's (username). The state filter applies after the page is read, so a page may hold fewer than `max` members: continue with `first = nextFirst` until `nextFirst` is absent.
- A binding written before `digit.bindingTenants` existed is listed once the next reconcile pass backfills the index. The backfill reads and writes only Keycloak and runs before the pass's DIGIT reads, so a DIGIT failure for that person doesn't skip it.
- Read-only: it takes no lease and writes nothing. An expired invitation is reported as `removed` (with `removedAt = expiresAt`); reconcile persists it later.
- No per-member DIGIT calls (only the caller's live `ACCOUNT_ADMIN` check). `digitActive`, `roles` and `missing: true` come from the person's `digit.accounts` staff entry for this tenant, which exists only for `active` bindings and is as fresh as the last mirror.
- **Only this tenant's data.** A person can be bound at several tenants and hold a citizen account, so the list never returns person-wide profile data to another tenant's admin:
  - `name` is the `name` of this tenant's `digit.accounts` staff entry: this tenant's DIGIT (HRMS) name as last mirrored (§5.1). It is absent for `pending` and `removed` members (no entry), and for an `active` member not yet re-mirrored or whose name came back masked. It is **never** the Keycloak `firstName`, which mirrors the D12 primary account at any tenant, or the citizen account. The console shows the HRMS name it already holds for the `digitUuid`.
  - `email` for an `active` member is the person's current Keycloak email (their sign-in address while they are a member here). For a `pending` or `removed` member it is the `digit.bindings` `email` recorded by `_link` for that invitation version (the address the invitation was issued to, or the address a later admin `_updateEmail` set), and absent when the record has none (`bindings/_ensure`, the item-19 conversion, and records written before the field existed). It is **never** the current email of someone who is not an active member here.
- Errors: `INVALID_REQUEST` 400; `SESSION_REQUIRED` / `SESSION_REVOKED` 401; `ADMIN_REQUIRED` 403; 503.

#### 3.3.8 `POST /identity/v1/workspace-members/_remove` (items 9, 10)

Caller: live `ACCOUNT_ADMIN` at `tenantId`. The configurator calls it right after the HRMS deactivation, as one action (D23).

```
{tenantId, digitUuid}
200 {removed: boolean, state: "removed"}
```

- For an `active` or `pending` binding: the binding becomes `removed`, the `digit.boundUuids` value is released, Organization membership is removed, the tokens are revoked, and every BFF session of the person ends.
- Idempotent: an unknown or already-removed binding gives `200 {removed: false, state: "removed"}`.
- Removing your own binding → `SELF_REMOVAL_FORBIDDEN`.
- **Locks:** person → uuid.

#### 3.3.9 `POST /identity/v1/workspace-invitations/_accept` (item 9)

```
?surface=configurator|employee   (optional; default configurator)
{tenantId, invitationVersion: integer}
200 {binding: {tenantId, digitUuid, state: "active", boundAt}}
```

- Bound to the signed-in person, on any staff surface (D25/B2). The optional `surface` query picks which surface's session cookie is read, so digit-ui can accept with the employee session. A citizen surface → 400 `UNSUPPORTED_SURFACE`.
- The binding must be `pending`, unexpired, and at that version. Otherwise → 409 `INVITATION_STALE`, which also covers "no invitation at all", so invitations can't be enumerated.
- The person's Keycloak email must be verified, read fresh from Keycloak, else 403 `INVITATION_EMAIL_UNVERIFIED`. An invitation is matched by email, so an unverified account carrying someone else's address must not be able to take their binding. Invitees verify by following the setup email.
- On success, under person → uuid: grant membership, make the binding `active`, set the derived credential, and mirror.
- A repeat on an already-`active` binding at the same version returns `200`.
- The inviter's authority is not re-checked at accept; the invitation was authorized when it was made.

#### 3.3.9a `POST /identity/v1/workspace-invitations/_decline` (item 9)

```
?surface=configurator|employee   (optional; default configurator)
{tenantId, invitationVersion: integer}
200 {declined: true}
```

- The invitee turns down their own invitation. Same session and surface rules as `_accept`. It acts only on the signed-in person's binding; there is no way to name anyone else.
- The binding must be `pending`, unexpired, and at that version. Otherwise → 409 `INVITATION_STALE` (also for "no invitation" and for an `active` binding: a member leaves through the admin's `_remove`).
- Under person → uuid the binding becomes `removed` with `removedBy: {kind: "browser", subject: <invitee>}`, which releases the uuid. A pending binding has no membership or token, so nothing is revoked. Then mirror, and audit `ACCOUNT_LINK_REVOKE` with `detail: "INVITATION_DECLINED"`.
- A repeat at the same version, after the invitee's own decline, returns `200`.
- The admin can invite again with `_link` `reinvite: true`.

#### 3.3.10 `POST /identity/v1/account/providers/_unlink` (item 4)

```
?surface=<surface>   (optional; default configurator)
{alias}
200 {providers: [{alias}]}
```

- The optional `surface` query picks which surface's session cookie is read. The surface must support self-service for the person's credential; otherwise → 400 `UNSUPPORTED_SURFACE`.

- The caller's own account, under the person lease. It reads the person's **primary** methods fresh: password, linked providers, and the verified phone for citizens. TOTP doesn't count.
- Removing the last one → 409 `LAST_SIGNIN_METHOD`. An alias that isn't linked → 404 `PROVIDER_NOT_LINKED`.

#### 3.3.11 `POST /identity/v1/workspace-members/_updateEmail` (item 9, D18)

Caller: live `ACCOUNT_ADMIN` at `tenantId`. For the case where an employee has lost access to their old address.

```
{tenantId, digitUuid, email}
202 {status: "verification_sent"}
```

- The target must have an `active` binding at `tenantId`; otherwise → 404 `DIGIT_ACCOUNT_NOT_FOUND`.
- The target must not be the caller; every target role at this tenant must be held by the caller; and the target must have no active binding or Organization membership in another workspace (including disabled workspaces). These checks use fresh reads under the target's person lease. A failed check → 403 `ADMIN_EMAIL_CHANGE_NOT_ALLOWED`. The person uses self-service `UPDATE_EMAIL`, or an operator performs global recovery.
- Under the target's person lease, the Keycloak email is set to the new address with `emailVerified=false`, the active binding's recorded `email` is set to it (so a later removal lists this address, §3.3.7), and Keycloak's `VERIFY_EMAIL` action email is sent. Username and `enabled` are untouched.
- DIGIT gets the new email only after the person verifies it (D18): the `VERIFY_EMAIL` event drives the write-through.
- An address another Keycloak user already holds → 409 `IDENTITY_EMAIL_CHANGED`.
- **Deferred (root, D18 scope):** notifying the old address about an email change, here or through self-service `UPDATE_EMAIL`, is not built in v1. Stock Keycloak doesn't send it, and custom Keycloak extensions are not allowed. Verification of the new address and "DIGIT only after verification" are unchanged and required.

### 3.4 Internal: PGR onboarding

Every mutation carries `{operationId, restartNo}`, and all of them follow §9. PGR's step order (design §5): tenant foundation → `PLATFORM_BASELINE` → founder via HRMS → `organizations/_ensure` → `memberships/_ensure` → `bindings/_ensure` → `_lifecycle ACTIVE`.

#### 3.4.1 `POST /internal/identity/v1/sessions/_introspect`

Forwards the configurator session cookie.

```
200 {active: true, identity: {issuer, subject, email, emailVerified, name, preferredUsername}}
401 {code: "SESSION_REQUIRED", error}
503 {code: "IDENTITY_UNAVAILABLE", error}   // the fresh Keycloak read failed; never reported as SESSION_REQUIRED
```

It takes no person lease, so it never answers `IDENTITY_BUSY`.

- `emailVerified` is new. PGR copies the founder's email into HRMS only when it is `true`.
- "Before `IDENTITY_READY` only" is a **PGR-side** rule: the BFF has no saga state to enforce it.

#### 3.4.2 `POST /internal/identity/v1/identifiers/_check` (item 11)

```
{identifiers: [{type, value}]}     // 1–20
→ 200 {results: [{type, value, available: boolean}]}   // request order
```

- `type` is one of `ORGANIZATION_NAME`, `ORGANIZATION_ALIAS`, `URL_SLUG`, `ACCOUNT_CODE`, `TENANT_ID`.
- Organization names compare using NFC, trimmed/collapsed whitespace, English-locale lowercase, then NFC again. The final NFC keeps lowercase expansions canonically equivalent; the response echoes the trimmed input value.
- The single form `{type, value}` → `{type, value, available}` is still accepted until PGR ships the batched call.
- The check is advisory. Real uniqueness comes from the slug and tenant locks in `organizations/_ensure`.

#### 3.4.3 `POST /internal/identity/v1/organizations/_ensure` (item 11)

```
{operationId, restartNo, tenantId, slug, name}
200 {organization: {id, alias, urlSlug, tenantId, name, lifecycle, operationId, restartNo}, created: boolean}
```

- There is no separate root-tenant field (D25/A6): the root tenant always equals `tenantId`.
- **Locks:** operation → tenant → slug. Every onboarding mutation (`_ensure`, `_lifecycle`, `memberships/_ensure`, `bindings/_ensure`) answers 503 `IDENTITY_BUSY` with `Retry-After` when one of its locks can't be taken in time.
- The DIGIT tenant must exist, else `TENANT_FOUNDATION_MISSING`.
- Outcomes (§9): same attempt and same hash → the existing Organization; same `restartNo` with a different hash → `OPERATION_CONFLICT`; a lower `restartNo` → `ATTEMPT_STALE`; the slug or tenant held by another operation → `SLUG_TAKEN` / `TENANT_TAKEN`.

#### 3.4.4 `POST /internal/identity/v1/organizations/_lifecycle` (item 11)

```
{operationId, restartNo, state: "ACTIVE" | "FAILED"}
200 {organization: {id, tenantId, lifecycle, restartNo}}
```

- `PROVISIONING → ACTIVE | FAILED`, for the current `restartNo` only. Repeating the recorded transition → 200.
- Other transitions → `LIFECYCLE_CONFLICT`. A lower `restartNo` → `ATTEMPT_STALE`. An unknown operation → `OPERATION_NOT_FOUND`.
- Moving to `FAILED` (or disabling an Organization) revokes its members' tokens.

#### 3.4.5 `POST /internal/identity/v1/memberships/_ensure` (items 11, 14)

```
{operationId, restartNo, subject, tenantId}
200 {tenantId, subject, member: true}
```

Organization membership **only**, and idempotent. The role projection and the managed-account creation are removed (item 14). Errors: `ATTEMPT_STALE`, `OPERATION_NOT_FOUND`, `IDENTITY_NOT_FOUND`.

#### 3.4.6 `POST /internal/identity/v1/bindings/_ensure` (items 8, 11)

```
{operationId, restartNo, subject, tenantId, digitUuid}
200 {binding: {subject, tenantId, digitUuid, state: "active", boundAt}, created: boolean}
```

- The founder binding, `active` at once.
- The browser actor rules are skipped, but uuid uniqueness still applies.
- **No DIGIT write.** The founder's credential is set at their first `_select` (D25/B8).
- A `removed` binding for the same key is never revived by the workload: it answers `BINDING_CONFLICT` (browser `_link` uses `BINDING_REMOVED` and `reinvite`).
- The same key with a different uuid → `BINDING_CONFLICT`. A uuid bound to another person → `DIGIT_ACCOUNT_LINKED_ELSEWHERE`.
- **Locks:** operation → person → uuid.

### 3.5 Internal: operator

- **`POST /internal/identity/v1/reconciliation/_run`** (item 12) → `200 | 202 {acquired, subjects, mirrored, revoked, propagated, unchanged, failures: [{subject, code}], lagSeconds}`. It **never** writes DIGIT `active`, and never creates or restores a membership or binding. `deactivated` and `unprovisioned` are removed.
- **`account-links/_link`, `_unlink`, `GET account-links`** keep today's shapes. After item 14 they accept `userType: "CITIZEN"` only, and `EMPLOYEE` → `INVALID_REQUEST`. They are how an admin resolves `CITIZEN_ACCOUNT_AMBIGUOUS`. Until item 14, an `EMPLOYEE` link writes an `active` binding (item 19 runs the bulk conversion).
- **`POST /internal/identity/v1/tenant-routes/_backfill`** `{dryRun?: boolean, actor?: string}` → `200 {created: [tenantId], skipped: [{tenantId, reason: NOT_ROOT | NOT_ACTIVE | ALREADY_MAPPED}], conflicts: [{tenantId, reason: INVALID_SLUG | SLUG_TAKEN | ALIAS_TAKEN}]}`. It gives every active DIGIT root tenant in `IDENTITY_TENANT_ROUTE_BACKFILL_ROOTS` (default: the root of `DIGIT_ADMIN_TENANT_ID`) that no Organization maps an Organization whose alias and URL slug are the tenant id (`ke` → `/ke/digit-ui/...`). Idempotent; it never renames or overwrites a mapping. `IDENTITY_TENANT_ROUTE_BACKFILL=true` runs the same backfill at startup. It is kept after item 14 because it is the only way a root tenant that predates signup gets a route; signup's `organizations/_ensure` covers new tenants. Keycloak or DIGIT failures → `IDENTITY_UNAVAILABLE` / `DIGIT_UNAVAILABLE`.

### 3.6 Console employee flows

The console calls HRMS first, then the BFF. The BFF never writes HRMS (§1), and each BFF call is safe to repeat with the same body, so recovery from a partial failure is always "retry the BFF call", never "undo HRMS".

- **Add:** HRMS `_create` → `_link {tenantId, digitUuid, email}`. A new person gets an `active` binding and the setup email (201); an existing person gets a `pending` invitation (200). If `_link` fails, retry it with the same body (the request id resumes, §9.2). An HRMS employee with no binding can't sign in, so an abandoned add is harmless.
- **Edit name:** HRMS `_update` only. The mirror copies the name into Keycloak on the next reconcile or sign-in.
- **Edit email:** `_updateEmail` only (active bindings; D18). Don't write the email to HRMS: the BFF writes it to DIGIT after the person verifies it. For a `pending` member, `_remove` and `_link` again with the new address.
- **Remove (D23):** HRMS deactivate → `_remove`. Deactivating first cuts access at once (access needs DIGIT `active`, and reconcile revokes `DIGIT_INACTIVE` tokens) even if `_remove` then fails; retry `_remove`, which is idempotent. If the HRMS call fails, stop: nothing changed.
- **Reinvite:** HRMS reactivate → `_link {reinvite: true}`. Without the reactivation, `_link` → `DIGIT_ACCOUNT_NOT_FOUND`. The result is a new `pending` invitation the person accepts from `/session`. If `_link` fails, retry it; to abandon, deactivate in HRMS again.
- **Resend:** `_link {resend: true}` only; no HRMS call. `ACTIVATION_NOT_NEEDED`: the member is already set up (a pending one accepts from `/session`). `RESEND_TOO_SOON`: wait `Retry-After`. `DIGIT_ACCOUNT_NOT_FOUND` for a known member: the employee is inactive in HRMS.

## 4. Error codes

`src/contract/error-codes.ts` is the source; `tests/contract/catalogue.test.ts` fails if this table differs from it. "result" = delivered only through `auth-results`. Retry: **yes** = retry with back-off; **no** = don't; **after-change** = only after the named condition changes.

| Code | HTTP | Retry | Meaning |
|---|---|---|---|
| `AUTH_CANCELLED` | result | no | The person cancelled at Keycloak |
| `AUTH_ATTEMPT_EXPIRED` | result | no | The sign-in or setup attempt is missing, expired or already used |
| `IDENTITY_PROVIDER_UNAVAILABLE` | result | yes | The external identity provider failed |
| `ACCOUNT_LINK_REQUIRED` | result | after-change | The provider's email already belongs to an existing account |
| `ACCOUNT_LINK_FAILED` | result | after-change | Keycloak could not link the provider identity |
| `IDENTITY_ALREADY_LINKED` | result | no | That provider identity is linked to another person |
| `EMAIL_VERIFICATION_REQUIRED` | result | after-change | The existing account's email is not verified |
| `SIGN_IN_FAILED` | result | yes | Generic callback failure (cookie mismatch, token check) |
| `PASSWORD_SETUP_COMPLETE` | result | no | Password setup finished (status complete) |
| `PASSWORD_SETUP_FAILED` | result | after-change | The setup link was used but no password exists |
| `ACTION_COMPLETE` | result | no | A Keycloak account action finished (status complete) |
| `ACTION_CANCELLED` | result | no | The person cancelled a Keycloak account action |
| `ACTION_FAILED` | result | yes | A Keycloak account action failed |
| `INVALID_REQUEST` | 400 | no | Malformed body or query |
| `UNTRUSTED_ORIGIN` | 403 | no | The Origin header is not allowlisted |
| `UNSUPPORTED_SURFACE` | 400 | no | Unknown surface |
| `UNSUPPORTED_INTENT` | 400 | no | Unknown intent, or an intent the surface does not offer |
| `UNSUPPORTED_METHOD` | 400 | no | Unknown or disabled sign-in method |
| `UNSUPPORTED_RETURN_TO` | 400 | no | returnTo is not allowed for this surface |
| `AUTH_RESULT_NOT_FOUND` | 404 | no | The sign-in result was already read or has expired |
| `SIGNIN_METHODS_UNAVAILABLE` | 503 | yes | The Keycloak client's method catalogue can't be read |
| `SIGNUP_UNAVAILABLE` | 503 | after-change | Self sign-up (magic link) is not enabled |
| `ACTION_NOT_ALLOWED` | 400 | no | The action is not in the client's digit.auth.account.actions |
| `CREDENTIAL_NOT_SECOND_FACTOR` | 409 | no | delete_credential targets a primary credential |
| `PROVIDER_ALREADY_LINKED` | 409 | no | idp_link for a provider that is already linked |
| `PROVIDER_NOT_LINKED` | 404 | no | _unlink for a provider that is not linked |
| `LAST_SIGNIN_METHOD` | 409 | after-change | It would remove the person's last primary sign-in method |
| `TENANT_ROUTE_NOT_FOUND` | 404 | no | Slug unmapped, tenant inactive, or Organization not ACTIVE |
| `TENANT_ROUTE_UNAVAILABLE` | 503 | yes | Keycloak or DIGIT failed while resolving the slug |
| `SESSION_REQUIRED` | 401 | no | No valid session cookie for this surface |
| `SESSION_EXPIRED` | 401 | no | The session ended during the request |
| `SESSION_REVOKED` | 401 | no | The session was signed out (logout-all, credential change, revocation) |
| `IDENTITY_BUSY` | 503 | yes | A lease (person, operation, tenant or slug) is held or was lost mid-request; Retry-After is set |
| `TENANT_CONTEXT_UNAVAILABLE` | 403 | no | The tenant is not selectable for this session |
| `EMPLOYEE_ACCOUNT_NOT_LINKED` | 403 | after-change | No active binding or no Organization membership at the tenant (D10) |
| `PENDING_INVITATION` | 403 | after-change | The binding at this tenant is pending; accept the invitation first |
| `ACCOUNT_LOCKED` | 403 | after-change | egov-user reports the DIGIT account locked; no credential repair |
| `DIGIT_ACCOUNT_INACTIVE` | 403 | after-change | The DIGIT account is inactive (D4); reactivate it in HRMS |
| `TENANT_ROLES_MISSING` | 503 | after-change | egov-user INVALID_ROLE: the tenant baseline is not seeded |
| `DIGIT_PII_MASKED` | 503 | after-change | The DIGIT writer refused a write because a read came back masked |
| `DIGIT_ACCOUNT_INVALID` | 503 | after-change | egov-user rejected a stored field on read-modify-write |
| `DIGIT_UNAVAILABLE` | 503 | yes | egov-user or MDMS failed, or returned an unparseable error |
| `IDENTITY_UNAVAILABLE` | 503 | yes | The Keycloak Admin API failed |
| `PHONE_OTP_DISABLED` | 400 | no | Phone sign-in is not enabled for the citizen surface |
| `CITIZEN_SIGNIN_NOT_CONFIGURED` | 503 | after-change | The tenant has no MobileNumberValidation rule |
| `INVALID_MOBILE_NUMBER` | 400 | no | The number fails the tenant's mobile rule |
| `OTP_RESEND_TOO_SOON` | 429 | after-change | Per-phone cooldown; Retry-After is set |
| `OTP_RATE_LIMITED` | 429 | after-change | Per-phone or per-IP quota, or the OTP channel rate-limited; Retry-After is set |
| `OTP_CHANNEL_UNAVAILABLE` | 503 | yes | The OTP sender failed; the challenge was dropped and quota refunded |
| `OTP_INVALID` | 400 | after-change | Wrong code; attemptsRemaining is set |
| `OTP_EXPIRED` | 400 | no | The challenge is missing, expired, used up, or for another route or purpose |
| `IDENTITY_DISABLED` | 403 | no | The Keycloak user is disabled: the phone's (D6), or a _link target |
| `IDENTITY_CONFLICT` | 409 | no | Two verified Keycloak users hold the phone |
| `PHONE_IN_USE` | 409 | no | Another person owns the phone (step-up or change) |
| `PHONE_NOT_VERIFIED` | 403 | after-change | The citizen session has no verified phone |
| `CITIZEN_CONTEXT_UNAVAILABLE` | 403 | no | Wrong client, inactive tenant, or unusable number for citizen _select |
| `CITIZEN_ACCOUNT_AMBIGUOUS` | 409 | after-change | More than one legacy CITIZEN uses the number; an admin links one |
| `CITIZEN_ACCOUNT_LINK_BLOCKED` | 409 | after-change | An admin removed this phone link with block |
| `DIGIT_ACCOUNT_MISMATCH` | 502 | no | egov-user returned the wrong account type or tenant |
| `ADMIN_EMAIL_CHANGE_NOT_ALLOWED` | 403 | no | Tenant admin cannot change this global identity email; use UPDATE_EMAIL or operator global recovery |
| `ADMIN_REQUIRED` | 403 | no | The caller lacks live DIGIT ACCOUNT_ADMIN at the tenant (D5) |
| `SELF_BINDING_FORBIDDEN` | 403 | no | A browser caller tried to bind themselves |
| `ROLE_ESCALATION_FORBIDDEN` | 403 | no | The target account holds an administrative role the caller lacks |
| `SELF_REMOVAL_FORBIDDEN` | 409 | no | An admin tried to remove their own binding |
| `BINDING_REMOVED` | 409 | after-change | The binding is removed; send reinvite:true to invite again |
| `BINDING_CONFLICT` | 409 | no | This person already has a different DIGIT account at the tenant |
| `BINDING_BUSY` | 503 | yes | The DIGIT-account (uuid) lock wait timed out; Retry-After is set |
| `ACTIVATION_NOT_NEEDED` | 409 | no | _link resend: the member already has a sign-in method and a verified email |
| `RESEND_TOO_SOON` | 429 | after-change | _link resend: per-member cooldown; Retry-After is set |
| `INVITATION_STALE` | 409 | no | The invitation was removed, replaced, expired or never existed |
| `INVITATION_EMAIL_UNVERIFIED` | 403 | after-change | The accepting account's email is not verified in Keycloak |
| `IDENTITY_EMAIL_CHANGED` | 409 | after-change | A Keycloak user matches by username but its email has changed |
| `WORKSPACE_TENANT_REQUIRED` | 400 | no | The tenant is not a workspace (Organization) tenant (D16) |
| `DIGIT_ACCOUNT_NOT_FOUND` | 404 | after-change | No active DIGIT account matches, or the bound account has disappeared |
| `DIGIT_ACCOUNT_LINKED_ELSEWHERE` | 409 | no | The DIGIT account is bound to another person |
| `DIGIT_ACCOUNT_MANAGED` | 409 | no | A kcbff- managed account cannot be bound |
| `SUBJECT_ALREADY_LINKED` | 409 | no | The person already has a link of that type at the tenant |
| `ACCOUNT_LINK_BUSY` | 503 | yes | The account-link lock wait timed out (citizen links) |
| `TENANT_NOT_FOUND` | 404 | no | Unknown or inactive DIGIT tenant |
| `IDENTITY_NOT_FOUND` | 404 | no | No enabled Keycloak user with that subject |
| `WORKLOAD_UNAUTHORIZED` | 401 | no | Missing or wrong bearer token for this internal route |
| `CONTROL_PLANE_NOT_CONFIGURED` | 503 | after-change | The token for this internal route is not configured |
| `ATTEMPT_STALE` | 409 | no | restartNo is lower than the one recorded for the operation |
| `OPERATION_CONFLICT` | 409 | no | Same operationId and restartNo with a different payload hash |
| `OPERATION_NOT_FOUND` | 404 | after-change | No Organization carries this operationId; call organizations/_ensure first |
| `SLUG_TAKEN` | 409 | no | Another operation or Organization holds the slug |
| `TENANT_TAKEN` | 409 | no | Another operation or Organization holds the tenant id |
| `LIFECYCLE_CONFLICT` | 409 | no | The transition conflicts with the recorded lifecycle |
| `TENANT_FOUNDATION_MISSING` | 409 | after-change | The DIGIT tenant does not exist yet |

**Naming decisions:**
- The design's "`ACCOUNT_INACTIVE`" is sent as **`DIGIT_ACCOUNT_INACTIVE`**, the name that exists today (walkthrough B5).
- Per-item outcomes of `account-links/_link` (`LINKED`, `ALREADY_LINKED`, `REFUSED`), backfill reasons and audit event names are enums, not error codes.

## 5. Keycloak state

### 5.1 User attributes

All `digit.*` user attributes are **admin-only**: `keycloak/realm.json` declares each one the BFF writes in the user profile, with view and edit for `admin` only, and `configure-keycloak.sh` applies the declarations to new and existing realms on every run. An undeclared attribute stays admin-only through `unmanagedAttributePolicy: ADMIN_EDIT`.

They are declared for their length limit too. Keycloak caps each value of an undeclared attribute at 2048 characters, which `digit.bindings` and `digit.accounts` outgrow after a few records. The declared limits per value are 65536 for `digit.bindings` and 4194304 for `digit.accounts`, enough for 64 records of the largest shape the schemas allow. The other attributes keep 2048. The reasoning is in the realm's `userProfile.$comment`, and `tests/unit/keycloak-user-profile.test.ts` fails when an attribute in the code is not declared. If Keycloak still refuses a `digit.*` value as too long (400 `error-invalid-length`), the BFF logs the attribute and the realm fix, and answers `IDENTITY_UNAVAILABLE` (503).

Every write follows the safe writer rule (design §4):
- read the user fresh just before the PUT, under the person lease;
- send `attributes` (and the mirrored name);
- **preserve** the freshly read `email`, `emailVerified`, `username` and other profile fields;
- **never** send `enabled`.

| Attribute | Value | Written by | Schema |
|---|---|---|---|
| `digit.accounts` | one JSON value, v1 | the sync module (mirror); the credential writer (`credential`) | `docs/contract/schemas/digit.accounts.v1.schema.json` |
| `digit.bindings` | one JSON value, v1 | the binding service | `docs/contract/schemas/digit.bindings.v1.schema.json` |
| `digit.boundUuids` | many values `<tenantId>\|<uuid>` | the binding service, in the **same PUT** as `digit.bindings` | `docs/contract/schemas/digit.boundUuids.schema.json` |
| `digit.bindingTenants` | many values: the `tenantId` of every `digit.bindings` record, `removed` included | the binding service, in the **same PUT** as `digit.bindings`; reconcile backfills users written before it existed | `docs/contract/schemas/digit.bindingTenants.schema.json` |
| `digit.linkPending` | one JSON value, v1 | `_link`, inside the user-create POST; cleared by its final PUT | `docs/contract/schemas/digit.linkPending.v1.schema.json` |
| `digit.accountLinkBlocks` | today's encoding, CITIZEN values only | internal citizen unlink | — |
| `digit.identityBffSignup`, `digit.identityBffPhoneOtp` | `["true"]` | as today | — |
| `phoneNumber`, `phoneNumberVerified` | E.164; `"true"` | BFF phone flows only. An IdP never sets a verified phone (D19) | — |
| `firstName` / `lastName` | the whole DIGIT name / `""` | the mirror, from the D12 primary entry (D17). User-read-only in the realm; `lastName` not required | — |

**Retired** (removed by the lane that replaces each one): `digit.managedTenants` (item 14), `digit.citizenRegistrations` (folded into citizen entries of `digit.accounts`), `digit.accountLinks` (item 19 converts EMPLOYEE links to bindings, and CITIZEN links to citizen entries), `digit.identityBffInvited` (replaced by `digit.linkPending`).

**`digit.accounts` invariants** (enforced in code, not expressible in the schema):
- `(tenantId, uuid)` is unique among entries.
- At most **one** `staff` entry per `tenantId`, and only for a binding in state `active`. When a binding leaves `active`, its entry is dropped.
- At most one `citizen` entry per `tenantId`.
- The **D12 primary entry** is the `staff` entry with the lowest `boundAt` among those with `active: true`. With no such staff entry, it is the citizen entry with the lowest `boundAt`. Staff entries always win (D25/C1).
- A DIGIT account that disappears gets `missing: true`. The entry is never silently dropped.
- A `staff` entry's `name` is the DIGIT name of **that** tenant's account, set on each mirror (dropped when DIGIT returns it empty or masked; kept while `missing`). `citizen` entries never carry `name`. Tenant-scoped readers (the member list, §3.3.7) use it instead of `firstName`.
- The mirror never invents an entry. Entries follow `digit.bindings` (staff) and resolved citizen accounts.

**`digit.bindings` transitions.** The key is `(person, tenantId)`, with at most one record per key, and the record itself is the tombstone. Every transition happens under person → uuid. A record written by `_link` carries the normalized address it was issued to (`email`); `_accept`, `_remove` and expiry keep it, a re-invite replaces it, and an admin `_updateEmail` (§3.3.11) replaces it with the new address on the active record.

| From → to | Trigger | Guard |
|---|---|---|
| none → `active` | `_link` (new person); `bindings/_ensure`; item-19 conversion | uuid unowned (`digit.boundUuids` exact search); browser actor rules |
| none → `pending` (v1) | `_link` (existing person) | the same |
| `pending` → `active` | `_accept` by the bound person | version equal and not expired, else `INVITATION_STALE` |
| `pending` / `active` → `removed` | `_remove`; operator unlink (until item 14) | releases the uuid, removes membership, revokes |
| `pending` → `removed` | `_decline` by the bound person | version equal and not expired, else `INVITATION_STALE`; releases the uuid |
| `pending` → `removed` | expiry (`removedBy.kind = "expiry"`), written by reconcile, or lazily by the next reader | releases the uuid |
| `pending` / `removed` → `pending` (v+1) | `_link` with `reinvite: true` | uuid unowned |
| `active` → `pending` | **never** | — |

A pending binding past `expiresAt` counts as `removed` everywhere, even before anything rewrites it.

### 5.2 Invitation expiry (MDMS, D22)

| | |
|---|---|
| Schema code | `identity.invitationPolicy` |
| Record | one per tenant, unique id `default` |
| Field | `invitationExpiryHours`: integer, 1 to 2160 (1 hour to 90 days) |
| Default | 336 (14 days), used when the record is absent or out of range |
| Written by | PGR seeds it at onboarding; the configurator edits it (whole hours) |
| Read by | the BFF binding service, at `_link` and re-invite |

### 5.3 Organization attributes

| Attribute | Value | Notes |
|---|---|---|
| `digit.rootTenantId` | the tenant id | Kept for routing. Always equals the `_ensure` `tenantId` |
| `digit.urlSlug` | the slug, lower-case | Equals the Organization `alias` |
| `digit.operationId` | the PGR operation id | The re-open match key |
| `digit.restartNo` | integer, as a string | §9 |
| `digit.operationHash` | 64 hex characters | §9 |
| `digit.lifecycle` | `PROVISIONING` \| `ACTIVE` \| `FAILED` | **Absent = `ACTIVE`** |
| `digit.lifecycleRestartNo` | integer, as a string | The `restartNo` the lifecycle was set at, so a repeated `_lifecycle` call is recognized |
| `digit.supersededBy` | Organization id | On a `FAILED` Organization replaced after a slug change |
| `digit.replacementPending` | single JSON value `{restartNo,operationHash,tenantId,slug,name}` | Durable changed-slug attempt, written before changing the old Organization and cleared after supersession finishes (§9.3) |
| `digit.accountCode`, `digit.fallbackTenantIds` | as today | Read-only legacy; not written by new code |

- The Organization `name` mirrors MDMS `tenant.tenants.name` (D21). The BFF updates it on rename (reconcile).
- Organization **names and aliases are unique in the realm**. When a slug change creates a new Organization, the old one is renamed `<name> [failed <first 8 characters of its id>]` before the create.
- The visibility filter (lifecycle absent or `ACTIVE`, and enabled) runs **before** tenant-collision detection.

### 5.4 Client attributes

| Attribute | Clients | Value |
|---|---|---|
| `digit.auth.surface` | each surface client | The surface-registry key (item 1) |
| `digit.auth.signin.methods`, `digit.auth.signup.methods` | each surface client | CSV of method ids in display order: `password`, IdP aliases, `magic_link`, `phone_otp`, `hosted:<id>`. `""` = none |
| `digit.auth.account.actions` | each surface client | CSV subset of `UPDATE_PASSWORD,CONFIGURE_TOTP,delete_credential,UPDATE_EMAIL,idp_link`. Absent = none |

## 6. Sessions

**Session record** `{p}:identity:session:{sid}`, `schemaVersion: 2`. It contains today's fields (`claims`, `oidcClientId`, Keycloak tokens and expiries, `surface`, `boundTenant`, `authMethod`, `identityCheckedAt`) plus:

| Field | Set | Use |
|---|---|---|
| `revocationGeneration` | at create, from `{p}:identity:revgen:{sub}` (absent = 0) | Compared on every read and in `_select`. Behind → `SESSION_REVOKED` |
| `kcSessionId` | at create and refresh, from the token's `sid` | Matches Keycloak events to this session (§10) |
| `phoneRef` | citizen sessions | `privateRef("phone", e164)`. Ends "sessions carrying the old number" on a phone change |
| `createdAt`, `lastSeenAt` | at create; at touch (at most once a minute) | `GET /session` `sessions[]` |
| `authTime` | at create and refresh, from the access token's `auth_time` (seconds) × 1000; a refresh without the claim keeps the stored value | Which sessions a credential change ends (§10). Keycloak's clock, like the event's `time`; `createdAt` (BFF clock, code-exchange time) is never used for this |

**Write rules:**
- create: `SET … NX EX`;
- refresh: `SET … XX EX`, keeping the generation it **re-read**;
- touch: `SET … XX KEEPTTL`.

A `nil` reply means the session was revoked: answer 401 and never recreate it. A record without `schemaVersion` counts as version 1 and gets generation 0.

**Per-person session index** `{p}:identity:person-sessions:{sub}` (a SET of session ids) lets `logout {scope}`, `_remove`, phone change and `GET /session` find a person's sessions.

## 7. Redis keyspace

`{p}` = `CACHE_PREFIX` (default `keycloak`). Every family is one of (design §0):
- **R**: re-derivable, rebuilt from Keycloak or DIGIT;
- **S**: restartable, so losing it only means signing in again, resending an OTP or retrying a request, and leases simply expire;
- **L**: a documented limit, where some tokens live until they expire (design §6).

`phoneRef`, `ipRef` and `sessionRef` are HMACs (`privateRef`), so raw phone numbers and IPs never appear in key names.

### 7.1 Leases (lock order: operation → tenant → slug → person → phone → uuid)

| Pattern | TTL | Notes | Tag |
|---|---|---|---|
| `{p}:identity:op-lock:{operationId}` | 60 s, renewed | Every onboarding primitive; validation **and** mutation inside it | S |
| `{p}:identity:tenant-lock:{tenantId}` | 60 s | `organizations/_ensure` | S |
| `{p}:identity:slug-lock:{slug}` | 60 s | `organizations/_ensure` | S |
| `{p}:identity:subject-lease:{sub}` | 30 s, renewed every 10 s; wait ≤ 15 s | The person lease (§2.5). Replaces `{p}:identity:user-attributes-lease:{userId}` and `{p}:digit-user-lease:{identityKey}`. Fences inventory and session writes | S |
| `{p}:identity:phone-lock:{phoneRef}` | 30 s | Phone sign-in resolution, step-up and change; inside the person lease | S |
| `{p}:identity:uuid-lock:{tenantId}:{uuid}` | 30 s; wait ≤ 15 s | Binding create, accept and remove; inside the person lease. Replaces `{p}:account-link-lease:{digitUuid}` | S |
| `{p}:identity-reconciliation-lease` | 300 s, renewed | One reconcile run at a time (unchanged) | S |
| `{p}:identity:kc-events:lease` | 60 s, renewed | One active event poller | S |

### 7.2 Sessions and sign-in

| Pattern | Value | TTL | Tag |
|---|---|---|---|
| `{p}:identity:login:{state}` | login attempt JSON (+ `action`, `actionParam`, `initiatingSessionId`) | `IDENTITY_LOGIN_TTL_SECONDS` (1800) | S |
| `{p}:identity:session:{sid}` | session record (§6) | ≤ `IDENTITY_SESSION_TTL_SECONDS` | S |
| `{p}:identity:person-sessions:{sub}` | SET of sid | the longest session TTL, refreshed on add | S |
| `{p}:identity:kc-session:{kcSessionId}` | the subject whose session carries this Keycloak `sid`; written with the session record. A Keycloak session event (`USER_SESSION` DELETE) resolves its person here, then from the event's `userId`, and only then by scanning the realm | at least the session's TTL, extended on write | S |
| `{p}:identity:revgen:{sub}` | integer | none. A few bytes per person who ever had logout-all | S |
| `{p}:identity:context:{sid}` | the selected context, + `digitUuid` | the session's remaining TTL; `XX`-guarded | S |
| `{p}:identity:auth-result:{id}` | result JSON | 300 s | S |
| `{p}:identity:password-setup:{id}` | setup attempt JSON (`returnTo` already holds the surface's path) | 2700 s | S |
| `{p}:identity:magic-link-signup-limit:{ip\|email}:{ref}` | counter | 1800 s | S |
| `{p}:identity:password-setup-limit:{ip\|account}:{ref}` | counter | 900 s | S |
| `{p}:identity:member-resend:{tenantId}:{uuid}` | random token (`_link` resend cooldown, `SET NX`; compare-and-delete on a failed send) | 60 s | S |

The magic-link and password-setup IP limit keys switch from the raw IP to `ipRef` (item 15).

### 7.3 Citizen OTP

| Pattern | Value | TTL | Tag |
|---|---|---|---|
| `{p}:identity:citizen-otp:challenge:{id}` | HASH `{hash, attempts, phoneNumber, tenant, purpose, subject?, sessionRef?, claimed?}` | `IDENTITY_CITIZEN_OTP_TTL_SECONDS` (300) | S |
| `{p}:identity:citizen-otp:latest:{phoneRef}` | the newest challengeId; `_send` replaces it and deletes the previous challenge, so only the newest code works | the OTP TTL | S |
| `{p}:identity:citizen-otp:cooldown:{phoneRef}:{ipRef}` | `"1"` (resend cooldown per phone **and** IP, so a stranger can't hold someone's cooldown) | 30 s | S |
| `{p}:identity:citizen-otp:sends:{phone\|ip}:{ref}` | counter: 5 an hour per phone (caps SMS cost and guesses per number), 20 per IP | 3600 s | S |

### 7.4 Tokens and revocation

| Pattern | Value | TTL | Tag |
|---|---|---|---|
| `{p}:identity:token:{tenantId}:{uuid}` | `{accessToken, expiresAt, mintedAt, subject, kind, keyVersion?}` | the token's **real** expiry (the 60 s skew applies only when reading) | L |
| `{p}:identity:token-holders:{tenantId}:{uuid}` | SET of `sessionRef` | the token's expiry | S |
| `{p}:identity:person-tokens:{sub}` | SET of `{tenantId}:{uuid}` | the latest token expiry | L |
| `{p}:identity:revoke-retry` | ZSET retryId → next attempt time | — | L |
| `{p}:identity:revoke-retry:{retryId}` | HASH `{tenantId, uuid, accessToken, expiresAt, subject, reason, attempts}` | the token's expiry | L |
| `{p}:identity:kc-logout-retry` | ZSET kcSessionId → next attempt time | — | S |
| `{p}:identity:kc-logout-retry:{kcSessionId}` | HASH `{attempts}`; queued before the BFF session is deleted | the ended BFF session's expiry | S |
| `{p}:identity:revoke-jobs` | ZSET `{sub}\|{reason}\|{eventId}` → due time | — | S |

These replace `{p}:digit-user-token:*`, `{p}:digit-user-token-holders:*` and `{p}:digit-linked-identities:*` (item 10). Losing the inventory: grant-eligible staff are found again through the derived credential (design §6). Citizen tokens, inactive or locked staff tokens, and tokens of a Keycloak user deleted in the same window live until they expire (D25/C6).

### 7.5 Events, reconcile and audit

| Pattern | Value | TTL | Tag |
|---|---|---|---|
| `{p}:identity:kc-events:{user\|admin}:checkpoint` | HASH `{time, idsAtTime}` | none | S (if lost, or outside retention: revoke conservatively) |
| `{p}:identity:kc-events:{user\|admin}:seen` | ZSET eventId → time | trimmed to the overlap window | S |
| `{p}:identity:reconcile:stats` | HASH `{lastCompleteAt, lagMs, failures}` | none | R |
| `{p}:identity:mirror-fp:{sub}` | hash of the last mirrored state (egov-user `lastModifiedDate` + entry hash) | 7 days | R |
| `{p}:identity:audit` | STREAM | `MAXLEN ~ 100000` | L (the history is lost with Redis; the same records go to the log) |

### 7.6 Retired families

| Family | Replaced by | Removed in |
|---|---|---|
| `{p}:digit-citizen-mobile:*` (no TTL) | an unmasked admin search under the person lease | item 15 |
| `{p}:digit-managed-accounts` (no TTL) | `digit.bindings` / `digit.accounts` | item 14 |
| `{p}:digit-user-token:*`, `…-holders:*`, `{p}:digit-linked-identities:*` | §7.4 | item 10 |
| `{p}:identity:user-attributes-lease:*`, `{p}:digit-user-lease:*` | the person lease | items 7–10 |
| `{p}:account-link-lease:*` | the uuid lock | item 8 |

## 8. Derived staff credential (`encode_v1`)

```
password = encode_v1(HMAC-SHA256(key[keyVersion], "v1\n" + uuid + "\n" + tenantId))
```

Reference implementation and unit tests: `src/modules/accounts/credential.ts`, `tests/unit/credential.test.ts`. Lane B uses it as is.

- **Input:** the fields are separated by newlines, so shifted fields can't collide. Empty or multi-line fields are rejected.
- **Expansion:** HKDF-Expand (RFC 5869, SHA-256), with the 32-byte HMAC as the PRK and info `digit-identity-bff/encode_v1`. Bytes are read in order and never reused.
- **Alphabets** (look-alikes `l I O 0 1` left out): lower `abcdefghijkmnopqrstuvwxyz` (25), upper `ABCDEFGHJKLMNPQRSTUVWXYZ` (24), digit `23456789` (8), special `@#$%` (4); all 61.
- **Picks:** one lower, one upper, one digit and one special, then 11 from all 61. Each pick uses **rejection sampling**: a byte is used only if it is below `256 − (256 mod size)`, so no character is favoured.
- **Shuffle:** Fisher–Yates from index 14 down to 1, with each index drawn from the same stream by the same rule.
- **Result:** 15 characters, which always pass egov-user's policy (8–15 characters, a digit, lower, upper, one of `@#$%`, no whitespace). A test checks 10,000 derived passwords against that policy.
- **Keys:** `IDENTITY_CREDENTIAL_KEYS` = `1:<base64 ≥ 32 bytes>,2:<…>` and `IDENTITY_CREDENTIAL_KEY_CURRENT`. The version used is stored in `digit.accounts[].credential.keyVersion`. A new version is adopted lazily at the next issuance. An old key is removed only when no entry still uses it.
- **When it's set:** only when a binding becomes `active` (new-user `_link`, `_accept`), at the founder's first `_select` (D25/B8), or at first issuance for converted links. Never while `pending`. At activation, the BFF signs in once with the new credential and logs out the token it gets back before minting the one it hands out.
- **Changing the algorithm** changes every staff password. Add `encode_v2` and bump the version prefix instead.

**Frozen test vectors** (test keys only: `K1` = bytes `00 01 … 1f`, `K2` = 32 bytes of `ab`). They were cross-checked against an independent Python implementation.

| Key | uuid | tenantId | HMAC (hex) | Password |
|---|---|---|---|---|
| K1 | `00000000-0000-4000-8000-000000000001` | `pg` | `af3993b634002e81bec3eebe81116c9c4eee4ce5ae716e3a79a576635628925e` | `W8%$wiVkCM39sks` |
| K1 | `3f2a9c1e-7b4d-4e2a-9f10-5c6d7e8f9a0b` | `pg` | `e3f76de39a836f107c50416fb08406857f83305d35cd3da866561ac8aff1f43c` | `W6RgS$HeadQrdYN` |
| K1 | `3f2a9c1e-7b4d-4e2a-9f10-5c6d7e8f9a0b` | `ke` | `306cd3b8552cb8c4116c6341d9cce98ef2db5a5fa0d58c12bfd6feda038eeaee` | `%@uYT8MwZkS$J4q` |
| K2 | `3f2a9c1e-7b4d-4e2a-9f10-5c6d7e8f9a0b` | `pg` | `06b4508a015652bf1c412cb091ae877e10b21c8106843a6599a55347d1d83be1` | `@rQXAhqy6Tz6R5b` |
| K2 | `a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d` | `bomet-county` | `0287838160bbdc66bd28d6ab0cc510988ed30454819aef0e32c079d8c4cd2a12` | `rQuGP8HDAhM2c@E` |

### Shared DIGIT tokens and scoped logout

egov-user can return the same live access token for repeated grants of one
account. The BFF cannot revoke only the copies held by other consumers of that
token. `logout {scope: "others"}` therefore preserves every current-session-held
account token while ending the other BFF/Keycloak sessions. Other consumers who
already possess that shared DIGIT token can use it until expiry or a later
account-wide revocation (including logout-all), including consumers that obtained
the same token directly from egov-user outside the BFF. Tokens belonging only to ended
sessions are still revoked. This limitation also applies when staff use the
derived credential; deterministic credentials do not create per-session DIGIT
tokens. Logout-current releases its claim and preserves tokens with remaining
holders; logout-all ends all claims and revokes the shared token.

A credential change (§10) does **not** keep shared tokens. A DIGIT token
survives it only if sessions that survive are its **only** holders. That
includes the B3 initiating session. If any ended session also held the token,
the BFF revokes it with an egov-user logout, because that copy may sit on the
device the person is locking out. A surviving holder gets a fresh token at its
next `_select`.

## 9. Onboarding: payload hash, `restartNo` and lifecycle

### 9.1 Canonical payload hash (`organizations/_ensure`)

Reference implementation and tests: `src/modules/control-plane/operation-hash.ts`, `tests/unit/operation-hash.test.ts`.

- **Hashed fields:** `tenantId`, `slug` and `name` only. `operationId` and `restartNo` identify the attempt and are compared separately.
- **Normalization:** `tenantId` is trimmed, with case kept. `slug` is trimmed and lower-cased. `name` is Unicode NFC, trimmed, and every run of whitespace becomes one space.
- **Canonical form:** a JSON object `{name, slug, tenantId, v: 1}` with keys in code-point order and no whitespace, with strings escaped as `JSON.stringify` does. For this object, that is RFC 8785 (JCS).
- **Hash:** lower-case hex SHA-256 of the UTF-8 canonical form, stored as `digit.operationHash`.

| Payload | Canonical form | Hash |
|---|---|---|
| `pg`, `pg`, `Punjab Gov` | `{"name":"Punjab Gov","slug":"pg","tenantId":"pg","v":1}` | `446418a0fc9dc46179809f79bf9c33525c197730672ecc671a2524e0e5c18427` |
| ` pg `, ` PG `, `  Punjab \t Gov\n` | same as above | same as above |
| `bomet`, `bomet-county`, `Bomet County` | `{"name":"Bomet County","slug":"bomet-county","tenantId":"bomet","v":1}` | `604feff9d4a61289609e2c6cf1bfa1239710d368f0c141b33568fceba5c028b7` |
| `mz`, `maputo`, `Conselho Municipal de Maputo — Município` | `{"name":"Conselho Municipal de Maputo — Município","slug":"maputo","tenantId":"mz","v":1}` | `bdd9edbfa0061469d651beb194e3d6f2d596a53ecc2deb31d36623c5b12456bc` |
| `pg`, `pg`, `Café "Q"` | `{"name":"Café \"Q\"","slug":"pg","tenantId":"pg","v":1}` | `81fd40ce4409fe55af82a5bf23b3dfd0e4e818c0c00e83a027feb6a1de344bc2` |

### 9.2 `_link` request id

`requestId = hex(SHA-256("link-v1\n" + actor + "\n" + tenantId + "\n" + digitUuid + "\n" + lower(trim(email))))`, from `src/modules/bindings/link-request-id.ts`.

| actor | tenantId | digitUuid | email | requestId |
|---|---|---|---|---|
| `9c933e91-cf01-4599-9a25-d4def71134f2` | `pg` | `3f2a9c1e-7b4d-4e2a-9f10-5c6d7e8f9a0b` | `Asha.K@Example.org ` | `6a437d4c295ef4c8f605fa17bc90a569208584985c6d85cf94c7c4684892368f` |
| `9c933e91-cf01-4599-9a25-d4def71134f2` | `bomet` | `a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d` | `asha.k@example.org` | `5ac31609d50d8c241d67e4646010905dc1e94e4ec0bfe94d37146881fe196ced` |

### 9.3 The `restartNo` contract

- `restartNo` is a non-negative integer counter on the **PGR operation row** (`eg_pgr_onboarding_operation.restart_no`, default 0).
- It goes up by one **only** when a terminal resubmission is authorized (`TERMINAL_FAILED` → resubmit). An ordinary retry (`RETRYABLE_FAILED` → retry) keeps it.
- Every onboarding mutation sends `{operationId, restartNo}`. The BFF takes the operation lock, then compares against the `digit.restartNo` of the Organization carrying `digit.operationId`:

| Call vs stored | `organizations/_ensure` | Other primitives |
|---|---|---|
| No Organization for the operation | create, `PROVISIONING` | `OPERATION_NOT_FOUND` |
| Lower | `ATTEMPT_STALE` | `ATTEMPT_STALE` |
| Equal, same hash | return it (`created: false`) | proceed (idempotent) |
| Equal, different hash | `OPERATION_CONFLICT` | — (not hashed) |
| Higher, Organization `PROVISIONING` or `FAILED`, same slug | re-stamp every field, `digit.restartNo` = new, lifecycle → `PROVISIONING` | `OPERATION_NOT_FOUND` (call `_ensure` for the new attempt first) |
| Higher, slug changed | a **new** Organization; the old one is renamed, set `FAILED` and given `digit.supersededBy` | `OPERATION_NOT_FOUND` |
| Higher, Organization `ACTIVE` | `LIFECYCLE_CONFLICT` (an active workspace is never re-opened) | `OPERATION_NOT_FOUND` |

- `memberships/_ensure` and `bindings/_ensure` run in any lifecycle state for the current `restartNo`.
- A terminal restart keeps the same founder (D25/B9). `bindings/_ensure` with the same key and a different uuid is `BINDING_CONFLICT`. PGR searches HRMS for the founder before `_create`, so a retry reuses the uuid.

#### Changed-slug crash recovery

Before renaming or marking the previous Organization `FAILED`, `_ensure` writes
`digit.replacementPending` on it with the normalized target payload, canonical
hash and higher restart number. The marker is durable in Keycloak, independent
of Redis lock loss. Its restart number is part of the operation's high-water
mark: every lower-attempt mutation returns `ATTEMPT_STALE`. Repeating the pending
attempt with a different hash returns `OPERATION_CONFLICT`.

The pending tenant and slug remain reserved against other operations. `_ensure`
replays the old Organization's failure and tenant-member revocation before
creating the replacement. A matching pending `_lifecycle FAILED` can settle a
permanent create failure on the staging Organization: it stores
`digit.lifecycleRestartNo`, replays tenant-member revocation on every call, and
retains the pending high-water mark. After this terminal decision, `_ensure`
with the same restart and hash returns `LIFECYCLE_CONFLICT`; a changed hash
remains `OPERATION_CONFLICT`. A higher restart may resume with either the
original or a changed slug. `ACTIVE`, membership and binding calls for
the pending attempt return `OPERATION_NOT_FOUND` until its replacement
Organization exists. Once created,
the higher-attempt Organization is authoritative even if the old marker has not
yet been cleared. A retry finishes `digit.supersededBy` and removes the marker;
it does not revoke a replacement that has since become `ACTIVE`.

Pending restart numbers must exceed their source Organization's restart number,
and the stored normalized fields must match the pending canonical hash. Multiple
pending markers, duplicate actual restart numbers, corrupt metadata or a marker
that disagrees with its created replacement fail closed with
`IDENTITY_UNAVAILABLE` before any mutation.

### 9.4 Lifecycle publication (PGR side, for lane D)

- PGR writes its terminal decision in the **same transaction** that finishes the operation: `lifecycle_decision` (`ACTIVE` | `FAILED`), `lifecycle_restart_no = restart_no`, `lifecycle_decided_at`.
- A publisher replays `POST organizations/_lifecycle {operationId, restartNo: lifecycle_restart_no, state: lifecycle_decision}` with back-off until it gets a 2xx, or a 409 that confirms the outcome can't change (`ATTEMPT_STALE`). It then sets `lifecycle_published_at`.
- `FAILED` is published only for **terminal abandonment**, never for a retryable failure.
- A resubmit (which raises `restart_no`) waits until any earlier decision is published, then clears the `lifecycle_*` columns.
- **Failure before any Organization exists.** PGR durably records "organization ensure started" before it first sends `organizations/_ensure` for an operation.
  - If no `_ensure` was ever started for the operation, across all restarts, a `FAILED` decision needs no publication: PGR marks it settled with reason `NO_IDENTITY_SIDE_EFFECTS` (otherwise `_lifecycle` would answer `OPERATION_NOT_FOUND` forever and block the resubmit).
  - Once an `_ensure` may have been sent, publication is never skipped: PGR repeats the uncertain `_ensure`, then publishes `FAILED`.
  - The same-founder and stale-attempt rules still apply.
- The BFF treats a repeated call for the recorded transition as success, so replays are safe.
- Visibility: only `ACTIVE` (or lifecycle-less) Organizations are routed, discovered or selectable.

## 10. Keycloak events the BFF reacts to

Probed on Keycloak 26.7.3 on 2026-10-04; the event shapes the poller matches are fixed in `tests/unit/keycloak-poller.test.ts`.

**Realm prerequisites** (Keycloak config, lane E):
- `eventsEnabled` and `adminEventsEnabled` both on, with **`adminEventsDetailsEnabled=true`**;
- user event types include at least `LOGIN`, `LOGOUT`, `UPDATE_PASSWORD`, `UPDATE_CREDENTIAL`, `REMOVE_CREDENTIAL`, `UPDATE_EMAIL`, `VERIFY_EMAIL`, `FEDERATED_IDENTITY_LINK`, `REMOVE_FEDERATED_IDENTITY`, `DELETE_ACCOUNT`;
- retention longer than the longest tolerated BFF outage;
- the BFF service account gets `view-events`, plus `view-organizations` and `manage-organizations`.

**Reading:**
- Poll `/admin/realms/{realm}/events` and `/admin-events` with `dateFrom=<checkpoint ms>` (inclusive) and `direction=asc`, paging with `first`/`max`.
- Both kinds have an `id` and a `time` in epoch ms; dedupe on `(time, id)`.
- Use `type=` for user events, and `operationTypes=` / `resourceTypes=` for admin events (admin events ignore `type`). **Never send an unknown enum value**: Keycloak answers 500.

| Trigger | Match | Effect |
|---|---|---|
| Disable | admin `UPDATE` + `USER`, path `users/{id}`, `representation.enabled === false` | Revoke everything for the person. A missing `enabled` is not a disable. Keycloak keeps the sessions; the refresh fails later |
| Delete | admin `DELETE` + `USER`, path `users/{id}` | Write an audit record first, then revoke. This also covers the person's memberships, which emit no event of their own |
| Logout-all (admin) | admin `ACTION` + `USER`, path `users/{id}/logout` | Raise the generation; revoke everything. No user events come with it |
| Admin credential reset | admin `ACTION` + `USER`, path `users/{id}/reset-password` | Revoke everything the change does not spare (below). Keycloak does **not** end sessions itself |
| Self password change | user `UPDATE_CREDENTIAL` with `details.credential_type = "password"` (its twin `UPDATE_PASSWORD` fires 1 ms earlier; act once) | Keep the BFF session whose `kcSessionId` = **`details.code_id`** (the event has **no `sessionId`**) and whose client = the event's `clientId`. Raise the generation, rewrite that session's generation and those of the sessions the change spares (below), and revoke the others (D25/B3). DIGIT tokens follow the only-holders rule (below). No match → revoke everything the change does not spare |
| Other credential change | user `UPDATE_CREDENTIAL` / `REMOVE_CREDENTIAL` for another `credential_type` | Revoke everything the change does not spare (below) |
| Sign out other devices | user `LOGOUT` with `details.logout_triggered_by_required_action` | End the BFF session with that `kcSessionId` |
| Normal logout | user `LOGOUT`, `sessionId` + `clientId` | End the BFF session with that `kcSessionId` |
| Single session (admin) | admin `DELETE` + `USER_SESSION`, path `sessions/{sid}` | End the BFF session with that `kcSessionId` (the path has no user id) |
| Membership removed | admin `DELETE` + `ORGANIZATION_MEMBERSHIP`, path `organizations/{orgId}/members/{userId}` | Revoke the person's tokens at that Organization's tenant |
| Organization deleted, disabled or `FAILED` | admin `DELETE` + `ORGANIZATION` (path `organizations/{orgId}`), or an `UPDATE` with `enabled === false` | Revoke every member at that tenant. A delete has no per-member events |
| Email verified or changed | user `VERIFY_EMAIL` / `UPDATE_EMAIL` | Write the verified email to DIGIT (D18) |

**What a credential change spares.** The three credential rows end only sessions that authenticated before the change. The cutoff is the event's `time`, compared on Keycloak's own clock:
- **The changing session.** A BFF session whose `kcSessionId` equals the event's Keycloak session survives, whatever its client or `auth_time`. In 26.7.3 that session is `details.code_id`, because the event has no `sessionId`. That session just proved the new password or the action token. Matching on it is needed because `auth_time` has whole-second precision, so an inline required action can stamp `auth_time` × 1000 below the event `time`.
- **Later authentications.** A session survives if its `authTime` is at or after `time`. If `authTime` is missing, the BFF uses `start` of the session's Keycloak session from `GET /users/{id}/sessions` (`view-users`). If neither is known, the session counts as older.
- **Never `createdAt`.** A code issued for an old-password login and exchanged after the change would otherwise survive.
- **No skew allowance.** Both times come from Keycloak. A sign-in in the same second as the change counts as older and must sign in again (fail closed).
- **Password setup by action token.** The 26.7.3 probe in `keycloak/tests/live-check.py` shows that the action token leaves **no** SSO session. The sign-in that follows authenticates afresh, so its `auth_time` falls after the event.
- **Generation.** Every surviving session has its generation rewritten together with the raise.
- **DIGIT tokens.** A DIGIT token survives only if surviving sessions (the B3 session and the sessions the change spares) are its **only** holders. A token that an ended session also holds may already be on a pre-change device, so it is revoked with an egov-user logout, even if the B3 session holds it too. A surviving holder gets a fresh token at its next `_select` (§8).

- Admin events name the caller's client by **internal id**, not `clientId`.
- Membership **adds** carry no user id, so the BFF never acts on them.
- Echo suppression ignores only the BFF service account's own mirror-only writes.
- Both `_select` routes first run any revocation job already queued for the person, under the person lease. So `_select` never returns a cached DIGIT token that a queued job is about to revoke, and a session the job ends gets `SESSION_REVOKED` (#2286). A failing job fails `_select` and stays queued. Before the poller reads the event (up to about 5 s), the BFF does not know about the change, so a `_select` in that window can still return a token the job revokes later.

## 11. Configuration added by the contract

| Variable | Purpose |
|---|---|
| `IDENTITY_ONBOARDING_TOKEN` | PGR's token for the onboarding primitives (D25/B6) |
| `IDENTITY_CREDENTIAL_KEYS`, `IDENTITY_CREDENTIAL_KEY_CURRENT` | The derived-credential key ring (§8) |
| `IDENTITY_STAFF_CREDENTIAL_MODE` | `rotate` \| `derived`, per box (D24) |
| `IDENTITY_OTP_SENDER` = `log` \| `http`, `IDENTITY_OTP_SENDER_URL` | `HttpOtpSender` (item 3) |
| `IDENTITY_POLLER_MAX_LAG_SECONDS` | Readiness threshold for the event poller |
| `IDENTITY_RECONCILIATION_INTERVAL_SECONDS` | Unchanged (default 300); reported by `/readyz` |

Removed by item 14/15: the `DIGIT_PROVISIONER_*` variables, the onboarding worker variables, the role allowlist, and the `admin/admin` Keycloak fallback.

## 12. Operations

**External dependency: PGR workspace readiness (#2103).** The BFF does not expose or relay workspace readiness or any other onboarding state.
- The configurator calls PGR directly: `POST /pgr-services/v2/onboarding/workspaces/_search`, `POST /pgr-services/v2/onboarding/workspaces/_update {tenantId, step, state, version}` and `POST /pgr-services/v2/onboarding/workspaces/_rename`.
- These calls are authorized with the founder's normal DIGIT token and Kong role-actions for `ACCOUNT_ADMIN` at that tenant, not with BFF cookie introspection.
- `GET /identity/v1/tenants` carries no readiness fields.
- A tenant without a workspace row counts as ready (legacy).

**Deployment.** The canonical CCRS deployment is `local-setup/docker-compose.egov-digit.yaml`. Setting `enable_keycloak: true` starts the BFF, Keycloak 26.7.3 and its own Postgres. Ansible runs `configure-keycloak.sh` with task-scoped secrets once Keycloak is healthy. Realm SMTP is mandatory, because password setup, invitation activation and email proof all depend on it. Kong publishes `/identity/v1` and `/auth`; `/internal/identity/v1` is never published. Production uses a dedicated DIGIT employee holding only `ACCOUNT_ADMIN` for the BFF's DIGIT admin calls.

**Failure behaviour.**
- Missing Redis or Keycloak stops the identity operation that needs it.
- PGR being down has no effect on BFF startup or sign-in.
- egov-user or MDMS being down still allows OIDC sign-in, but tenant listing and `_select` fail closed with 503, and no DIGIT token is issued.
- With the BFF stopped, signed-in people keep working until their DIGIT token expires (revocation pauses: a documented limit).

**Revocation log (#2285).** Every revocation writes one JSON line to stdout, so "why was this person signed out?" can be answered from the logs alone.
- `event: "identity.revocation.job"`: one line per run of a revocation job (Keycloak events, reconcile, binding removal, tenant fan-out). `outcome` is `ok`, or `retry` (logged as a warning, with `error`) when the job failed and stays queued; the revocation worker runs it again within about 5 s. A retry line still lists what the run did before it failed.
- `event: "identity.revocation.logout"`: one line per sign-out the BFF performs without a job: `reason` `LOGOUT` (with `scope` `current` | `others` | `all`), `PHONE_CHANGED`, or `KEYCLOAK_LOGOUT` (a Keycloak session ended; `leaseBusy: true` when the realm-scan fallback deleted sessions without the person lease). `outcome` is `ok` or `failed`.

| Field | Meaning |
|---|---|
| `reason` | The job's reason: `CREDENTIAL_CHANGED`, `KEYCLOAK_DISABLED`, `KEYCLOAK_DELETED`, `LOGOUT_ALL`, `MEMBERSHIP_REMOVED`, `BINDING_REMOVED`, `ROLE_CHANGED`, `DIGIT_INACTIVE`, `DIGIT_ACCOUNT_MISSING`, `ORGANIZATION_DISABLED`, `TENANT_INACTIVE`, or a logout reason above |
| `subject` | Keycloak subject |
| `tenantId`, `account` | The tenant (and `tenantId:uuid` DIGIT account) a scoped job targets; absent for person-wide jobs |
| `trigger` | `eventId` (`<time>:<id>` for a Keycloak event), `eventType` (the user event type, e.g. `UPDATE_CREDENTIAL`, or the admin event's operation and resource, e.g. `UPDATE USER`), `eventTime` (ISO). A job the BFF started itself has only a generated `eventId` (`tenant:<tenantId>` for a tenant fan-out); a logout line not caused by a Keycloak event has an empty `trigger` |
| `sessionsEnded`, `sessions.ended` | Count, and a `privateRef` per ended BFF session (the same keyed hash the `token-holders:*` sets store) |
| `sessionsKept`, `sessions.kept` | Every session of the person the run left alive, each with `reason`: `B3_INITIATOR` (the session that made a self password change), `INITIATOR` (the session that asked for the logout or phone change), `OTHER_TENANT` (a tenant-scoped job and the session is at another tenant), `NOT_TARGETED` (a logout that did not cover it), `CHANGING_SESSION` (the Keycloak session that made a credential change, §10), `AUTHENTICATED_AFTER_CHANGE` (Keycloak authenticated it at or after a credential change, §10) |
| `tokensRevoked`, `tokensKept`, `tokens[]` | Each DIGIT token decision: `account`, `tokenRef` (first 12 hex digits of SHA-256 of the token, matching the `revoke-retry:*` key), `outcome` `revoked` \| `kept`, and `why`. Revoked: `IN_SCOPE`, `SHARED_WITH_ENDED_SESSION` (a kept session also held it; it gets a fresh token at its next `_select`, §8), `RECOVERED` (not in Redis; found by a staff login, §8), `NO_LIVE_HOLDER` (logout ended its last holder). Kept: `KEPT_SESSIONS_ONLY_HOLDERS`, `STILL_HELD` (another live session holds it), `RETAINED_BY_CURRENT` (logout of other sessions), `OTHER_PERSON` (the account's token belongs to another subject) |
| `durationMs` | Run time |

No line contains a token, cookie, session id or Keycloak session id.

**Documented limits** (design §6): native refresh tokens issued before binding (up to 14 days) can't be revoked without an egov-user change; revocation pauses while the BFF is down; after Redis loss, citizen tokens, inactive or locked staff tokens, and tokens of a Keycloak user deleted in the same window live until they expire.

The configuration reference for each variable is `deploy/digit-compose/identity-bff.env.example`. The deployment walkthrough is `docs/setup/deployment/identity-bff.md` at the repository root.
