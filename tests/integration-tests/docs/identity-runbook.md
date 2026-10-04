# Root identity gate runbook

Only identity-root runs this against the gate deployment. This worktree never
connects to the 8c host, bomet, naipepea or moz. All configuration below is
supplied to the runner without printing process environments, credentials,
tokens or command lines containing credentials.

## Local compile, discovery and isolated checks

From `tests/integration-tests`:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npx tsc --noEmit
PLAYWRIGHT_BROWSERS_PATH="$PWD/.identity-browsers" npx playwright install chromium --only-shell
PLAYWRIGHT_BROWSERS_PATH="$PWD/.identity-browsers" npx tsx --test --test-concurrency=1 tests/identity-unit/*.test.ts
BASE_URL=http://127.0.0.1:18081 npx playwright test --list
LOCAL_STACK=1 BASE_URL=http://127.0.0.1:18081 npx playwright test --list
npx playwright test --config playwright.identity.config.ts
```

The last command deliberately reports missing-config skips when the real gate
variables are absent. It must not silently substitute localhost or a former
production default. The local unit suite has HTTP doubles and is labeled as
such. No full local DIGIT Docker stack is needed or authorized.

To reproduce the exact baseline, extract revision `171e5fe1a` into a temporary
directory within the assigned worktree, including `tests/integration-tests`
and its `digit-ui-esbuild/products/pgr/src/utils/geoLocation.js` import. Run its
Playwright config with the same `LOCAL_STACK=1`/BASE_URL and `--list --reporter=json`.
Save baseline/current discovery reports as
`docs/identity-evidence/{baseline-all-list,final-all-list}.json`, then run:

```sh
python3 scripts/identity-inventory.py
```

Raw reports are ignored; the committed replacement map records counts/titles
without runner settings. Count comparison is per original file, including
setup files and all local-only cases.

## Deployment fixture prerequisites

| Setting | Meaning |
| --- | --- |
| `IDENTITY_E2E_BASE_URL` | BFF/browser gateway origin, no trailing slash |
| `KEYCLOAK_URL` | Full issuer URL, including realm, e.g. `https://gate.example/auth/realms/digit` |
| `DIGIT_USER_URL` | Real egov-user service origin, no trailing slash |
| `EGOV_OTP_URL` | Real internal egov-otp service origin, no trailing slash |
| `IDENTITY_TEST_TENANT_SLUG` | Seeded ACTIVE Organization URL slug |
| `IDENTITY_E2E_TENANT_ID` | Its flat tenant id |
| `IDENTITY_E2E_{FOUNDER,ADMIN,EMPLOYEE,CITIZEN}_USERNAME` and matching `_PASSWORD` | Keycloak test credentials; staff have active bindings/memberships; credentialed citizen has verified phone |
| `IDENTITY_E2E_PHONE` | Dedicated phone-only citizen's national mobile number |
| `IDENTITY_E2E_PHONE_E164` | The same number with country prefix |
| `IDENTITY_E2E_OTP_INBOX_URL` | Isolated receiver origin, reachable from the runner |
| `IDENTITY_E2E_NON_FIXED_OTP_EVIDENCE` | Artifact URI pinning actual deployment settings: real egov-user + egov-otp, OTP validation enabled, fixed-value modes disabled; must not contain secrets |

Staff accounts must allow the five supported account actions in their client
configuration. Phone-only citizens must have no password/provider credential.
Use dedicated seeded accounts because session logout and O2 grant checks mutate
their auth state. Keep workers at one so no two test sends race for one phone.

For the migrated main suite, supply `BASE_URL`, `DIGIT_TENANT`, `ROOT_TENANT`
and the existing persona credentials for the same flat workspace. API/business
fixture credentials now mean Keycloak credentials. `IDENTITY_TEST_OTP_CODE` is
only for explicitly fixed-code development tests, never the O2 suite.

Isolated local-only realm configuration tests require
`IDENTITY_TEST_KEYCLOAK_ADMIN_URL` and an operator bearer token in
`IDENTITY_TEST_KEYCLOAK_ADMIN_TOKEN`. There is no admin/admin fallback.
`IDENTITY_TEST_CITIZEN_CLIENT_ID` defaults to `digit-ui-citizen`.
The Google configuration cases require a real test Google configuration;
placeholder IdP credentials do not establish a passing provider gate.

## Non-fixed delivery receiver

On the root-controlled isolated gate machine, start:

```sh
npx tsx tests/fixtures/otp-inbox.ts
```

It listens on loopback port 18291 (`IDENTITY_E2E_OTP_INBOX_PORT` overrides the
port), keeps data only in memory, and never logs phone/code payloads. Root
connects the BFF's existing HTTP sender URL to this receiver's `/send` through
the isolated network/tunnel. Do not expose `/codes` publicly. This is test-only
SMS delivery; Keycloak, Redis, egov-user and egov-otp must remain real services.

- `POST /send` accepts the frozen sender payload
  `{phone, code, purpose, tenantId, locale, expiresIn}`. No challenge id is added.
- `GET /codes?phone=&challengeId=&since=&tenantId=&purpose=` returns a fresh,
  unexpired receipt with `{code, receivedAt, expiresAt}`. `since` is the runner's
  send-start timestamp in milliseconds; keep receiver/runner clocks aligned.
- The reader serializes tests per phone and associates one fresh receipt with
  the requested challenge. The sender did **not** independently attest that
  challenge id. The real BFF `_verify` proves challenge/code binding. A stale,
  expired, wrong-tenant/purpose or already-differently-associated receipt fails.
- There is no fixed-code fallback in `deliveredOtp`. Missing receiver settings
  yield an explicit gate skip; a configured but broken receiver fails the test.

The O2 case first signs in through the BFF and uses its real citizen grant.
It then probes real internal egov-otp `_create` twice, checks codes differ,
rejects an incorrect code at egov-user, spends the actual code, and performs
an authenticated `_search`. This explicit protocol probe is the sole remaining
native citizen grant call in the migrated test tree; it is not a login fallback.
No OTP or returned token is written to evidence logs. Traces/screenshots/video
are disabled for this dedicated real project.

## Root execution and retained evidence

After root provisions those settings without printing them:

```sh
npx playwright test --config playwright.identity.config.ts
LOCAL_STACK=1 npx playwright test --workers=1
```

Record the tested commit, command, exit code, per-case result and deployment
configuration artifact URI. Preserve skipped and failed rows separately from
passes. Compare the main suite with the committed per-file baseline map.

The isolated stock Keycloak 26.7.3 checks belong to surf-keycloak:
`keycloak/tests/run-live-check.sh`. Reuse its pinned executed evidence when
available; do not start another heavy stack while that harness is running.
The [gate ledger](identity-gates.md) names the exact outstanding actions,
configuration-only rows and full dependency cases. Neither a mocked HTTP test
nor a missing-env skip closes one of those rows.
