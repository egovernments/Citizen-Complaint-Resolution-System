# Identity BFF v1 — DIGIT compatibility bridge

## Boundary

The identity BFF is the default executable (`npm start`). Its
runtime dependencies are Redis, Keycloak, and DIGIT's **existing** egov-user and
MDMS APIs. It needs no egov-user code change. PGR is not required to start or
sign in; only the optional onboarding worker calls PGR.

```text
Browser ── OIDC redirect / opaque cookie ──> Identity BFF ──> Keycloak (OIDC + Admin API)
                                                 │
                                                 └──> egov-user user-service API (via Kong)
Browser ── normal DIGIT RequestInfo.authToken ──> Kong ──> PGR and other DIGIT APIs
Onboarding worker / reconciler ── workload token ──> Identity BFF control plane
```

The BFF is not a universal proxy. After sign-in and tenant selection it returns
the normal egov-user login response, so an existing frontend keeps calling DIGIT
business APIs with `RequestInfo.authToken` unchanged. The browser never calls
egov-user login/create/update endpoints and never receives a Keycloak access,
ID or refresh token, a DIGIT refresh token, the DIGIT admin token, or any
password.

## Browser API

| Method | Route | Result |
|---|---|---|
| `GET` | `/identity/v1/auth-methods` | Methods configured here and enabled in Keycloak |
| `GET` | `/identity/v1/authorize?method=...` | Starts Authorization Code + PKCE with state and nonce |
| `GET` | `/identity/v1/callback` | Validates the callback and creates an opaque cookie session |
| `GET` | `/identity/v1/session` | Authentication state, opaque-session expiry, and selected tenant; never tokens |
| `GET` | `/identity/v1/tenants` | Tenants in both Keycloak membership and DIGIT grants |
| `POST` | `/identity/v1/contexts/_select` | Records the tenant and returns the normal DIGIT login response |
| `POST` | `/identity/v1/organization-members/_invite` | Grants an employee access to the selected Organization and provisions their tenant-local DIGIT account |
| `POST` | `/identity/v1/logout` | Revokes the DIGIT token and Keycloak session, clears the cookie |

### Existing-user sign-in sequence

Prerequisite: the person already exists in Keycloak. To receive a tenant
option, they must also be a member of a mapped Keycloak Organization with an
active BFF-managed DIGIT account for that tenant.

```text
Browser          Identity BFF              Keycloak             egov-user
   | GET /authorize   |                         |                     |
   |----------------->| 302 OIDC authorization |                     |
   |<-----------------|------------------------>| login               |
   |                  | GET /callback?code&state|                     |
   |                  |<------------------------|                     |
   |                  | exchange and verify code                      |
   |                  | create server-side session                    |
   | 303 FE + HttpOnly session cookie          |                     |
   |<-----------------|                         |                     |
   | GET /session     |                         |                     |
   | GET /tenants     | live membership lookup |                     |
   | POST /contexts/_select                     | reconcile + login   |
   |----------------->|---------------------------------------------->|
   | user-scoped DIGIT access_token             |                     |
   |<-----------------|                         |                     |
```

Frontend calls:

1. Navigate the browser, rather than making an AJAX request, to:

   ```http
   GET /identity/v1/authorize?method=password
   ```

   `magic_link`, `google`, and `github` use the same endpoint when advertised
   by `GET /identity/v1/auth-methods`.

2. Keycloak returns to `GET /identity/v1/callback?code=...&state=...`. The BFF
   consumes the code, stores Keycloak tokens server-side, sets the opaque
   HttpOnly session cookie, and redirects with `303` to the configured frontend.
   The frontend must not implement or call the callback itself.

3. After the redirect, load the authenticated state and eligible tenants. For
   cross-origin development, use `credentials: "include"` on both requests:

   ```http
   GET /identity/v1/session
   GET /identity/v1/tenants
   ```

   ```json
   {
     "tenants": [
       { "tenantId": "bomet", "name": "Bomet County Government", "organizationAlias": "bomet", "roles": ["GRO"] }
     ],
     "selectionRequired": false,
     "onboardingRequired": false
   }
   ```

4. Select one returned `tenantId` using the same cookie:

   ```http
   POST /identity/v1/contexts/_select
   Content-Type: application/json

   { "tenantId": "bomet" }
   ```

5. Store the returned `access_token` in the frontend's existing DIGIT auth
   state. Continue sending it as `RequestInfo.authToken` to normal DIGIT APIs.
   It is a tenant-specific DIGIT token; it is not the BFF cookie or a Keycloak
   token.

`401` means the opaque session is absent or expired, `403` means the requested
tenant is no longer available to that user, and `503` means a required identity
dependency is temporarily unavailable.

Password, magic link, Google, and GitHub all enter the same Keycloak browser
flow (brokered methods use `kc_idp_hint`) and converge on one callback. Keycloak
tokens stay in Redis behind a random HttpOnly cookie. `SameSite=Lax` is the
default; a cross-site development frontend may set `IDENTITY_COOKIE_SAME_SITE=None`
with a Secure cookie and an explicit `IDENTITY_ALLOWED_ORIGINS` entry.

Password accepts either username or email. Magic link uses a second confidential
Keycloak client bound to an email-only browser flow; this keeps the realm's
normal password flow unchanged. The BFF stores the selected OIDC client with the
one-time login attempt and opaque session, so callback exchange, refresh, and
logout use the correct client without exposing either client secret. The method
is advertised only when that Keycloak client exists, is enabled, and
`KEYCLOAK_MAGIC_LINK_CLIENT_SECRET` is configured.

Magic-link email is a single-use bearer credential valid for 10 minutes by
default. Keycloak may create a previously unknown email user, but DIGIT account
creation and tenant access still require Organization membership and the normal
managed-account rules; receiving a link grants no tenant by itself. A newly
created Keycloak user completes the standard first-name/last-name profile screen
once before the callback. Existing users go directly from the link to callback.

`contexts/_select` response:

```json
{ "access_token": "<user-scoped DIGIT token>", "token_type": "bearer",
  "expires_in": 604000, "scope": "read", "UserRequest": { "uuid": "...", "userName": "kcbff-...", "roles": [...] } }
```

The token belongs to the signed-in person's own DIGIT account, so Kong's normal
`/user/_details` resolution and RBAC apply. `UserRequest` is narrowed to the
documented profile fields.

### Invite an employee

The caller first selects their Organization with `contexts/_select`. A live
Keycloak Organization membership plus a role in
`IDENTITY_ORGANIZATION_ADMIN_ROLES` is required. Onboarding assigns the initial
user `TENANT_ADMIN`; the request cannot name another Organization.

```http
POST /identity/v1/organization-members/_invite
Content-Type: application/json

{
  "email": "employee@example.com",
  "name": "Employee Name",
  "mobileNumber": "712345678",
  "countryCode": "254",
  "roles": ["GRO"]
}
```

`roles` is optional and is restricted to `DIGIT_MANAGED_ROLE_ALLOWLIST`; the
configured base role is added automatically. The BFF creates or reuses the
Keycloak user, adds Organization membership and a per-user Organization group,
sets its client roles, and creates or updates the BFF-managed DIGIT account at
the selected tenant. A newly created Keycloak user receives an activation email
to verify the address and set a password. An existing verified user receives
access immediately and can use any already-configured Keycloak sign-in method.

```json
{
  "member": {
    "identityUserId": "...",
    "organizationId": "...",
    "tenantId": "ke.bomet",
    "email": "employee@example.com",
    "name": "Employee Name",
    "roles": ["EMPLOYEE", "GRO"],
    "digitUserUuid": "..."
  },
  "identityUserCreated": true,
  "digitAccountCreated": true,
  "activationEmailSent": true
}
```

Provisioning is retry-safe. A failure may leave the earlier Keycloak steps in
place, and repeating the same request resumes them without another identity or
DIGIT account. `401` means no identity session, `403` means the caller has no
live admin authority, `409` means no Organization is selected or an identity
conflicts, and `503` means DIGIT is temporarily unavailable.

## Organization → tenant mapping

A Keycloak Organization maps to one DIGIT tenant through its
`digit.rootTenantId` attribute, set by `organizations/_ensure` only after the
tenant exists in DIGIT MDMS `tenant.tenants`. A tenant is offered only when:

1. live Keycloak state says the user is a member of that Organization;
2. the Organization is enabled and mapped, and the tenant exists in DIGIT; and
3. the managed DIGIT account is active and holds roles for that tenant.

Callback and tenant discovery are read-only. Account creation happens only in
the provisioning control plane. Role and membership projection comes from live
Keycloak state through the control plane and reconciliation. Selection checks
membership and reconciles roles live before issuing a DIGIT token, so a role
removal takes effect on the next selection rather than waiting for a scan.

## Managed DIGIT accounts

The BFF owns one DIGIT `EMPLOYEE` per Keycloak `(issuer, subject)` **per tenant**,
stored at that tenant. DIGIT's gateway (Kong + egov-accesscontrol) authorizes a
token only against its account's home tenant. On a live stack, a role at
another tenant is rejected with 403, so one account cannot serve several
tenants. Each account has:

- username `kcbff-<sha256(issuer\nsubject\ntenant)[:40]>`;
- `identificationMark` `keycloak-bff:v1:<sha256(issuer\nsubject)>:<tenantId>`;
- roles at its tenant only: `DIGIT_MANAGED_BASE_ROLES` plus the
  Organization-group client roles of `DIGIT_ROLE_CLIENT_ID` that are in
  `DIGIT_MANAGED_ROLE_ALLOWLIST`.

An account is treated as managed only when both username and marker match.
Locally managed legacy employees, including one that happens to share the
username, are never updated, rotated or deactivated.

### Lifecycle (existing egov-user APIs only)

| Step | Call | Credential |
|---|---|---|
| Admin token | `POST /user/oauth/token` with `DIGIT_ADMIN_*` env credentials; cached in memory, re-obtained before expiry or after a 401 | env |
| Resolve | `POST /user/_search` (active, then inactive) | admin token |
| Create when absent | `POST /user/users/_createnovalidate` with a cryptographically random one-time password | admin token |
| First user token | `POST /user/oauth/token` as that user, once | one-time password |
| Regenerate after expiry | `POST /user/users/_updatenovalidate` with a new random password, then one login | admin token, then new one-time password |
| Role/membership change | `_updatenovalidate` roles or `active=false`, then `POST /user/_logout` on the cached token | admin token |
| Logout | `POST /user/_logout` on the cached user token | user token |

Every create/rotate/role change for one subject runs under a Redis lease
(`DIGIT_USER_LEASE_SECONDS`), so concurrent requests produce one rotation and
share the resulting token. The user token is cached in Redis until shortly
before egov-user's `expires_in`.

The admin token is used only for these account operations, never for business
calls.

### Honest limits

- **Password hash retained:** egov-user stores the BCrypt hash of the latest
  generated password. The BFF never persists, logs, caches or returns the
  plaintext, and never reuses it, but JavaScript strings cannot be zeroed.
  "Discarded" therefore means unreferenced after the single create/update and
  login calls.
- **Mobile required:** egov-user requires a mobile number to create an employee.
  Login-time creation uses a `phone_number` claim. The worker uses
  `tenantMetadata.tenantAdmin.{mobileNumber,countryCode}` and separates an E.164
  dial prefix before calling egov-user. The state tenant must contain a matching
  `common-masters.MobileNumberValidation` rule. `memberships/_ensure` accepts
  `mobileNumber` plus `countryCode` and otherwise reuses them from an existing
  managed account. Without a valid contact, that tenant's account is not created.
- **Separate accounts per tenant:** a person in two Organizations has two DIGIT
  accounts (different UUIDs) and receives the account matching the selected
  tenant. Cross-tenant work under one DIGIT identity would need gateway changes.
- **Per-tenant encryption key:** creating an account at a new tenant needs its
  egov-enc-service key; the worker ensures it via `DIGIT_ENC_GENERATE_KEY_URL`.
- **Token lifetime is DIGIT's:** tokens follow `access.token.validity.in.minutes`
  (7 days by default). Rotation does not revoke the previous token; the BFF
  revokes explicitly on logout, role change and deactivation.
- **One token per account:** logout from one browser revokes the DIGIT tokens
  shared with that person's other BFF sessions. Their next selection mints new
  ones. Revocation calls egov-user `/user/_logout` directly
  (`DIGIT_USER_LOGOUT_URL`), because Kong would evaluate RBAC at the account's
  home tenant.
- **Reconciliation inventory:** every managed tenant is recorded on the
  Keycloak user as `digit.managedTenants`. Redis keeps a faster
  `digit-managed-accounts` index, but a full reconciliation rebuilds from the
  durable Keycloak attribute and still deactivates former members after Redis loss.

## Control-plane API

Provisioning routes require `IDENTITY_CONTROL_PLANE_TOKEN` and are idempotent:

- `POST /internal/identity/v1/organizations/_ensure` — `{tenantId, alias, name}`; `409` until the DIGIT tenant exists.
- `POST /internal/identity/v1/memberships/_ensure` — `{organizationId, userId, mobileNumber?}` → `{tenantId, digitUserUuid, created}` for that tenant's account. Adds Keycloak membership, then creates or updates the managed account. `digitUserUuid` input is rejected: legacy employees are not linked.
- `POST /internal/identity/v1/role-assignments/_ensure` — sets an Organization group's allowlisted client roles and projects them to DIGIT.
- `POST /internal/identity/v1/reconciliation/_run`
- `POST /internal/identity/v1/identifiers/_check` — live Organization/tenant collision check; uses the narrower introspection credential.

PGR authenticates the onboarding tenant admin through the narrower
`POST /internal/identity/v1/sessions/_introspect` with its own
`IDENTITY_SESSION_INTROSPECTION_TOKEN`, which cannot provision anything.

A provisioning worker should call `organizations/_ensure` →
`memberships/_ensure` → `role-assignments/_ensure` after it has created the
tenant foundation.

Startup reconciliation is on unless `IDENTITY_RECONCILE_ON_STARTUP=false`; periodic
(`IDENTITY_RECONCILIATION_INTERVAL_SECONDS`) reconciliation take a Redis lease,
read enabled mapped Organizations and their group roles from Keycloak, and apply
them to managed accounts through egov-user. Former members are deactivated.
Members without an account yet are reported as `unprovisioned`, not failures.

## Onboarding worker (optional)

Enabled only with `ONBOARDING_WORKER_ENABLED=true` plus `PGR_ONBOARDING_WORKER_URL`
(internal PGR base, e.g. `http://pgr-services:8080/pgr-services`) and
`PGR_ONBOARDING_WORKER_TOKEN`. Every `ONBOARDING_WORKER_INTERVAL_SECONDS` it:

1. leases a `PENDING` operation with `POST /v2/onboarding/internal/operations/_claim`
   (PGR uses `FOR UPDATE SKIP LOCKED`; an expired lease is re-claimable);
2. runs idempotent steps, recording each in `completedSteps`:
   - `TENANT_FOUNDATION`: creates an independent root with the copied
     `tenant.tenants` schema, a root self-record, the tenant-local
     `ACCESSCONTROL-ROLES.roles` schema and only the roles required by the first
     tenant-admin account, plus the encryption key needed by egov-user. Role
     visibility is confirmed before account creation so asynchronous MDMS
     persistence cannot race egov-user validation. It uses a separate
     `DIGIT_PROVISIONER_*` credential and `DIGIT_MDMS_SCHEMA_*`,
     `DIGIT_MDMS_CREATE_URL`, `DIGIT_MDMS_V2_SEARCH_URL`,
     `DIGIT_FOUNDATION_SOURCE_TENANT`, and `DIGIT_ENC_GENERATE_KEY_URL`;
   - `ORGANIZATION`: Keycloak Organization `organizationAlias` mapped to the tenant;
   - `TENANT_ADMIN_MEMBERSHIP`: adds the signup owner to it;
   - `TENANT_ADMIN_ROLES`: `ONBOARDING_TENANT_ADMIN_GROUP` with
     `ONBOARDING_TENANT_ADMIN_ROLES`;
   - `DIGIT_ACCOUNT`: the tenant admin's managed DIGIT account at the new tenant,
     created with `tenantMetadata.tenantAdmin.mobileNumber` (or the tenant admin's
     existing managed mobile), and its projected roles;
3. reports `_complete` (operation `SUCCEEDED`, signup `ACTIVE`) or `_fail` with
   `retryable` (`RETRYABLE_FAILED`; the owner may `_retry`) or terminal
   (`TERMINAL_FAILED`, identifiers retained as a quarantine because partial
   Keycloak/DIGIT objects may already exist).

Transient Keycloak/DIGIT/tenant-visibility errors are retryable. Conflicts
(alias taken, colliding legacy account, missing tenant-admin mobile) are terminal.
No application bootstrap is performed. Apart from the technical tenant schema,
self-record, minimum tenant-admin role definitions and encryption key, the root
is empty: boundaries, departments, service definitions, actions/role-actions,
workflow, localization and dashboard configuration are deferred to the
management/configuration flow. The PGR signup
record remains the onboarding metadata/saga snapshot until that flow materializes it.
A PGR outage only logs a skipped worker cycle.

The default tenant-admin bundle is `TENANT_ADMIN`, `GRO`, `ACCOUNT_ADMIN`,
`MDMS_ADMIN`, `LOC_ADMIN`, and `SUPERUSER`. `TENANT_ADMIN` controls BFF
Organization administration. The remaining allowlisted roles are projected to
the tenant-local DIGIT account so the initial administrator can operate PGR and
the existing configuration surfaces. Deployments may narrow the bundle only
after their access-control actions have an equivalent tenant-admin role.

## Docker Compose deployment

The canonical CCRS deployment is `local-setup/docker-compose.egov-digit.yaml`.
Setting `enable_keycloak: true` starts the BFF, Keycloak 26.7.3 and its dedicated
Postgres database. Ansible runs `configure-keycloak.sh` with task-scoped secrets
after Keycloak is healthy. It creates or updates the shared Organizations realm,
confidential clients, protocol mappers, service-account permissions, roles,
magic-link flow, and configured Google/GitHub providers.

Kong publishes `/identity/v1` and `/auth`; the internal control plane is not
registered with Kong. `deploy/digit-compose/` remains a standalone overlay and
configuration reference. Production should use a dedicated DIGIT employee
holding only `ACCOUNT_ADMIN`; the bootstrap admin fallback exists only for
migration and local environments.

## Failure behavior

- Missing Redis or Keycloak prevents the relevant identity operation.
- Missing PGR has no effect on BFF startup or sign-in.
- Unavailable egov-user or MDMS still permits OIDC login, but tenant listing and
  selection fail closed with `503`, and no DIGIT token is issued.
- `/livez` checks only the process, while `/readyz` checks Redis, Keycloak JWKS,
  MDMS and egov-user reachability. PGR is deliberately not a readiness dependency.
