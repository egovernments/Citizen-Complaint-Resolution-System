# 80 — Live bomet State & the Catalog-Divergence Trap

A dated, reproducible snapshot of the **deployed** dashboard on the bomet reference install, taken
to verify the claims in docs 10–70 against reality. It also documents the single sharpest
operational trap on this platform: **the catalog the dashboard renders from, the `dss.*` records
in the mdms-v2 store, and the repo seed files can all disagree.**

> Probed **2026-07-09** against bomet Kong (`http://127.0.0.1:18000` on the host), employee token
> for `KE_ADMIN` @ `ke`. Read-only. Numbers will drift as the catalog is reconciled; the *shapes*
> and *mechanisms* are the durable content.

## 1. Reproduce the probe

```bash
K=http://127.0.0.1:18000
# 1) employee token (Basic = base64("egov-user-client:"))
AUTH=$(curl -s -X POST "$K/user/oauth/token" \
  -H 'Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'username=KE_ADMIN&password=eGov@123&tenantId=ke&userType=EMPLOYEE&scope=read&grant_type=password')
TOK=$(echo "$AUTH"  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
UI=$(echo "$AUTH"   | python3 -c 'import sys,json;print(json.dumps(json.load(sys.stdin)["UserRequest"]))')

# 2) anonymous packs → the PUBLIC floor
curl -s -X POST "$K/pgr-services/v2/analytics/packs" -H 'Content-Type: application/json' \
     -d '{"tenantId":"ke"}'

# 3) authenticated packs → the caller's best-match pack
curl -s -X POST "$K/pgr-services/v2/analytics/packs" -H 'Content-Type: application/json' \
     -d "{\"RequestInfo\":{\"apiId\":\"Rainmaker\",\"authToken\":\"$TOK\",\"userInfo\":$UI},\"tenantId\":\"ke\"}"

# 4) full role-filtered catalog (the add-KPI picker source)
curl -s -X POST "$K/pgr-services/v2/analytics/catalog/_search" -H 'Content-Type: application/json' \
     -d "{\"RequestInfo\":{\"apiId\":\"Rainmaker\",\"authToken\":\"$TOK\",\"userInfo\":$UI},\"tenantId\":\"ke\",\"filters\":{\"status\":\"published\"}}"
```

`KE_ADMIN`'s live role set (deduped) is a near-superset: **GRO, DGRO, PGR_LME, PGR_VIEWER, CSR,
CFC, SUPERUSER, EMPLOYEE** — note it carries `PGR_VIEWER` but **not** `SUPERVISOR`/`PGR_SUPERVISOR`.
That detail drives §3.

## 2. What the API actually serves (2026-07-09)

| probe | result |
|---|---|
| `/catalog/_search` (KE_ADMIN, published) | **37** tiles visible |
| `/packs` **anonymous** (PUBLIC floor) | **10** tiles |
| `/packs` **KE_ADMIN** | **15** tiles (the `executive-default` pack) |
| inline `/_query` **anonymous** | `kpi_forbidden` — *"public access is limited to published PUBLIC KPIs"* |
| `dss.DashboardPack` live | **2** packs (see §3) |

**The 10 PUBLIC tiles** (anon `/packs`): `cl_new_created_count`, `cl_resolution_rate_count`,
`cl_reopen_rate_count`, `cl_open_complaints_live`, `cl_resolved_date_range_count`,
`cl_chart_complaints_by_type`, `cl_chart_department_resolution_rate`,
`cl_chart_department_flow_ratio`, `cl_chart_over_time_created_daily`, `cl_map_ward_wow_current`.
These confirm the PUBLIC-floor design (`20-packs-and-rbac.md` layer 4): curated, aggregate-only,
no PII, no inline. The inline-anon `kpi_forbidden` confirms the inline lock.

> Correction to a common briefing figure: the catalog visible to KE_ADMIN is **37 published**,
> not "39". If you see a higher raw count, it includes unpublished/role-restricted records not
> served to this caller. Always trust `/catalog/_search` for "what this user can pick".

## 3. Two packs, first-match ordering — the PGR_VIEWER surprise

The repo seed (`ansible/nairobi-mdms/mdms/dss/DashboardPack.json`) ships **one** pack,
`supervisor-default`. **Live bomet has two**, in this MDMS record order:

| order | pack | roles | tiles |
|---|---|---|---|
| 1 | `executive-default` | `TICKET_REPORT_VIEWER`, `PGR_VIEWER` | 15 |
| 2 | `supervisor-default` | `SUPERVISOR`, `PGR_SUPERVISOR`, `GRO`, `DGRO`, `PGR_LME`, `PGR_ADMIN`, `SUPERUSER` | 11 |

`KpiCatalogService.getBestPack` returns the **first** pack whose `roles` overlap the caller
(`DashboardPack.matchesRoles`, `anyMatch`) — there is no specificity score. `KE_ADMIN` carries
`PGR_VIEWER`, which overlaps `executive-default` **first**, so KE_ADMIN's `/packs` returns the
**executive** 15-tile layout — even though KE_ADMIN also holds `SUPERUSER`/`GRO`/`DGRO`/`PGR_LME`
that would match `supervisor-default`. This is exactly the "order your packs most-specific-first"
rule from `20-packs-and-rbac.md` §1, observed in the wild:

- **A pure supervisor** (only `SUPERVISOR`/`PGR_SUPERVISOR`, no `PGR_VIEWER`) skips
  `executive-default` and lands on `supervisor-default` (11 tiles) — the intended supervisor view.
- **Any role carrying `PGR_VIEWER`** (KE_ADMIN, executives) gets `executive-default` first.

If you want supervisors-who-also-view to get the supervisor pack, either reorder the records
(supervisor-default first) or keep `PGR_VIEWER` off supervisor accounts. This is config, not code.

## 4. The catalog-divergence trap (THE #1026 sharp edge)

There are **three** representations of the KPI catalog, and they can all disagree:

1. **The repo seed** — `ansible/nairobi-mdms/mdms/dss/KpiDefinition.json` (authored source; the
   complaint-type table is a `data-table` with `PUBLIC` tags, etc.).
2. **The mdms-v2 store** — what `POST /mdms-v2/v2/_search {schemaCode:"dss.KpiDefinition"}` returns.
   On bomet today this returns only **10** records, **0** `PUBLIC`-tagged, and the `cl_table_*`
   tiles are `viz.kind = rankedList` with `query.limit` 200/30.
3. **The catalog pgr-services actually serves** — 37 published, 10 PUBLIC (§2).

Why (2) and (3) differ: **`KpiCatalogService` does not read the mdms-v2 schemaCode API.** It reads
via `config.getMdmsHost() + config.getMdmsEndPoint()` — the v1-compat MDMS `_search` at the state
root (`KpiCatalogService.fetchMaster`, JSON path `$.MdmsRes.dss.KpiDefinition`). The dashboard
renders from **(3)**. So a `dss.KpiDefinition` query against mdms-v2 is *not* a reliable picture of
what the dashboard shows — use `/catalog/_search` and `/packs` for that.

Why (1) and (3) differ (**the #1026 stale-record trap**): tenant seeding/`_create` lands **new**
`dss` records but does **not** `_update` records that already exist. So once a state root has a
`dss.KpiDefinition` catalog, editing the repo file and re-running deploy/bootstrap **does not**
overwrite the live records — they keep their old shape. On bomet this is visible as the
complaint-type / subtype tiles still being `rankedList` (old shape) rather than the `data-table`
the repo now specifies, and the live `viz.kind` enum having dropped `data-table` (schema drift).
Reconciling requires an explicit `_update` (or retire-and-recreate) per record — it is being done
separately.

**Operator rule:** to change a live KPI you must `_update` the live record. Editing the ansible
seed only affects *fresh* installs and repro boxes; it silently no-ops on an already-seeded root.
Keep the seed and the live records in sync by hand, or "works on bomet, wrong on the repro box"
(and its inverse) is the result. See `60-operations.md` §4.

## 5. The sidebar outage — a seeding bug (fixed 2026-07-09), not a dashboard-RBAC issue

For a while the employee **left sidebar was empty for every role** on bomet. Root cause was
unrelated to the dashboard, and — importantly — **not** the mdms image (an early RCA blamed a
JDK21 mdms-v2 "empty `IN ()`" regression; that was disproven by reverting the image and by a
corrected probe). The real cause: `egov-accesscontrol` reads `ACCESSCONTROL-ACTIONS.actions`, but
`tenant_bootstrap` had only seeded the 254 actions under the non-standard
`ACCESSCONTROL-ACTIONS-TEST.actions-test` — the "ACTIONS bridge" step (`digit-mcp` Step 3c) silently
failed on a schema-propagation race, leaving the standard module empty →
`/access/v1/actions/mdms/_get` → `PathNotFoundException` → **0 actions** → blank sidebar. Tracked in
**egovernments/CCRS#1106**.

**Fixed on bomet:** the 254 actions were bridged to `ACCESSCONTROL-ACTIONS.actions`, so the endpoint
now returns actions for every role and the Dashboard nav entry renders. Durable bootstrap fix (poll
for schema readiness before bridging): branch `fix/mcp-actions-bridge-schema-wait` (not merged yet →
a *fresh* box still needs the bridge). This never affected the dashboard's own RBAC
(packs/`visibleTo`/`DASHBOARD_ROLES` were always fine); the home card + deep link
(`70-esbuild-embedding.md` §3) remain valid alternate entry points. **Do not** "fix" a blank sidebar
by loosening dashboard roles/packs — check the ACCESSCONTROL actions seeding first.

## 6. Empty-tile / empty-view triage (refines `60-operations.md` §5)

Work outside-in; the first failing check is your answer.

1. **Whole view empty, "No tiles in the catalog pack for this role"** → the caller matched a pack
   with zero *visible* tiles, or no pack (all-visible, no layout). Check `/packs` for the caller
   and the pack `roles`/first-match order (§3).
2. **View opens but a specific tile says "No data"** → that KPI returned zero rows. Check (a) row
   scope: department-scoped user with no matching complaints (`20-packs-and-rbac.md` layer 1); (b)
   the live def's window/filters vs the data; (c) the tile is a live-open snapshot and there are no
   open complaints.
3. **Tile shows "No access" / "Restricted"** → `kpi_forbidden`/`pii_forbidden`: role fails the
   def's `visibleTo`, or (inline) projects a PII dimension. Fix `visibleTo` on the **live** record
   (not just the seed — §4), or use the curated def.
4. **A KPI looks like the wrong shape** (e.g. a table rendering as a ranked list) → §4 stale live
   record. Compare `/catalog/_search` `viz.kind` against the repo; `_update` the live record.
5. **Numbers are stale everywhere** → MV freshness. Check `_query`'s `asOf`
   (`60-operations.md` §2) and the refresh scheduler.
6. **Can't open the dashboard at all** → is it the **card** (needs `Dashboard` citymodule row +
   `enabledModules`), the **route** (deep link `/employee/dashboard` — always on), the **role**
   (`DASHBOARD_ROLES`), or the **sidebar** (§5, platform bug)? Distinguish before touching config —
   `70-esbuild-embedding.md` §3.
