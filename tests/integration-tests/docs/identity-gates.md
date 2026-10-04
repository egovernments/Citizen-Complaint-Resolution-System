# Identity migration and lane E gate ledger

Item 18 implements the revision 7.1 BFF test entry paths. The full deployment
completion gate is **pending gate run**. No full-deployment baseline pass rate
was available, so no improved/equal pass-rate claim is made.

## Evidence and counts

Executed commands, source commit and outcomes: [verification.txt](identity-evidence/verification.txt).

- Starting revision: `171e5fe1a` (owner branch integrated without rewriting history).
- Default Playwright discovery: **278 cases / 88 files**, before and after.
- `LOCAL_STACK=1` includes the existing local-only cases; **289 cases / 90 files** before and after; exact
  counts, all case titles and transitive migrated-helper dependencies are in
  [replacement-map.json](identity-evidence/replacement-map.json) and
  [counts.txt](identity-evidence/counts.txt). Mapping is per file and original
  case order; the checker fails if any original file loses cases.
- Discovery uses `--list`. Its reporter labels cases `skipped`; that is
  discovery metadata, not an executed pass rate or an execution skip.
- [helper-tests.txt](identity-evidence/helper-tests.txt): **16 passed**, including one browser form double and isolated HTTP doubles
  exercise cookie transfer, challenge payloads, fail-closed behavior, wrong
  tenants/personas, no refresh token, expiry, and the test OTP inbox. These do
  **not** execute real Keycloak, Redis, egov-user or egov-otp.
- [typecheck.txt](identity-evidence/typecheck.txt): `npx tsc --noEmit`, exit 0.
  The baseline had TS7053 in dashboard-harness.ts:266; the only fix adds a
  `Record<string,string>` return type to the empty-header fallback. Baseline
  diagnostics remain in [baseline-typecheck.txt](identity-evidence/baseline-typecheck.txt).
- [real-gate-unset.txt](identity-evidence/real-gate-unset.txt): eight explicit
  missing-configuration skips, zero passes. This verifies the root gate can be
  collected safely without contacting a deployment; it does not satisfy O2.

## Replacement behavior

No baseline spec file was deleted. Existing cases are mapped one for one.

| Previous entry | Replacement |
| --- | --- |
| `auth.setup` injected a native password token | Hosted Keycloak form, BFF callback cookie, configurator `_select`; storage state keeps both the cookie and selected context |
| `api.setup`, `utils/auth`, manage and launch helpers used native grants | Hosted BFF sign-in and `_select`; business API tests still receive ordinary DIGIT tokens |
| Citizen helpers retried fixed OTP / default password / native create and rewrote runtime config | BFF `_send` → `_verify` → cookie-bound citizen `_select`; permanent failures stop; one declared resend cooldown is respected; runtime config stays intact |
| Citizen registration sometimes bypassed disabled form assertions | UI submits a fresh phone and OTP; verifies token, uuid and national-number default name |
| Configurator legacy credential/autofill tests conditionally skipped | No credentials in configurator; fresh hosted fields and hosted hand-off asserted |
| Keycloak overlay returned browser JWT, refresh and id tokens | BFF keeps Keycloak tokens server-side and supplies a tenant-scoped DIGIT context; no browser refresh/id token |
| `/token-exchange` business proxy checks | Selected token calls DIGIT services directly; MDMS/access/localisation/PGR responses now require success |
| Handcrafted browser PKCE and legacy client | BFF `/authorize` owns the state, PKCE and callback; isolated realm checks use the citizen client |
| Tenantless UI links in consumer specs | Canonical `/{slug}/digit-ui/{surface}/…` links; slug is distinct from tenant id |

`getDigitToken` retains its public helper signature to preserve callers, but
now launches a hosted browser sign-in. Tests need Keycloak users with active
bindings and Organization memberships; a native-only `ADMIN` fixture is no
longer sufficient. `IDENTITY_TEST_TENANT_SLUG`, `DIGIT_TENANT` and `ROOT_TENANT`
must name the same flat workspace. Missing fixture data is not replaced by a
native grant. Fixed-code helper runs require explicit `IDENTITY_TEST_OTP_CODE`.

Legacy business fixture/persona discovery still has pre-existing data-dependent
skips; no new skip was added to those cases. New real-gate skips are isolated
in `playwright.identity.config.ts`, authorized by the root decision below.

## Lane E §11 gate matrix

“Pending” means no passing execution artifact for that case has been received.
Source existence, mocked coverage and a discovery count do not close a real gate.
Sibling results are pinned to their commits; they were not rerun by surf-tests.

| Gate case | Implementation / test owner | Case or artifact | Executed evidence / gate state |
| --- | --- | --- | --- |
| Founder sign-in, select, account, logout | surf-tests / surf-configurator | `identity-real/personas.spec.ts`: configurator founder | Root run pending; missing-env skip only |
| Admin sign-in, select, account, logout | surf-tests / surf-configurator | same: configurator admin | Root run pending |
| Employee sign-in, select, account, logout | surf-tests / surf-digitui | same: employee; `employee/login.spec.ts` | Root run pending |
| Keycloak citizen sign-in, select, account, logout | surf-tests / surf-bff | same: Keycloak citizen; `keycloak/new-citizen-provisioning.spec.ts` | Root run pending |
| Phone-only citizen sign-in, select, empty account arrays, logout | surf-tests / surf-bff | same: phone-only citizen; `citizen/citizen-otp-login.spec.ts` | Root run pending |
| List sessions; logout others; logout all | surf-tests / surf-bff | `identity-real/personas.spec.ts`: one person lists sessions | Root run pending; mocked session metadata evidence E1 below |
| TOTP enrollment and enforcement on next employee sign-in | surf-keycloak / surf-bff | `keycloak/tests/live-check.py`, stock 26.7.3 | E3: real KC CONFIGURE_TOTP + next-sign-in enforcement passed; full app gate pending |
| Second-factor removal | surf-keycloak / surf-bff | stock required action and `delete_credential` | E3: real KC delete_credential removal and next-sign-in passed; BFF app gate pending |
| Provider link and unlink | surf-keycloak / surf-bff | `idp_link` and `_unlink`; `keycloak/kc-api.spec.ts` provider entry | E3: real KC idp_link passed; E1 mocked unlink, full BFF flow pending |
| Concurrent provider unlinks / last primary method | surf-bff | account/person lease tests | E1 mocked coverage; real gate pending |
| Two persons claim one phone | surf-phone | phone lease/change suite | Pending phone implementation evidence |
| Tenant mobile rule rejects phone change | surf-phone / surf-digitui | citizen OTP `purpose=change_phone` | Pending |
| Old session races phone change | surf-phone / core revocation via owner | phone lease and session invalidation | Pending |
| Released phone claimed by another person | surf-phone | citizen phone resolution | Pending |
| No citizen given name → national mobile number | surf-tests / surf-phone | `citizen/citizen-registration.spec.ts` | Root run pending |
| Legacy ambiguous citizen match, then admin resolution | surf-bff / surf-tests | retained internal citizen link/unlink/list routes | Pending; no substitute “any 4xx” assertion |
| Rename shown in Keycloak, sign-in picker and digit-ui | surf-configurator / core sync / surf-digitui | configurator rename; tenant-route cache tests | E2 source includes fresh-answer cache replacement; end-to-end pending |
| BFF unavailable while signed in → business traffic until expiry | surf-digitui / surf-tests | direct DIGIT traffic + network/5xx route cache | E4 cache and outage frontend tests passed; root outage/expiry run pending |
| Every self-service action on Keycloak 26.7.3 | surf-keycloak / surf-bff | UPDATE_PASSWORD, CONFIGURE_TOTP, delete_credential, UPDATE_EMAIL, idp_link | E3: five stock required actions passed on real KC; full app run pending |
| Expired DIGIT token → reselect | surf-digitui / surf-tests | token refresh/reselect consumer | E4 frontend fixture tests passed; real gate pending |
| Forgot password and set password | surf-keycloak / surf-bff | theme password help + setup-complete flow | E3: real UPDATE_PASSWORD passed; forgot/set-password email browser flow pending |
| Employee created in HRMS and linked; invitation routing/accept/reject | surf-configurator / core bindings | member screens and BFF link/accept | Pending |
| Remove member → HRMS inactive plus binding removed | surf-configurator / core bindings | member remove orchestration | Pending |
| Email verification before DIGIT propagation; admin path | surf-configurator / core sync / surf-keycloak | UPDATE_EMAIL plus frozen admin route | Pending required new-address/DIGIT assertions |
| Old-address email notification | root decision | approval `apr_2a08b76cd6b041a8b7958fb3d8f67999`; contract `63e88080f` §3.3.11 | **Deferred**, not a failing/blocking gate; no custom SPI |
| Migrated baseline cases/count/pass rate | surf-tests | replacement map + original per-file counts | Counts retained; real pass-rate comparison pending |
| Real Keycloak + Redis + egov-user + egov-otp / non-fixed O2 | surf-tests; identity-root executes | `identity-real/non-fixed-otp.spec.ts` | Pending gate run; eight missing-env skips are not passes |

### Every design §9 configuration-only row

Each row needs a configuration change and an executed behavior check without a
BFF source change. These entries reserve distinct cases rather than inferring
coverage from one generic “configuration works” test.

| Configuration change | Owner | Required behavior / evidence | State |
| --- | --- | --- | --- |
| New identity provider | surf-keycloak / surf-bff | Enable provider/client method, IMPORT claims, hosted login/link | E3: real KC configured IdP, shared linking and IMPORT passed; BFF entry pending |
| Hosted authenticator | surf-keycloak / surf-bff | Declare `hosted:<id>` and complete hosted sign-in | E3: real hosted recovery-code authenticator passed; E1 method catalogue double, BFF entry pending |
| New browser surface | surf-bff / surf-keycloak | Registry + client entry, correct context/cookie/return path | E3: added KC client survives configuration; E1 registry double, end-to-end surface pending |
| Staff SSO policy | surf-keycloak | Change client flow, enforce next sign-in | E3: REQUIRED OTP policy forces setup at next real sign-in |
| New DIGIT role | core sync via owner | MDMS role/actions appears in fresh mirror | Pending owner evidence |
| New OTP channel | surf-bff | Same frozen sender payload with different receiver/provider | E1 HTTP sender double; channel gate pending |
| New self-service action | surf-keycloak / surf-bff | Realm/client/theme declaration appears and executes | E3: real recovery-code action passed; E1 BFF allowlist double |
| New descriptive profile field | surf-digitui | UI edits DIGIT-owned field, identifier still read-only | E4 frontend fixture tests passed; real gate pending |
| New signup field/country/onboarding step | surf-configurator / onboarding owner | Configurator/PGR/seed only; identity unchanged | Pending owner evidence |
| New login-page string | surf-keycloak | Theme/localisation update displays new string | E3: real realm-localisation login-page string passed |
| Tenant rename | surf-configurator / core sync / surf-digitui | Every tenant language, reservation and mirror update | Pending full case |
| Invitation expiry | surf-configurator / core bindings | MDMS hours 1–2160; existing expiry frozen, new invite uses change | Pending |

## Referenced sibling evidence

- **E1** `git:8cebafa17:backend/identity-bff/evidence/self-service-summary.txt`
  and `self-service-full.log`: 297 passed / 3 skipped / 14 todo, real Express
  and Redis with Keycloak/DIGIT doubles. It explicitly does not prove real KC
  browser actions, enrollment or DIGIT propagation.
- **E2** `git:2f90a669e:digit-ui-esbuild/tests/tenant-route.test.js`, integrated
  by `7cc754440`: source for network/5xx fallback and live rename cache update.
  No fresh executed log was supplied in this handoff; it is not called passed.
- **E3** source `09e4791393cf290102a01f21337ce9c97d864e53`, evidence committed
  at `c5583f3e4:keycloak/evidence/validation.json` and `live-check-summary.log`.
  Inspected the curated names in [keycloak-dry-run.txt](identity-evidence/keycloak-dry-run.txt)
  and independently queried the [CI job](https://github.com/KDwevedi/Citizen-Complaint-Resolution-System/actions/runs/37214279799/job/111471519864):
  completed successfully, **24/24 real Keycloak 26.7.3 checks**. Same source:
  image smoke 1/1, theme 57/57 and screenshots 26/26. The real checks cover
  TOTP enrollment/enforcement/removal, UPDATE_PASSWORD, verified-before-save
  UPDATE_EMAIL, VERIFY_EMAIL, idp_link, IMPORT behavior, event shapes and the
  named realm configuration-only changes. They do not run BFF/DIGIT/egov-otp.

Root decisions: `msg_9bc5a98780e645c8bb7dc1b121cac2b4` moves full real runs to
identity-root on the 8c gate environment; leaves do not connect to it.
`msg_0aa88af6978f4a0aa83e40a235f64fb9` approves the isolated OTP inbox contract.
See [identity-runbook.md](identity-runbook.md) for exact root run commands.

- **E4** draft PR [58](https://github.com/KDwevedi/Citizen-Complaint-Resolution-System/pull/58),
  `git:4771ca1cd:digit-ui-esbuild/test-evidence/phase2-verification.txt` and
  `phase2-suite.txt`, inspected by surf-tests. Tested source
  `7d703071f3f14f1c0a2bccfb5fa5e706a207cd4f`: 251 passed, zero skipped; build
  and 16 alias checks passed. Includes account actions, scoped logout retry,
  explicit invite acceptance, phone change, read-only identifiers, dashboard
  expiry re-select, identity-outage retention and tenant cache fallback.
  Uses frontend HTTP fixtures/component doubles; no real KC/Redis/DIGIT/OTP
  gate is closed by this result.

- **E4 review limitation:** owner rejected the phase-2 handoff after finding a
  ChangePhone logout/account-switch race (`msg_f77364e572564e2494a62975fd7eef31`).
  The 251 passing tests remain historical evidence; they do not prove that
  race fixed or establish acceptance. Corrected leaf evidence is pending.
- **E5** `4763e73adc01fba2d2aa881f266d222393d3d786:artifacts/configurator/README.md`,
  inspected: affected tests 103/103, typecheck/build pass; full suite 576 pass
  plus one unchanged postal parity baseline failure under the recorded root
  exception. Member/invitation/account/rename/expiry tests use client doubles.
  Full backend propagation and publication remain pending gates.
