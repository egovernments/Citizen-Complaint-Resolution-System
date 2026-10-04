# Surfaces integration status

This is the owner integration record for lane E. It distinguishes inspected
evidence from accepted implementation. The completion gate is still open.

## Integrated

- Owner branch includes the frozen contract and root fixes through base
  `87558f103`, including reviewed core providers, citizen account entries and
  onboarding. Owner merge `cd10bb4df` retains `/livez` probes and both domains
  of deployment configuration. Final combined validation: 648 BFF passes,
  11 skips, 2 TODOs; clean tsc; all 121 affected static deployment contracts
  pass. See `../evidence/owner-onboarding-summary.txt`.
- The earlier digit-ui slug-cache change is included through `7cc754440`.
  Its original verification is carried by the handoff; this review has not
  rerun that suite.
- Keycloak PR 50, `c5583f3e4`, is reviewed and merged. The owner inspected
  realm policy, public theme fetches, retained mobile validation, replacement
  coverage and the passing live CI log. The merge was conflict-free; the
  runtime files match the tested leaf source. Evidence and limits are in
  `keycloak/evidence/validation.json`.
- Configurator PR 59, `4763e73ad`, is reviewed and merged at `68d35e02f`.
  The configurator and evidence trees match the tested leaf exactly. Owner
  review covered retry-safe member actions, identifier preservation, entry
  ordering, PGR rename/version/polling and invitation expiry. Evidence lives
  in `artifacts/configurator/README.md`: 103 affected tests, 576 full-suite
  passes, the unchanged postal baseline failure, and clean typecheck/build.
- digit-ui PR 58, corrected head `66eb372aa`, is reviewed and merged at
  `6b8097841`. Its ownership guard and deferred hook tests close the phone-change
  logout/account-switch review finding. The merged frontend tree is identical
  to the tested leaf: 262 tests and build passed. See
  `digit-ui-esbuild/test-evidence/phone-race-verification.txt`.
- Test migration PR 62, corrected head `673e40ba5`, is reviewed and merged at
  `9a74d30a3`. Hosted helpers support combined and split forms and observe the
  app-owned one-use auth-result response; nine browser fixture cases close
  both review findings. All 24 isolated helpers pass, tsc is clean and original
  discovery counts remain 278/88 (289/90 with local-only cases). Eight explicit
  missing-environment skips do not close the root-owned real-system gate.

- BFF PR 52 (`4582d5b29`) and phone PR 63 (`aa89930ce`) are reviewed and
  merged at `080dae354`. The BFF runtime/tests initially matched the tested
  leaf exactly. Core base `94ae613eb` was then merged at `6d32d6988`, keeping
  core citizen entries, issuance cleanup and predicate ordering alongside the
  registry context kinds, moved mobile validation and national-name fallback.
  `8d43cedcc` removes a newly imported test reference to the deleted branding
  cache; all core regression assertions are preserved. Final owner validation
  is recorded in `../evidence/owner-integration-summary.txt`.

## Integration state

| Owner | Scope | Integration state |
| --- | --- | --- |
| surf-bff | Items 1–4, 15 | PR 52 reviewed and merged; core readiness providers integrated |
| surf-phone | Item 13 | PR 63 at `aa89930ce` reviewed and merged through PR 52 |
| surf-keycloak | Realm configuration, extraction, public branding | PR 50 reviewed and merged; scoped evidence accepted |
| surf-configurator | Members, invites, account actions, workspace settings | PR 59 reviewed and merged; scoped frontend evidence accepted |
| surf-digitui | Phase 2 account actions, phone, invites, logout | Corrected PR 58 reviewed and merged; scoped frontend evidence accepted |
| surf-tests | Item 18 migration and complete gate matrix | Corrected PR 62 reviewed and merged under root's handoff plan; real runs pending |

The task identifiers and durable coordination records live in Agent Bridge.
Keycloak, configurator and digit-ui scopes are verified independently of the still-pending
full system gate.

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
- Keycloak final source `c5583f3e4`: local BFF 229 passed / 14 existing todo,
  deployment contracts 111 passed, clean typechecks. The unchanged realm and
  harness at `09e479139` passed 24/24 live checks on Keycloak 26.7.3;
  image browser smoke 1/1, theme 57/57 and screenshots 26/26 also passed.
  Final BFF CI passed at `c5583f3e4`. See the pinned URLs in validation.json.
- digit-ui PR 58 at `4771ca1cd`: inspected 251 passing frontend cases,
  successful build and 16 alias checks. These use HTTP/component fixtures.
  Owner code review found the phone-change race below, so this evidence does
  not establish acceptance of the final implementation.
- Integration-test discovery at `171e5fe1a` found 278 cases in 88 files.
  Discovery is not execution or a pass-rate baseline. The test leaf records
  the exact per-file mapping and the existing dashboard-harness type error.
- Test migration PR 62 at `60f33a76a` preserves 278/88 default discovery and
  289/90 including local-only cases, reports 16 isolated fixture passes and
  clean tsc, and explicitly reports eight missing-environment real-gate skips.
  Owner review returned the hosted-entry assumptions below for correction.

Final PR evidence must pin the tested commit and include commands, exit codes,
test counts and logs. Every lane-E gate needs executed coverage, including
the real-dependency cases; mocked tests do not satisfy those cases.

## Review findings and integration holds

- Refresh lease classification correction is present at `417557d50`:
  currentSession rethrows busy/lost errors and the HTTP handler maps them to
  IDENTITY_BUSY with Retry-After. The combined suite covers this correction.
- Whichever owner lands second must preserve both the surfaces registry
  context-kind checks and core's `_select` predicate/ordering rewrite.
- Core removes the obsolete full-directory subject sync rather than
  optimizing it. The new `_select` uses subject-scoped mirrorPerson; core owns
  the regression showing the old syncSubject path is never invoked.
- digit-ui ChangePhone.verify at `4771ca1cd` writes the re-selection result
  without checking original UUID/current local session ownership after the
  asynchronous calls. The leaf must prevent logout resurrection and adopting
  another person's cookie result, with interaction regression cases. Resolved
  at `66eb372aa`: UUID/token/shared-alias checks across each asynchronous step,
  plus 18 interaction cases and the 262-case full frontend suite.
- Test migration hostedSignIn at `60f33a76a` assumes a combined username and
  password form; the stock realm flow also uses separate pages. The leaf must
  support and test both, including the admin login assertions. Its helper
  must also avoid competing with the landing app for a one-use auth result.
  Resolved at `673e40ba5`; failed results also reject an older valid cookie.
- Scoped logout, phone-session invalidation, identifier propagation and
  readiness consume core APIs from `docs/core-internals.md`; no duplicate
  implementation is permitted. Identifier propagation is consumed; poller
  provider `0d2af5878` and reconcile `9bf112ec6` are integrated. Core replaces
  the old reconcile scheduler; surf-bff starts/stops the poller exactly once,
  including retries.
- Core bindings `1fae11312` supplies member/admin-email/invitation routes and
  the new `_select`. Core adds frozen citizen digit.accounts entries before issuance at selection,
  needed for subsequent phone propagation. The imported regression verifies
  a new citizen entry and changed phone reaching the same mock DIGIT account;
  this remains mock-dependent evidence, not a live-system result.
- Root settled D18: core-bindings provides session-authenticated
  `POST /identity/v1/workspace-members/_updateEmail {tenantId,digitUuid,email}`.
  It requires live tenant ACCOUNT_ADMIN and an ACTIVE target binding; sets
  Keycloak email with emailVerified=false under the target lease; sends
  VERIFY_EMAIL; returns 202 `{status:"verification_sent"}`. A conflicting
  Keycloak email returns 409 IDENTITY_EMAIL_CHANGED. DIGIT changes only after
  verification. Configurator is implementing this contract.
- Earlier Keycloak shellcheck and mock JWKS-port CI failures are resolved.
  The obsolete branding doc/ROUTES row was removed together under root
  approval `apr_1810cd9a95a04b42bf1cddaa6a76c6c3`; drift tests remain intact.
- Configurator's untouched postal-code parity test is a known upstream
  baseline failure, explicitly accepted by root under a no-new-failures gate.
  No data edit or skipped assertion is authorized to hide it.

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
- Root decision on approval `apr_2a08b76cd6b041a8b7958fb3d8f67999` defers
  notification to the old email address. No custom Keycloak extension is
  authorized for it. D18 still requires verification of the new address,
  propagation to DIGIT only after verification, and the admin email path.
  Record the old-address notice as deferred rather than a failed D18 gate.

Only root merges the owner PR into completion-base. This branch does not
authorize deployment or removal of the final legacy login paths before the
completion gate.

## Real-dependency run plan

Root prohibited a full local DIGIT stack while the fleet is running. The test
leaf prepares endpoint-configured suites using IDENTITY_E2E_BASE_URL,
KEYCLOAK_URL, DIGIT_USER_URL and EGOV_OTP_URL plus test-account configuration.
Suites skip cleanly without those endpoints; Keycloak-only dry runs use the
isolated 26.7.3 fixture. Compilation, explicit skips and the Keycloak dry run
are development evidence, not full-gate evidence. Root runs the full persona
and non-fixed citizen OTP suites on the 8c dev box at the completion gate.
O2 remains **pending gate run**, with timing decided by the human.
