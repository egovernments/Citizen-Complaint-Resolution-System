# PGR Supervisor Dashboard — Showcase Demo Runbook (bomet)

A click-by-click script for demoing the PGR supervisor dashboard **live** on
bomet: `https://bometfeedbackhub.digit.org`.

- **Verified login matrix:** [`login-matrix.md`](./login-matrix.md) (who sees the
  dashboard, who doesn't — every row checked live on 2026-07-09).
- **Reproduce the matrix:** [`verify-login-matrix.sh`](./verify-login-matrix.sh)
  (run on the bomet host).

---

## 0. Read this first — two things that will surprise you if you don't

1. **The employee left sidebar works on bomet (fixed 2026-07-09).** It had been empty
   for every role because `egov-accesscontrol` reads `ACCESSCONTROL-ACTIONS.actions`
   but the `tenant_bootstrap` had only seeded the 254 actions under the non-standard
   `ACCESSCONTROL-ACTIONS-TEST.actions-test` (the "ACTIONS bridge" step silently failed
   on a schema-propagation race — see egovernments/CCRS#1106). The actions were bridged
   to the standard module on bomet, so `/access/v1/actions/mdms/_get` now returns actions
   for every role and the Dashboard nav entry renders. **Caveat for a *fresh* box:** the
   durable bootstrap fix (`fix/mcp-actions-bridge-schema-wait`) is not merged yet, so a
   newly-bootstrapped tenant would need the same bridge. On bomet you can demo via the
   sidebar **and** these two entry points:
   - the **home card** that appears after login (gated by role), or
   - the **deep link**: `https://bometfeedbackhub.digit.org/digit-ui/employee/dashboard`.

2. **Access control is enforced in the frontend, not the backend.** The home card
   and the `/employee/dashboard` route are gated by `DASHBOARD_ROLES` in
   `products/dashboard/roles.js`. The analytics backend (`/packs`) will happily answer
   for a CSR-only user — but that user never reaches a screen that calls it. Demo the
   gate via the UI (card present/absent, deep-link redirect), not via API.

---

## 1. Pre-demo checklist (do this 15 min before)

- [ ] **Logins ready** (all password `eGov@123`):
  - Access / executive: **`KE_ADMIN`**
  - Access / supervisor pack: **`DEMO_SUPERVISOR`** (clean single-role SUPERVISOR)
  - No access (contrast): **`ANDREW`** (CSR only)
  - Do **not** use `BOMET_ADMIN` — its password is not `eGov@123` (login fails).
- [ ] **Data freshness.** Open the dashboard as `KE_ADMIN` and check any tile's
  "updated" stamp (`CardUpdatedStamp` / the `asOf` on API responses). Last verified
  `asOf` = **2026-07-09 03:30 UTC** (today) — snapshots are fresh. If tiles look
  stale, the analytics materialized views (V2) refresh **manually** — trigger a
  refresh before the demo.
- [ ] **Backend is up.** From the bomet host:
  `curl -s -X POST http://127.0.0.1:18000/pgr-services/v2/analytics/packs -H 'Content-Type: application/json' -d '{"tenantId":"ke","RequestInfo":{"authToken":"<token>"}}'`
  should return a `tiles` array. (37 tiles in the full catalog; 15 in the admin pack.)
- [ ] **Deep link works.** In an incognito window, hit
  `.../digit-ui/employee/dashboard` — logged out it should send you to login, not 404.
- [ ] Re-run [`verify-login-matrix.sh`](./verify-login-matrix.sh) once to confirm the
  logins still behave as documented.

---

## 2. The 5-minute highlight reel (if you only have 5 minutes)

1. **Access control (60s)** — `KE_ADMIN` logs in → home card visible → open dashboard.
   Then `ANDREW` logs in → no card → deep link redirects to `/employee`.
2. **The map (60s)** — the Leaflet ward choropleth + complaint pins; hover a ward.
3. **KPIs + open-by-stage (60s)** — the executive number tiles and the open-by-type
   stacked bar.
4. **Filters (60s)** — pick a ward and a complaint type; watch tiles rescope; show the
   empty-result map overlay.
5. **Role packs (60s)** — log in as `DEMO_SUPERVISOR` to show a *different* pack
   (officer-SLA, complaints-at-risk) auto-selected by role.

Full script below.

---

## 3. Demo Part A — Access control

**A1. Admin WITH access.**
1. Go to `https://bometfeedbackhub.digit.org/digit-ui/employee/login`.
2. Log in `KE_ADMIN` / `eGov@123`, tenant/city as prompted.
3. On the employee home you should see the **Dashboard card** (icon + "Dashboard").
   *(It renders because `hasAccess(["…","SUPERUSER"])` is true — `KE_ADMIN` holds
   SUPERUSER, GRO, DGRO, PGR_LME.)*
4. Click the card **or** open the deep link
   `.../digit-ui/employee/dashboard`. The dashboard renders **embedded** inside the
   employee chrome (its own standalone sidebar/login are suppressed in embedded mode).

**A2. User WITHOUT access.**
1. Log out. Log in `ANDREW` / `eGov@123` (role: **CSR** only).
2. On the employee home the **Dashboard card is absent** — nothing to click.
3. Now paste the deep link `.../digit-ui/employee/dashboard`. The route guard
   (`Module.js:15`) fires and **redirects to `/employee`** — the dashboard never
   renders.
4. Talking point: the gate is `DASHBOARD_ROLES = [SUPERVISOR, PGR_SUPERVISOR, GRO,
   DGRO, PGR_LME, PGR_ADMIN, SUPERUSER]`, checked by role code across tenants (roles
   live at the `ke` state root while the working tenant is a city). CSR isn't in the
   list → no access.

---

## 4. Demo Part B — The dashboard tour (log in as `KE_ADMIN`)

The admin (executive) pack seeds **12 tiles** (15 available). Walk the tile groups:

- **KPI number tiles (top row).** Single-number cards with a sparkline and a
  delta-vs-prior badge. Live examples in the admin pack: *Total complaints*
  (`cl_total_complaints_count`), *Resolved on time %*
  (`cl_resolved_on_time_rate_count`), *Resolved in range* (`cl_resolved_date_range_count`),
  *Flow ratio* (`cl_flow_ratio_count`), *Oldest open age* (`cl_oldest_open_age`),
  *Avg CSAT* (`cl_csat_avg`). These read from the analytics materialized views; the
  little "updated" stamp shows the snapshot `asOf`.
- **Open-by-stage / open-by-type.** The stacked/grouped bars — *Open by type & stage*
  (`cl_chart_open_by_type_stage`), *Open by age* (`cl_chart_open_by_age`), *Open by
  channel* (`cl_chart_open_by_channel`). These are **live open-snapshot** tiles —
  they intentionally reflect the current open backlog (see the date-filter note in
  Part C).
- **Complaint-type details table** (`cl_table_complaint_type_details`). One row per
  complaint sub-type with avg resolution time, ideal SLA, reopen rate, on-time rate,
  avg CSAT. *(Live row count today: 35 sub-types — see the #1026 call-out in §7.)*
- **SLA tiles.** *Wards by SLA* (`cl_chart_wards_by_sla`), *SLA compliance %*
  (`cl_sla_compliance_rate_count`), *SLA non-compliance %*
  (`cl_sla_noncompliance_rate_count`), *Officer SLA* (`cl_chart_officer_sla`).
- **Ward performance table** (`cl_table_ward_performance`) and *Recurring
  ward×subtype* (`cl_table_recurring_ward_subtype`) — where and what keeps breaking.
- **The Leaflet choropleth map + pins.** *Ward WoW current* (`cl_map_ward_wow_current`)
  shades each ward by open-complaint volume; *complaint pins* (`cl_map_complaint_pins`)
  drops individual pins. Hover a ward for a tooltip (count + WoW delta). Ward highlight
  colour is MDMS-driven (`MapConfig.wardHighlightColor`); basemap is CARTO dark.

---

## 5. Demo Part C — Filters

The global filter bar (top of the dashboard) has three controls:

1. **Geography / ward** dropdown — "All wards" plus each ward. Options are scoped to
   the tenant's boundary tree.
2. **Complaint type** dropdown — "All types" plus every type, **grouped by the
   ComplaintHierarchy** (N-level parent → child grouping). Pick a group or a leaf.
3. **Date range** — *From* / *To* (defaults: last month → today).

Demo flow:
1. Pick a single ward → charts, tables and the map recolour to that ward.
2. Pick a complaint type (or a hierarchy group) → tiles rescope to it.
3. **Empty-result overlay (#1031).** Choose a ward × type combination with no data.
   The choropleth shows its **empty overlay** (`GeographyChoroplethMap.jsx:758`
   `showEmpty` when there are no ward counts and no error) instead of a blank/broken
   map. Good "graceful empty state" talking point.
4. **Date-range caveat (say this out loud).** Changing the date range rescopes the
   *time-series and resolved-in-range* tiles, but the **live open-snapshot** tiles
   (open-by-stage/age/channel, the open map) **ignore the date filter by design** —
   they always reflect the current open backlog. This is intentional, not a bug.
5. **Department-scoped view.** A department-scoped login (e.g. a `DEMO_HEALTH`-style
   user) sees options and data scoped to that department's services only (e.g.
   `MEDICAL_SVC`) — its pack and complaint-type options are narrowed server-side.

---

## 6. Demo Part D — KPI picker, layout, packs, public view

1. **Add a KPI.** Open the **Add KPI** picker (dropdown / "+"): it lists every
   role-visible catalog tile not already on the board (source: `/catalog/_search`,
   already RBAC-filtered server-side). Add one — it appears on the grid.
2. **Rearrange / resize.** Drag a tile; drag the resize grip. The layout **persists
   per browser** (saved layout beats the pack seed on reload). Reload to prove it
   sticks. *(Persistence is per-browser localStorage — a fresh browser resets to the
   role's pack seed.)*
3. **Packs switch by role — show it live:**
   - `KE_ADMIN` (SUPERUSER) → **executive pack**: 15 tiles / 12 seeded (totals,
     flow-ratio, ward SLA, subtype performance, dept scatter…).
   - `DEMO_SUPERVISOR` (SUPERVISOR) → **supervisor pack**: 11 tiles (resolution rate,
     breach total, reopen rate, **officer SLA**, **complaints-at-risk**, open-by-type-
     stage, ward map). Log in as each and point out the different default board — this
     is the RBAC pack model, not a manual layout.
4. **Public / anonymous view.** The standalone dashboard supports an anon/public pack
   (the backend returns a broad 25-tile catalog with **no seeded layout** for a
   non-privileged principal). Use this to show a read-only public snapshot without an
   employee login. *(In the embedded employee flow this isn't reachable without a
   role — demo it via the standalone dashboard entry if your build exposes it.)*

---

## 7. Known-issue call-outs (so nothing surprises you)

- **Employee sidebar (fixed 2026-07-09).** Covered in §0 — it had been empty because the
  ACCESSCONTROL actions were seeded under `ACCESSCONTROL-ACTIONS-TEST` instead of the
  standard module (CCRS#1106; **not** the mdms image). Bridged on bomet, so the sidebar +
  Dashboard nav now render. The home card / deep link still work as alternates. A fresh
  box still needs the bridge until `fix/mcp-actions-bridge-schema-wait` merges.
- **#1026 — complaint-type table sub-type count.** History: the FE table was reported
  showing ~12 sub-types instead of the full set (a stale MDMS record). **Live check
  today:** the data endpoint (`cl_table_complaint_type_details`) returns **35
  sub-type rows** — the symptom is **not** reproduced at the data tier and appears
  reconciled. Before the demo, glance at the tile: it should show the full set. If it
  still shows ~12, that's a stale FE/MDMS cache — refresh/clear rather than debug on
  stage.
- **`BOMET_ADMIN` login.** Do not use it — password isn't `eGov@123` (login fails).
  Use `KE_ADMIN`.
- **Empty tiles.** Any tile with no rows shows an empty state (e.g. the map's
  empty overlay, #1031). If a whole tile is blank it usually means the ward×type
  filter combination has no complaints, or a materialized view needs a manual refresh.
- **Backend answers packs for no-access users.** If someone asks "is the API secured?"
  — be honest: the *visibility* gate is FE-side; the analytics API is a separate
  concern (tracked under the PGR Analytics V2 auth work). The CSR user can't reach the
  UI that would call it.

---

## 8. Reference — where each claim comes from

| Claim | Source |
|-------|--------|
| Role gate list | `digit-ui-esbuild/products/dashboard/roles.js` (`DASHBOARD_ROLES`) |
| Home card hide | `products/dashboard/DashboardCard.js:11` |
| Deep-link redirect | `products/dashboard/Module.js:15-16` |
| Tenant-agnostic check rationale | `roles.js` header comment |
| Catalog / pack / query API | `products/dashboard/src/services/analyticsService.js` (`/packs`, `/catalog/_search`, `/_query`) |
| Empty map overlay | `products/dashboard/src/components/GeographyChoroplethMap.jsx:758,849` |
| Global filters (ward/type/date) | `products/dashboard/src/config/globalFilterGroups.js` |
| Live login roles + packs | `/user/oauth/token`, `/user/_search`, `pgr-services/v2/analytics/packs` on bomet (2026-07-09) — see `verify-login-matrix.sh` |
| Deployed build has dashboard | `/opt/ccrs/digit-ui-esbuild/build` on bomet contains `DashboardModule` / `employee/dashboard` / `DASHBOARD_CARD_HEADER` |
