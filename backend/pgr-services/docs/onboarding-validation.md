# Onboarding implementation review evidence

This is a work-in-progress implementation; all four bridge tasks remain accepted.
The coordinated BFF worker cutover is not approved by this evidence.

Executed locally with JDK 17:

- `mvn -o -q -f backend/pgr-services/pom.xml test`: passing after adapting obsolete lease-argument and immutable-account-code assertions.
- `mvn -o -q -f backend/pgr-services/pom.xml -Dtest=OnboardingPostgresTest,WorkspaceServiceTest,OnboardingRecoveryTest -Donboarding.test.jdbc=jdbc:postgresql://127.0.0.1:16432/onboarding_test test`: 17 tests, zero failures/skips. PostgreSQL 16 fixture; random isolated schema per test. BFF and DIGIT dependencies mocked.
- `cd digit-mcp && npm run build`: passing; canonical seed staged into source and built package resources.

Local logs: `.artifacts/onboarding/pgr-test.log`, `recovery-test.log`, `mcp-build.log`. Surefire reports are under `backend/pgr-services/target/surefire-reports`.

Coverage map so far:

| Behavior | Replacement evidence |
| --- | --- |
| Every ordered step resumes after crash; completed steps skipped | OnboardingRecoveryTest.crashAtEveryStepResumesWithoutRepeatingCompletedSteps |
| Lease fence and per-record intent | OnboardingRecoveryTest lostLeaseCannotWriteOrFinish, perRecordIntentSurvivesCrashAndCompletionIsFenced; OnboardingPostgresTest |
| Terminal resubmit through controller/service; same and changed slug | OnboardingPostgresTest (real PostgreSQL, mocked BFF) |
| Atomic readiness workspace and lifecycle decision | OnboardingPostgresTest |
| Legacy access, version conflict, DONE probes, partial rename retry | WorkspaceServiceTest |
| BFF-created citizen mobile lookup, existing upsert behavior | CitizenLookupTest |

Open gates: transport-level foundation/HRMS/locale verification; permanent replacement-create collision and crash-before-ACK against actual BFF; workspace route authorization and database rename concurrency; baseline JSON schema and packaged MCP/bootstrap regressions; fresh-founder department/boundary/branding through Kong without 403. No deployment or end-to-end signup is claimed. Additional fixes and evidence will follow in this draft PR before task completion.
