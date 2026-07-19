# 50 — SLA Semantics and Hierarchy Configuration

This doc describes the **post-#1028 / post-#1079 end-state shipped in this PR** — both land in
one migration:
`backend/pgr-services/src/main/resources/db/migration/main/V20260708000000__sla_and_hierarchy_grains.sql`
(+ the matching `AnalyticsCatalog`/`AnalyticsPlanner` changes).

## 1. SLA: the three sources and their precedence

`sla_target_ms` on the `complaint_facts` grain is the complaint's **overall resolution SLA
target**. Since the `V20260708…` migration *(this PR — fixes #1028)* it is a per-complaint
COALESCE over three sources, best first:

| # | source | meaning | resolution |
|---|---|---|---|
| 1 | **MDMS `RAINMAKER-PGR.ServiceDefs.slaHours`** | per-subtype resolution SLA, in hours (`slaHours × 3,600,000` → ms) | deduped by `serviceCode`, preferring the record at the shortest (root-most) tenant |
| 2 | **MDMS `RAINMAKER-PGR.EscalationConfig`** — SUM of `overrides.<serviceCode>` if present, else SUM of `defaultSlaByLevel` | the escalation ladder's *total*: these arrays are **per-assignment-level escalation timers in ms** (level 1 → level N), owned by the auto-escalation engine; their sum is used **only as a fallback** overall target | config record at the complaint's exact tenant, else its state root (`split_part(tenantid,'.',1)`), longest match first |
| 3 | **workflow `eg_wf_businessservice_v2.businessservicesla`** | the legacy single constant per business service — last resort | exact tenant preferred, **state-root fallback** (also fixed in this migration; previously an exact-tenant join, which is why every `ke.*` complaint had a NULL target: the PGR business service exists only at `ke`) |

Live shapes:

```jsonc
// ansible/nairobi-mdms/mdms/RAINMAKER-PGR/ServiceDefs.json (per subtype)
{ "serviceCode": "NoWaterSupply", "slaHours": 72, "department": "DEPT_01", ... }

// ansible/nairobi-mdms/mdms/RAINMAKER-PGR/EscalationConfig.json (one per state root)
{ "maxDepth": 3, "defaultSlaByLevel": [3600000, 14400000, 86400000], "overrides": {} }
```

**Operator rule of thumb**: give every ServiceDefs row a real `slaHours` — that is the intended,
operator-owned source. The ladder sum and workflow constant exist so the dashboard degrades
sanely instead of blanking, not as places to configure resolution SLAs.

### What derives from `sla_target_ms`

All in `complaint_facts` (same migration):

- `sla_breached` — open: `now - created_at > target`; resolved: `resolution > target`; `false`
  when no target could be resolved anywhere.
- `sla_status_bucket` — open complaints only: `breached` / `approaching` (>80% of target) /
  `within`; NULL when closed or no target.
- `sla_target_ms` itself is a measurable column (avg/percentile/sum) — the Complaint Type
  Details table's SLA column reads it (blank SLA cells were the visible symptom of #1028).
- `mdms_sla_hours` — the raw source-1 value, also measurable.
- `sla_config_mismatch` — flags subtypes where MDMS `slaHours` disagrees with the workflow
  constant (config-hygiene signal, semantics unchanged by #1028).

KPIs riding on these (live `ke` catalog, `ansible/nairobi-mdms/mdms/dss/KpiDefinition.json`):
`rs_breach_total`, `cl_sla_compliance_rate_count`, `cl_sla_noncompliance_rate_count`,
`cl_resolved_on_time_rate_count`, the open-by-SLA-stage charts (`sla_status_bucket` dimension),
and `cl_table_complaints_at_risk` (approaching/breached rows).

Distinct and *not* affected: `current_state_sla_breached` / `state_sla_ms` (per-workflow-state
dwell SLA from `eg_wf_state_v2.sla`) and `business_sla_ms` on the events grain (which now also
gets the state-root fallback, fix 3).

### Migration mechanics you must know

- Recreating `complaint_events` CASCADE-drops `complaint_facts`, so the migration reproduces
  both MVs in full. Flyway migrations are **append-only**: the grain definition now lives in
  `V20260708…` (superseding `V20260629…`, which superseded `V20260608…`). If you change the
  grain shape again, write a *new* migration reproducing the whole MV.
- `complaint_open_state_daily` is **not** rewritten: historical snapshots keep the
  `sla_breached`/`sla_status_bucket` values computed on their snapshot date; forward snapshots
  pick up the new definition automatically (the scheduler copies them from `complaint_facts`).
  Expect a step-change in backlog-breach trend charts at the migration date.

## 2. Hierarchies: one pattern, two axes

Both the jurisdiction (boundary) axis and the complaint-type axis follow the same design
(issue #1079; design notes: `docs/dashboard-rbac-design/80-multi-tier-complaint-types.md`):
a **materialized path column** carried losslessly on every grain row, plus a **level registry**
that names the depths — so nothing assumes a fixed tree depth.

| | boundary axis | complaint axis |
|---|---|---|
| path column | `boundary_path` | `complaint_node_path` *(this PR)* |
| path source | `boundary_relationship.ancestralmaterializedpath \|\| '\|' \|\| code` | `RAINMAKER-PGR.ComplaintHierarchy.path` verbatim (keyed by `code == serviceCode`), with a recursive `parentCode` walk as fallback |
| **delimiter** | `\|` (pipe), root-first | `.` (dot), root-first |
| depth column | `boundary_depth` | `complaint_depth` (segment count) *(this PR)* |
| level registry | `boundary_hierarchy` (level chain via `parentBoundaryType`) + per-node `boundary_relationship.boundarytype` | `RAINMAKER-PGR.ComplaintHierarchyDefinition.levels[]` (`levelCode`, `order`, `parentLevel`, `isLeafServiceCode`) + per-node `ComplaintHierarchy.levelCode` |
| named level columns | `ward_code`, `zone_code`, + new `boundary_leaf_code`/`boundary_leaf_type` | `service_group`, new `service_parent_code`; `service_code` is always the leaf |

### Registry-resolved named levels *(changed in this PR — #1079)*

Previously the named columns were extracted **by position** (`split_part(boundary_path,'|',2)`
= zone, `…,'|',3)` = ward — see the flagged lines in `V20260608000000`/`V20260629000000`), which
mislabels or NULLs on any tree that isn't exactly `root > zone > ward`; and the complaint axis
captured only leaf + immediate parent (`ServiceDefs.menuPath`). Now (per the `V20260708…`
migration):

- **`ward_code`** = the path segment whose `boundarytype` matches the tenant's *Ward* level
  (case-insensitive, from the `boundary_hierarchy` registry); **`zone_code`** = the segment at
  the level directly **above** ward (the ward level's `parentBoundaryType`). **Fallback** when
  the tenant's hierarchy defines no Ward level: `ward_code` = the leaf segment, `zone_code` =
  the parent of the leaf. `boundary_leaf_code` / `boundary_leaf_type` always carry the leaf node
  regardless of depth.
- **`service_group`** = the **root** category (first `complaint_node_path` segment), falling
  back to legacy `ServiceDefs.menuPath` where a code has no hierarchy node;
  **`service_parent_code`** = the leaf's immediate parent (identical to `service_group` on
  2-level taxonomies, so existing `service_group` consumers are unaffected there). Node dedupe
  prefers records at levels flagged `isLeafServiceCode` in `ComplaintHierarchyDefinition` —
  registry leaf detection, not the old department-IS-NOT-NULL heuristic. `ServiceDefs` is still
  joined for `mdms_sla_hours` / `service_order` / `department_code`.

KPI defs keep referencing `ward_code`/`service_group` unchanged; only their derivation became
depth-agnostic.

### Prefix scoping and rollup on path columns *(this PR)*

Path columns support a new **`starts_with`** filter operator, giving arbitrary-depth subtree
rollups on both axes — e.g. `{"boundary_path": {"starts_with": "BOMET|CENTRAL"}}` or
`{"complaint_node_path": {"starts_with": "WaterAndSanitation"}}` — the same mechanism the RBAC
boundary row-scope already uses internally (`boundary_path LIKE '<escaped prefix>%'`; LIKE
metacharacters are escaped so the value is a literal prefix). It is deliberately narrow: valid
**only** on the per-grain `prefixFilterable` allowlist in `AnalyticsCatalog` (facts/events:
`boundary_path` + `complaint_node_path`; daily: `boundary_path` only), and those path columns
accept **only** `starts_with` — any other operator on them, or `starts_with` on a normal column,
is rejected with `op_not_allowed` (`AnalyticsPlanner.predicate`).

### Configuring the hierarchies (operator view)

- **Boundary tree**: loaded per tenant via boundary-service (`boundary_hierarchy` +
  `boundary_relationship`); the dashboard consumes whatever depth exists. Complaints attach to a
  boundary via the address `locality`; rows whose locality has no relationship row get a NULL
  path (they show under no ward — check boundary seeding, see `40-filters-and-options.md` §4).
- **Complaint taxonomy**: `RAINMAKER-PGR.ComplaintHierarchyDefinition` declares the levels;
  `RAINMAKER-PGR.ComplaintHierarchy` holds the nodes with `code`, `parentCode`, `path`,
  `levelCode`, `name`. The grain trusts `ComplaintHierarchy.path` — keep it consistent when
  hand-editing nodes (the configurator maintains it; a broken `path` misfiles analytics for that
  subtype until the next refresh after the fix). Leaf detection uses
  `ComplaintHierarchyDefinition.isLeafServiceCode`, not the "has a department" heuristic
  *(this PR)*.
- 2-level tenants that still ship only `ServiceDefs` (`menuPath` as the single grouping) remain
  supported via the fallback derivation.
- After **any** MDMS hierarchy/SLA edit, the grains pick it up on the next MV refresh cycle
  (≤5 min by default) — the MDMS values are baked into the MVs at refresh time, not read live.
  See `60-operations.md`.

## 3. Extending the analytics catalog (developer)

To expose a new dimension/measure (full recipe: `backend/pgr-services/ANALYTICS-QUERY-API.md` §8):

1. Add the column in a **new** migration that reproduces the grain MV(s) (append-only rule
   above; remember the events→facts CASCADE).
2. Register it in the corresponding sets in
   `backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsCatalog.java`
   (`groupable` / `filterable` / `measurable` / `distinctable`; PII-adjacent columns: groupable +
   distinctable only, never filterable).
3. It is immediately queryable and self-describes via `/_schema` — no grammar change. A new
   *grain* is the same recipe plus a `grains.put(...)` entry (set its tenant/boundary/citizen/
   department scope columns, or constrained principals will get `scope_incomplete` on it).
