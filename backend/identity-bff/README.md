# DIGIT Identity BFF

The Identity BFF is the single boundary between browser authentication,
Keycloak, and DIGIT identity. Keycloak owns how a person signs in and which
Organizations they belong to. The BFF owns the browser session, tenant choice,
role projection, and the compatibility call that returns a normal user-scoped
DIGIT token.

```text
Browser -- OIDC + opaque cookie --> Identity BFF --> Keycloak
                                      |
                                      +-----------> egov-user

Browser -- RequestInfo.authToken ----------------> normal DIGIT APIs
```

Keycloak access, ID, and refresh tokens never reach the frontend. The BFF is
not in the business-API hot path and has no hard dependency on PGR. Its optional
onboarding worker is disabled unless explicitly configured.

Start with the [architecture one-pager](docs/architecture.md), then use the
[full API and operations guide](docs/identity-bff.md) or the repository-level
[deployment and integration setup](../../docs/setup/deployment/identity-bff.md).

## Browser API

```http
GET  /identity/v1/auth-methods?surface=employee&intent=signin
GET  /identity/v1/authorize?method=password&intent=signin&returnTo=/configurator/login
GET  /identity/v1/authorize?surface=citizen&tenantSlug=bomet&returnTo=/bomet/digit-ui/citizen/
POST /identity/v1/authentication/magic-link-requests
GET  /identity/v1/callback
GET  /identity/v1/auth-results/:id
POST /identity/v1/password/setup-requests
GET  /identity/v1/password/setup-complete/:state
GET  /identity/v1/session?surface=employee
GET  /identity/v1/tenant-contexts/:urlSlug
GET  /identity/v1/tenant-contexts/:urlSlug/branding?locale=en_IN
GET  /identity/v1/tenants
POST /identity/v1/contexts/_select
POST /identity/v1/contexts/citizen/_select
POST /identity/v1/organization-members/_invite
POST /identity/v1/logout
```

`GET /identity/v1/tenants` returns the intersection of live Keycloak
Organization memberships and active BFF-managed DIGIT accounts. Selecting a
tenant returns the existing egov-user login shape, including `access_token` and
`UserRequest`; existing DIGIT API calls continue unchanged.

`GET /identity/v1/tenant-contexts/:urlSlug` is the public routing lookup used
by tenant-prefixed applications such as `/{urlSlug}/digit-ui/employee`. It
returns safe tenant metadata only. The lookup does not grant membership or
authorize a tenant; authenticated employee access is still enforced by
`POST /identity/v1/contexts/_select`. The response carries the immutable
`tenantId`, explicit `rootTenantId`, nullable `parentTenantId`, and ordered
`fallbackTenantIds`; clients never infer hierarchy from the slug or tenant id.

Sign-in has three surfaces. `configurator` is the default whenever `surface`
is absent and behaves exactly as before. digit-ui's `employee` and `citizen`
surfaces each use their own Keycloak client, flow, theme and session cookie,
and their tenant comes only from the `/{tenantSlug}/digit-ui/{surface}/`
route: `/authorize` resolves `tenantSlug` server-side and binds it to the
login attempt and session. An employee session can select only that tenant;
`POST /identity/v1/contexts/citizen/_select` takes it from the session, ensures
the citizen's registration and BFF-managed DIGIT `CITIZEN` account, and
returns a `CITIZEN` token. The public `.../branding` route gives the Keycloak
themes the tenant's legacy login branding and texts. Citizen token minting is
not yet verified against a live egov-user; see
[the guide](docs/identity-bff.md#digit-ui-employee-and-citizen-sign-in-2167).

These routes are application-neutral. A caller supplies a validated `returnTo`
path (or an absolute URL on `IDENTITY_ALLOWED_ORIGINS`), and the deployment
configures Keycloak hosts, clients, and callbacks. Configurator is one client,
not a route or redirect embedded in the BFF.

## Internal API

The following routes are reachable only on the internal service network and
require a workload bearer token:

```http
POST /internal/identity/v1/organizations/_ensure
POST /internal/identity/v1/tenant-groups/_ensure
POST /internal/identity/v1/memberships/_ensure
POST /internal/identity/v1/role-assignments/_ensure
POST /internal/identity/v1/reconciliation/_run
POST /internal/identity/v1/sessions/_introspect
POST /internal/identity/v1/identifiers/_check
```

Session introspection uses a separate narrow credential. PGR or another
onboarding domain can call these contracts, but none of the routes contains a
PGR model.

## Local development

Node.js 22 and Redis are required:

```bash
npm ci
REDIS_PORT=6379 npm test
npm run build
```

To run the service, configure the variables documented in
[`deploy/digit-compose/identity-bff.env.example`](deploy/digit-compose/identity-bff.env.example),
then run `npm start`. The repository deployment uses
`local-setup/docker-compose.egov-digit.yaml`; the files under
`deploy/digit-compose/` are a small standalone overlay and Keycloak
configuration reference.

## Modules

Read the code in this order:

1. `src/app/create-app.ts` — composition and public/internal route registration.
2. `src/infrastructure/config.ts` — runtime contract.
3. `src/modules/authentication` and `src/modules/sessions` — OIDC and opaque sessions.
4. `src/modules/access-context` — tenant routes, tenant list and selection
   (employee and citizen contexts); `src/modules/citizens` — citizen
   registrations; `src/modules/branding` — public login branding.
5. `src/modules/managed-accounts` — per-tenant egov-user accounts and DIGIT tokens.
6. `src/modules/organizations` — Organizations, membership, roles, and invites.
7. `src/modules/reconciliation` — startup and periodic Keycloak-to-DIGIT sync.
8. `src/modules/control-plane` — workload-facing idempotent provisioning API.
9. `src/modules/onboarding` — optional PGR worker and minimal tenant foundation.
10. `src/modules/operations` — liveness, health, and readiness.

## Deployment

The `keycloak` Compose profile starts:

- `identity-keycloak`, built from `keycloak/Dockerfile.magic-link`, which pins
  Keycloak 26.7.3 and the Phase Two magic-link provider;
- `identity-bff`, built from this folder; and
- the existing dedicated Keycloak Postgres container.

The current Configurator login is an Identity-BFF client, so deployments that
publish `/configurator/` must also enable this `keycloak` profile and publish
the `keycloak` nginx feature when rolling out this Configurator build. It does
not silently fall back to the legacy direct egov-user password form. Older
Configurator images remain deployable without the identity profile, so the
shared playbook does not impose this requirement on every historical image.

Ansible runs `deploy/digit-compose/configure-keycloak.sh` after Keycloak is
healthy. The script idempotently enables Organizations and reconciles the BFF,
magic-link resource client, admin, role, Google, and GitHub configuration. Kong publishes only
`/identity/v1`; `/internal/identity/v1` remains private.
