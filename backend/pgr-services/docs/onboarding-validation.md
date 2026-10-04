# Onboarding implementation review evidence

Current port evidence is in `onboarding-worker-replacements.md`. Source port implementation is complete with the live check pending 8c gate; seed/MCP and workspace/rename ownership moved to onb-seed and onb-workspace. Earlier counts below are historical checkpoints.
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

## MCP security and packaging follow-up

`npm run build` and `npm run test:platform-baseline`: seven tests passed, zero failures. The tests validate all canonical schema/record pairs (including removal of three duplicate role/action keys), idempotent bootstrap, byte-identical staging, standalone built loader, privilege rejection, forged live-token claims, and flag-off gateway transport.

Default bootstrap uses gateway API methods. Direct MDMS requires server-set `MCP_PLATFORM_BOOTSTRAP_DIRECT=true`, both trusted origins `EGOV_MDMS_HOST` and `EGOV_USER_HOST`, and a fresh `/user/_details` lookup of the caller token. The returned live account must have `SUPERUSER` or `MDMS_ADMIN` at server `CRS_STATE_TENANT` (default `pg`). Caller environment overrides do not select the trusted introspection origin or state root. The opt-in must be configured separately; default Compose and readonly leave it unset. No provisioner credential substitutes for caller verification. These tests use HTTP fixtures and do not claim a deployed DIGIT/Kong test.

PGR follow-up command (same JDBC fixture, adding `WorkspaceRouteTest` to the focused selection): 21 tests passed, zero failures/errors/skips. Four new route/probe tests exercise the real egov-user HTTP lookup against a local fixture, repeated live authorization, forged caller role rejection, cross-tenant denial on all three routes, absent token/disabled user denial, and exclusion of platform prerequisites from setup probes. Workspace creation now appends its CREATED audit event in the same SQL statement and transaction; advisory name checks consult the shared name authority. The concurrent rename/signup DB gate remains open.
