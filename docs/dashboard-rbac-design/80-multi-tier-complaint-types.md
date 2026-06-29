# Multi-Tier Complaint Types in the Analytics Grains (Part 80)

**Status:** v1 (pass-1, no adversarial review yet — see note at end), 2026-06-23.
**Answers** the third item appended to CCRS #631: *"Multi-tiered complaint types: maybe we should have an array or jsonb or something, or else use the config to create the MV."*
**Reads:** CCRS Discussion **#864** *(subhashini-egov — "[DRAFT|PROPOSAL] Configurable PGR Complaint-Type Hierarchy")* as the **authoritative** taxonomy design; `00-requirements.md` §4/§9-equiv; `30-row-scope-enforcement.md` (the `AttrScope` PREFIX machinery this part reuses); the grain migration `backend/pgr-services/src/main/resources/db/migration/main/V20260608000000__create_v2_grain_mvs.sql`.

> **Grounding rule (whole series):** every claim about current behaviour is anchored to a file:line / a cited discussion section. Where a thing is *missing*, it is stated as missing with the anchor showing the gap.

---

## 0. The question, answered up front

The note offers two implementation shapes — *(a) an array/jsonb column on the grain*, or *(b) drive the materialized view from config*. **The recommendation is (b), realized as a single materialized-path column `complaint_node_path` on every grain — the exact analogue of `boundary_path`.** It is not a new mechanism: jurisdiction already solved precisely this "scope/group at any depth of a jagged tree" problem with a delimiter-joined path, and the complaint taxonomy is the same problem on a different tree.

This is **not a third proposal competing with #864.** #864 already reserves the hook: it adds an optional `complaintNodePath` field to `services/_create/_search/_update` *"for analytics use"* (#864 §5). This part specifies what analytics does with it — i.e. how the grains and the query/scope layer consume the hierarchy that #864 produces. The array/jsonb-on-grain option is **rejected for the same reason #864 rejected a polymorphic JSON blob for leaf metadata: queryability** (#864 §3, "Rejected on queryability grounds").

---

## 1. Current state — the taxonomy is already flat, and the grain already half-models the 2-level case

Both the platform and the grains are flat-by-convention today, which (as #864 §1 notes) *reduces* the scope of this change rather than enlarging it.

**Platform (per #864 §1):**
- `eg_pgr_service_v2` stores complaints with `serviceCode` as a **flat string**; no `complaintType`/`subType` columns exist.
- `RAINMAKER-PGR.ServiceDefs` (MDMS) is a **flat row list**. The "type" tier is derived **in the UI** by grouping rows whose `menuPath` strings match (`digit-ui-esbuild/products/pgr/src/pages/citizen/Create/FormExplorer.js`). No `parentCode` is modeled.

**The grains already encode exactly that 2-level convention** (`V20260608000000__create_v2_grain_mvs.sql`):
- The facts MV joins `RAINMAKER-PGR.ServiceDefs` in the `mdms` CTE (L141–149), projecting `data->>'serviceCode' AS service_code` (L143, the **leaf**), `NULLIF(data->>'menuPath','') AS service_group` (L145 — **this is the "type" tier, today, as a single column**), and `data->>'department' AS department_code` (L147).
- `service_group` is folded into the facts select (L169) and `service_code` is indexed (`ix_cf_service`, L232).

So the grain *already* carries a degenerate two-level taxonomy: `service_group` (≈ category) + `service_code` (leaf). What it cannot do today is represent **3–4 levels**, **jagged depth**, or **group/scope at an arbitrary intermediate tier** — which is exactly what Maputo needs (#864 §2: Category → Subcategory → Service, 3 levels at go-live; up to 4 for near-future tenants).

**The dashboard gap.** Every existing tier-aware KPI (`complaints by type`, the category roll-ups in `kpiQueries.js`) is pinned to the single `service_group` column. None can express "group by subcategory within a category," "show me the Drainage subtree," or "this supervisor only sees the Sanitation branch" — there is no column to group or filter on below the top tier.

---

## 2. Why the materialized path, not an array/jsonb

| Option | Group-by at tier *k* | Scope/filter at tier *k* | Index | Verdict |
|---|---|---|---|---|
| **(a1) `int[]`/`text[]` ancestor array** | `node_path[k]` — works | `:code = ANY(node_path)` — works but **no prefix anchoring**; `WARD_3`-class sibling-leak risk; GIN index, not the b-tree the scope path already uses | rejected |
| **(a2) `jsonb` tree/object on each row** | needs `->>`/path expr per query; can't be a plain group key | `@>`/`jsonb_path` — opaque to the planner, no clean prefix predicate | rejected (queryability — #864 §3) |
| **(b) `complaint_node_path text` materialized path** (`CAT|SUBCAT|SVC`) | `split_part(complaint_node_path,'|',k)` — same idiom the grain already uses for `zone_code`/`ward_code` (SQL L83–84) | anchored, escaped **PREFIX** — **reuses Part C's `AttrScope` machinery verbatim** (`AnalyticsPlanner.java:247–249`, `ESCAPE '\'`) | **chosen** |

The deciding properties of (b):

1. **It is the boundary pattern, already proven in this codebase.** `boundary_path` is built once as `ancestralmaterializedpath || '|' || code` (SQL L21–25) and then both **grouped** (positional `split_part`, L83–84) and **scoped** (anchored `LIKE prefix%` with `ESCAPE '\'`, `AnalyticsPlanner.java:247–249`). `complaint_node_path` is the same string on the taxonomy tree. **No new query-planner concept, no new index type, no new scope predicate** — Part C's PREFIX `AttrScope` already does complaint-type subtree scoping the instant the column exists.
2. **Jagged depth is free.** A path is just as valid at length 2 (`CAT|SVC`) as at length 4 (`CAT|SUB|SUBSUB|SVC`). The leaf is always the last segment; depth is `1 + count('|')`. This matches #864's "jagged tree, any row with no children is a leaf" (#864 §4) with zero per-tenant schema variation in the grain.
3. **One column, group **and** scope.** The note's two asks (better grouping for multi-tier KPIs; the ability to *restrict* a department/branch owner to their subtree) are the **same column** — exactly as `boundary_path` serves both `group by ward` and "supervisor sees their subtree."
4. **Backward compatible.** Today's `service_group` is the **depth-2 special case** of the path (`service_group == split_part(complaint_node_path,'|',1)` when depth=2). Flat tenants (no `HierarchyConfig`, #864 §3) get `complaint_node_path = menuPath|serviceCode` (or just `serviceCode` if no menuPath) and every existing KPI keeps working unchanged.

The array options fail the *scope* column of the table: neither gives the anchored, escaped, b-tree-indexable prefix predicate that the sibling-leak-safe scope engine (`WARD_3` must not match `WARD_30`, 00-requirements §4) already depends on. Re-deriving that safety for an array is strictly more work than reusing the path machinery.

---

## 3. "Use the config to create the MV" — how the path is materialized

This is the note's option (b) made precise. The MV is **regenerated from the ServiceDefs hierarchy that #864 introduces**; the grain reads config, it does not hard-code depth.

**Inputs (all owned by #864, consumed here read-only):**
- `RAINMAKER-PGR.ServiceDefs` rows, now carrying optional `parentCode` + `level` (#864 §3). Existing rows that omit them are level-1 roots (#864 §3, default behavior).
- `RAINMAKER-PGR.HierarchyConfig` — per-tenant `depth` + level-name metadata (#864 §3). Absent ⇒ flat tenant.
- The complaint's `complaintNodePath` field on `services/_*`, reserved by #864 §5 *"for analytics use"* — the **authoritative** per-complaint path when the producing tenant has migrated.

**Materialization, two sources, preferring the authoritative one:**

```sql
-- replaces / extends the `mdms` CTE (currently L141–149). Recursive walk of ServiceDefs
-- via parentCode → a path per leaf serviceCode. Tenant-scoped; root-tenant fallback as today.
WITH RECURSIVE svc_tree AS (
  SELECT data->>'serviceCode' AS code,
         NULLIF(data->>'parentCode','')      AS parent_code,
         (data->>'serviceCode')              AS node_path,     -- root: path = own code
         1                                   AS depth
  FROM   <mdms ServiceDefs rows>
  WHERE  NULLIF(data->>'parentCode','') IS NULL
  UNION ALL
  SELECT c.code, c.parent_code,
         p.node_path || '|' || c.code,                         -- child appends to parent's path
         p.depth + 1
  FROM   <mdms ServiceDefs rows> c
  JOIN   svc_tree p ON p.code = c.parent_code
)
SELECT code AS service_code,
       node_path AS complaint_node_path,        -- e.g. 'SANITATION|DRAINAGE|BLOCKED_DRAIN'
       split_part(node_path,'|',1) AS service_group  -- depth-1 segment == today's menuPath tier (compat)
FROM   svc_tree;
```

Then in the facts/events selects (L159–169 region):

```sql
-- prefer the complaint's own recorded path (post-#864-migration producers), else derive from ServiceDefs:
COALESCE(s.complaint_node_path, m.complaint_node_path) AS complaint_node_path,
m.service_group,                       -- kept for back-compat; == split_part(complaint_node_path,'|',1)
s.servicecode AS service_code          -- unchanged leaf, still the workflow/SLA key (#864 §6)
```

**Design points:**
- **`complaint_node_path` is materialized at refresh, like every other grain column** — it inherits the existing `asOf`/freshness contract (00-requirements §6); no realtime tree-walk on the query path.
- **Two sources, COALESCE'd, authoritative wins.** A complaint persisted by a migrated producer carries its own `complaintNodePath` (frozen at create time — correct even if the taxonomy is later re-shaped); an un-migrated complaint's path is derived from the *current* ServiceDefs tree by `service_code`. This mirrors how the facts MV already LEFT-JOINs ServiceDefs by `service_code` (L227) — same join key, richer projection.
- **Depth is config, read from `HierarchyConfig`, never a constant in the SQL.** The recursive CTE terminates naturally at leaves; the depth-4 ceiling (#864 §4) is enforced by #864's `_validate`, so the grain never has to cap depth defensively.
- **`service_group` stays.** Deprecated-not-deleted (matches #864 §6's treatment of `menuPath`): it is now a derived alias of the first path segment, kept so no existing KPI or index (`ix_cf_service`) breaks.
- **New index:** `text_pattern_ops` b-tree on `complaint_node_path` (mirroring the boundary-path index requirement in 30-row-scope §"Index requirement") — required for the `LIKE 'prefix%'` scope predicate to use an index instead of seq-scanning the grain.

---

## 4. What this unlocks in the query / scope layer (no new plumbing)

Because `complaint_node_path` is structurally identical to `boundary_path`, the existing layers absorb it as **one more catalog column** and **one more `AttrScope` attribute**:

**Group-by at any tier (KPI defs, Part D).** A KPI def projects a derived dimension:
- `service_category   := split_part(complaint_node_path,'|',1)`
- `service_subcategory := split_part(complaint_node_path,'|',2)`
- … and groups/filters on it. These become **declared catalog dimensions** (`AnalyticsCatalog`), so "complaints by subcategory" is a config-only KPI def — no code, no app release (the whole point of Part D). A KPI can group at whatever tier its `groupBy` names; admin-added KPIs at new tiers need nothing in code.

**Subtree filtering (declared KPI param).** A `complaintTypeScope` declared param ANDs an anchored prefix under the caller's scope — the **narrow-only** rule of 00-requirements §4, identical to the existing `boundaryScope` param: an out-of-subtree selection yields **empty, not denied**.

**Branch-owner row scope (Part C `AttrScope`, optional / future).** If a tenant ever wants "the Drainage department head sees only the Drainage branch," that is a **new attribute in the same `attrScopes` list** — `complaint_node_path` PREFIX — added as *config*, not new plumbing (00-requirements §4: "adding a future attribute is config, not new plumbing"). v1 does **not** require this — department scope (Part C / 30-row-scope §10) already covers the common case via `department_code`; the taxonomy-branch scope is available for free if demand appears, anchored and escaped exactly like jurisdiction.

**The events grain.** The events grain today lacks `department_code` (00-requirements §7.4) and likewise has no `service_group`/path. If multi-tier grouping is wanted on the timeline/dwell grain, `complaint_node_path` must be added to the events MV select — **the same one-migration fix already scheduled for `department_code` on events** (30-row-scope §10). Bundle the two: one events-MV migration adds both `department_code` and `complaint_node_path`.

---

## 5. Interfaces with other parts & with #864

| Boundary | Contract |
|---|---|
| **← #864 (taxonomy)** | This part **consumes** `ServiceDefs.parentCode`/`level`, `HierarchyConfig.depth`, and the per-complaint `complaintNodePath` field (#864 §3, §5). It produces **nothing #864 must change** — it only adds projections to the grain MVs. If #864's `complaintNodePath` field name changes (its Open Q6 naming question is unsettled), this part's `COALESCE(s.<field>, …)` follows it; flag the dependency. |
| **→ Part C (row scope)** | `complaint_node_path` is a candidate `AttrScope` attribute with `matchType = PREFIX`, reusing `AnalyticsPlanner.java:247–249` verbatim. v1 ships it as a **group/filter dimension only**; branch-scope is a config add-on. |
| **→ Part D (KPI catalog)** | New derived dimensions (`service_category`, `service_subcategory`, …) registered in `AnalyticsCatalog`; multi-tier KPIs become MDMS `dss.KpiDefinition` records, no code. The `service_group`-pinned legacy KPIs keep working (compat alias). |
| **→ Refresh job** | `complaint_node_path` is materialized at MV refresh; like the other new grains it must be **wired into the refresh scheduler** (the standing build-note in `product-overview.md` §"Dependencies" — newer grains aren't auto-refreshing yet). |
| **MDMS resolution** | The recursive walk reads ServiceDefs with the **same tenant + root-fallback dedup** the `mdms` CTE already does (L141, "dedupe by serviceCode preferring the root (shortest) tenant"). Note the MDMS-v2 first-hit-not-merge caveat (40-kpi §D.1) applies to ServiceDefs reads too. |

---

## 6. Sequencing & migration steps

This part **gates on #864 landing** the additive ServiceDefs/HierarchyConfig schema (#864 §10 risk 1 — depends on the in-flight `utilities/mdms-v2-migration/` effort). Until then, the grain keeps `service_group` and this is design-only. Once #864 is in:

1. **MV migration (one file, additive).** Add the recursive `svc_tree` CTE and the `complaint_node_path` projection + `text_pattern_ops` index to the facts MV. `service_group` retained as a derived alias. No change to `eg_pgr_service_v2` (consistent with #864 §6 — the complaint table is untouched). Validated on ovh-cloud-dev (bomet repro) before live, per the standard CCRS develop → nightly path.
2. **Events-MV migration (bundle with department).** Add `complaint_node_path` **and** `department_code` to the events select in the same migration (30-row-scope §10 already schedules the dept column).
3. **Catalog dimensions.** Register `service_category`/`service_subcategory`/… (positional `split_part`) as groupable/filterable in `AnalyticsCatalog`; expose a `complaintTypeScope` declared param (narrow-only).
4. **Refresh wiring.** Ensure the (re)materialization runs in the refresh job so the column isn't stale (product-overview build-note).
5. **Backfill check (onboarding QA, not code).** For a migrated tenant, assert every live `service_code` resolves to a non-NULL `complaint_node_path` ending in that code — the taxonomy analogue of the ServiceDefs-coverage check Part B already owns (30-row-scope §C.5a). A `service_code` with no ServiceDefs row gets `NULL` path (LEFT JOIN, L227) — same fail-closed/coverage hazard as `department_code`, surfaced in onboarding QA.

---

## 7. Risks, edge cases, failure modes

- **NULL path = same LEFT-JOIN coverage hazard as department.** A complaint whose `service_code` has no (active) ServiceDefs row gets `complaint_node_path = NULL` (LEFT JOIN, L227); a tier group-by buckets it as NULL and a prefix scope excludes it (fail-closed). Acceptable, but a coverage gap to catch in onboarding QA, not a code change — identical treatment to 30-row-scope §C.5a.
- **Taxonomy re-shape vs. stored path.** If a tenant re-parents a node, the **derived** path for un-migrated complaints shifts (they re-bucket on next refresh); the **recorded** `complaintNodePath` on migrated complaints does not (frozen at create — usually what you want for historical reporting). This is the taxonomy analogue of 30-row-scope's "path-stability assumption" for boundaries — document it; the tree is near-static in practice.
- **Sibling-prefix leak.** `SANI` must not prefix-match `SANITATION`. Mitigated identically to jurisdiction: the path is `|`-delimited and the scope value is `…SANI|`-anchored + escaped (`ESCAPE '\'`). The grain owns the `|`-anchoring (it builds the path); Part C owns the escape. Same precondition contract as boundary.
- **Depth drift between `HierarchyConfig.depth` and actual rows.** The recursive CTE doesn't trust `depth`; it walks `parentCode` to the real leaf, so a stale `HierarchyConfig.depth` only affects level *labels* (UI), never the path. #864's `_validate` is the enforcement point for depth ≤ 4.
- **Field-name dependency on #864 Open Q6.** #864's per-complaint analytics field is named `complaintNodePath` *in the draft* but its naming (and the `HierarchyConfig` name) is explicitly unsettled (#864 §11 Q6). Treat the field name as a single point of coupling; the `COALESCE` follows whatever #864 ratifies.
- **Two UI codebases (out of scope here).** #864 §10 risk 4 (dual `digit-ui-esbuild` + `digit-ui-v2` picker rewrite) is a #864 concern; the dashboard's only UI touch is that tier dimensions become selectable group-bys in the viz-agnostic renderer (Part F), which is already data-driven.

---

## 8. Open questions for review

1. **Ship branch-scope (`complaint_node_path` as an `AttrScope`) in v1, or group/filter only?** Recommendation: **group/filter only** in v1 (department scope already covers the "owner sees their slice" case); keep branch-scope as the free config add-on. Confirm no near-term tenant needs taxonomy-branch *row* restriction at launch.
2. **Derive-from-ServiceDefs vs. require recorded `complaintNodePath`?** Recommendation: **COALESCE, authoritative-wins**, so the grain works for both migrated and un-migrated tenants and the dashboard doesn't block on every producer migrating. Confirm acceptable.
3. **Bundle the events-MV `complaint_node_path` column with the `department_code` events migration (one PR), or separate?** Recommendation: **bundle** — same file, same risk surface (30-row-scope §10).
4. **Track #864's naming resolution (Q6) before writing the migration** so the `COALESCE` field name is final, avoiding a rename churn on the grain.

---

> **Review status.** This is a **pass-1** design authored against #864 and the real grain migration. Unlike Parts A–F it has **not** yet had the adversarial code-grounded review pass (Claude + codex) the `rbac-deep-design` workflow runs. The load-bearing code anchors (grain MV L21–25, L141–149, L159–169, L227, L232; `AnalyticsPlanner.java:247–249`) were read directly; the #864 references are to the discussion body as posted. Recommended next: run the same dual-review pass before any migration PR, and post a short comment on #864 noting that analytics will consume `complaintNodePath` via a materialized `complaint_node_path` grain column (so #864's "for analytics use" reservation has a concrete consumer and the field name gets pinned).
