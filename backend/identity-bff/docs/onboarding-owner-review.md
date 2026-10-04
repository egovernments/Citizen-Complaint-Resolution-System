# Onboarding integration review

Owner: onboarding-owner. Review checkpoint: 2026-10-04.

Core base `94ae613eb` merged at `91cd26feb`; final owner PGR run: 554 passed,
six skipped; BFF: 589 passed, 11 skipped, eight todo; typecheck passed.

## Integrated source

- BFF primitives PR45 (`b4a5c60bb`) uses production core binding/revocation
  providers and durable replacement authority, including the approved pending
  FAILED settlement. PR65 (`548492f35`) makes name normalization idempotent
  after Unicode lowercase expansion. Shared reader `6c2e0d98c` remains in ancestry.
- PGR port PR46 (`9ba66e722`) is merged at `91795823f`. The owner reviewed the
  executed recovery map and final asynchronous projection fix: boundary/MDMS
  creation is checkpointed only when visible, and duplicate uncertain writes
  remain retryable. The BFF specialist independently accepted the production
  BFF fixture and PostgreSQL recovery cases.
- Workspace/rename PR66 (`52aa93b1c`) is merged at `9743c9523`, followed by
  `a6029e035` mapping local database failures to the agreed retryable 503. Review covered
  atomic activation/audit, concurrent signup/rename reservations, optimistic
  versions, legacy open behavior, durable publication, stale completion, live
  caller authorization and accurate probes. Real Flyway migration tests verify
  normalization and atomic collision rollback, including released history and
  cross-table ownership conflicts. The shared route-test conflict retained all
  PGR cases and the workspace additions.
- Seed/MCP PR64 (`e34e9872d`) is verified and merged. One canonical resource
  contains 25 schemas and 979 records, excludes workspace business masters,
  supplies the agreed invitation policy and grants workspace routes only to
  ACCOUNT_ADMIN. Actual npm/standalone, Docker and PGR JAR checks match its
  SHA256 `39f5dcd8c5d6a6f5870083d181c5ffe6763add35fd83893487d40120cee2d231`.
- MCP defaults to Kong; direct MDMS requires explicit opt-in and a fresh
  trusted-server caller token check for state-root SUPERUSER or MDMS_ADMIN.
  Unauthenticated, non-admin and forged claims cannot cause direct writes.
- Owner deployment changes move provisioner credentials to PGR, share a
  dedicated onboarding token, preserve stored-secret inputs and stage the
  canonical seed for CI, Ansible, cloned and vendored MCP builds.

## Evidence

- `backend/identity-bff/docs/evidence/onboarding-owner-integration.txt`: owner integration results.
- `backend/identity-bff/docs/evidence/onboarding-production-tests.txt` and
  `backend/identity-bff/docs/evidence/onboarding-name-normalization.txt`: BFF production gates,
  typecheck and normalization follow-up. Latest leaf full suite: 469 passed,
  five skipped and 13 todo; final focused normalization: 12 passed.
- `backend/pgr-services/docs/onboarding-worker-replacements.md` and
  `backend/pgr-services/docs/evidence/pgr-port-tests.txt`: executed PGR recovery map,
  actual BFF/Redis/PostgreSQL integration, commands and log hashes.
- `backend/pgr-services/docs/workspace-validation.md` and its evidence file:
  source/fixture acceptance and real database/Flyway tests.
- `digit-mcp/docs/validation/platform-baseline.md`: seed, packaging,
  security and caller compatibility evidence. Two extra phone-safety assertions
  fail unchanged on develop, confirmed by root; neither was skipped or modified.

## Remaining cutover gate

Root decision `apr_fd351ab1f3f5428e94af70e95b991021` transfers the real
fresh-founder department/boundary/branding no-403 check to the root-owned 8c
dev-box integration from `identity/completion-base`: **pending 8c gate**.
Local recovery uses production BFF code, real Redis/PostgreSQL and HTTP
Keycloak/DIGIT fixtures with a mocked session introspector. It does not prove
live Kong authorization. No lane deployment is authorized.

BFF worker removal remains held until root reports that pass and the owner
releases the prepared removal task. Source integration and fixture evidence
are available for root integration; parent completion and original BFF/PGR
acceptance are not claimed. Skipped/todo tests are not verified. PR53 remains
a draft into `identity/completion-base`; the PGR runner stays off by default.
