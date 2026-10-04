# Onboarding primitives: implementation evidence

The production app registers all six onboarding primitives with the dedicated
workload credential, real core binding store and real revocation publisher.
The BFF worker, tenant-foundation writer, provisioner credential/config and
startup hook are now removed after the owner released the root 8c gate on
2026-10-05. Production primitives and core providers are preserved. See
[the executed replacement map and cutover evidence](onboarding-worker-removal.md).

## Initial production integration validation

After merging owner `6fc1daa3c`, core `2743ddf82`, and isolated inventory provider
`86242e4ee710a4e746185e501c3227c7052d25da`, the production integration changes
were tested on 2026-10-04:

- `REDIS_PORT=16389 npx vitest run`: 36 files passed, one skipped;
  467 tests passed, five skipped, 13 todo. Exit 0.
- `npx tsc --noEmit`: exit 0.
- Committed result: `docs/evidence/onboarding-production-tests.txt`.
- Local full logs: `artifacts/onboarding/production-full-tests.log` and
  `artifacts/onboarding/production-typecheck.log`.

Skipped real-Keycloak checks and remaining contract todos are not claimed as
verified. Tests use real Redis and real core services against HTTP Keycloak and
DIGIT fixtures. These historical results precede the separately recorded worker cutover.

## New executed coverage

| Test file | Evidence |
|---|---|
| `tests/unit/onboarding-primitives.test.ts` | Real Redis operation/tenant/slug locks; concurrent slug and tenant races; canonical retry; changed payload; lower attempts on every mutation after a newer failure; higher attempts before ensure; repeated ACTIVE; reopen from FAILED/PROVISIONING; changed-slug crashes before/after creation; interrupted FAILED publication; ownership; lease loss and renewal |
| `tests/unit/onboarding-organization-reader.test.ts` | Raw disabled/non-ACTIVE reads; absent lifecycle; superseded records; interrupted supersession; ambiguous ownership and attempts fail closed |
| `tests/unit/onboarding-visibility.test.ts` | ACTIVE/absent lifecycle visibility; PROVISIONING/FAILED rejection; live recheck of stale cached mappings; disabled Organizations |
| `tests/unit/onboarding-adapter.test.ts` | Real shared person lease around membership/binding adapter; workload actor signature; no credential writes by adapter; removed-binding error mapping; repeated revocation publication; cache invalidation; live emailVerified; single Organization scan per identifier batch |
| `tests/contract/onboarding.test.ts` | Isolated real Express routes; dedicated bearer auth; temporary read credential; malformed requests; response shapes; shared error envelope; busy Retry-After; introspection outage distinguished from missing session |

The adapter unit suite uses controlled core ports. The separate
`tests/e2e/onboarding-bindings.integration.test.ts` executes the production
provider wiring: real core store, writer, authority, person/UUID leases and
revocation publisher. It checks same-UUID reuse, different-UUID conflict,
concurrent UUID ownership, removed-binding rejection, deferred credentials,
and FAILED session revocation including publication repair on repeats.

`tests/unit/onboarding-primitives.test.ts` additionally executes durable
replacement staging at five interruption boundaries, permanent create collision,
pending FAILED settlement, revocation publication retry, unchanged terminal
ensure rejection, changed-payload conflict, higher-restart recovery with original
and changed slugs, and lower-attempt fences. The approved decisions are recorded
in `identity-bff.md` §9.3. The raw reader fails closed on corrupt or ambiguous
attempt authority. `onboarding-tenant-inventory.test.ts` tests pagination and
inclusion of disabled, failed, provisioning and superseded tenant mappings.

## Worker cutover

All six removed worker scenarios are mapped to executed PGR/BFF replacements in
[onboarding-worker-removal.md](onboarding-worker-removal.md). The new retained
BFF sign-in test checks authentication methods and the Keycloak authorization
redirect while PGR requests fail. Read-only readiness, the core event poller,
reconciliation, production primitives and PGR replacement tests are preserved.
