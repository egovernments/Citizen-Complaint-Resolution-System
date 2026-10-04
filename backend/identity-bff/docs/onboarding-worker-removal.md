# BFF onboarding worker removal

PGR owns onboarding execution. The BFF retains the six identity primitives,
shared core providers, sign-in and read-only readiness. This change removes the
old BFF worker, tenant-foundation module, provisioner token cache, provisioner
credentials and write URLs, worker configuration and startup hook. The BFF
environment example reflects that ownership. No deployment was performed.

## Release and tested base

The owner explicitly released task `task_8dbda52ba1284e208a26b39b12202c23` in
bridge message `msg_0fe74d4feb22426e94511026a08c11e2`. The deletion is based on
`identity/completion-base` commit `e41e23d44`, which includes the PGR replacement
and gate fixes from owner PRs #74/#75.

Root's `8c-gate-report-3.md` (the shared identity walkthrough) reports the live
gate passed on that source: a fresh founder reached ACTIVE after 22 automatic
re-attempts, with no manual retry or DB edit. Using a real BFF-minted founder
token, department, boundary and branding requests succeeded without 403.
Root performed that live check; this leaf did not access a deployment host.

## Executed replacement map

The deleted file is `tests/e2e/onboarding-worker.test.ts`. Its six scenarios
remain covered as follows. PGR paths below are under
`backend/pgr-services/src/test/java/org/egov/pgr/onboarding/`.

| Removed worker scenario | Executed replacement |
|---|---|
| Tenant prerequisites precede account creation; same operation resumes | `OnboardingStepsTest.completePrerequisitesUseCountryRuleEveryLanguageAndVerifiedFounderPolicy`; `OnboardingRecoveryTest.crashAtEveryStepResumesWithoutRepeatingCompletedSteps` |
| Fresh signup cannot adopt an existing DIGIT tenant | `OnboardingStepsTest.foreignTenantCollisionFailsBeforeEncryptionOrFounder` |
| Fresh signup cannot adopt another Organization | BFF `onboarding-primitives.test.ts`: `rejects another operation adopting an existing Organization`, plus concurrent slug/tenant reservations |
| Founder account creation fails terminally | `OnboardingStepsTest.founderValidationIsCorrectableAndDuplicateProjectionIsRetried` |
| Tenant foundation failure is retryable | `OnboardingStepsTest.foundationTransportFailureIsRetryableAndMissingFounderNeverReplaced` |
| Sign-in continues when PGR is unavailable | BFF `onboarding-signin-resilience.test.ts`: authentication methods and Keycloak authorization redirect, with failed PGR requests and no PGR calls |

PGR's `OnboardingPostgresTest.actualBffBoundFounderRestartCollisionAndCrashBeforeAcknowledgement`
also executes real PostgreSQL/controller calls through production BFF routes and
binding/revocation providers, including same/changed-slug restart, pending FAILED,
crash before acknowledgment, terminal retry fencing, higher restart recovery and
founder UUID reuse. Redis is real; Keycloak/DIGIT are HTTP fixtures in that test.

The owner reviewed these executed source replacements before releasing deletion.
Exact PGR test names, counts and log hashes are preserved in
[pgr-port-tests.txt](../../pgr-services/docs/evidence/pgr-port-tests.txt),
[pgr-8c-source-tests.txt](../../pgr-services/docs/evidence/pgr-8c-source-tests.txt),
and [owner integration evidence](evidence/onboarding-owner-integration.txt).
Those records describe earlier runs; the root report above supersedes their
historical pending-live-gate notes. No PGR test is removed or altered here.

## Final leaf validation

Final command results are recorded in
[evidence/onboarding-worker-removal-tests.txt](evidence/onboarding-worker-removal-tests.txt).
Owner runs PGR and static deployment integration checks for the combined PR.
Skipped or todo tests are not claimed as verified.
