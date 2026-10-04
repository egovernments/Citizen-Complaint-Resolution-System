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
| surf-digitui | Phase 2 account actions, phone, invites, logout | Assigned; launch pending |
| surf-tests | Item 18 migration and complete gate matrix | Assigned; launch pending |

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

Final PR evidence must pin the tested commit and include commands, exit codes,
test counts and logs. Every lane-E gate needs executed coverage, including
the real-dependency cases; mocked tests do not satisfy those cases.

## Review findings and integration holds

- Refresh lease failure classification at `083e66ddc`: the generic refresh
  catch changes `LeaseLostError` into `IDENTITY_UNAVAILABLE`; lease acquisition
  errors also need an HTTP mapping. Preserve the frozen `503 IDENTITY_BUSY`
  response with `Retry-After`. Sent to surf-bff for correction and HTTP-level
  coverage before accepting the refresh slice.
- Registry checks in access-context routes are held until core-bindings
  publishes its `_select` rewrite. Core accepted a narrow
  `surfaceContextKind(surface)` overlay after that change. Session parsing
  may already consume `parseSurface`.
- Scoped logout, phone-session invalidation, identifier propagation and
  readiness consume core APIs from `docs/core-internals.md`; no duplicate
  implementation is permitted. Final provider commits are awaited.
- Admin email changes are required by D18, but the frozen route list exposes
  only self-service `UPDATE_EMAIL`. Provider ownership and an admin route
  contract have been requested from core-owner and identity-root.

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

Only root merges the owner PR into completion-base. This branch does not
authorize deployment or removal of the final legacy login paths before the
completion gate.
