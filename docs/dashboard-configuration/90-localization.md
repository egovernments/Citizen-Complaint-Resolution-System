# 90 — Localizing the dashboard

Every string the dashboard renders resolves against the egov-localization service at runtime.
There are **no code-owned fallbacks**: when a message is missing for the active locale, the raw
localization key (or raw dimension code) renders on screen. That is deliberate — a visible
`DASHBOARD_HEADER_EXPORT` or `ServiceSchedulingComplaints` is a seeding gap to fix with an
`_upsert`, never with a code change. (The inline English second argument you see in
`t("KEY", "English")` calls in the source is *never rendered*; it exists only as the extraction
source for the generated seed pack — see §5.)

Audience note: everything in this doc is **tenant data** seeded through
`/localization/messages/v1/_upsert`. No rebuild, no deploy.

## 1. What the module loads

On mount, `products/dashboard/Module.js` lazy-loads three localization bundles for the active
locale at the **state root** tenant (same pattern as PGRModule):

| bundle (`module` param) | carries |
|---|---|
| `rainmaker-dashboard` | all dashboard-owned keys (§2–§4) |
| `rainmaker-pgr` | complaint-type names (`COMPLAINT_HIERARCHY.*`, legacy `SERVICEDEFS.*`), PGR workflow-status keys |
| `rainmaker-boundary-<hierarchyType>` | ward/boundary names (bare boundary code as key; hierarchyType from `globalConfigs.HIERARCHY_TYPE`, lower-cased — default `boundary-admin`) |

`rainmaker-common` (departments, tenant names) and `digit-ui` are already loaded by the DigitUI
shell at boot. The TopBar language dropdown (host `ChangeLanguage`) drives locale switches; the
dashboard re-renders in place, including the imperatively-drawn Leaflet layers and pin popups
(re-keyed on `i18n.language`).

Two resolution seams in `products/dashboard/src/i18n/`:

- `translate(key, seedEnglish)` / `useDashboardT()` — chrome strings; missing ⇒ raw key.
- `dimensionLabel(code, kind, fallbackText?)` — data values; per-kind key candidates (below);
  missing ⇒ raw code. `fallbackText` is legal **only** for data-owned names (boundary-service
  `localname`, MDMS ComplaintHierarchy display names) — never hardcoded English.

## 2. Dashboard-owned keys (module `rainmaker-dashboard`)

Seed all of these per locale. The authoritative en_IN set is the generated pack
`digit-mcp/src/tools/dashboard-l10n-seed.ts` (277 messages) — grep it rather than trusting this
table to stay exhaustive.

| family | pattern | examples | source of the key |
|---|---|---|---|
| chrome | `DASHBOARD_<AREA>_<NAME>` (AREAS: HEADER, FILTERS, SIDEBAR, LOGIN, MAP, TILE, TABLE, COMMON, COL, UNIT, DOW, BADGE, PERIOD, KPI_DISPLAY) | `DASHBOARD_HEADER_EXPORT`, `DASHBOARD_MAP_LEGEND_TITLE`, `DASHBOARD_COMMON_NO_DATA` | `t("KEY", "…")` literals in `products/dashboard/` |
| KPI titles | `CMS-DASHBOARD.DASHBOARD_KPI_<ID_UPPER>` | `CMS-DASHBOARD.DASHBOARD_KPI_CL_NEW_CREATED_COUNT` | `viz.titleKey` on every `dss.KpiDefinition` |
| KPI subtitles | `…DASHBOARD_KPI_<ID_UPPER>_SUBTITLE` | `…CL_REOPEN_RATE_COUNT_SUBTITLE` = "Reopened ÷ resolved" | `viz.subtitleKey` |
| chart series | `DASHBOARD_WF_STAGE_<STATUS>`, `DASHBOARD_CHANNEL_<ID>`, `DASHBOARD_SLA_<STATE>` | `DASHBOARD_WF_STAGE_PENDINGATLME` = "Assigned", `DASHBOARD_CHANNEL_WALK_IN`, `DASHBOARD_SLA_APPROACHING` | `labelKey` on `stackSeries`/`channelMap` entries in the defs; also used directly by the `workflowStatus`/`channel`/`slaState` dimension kinds |
| table columns | `DASHBOARD_COL_<LABEL_UPPER_SNAKE>` | `DASHBOARD_COL_AVG_RESOLUTION_TIME` | `labelKey` on column descriptors in the defs + FE-built columns (at-risk table) |
| geo drill tiers | `DASHBOARD_GEO_LEVEL_0..3` | ke: County / Sub-county / Ward / Complaints | **tenant vocabulary** — the pack ships generic words (District/Subdistrict/Locality/Complaints); override per deployment |
| age buckets | `DASHBOARD_AGE_<BUCKET_ID>` | — | `ageBucket` dimension kind; seed when an age-bucketed KPI is published |

Adding a KPI (see [10-kpi-catalog.md](10-kpi-catalog.md) §cookbook) now has a localization step:
give the def a `titleKey`/`subtitleKey`/per-series `labelKey` following the patterns above, and
upsert the messages for every locale in the tenant's `StateInfo.languages` — otherwise the tile
header renders the raw key.

## 3. Data-dimension keys (owned by other modules / the configurator)

The dashboard reuses the platform's existing conventions — do **not** mint dashboard-specific
keys for these. `dimensionLabel` tries, in order:

| kind | key candidates | module | who seeds it |
|---|---|---|---|
| `complaintType` | `COMPLAINT_HIERARCHY.<code>`, `COMPLAINT_HIERARCHY.<CODE>`, legacy `SERVICEDEFS.<CODE>` | `rainmaker-pgr` | configurator complaint-type create (per StateInfo locale) |
| `boundary` | bare `<code>` (e.g. `BOMET_BOMET_CENTRAL_CHESOEN`), transformed variant | `rainmaker-boundary-<hier>` | configurator boundary phase (#852/#1002 conventions) |
| `department` | `COMMON_MASTERS_DEPARTMENT_<CODE>`, `DEPARTMENT_<CODE>` | `rainmaker-common` | configurator department create |
| `workflowStatus` | `DASHBOARD_WF_STAGE_<STATUS>`, then platform `CS_COMMON_<STATUS>` / `WF_PGR_<STATUS>` | dashboard pack / `rainmaker-pgr` | pack + PGR seeds |
| `channel` / `slaState` / `ageBucket` | `DASHBOARD_*` (§2) | `rainmaker-dashboard` | pack |

MDMS display names still render where they are the content: ComplaintHierarchy `name` (when it
differs from the code) and boundary-service `localname` act as fallback text. A raw code on
screen therefore means *neither* a localization message *nor* an operator-authored name exists.

## 4. Gap triage — "I see a raw key/code on the dashboard"

| what renders | missing message | fix |
|---|---|---|
| `DASHBOARD_…` key | that key, module `rainmaker-dashboard`, active locale, state root | upsert it (locale gap ⇒ the whole pack for that locale is probably missing) |
| `CMS-DASHBOARD.DASHBOARD_KPI_…` | title/subtitle for a def | upsert; if it's a new KPI, the def's author skipped the localization step (§2) |
| a complaint-type code (`ServiceSchedulingComplaints`) | `COMPLAINT_HIERARCHY.<code>` in `rainmaker-pgr` | upsert — known gap for **legacy** type-level codes created before the `COMPLAINT_HIERARCHY` namespace (bomet `ke` has these) |
| a department code (`WATER_ENV`) | `COMMON_MASTERS_DEPARTMENT_<CODE>` in `rainmaker-common` | upsert — known gap on bomet `ke` |
| a boundary code | bare code in `rainmaker-boundary-<hier>` | re-run the configurator boundary localization / upsert (per locale) |
| `DASHBOARD_GEO_LEVEL_<n>` | tier word for the tenant | upsert the deployment's vocabulary (ke: County/Sub-county/Ward) |

After any upsert, walk the **three cache layers** (details in [30-view-access.md](30-view-access.md)):
service in-app cache — `POST /localization/messages/cache-bust` (on bomet this path is **not
routed through Kong**; hit the service's host port `:18096` directly); redis `messages` hash;
browser `localStorage` `Digit.Locale.*` bundles (24 h TTL — clear or wait).

## 5. The en_IN pack and how to regenerate it

`digit-mcp/src/tools/dashboard-l10n-seed.ts` (GENERATED — do not hand-edit) is merged into
`tenant_bootstrap` Step 6 as a **floor**: live-tenant copies win; fresh state roots get the pack
so a from-scratch install never renders raw `DASHBOARD_*` keys. Every entry is either a two-arg
`t("KEY", "English")` / `translate("KEY", "English")` literal in `products/dashboard/`, a
`titleKey`/`subtitleKey`/`labelKey` ↔ `title`/`subtitle`/`label` pair in
`ansible/nairobi-mdms/mdms/dss/KpiDefinition.json`, or a seam-implied `dimensionLabel` key.

When you change copy or add keys: update the inline English (it is the single canonical source),
re-run the extraction script from the dashboard-l10n workstream (scans literals + KpiDefinition,
fails on same-key/different-English conflicts), commit the regenerated pack, and upsert the delta
to live tenants.

## 6. Adding a language end-to-end

1. Add `{ "label": "…", "value": "<locale>" }` to the state root's `common-masters.StateInfo`
   `languages` (configurator StateInfo editor or MDMS update). This alone makes the language
   appear in the TopBar dropdown — with every message missing, i.e. raw keys everywhere.
2. Seed, for that locale: the `rainmaker-dashboard` pack (§2), plus the §3 families the tenant
   uses (complaint types, boundaries, departments — the configurator seeds these per StateInfo
   locale for *newly created* entities; pre-existing entities need a backfill).
3. Translation tooling: there is no automated EN→X pipeline in-repo except the Nai Pepea
   `translate.py` (extract → Google Translate with cache → batched `_upsert`), which is
   re-parameterizable (`SRC_LOCALE`/`DST_LOCALE`/`TENANT`/`MODULES`). Hand-review machine output
   for workflow/SLA terms.
4. Cache-bust (§4) and verify with an independent
   `POST /localization/messages/v1/_search?module=rainmaker-dashboard&locale=<locale>&tenantId=<root>`.

Locale-code hygiene: use region-correct codes (`sw_KE`, `pt_MZ`). Known inconsistencies to avoid
copying: the workbench editor hardcodes `pt_IN` and the configurator's own UI list has `pt_BR` —
the tenant's `StateInfo.languages` value is the only code that matters at runtime.

## 7. Numbers and dates

`toLocaleString`/`toLocaleDateString` call sites pass the active locale (`en_IN` → `en-IN`), so
number/date shapes follow the language switch automatically — no messages to seed.
