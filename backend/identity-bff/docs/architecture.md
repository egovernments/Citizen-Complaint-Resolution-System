# Identity BFF architecture

This page is the short map of DIGIT browser identity. The frozen contract (routes, error codes, Keycloak state, the Redis keyspace, the derived credential and the onboarding rules) is [identity-bff.md](identity-bff.md). The design behind it is `IDENTITY-BFF-BOUNDARY-FREEZE.md` revision 7.1. For a deployment walkthrough, use the repository-level [setup guide](../../../docs/setup/deployment/identity-bff.md).

## Boundary

```text
Browser ── OIDC redirect + opaque cookie ──> Identity BFF ──> Keycloak
                                                   │
                                                   └───────> egov-user (admin reads, identifiers,
                                                             derived staff credential, logout)
PGR onboarding ── onboarding token ─────────> Identity BFF (onboarding primitives only)

Browser ── DIGIT RequestInfo.authToken ───────────────────> DIGIT APIs
```

The BFF is a credential-to-account broker. It does three things:
1. It turns a Keycloak sign-in, or a verified citizen phone, into one DIGIT account and its token, for the tenant the URL names.
2. It keeps that binding, and Keycloak's mirror of DIGIT roles, status and name, consistent.
3. It enforces and revokes access.

It never proxies DIGIT business calls, writes MDMS or HRMS, holds a role catalogue, accepts a person's password, or runs the onboarding steps (PGR does). The frontend never receives Keycloak tokens.

## Sources of truth

| Concern | Source |
|---|---|
| Credentials, identity providers, MFA, sign-in flows | Keycloak |
| Organization membership | Keycloak Organizations |
| Which DIGIT account a person uses at a tenant | `digit.bindings` on the Keycloak user (written by the BFF) |
| Roles, employment status, descriptive profile, tenant name | DIGIT (egov-user, HRMS, MDMS), mirrored into Keycloak (`digit.accounts`, `firstName`, Organization `name`) |
| Verified login identifiers (staff email, citizen phone) | Keycloak, written into DIGIT after verification |
| Sign-in and sign-up methods per surface, and allowed account actions | Client attributes `digit.auth.signin.methods`, `digit.auth.signup.methods`, `digit.auth.account.actions` |
| Onboarding steps, their order and retries | PGR (`restartNo` on the operation row) |
| Business authorization | DIGIT roles and access control |

**Access** to a tenant = DIGIT `active` AND the identity-side predicate:
- staff: the Keycloak user is enabled, has an `active` binding, and is a member of the Organization;
- citizen: the Keycloak user is enabled and holds a verified phone.

## Sign-in sequence

1. The browser loads the surface's methods from `GET /identity/v1/auth-methods`.
2. `GET /identity/v1/authorize` starts Authorization Code + PKCE at Keycloak (an IdP adds `kc_idp_hint`). Citizens may sign in by phone OTP through the BFF instead.
3. Keycloak returns to `/identity/v1/callback`. The BFF checks state, nonce and PKCE, stores the tokens in Redis, and sets an opaque HttpOnly cookie.
4. The page calls `_select` for the tenant. Under the person lease, the BFF re-reads the session, checks the access predicate, and returns the DIGIT token: a cached one if egov-user still accepts it, else a new one minted with the derived staff credential or the citizen OTP grant.

## Revocation

Keycloak events (read by a poller), reconcile (HRMS deactivation, role change, Organization or tenant disabled, a missing DIGIT account) and logout all lead to the same step. The BFF logs out every inventoried DIGIT token of the person and ends their BFF sessions. Failed logouts are retried from a Redis set until the token expires.

## Deployment units

- `identity-keycloak`: Keycloak 26.7.3, the magic-link extension and the login theme.
- `identity-bff`: the browser API, sessions, bindings, sync and revocation.
- Redis: sessions, leases, the token inventory, OTP challenges and the event checkpoint. Every family is re-derivable, restartable, or a documented limit.
- Keycloak's Postgres and the DIGIT egov-user, HRMS and MDMS services.

Only `/identity/v1` and the required `/auth/realms/...` and `/auth/resources/...` paths are public. The Keycloak Admin API and `/internal/identity/v1` stay private.

## Further reading

- [Frozen contract](identity-bff.md)
- [Identity BFF README](../README.md)
- [Deployment and integration setup](../../../docs/setup/deployment/identity-bff.md)
- [Environment reference](../deploy/digit-compose/identity-bff.env.example)
