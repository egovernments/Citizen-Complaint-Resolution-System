# Sync reconciliation verification

Item 12 final increment, executed 2026-10-04 on owner base `1fae11312` (including revocation PR #56 and bindings PR #61).
Earlier increments: draft PRs #40 (safe writer), #44 (mirror), and #51
(identifier propagation), merged and independently checked by core-owner.

## Executed checks

- `npx tsc --noEmit`: passed.
- `REDIS_PORT=16388 npx vitest run`: 498 passed, 11 opt-in real tests skipped,
  10 existing TODO tests; 39 files passed, 3 real-suite files skipped.
- `REDIS_PORT=16388 node tests/fixtures/keycloak/run.mjs`: 9/9 passed on
  stock Keycloak 26.7.3. No extension or SPI is used.
- Affected regression/contract/integration suite: 34/34 passed.
- The full run includes the explicit reactivation-before-relink assertion.
- `git diff --check`: passed.

The real suite and ordinary suite must run sequentially in a lane because
both use its shared JWKS test listener and signing-key fixture. An initial
overlapping invocation collided; the independent reruns above passed.

## Acceptance evidence

`tests/e2e/keycloak-writer.real.test.ts` (six real Keycloak cases):

- `preserves email, emailVerified, username and unrelated attributes`
- `does not undo an admin disable between its fresh GET and PUT`
- `never mirrors a masked DIGIT name into the real user profile`
- `propagates a changed staff email only after Keycloak reports it verified`
- `reports a typed conflict when changing to another real user's email`
- `seeds a resolved citizen once and mirrors it while preserving the real identity`

`tests/e2e/sync-reconcile.real.test.ts` (three real Keycloak cases):

- `mirrors an MDMS tenant rename without changing Organization lifecycle or membership`
- `revokes a disabled Organization's inventoried token without changing its binding`
- `revokes removed membership without recreating it or changing the binding`

These reconciliation tests use real Keycloak enumeration, users, attributes,
Organizations and memberships, real Redis, and the actual revocation provider
and token inventory. DIGIT account reads, MDMS responses and the external
DIGIT logout and credential-recovery lookup are controlled test seams; identifier propagation is covered in
its separate suite. The real writer email test controls the DIGIT writer while
exercising the actual Keycloak verification gate. These are not live DIGIT or
MDMS integration claims.

`tests/unit/sync-reconcile.test.ts` (30 cases) covers:

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

## Review correction: persistent denial

The initial PR repeated credential recovery on every denied-state pass. The
owner's final decision on thread `core` is implemented as follows:

- Full credential fallback occurs only on DIGIT transitions against the
  previous mirror: active to inactive, present to missing, changed roles, or
  a staff entry losing its binding. Revocation precedes applying the mirror,
  preserving a retry after failure.
- Keycloak disabled, non-member and other steady denial checks call the real
  revocation provider with `{fallback: false}`. This still ends sessions and
  removes inventoried tokens, including tokens that appeared after an earlier
  pass, without a credential-recovery password grant. A person generation
  increment on these calls is intentional, per the owner decision.
- Tenant fan-out occurs only when `tenant:<id>` in the existing reconciliation
  stats hash changes between `active`, `ORGANIZATION_DISABLED`, and
  `TENANT_INACTIVE`. Its checkpoint follows successful fan-out and is fenced
  by the global run lease. Recovery resets the observation; failed fan-out
  retains the prior state for retry. No subject-state cache or key family was
  added.

Regression cases run the actual provider and Redis inventory, stubbing only
external credential recovery and logout. A second disabled/inactive/missing/
non-member/FAILED pass makes zero recovery calls and zero token logouts.
Newly inventoried tokens are removed in steady denied states without recovery.
An active-to-inactive transition recovers/revokes once; failed transitions and
tenant fan-out retry without advancing their observations. The real Keycloak
Organization-disable and removed-membership tests also verify the second pass
makes no recovery call or logout.

`tests/unit/sync-event-reconcile.test.ts` uses the actual event effects and
lazy import, without injected callbacks. An Organization DELETE lacking tenant
metadata writes requestGeneration=1 and reason=organization-deleted through
`requestReconcileNow`, without falsely marking the request complete.

## Resolved citizen provider

Per the owner decision on thread `citizen-entry`,
`ensureCitizenEntry(subject, {tenantId, uuid}): Promise<void>` seeds an already
resolved citizen through the safe user writer under the re-entrant person
lease, then calls `mirrorPerson`. It preserves staff entries and unrelated
identity attributes. The same citizen reference is idempotent; a different
citizen UUID at the same tenant fails with status 409 and
`CITIZEN_ACCOUNT_AMBIGUOUS`. A missing account is marked missing/inactive; a
failed DIGIT read leaves a schema-valid seed that can be retried. It does not
create a DIGIT account, binding, membership or active entitlement.

Four added unit cases in `sync-mirror.test.ts` (14 total) and one real Keycloak
case exercise that provider. Core-bindings owns the separate consumer changes
in citizen selection and conversion and their phone-propagation E2E; this PR
supplies the shared provider only.
