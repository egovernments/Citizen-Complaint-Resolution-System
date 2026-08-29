# PGR UI lifecycle + Keycloak parity harness

Two things live here:

1. **`pgr-ui-lifecycle.spec.ts`** — drives a PGR complaint **raise → assign →
   resolve entirely through the UI**. No API shortcuts anywhere, including login.
2. **The parity harness** (`run-parity.sh`, `capture.js`, `diff.js`, `probe-*.js`)
   — captures the same journey on two deployments of the identical build and
   diffs what DIGIT actually receives.

The UI-only constraint is the point. A Keycloak adapter changes *what the browser
holds* and *how each XHR is authorised*, so a test that acquires a token over the
API or seeds users out-of-band cannot see the class of bug this catches.

> **These write real data.** The spec files, assigns and resolves an actual
> complaint on whatever you point it at. It is excluded from the default
> `npx playwright test` collection and self-skips unless `BASE_URL` is set.

## Run

The lifecycle spec, against one deployment:

```bash
cd local-setup/tests
BASE_URL=https://<your-deployment> EMP_USER=ADMIN EMP_PASS=<password> \
  npx playwright test e2e/kc-parity/pgr-ui-lifecycle.spec.ts --project=chromium --workers=1
```

Useful knobs: `CID=<complaint-id>` reuses an existing complaint so the assign and
resolve steps can be iterated without re-running the ~3-minute citizen wizard
(step 1 then self-skips); `TOKEN_AUDIT=out/audit.json` records the credential
shape of every authenticated call; `EMP_CITY`, `AREA_MATCH`, `CITIZEN_MOBILE`,
`OTP`, `ASSIGNEE_MATCH` adapt it to a tenant's seed data.

The parity diff needs two deployments of the same build, one native-auth and one
Keycloak-fronted:

```bash
export BASELINE_URL=https://<native-auth-deployment>
export KC_URL=https://<keycloak-deployment>
./e2e/kc-parity/run-parity.sh boot
./e2e/kc-parity/run-parity.sh citizen  --mobile=<mobile> --otp=<otp>
./e2e/kc-parity/run-parity.sh employee --user=ADMIN --pass=<password> --city="<City>"
```

Outputs `out/<journey>-{baseline,kc}.json`, a screenshot per run, and
`out/<journey>-report.json`. Exit code 1 when a divergence survives.

Optional video capture of a full run, for demos or review:

```bash
BASELINE_URL=... KC_URL=... ./e2e/kc-parity/record-lifecycle.sh both
```

## What the parity harness compares

Per request: method, normalized path, status, **credential kind** (uuid = native
DIGIT vs jwt = Keycloak), request-body key shape (incl. `RequestInfo`), plus the
resulting localStorage session. Secrets and PII are never recorded — key names and
token *shapes* only.

Classification:
- **auth-plane** (`/auth/realms/*`, `/kc/realms/*`, `/user/oauth/token`) — the login
  mechanism itself, expected to differ.
- **by-design translation** — `/kc/<api>` is the same endpoint as `<api>`; the
  browser sends a JWT and the exchange service forwards a DIGIT uuid token
  upstream (confirm in its `[UPSTREAM]` log).
- **divergence** — MISSING / EXTRA / STATUS / AUTH_SHAPE / BODY_SHAPE.

`probe-browser-tokens.js` answers the related question directly: under Keycloak
every credential slot the SPA stores (`token`, `Citizen.token`, `Employee.token`,
`Digit.User.access_token`) holds a JWT, and the DIGIT token is never serialized to
the browser at all. The uuids visible in storage are the user's *identity* uuid,
not a session token.

## Known failure modes this harness detects

1. **`/kc` routed via Kong 401s** (`InvalidAccessTokenException`) — Kong's global
   DIGIT auth plugin rejects the Keycloak JWT *before* the exchange service can
   swap it. `/kc/` must proxy straight to the exchange service.
2. **Realm brute-force settings** — `quickLoginCheckMilliSeconds=1000` trips the
   legitimate fail→provision→retry pattern. Set to 0 (brute-force detection and
   failureFactor can stay).
3. **Session built from JWT claims alone** drops
   `id`/`userName`/`mobileNumber`/`locale`/`permanentCity`/`active`, and DIGIT
   components branch on those. Build it from the resolved DIGIT user instead.
4. **Never preset `CITIZEN.COMMON.HOME.CITY`** — `TopBar` gates its
   `events/notifications/_count` on `getCitizenCurrentTenant(true)`, i.e. on that
   key existing. Native citizen login leaves the home city unselected, so seeding
   it makes the SSO session issue a call the default UI never sends.
5. **Write paths validate the role on the token**, not on `RequestInfo.userInfo`.
   Forwarding a shared system token while setting `userInfo` to the acting user
   passes reads and fails writes with `INVALID_ROLE`.

## Fixes this required outside the test suite

Recorded here because the harness is what found them; the code lives elsewhere.

**`KeycloakAuthAdapter.js`** (`digit-ui-esbuild/packages/libraries/src/services/auth/`)
— two defects, both still present on `master`:

- *Employee type is never resolved.* The adapter never reads the exchange
  service's `digit_user_type` / `digit_roles`, and `login()` ends in
  `window.location.replace()`, which discards in-memory state — so every SSO user
  is classified `CITIZEN` and an employee session can never be built. Capture
  those fields at login and rehydrate after the redirect.
- *Citizen session tenant.* `const tenantId = this._tenantId || defaultCityTenant`
  with `defaultCityTenant = stateTenant + ".citya"`. A citizen signing in through
  Keycloak never sees the employee tenant dropdown, so `this._tenantId` is null and
  the session falls through to a synthesized `<state>.citya` that exists on no real
  deployment. Every downstream boundary lookup then offers another tenant's wards
  and PGR rejects the complaint with `INVALID_BOUNDARY_CODE`. Prefer the tenant of
  the DIGIT user the exchange service already resolved.

**Token exchange service** (external repo) — a compatibility rewrite forced
`tenantId=<default-city>` and `boundaryType=City` onto every `/boundary-service/`
call. Both are demo-specific: where `DIGIT_DEFAULT_TENANT` is unset the `pg.citya`
default survives and rewrites an already-correct tenant, and a hierarchy rooted at
something other than `City` has every real node filtered away. Guard it with
`if (!cityTenant.startsWith(stateTenant + '.')) return next();`.

## Gotchas

Hard-won while building this; all cost real time.

**Routes that do not exist.** Two employee routes are easy to get wrong, and an
unmatched `PrivateRoute` still renders the chrome and a breadcrumb — so a route
miss looks *exactly* like a broken screen (body text "Home", no buttons, no rows).

| wrong | actual |
|---|---|
| `/employee/pgr/inbox` | `/employee/pgr/inbox-v2` |
| `/employee/pgr/complaint/details/:id` | `/employee/pgr/complaint-details/:id` |

**There is no PGR Inbox card, by design.** `PGRCard.js` renders exactly two links:
`create-complaint` (CSR only) and `ACTION_TEST_SEARCH_COMPLAINT → inbox-v2`.
"Search Complaint" *is* the inbox.

**`inbox-v2` opens on the "My Complaints" tab**, which is empty until something is
assigned to you. An unassigned complaint only appears under "All Complaints".

**Status is a localised label, not a code.** Assert on "Pending for assignment" /
"Pending at last mile employee" / "Resolved", never `PENDINGATLME`.

**Selectors.** Employee login is `#emp-username` / `#emp-password`; the city is an
`<li>`; the privacy checkbox toggles **only** via
`label[for="privacy-component-check"]`; a first-login language screen follows. The
complaint wizard is an N-level cascade (`AUTHORITY_TYPE → MAIN_CATEGORY → SECTOR →
SUB_TYPE`) of `<button>`s reading `Select…` — but later steps read `Select County`,
so the matcher must be `/^Select(…|\s|$)/`.

**HRMS.** `_create` fails `ERR_HRMS_GENERATE_ID_ERROR` unless you pass an explicit
`code`; it validates roles against its own master, so a full admin role set is
rejected with `ERR_HRMS_INVALID_ROLE` (send `GRO`/`PGR_LME`/`EMPLOYEE`); and
`_update` rejects jurisdiction *removals*
(`ERR_HRMS_UPDATE_JURISDICTION_INCOSISTENT`) — always append.

**PGR assignment rules** (not Keycloak-related; native auth enforces them
identically): the assignee must be an HRMS employee whose **department matches the
complaint type's department**, and an account with no HRMS department can never be
an assignee.

## Expected result when the harness is green

| journey | verdict |
|---|---|
| boot | full parity |
| citizen | full parity |
| employee | full parity — lands on `/digit-ui/employee`, same DIGIT endpoints |
| inbox | full parity |

DIGIT receives byte-identical traffic; the only difference is the credential the
*browser* holds, which the exchange service swaps for a native uuid token before
anything reaches DIGIT.

The `citizen` journey is mildly flaky: native citizen auto-registration
(`POST /user/citizen/_create`) fires on some fresh sessions and has no Keycloak
equivalent, since the exchange service provisions the user. Re-run before
believing a divergence there.
