# Turning on login and permission checks at the API gateway

**The situation.** Every API request enters the system through one front door — the Kong
gateway. The gateway already contains code that can check two things on each request:

1. **Login check** — is the caller actually logged in?
2. **Permission check** — is the caller's role (citizen, admin, complaint officer, …)
   allowed to use this particular API?

Both checks currently run in **observe mode**: the gateway writes a warning in its log
("this request would have been blocked") but lets everything through. Two switches in
`local-setup/kong/kong.yml` (lines ~87 and ~90) turn real blocking on.

**Why we haven't flipped the switches.** The permission check reads from a table that says
"role X may call API Y." That table ships in our seed data, and it is incomplete. The rule
is strict: an API that isn't in the table is blocked for *everyone*, including admins. In a
20-hour test, **2,412 requests that should have succeeded would have been blocked** — city
onboarding, the admin configurator, even logging out. So flipping today would break the
product. Evidence: Appendix C.

**The plan in one line: complete the permissions table, fix four quirks in the gateway
itself, test again, then flip.**

This work is two files:

| file | purpose |
|---|---|
| `README.md` (this) | the plan, plus background (Appendix A), the re-test procedure (Appendix B), and the evidence (Appendix C) |
| `kong-rbac-action-inventory.xlsx` | one row per API: what's permitted today, what we propose, and a DECISION column. Only **44 rows** need a human decision — the rest are bulk-approved, mechanical, or out of scope |

## Step 1 — three bulk approvals

- **R1 — add the 68 missing APIs to the permissions table.** They aren't in the table at
  all, so today they'd be blocked for everyone. The roles to grant are prefilled in the
  spreadsheet's *Proposed roles* column (53 of the 68 are the R1 rows; the other 15 sit on
  NOTE / OUT-OF-SCOPE rows because nothing enforces them today — seed them all the same). Apply to both copies of the seed data
  (`local-setup/db/full-dump.sql` and the `db-seed` chart — both deployments use the same
  data). This one step fixes **85%** of the would-be blocks.
- **R2 — widen 20 APIs that are in the table but too narrow.** Only additions: admin
  roles on admin write-APIs, a read-only role on search-APIs.
- **R3 — the SUPERUSER role passes everything**, applied by a generated step so nobody
  maintains it by hand.

⚠️ The *Proposed roles* column is the **only record of these defaults**. They are exactly
what the seed data is missing, so they can't be reconstructed from it. Change values
during review as much as you like — just never blank the column.

## Step 2 — make the 44 open decisions

Open the spreadsheet, filter the Bucket column to D1–D16, and fill in DECISION. Every row
has a prefilled proposal, so this is accept-or-override, not research:

| # | what it covers (rows) | proposed default |
|---|---|---|
| D1 | APIs the city-onboarding flow uses to write settings/masters, incl. one legacy alias path (11) | settings-admin + superuser |
| D2 | the API that writes the permissions table itself (1) | settings-admin + superuser |
| D3 | the API that creates new data schemas (1) | add superuser to today's admin-only rule |
| D4 | APIs that create/edit/delete city boundaries (7) | superuser + settings/HR admins |
| D5 | the complaint-analytics APIs (3) | superuser + employee roles, per the dashboard's role setting |
| D6 | two brand-new complaint-inbox APIs (2) | same roles as the existing complaint search |
| D7 | an unrestricted complaint search (1) | superuser only — keep it tight |
| D8 | the employee work-inbox (1) | employee-family roles |
| D9 | save/read a user's own preferences (2) | citizen + employee + superuser |
| D10 | notification test/debug tools (3) | superuser |
| D11 | delete translations (1) | localization-admin + superuser |
| D12 | the link-shortener used by SMS notifications (1) | internal-service role — or leave open |
| D13 | two workflow counters nobody can call today (2) | same roles as the matching search API |
| D14 | WhatsApp chatbot webhooks (4) | leave open (whitelist) — WhatsApp can't log in |
| D15 | new v2 workflow-configuration APIs (3) | same roles as their v1 equivalents |
| D16 | logging out (1) | every logged-in role — everyone must be able to log out |

Worth knowing while deciding:
- **D3**: widen the API's rule; don't give the onboarding user an extra admin role.
- **D5** is the one real product question — *who gets to see analytics*. Tracked as
  issue #1514 (successor of #1279, which was closed without an answer).
- **D2** is circular: the request that fills the permissions table is itself blocked by
  the empty permissions table.

## Step 3 — fix four gateway quirks (not permission data)

- **E1** — 9 APIs put the login token somewhere the gateway doesn't look, so they'd be
  rejected *even for valid users* (encryption service, notification provider setup,
  translation cache-refresh, two analytics/migration APIs). Either exempt them or teach
  the gateway to read the token from the header.
- **E2** — only POST requests are checked. GET/PUT/DELETE pass with no login at all —
  including file downloads, the dashboard, and a handful of GET APIs (marked NOTE in the
  spreadsheet) that can't be protected until this is fixed.
- **E3** — the `/egov-location` APIs skip the checks entirely (two gateway plugins
  collide; only one wins).
- **E4** — 9 APIs are on the "no login needed" list that shouldn't be, including user
  search. Fixing this also means updating the CI script that currently insists on
  today's list (`.github/scripts/check-gateway-whitelist-parity.py`).

## Step 4 — test again, then flip

1. Land steps 1–3 in the seed data and `kong.yml`.
2. Bring up a stack, run real traffic, and check the gateway log for
   would-have-blocked warnings (Appendix B is the exact procedure). Ship only on a
   clean log.
3. Flip the login switch (`ENFORCE_UNAUTH`) first, watch, then flip the permission
   switch (`ENFORCE_RBAC`).

Related open issues: #1129 (cache the permission lookups), #1130 (one source file for the
exempt-lists), #1040 (a JSON bug in the gateway's user-info step), #1514 (the D5 analytics
decision), #1313 (whether the removed default-data-handler service returns; its stale
whitelist entry is already removed by PR #1513).

**Data check, 2026-07-30:** the two copies of the seed data carry identical permission
rows (195 APIs / 368 role grants), and no database migration touches this data — so the
numbers in this pack hold until someone edits the dumps. The API list was re-derived the
same day from the exact service versions pinned in
`local-setup/docker-compose.egov-digit.yaml` (sources: `DIGIT-Core@87e13fe`,
`DIGIT-Common@dd641a6`) — that refresh added the D15 group, one D13 row, one E1 row, and
five health probes. Re-check with Appendix B whenever the dumps or image pins change.

---

# Appendix A — background: how the check works

The gateway keeps a short list of APIs that need no login (the login API itself, one-time
passwords, public lookups). Everything else is "protected". For a protected request the
gateway:

1. pulls the login token out of the request body and asks the user service who this is
   (no valid token → rejected with 401);
2. asks the access-control service "may someone with these roles call this URL?" —
   that service answers from the permissions table (no matching entry → rejected
   with 403).

Design choices made when this was built, which still stand:

- **Observe first, block later.** Ship dark, collect would-have-blocked warnings, flip
  only on a clean log. This pack is that process.
- **If the access-control service is down, block** (don't silently open up); use a short
  timeout and a loud alert.
- **Permissions are per-tenant seed data.** Decisions land in the seed every new city
  gets — never hand-edited on one environment.
- **The no-login-needed list must have a single source** shared with the K8s gateway
  (issue #1130), and permission lookups should be cached before heavy traffic
  (issue #1129).
- **Scope:** this gate checks *roles against APIs*. Whether a citizen may see *this
  particular complaint* is the service's job, not the gateway's (e.g. the complaint-search
  scoping fix, PR #1100).

---

# Appendix B — procedure: re-verify before flipping

Run this after steps 1–3 have landed, before touching the switches. (It is written as a
task brief you can hand to an engineer or an AI assistant.)

## Goal
Prove that flipping `ENFORCE_UNAUTH` and `ENFORCE_RBAC` to `true` would not reject any
legitimate request. Produce a GO/NO-GO answer plus the exact list of anything to fix
first. Don't trust the test suite alone — list the APIs from source code.

## Method
Any API not on the gateway's exempt list is protected. The risks to rule out:
(a) an API that exists but was never classified — legitimate anonymous callers get 401;
(b) a protected API with no row in the permissions table — everyone gets 403;
(c) a protected POST whose body carries no `RequestInfo.authToken` — 401 even when
    logged in.

List every HTTP endpoint from source, at the versions actually deployed:
- this repo, `backend/`: pgr-services, digit-config-service, novu-bridge,
  digit-user-preferences-service, xstate-chatbot;
- the `egovernments/*` repos for every service imaged in
  `local-setup/docker-compose.egov-digit.yaml` — **match the image tags in the compose
  file**, not the repos' latest.

An endpoint's gateway path = the service's `server.servlet.context-path` + the
controller's mapping annotations. The gateway matches paths exactly (never by prefix).

## Key files
- `local-setup/kong/kong.yml` — the switches (~87, ~90); the `AUTH_OPTIONAL` exempt
  table; non-POST requests skip enforcement (~124). The permission call goes to
  `egov-accesscontrol:8090/access/v1/actions/_authorize`; HTTP 200 = allowed, anything
  else = blocked. Log lines to grep: `RBAC-audit`.
- The permissions table ships inside `local-setup/db/full-dump.sql` and the `db-seed`
  chart (MDMS masters `ACCESSCONTROL-ACTIONS-TEST.actions-test` and
  `ACCESSCONTROL-ROLEACTIONS.roleactions`). Compare what's seeded against the
  spreadsheet's *Proposed roles* column. The service caches this ~15 minutes; the HTTP
  method is not part of the match.

## Live probes (compose)
- Gateway at `http://localhost:8090`, network `digit_egov-network`, postgres container
  `docker-postgres` (user/db `egov`, pw `egov123`). Use
  `docker run --rm --network digit_egov-network curlimages/curl` for probes.
- Get a token: `POST {BASE}/user/oauth/token` with header
  `Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=` and form fields
  `username=ADMIN password=eGov@123 tenantId=<root> grant_type=password scope=read
  userType=EMPLOYEE`. Check the token actually carries roles before using it — a
  role-less token makes every rejection look like a bug.

## Steps
1. List all endpoints from source.
2. Cross-check each against the gateway's classification → report unclassified
   endpoints, and exempt-list entries that match no real endpoint.
3. For each protected POST: is it in the permissions table, with the roles its real
   callers hold? Flag envelope-less bodies (risk c).
4. Run real traffic (test suite + one full city onboarding) in observe mode, then
   `docker logs kong-gateway | grep RBAC-audit`. Explain every warning. A quiet log
   alone is NOT proof — only exercised APIs produce warnings; the source-code lists
   are the authority.

## Deliverable
Counts and lists for (a)–(c) plus the log analysis, ending in GO or NO-GO with the
minimal fix list. Read-only: don't flip the switches, don't change service code.

---

# Appendix C — evidence: 15 days of production traffic (Kenya deployment)

Collected 2026-07-30 from the live gateway's observe-mode log on the Kenya box
(2026-07-14 → 2026-07-29, 9,216 warnings). This replaces the original 20-hour lab run.
Two code findings from that first run still stand: the gate never lets an unlisted API
through (blocking on missing entries is intended — don't "fix" it by allowing), and the
K8s gateway fully enforces its "mixed" APIs (its lenient branch is dead code).

- **9,216 would-have-blocked warnings**: 198 missing-login (21 APIs) + 9,018
  missing-permission (63 APIs), dominated by city-onboarding / configurator traffic.
- **Some blocks are the point.** 18 of the missing-login warnings were internet scanners
  probing the raw IP, and 6 were anonymous calls to the internal no-validation
  user-create API — enforcement would rightly stop all of these.
- **The pack's proposals already clear 58%** (5,239 of 9,018) of the missing-permission
  warnings: R1 alone accounts for 2,476 (Department/Designation/IdFormat writes…), the
  D1 group 2,525 (ComplaintHierarchy and friends), plus D3/D4/D11/R2/OK smaller shares.
- **The two big residuals are already-tracked items**:
  - E1 (token in the wrong place): 2,105 calls — translation cache-refresh alone is
    2,049, plus key-generation 56.
  - D5 / issue #1514 (analytics): 1,583 calls to the three analytics APIs; approving the
    proposed roles clears them. Anonymous analytics calls also appear on the
    missing-login side — the posture question is real traffic, not theory.
- **Three findings folded into the sheet from this evidence**: real users' logout is
  denied for lack of a permission row (6 calls → D16); `boundary-relationships/_delete`
  exists and is used (8 → D4); the configurator writes dashboard packs through the
  legacy `/egov-mdms-service` alias path (4 → D1's alias row).
- **To verify during the Appendix B re-run**: 34 configurator calls to the translation
  `_upsert` API were denied although the sheet believes its seeding is correct — check
  that URI's seeded roles; 2 denies on MapConfig `_update` look *correct* (the caller
  genuinely lacked admin roles).
- **Also re-check E1's bucket.** The 2,105 E1 calls above are counted under
  *missing-permission*, but the gateway only reaches the permission call — and so only ever
  logs a missing-permission warning — once it has resolved a token out of
  `RequestInfo.authToken` (`local-setup/kong/kong.yml`, the `is_protected and resolved`
  guard). A body with no envelope exits earlier, as *missing-login*. Both can't be true for
  the same call, and 2,105 can't sit in a missing-login bucket that totals 198. So either
  these callers (chiefly translation cache-refresh, 2,049) do send a normal envelope — in
  which case the remedy is a permission row, not E1's engineering fix — or the two buckets
  were mis-attributed when the log was tallied. Settle it from the raw warning lines before
  acting on E1, and correct the spreadsheet's E1 rows if the envelope turns out to be there.
- **Public-site traffic**: 65 anonymous complaint search/count calls came from the app
  domain. Once the login switch flips these get 401s — decide whether the public landing
  page needs them (then whitelist explicitly) or not (then this is working as intended).
- One workflow counter API still has a permission row with **no role** attached — blocked
  for everyone (→D13).
