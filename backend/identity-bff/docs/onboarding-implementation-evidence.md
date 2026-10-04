# Onboarding primitives: staged implementation evidence

Item 11 remains in progress. This branch contains the attempt service, raw
Organization reader, HTTP route module, core adapter and lifecycle visibility
filter. The new route module is not yet registered in the production app.
The existing BFF worker and its tests remain in place.

## Validation

After merging owner branch `identity/lane-d` at `128da0b06`, tested tree
`d99cd6012`:

- `REDIS_PORT=16389 npx vitest run`: 23 files passed, one skipped;
  316 tests passed, two skipped, 12 todo. Exit 0.
- `npx tsc --noEmit`: exit 0.
- Local logs: `artifacts/onboarding/owner-merge-full-tests.log` and
  `artifacts/onboarding/owner-merge-typecheck.log`.

The skipped real-Keycloak tests and remaining contract todos are not claimed
as verified. These results do not establish production route integration or
completion of the PGR cutover.

## New executed coverage

| Test file | Evidence |
|---|---|
| `tests/unit/onboarding-primitives.test.ts` | Real Redis operation/tenant/slug locks; concurrent slug and tenant races; canonical retry; changed payload; lower attempts on every mutation after a newer failure; higher attempts before ensure; repeated ACTIVE; reopen from FAILED/PROVISIONING; changed-slug crashes before/after creation; interrupted FAILED publication; ownership; lease loss and renewal |
| `tests/unit/onboarding-organization-reader.test.ts` | Raw disabled/non-ACTIVE reads; absent lifecycle; superseded records; interrupted supersession; ambiguous ownership and attempts fail closed |
| `tests/unit/onboarding-visibility.test.ts` | ACTIVE/absent lifecycle visibility; PROVISIONING/FAILED rejection; live recheck of stale cached mappings; disabled Organizations |
| `tests/unit/onboarding-adapter.test.ts` | Real shared person lease around membership/binding adapter; workload actor signature; no credential writes by adapter; removed-binding error mapping; repeated revocation publication; cache invalidation; live emailVerified; single Organization scan per identifier batch |
| `tests/contract/onboarding.test.ts` | Isolated real Express routes; dedicated bearer auth; temporary read credential; malformed requests; response shapes; shared error envelope; busy Retry-After; introspection outage distinguished from missing session |

Binding store and revocation publisher are test doubles in the adapter suite.
They must be replaced with the actual core providers for integration acceptance.

## Worker test replacement agreement

The bridge agreement with `onb-pgr` is on thread `onboarding-switch-over`.
No worker test is deleted until its replacement is executed and the owner
coordinates the same-PR switch-over.

| Existing worker case | Replacement owner |
|---|---|
| Tenant prerequisites precede account creation; same operation resumes | PGR foundation/baseline/founder step tests |
| Fresh signup cannot adopt an existing DIGIT tenant | PGR tenant reservation/foundation tests |
| Fresh signup cannot adopt another Organization | BFF operation ownership/race tests, already executed |
| Founder account creation fails terminally | PGR HRMS founder tests |
| Tenant foundation failure is retryable | PGR foundation retry tests |
| Sign-in continues when PGR is unavailable | BFF retained resilience coverage during worker removal |

## Remaining work

1. Integrate core `bindings/store.ts` `ensureActive` and
   `revocation/index.ts` `revokeTenantMembers`; these providers are absent from
   the current owner branch.
2. Register the prepared routes, replace the old control-plane handlers and
   auth, flip their contract states, and migrate old route fixtures/tests.
3. Run binding uniqueness/deferred-credential and lifecycle revocation
   integration checks against the real core providers.
4. After PGR replacement readiness, remove the BFF worker, tenant foundation,
   provisioner credential/config and startup hook in a separate coordinated
   commit; supply the final executed replacement map.
