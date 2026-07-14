# PGR Inbox Visibility — Design (V1, forward-compatible with V2/V3)

Source PRD: CMS_Escalation_PRD → "visibility v1" tab.
Targets: `backend/pgr-services` and `digit-ui-esbuild/products/pgr`.

**Key decisions (locked):**
- Visibility is driven by **two orthogonal hierarchy axes read from HRMS**: the `reportingTo`
  person-chain (*whose* queue) **and** jurisdiction/boundary (*where*).
- **Hierarchy resolution lives in the backend.** pgr-services reads the HRMS tree +
  jurisdictions and computes the visible set server-side; the frontend just asks for a tab.

---

## 1. Problem

Supervisors and agents need a two-tab inbox — **My Complaints** and **All Complaints** — where
each tab's contents depend on the user's role, their position in the `reportingTo` hierarchy,
and their jurisdiction. Today the inbox has no tabs, visibility is a per-user `assignedToMe`
radio in the filter card (`configs/PGRSearchInboxConfig.js:180`), and **the backend reads none
of the reporting hierarchy at inbox time** (see §2.1). V1 replaces the radio with role-driven
tabs backed by a server-side hierarchy resolver; V2/V3 layer on user-level claim and escalation.

## 2. What the hierarchy encodes vs. what the backend reads

### 2.1 The gap
HRMS carries a rich hierarchy on each employee's **current assignment**:

| Signal | Meaning | Used by inbox today? |
|---|---|---|
| `reportingTo` | supervisor UUID → a multi-level person chain (e.g. `044f9bfc → b72ff021 → 0a086610 → …`) | **No** (only escalation, one hop up) |
| `jurisdictions` | boundary codes the employee is scoped to | **No** |
| `isHOD` | head-of-department flag | No |
| `department` / `designation` | org unit + rank code | department only, in escalation |

`pgr-services` reads just `getSupervisorUuid` (one hop **upward**, one UUID at a time —
`HRMSUtil.java:73`) and `getDepartment` (`HRMSUtil.java:44`), **only in the escalation path**.
The **downward** reportee tree and the jurisdiction boundaries are ignored by search.

### 2.2 The two axes we will read
| Axis | Question | HRMS source | How it maps to a PGR filter |
|---|---|---|---|
| **Queue (who)** | whose work is this? | `reportingTo` chain + `user.roles` + workflow `Action.roles` | `applicationStatus IN statesFor(roles)` (existing filter) and, in V2+, `assignee` (new) |
| **Jurisdiction (where)** | is it in my area? | employee `jurisdictions` → boundary codes → leaf localities | `locality IN (...)` (existing filter), after expanding the jurisdiction subtree via boundary-service |

The two axes are **orthogonal and AND together**: you see the complaints in the relevant work
queue *that also fall inside your jurisdiction*. (Combine-semantics flagged in §8.1.)

## 3. Version → predicate matrix

Notation:
- `myRoles` — the user's PGR roles (`RequestInfo.userInfo.roles`).
- `statesFor(roles)` — states whose queue those roles own: `{ S in PGR BusinessService : ∃ a ∈ S.actions, a.roles ∩ roles ≠ ∅ }`. Read from the workflow BusinessService.
- `reporteeRoles(N)` — union of roles held by employees transitively under me in the `reportingTo` tree, depth `N` (default 1).
- `myLocalities` — leaf localities under the acting employee's HRMS jurisdiction boundaries.
- `me` — my user UUID. `assignee(c)` — current workflow assignee(s), `∅` = unassigned.
- `hasReportees` — user has ≥1 direct reportee.
- **Every predicate below is additionally `AND locality ∈ myLocalities`** (the jurisdiction axis).

### V1 — queue axis = role/state only
| | My Complaints | All Complaints |
|---|---|---|
| no reportees | `status ∈ statesFor(myRoles)` | `status ∈ statesFor(myRoles)` |
| has reportees | `status ∈ statesFor(myRoles)` | `status ∈ statesFor(reporteeRoles(N))` |

### V2 — queue axis adds assignee
| | My Complaints | All Complaints |
|---|---|---|
| no reportees | `assignee = me` | `status ∈ statesFor(myRoles) ∧ (assignee = me ∨ assignee = ∅)` |
| has reportees | `assignee = me` | above **∪** `status ∈ statesFor(reporteeRoles(N))` |

### V3 — adds escalation trail
Same as V2, plus each **All** bucket unions `escalatedFrom ∋ me ∧ assignee ≠ me`.

**Backend capability per predicate:** `status ∈ set` → existing `applicationStatus IN`;
`locality ∈ set` → existing `locality IN` (+ boundary-subtree expansion); `assignee = me | ∅`
→ **new** denormalized column (V2, §4.4); `escalatedFrom ∋ me` → **new** persisted trail (V3, §4.5).

## 4. Backend design (`pgr-services`)

The visibility *logic* moves into pgr-services. `_search`/`_count` stay generic filters; a new
resolver composes criteria from HRMS + workflow + RequestInfo and calls them.

### 4.1 New endpoint: visibility-aware inbox
`POST /v2/request/inbox/_search` and `.../inbox/_count`. Request body carries `RequestInfo` +
a small `InboxCriteria { tenantId, tab: "MY"|"ALL", limit, offset, sortBy, sortOrder, + optional
user filters (serviceCode, status subset, locality subset, date range) }`. Returns the existing
`ServiceWrapper` response so the FE table/columns are unchanged. Keeping this separate from the
generic `_search` leaves the pure filter intact and gives counts a natural home.

### 4.2 Hierarchy resolver (the core new component)
`VisibilityService.resolve(requestInfo, tab, version) → RequestSearchCriteria`:
1. **Self**: one HRMS `_search?uuids=<me>` → my `jurisdictions`, `department`, confirm roles.
2. **Queue axis**:
   - `statesFor(myRoles)` from the PGR workflow BusinessService — `WorkflowService.getBusinessService`
     already exists (used only at transition today); reuse it at search time and cache.
   - If `tab == ALL` and `hasReportees`: resolve `reporteeRoles(N)` from the reportee tree (§4.3),
     use `statesFor(reporteeRoles)`.
3. **Jurisdiction axis**: expand my `jurisdictions` boundary codes to their leaf localities via
   boundary-service (`/boundary/…/_search` subtree), → `criteria.locality`.
4. Compose `RequestSearchCriteria { tenantId, applicationStatus = statesFor(...), locality = myLocalities, (V2+) assignee }`
   and hand to the existing `PGRService.search`/`count`.

### 4.3 Materialized HRMS projection (the cheap data structure)
The hierarchy is **slow-changing but read on every inbox load**, and the downward reportee walk is
the only expensive part of resolution (queue-states come from a small cacheable BusinessService;
jurisdiction maps to `locality`, already on the complaint). So we **stop calling HRMS live** and
read from a local projection — inbox resolution makes zero live HRMS calls.

**Table** `eg_pgr_hrms_projection` (pgr-services DB): one row per employee, everything the resolver
needs.
```
uuid pk, tenantid, reporting_to, roles text[], jurisdictions text[],
department, is_hod boolean, updated_at bigint
index on (tenantid, reporting_to)   -- children-by-manager lookup
```

**Downward subtree query** — store only the edge (`reporting_to`, an adjacency list) and resolve
the subtree with a recursive CTE capped at `reporteeDepth`:
```sql
WITH RECURSIVE tree(uuid, depth) AS (
  SELECT uuid, 1 FROM eg_pgr_hrms_projection WHERE reporting_to = :me AND tenantid = :t
  UNION ALL
  SELECT c.uuid, tree.depth+1 FROM eg_pgr_hrms_projection c
  JOIN tree ON c.reporting_to = tree.uuid WHERE tree.depth < :N)
SELECT uuid FROM tree;
```
Org trees are small, so this is fast and only ever upserts one edge on change. Upgrade to a closure
table `(ancestor, descendant, depth)` only if profiling demands zero-recursion reads — don't start there.

**Sync**: a Kafka consumer on the HRMS employee create/update topics (`save-hrms-employee` / update)
upserts the projection row — same pattern as the existing persister/escalation-scheduler. Add a
**nightly full rebuild** as a backstop (the escalation scheduler already sweeps all tenants). Org
changes reflect on the next inbox load with **no complaint re-stamping**.

**Reuse**: escalation reads `reporting_to` from the projection instead of its per-hop live
`getSupervisorUuid` call — one source of truth, upward and downward.

**Rejected alternative** — stamping the audience (assignee + manager chain) onto each complaint at
assignment time gives the cheapest read (`WHERE :me = ANY(visible_to)`) but goes **stale on any
reorg** (a newly-promoted supervisor won't see existing complaints until every row is re-stamped).
The projection reflects org changes immediately and keeps complaints clean.

**Follow-up (still worth it):** add a `reportingTo` filter to egov-hrms `_search` so the *projection
rebuild* is one query per level instead of a filtered sweep; the live inbox path no longer depends on it.

### 4.4 V2 — denormalize current assignee
Add nullable `assignee` column to `eg_pgr_service_v2`, populated from the workflow response
`assignes` in the same spot `applicationStatus` is mirrored (`WorkflowService.updateWorkflowStatus`,
`WorkflowService.java:66-73`); migration backfills from workflow process-search. Add
`Set<String> assignee` + `unassigned` to `RequestSearchCriteria`, `ser.assignee IN (...)` /
`IS NULL` to `PGRQueryBuilder`, allow the param in `ServiceRequestValidator`. Chosen over
pre-querying workflow because it expresses "unassigned" and paginates in one SQL pass.

### 4.5 V3 — persist escalation trail
`EscalationService.escalateComplaint` already tracks `escalationLevel` + resolves the supervisor.
Extend it to append the previous assignee to a trail (`additionalDetails.escalationTrail` or a
denormalized `escalated_from` column for indexable queries). V3's extra bucket is then
`escalated_from ∋ me AND assignee ≠ me`.

## 5. Frontend design (`digit-ui-esbuild/products/pgr`) — now thin

Because the backend owns resolution, the frontend only manages tabs, counts, and filter reset.

- **Tabs**: render the reusable `Tab` atom (`@egovernments/digit-ui-components`) in the `<header>`
  slot of `PGRInbox.js` (line 165), above `<InboxSearchComposer/>` (the composer's built-in tabs
  aren't wired for `type:"inbox"`). `const [activeTab, setActiveTab] = useState("MY")`.
- **Data**: `usePGRInboxSearch` points at the new `/inbox/_search` + `/inbox/_count` and sends
  `{ tab: activeTab, tenantId, limit, offset, sort, + user filters }`. **No hierarchy logic on the
  client.** Build the config in a `useMemo` keyed on `activeTab` so react-query re-keys and
  refetches (mind the `[configs]`-stability caveat, `PGRInbox.js:143-157`).
- **Filter reset on switch**: `key={activeTab}` on `<InboxSearchComposer/>` remounts it → forms
  reset to defaults (satisfies the PRD). Remove the `assignedToMe` radio from
  `PGRSearchInboxConfig.js`.
- **Counts + red dot** — see §5.5 for the model. FE renders the returned number + a small custom
  red-dot `<span>` (`showTabCount` gives inline `(N)` but not the dot).

### 5.5 Tab counts — high-water-mark cursor model (chosen)

Both badges use a **single per-(user, tab) cursor** (`lastSeenAt`), the chat/channel unread pattern —
not per-item read flags. Badge = the resolver's visibility filter **`+ (arrivalTime > lastSeenAt)`**,
computed by `/inbox/_count`. It's one extra indexed predicate on the query we already run; PGR stays
pull-based (its views are dynamic/derived, so precomputed per-user counters aren't viable).

- **`arrivalTime`** = the complaint's **current-state entry time** (when it last transitioned into the
  state that placed it in the queue), so re-routed / escalated / transitioned complaints count — not
  just newly-created ones. `createdTime` is the wrong signal (arrival ≠ creation).
- **Cursor** is stored **server-side** per (user, tab), so it's consistent across devices and survives
  a cache clear. Reset to `now` when the tab is opened.
- **Semantic note:** with a cursor and no seen-set, **"My = unopened" is realized as "new in My since
  last opened"** (a redefinition of the PRD's literal "unopened" — accepted tradeoff; matches how
  channel badges work).

- **Step 1 (interim):** `localStorage` cursor + `_count` filtered on `createdTime` (the only date field
  the current criteria supports). Ships the UX; counts *created-since*, misses re-routed items.
- **Step 2 (real):** durable server-side `(user, tab) → lastSeenAt` store + an `arrivalTime`
  (state-entry) predicate on the search criteria. Additive to the resolver — no notification service.

## 6. Configuration (MDMS) — feature-flagged, versions are config-flippable

`RAINMAKER-PGR.InboxVisibilityConfig` (state-level; schema seeded via DDH
`schema/RAINMAKER-PGR.json`), read by the FE (Step 1) and by `VisibilityService` (Step 2):
```json
{
  "code": "INBOX_VISIBILITY",
  "enabled": true,
  "version": "v1",
  "reporteeDepth": 1,
  "jurisdictionScoped": true
}
```
Moving a tenant V1→V2→V3 is a `version` bump + the matching backend capability being deployed —
no frontend fork (consistent with MDMS-over-code / holistic fixes).

### 6.1 Feature flag — off = the legacy inbox, everywhere

One flag, `InboxVisibilityConfig.enabled`, gates the whole feature per tenant. **Default is OFF:
an absent record, a fetch error, or `enabled: false` all behave identically** — the inbox renders
and queries exactly as it did before Visibility V1. Rollout and rollback are pure MDMS flips
(no redeploy on either side).

**FE (`useInboxVisibility`, shipped with Step 1):**
| | flag ON | flag OFF / absent |
|---|---|---|
| Tabs | My/All strip above the complaint list, cursor badges | not rendered |
| Filter card | no radio; status filter intersects the My queue | legacy `assignedToMe` radio restored (`PGRSearchInboxConfig(visibilityEnabled)`); explicit filter behaves as before |
| Default search | tab state-set (`statesFor(roles)` / all actionable) | legacy `OPEN_STATES` |
| Network | workflow BusinessService + 2× `_count` badge queries | none of these fire (react-query `enabled` gates) |
| Cursor | localStorage high-water mark per (user, tenant, tab) | not read or written |

`PGRInboxConfig.preProcess` keeps BOTH paths: the tab branch runs only when
`additionalDetails.activeTab` is supplied (flag on), the legacy `assignedToMe → params.assignee`
branch only when the radio exists in the form (flag off). Nothing is deleted, so the flag can
flip either way at runtime.

**BE (Step 2) — two layers, mirroring the escalation-engine precedent
(`PGR_ESCALATION_ENABLED` env + `EscalationConfig` MDMS):**
1. `PGR_VISIBILITY_ENABLED` env on pgr-services — deploy-level kill switch, default `false`.
   Gates the `/inbox/_search` + `/inbox/_count` endpoints (off → `FEATURE_DISABLED` error, which
   the FE never triggers because its own flag is off), the HRMS-topic projection consumer, and
   the nightly projection rebuild. Surfaced in the deploy env blocks like the escalation flag.
2. Per-tenant `InboxVisibilityConfig.enabled` — read by `VisibilityService.resolve` before any
   resolution work; off → same `FEATURE_DISABLED` error. The env switch protects the service,
   the MDMS flag scopes the rollout tenant-by-tenant.

Because the FE decides which endpoints to call from the SAME MDMS record the BE validates
against, flag-off tenants never touch the new code path end-to-end: old `_search`, old filters,
old UI. The `eg_pgr_hrms_projection` table may retain rows when flipped off — harmless, it is
only read by the resolver.

**Flip latency (verified on bomet):** `MdmsService.getDataByCriteria` persists MDMS responses in
localStorage (`PersistantStorage`, TTL from `DIGIT-UI.ApiCachingSettings.cacheTimeInSecs`), so an
already-active browser session keeps its cached flag value until the TTL lapses or the user gets a
fresh session. A flip is therefore eventually-consistent per browser, not instantaneous — fine for
rollout/rollback, but don't expect a mid-session switch.

**Rollout:** merge dark (no record anywhere → legacy inbox), seed `enabled: true` on pilot
tenants (bomet `ke` first — done, schema + `INBOX_VISIBILITY` record live), widen per tenant, and
only fold the flag away once V1 semantics are sign-off-stable across tenants.

## 7. Phasing

| Phase | Backend | Frontend |
|---|---|---|
| **P1 (V1)** | `PGR_VISIBILITY_ENABLED` env kill switch (§6.1); `eg_pgr_hrms_projection` + HRMS-topic consumer + nightly rebuild; `VisibilityService` resolver (subtree via recursive CTE), `/inbox/_search`+`_count`, `statesFor(roles)` from BusinessService at search time, jurisdiction→locality expansion, `InboxVisibilityConfig` master | tab strip via `resultsHeader` slot, `useInboxVisibility` flag (off = legacy inbox, §6.1), point hook at `/inbox/*`, radio removed behind flag, cursor badges + red dot, filter-reset-on-switch |
| **P2 (V2)** | denormalize `assignee` col + persister + migration + criteria/QueryBuilder/validator | resolver v2 params flow through unchanged (BE-owned) |
| **P3 (V3)** | persist `escalated_from` in `EscalationService` + criteria | unchanged |
| **Follow-up** | add `reportingTo` filter to egov-hrms `_search` (turns the reportee sweep into one query/level) | — |

## 8. Open decisions

1. **Axis combination** — design ANDs the queue axis and the jurisdiction axis (reportees' work
   *within* my area). Confirm vs. OR (reportees' work *or* anything in my area). **Also**: does the
   jurisdiction scope use the *acting user's* boundaries for both tabs, or the *reportees'*
   boundaries for the All tab?
2. **Counts** — RESOLVED: high-water-mark cursor per (user, tab) keyed on `arrivalTime`
   (state-entry), server-side in Step 2 (§5.5). "My = unopened" is realized as "new since last
   opened" (cursor, not per-item read-state).
3. **Reportee depth** default = 1 (direct reports); PRD says "N+1, to be configurable." Confirm.
4. **HOD / designation** — you picked `reportingTo` + jurisdiction; confirm `isHOD` and
   `designation` rank stay out of scope (they're available if a HOD should see the whole department
   regardless of the person-chain).
5. **Cross-check** — memory references PR #965 (My/All tabs) + #942 (assignee filter/count parity);
   confirm none of this is already on a branch before building P1.
