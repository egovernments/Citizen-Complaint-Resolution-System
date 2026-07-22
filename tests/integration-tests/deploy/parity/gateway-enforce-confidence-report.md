# Gateway ENFORCE confidence report — Kong (compose) AUDIT → ENFORCE

**Verdict: NO-GO.** Flipping `ENFORCE_UNAUTH` and `ENFORCE_RBAC` to `true` today would reject a large
volume of *legitimate* traffic — city onboarding/seeding, Keycloak login, logout, notification
URL-shortening, and the configurator's provider management. 20 hours of real traffic through the
running (audit-mode) Kong already logged **2,412 would-blocks**.

It also would not deliver what the flip is meant to deliver: enforcement is **POST-only**, so every
`GET`/`PUT`/`DELETE` stays anonymous either way, and the `/egov-location` route is exempt from the auth
plugin entirely.

**Two premises in the task brief turned out to be wrong.** Both were tested against source *and* the
live k3s gateway, and both are refuted — they change the fix list, so read §3 before acting:
- Drift #2 ("for a protected URI with no accesscontrol action, k3s allows, Kong denies") — **false.
  k3s denies too.** Kong's deny is parity-*correct*; the bug is the missing seed data, not the gate.
- Drift #1 ("k3s treats mixed-mode as auth-required, RBAC-skipped") — **half false. k3s requires auth
  AND runs full RBAC** on mixed-mode paths. Kong serves all 9 anonymously.

Analysis is against branch **`fix/dual-deploy-parity`**, which carries the flags
(`local-setup/kong/kong.yml:81,84`). Read-only: no flags flipped, no service code changed.

---

## 1. Method and surface

Routes were enumerated from **service source (develop/master)** — not from the test suite, not from k3s.

| Source | Services |
|---|---|
| `egovernments/core-services` @ develop | egov-user, egov-accesscontrol, egov-idgen, egov-filestore, egov-enc-service, egov-localization, egov-workflow-v2, egov-url-shortening, egov-indexer, egov-persister, egov-otp, user-otp, egov-location |
| `egovernments/DIGIT-Core` @ master | mdms-v2, boundary-service, audit-service |
| `egovernments/business-services` @ develop | egov-hrms |
| `egovernments/municipal-services` @ develop | inbox |
| `egovernments/DIGIT-Common` @ develop | egov-bndry-mgmnt (Node/Express; located via code search) |
| this repo, `backend/` | pgr-services, digit-config-service, novu-bridge, user-preferences, xstate-chatbot |

`gateway_path` = `server.servlet.context-path` + class `@RequestMapping` + method mapping.

**155 endpoints** enumerated. **139** sit behind a Kong route. **117** are POST — the only ones
enforcement can act on. **22** are non-POST.

### What "enforce" actually does (`kong.yml:111-264`)

```lua
if kong.request.get_method() ~= "POST" then return end   -- :124  non-POST is NEVER enforced
local is_protected = not AUTH_OPTIONAL[uri]              -- :112  EXACT match, never prefix
```

A **POST** on a **protected** path is rejected unless *all* of these hold:
1. the body parses as a JSON **object**, and
2. it has a `RequestInfo` key holding a non-empty **`authToken`** string, and
3. `egov-user /user/_details` resolves that token, and
4. `egov-accesscontrol /access/v1/actions/_authorize` returns **200** for (roles, uri).

Step 4 is the trap: **`_authorize` is default-deny.** `ActionService.java:116` builds its allow-set
*only* from actions mapped to the caller's roles, so an unmapped URI is absent → `false` →
`ActionController.java:110-118` returns **401**. Live confirmation against the running service:

| probe | result |
|---|---|
| `uri=/totally/bogus/path/_search`, role CITIZEN | **401** — no action → deny |
| `uri=/access/v1/actions/mdms/_get`, role CITIZEN | 200 — action exists, role holds it |
| `roles: []` | **400** (`@Size(min=1)`) → non-200 → deny |

Actions live in MDMS **`ACCESSCONTROL-ACTIONS-TEST/actions-test`** (the `eg_action` table is empty and
unused by `_authorize`), cached 15 min, matched exactly or by `{var}`→`\w+` regex. **The HTTP method is
not part of the match.**

---

## 2. Findings

### (a1) 18 protected POSTs whose body is **not** a `RequestInfo` envelope → **401 even with a valid token**

There is no `RequestInfo.authToken` for the pre-function to find. A token in a header, query param, or
multipart part does not count. These fail *regardless of who calls them*.

| Route(s) | body | why it breaks |
|---|---|---|
| `/novu-bridge/novu-adapter/v1/providers`, `…/providers/verify`, `…/providers/test-send` | plain-json | token is in the **`Authorization` header** by design (`ProxyAuthFilter`); kong.yml's own comment says "Kong is a dumb router here" |
| `/user/_logout` | plain-json | `TokenWrapper{access_token}` — **logout breaks** |
| `/user/_details` | query-only | `?access_token=`, no body at all |
| `/egov-enc-service/crypto/v1/_encrypt` \| `_decrypt` \| `_sign` \| `_verify` \| `_rotatekey` \| `_rotateallkeys` | plain-json | 6 endpoints, no envelope on any |
| `/egov-hrms/employees/_count` | plain-json | `@RequestBody RequestInfo` is the **bare** class — flat body, no `RequestInfo` key |
| `/egov-indexer/index-operations/{key}/_index` | plain-json | whitelist has untemplated `…/_index`, which can never match |
| `/localization/messages/cache-bust` | query-only | POST with zero params |
| `/otp/v1/_create`, `/otp/v1/_search` | plain-json | `OtpRequest` has no RequestInfo |
| `/pgr-services/migration/_transform` | plain-json | DTO is a *response* object |
| `/pgr-services/v2/analytics/_schema` | none | no `@RequestBody` |

`/user/oauth/token` (form-urlencoded) and `/filestore/v1/files` (multipart) are **safe** — already in
`AUTH_OPTIONAL`, so `is_protected` is false and the body is never inspected.

**The pre-function is a *global* plugin**, so it also guards `/auth`, `/kc`, `/grafana`, `/jupyter`,
`/inbox`, `/digit-ui` — none of which speak DIGIT envelopes. The live log already shows
**`POST /auth/login` (Keycloak) — 4 would-401s.**

### (a2) 27 protected POSTs with a proper envelope but **no accesscontrol action** → 403

`/access/v1/actions/_authorize`, `/access/v1/actions/_list`, `/boundary-service/boundary/_update`,
`/boundary-service/boundary-relationships/_update`, `/egov-bndry-mgmnt/boundary-management/v1/_generate`,
`…/_generate-search`, `…/_process`, `…/_process-search`, `/egov-indexer/index-operations/_legacyindex`,
`…/_reindex`, `/egov-workflow-v2/egov-wf/auto/{businessService}/_escalate`, `…/_test`,
`/egov-workflow-v2/egov-wf/process/_statuscount`, `/inbox/v1/_search`, `/localization/messages/v1/_delete`,
`/mdms-v2/schema/v1/_update`, `/mdms-v2/v2/_create/{schemaCode}`, `/mdms-v2/v2/_update/{schemaCode}`,
`/novu-bridge/novu-adapter/v1/dispatch/_dry-run`, `…/_test-trigger`, `…/_validate`,
`/pgr-services/v2/analytics/_query`, `/pgr-services/v2/analytics/catalog/_search`,
`/pgr-services/v2/analytics/packs`, `/pgr-services/v2/request/_plainsearch`,
`/user-preference/v1/_search`, `/user-preference/v1/_upsert`.

Highest blast radius: **`/mdms-v2/v2/_create/{schemaCode}`** and **`_update/{schemaCode}`**. Only ~14
specific schemaCodes have actions; **every other schemaCode is default-denied** — and those are exactly
what the XLSX city-onboarding / seeding flow writes.

### (b) 1 protected POST whose action **no role holds** → 403 for everyone
`/egov-workflow-v2/egov-wf/process/_count` (action id 2027, zero roleactions).

### (c) Drift #1 — mixed-mode routes mis-bucketed: **9**

Kong has **no mixed-mode bucket** — only `AUTH_OPTIONAL` (anonymous, no RBAC) vs protected (auth + RBAC).
All 9 k3s *mixed* paths therefore sit in `AUTH_OPTIONAL`:

`/access/v1/actions/mdms/_get`, `/egov-idgen/id/_generate`, `/egov-location/location/v11/boundarys/_search`,
`/filestore/v1/files/tag`, `/user/_search`, `/workflow/history/v1/_search`,
`/boundary-service/boundary/_search`, `/boundary-service/boundary-hierarchy-definition/_search`,
`/boundary-service/boundary-relationships/_search`.

**This is a laxity that the flip does not fix**, and it is worse than the brief assumed. The k3s gateway
requires a token on these **and** runs full RBAC (`RbacPreCheckFilter.java:43-49` skips RBAC only for the
*open* list; the mixed-mode "anonymous" branch in `AuthPreCheckFilterHelper.java:65-75` is dead code —
the `List<String>` bean it reads is never published, so mixed ≡ protected on k3s in practice).

Live differential, `/user/_search` with no token:

| | result |
|---|---|
| k3s (Spring gateway) | **401** — auth required |
| Kong (compose), before *and* after the flip | **400** — request passed the gateway and reached egov-user |

So anonymous `/user/_search` on compose is a real, open gap, and flipping the flags leaves it open.

---

## 3. The two refuted premises (read before writing the fix)

**Drift #2 — "k3s allows on no-action, Kong denies" is FALSE. Both deny.**
The Spring gateway calls `_authorize` on every protected request and treats anything but 200 as deny
(`RbacFilterHelper.java:112-124` — 4xx, timeout, and accesscontrol-down all `return false`). It does not
pre-fetch an action list. Proven live on k3s with a valid ADMIN token (SUPERUSER + 7 roles):

| k3s request (valid token) | result |
|---|---|
| `/egov-workflow-v2/egov-wf/process/_statuscount` (no action) | **401** "You are not authorized" |
| `/localization/messages/v1/_delete` (no action) | **401** |
| `/egov-workflow-v2/egov-wf/process/_search` (action held) | **200** |

**Consequence: do not "fix" Kong by allowing on no-action.** That would diverge from k3s *and* open a
hole. Kong's deny is correct. The real defect is **seed data**, not the gate.

### k3s is the existence proof — and it names the fix exactly

k3s runs this same default-deny gate, in production, and it works. Its seeding traffic *does* traverse
the gateway (`digit-mcp` on k3s is configured `CRS_API_URL=http://gateway:8080`), so it is subject to the
same RBAC. It works because **its accesscontrol master is seeded and compose's is not**:

| tenant `mz`, `ACCESSCONTROL-ACTIONS-TEST.actions-test` | k3s | compose |
|---|---|---|
| action rows | **330** | 246 |
| distinct action URLs | **263** | 195 |

**68 action URLs exist on k3s and are missing on compose** — and they are precisely the ones being
denied: `/mdms-v2/v2/_create/common-masters.IdFormat`, `…Department`, `…Designation`, all the
`egov-hrms.*`, `DataSecurity.*`, `Workflow.*` schemaCodes, plus `/egov-bndry-mgmnt/v1/_*`,
`/config-service/*` and `/default-data-handler/tenant/new`.

On top of that, **26 URLs present on both stacks grant more roles on k3s**. Critically, every one of the
5 "needs `MDMS_ADMIN`" URIs from the audit log is **also granted `SUPERUSER` on k3s** — and the compose
seeding principal *has* `SUPERUSER`:

```
/mdms-v2/v2/_create/ACCESSCONTROL-ROLEACTIONS.roleactions   compose: MDMS_ADMIN   k3s: MDMS_ADMIN,SUPERUSER
/mdms-v2/v2/_create/ACCESSCONTROL-ACTIONS-TEST.actions-test compose: MDMS_ADMIN   k3s: MDMS_ADMIN,SUPERUSER
/mdms-v2/v2/_create/tenant.tenants                          compose: MDMS_ADMIN   k3s: MDMS_ADMIN,SUPERUSER
```

**Replaying the 20h audit log against k3s's action data, with the compose seeding principal's actual
roles, clears 2,026 of the 2,370 would-403s (85%).** So the dominant failure class is not a design flaw
in the Kong port at all — it is a missing seed. Granting `MDMS_ADMIN` is *not* required; syncing the
master is.

**344 calls across 8 URIs would still be denied — and would be denied on k3s too:**

```
246  /mdms-v2/v2/_create/ACCESSCONTROL-ACTIONS.actions          no action on either stack
 67  /mdms-v2/schema/v1/_create                                 MDMS_ADMIN-only on both
 18  /mdms-v2/v2/_create/RAINMAKER-PGR.ComplaintHierarchy       no action on either stack
  6  /mdms-v2/v2/_create/RAINMAKER-PGR.ComplaintHierarchyDefinition
  2  /mdms-v2/v2/_create/common-masters.ThemeConfig
  2  /mdms-v2/v2/_create/common-masters.MobileNumberValidation
  2  /localization/messages/cache-bust
  1  /access/v1/actions/_authorize
```

These 8 need an explicit decision each (seed an action, grant `MDMS_ADMIN` to the seeder, or route them
around the gateway). They are the genuinely new work; the other 2,026 are a data sync.

**Drift #1 — "mixed = RBAC-skipped" is FALSE** (see §2c). Mixed ≡ protected on k3s. So the parity-correct
Kong config is `AUTH_OPTIONAL` = k3s **open only** (30 entries), *not* open ∪ mixed (39).
`.github/scripts/check-gateway-whitelist-parity.py` asserts `AUTH_OPTIONAL == open ∪ mixed` — **the CI
check currently encodes the bug** and would fail a correct config.

---

## 4. Audit-log shadow — 20h of real traffic (this is the strongest evidence)

`docker logs kong-gateway` → **2,412** `RBAC-audit` lines: **42 would-401** (10 distinct paths) and
**2,370 would-403** (39 distinct URIs). Every one of these succeeds today.

| would-403 cause | distinct URIs | calls |
|---|---|---|
| **No action exists** → default-deny (denies *even an `MDMS_ADMIN`*) | 34 | 962 |
| **Action exists, caller's roles lack it** (all 5 need `MDMS_ADMIN`) | 5 | 1,408 |

Top offenders, all from the configurator/seeding path (`referrer: /configurator/phase/1`):

```
736  /mdms-v2/v2/_create/ACCESSCONTROL-ROLEACTIONS.roleactions    needs MDMS_ADMIN
492  /mdms-v2/v2/_create/ACCESSCONTROL-ACTIONS-TEST.actions-test  needs MDMS_ADMIN
354  /mdms-v2/v2/_create/common-masters.IdFormat                  NO ACTION
246  /mdms-v2/v2/_create/ACCESSCONTROL-ACTIONS.actions            NO ACTION
 90  /mdms-v2/v2/_create/common-masters.Department                NO ACTION
 67  /mdms-v2/schema/v1/_create                                   needs MDMS_ADMIN
 65  /mdms-v2/v2/_create/tenant.tenants                           needs MDMS_ADMIN
```

The seeding principal holds `SUPERUSER, EMPLOYEE, CITIZEN, CSR, GRO, DGRO, PGR_LME,
INTERNAL_MICROSERVICE_ROLE` — **not `MDMS_ADMIN`**. Granting it fixes only the 5 wrong-role URIs: the 34
no-action URIs deny regardless of role (proven — one `MDMS_ADMIN` caller was still denied on
`common-masters.Department`). Note the recursion: seeding *the actions master itself* is one of the calls
that would be denied.

**would-401** (anonymous today → 401 after the flip): `/pgr-services/v2/request/_search` (9),
`/egov-workflow-v2/egov-wf/businessservice/_search` (7),
`/mdms-v2/v2/_create/common-masters.Department` (6), `/egov-hrms/employees/_search` (4),
`/egov-hrms/employees/_count` (4), `/egov-enc-service/crypto/v1/_generatekey` (4), **`/auth/login` (4)**,
`/user/users/_createnovalidate` (2), `/user/_details` (1),
`/mdms-v2/v2/_create/ACCESSCONTROL-ROLES.roles` (1).

Only 49 distinct URIs were exercised in the window, so **absence of a would-block is not evidence of
safety** — the static lists in §2 are the authority.

---

## 5. Structural gaps the flip does *not* close

1. **Enforcement is POST-only** (`kong.yml:124`). Proven live: anonymous
   `GET /pgr-services/v2/dashboard?tenantId=mz` → **HTTP 200 with data** and **no audit line**, while the
   POST control does log one. 22 non-POST endpoints behind Kong stay open, including
   `GET /filestore/v1/files/id` (file download, no auth material at all). k3s enforces on every method.
2. **`/egov-location/*` is exempt from auth entirely.** Kong resolves **one** config per plugin name by
   specificity, so the route-scoped `pre-function` (the boundary adapter, `kong.yml:211-284`) *replaces*
   the global auth `pre-function`. Proven live: an anonymous POST to
   `/egov-location/boundarys/getByBoundaryType` produced **no audit line**, while `/egov-hrms/employees/_search`
   did. 30 endpoints on that prefix are unauthenticated regardless of the flags.
3. **11 of 39 `AUTH_OPTIONAL` entries are dead** — they match no route any service serves, so the endpoint
   they were meant to open is silently *protected*: `/pgr/services/v1/_search` (real path:
   `/pgr-services/v2/request/_search`), `/egov-url-shortening` (real: `/egov-url-shortening/shortener` →
   **notification URL-shortening 401s**), `/egov-indexer/index-operations/_index` (real: `…/{key}/_index`),
   `/workflow/history/v1/_search`, `/tenant/v1/tenant/_search`, `/default-data-handler/tenant/new`,
   `/filestore/v1/file`, `/egov-mdms-service/v1/_reload`, `/egov-mdms-service/v1/_reloadobj`,
   `/egov-mdms-service-test/v1/_search`, `/egov-mdms-service/v1/_get`.
   Exact-match means a **templated path can never be whitelisted as-is** — that needs a pattern bucket.

---

## 6. Minimal fix list (to reach GO)

**Must fix — otherwise legitimate traffic is rejected**

1. **Sync compose's accesscontrol master to k3s's** — this alone clears **2,026 of the 2,370** would-403s
   (85%), and k3s proves it works under the same gate (§3). Concretely, for tenant `mz`:
   *(a)* add the **68 missing action URLs** to `ACCESSCONTROL-ACTIONS-TEST.actions-test`, and *(b)* add the
   missing `roleactions` — notably **grant `SUPERUSER`** on the 5 mdms `_create`/`_update` URIs where
   compose currently grants only `MDMS_ADMIN`. Do **not** grant the seeder `MDMS_ADMIN` (k3s doesn't) and
   do **not** make Kong allow-on-no-action (k3s denies too).
   Bootstrap ordering matters: seeding the actions master is itself one of the calls that would be denied,
   so load this master **before** enabling `ENFORCE_RBAC`, or seed it direct-to-service around Kong.
2. **Decide the 8 residual URIs** (344 calls) that k3s's data does *not* cover — see §3. Each needs an
   explicit call: seed an action, grant the seeder `MDMS_ADMIN` (needed for `/mdms-v2/schema/v1/_create`),
   or route around the gateway. Investigate how k3s survives these — most likely those flows are either
   unused or were seeded at the DB layer rather than through the API.
3. **Exempt or re-shape the 18 non-envelope POSTs** (§2 a1) — they 401 even with a valid token. Add a
   `HEADER_AUTH` bucket that accepts `Authorization: Bearer` / `auth-token` (covers novu-bridge, Keycloak,
   `/kc`, grafana, jupyter), and skip body inspection on routes that are not DIGIT services.
   `/user/_logout` and `/user/_details` need an explicit carve-out either way.
4. **Scope the global pre-function** so it does not apply to `/auth`, `/kc`, `/grafana`, `/jupyter`,
   `/tempo`, `/digit-ui`. Today it does, and their POSTs will 401 the moment those profiles are enabled.
5. **Fix the 11 dead whitelist entries** so the endpoints they intend to open actually match — notably
   `/egov-url-shortening/shortener` and `/egov-indexer/index-operations/{key}/_index` (needs pattern support).

**Should fix — the flip is otherwise a half-measure**

6. **Enforce on all methods, not just POST** (`kong.yml:124`), else every `GET` stays anonymous. This will
   surface a *new* set of would-blocks — re-run the audit after changing it; do not flip both at once.
7. **Move the 9 mixed-mode paths OUT of `AUTH_OPTIONAL` into protected** so Kong matches k3s (auth + RBAC),
   leaving `AUTH_OPTIONAL` = k3s *open* only. Then **update `check-gateway-whitelist-parity.py`**, which
   asserts `AUTH_OPTIONAL == open ∪ mixed` and would fail the corrected config. Verify per path first —
   e.g. `/filestore/v1/files/tag` has no action, so it would 403 until one is seeded.
8. **Restore auth on `/egov-location`** — fold the boundary adapter into the global pre-function, or move it
   to a different plugin (`post-function` / `request-transformer`) so it stops shadowing the auth plugin.

**Recommended sequence:** fix 1 + 3 + 4 (and decide 2) → re-run in AUDIT until `RBAC-audit` is clean across a full
onboarding + PGR lifecycle → flip `ENFORCE_UNAUTH` alone → observe → flip `ENFORCE_RBAC` → then 5, 6, 7.

---

## 7. Caveats

- **Not running in this compose instance** (profile-gated): `inbox`, `egov-indexer`, `egov-otp`, `user-otp`,
  `novu-bridge`, `keycloak`, `token-exchange-svc`, `grafana`, `tempo`. Their Kong routes exist, so their
  findings come from source/config and will bite when those profiles are enabled. (The `/auth/login`
  would-401s are from an earlier window when keycloak was up.)
- Several §2-a1 breakages would **also** fail on the k3s gateway (it likewise demands a body
  `RequestInfo.authToken` and rejects multipart/form POSTs on protected paths). They are regressions
  against *compose today*, not against k3s.
- `egov-persister` has **zero** HTTP endpoints (pure Kafka consumer) — the `/common-persist` route is dead.
- `egov-bndry-mgmnt`'s Kong route is already broken independently of this work: `strip_path: true` with no
  service `path`, but the app's context is `/boundary-management`, so `/egov-bndry-mgmnt/v1/_process`
  (what the configurator calls) 404s upstream.
- `/egov-mdms-service` is an **nginx rewrite** onto mdms-v2, not a real service; `/egov-mdms-service/v1/_get`
  is already a 404.
