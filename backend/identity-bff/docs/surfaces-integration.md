# Surfaces integration status

This is the owner integration record for lane E. It distinguishes inspected
evidence from accepted implementation. The completion gate is still open.

## Integrated

- Owner branch includes the frozen contract and root fixes through base
  `83f2c240e`, merged at `50067f68a` without conflicts.
- The earlier digit-ui slug-cache change is included through `7cc754440`.
  Its original verification is carried by the handoff; this review has not
  rerun that suite.

## Work in progress

| Owner | Scope | Integration state |
| --- | --- | --- |
| surf-bff | Items 1–4, 13, 15 | Registry/HTTP OTP and refresh slices committed; self-service, phone, readiness and full verification pending |
| surf-keycloak | Realm configuration, extraction, public branding | WIP preserved; local theme/deployment checks recorded; live gate pending |
| surf-configurator | Members, invites, account actions, workspace settings | Contract agreed; implementation underway |
| surf-digitui | Phase 2 account actions, phone, invites, logout | Accepted; implementation underway |
| surf-tests | Item 18 migration and complete gate matrix | Accepted; baseline inventory and migration underway |

The task identifiers and durable coordination records live in Agent Bridge.
No leaf task is marked verified by this record.

## Reviewed evidence

- BFF registry and HTTP delivery: `c53603ff5`. Inspected sender contract,
  method catalogue, surface configuration and unit assertions. The original
  full-suite log reports 205 passed and 21 todo; this predates later merges.
- Refresh resilience: `a7b6a60ac`; focused log reports four tests passed.
  Subsequent integration at `083e66ddc` reports 40 passed and 36 skipped
  in a targeted run. Skips do not establish full-suite coverage.
- Keycloak extraction baseline: `f2dbf9abb`, plus uncommitted work reported
  by its leaf. Inspected local logs report 57 theme tests and 110 deployment
  contract tests passed. These logs are interim, not a final immutable
  verification artifact. The live harness has not supplied a passing result.
- Keycloak draft PR 50 is now pinned at `d3e2c8a0c` for review. The theme
  CI passed. The realm and BFF jobs failed before executing their suites;
  concrete findings are below. Packaging and live checks remain pending.
- Integration-test discovery at `171e5fe1a` found 278 cases in 88 files.
  Discovery is not execution or a pass-rate baseline. The test leaf records
  the exact per-file mapping and the existing dashboard-harness type error.

Final PR evidence must pin the tested commit and include commands, exit codes,
test counts and logs. Every lane-E gate needs executed coverage, including
the real-dependency cases; mocked tests do not satisfy those cases.

## Review findings and integration holds

- Refresh lease failure classification at `083e66ddc`: the generic refresh
  catch changes `LeaseLostError` into `IDENTITY_UNAVAILABLE`; lease acquisition
  errors also need an HTTP mapping. Preserve the frozen `503 IDENTITY_BUSY`
  response with `Retry-After`. Sent to surf-bff for correction and HTTP-level
  coverage before accepting the refresh slice.
- Core changed the registry integration order: surf-bff may now land narrow
  `surfaceContextKind(surface)` checks on the current access-context routes.
  Core-bindings will apply its later `_select` rewrite on that published SHA.
  Session parsing consumes `parseSurface`.
- Scoped logout, phone-session invalidation, identifier propagation and
  readiness consume core APIs from `docs/core-internals.md`; no duplicate
  implementation is permitted. Final provider commits are awaited.
- Root settled D18: core-bindings provides session-authenticated
  `POST /identity/v1/workspace-members/_updateEmail {tenantId,digitUuid,email}`.
  It requires live tenant ACCOUNT_ADMIN and an ACTIVE target binding; sets
  Keycloak email with emailVerified=false under the target lease; sends
  VERIFY_EMAIL; returns 202 `{status:"verification_sent"}`. A conflicting
  Keycloak email returns 409 IDENTITY_EMAIL_CHANGED. DIGIT changes only after
  verification. Configurator is implementing this contract.
- PR 50 realm CI fails SC2155 on readonly command substitutions; separate
  assignment and declaration so failed configuration reads propagate.
- PR 50 BFF CI uses REDIS_PORT=6379, producing JWKS_PORT=-1 in the existing
  test formula. Configure its supported IDENTITY_TEST_JWKS_PORT override.
  Both findings were returned to surf-keycloak before integration.

## Agreed consumer contracts

- Keycloak emits `digit.auth.account.actions` as CSV with the five frozen
  action names. BFF eligibility checks still apply; phone-only account arrays
  stay empty. Both user and admin event retention are seven days.
- Configurator workspace setup and rename call PGR directly with a DIGIT
  token. Contract: `b0f7b37770d99acc0579eb830d93f8ebcbedf053`,
  `backend/pgr-services/docs/onboarding-workspace-contract.md`.
- Missing workspace rows mean legacy DONE/open, with null probe and audit
  fields. Rename 202 means accepted, not applied. Retry the original request;
  use fresh Workspace.version for new actions. Rename.version never replaces
  a newer Workspace.version.
- Invitation expiry uses `identity.invitationPolicy`, record `default`,
  `invitationExpiryHours` 1..2160, default 336.
- Root decision on approval `apr_2a08b76cd6b041a8b7958fb3d8f67999` defers
  notification to the old email address. No custom Keycloak extension is
  authorized for it. D18 still requires verification of the new address,
  propagation to DIGIT only after verification, and the admin email path.
  Record the old-address notice as deferred rather than a failed D18 gate.

Only root merges the owner PR into completion-base. This branch does not
authorize deployment or removal of the final legacy login paths before the
completion gate.

## Real-dependency run plan

Root prohibited a full local DIGIT stack while the fleet is running. The test
leaf prepares endpoint-configured suites using IDENTITY_E2E_BASE_URL,
KEYCLOAK_URL, DIGIT_USER_URL and EGOV_OTP_URL plus test-account configuration.
Suites skip cleanly without those endpoints; Keycloak-only dry runs use the
isolated 26.7.3 fixture. Compilation, explicit skips and the Keycloak dry run
are development evidence, not full-gate evidence. Root runs the full persona
and non-fixed citizen OTP suites on the 8c dev box at the completion gate.
O2 remains **pending gate run**, with timing decided by the human.
