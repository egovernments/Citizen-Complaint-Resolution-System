# Identity BFF architecture

This page is the short architectural map for DIGIT browser identity. For API
payloads and operational details, use the [BFF guide](identity-bff.md). For a
deployment walkthrough, use the repository-level
[setup guide](../../../docs/identity-bff-deployment.md).

## Boundary

```text
Browser ── OIDC redirect + opaque cookie ──> Identity BFF ──> Keycloak
                                                   │
                                                   └───────> egov-user

Browser ── DIGIT RequestInfo.authToken ───────────────────> DIGIT APIs
```

- Keycloak owns credentials, authentication flows, external identity
  providers, users, Organizations and membership.
- The Identity BFF owns Authorization Code + PKCE, server-side Keycloak tokens,
  the opaque browser session, tenant selection and projection into a
  tenant-local DIGIT account.
- DIGIT access control remains authoritative for business APIs. The BFF returns
  the existing user-scoped DIGIT token shape and is not a business-API proxy.
- The frontend never receives Keycloak tokens or submits a password to the BFF.

## Sources of truth

| Concern | Source |
|---|---|
| OIDC endpoints, client secrets, callbacks | deployment secrets/environment |
| Sign-in and signup method policy/order | `digit-identity-bff` Keycloak client attributes |
| OAuth provider availability and display name | live Keycloak Identity Provider instances |
| Password capability | enabled BFF OIDC client and standard browser flow |
| Magic-link capability | enabled magic-link client plus the BFF client secret |
| Tenant membership | Keycloak Organizations |
| Business authorization | DIGIT roles/access-control data |

The BFF exposes the composed result through
`GET /identity/v1/auth-methods?intent=signin|signup`. Signup renders the
available methods from this response. Sign-in uses it only to confirm that the
hosted Keycloak entry is available, then hands method selection to Keycloak so
password, Google and GitHub stay on one authentication screen. Neither UI keeps
its own provider list. Keycloak client attributes are:

```text
digit.auth.signin.methods=password,google,github
digit.auth.signup.methods=magic_link,google,github
```

The order in each attribute is the display order. Unknown or disabled provider
aliases are omitted. Missing policy or an unavailable Keycloak Admin API fails
closed; the BFF does not fall back to an environment-owned method catalog.

## Authentication sequence

1. The browser loads the journey's methods from the BFF.
2. Password and OAuth methods start Keycloak Authorization Code + PKCE. OAuth
   adds only the selected `kc_idp_hint`.
3. Magic-link signup stores the submitted name/email as a short-lived draft and
   asks the authenticated Keycloak extension to send a one-use link.
4. Keycloak returns a code to the BFF callback. The BFF validates state, nonce
   and PKCE, stores tokens in Redis and sets an opaque HttpOnly cookie.
5. The browser loads eligible Organizations, selects one, and receives the
   normal tenant-scoped DIGIT login response.

## Deployment units

- `identity-keycloak`: Keycloak 26, the magic-link extension, and the
  `configurator-blue` Keycloakify login theme.
- `identity-bff`: browser API, sessions, tenant context and projection.
- Redis: login attempts, callback results and opaque sessions.
- Existing Keycloak Postgres and DIGIT egov-user/MDMS services.

`configure-keycloak.sh` idempotently creates the realm clients, client
attributes, providers, mappers, roles and theme selection. Only `/identity/v1`
and the required `/auth/realms/...` and `/auth/resources/...` surfaces are
public; the Admin API and `/internal/identity/v1` remain private.

## Further reading

- [Identity BFF README](../README.md)
- [Complete API and operations guide](identity-bff.md)
- [Deployment and integration setup](../../../docs/identity-bff-deployment.md)
- [Environment reference](../deploy/digit-compose/identity-bff.env.example)
- [Keycloak provisioning script](../deploy/digit-compose/configure-keycloak.sh)
