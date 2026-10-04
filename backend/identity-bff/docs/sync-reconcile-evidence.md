# Sync reconciliation verification

Item 12 final increment, executed 2026-10-04 on owner base `677e18b00`.
Earlier increments: draft PRs #40 (safe writer), #44 (mirror), and #51
(identifier propagation), merged and independently checked by core-owner.

## Executed checks

- `npx tsc --noEmit`: passed.
- `REDIS_PORT=16388 npx vitest run`: 416 passed, 8 opt-in real tests skipped,
  15 existing TODO tests; 34 files passed, 2 real-suite files skipped.
- `REDIS_PORT=16388 node tests/fixtures/keycloak/run.mjs`: 8/8 passed on
  stock Keycloak 26.7.3. No extension or SPI is used.
- After adding the explicit reactivation-before-relink assertion:
  `REDIS_PORT=16388 npx vitest run tests/e2e/identity-bff.test.ts`: 61/61 passed.
- `git diff --check`: passed.

The real suite and ordinary suite must run sequentially in a lane because
both use its shared JWKS test listener and signing-key fixture. An initial
overlapping invocation collided; the independent reruns above passed.

## Acceptance evidence

`tests/e2e/keycloak-writer.real.test.ts` (five real Keycloak cases):

- `preserves email, emailVerified, username and unrelated attributes`
- `does not undo an admin disable between its fresh GET and PUT`
- `never mirrors a masked DIGIT name into the real user profile`
- `propagates a changed staff email only after Keycloak reports it verified`
- `reports a typed conflict when changing to another real user's email`

`tests/e2e/sync-reconcile.real.test.ts` (three real Keycloak cases):

- `mirrors an MDMS tenant rename without changing Organization lifecycle or membership`
- `revokes a disabled Organization's inventoried token without changing its binding`
- `revokes removed membership without recreating it or changing the binding`

These reconciliation tests use real Keycloak enumeration, users, attributes,
Organizations and memberships, real Redis, and the actual revocation provider
and token inventory. DIGIT account reads, MDMS responses and the external
DIGIT logout are controlled test seams; identifier propagation is covered in
its separate suite. The real writer email test controls the DIGIT writer while
exercising the actual Keycloak verification gate. These are not live DIGIT or
MDMS integration claims.

`tests/unit/sync-reconcile.test.ts` (18 cases) covers:

- HRMS deactivation and role changes remove the actual Redis token inventory
  through the real revocation provider (only external logout is stubbed).
- Scheduled deactivation detection at the configured interval; reactivation
  updates the mirror without an account, binding or membership write.
- Missing marking, unchanged-fingerprint membership checks, Organization
  disable/FAILED and MDMS inactivity revocation outside person leases.
- 103 users across cursor pages, at most four concurrent subject workers.
- Global lease renewal past the initial TTL, loss fencing, competing sweeps,
  lag/readiness, durable forced requests, in-flight generation changes and
  unsuccessful passes retaining their forced request.

`tests/unit/sync-mirror.test.ts` retains the concurrent-HRMS-edit test: an edit
arriving during a mirror pass appears on the next pass without a DIGIT write.
`tests/e2e/identity-bff.test.ts` retains the employee selection scenario and
asserts that HRMS reactivation restores selection before any relink. Legacy
reconcile assertions now check the frozen counters and that DIGIT `active`
remains untouched after membership removal and Redis index loss.

`tests/contract/reconcile.test.ts` (three cases) checks operator authorization,
200/202 acquisition behavior, no-store, and the frozen counter response.
No test was removed.

## Runtime integration and limits

`server.ts` starts only the new scheduler. The former
`runIdentityReconciliation` has no runtime callers. The operator endpoint uses
`runReconcile`; its catalogue and documentation state are live.

Forced requests use generations in the existing `identity:reconcile:stats`
hash. Only a zero-failure full sweep advances the observed generation and
last-complete timestamp. Fingerprints skip mirror writes, never access or
identifier checks. Tenant-wide revocation runs outside person leases.

Stock Keycloak rejects the initial name-only Organization PUT. Following the
owner decision, renames now GET the fresh complete representation and replace
only `name` before PUT, preserving domains, alias, enabled, attributes and
other fields. This is outside person leases. Keycloak does not offer a CAS
for this representation, so an independent admin edit between that GET and
PUT is not serialized by the BFF. The real test verifies preservation of the
fresh representation; it does not claim atomicity against external admins.

The reconciliation response counts per-subject revocation operations, not
unique tokens; tenant-wide fan-out is handled separately by the revocation
provider. Readiness reports elapsed time since the last successful full pass.
