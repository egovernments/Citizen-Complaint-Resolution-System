# Identity BFF deployment and integration

This document is the repository-level deployment guide for the implementation
in [`backend/identity-bff`](../backend/identity-bff/README.md). The complete API,
flow, and failure contract is in
[`backend/identity-bff/docs/identity-bff.md`](../backend/identity-bff/docs/identity-bff.md).

## Object mapping

| DIGIT | Keycloak |
|---|---|
| root tenant | Organization with `digit.rootTenantId` |
| application access | client / client role |
| user identity | user principal |
| tenant access | Organization membership |
| tenant-specific role | role on the member's Organization group |

All tenants live in one shared realm (`digit` by default). A tenant is not a
realm. Keycloak is the source for authentication, Organization membership, and
the desired role assignment. DIGIT remains the authorization source used by
business services, so the BFF projects that state into a marked, tenant-local
egov-user account.

## Runtime flow

1. The browser asks the BFF for enabled authentication methods.
2. The BFF starts Keycloak Authorization Code + PKCE for password, magic link,
   Google, or GitHub.
3. Keycloak returns the code to the BFF callback. The BFF stores Keycloak tokens
   in Redis and gives the browser an opaque HttpOnly cookie.
4. The browser loads eligible tenants. The BFF checks live Organization
   membership and active managed DIGIT accounts.
5. The browser selects a tenant. The BFF reconciles current roles, logs in the
   tenant-local managed employee, and returns the normal DIGIT `access_token`
   and `UserRequest` response.
6. The frontend uses that token in existing `RequestInfo.authToken` calls.

The BFF does not proxy normal DIGIT APIs. Neither the frontend nor PGR receives
a Keycloak token or Keycloak admin credential.

## Enable the deployment

Set the following in the target host vars:

```yaml
enable_keycloak: true
nginx_features:
  keycloak: true

keycloak_organization_realm: digit
identity_bff_image: egovio/identity-bff:nightly-develop
identity_keycloak_image: egovio/identity-keycloak:nightly-develop
identity_digit_admin_username: IDENTITY_ACCOUNT_ADMIN
identity_digit_admin_tenant_id: pg
identity_smtp_host: smtp.example.org
identity_smtp_from: no-reply@example.org
identity_smtp_user: smtp-user
identity_auth_methods: >-
  [{"id":"password","label":"Email and password","type":"password","intents":["signin"]}]
```

Store these values in `bootstrap_secrets` for a new deployment, or in the
tenant's OpenBao path for an existing deployment:

```yaml
bootstrap_secrets:
  keycloak_admin_password: "<strong password>"
  keycloak_db_password: "<strong password>"
  identity_digit_admin_password: "<DIGIT ACCOUNT_ADMIN password>"
  identity_smtp_password: "<SMTP password>"
```

The deploy derives separate stable BFF-client and workload secrets from the
Keycloak admin secret and writes them only to the mode-0600 Compose environment.
A Keycloak admin-password rotation therefore also rotates those credentials on
the next converge.

### Optional authentication methods

SMTP is required for the identity stack even when magic link is disabled:
password setup/reset, invitation activation, and first-broker email proof all
send through the realm mail server. Deployment fails before changing Keycloak
when those settings are absent. Magic link additionally needs the custom
`identity-keycloak` image and:

```yaml
identity_magic_link_enabled: true
identity_auth_methods: >-
  [{"id":"password","label":"Email and password","type":"password","intents":["signin"]},{"id":"magic_link","label":"Email me a sign-in link","type":"magic_link","intents":["signup"]}]
```

Google and GitHub need their provider application callback set to Keycloak's
broker endpoint and the matching host-vars/OpenBao credentials. Advertise them
only after the provider is configured:

```yaml
keycloak_google_client_id: "<id>"
keycloak_github_client_id: "<id>"
identity_auth_methods: >-
  [{"id":"password","label":"Email and password","type":"password","intents":["signin"]},{"id":"google","label":"Continue with Google","type":"oauth","idpHint":"google","intents":["signin","signup"]},{"id":"github","label":"Continue with GitHub","type":"oauth","idpHint":"github","intents":["signin","signup"]}]
bootstrap_secrets:
  keycloak_google_client_secret: "<secret>"
  keycloak_github_client_secret: "<secret>"
```

The BFF checks Keycloak live and omits a configured OAuth or magic-link method
when its provider/client is not enabled. `intents` is the one backend-owned
source for which methods appear on sign-in and signup; omitting it keeps the
legacy behaviour of enabling a method for both journeys.

## Onboarding integration

The BFF is independently deployable. Its browser sign-in, tenant selection,
invitation, and reconciliation paths do not require PGR.

PGR may call the private session-introspection route with the narrow
introspection token. The optional in-process worker is off by default. Enable
`identity_onboarding_worker_enabled` only after the PGR workload endpoints are
deployed. It creates the minimal tenant foundation, Organization, tenant-admin
membership and roles, and managed DIGIT account. It does not bootstrap a usable
application configuration.

## Migration from token-exchange-svc

This change removes the external overlay build and `/kc` route. The old design
put a Keycloak JWT in the browser and used one admin identity for downstream
activity. The BFF instead keeps Keycloak tokens server-side and returns the
signed-in person's own DIGIT token after tenant selection, preserving audit
identity and existing DIGIT authorization.

Before enabling the profile in an existing environment:

1. Build/publish `identity-bff` and `identity-keycloak` from the same CCRS commit.
2. Add the new OpenBao values and use a real `ACCOUNT_ADMIN` employee.
3. Verify `/auth/realms/digit/.well-known/openid-configuration` and
   `/identity/v1/auth-methods?intent=signin` and
   `/identity/v1/auth-methods?intent=signup`.
4. Reconcile or provision Organization memberships and managed accounts.
5. Point the onboarding/employee frontend at `/identity/v1`; do not enable the
   legacy Keycloak auth adapter that expects `/kc`.

## Validation

```bash
curl -fsS https://example.org/auth/realms/digit/.well-known/openid-configuration
curl -fsS 'https://example.org/identity/v1/auth-methods?intent=signin'
curl -fsS 'https://example.org/identity/v1/auth-methods?intent=signup'
docker exec identity-bff wget -qO- http://127.0.0.1:3000/readyz
docker compose --profile keycloak ps keycloak identity-bff

# Keycloak's privileged surface must NOT be reachable: both return 404.
curl -s -o /dev/null -w '%{http_code}\n' https://example.org/auth/admin/
curl -s -o /dev/null -w '%{http_code}\n' \
  https://example.org/auth/realms/master/protocol/openid-connect/token
```

Only the login surface is published through Kong: `/auth/realms/<realm>/...`
and `/auth/resources/...`. `/auth/admin` (admin console and Admin REST API) and
`/auth/realms/master` are terminated with 404 at the gateway — see the
`keycloak-admin-denied` service in `local-setup/kong/kong.yml`. Operators who
need the console reach Keycloak on its loopback-bound port (`18180`), typically
over an SSH tunnel; the BFF and the Organizations configurator use the private
`keycloak:8180` address and are unaffected.

`/readyz` checks Redis, Keycloak JWKS, MDMS, and egov-user. PGR is deliberately
not a readiness dependency.
