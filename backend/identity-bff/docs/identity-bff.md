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
| `GET` | `/identity/v1/auth-methods?intent=signin\|signup` | Client journey policy intersected with live Keycloak capabilities |
| `GET` | `/identity/v1/authorize?method=...&intent=...&returnTo=...` | Starts Authorization Code + PKCE with state and nonce |
| `POST` | `/identity/v1/authentication/magic-link-requests` | Saves a short-lived identity profile draft and sends the non-enumerating signup verification link |
| `GET` | `/identity/v1/callback` | Validates the callback and creates an opaque cookie session |
| `GET` | `/identity/v1/auth-results/:id` | Consumes a one-time, browser-safe callback result |
| `POST` | `/identity/v1/password/setup-requests` | Sends a non-enumerating password setup/recovery email |
| `GET` | `/identity/v1/password/setup-complete/:state` | One-time Keycloak action completion redirect |
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
   GET /identity/v1/authorize?method=password&intent=signin&returnTo=/configurator/login
   ```

   `google` and `github` use the same endpoint when advertised for `signin`.
   Signup asks for `intent=signup`, where the provisioned policy normally orders
   magic link, Google, and GitHub. Google and GitHub use `/authorize`; the client application starts
   email signup by posting first name, last name, and email to
   `POST /identity/v1/authentication/magic-link-requests`. The backend owns ordering
   and availability; the UI does not keep a second provider list.

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

Password, Google, and GitHub enter Keycloak's browser flow (brokered methods use
`kc_idp_hint`). Signup magic link does not render a Keycloak page: the BFF saves
the client-collected name/email as a short-lived Redis login attempt and
calls the extension's authenticated magic-link resource. Its emailed,
single-use action token returns an Authorization Code + PKCE result directly to
the same callback. Only then does the BFF mark the matching Keycloak profile
complete and create the opaque session. Keycloak tokens stay in Redis behind a
random HttpOnly cookie. `SameSite=Lax` is the
default; a cross-site development frontend may set `IDENTITY_COOKIE_SAME_SITE=None`
with a Secure cookie and an explicit `IDENTITY_ALLOWED_ORIGINS` entry.

Password accepts either username or email. Magic link uses a second confidential
Keycloak client and the extension's server-side resource, keeping the realm's
normal password flow unchanged. The BFF stores the selected OIDC client with
the one-time login attempt and opaque session, so callback exchange, refresh,
and logout use the correct client without exposing either client secret. The
method is advertised only when client policy includes it, that Keycloak client
exists and is enabled, and `KEYCLOAK_MAGIC_LINK_CLIENT_SECRET` is configured.
Password and OAuth methods are likewise derived from the BFF client policy and
live Keycloak client/provider state; there is no BFF runtime environment catalog
of login methods.

Google and GitHub are pinned to the realm's `digit-first-broker-login` flow.
When a provider returns an email already owned by a local account, Keycloak
does not create a duplicate: it asks the person to confirm linking and prove
control of the existing account by verified email or re-authentication. The
realm keeps duplicate emails disabled and does not trust broker-provided email
without that proof. Once linked, password, Google, and GitHub are credentials
of the same Keycloak user and therefore see the same Organization memberships.

Callback failures that Keycloak returns to the BFF are sent to the validated `returnTo` destination with only an
opaque `authResult` id. The UI consumes that id once through
`auth-results/:id`; provider details, tokens, and email addresses are never put
in the URL. Both relative paths and absolute URLs from
`IDENTITY_ALLOWED_ORIGINS` are accepted, so redirect and CORS policy have one
deployment source of truth.

Password setup is non-enumerating: every request gets the same `202` response,
whether the account exists, has a password, or only has federated credentials.
Eligible users receive Keycloak's one-use `UPDATE_PASSWORD` action (preceded by
`VERIFY_EMAIL` when needed). Requests are rate-limited by IP and an HMAC of the
normalized email (or the signed-in subject); raw identifiers are not logged.
The deployed BFF trusts exactly the configured host-nginx and Kong proxy hops,
so unrelated clients do not collapse into one gateway-IP bucket. Provider-only accounts
whose email has not yet been verified must first sign in with that provider;
the live BFF session then authorizes password setup without trusting an
unverified email claim. The completion state and its browser result are each
one-time and expire independently. Keycloak's execute-actions flow does not
append a completion flag, so first-password completion is confirmed against
the credential Admin API; a reset of an existing password is complete when its
one-use action returns through the configured application link.

The hosted Keycloak password screen keeps the configured Google and GitHub
choices visible after a generic invalid-credential error. It wears the
`configurator-blue` login theme (`keycloak/theme-src`, CCRS #2108), a Keycloakify
build of the Configurator's auth shell that covers every screen in this journey
and links back to the OIDC client's configured base URL for non-enumerating
password help. An OAuth-first user can therefore switch to the provider that
owns the account or return to recovery without the client application publicly
inspecting an email's credential types. Keycloak's native forgot-password entry remains disabled so
it cannot bypass the unverified-federated-account check above.

Magic-link email is a single-use bearer credential valid for 10 minutes by
default. The BFF may create an unverified Keycloak user record before sending
it, but DIGIT account
creation and tenant access still require Organization membership and the normal
managed-account rules; receiving a link grants no tenant by itself. A newly
created user goes directly from the email link to the callback without a hosted
profile screen; the BFF applies the submitted name only after the matching email
claim is verified. Existing users follow the same callback path.

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
| Logout | `POST /user/_logout` on the cached user token, once the last BFF session holding it has signed out | user token |

Every create/rotate/role change for one subject runs under a Redis lease
(`DIGIT_USER_LEASE_SECONDS`), so concurrent requests produce one rotation and
share the resulting token. The user token is cached in Redis until shortly
before egov-user's `expires_in`, alongside the set of BFF sessions currently
relying on it.

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
  dial prefix before calling egov-user. For a newly onboarded root, tenant
  foundation installs the selected country's default
  `common-masters.MobileNumberValidation` rule and waits for it to become
  readable before `DIGIT_ACCOUNT`; this prevents egov-user from using the host
  deployment's fallback regex. `memberships/_ensure` accepts
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
- **One token per account:** egov-user's token store returns the same access
  token for repeated password grants while that token is live, so one person's
  BFF sessions necessarily share it and it cannot be made per-session. Logout
  therefore releases only that session's claim and revokes at egov-user once
  the last claim is gone, so signing out on a phone does not 401 the same
  person's laptop. A role change or deactivation still revokes immediately for
  every session. Revocation calls egov-user `/user/_logout` directly
  (`DIGIT_USER_LOGOUT_URL`), because Kong would evaluate RBAC at the account's
  home tenant.
- **Read scope of a sign-in:** `contexts/_select` and `organization-members/_invite`
  read only the Organization mapped to the tenant in question and only the
  caller's own membership and assignment groups within it. Tenant *discovery*
  (`GET /identity/v1/tenants`) still lists the realm's Organizations and probes
  membership in each, because Keycloak exposes no reverse "Organizations of this
  user" read that also covers an Organization created mid-session by onboarding.
  That cost grows with the number of Organizations, not with the number of users.
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
     tenant-admin account, the selected country's default
     `common-masters.MobileNumberValidation` record, plus the encryption key
     needed by egov-user. Role and mobile-rule visibility are confirmed before
     account creation so asynchronous MDMS persistence cannot race egov-user
     validation or trigger its host-wide fallback. It uses a separate
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
self-record, minimum tenant-admin role definitions, prerequisite mobile rule,
and encryption key, the root
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
the magic-link resource client, journey-policy client attributes, and configured
Google/GitHub providers.

Realm SMTP is mandatory for the identity stack, not only for optional magic
links. Password setup/reset, invitation activation, and email proof in the
first-broker linking flow all depend on it; Ansible fails before bootstrap when
the mail settings are incomplete.

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
