# Enabling the dashboard on a running deployment

Start here if the dashboard is not visible on a deployment and you want it to be. This is the
standalone runbook for `local-setup/scripts/enable-dashboard.sh`: what must be true before you
start, how to run it, and what each failure means.

It assumes the stack is already up. It does **not** build images or deploy anything — it seeds
the configuration layers that make the dashboard appear and render, and verifies them.

Scope note: a **new city** under a state root that already has the dashboard needs nothing at
all — the catalog is read at the state root and cities inherit it. This runbook is for a
**state root**.

---

## 1. Prerequisites

Run the preflight first — it checks every item below and writes nothing:

```bash
DASHBOARD_TENANT=<root> ./local-setup/scripts/enable-dashboard.sh --only step0
```

| # | Requirement | How it is checked / fixed |
|---|---|---|
| 1 | A CCRS checkout with the seed files | Ships in-repo; set `REPO_ROOT=` if running from elsewhere |
| 2 | `jq`, `python3`, `curl` on PATH | `python3-jsonschema` is optional but recommended — without it the schema/data agreement check is skipped |
| 3 | Postgres reachable | `DB_CONTAINER` / `DB_USER` / `DB_NAME`. Every preflight fact is read from it; a wrong container silently reads as "0 holders, no corruption" |
| 4 | mdms-v2 on its **direct** port | `MDMS_URL` (default `:18094`). **Never seed through Kong** — its cjson layer turns `[]` into `{}` and corrupts array fields |
| 5 | localization service direct + redis | `LOCALIZATION_URL` (default `:18096`), `REDIS_CONTAINER`. The cache-bust endpoint is not reachable through Kong |
| 6 | pgr-services serving `/v2/analytics` | Preflight probes it. If it fails, confirm with `docker exec <pgr> sh -c 'unzip -l /opt/egov/*.jar \| grep -c analytics'` — zero means upgrade the image |
| 7 | The 4 `pgr_mv_*` materialized views | Created by pgr-services migrations; refreshed by `DashboardRefreshScheduler` every ~5 min |
| 8 | A working admin login at the root | `ADMIN_USER`/`ADMIN_PASS`. `SUPERADMIN` on a DDH-seeded box, `ADMIN` on an MCP-bootstrapped one — try both |
| 9 | The deployment's real employee role codes | Needed for `ROLE_MAP` (§3). Preflight lists holders per role |
| 10 | The sidebar action (`4557`) present in `ACCESSCONTROL-ACTIONS*` | Step 4 checks. If absent it must be seeded first — the script will not invent it |
| 11 | A UI bundle that embeds `products/dashboard/` | Not checked by the script. See §6 |

**Also know your box's reset path** before you seed. A nightly cron that resets the checkout, or a
re-converge, can undo work — moz's seeded catalog was wiped once and the cause was never found
(#1281). MDMS-backed state survives a redeploy; the *frontend* does not (`60-operations.md` §4).

---

## 2. Run it

```bash
# 1. read-only: reports everything, writes nothing
DASHBOARD_TENANT=<root> ./local-setup/scripts/enable-dashboard.sh --dry-run

# 2. the real run
DASHBOARD_TENANT=<root> ./local-setup/scripts/enable-dashboard.sh
```

Useful flags: `--only step5` / `--from step4` / `--to step3` to run part of it, `--repair` to
deactivate corrupt records first (§5), `--update` to overwrite records that already exist,
`--list` for the step names.

The seven steps:

| step | does | notes |
|---|---|---|
| 0 | Preflight | Read-only. Refuses to continue on anything it cannot fix |
| 1 | Register the 3 `dss.*` schemas | Skips any that exist — it will **not** replace a live schema |
| 2 | Seed 39 KPI defs + 1 pack | Roles remapped per `ROLE_MAP`. `--repair` runs first |
| 3 | Seed `dss.DashboardConfig` | Nav gate, number format, department scoping. Updated in place if present |
| 4 | Grant the sidebar action per role | Only to roles that pass the nav gate |
| 5 | Seed localization + cache-bust | 315 messages/locale + 2 nav labels, then redis DEL and the cache-bust endpoint |
| 6 | Flush the oauth token store | **Invalidates every session.** `SKIP_TOKEN_FLUSH=true` to skip — grants then stay invisible to existing sessions |
| 7 | Verify end-to-end | Catalog, packs, a live query, grants, and all-keys-resolve per locale |

Re-runs are safe. By default existing records are **not** overwritten — an edited seed file does
not reach a live tenant without `--update` (the #1026 stale-record no-op).

---

## 3. Roles — the one decision you have to make

The seed is authored against the canonical CCRS taxonomy: `PGR_SUPERVISOR`, `PGR_ADMIN`,
`PGR_LME`, `GRO`, `DGRO`, `SUPERVISOR`, `SUPERUSER`, `PGR_VIEWER`, `TICKET_REPORT_VIEWER`. That
is the default because it matches a stock install and the frontend's own fallback gate.

Most real deployments differ, and **the canonical set is partly aspirational** — `PGR_ADMIN` and
`PGR_SUPERVISOR` hold nobody even on the reference deployment. Remap to roles that exist:

```bash
ROLE_MAP="PGR_SUPERVISOR=CMS_SUPERVISOR,PGR_LME=CMS_CASE_MANAGER,PGR_ADMIN=SUPERUSER" \
DASHBOARD_ALLOWED_ROLES="SUPERVISOR,SUPERUSER,GRO,DGRO,CMS_SUPERVISOR" \
DASHBOARD_TENANT=<root> ./local-setup/scripts/enable-dashboard.sh
```

`ROLE_MAP` rewrites every `rbac.visibleTo` in the catalog, the pack personas, and the nav gate.
Never invent a role: a KPI visible only to a role nobody holds is invisible, and a sidebar link
for a role that fails the gate is a link that bounces.

Preflight enforces the part that actually matters:

- **error** — a KPI whose entire non-empty role ceiling is unheld (unreachable by anyone)
- **error** — no gate role has any holders (nobody can open the page)
- **warning** — an unused role that still leaves every KPI covered

Note the semantics, because they are easy to get backwards: an **empty** `visibleTo` means
visible to *all authenticated roles*, and `PUBLIC` is an *additive* marker for the anonymous
floor, not a ceiling (`KpiDefinition.isVisibleTo`). Ten `PUBLIC` tiles plus fifteen empty-ceiling
tiles is why the reference deployment serves anonymous 10 and admin 25.

If you are seeding ahead of an HRMS import, `ALLOW_EMPTY_ROLES=true` downgrades the error.

---

## 4. Data caveats that make a correct seed look broken

**Department scoping (#1280).** Employees are scoped to their HRMS department, and tenant-wide
roles are unrestricted *only when no department resolves*. Where complaint facts carry no
`department_code`, every scoped employee sees empty tiles. Preflight reports the ratio. The
temporary widening:

```bash
DEPARTMENT_SCOPING=disabled   # widens visibility for ALL employees on the tenant
```

It is one MDMS field, applies within ~5 min, needs no redeploy — and is a stopgap until
department enrichment lands.

**Locales.** Step 5 seeds every locale with a pack in `local-setup/db/dss-mdms-seed/l10n/`
(currently `en_IN`, `pt_PT`). Step 7 verifies against the locales the deployment *offers* in
`common-masters.StateInfo.languages`, which is the honest check — a locale a user can select but
that was never seeded renders raw `DASHBOARD_*` keys. A locale with no pack is reported as a
warning; author the pack in `digit-mcp/src/tools/dashboard-l10n-seed.ts` and re-run
`--only step5`.

The two nav labels are seeded in **English for every locale** — translate them afterwards.

**Empty data.** A dashboard on a tenant with a handful of complaints is correct and still looks
broken. Check `select count(*) from complaint_facts` before concluding something is wrong.

---

## 5. Known blockers and what they mean

| Symptom | Cause | Action |
|---|---|---|
| `schema-as-data rows detected` | A JSON Schema was POSTed to `/v2/_create/<schema>` instead of `/schema/v1/_create`. The row squats the uid a real record needs, so every later seed fails as a duplicate while the master looks populated | Re-run with `--repair` (deactivates them — mdms-v2 has no delete) |
| `N seed records violate the schema this script registers` | The schema files and the catalog data have drifted | Reconcile `local-setup/db/dss-mdms-seed/schemas/` against `ansible/nairobi-mdms/mdms/dss/`. Note step 1 logs *"already registered"* on a tenant that has an older schema, so this only bites the from-scratch path |
| `action id 4557 does not exist` | The dashboard's sidebar action was never seeded here | Seed it in `ACCESSCONTROL-ACTIONS.actions` **and** `ACCESSCONTROL-ACTIONS-TEST.actions-test` (the bridge, `30-view-access.md` §5), then `--only step4` |
| `ACCESSCONTROL-ROLES uses schema-derived (hashed) uniqueIdentifiers` | mdms-v2 resolves the roleactions `rolecode` x-ref against the referenced record's `uniqueIdentifier`. Where roles were seeded schema-driven, that uid is a hash of the code, so `rolecode:"GRO"` matches nothing and **every** grant is rejected — including pairs that already exist as rows | Not fixable from this script. Seed grants via the platform path (DDH/dataloader), or re-seed `ACCESSCONTROL-ROLES` with code-valued uids |
| `oauth token mint failed` | Wrong admin, or an encryption-key problem | Try `ADMIN` and `SUPERADMIN`. A `500 "Unknown error occurred in encryption process"` means the tenant has no row in `eg_enc_symmetric_keys` — a box-level problem, not a dashboard one |
| Tiles render but every value is empty | Department scoping (§4), or the MVs have not refreshed | `docker logs <pgr> \| grep DashboardRefreshScheduler` |
| Tile titles show as `DASHBOARD_*` | Localization not seeded, or not cache-busted | `--only step5`. Browsers also cache `Digit.Locale.*` in localStorage (~24 h) |

---

## 6. What the script cannot do

- **Rebuild the frontend.** The nav/route gate reads `dss.DashboardConfig.allowedRoles` only from
  a build that includes #1258; older bundles use a hardcoded role list and ignore the record
  entirely. If your deployment's roles are not in that list, seeding is not enough — the bundle
  has to be rebuilt.
- **Seed the `ACCESSCONTROL` action masters**, for the reasons in §5.
- **Fix department enrichment** (#1280) — it can only widen scoping as a stopgap.
- **Survive a frontend redeploy** for anything bundle-side. MDMS state does survive.

---

## 7. Verifying by hand

Step 7 does all of this; these are the same calls if you want them individually.

```bash
H=http://<host>; ROOT=<root>; TOKEN=<employee token>

# catalog — principal-scoped: anonymous sees the PUBLIC floor, a token sees more
curl -s -X POST $H/pgr-services/v2/analytics/catalog/_search -H 'Content-Type: application/json' \
  -d "{\"RequestInfo\":{\"authToken\":\"$TOKEN\"},\"tenantId\":\"$ROOT\"}"

# tiles for this principal's role
curl -s -X POST $H/pgr-services/v2/analytics/packs -H 'Content-Type: application/json' \
  -d "{\"RequestInfo\":{\"authToken\":\"$TOKEN\"},\"tenantId\":\"$ROOT\"}"

# one real query — check the returned "scope", it explains empty tiles
curl -s -X POST $H/pgr-services/v2/analytics/_query -H 'Content-Type: application/json' \
  -d "{\"RequestInfo\":{\"authToken\":\"$TOKEN\"},\"tenantId\":\"$ROOT\",\"query\":{\"kpiId\":\"cl_new_created_count\"}}"
```

`_query` takes a `query` **object** or a `queries` dict — an array is an `invalid_param`.

Then in a browser: log in as a user holding a gate role → home card and sidebar entry are
labelled → `/employee/dashboard` loads with tiles matching the token's scope.

Reference numbers from the fully-enabled deployment, for comparison: 39 active defs, catalog
anonymous 10 / admin 25, 25 tiles, 316 messages per locale across three locales.

---

## Related

- `local-setup/db/dss-mdms-seed/README.md` — the seed files, and how to regenerate the l10n packs
- `60-operations.md` — tenant-bootstrap coverage, MV refresh, what a redeploy wipes
- `30-view-access.md` — how the sidebar, card and actions bridge actually resolve
- `90-localization.md` — the key families and the add-a-language cookbook
- `20-packs-and-rbac.md` — the four RBAC layers in full
