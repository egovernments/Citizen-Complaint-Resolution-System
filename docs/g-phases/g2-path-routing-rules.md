# G2: Path Routing Rules

> **Status**: DESIGN ONLY — no production-ready code or UI lands in the PR that introduces this document. This file is the canonical place to review the SHAPE of Phase G2 before implementation. The companion GitHub Discussion is the place for architectural feedback; PR comments stay focused on code-level review.
>
> **Roadmap home**: [docs/crs-configurator-roadmap.md](../crs-configurator-roadmap.md) (Phase G2 section).
> **Stacked on**: PR #770 (escalation foundation) → PR #A (state-name MDMS) → PR #B (wiring strategies).

---

## Why

CRS today routes complaints implicitly: the citizen picks a category and the workflow runs in whichever path that category's metadata says it belongs to. There is no editable, auditable rules engine — and when a complaint arrives with a category the system doesn't recognise, the escalation scheduler logs an `UNMAPPED_CATEGORY` skip and the case quietly falls through to the per-tenant `CRS.StateSLA` defaults.

This phase replaces the silent-fallback path with an explicit **Path Routing Rules** engine. The engine answers a single question: given a complaint's `(category, subcategoryL1?)`, which **path** should it land on? Where _path_ is whatever opaque key the tenant has chosen — the BRD example uses `IGE` vs `IGSAE` (BRD §5.2 "Routing Logic"), but for the Bomet / Nairobi tenants today there is no path concept at all, so this phase lets each tenant define its own.

The engine's output (the resolved path) feeds the same `(path, category, subcategoryL1)` key that `CRS.CategorySLA` (PR #770) is already shaped around — so once G2 is in place, the scheduler's `UNMAPPED_CATEGORY` skip becomes vanishingly rare and is reserved for genuine misconfiguration (a complaint category the operator forgot to add a rule for, surfaced as an explicit "no rule matched" decision in the trace-back tool).

Reference: BRD §5.2 ("Routing Logic"), the **Strategy B** wiring discussion in [docs/categorysla-wiring-strategies.md](../categorysla-wiring-strategies.md), and the `CRS.CategorySLA` keying convention in [docs/escalation-feature-design.md](../escalation-feature-design.md).

---

## Scope

**In:**
- Two new MDMS schemas (`CRS.PathRoutingRule`, `CRS.PathRoutingDefault`) — stubs reserved in `utilities/default-data-handler/src/main/resources/schema/CRS.G2.json` by the same PR that introduces this doc; full schema body filled in by the implementation PR.
- A configurator route group under `/manage/crs-routing/...` with a rule-list editor, a per-rule edit form, a per-tenant default editor, and a "preview" tool (paste a category, see the routing decision).
- A backend lookup hook in `pgr-services` (~30-50 LOC) that runs the rule engine on complaint creation and writes the resolved path into the complaint record so downstream consumers (scheduler, dashboards) can key on it without re-running the engine.
- One `CRS.SLAAuditLog` entry per rule save / per default save — reusing the audit primitive already shipped in PR #770. (When Phase G4's `CRS.ConfigAuditLog` lands, the routing-rules editor migrates to that.)
- Soft-delete on rules (no hard delete) so historical complaints can be traced back to the rule that placed them.

**Out (deferred to later phases or upstream):**
- ML-based / NLP-based auto-categorisation. Explicitly excluded by BRD §1.3.
- Free-text NLP over the complaint description.
- A constrained category picker on the rule editor — until Phase G1 (Category Taxonomy) lands, the `category` and `subcategoryL1` fields on a rule are typed as free-text-with-autocomplete (autocomplete sourced from whatever `CRS.CategorySLA` records exist on the tenant, same pattern as the SLA Matrix in #770). G1 will swap these for a strict picker.
- A new backend service. The rule engine lives as a thin helper inside `pgr-services`; it does NOT get its own microservice.
- Schema rollout for the BRD's IGE/IGSAE seed. Each tenant populates rules via the configurator or a CSV import — nothing is auto-seeded (consistent with the rest of CRS configurator phases).
- Cross-tenant rule sharing. Rules are scoped per-city-tenant with root-tenant inheritance, mirroring `CRS.CategorySLA`.

---

## MDMS schemas

Two new schema codes, reserved as stubs in this PR (`utilities/default-data-handler/src/main/resources/schema/CRS.G2.json`) so that future references in the configurator UI, the `pgr-services` routing hook, and the open-questions list stay stable. The stubs ship with `"isActive": false` and an empty `definition.properties` — the implementation PR will set `isActive: true` and fill in the shape sketched below.

### `CRS.PathRoutingRule`

One row per evaluable rule. Sketch shape (final shape will mirror `CRS.CategorySLA`'s conventions: `object` type, `x-unique`, `x-ref-schema=[]`, `additionalProperties=false`):

```jsonc
{
  "code": "string (operator-defined or UUID; uniqueIdentifier)",
  "category": "string (free-text until G1; references CRS.CategoryTaxonomy.category after G1)",
  "subcategoryL1": "string? (optional — if absent, matches any L1 under the category)",
  "path": "string (the routing path key; consumed by CRS.CategorySLA — same token vocabulary)",
  "requiresManualTriage": "boolean (BRD §5.2: IGE path requires manual triage; IGSAE goes direct)",
  "priority": "integer (lower wins; ties broken by created-at)",
  "isActive": "boolean (soft-delete = false)"
}
```

- `x-unique`: `[code]` (a deterministic identifier so re-imports are idempotent).
- The pair `(category, subcategoryL1)` is intentionally NOT unique — operators may want overlapping rules with different priorities (e.g. a tenant-wide rule plus a more-specific override).

### `CRS.PathRoutingDefault`

Singleton record per tenant. Sketch shape (mirrors `CRS.StateSLA` and `CRS.WorkflowStateMapping` singleton convention):

```jsonc
{
  "singletonKey": "default",
  "defaultPath": "string (the path to use when no rule matches)",
  "defaultRequiresManualTriage": "boolean (typically true so the case lands in a triage queue rather than being routed blindly)"
}
```

- `x-unique`: `[singletonKey]`, value always `"default"`. Mirrors the singleton convention already used by `CRS.StateSLA` and `CRS.WorkflowStateMapping` (see [PR #770 escalation foundation](../escalation-feature-design.md)).

---

## Configurator routes + UI sketch

New routes added under `/manage/crs-routing/...` in `digit-configurator`. Sidebar nav entry sits under the existing **CRS** group (alongside `/manage/crs-sla-matrix` and `/manage/crs-sla-trace` shipped by PR #770).

| Route | Page |
|---|---|
| `/manage/crs-routing` | List view: all rules, sortable by priority / category / path |
| `/manage/crs-routing/new` | Create a rule |
| `/manage/crs-routing/:code/edit` | Edit / soft-delete a rule |
| `/manage/crs-routing/default` | Per-tenant default (single-record editor) |
| `/manage/crs-routing/preview` | Paste a `(category, subcategoryL1?)` → see resolved path + rule that matched |

### Page anatomy — list view (`/manage/crs-routing`)

```
+------------------------------------------------------------------+
|  Path Routing Rules                              [+ New rule]    |
|  Per-tenant default: IGSAE (no triage)           [Edit default]  |
+------------------------------------------------------------------+
|  Filter: [path ▼] [category ▼] [active ▼]   [Search...........]  |
+------------------------------------------------------------------+
|  Pri | Category          | SubcatL1     | Path  | Triage | ⋮    |
+------+-------------------+--------------+-------+--------+------+
|  10  | Public Service    | (any)        | IGE   |  yes   | edit |
|  20  | Establishment     | Food poison… | IGSAE |  no    | edit |
|  30  | Establishment     | (any)        | IGSAE |  no    | edit |
|  99  | (matches none)    | —            | —     | —      |  —   |
+------------------------------------------------------------------+
|  [Bulk import CSV]   [Export CSV]                                |
+------------------------------------------------------------------+
```

### Page anatomy — preview tool (`/manage/crs-routing/preview`)

```
+------------------------------------------------------------------+
|  Routing Preview                                                 |
+------------------------------------------------------------------+
|  Category:       [ Public Service                          ▼ ]   |
|  SubcategoryL1:  [ (leave blank for any)                   ▼ ]   |
|                                                                  |
|                                       [ Resolve ]                |
+------------------------------------------------------------------+
|  Result:                                                         |
|    Path:                    IGE                                  |
|    Requires manual triage:  yes                                  |
|    Matched rule:            #10 — Public Service / (any)         |
|    Decision time:           42 ms                                |
+------------------------------------------------------------------+
```

The preview tool is the primary debugging surface for operators when a complaint lands on an unexpected path in production.

---

## API endpoints touched

- **MDMS v2 `/mdms-v2/v2/_create`, `/mdms-v2/v2/_update`, `/mdms-v2/v2/_search`** — the default read/write path for rules and the singleton default. Same call shape the configurator already uses for `CRS.CategorySLA` (PR #770).
- **MDMS v2 schema-search** — to discover whether `CRS.PathRoutingRule` is installed on the target tenant (used by the configurator to decide whether to show the route at all).
- **`pgr-services`** — one new internal helper that runs the rule engine on complaint create, and one new optional admin endpoint `POST /pgr-services/routing/_preview` that the configurator's preview tool calls server-side (so the preview matches production resolution exactly, including the cache, rather than re-implementing the lookup in the SPA). The helper is ~30-50 LOC; the endpoint is another ~30 LOC plus tests.
- **Redis cache key `crs.routing.rules.<tenant>`** — populated on first lookup, invalidated on rule save. Same pattern as the `validationRules` cache for user-validation (referenced in `~/CLAUDE.md` "Mobile Number Validation" section) and the `crs.permission.matrix.<tenant>` pattern planned for Phase G4.

No new microservice. No schema changes to the existing PGR service contract — the resolved path is written into the existing `additionalDetail` blob on the complaint (or into a new column on `eg_pgr_service` if the implementation PR decides that's cleaner — open question).

---

## Dependencies on prior phases

**Must ship first:**
- **PR #770** (escalation foundation) — `CRS.CategorySLA`, `CRS.StateSLA`, `CRS.WorkflowStateMapping`, `CRS.SLAAuditLog`, scheduler patch. The whole point of routing rules is to feed the path key that `CRS.CategorySLA` already keys on.
- **PR #A** (state-name MDMS, `refactor/scheduler-state-name-mdms`) — `CRS.WorkflowStateMapping` so the scheduler can resolve state names. Routing doesn't directly depend on state-name mapping, but the implementation PR for G2 will land on top of #A so the test fixtures share a tenant baseline.
- **PR #B** (`docs/categorysla-wiring-strategies`) — establishes the Strategy A (rich intake) vs Strategy B (ServiceDefs extension) framing that the routing engine plugs into. G2's engine is essentially a third option: instead of trusting the complaint payload (A) or the ServiceDefs row (B), the routing engine derives the path from a rule applied to the category. The wiring-strategies doc references G2 as the "future replacement for the silent UNMAPPED_CATEGORY fallback".

**Recommended (but not strictly blocking):**
- **G1 (Category Taxonomy)** — once G1 lands, the `category` and `subcategoryL1` fields on a rule become a strict picker rather than free-text-with-autocomplete. G2 ships first against free-text (matching the SLA Matrix in #770), then migrates when G1 is ready.

**This phase blocks:**
- The **silent-fallback removal** in the escalation scheduler — once routing rules exist, the scheduler's `UNMAPPED_CATEGORY` skip can become a hard error in strict mode (gated by a per-tenant `strictRouting` flag).
- The dashboard "Ranking of institutions" indicator (BRD Appendix C) — it needs a reliable path resolution before it can group by IGE / IGSAE / etc.
- A meaningful Phase G4 audit on `_trigger` / `_close` / `_assign` — without routing rules, the audit can't tell whether a given action was correct for the resolved path.

---

## Acceptance criteria

An operator can confirm Phase G2 is fully shipped by running:

- [ ] **Schemas installed.** `mdms-v2 /v2/schema/_search` returns active definitions for both `CRS.PathRoutingRule` and `CRS.PathRoutingDefault` on the target tenant.
- [ ] **Default record present.** `mdms-v2 /v2/_search` for `CRS.PathRoutingDefault` with `uniqueIdentifiers=["default"]` returns a single record with a `defaultPath` set.
- [ ] **At least one rule resolves.** Calling `POST /pgr-services/routing/_preview` with the operator's most common `(category, subcategoryL1)` returns a `path` that matches `CRS.CategorySLA`'s expected key.
- [ ] **Configurator route renders.** `/manage/crs-routing` loads without errors, lists installed rules, and the `[+ New rule]` button creates a rule that's visible immediately on save.
- [ ] **Preview matches production.** Submitting the same complaint payload via the citizen portal lands on the path the preview tool predicted (verified by reading `eg_pgr_service.additionaldetail` or the new column for that complaint).
- [ ] **Cache invalidation works.** Edit a rule → re-run the preview within 1 second → the new rule fires (no service restart). Confirms the Redis `crs.routing.rules.<tenant>` invalidation hook is wired.
- [ ] **Audit row present.** Every save writes one `CRS.SLAAuditLog` (G4: `CRS.ConfigAuditLog`) entry with the actor's userUuid, the before/after JSON, and a non-empty `recordIdentifier`. Visible in `/manage/crs-sla-matrix`'s audit drawer.

---

## Estimated effort

**M (~2-3 days)** — schema + UI (4 routes including preview) + 1 backend hook in `pgr-services` + cache wiring. Comparable size to Phase G1 (Category Taxonomy) on the roadmap. The schema is small (2 codes), the UI is mostly a CRUD pattern already in use in PR #770, and the backend hook is well-trodden: the engine is a simple priority-ordered scan over the cached rule list.

---

## Open questions

1. **Resolved-path storage.** Where does the resolved path live on the complaint record? Options: (a) `additionalDetail.routing.path` blob (zero schema change, matches Strategy A in [categorysla-wiring-strategies.md](../categorysla-wiring-strategies.md)); (b) new `path` column on `eg_pgr_service` (requires Flyway migration, but makes downstream queries faster and avoids the OTEL serialisation cost on every escalation cycle). The wiring-strategies doc leans (a); a fresh look from the implementation engineer is welcome.
2. **`requiresManualTriage` consumer.** Which workflow state corresponds to "manual triage" today? Bomet / Nairobi do not have a distinct triage state — the BRD's `IN_SCREENING` maps to `triage` in `CRS.WorkflowStateMapping`. Does setting `requiresManualTriage=true` simply force the workflow's first transition to the state mapped to `triage`, or is there a separate triage-queue dashboard widget that the IGE path requires?
3. **Per-tenant strict mode.** Should the scheduler's `UNMAPPED_CATEGORY` skip become a hard error when at least one routing rule exists, or stay soft-fallback forever and require an explicit per-tenant `strictRouting=true` flag to upgrade?
4. **Rule priority resolution semantics.** Lower-number-wins is the proposal. If two rules tie on priority (operator error), do we (a) reject the save, (b) pick deterministically by `code` lexical order, or (c) log a warning and pick the first-created? Equivalent question for "no rule matches" — does the default fire silently, or does the audit log record a "no rule matched, default applied" entry?
5. **Migration from Strategy A / B tenants.** A tenant currently relying on Strategy A (rich intake — `complaint.additionalDetail.path` set by the client) or Strategy B (`ServiceDefs.path` field) will, after G2 lands, have THREE possible sources of truth for the path. What's the precedence order? Proposal: G2 routing engine takes precedence; Strategy A / B values are used as a fallback when no rule matches AND no `CRS.PathRoutingDefault` is configured. This needs explicit confirmation before the implementation PR locks it in.

---

## Cross-references

- **Discussion**: _(filled in after Discussion is created)_
- **Roadmap doc**: [docs/crs-configurator-roadmap.md](../crs-configurator-roadmap.md) (Phase G2 section)
- **Escalation design doc**: [docs/escalation-feature-design.md](../escalation-feature-design.md)
- **Wiring strategies doc**: [docs/categorysla-wiring-strategies.md](../categorysla-wiring-strategies.md) (PR #B)
- **State-name MDMS PR**: PR #A (`refactor/scheduler-state-name-mdms`, stacked under PR #B)
- **Escalation foundation PR**: [PR #770](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/770)
