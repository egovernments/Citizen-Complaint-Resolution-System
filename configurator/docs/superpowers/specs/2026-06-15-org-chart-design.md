# Org Chart for Configurator — Design Spec

**Date:** 2026-06-15
**Status:** Approved (design), pending implementation plan
**Author:** Karun Agarwal (with Claude)

## 1. Summary

Add an **Org Chart** view to the configurator that visualizes the employee
reporting hierarchy for a single tenant, derived from the HRMS
`assignment.reportingTo` field. It is a read-only, click-through view reachable
from a dedicated dashboard/menu entry. Rendering uses **React Flow
(`@xyflow/react`)** with **dagre** auto-layout.

## 2. Background & data reality

The chart is built on egov-hrms employee data. A live scan of the `ke`
environment (243 tenants, 54 distinct employees, 406 assignments) established
how `reportingTo` actually behaves — and these facts drive the design:

- **`reportingTo` is sparse:** ~96% of assignments have it `null`. Only 15 of
  406 were populated.
- **Values are UUIDs, not names:** despite the API spec describing it as "Name
  of the employee," every populated value is a UUID referencing the manager's
  user/employee record (in HRMS, employee `uuid` == user `uuid`).
- **No referential integrity:** the most-referenced value (`eb5601b5-…`,
  appearing 7 of 15 times) returns **zero** results from HRMS employee
  `_search`. It is a valid *user* (`KE_GRO`, "County GRO") but not a queryable
  *employee* — a dangling reference.
- **The graph is a forest:** mostly disconnected single nodes, a few small
  trees, plus dangling-manager edges.

**Implication:** the chart must gracefully handle a sparse forest, dangling
references, potential cycles, and isolated nodes — these are normal inputs, not
error conditions.

## 3. Decisions (locked)

| Decision | Choice |
|----------|--------|
| Chart basis | **True reporting** — `reportingTo` edges only (no dept/designation inference) |
| Tenant scope | **Single selected tenant** at a time (employees live under city/sub-tenants) |
| Library | **React Flow (`@xyflow/react`) + dagre** auto-layout |
| Interactivity | **Read-only + click-through** to the employee Show/Edit page; no editing of `reportingTo` from the chart |
| Dangling-manager enrichment | **Included** — one batched `/user/_search` to name unresolved manager UUIDs |

## 4. Placement & routing

- New custom route **`/org-chart`** registered in `src/App.tsx` inside the
  existing `<CustomRoutes>` block (mirrors the `PgrDashboard` → `/pgr-dashboard`
  precedent).
- New nav entry in `src/admin/DigitLayout.tsx` under the **"people"** group
  (alongside Employees), label key `app.nav.org_chart` (add to i18n
  resources, English first).
- Source lives in `src/pages/org-chart/`.

## 5. Architecture & components

Each unit has a single purpose and a clear interface. Pure logic is separated
from React and network so it can be unit-tested in isolation.

| Unit | File | Type | Responsibility |
|------|------|------|----------------|
| Graph builder | `src/pages/org-chart/buildOrgGraph.ts` | pure fn | Transform `Employee[]` → `OrgGraph`. All quirk-handling: UUID resolution, orphan separation, dangling detection, cycle/self-ref breaking, stats. No React, no network. |
| Layout | `src/pages/org-chart/layoutGraph.ts` | pure fn | Position nodes/edges via dagre (top-down). Returns positioned RF nodes + edges. |
| Data hook | `src/pages/org-chart/useOrgChartData.ts` | react-query hook | Fetch employees for tenant; build graph; batch-enrich unresolved managers via `/user/_search`; memoize. |
| Node | `src/pages/org-chart/EmployeeNode.tsx` | RF custom node | shadcn card UI + node-type styling; click → navigate to employee page. |
| Page | `src/pages/org-chart/OrgChartPage.tsx` | page | Tenant picker, stats header, legend, React Flow canvas, search-to-highlight, orphans side panel, empty/error states. |
| Types | `src/pages/org-chart/types.ts` | types | `OrgNodeData`, `OrgGraph`, node-kind enum. |

### Data flow

```
Tenant picker
  └▶ useOrgChartData(tenantId)
       1. hrmsService.searchEmployees(tenantId, { limit: CAP })   // one call
       2. buildOrgGraph(employees) → OrgGraph
       3. if graph.unresolvedManagerIds.length:
            userSearch({ uuid: unresolvedManagerIds, tenantId })  // one batched call
            → attach names to unresolved nodes
       4. layoutGraph(connectedNodes, edges) → positioned nodes
  └▶ OrgChartPage renders:
       • React Flow canvas (connected nodes + edges)
       • Orphans side panel (isolated nodes)
       • Stats header + legend
  └▶ Click node → navigate to /employees/{uuid}
```

## 6. Core logic: `buildOrgGraph`

**Input:** `Employee[]` (from HRMS `_search`).
**Output (`OrgGraph`):**

```ts
interface OrgGraph {
  nodes: OrgNodeData[];          // ALL employees, each tagged with a kind
  edges: { source: string; target: string }[];  // manager(uuid) → report(uuid)
  orphanIds: string[];           // employees with no manager AND no reports
  unresolvedManagerIds: string[];// reportingTo UUIDs not matching any employee
  cycleEdges: { source: string; target: string }[]; // back-edges removed
  stats: { total; withManager; orphans; unresolved; cycles };
}
```

**Rules:**
1. Build an employee map keyed by `uuid`.
2. For each employee, select the **current assignment** (`isCurrentAssignment === true`); if none, fall back to the most recent by `fromDate`. Read its `reportingTo`.
3. If `reportingTo` is set:
   - **Self-reference** (`reportingTo === own uuid`) → ignore the edge, flag the node.
   - **Resolves** to an employee in the map → add edge `manager → employee`.
   - **Does not resolve** → record in `unresolvedManagerIds`; create a synthetic "unresolved manager" node (kind `unresolved`) keyed by the UUID; add edge from it to the employee.
4. **Cycle detection:** before layout, run a DFS; any edge that would close a cycle is moved to `cycleEdges` and dropped from the layout graph (nodes involved get a "cycle" flag for the badge).
5. **Orphan classification:** an employee node with no incoming and no outgoing edges (after the above) → `orphanIds`. Orphans are excluded from the canvas node set passed to layout, but remain in `nodes` for the side panel.
6. Compute `stats`.

**Node kinds (`OrgNodeData.kind`):** `manager` (has reports), `member` (has a
manager, no reports), `orphan`, `unresolved`, plus an `inactive` flag
(`IsActive === false`) and a `cycle` flag — orthogonal to kind, used for
styling.

## 7. Node UI (`EmployeeNode`)

shadcn `Card`-based, Tailwind-styled, ~one fixed width for dagre sizing. Shows:
name (`user.name`), designation + department (current assignment), employee
`code`, and an active/inactive badge. Styling by kind:

- `member`/`manager`: standard card (manager slightly emphasized).
- `unresolved`: **dashed border**, warning icon, label "user only — not an
  employee"; shows the enriched name (e.g. "County GRO (KE_GRO)") or the raw
  UUID if enrichment found nothing. **Not clickable** (no employee page exists).
- `inactive`: muted/desaturated.
- `cycle` flag: small badge indicating the node is part of a reporting cycle.

**Click-through:** clicking a real employee node navigates to
`/employees/{uuid}` (the employee Show page; `getOne` resolves by `uuid`).
Implemented via react-router `useNavigate`.

## 8. Layout: `layoutGraph`

dagre, rank direction **TB** (top-down), with sensible node sep / rank sep.
Fixed node dimensions matching the card. Disconnected components are laid out by
dagre and rendered together on the canvas. Output positions feed React Flow's
`nodes`. React Flow provides pan, zoom, fit-view, minimap, and controls.

## 9. Page features (v1)

- **Tenant picker** (top bar) — reuses the existing `tenants` resource /
  dataProvider list; on change, refetch.
- **Stats header** — total, with-manager, orphans, unresolved, cycles.
- **Legend** — explains node kinds/flags.
- **Search box** — highlight and center on a person (by name/code).
- **Orphans side panel** — collapsible list "No reporting relationship (N)";
  clicking an entry navigates to that employee's page. Keeps the canvas
  meaningful instead of rendering dozens of floating cards.
- **Canvas controls** — pan/zoom/minimap/fit-view from React Flow.

## 10. Edge & empty states

| Condition | Behavior |
|-----------|----------|
| No tenant selected | Prompt to pick a tenant |
| Tenant has 0 employees | Empty state message |
| All employees are orphans | Empty canvas message + populated orphans panel |
| Dangling managers present | Rendered as `unresolved` nodes; counted in stats |
| Cycle detected | Back-edge dropped from layout; nodes badged; `console.warn` |
| Employee count > CAP | Render first CAP; visible "showing first N of M" note (CAP generous, e.g. 1000; real tenants are tiny) |
| HRMS/user search error | Error state with retry (react-query) |

## 11. New dependencies

- `@xyflow/react` (React Flow) — MIT
- `dagre` + `@types/dagre`

## 12. Testing

- **Unit (vitest)** on `buildOrgGraph`:
  - multi-root forest produces correct edges
  - current-assignment selection (and fallback) for `reportingTo`
  - orphan separation (no in/out edges)
  - dangling/unresolved manager detection + synthetic node
  - self-reference ignored
  - cycle back-edge moved to `cycleEdges` and dropped
  - stats correctness
- **Unit smoke** on `layoutGraph`: positions assigned, no throw on disconnected input.
- **Component** render+click test for `EmployeeNode` (navigates for real node,
  not for `unresolved`).
- **Manual:** load `/org-chart`, pick a `ke.*` tenant, verify trees, orphans
  panel, unresolved node naming, click-through.

## 13. Out of scope (v1 / future)

- Editing `reportingTo` from the chart (drag-to-reparent) — deferred; `_update`
  has quirks and writes are riskier.
- Collapse/expand subtrees — low value given trees are tiny; deferred to avoid
  added node-data/context wiring in v1.
- Cross-tenant / merged-tenant org chart.
- Dept/designation-based inferred hierarchy.
- Export to image/PDF.

## 14. Non-functional notes

- API budget: **two read-only calls** per chart load (one HRMS `_search`, one
  optional batched `/user/_search`). No writes.
- Follows existing configurator patterns: ra-core, shadcn/Radix + Tailwind,
  react-query, react-router; pure logic separated for testability.
