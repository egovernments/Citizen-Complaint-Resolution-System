# PGR onboarding worker replacement evidence

The PGR runner remains off by default pending the coordinated owner cutover. This evidence covers the PGR replacement logic; it does not claim a deployed DIGIT/Kong founder-access gate.

## Executed verification

With JDK 17, PostgreSQL 16 on `127.0.0.1:16432`, the owner's existing Redis on `127.0.0.1:16382`, and `npm ci` completed in `backend/identity-bff`:

```sh
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
  backend/pgr-services/src/test/fixtures/run-onboarding-recovery.sh --full
```

Result: 536 tests run, zero failures, zero errors, six skipped (530 passed). The six PostgreSQL tests ran, including the actual BFF integration case. Skipped tests are not verified. Local execution log: `.artifacts/onboarding/pgr-final-test.log`; XML results: `backend/pgr-services/target/surefire-reports/TEST-*.xml`.

During development, the first full run caught an invalid numeric tenant ID in the new repeatable test fixture. The fixture now uses alphabetic tenant IDs. The affected classes passed before the final full run above.

The default script runs only the affected step, recovery, transport, PostgreSQL and citizen classes. It starts ephemeral HTTP services and cleans up its own Redis prefix. It never flushes the shared Redis instance. PostgreSQL tests create and drop their own random schema. Fixture credentials are test-only constants.

## Retained legacy worker scenarios

| Legacy BFF scenario | Executed PGR replacement |
| --- | --- |
| Tenant prerequisites precede founder account; role, encryption and mobile masters exist | `OnboardingStepsTest.completePrerequisitesUseCountryRuleEveryLanguageAndVerifiedFounderPolicy` (production steps, deterministic DIGIT responses) |
| Fresh signup cannot adopt another tenant | `OnboardingStepsTest.foreignTenantCollisionFailsBeforeEncryptionOrFounder` |
| Founder HRMS validation is terminal and correctable; duplicate asynchronous projection retries | `OnboardingStepsTest.founderValidationIsCorrectableAndDuplicateProjectionIsRetried` |
| Unavailable tenant foundation retries | `OnboardingStepsTest.foundationTransportFailureIsRetryableAndMissingFounderNeverReplaced` |
| Existing Organization collision and sign-in remain BFF concerns | Retained by onb-primitives; no PGR ownership claim |

Additional step evidence: `retryUpdatesOwnedTenantNameAndStateInfoAndIncludesOnlyVerifiedEmail` verifies corrected names on terminal restart, StateInfo refresh, and verified-email inclusion. The first test verifies HRMS search-before-create, same founder reuse, SUPERUSER, national phone normalization plus country code, all signup locales, country MDMS mobile rule, and invitation expiry of 336 hours. Seed packaging/inventory ownership has moved to onb-seed.

## Restart and lifecycle evidence

`OnboardingRecoveryTest` tests crashes at each of the six ordered steps, completed-step reuse, per-record STARTED/DONE progress, lost leases, uncertain ensure reconciliation, and stale-publication acknowledgement.

`OnboardingPostgresTest.actualBffBoundFounderRestartCollisionAndCrashBeforeAcknowledgement` uses the real PGR repository/service/controller, production HTTP provisioning client, actual BFF routes and production core binding/revocation providers, and real PostgreSQL/Redis. Keycloak and DIGIT are HTTP fixtures. The browser session introspector is mocked; this is not a browser login or real DIGIT provisioning test.

The executed sequence is:

1. Bind a founder at restart 0, persist terminal FAILED and publish it.
2. Resubmit the same slug through the PGR endpoint at restart 1 and reuse the founder UUID/binding; fail and publish again.
3. Change the slug through PGR, resubmit at restart 2, and inject permanent-style Keycloak create collisions for both the runner and publication recovery.
4. BFF settles FAILED on its pending replacement. Inject a PGR crash after BFF publication but before the local acknowledgement transaction commits.
5. Verify `_ensure` for restart 2 returns `LIFECYCLE_CONFLICT`, then replay publication and acknowledge it locally.
6. Resubmit at restart 3, finish the changed-slug replacement, reach ACTIVE, and retain the same founder binding UUID.
7. Verify the older restart 2 lifecycle mutation returns `ATTEMPT_STALE`.

Other PostgreSQL tests exercise lease expiry/replacement fencing, monotonic organization-ensure intent across restarts, the never-dispatched `NO_IDENTITY_SIDE_EFFECTS` case, resubmit blocked before publication acknowledgement, and rollback/commit of signup readiness, workspace row and lifecycle decision together.

`OnboardingProvisionerClientTest` exercises local HTTP responses: only the fixed `bustLocalizationCache()` operation accepts an empty successful body; required JSON responses still fail closed. DIGIT Errors codes survive transport classification; 503 remains retryable.

## Open integration gate

**pending 8c gate**: root owns the final fresh-founder department, boundary and branding requests through real DIGIT/Kong from `identity/completion-base`. Root decision `apr_fd351ab1` prohibits a full local stack on this Mac; source testing uses the explicitly disclosed HTTP fixtures. No live host was contacted and no deployment was performed. Source implementation is complete; end-to-end readiness is not claimed. The old BFF worker removal remains blocked until root reports the 8c pass.

## Final source-review follow-up

After integrating the owner's reviewed seed and normalization changes, `OnboardingStepsTest` passed all seven tests. The two added cases are `asynchronousBoundaryWriteIsNotCheckpointedUntilVisible` and `duplicateSchemaFromUncertainPriorWriteRetriesInsteadOfAbandoningSignup`. Boundary creation now waits for its search projection before checkpointing DONE; duplicate MDMS/boundary create responses after uncertain writes stay retryable. Required search response shapes fail closed. These affected-class checks supplement the full-suite result above; the full suite was not repeated for this narrow follow-up. `docs/evidence/pgr-port-tests.txt` records execution results and log hashes.

## 8c source fixes after the live gate report

The PGR gate-fix regression run has 60 tests: 59 passed, zero failures/errors, one skipped. See [exact commands, cases and log hashes](evidence/pgr-8c-source-tests.txt). These are affected suites only; onboarding-owner runs the full suite at integration. This section supersedes the older source behavior above, not the historical test counts.

- Country mobile data comes from the configured country MDMS master first. Successful absence falls back to the shared seed's IN/KE `countryMobileRules`, writing only the new tenant. Invalid/ambiguous data and transport failure never fall back. Other countries require a configured valid default; absence yields correctable `COUNTRY_NOT_SUPPORTED`. No country tenant or `pg` data is written/copied.
- Boundary searches accept explicit null as empty, require the matching ADMIN/root relationship inside `TenantBoundary`, and do not mistake an empty wrapper for a root. Root entity creation includes the technical Point placeholder required by the boundary service; operational geography remains workspace-owned.
- Migration `V20261005000000` adds durable `retry_count` and `next_retry_at`. The existing fenced claim atomically selects due retryable failures as well as pending/expired work. Backoff starts at one second, doubles to sixty seconds, and stops after twelve consecutive failures without durable progress. New DONE records or newly completed steps reset the budget; STARTED/no-op checkpoints do not. Exhaustion stays `RETRYABLE_FAILED` with no FAILED lifecycle publication; manual retry resets the budget. Automatic and manual retries preserve operation/restart identity.
- Manual retry locks the signup then updates/locks the operation before refreshing founder identity from trusted introspection. A worker that claims first prevents the refresh. Blank/unverified email is not promoted, and existing founder UUIDs remain unchanged. HTTP introspection → controller → PostgreSQL → HRMS tests prove the initial verified-email mapping already works and reproduce/fix stale snapshots on retry. The live gate's initial null email remains unexplained pending sanitized live introspection evidence; this change does not claim its root cause.

The source run uses PostgreSQL16 and HTTP identity/HRMS fixtures, plus deterministic MDMS/boundary responses. It does not run a full DIGIT/Kong stack or validate live founder access. Root owns that gate. The runner remains off by default.

Owner review follow-up: the real `application.properties` default now makes unsupported countries correctable, tested through resolved configuration. Explicit inactive/foreign boundary hierarchy, entity and relationship entries do not count as prerequisites. The geometry matches MCP's existing Point `[0,0]` placeholder. `WorkspacePostgresTest` retains normalization/collision coverage while expecting the additional retry migration. The affected follow-up counts are recorded in the evidence file. The asynchronous worker has no browser cookie for introspection: automatic retries use the trusted snapshot; initial/terminal submit and explicit manual retry are the authenticated refresh paths. No cookie is persisted and no new subject lookup contract is introduced.
