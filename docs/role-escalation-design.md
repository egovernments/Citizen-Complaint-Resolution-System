# Optional role-level escalation — design

> **Status**: **IMPLEMENTED** (branch `feat/escalation-prd-alignment`, PR #815) and
> verified live on Bomet across the full resolution matrix —
> `pgr-escalation-role-flow.spec.ts` (19/19 with the full-flow spec) proves **R1**:
> unassigned complaint → dryRun `WOULD_ESCALATE` with `R1_PIN` provenance → real
> escalation to the pinned supervisor → OTEL child span asserted from Tempo;
> `pgr-escalation-r2r3-flow.spec.ts` (9/9) proves **R2** exactly-one and ambiguous,
> **R3** consensus and split, plus the cross-tenant memo proof (one scan, two
> tenants, two different targets) on the persistent fixture tenants
> `ke.etoeroles`/`ke.etoebeta` built by
> `tests/integration-tests/scripts/setup-role-fixture.mjs`; and the UI-driven
> configuration spec `escalation-settings-flow.spec.ts` (6/6) drives
> enable → save → test scan → disable through the real Settings page with API
> asserts (see Verification below).
> Opt-in: absent/disabled config is byte-identical to today (pinned by a
> serialization test). Review hardening beyond this design: tenant-keyed resolution
> memoization (one scan can span multiple city tenants), HRMS page-truncation guard
> (no exactly-one verdict from a truncated page), tri-state HRMS lookups (a transient
> blip skips-and-retries instead of bypassing an operator pin), HTTP 409 on
> concurrent mutating scans, and per-complaint OTEL child spans
> (`escalation.complaint`) so provenance survives multi-complaint scans.
> The workflow ASSIGN-persistence prerequisite
> ([eGovStack/core-services#1674](https://github.com/eGovStack/core-services/issues/1674))
> is deployed on Bomet (`egov-workflow-v2:maven-jdk21-43f925c2`).

## Problem

The PRD's primary journey is a complaint that **no one owns**: a GRO routes it
without naming an assignee, every LME in the department sees it in their role
inbox, and nobody acts. Today the scheduler skips these with `NO_ASSIGNEES` —
the PRD's main scenario never escalates. PRD §1 requires: on breach, escalate
to the role's direct supervisor — **exactly one individual**, never a group;
the many-supervisors-across-departments case is explicitly TBD in the PRD; and
PRD p.11 warns that role↔department mapping is unreliable (role names embed the
department as a string, not a field).

## Design stance

1. **Opt-in.** Gated by a new `roleEscalation` object on `CRS.EscalationPolicy`.
   Absent or `enabled != true` ⇒ today's behavior, pinned by test.
2. **One individual.** Every resolution path ends in exactly one person or a
   specific, actionable skip reason. Never a role, never a tie-break the
   operator can't reconstruct.
3. **Deterministic and auditable.** Same data ⇒ same target, and the outcome
   records *which strategy* chose the person (see Provenance).
4. **Honest about the upstream bug.** Eligibility is `getCurrentAssignees`
   returning empty — which reads the same `eg_wf_assignee_v2` table the
   upstream ASSIGN bug fails to populate. This feature does **not** sidestep
   that bug; it changes its failure mode (see below). Hence the prerequisite.

## Interaction with the upstream ASSIGN bug (prerequisite)

While [#1674](https://github.com/eGovStack/core-services/issues/1674) is
unfixed on a tenant, complaints that **were** assigned to a named person read
as assignee-less. With role escalation enabled, every one of them would be
reclassified as "unattended" and re-routed to the *role's* supervisor instead
of the assignee's supervisor — on Bomet today that is all ~55 open complaints,
escalated with a false "nobody picked this up" story. The `history=true`
fallback in `getCurrentAssignees` only covers the self-loop quirk, not the
missing-join-row case. Therefore:

- Enabling `roleEscalation` on a tenant whose workflow service predates the
  #1674 fix is a misconfiguration. The configurator's enable flow surfaces
  this as a warning, and the rollout runbook orders the workflow-image upgrade
  first.
- Escalation comments are hedged to what the system actually knows:
  *"no **recorded** assignee"*, not "nobody picked this up".

## Configuration

### `CRS.EscalationPolicy` gains one optional object

```json
"roleEscalation": {
  "type": "object",
  "properties": {
    "enabled":        { "type": "boolean" },
    "actingRoleByState":    { "type": "object", "additionalProperties": { "type": "string" } },
    "supervisorRoleByRole": { "type": "object", "additionalProperties": { "type": "string" } },
    "maxPerScan":     { "type": "integer", "minimum": 1, "maximum": 100 }
  },
  "additionalProperties": false
}
```

- `actingRoleByState` — which role "owes action" in each watched workflow
  state, e.g. `{ "PENDINGFORASSIGNMENT": "GRO", "PENDINGATLME": "PGR_LME" }`.
  Explicit by design: deriving this from the workflow business-service's
  `state.actions[].roles` is not viable — every watched state also carries
  viewer/citizen/system roles, so "who owes action" is underivable without
  fragile role-class heuristics. (Same precedent as `CRS.WorkflowStateMapping`:
  an explicit operator dictionary replacing inference.) Using the
  business-service as a *validator* — a UI warning when a configured acting
  role does not appear in that state's action roles — was considered but
  descoped from the locked implementation; it is a noted follow-up, not
  shipped.
- `supervisorRoleByRole` — the role ladder, e.g. `{ "GRO": "PGR_SUPERVISOR" }`.
- `maxPerScan` — blast-radius cap (default **10** when the object is present
  but the field absent): at most N role-escalations per scan; the rest are
  recorded as skips with detail `"deferred — maxPerScan reached"` and drain in
  subsequent scans (escalated complaints acquire a named assignee, so they
  leave the unattended pool — the backlog converges). This bounds the
  enable-on-a-backlog burst (a first scan could otherwise route up to
  2×batch-size complaints to one supervisor) and the matching Kafka burst.

Schema change ⇒ idempotent SQL patch (`add-role-escalation.sql`) for
already-registered tenants, same precedent as `add-sla-by-level.sql`.

### Optional explicit pin — new schema `CRS.RoleSupervisors`

```json
{ "role": "PGR_LME", "department": "DEPT_18", "assigneeUuid": "<uuid>", "isActive": true }
```

- `x-unique: ["role", "department"]`, both **required**. mdms-v2 rejects empty
  values inside a unique tuple (`UNIQUE_IDENTIFIER_EMPTY_ERR` in
  `CompositeUniqueIdentifierGenerationUtil`), so the tenant-wide default row
  uses the sentinel department **`"ALL"`** — never `""`.
- A pinned person can go stale (transfer, deactivation). The pin is therefore
  **validated at escalation time**: the target must resolve as an active HRMS
  employee (the escalate path already fetches the employee for the audit
  comment); a stale pin falls through to R2 and the outcome notes it.

## Resolution algorithm

Runs only when: feature enabled AND `getCurrentAssignees` returned empty AND
the complaint's SLA is breached (SLA resolution is completely unchanged — the
cascade never needed an assignee; only the escalate step gains a target).

1. `actingRole = actingRoleByState[applicationStatus]`
   → no entry ⇒ skip **`ROLE_NOT_MAPPED`**.
2. `department` = the complaint's `ServiceDefs.department` (extraction is new
   code — `buildServiceCodeMapping` currently keeps only path/category/
   subcategoryL1; the raw response already carries department). May be null;
   it is only ever a *filter*, never required.
3. Resolve the target — first hit wins, each step memoized **per scan** keyed
   on `(actingRole, department)` (resolution does not depend on the complaint,
   so a scan performs a handful of HRMS lookups, not one per complaint):
   - **R1 — explicit pin**: active `CRS.RoleSupervisors` row for
     `(actingRole, department)`, else `(actingRole, "ALL")`. Target must be an
     active HRMS employee; stale pin ⇒ continue to R2.
   - **R2 — ladder**: applies when `supervisorRoleByRole[actingRole]` exists.
     HRMS search for employees holding that role with **`isActive=true`**, an
     explicit `limit`/`offset` (HRMS NPEs without offset), and candidacy
     restricted to employees whose **current assignment**
     (`isCurrentAssignment == true`) matches `department` when non-null.
     Exactly one candidate ⇒ target. More than one ⇒ skip
     **`ROLE_SUPERVISOR_AMBIGUOUS`**. Zero ⇒ retry without the department
     filter (same one-or-skip rule); zero again ⇒ skip
     **`NO_ROLE_SUPERVISOR`**. A configured ladder is authoritative: R2
     exhaustion does **not** fall through to R3.
   - **R3 — reportingTo consensus**: applies only when no ladder entry exists
     for `actingRole`. Same HRMS predicate, but over holders of `actingRole`
     itself; collect their distinct non-null current `reportingTo` uuids.
     Exactly one ⇒ target; several ⇒ `ROLE_SUPERVISOR_AMBIGUOUS`; none ⇒
     `NO_ROLE_SUPERVISOR`.
4. Escalate exactly as the named-assignee path does today: ESCALATE self-loop
   transition with `assignes=[target]`, `escalationLevel++`, `lastModifiedTime`
   refresh (fresh clock, P6), enriched comment. After this, the complaint HAS
   a named assignee — subsequent levels reuse the existing reportingTo path
   unchanged (the ladder converges into the shipped P3 machinery; no parallel
   escalation system).

**On ambiguity we skip, not guess.** Arguments for picking deterministically
(round-robin, load-based) were considered: they keep complaints moving. They
lose because the misroute is invisible (supervisor actions to hand a complaint
back are not configurable yet — P9), "why did X get this?" becomes
unanswerable, and the data problem the PRD itself marked TBD gets papered
over. The skip is actionable: the operator pins a `RoleSupervisors` row or
fixes HRMS. Note the same-department two-supervisors case is **our**
conservative extension of the PRD's cross-department TBD, not a PRD mandate.
The skip-don't-guess stance is only honest if recurring skips are visible —
see Operator UI.

### New skip reasons (enum 9 → 12)

| Reason | Meaning | Operator fix |
|---|---|---|
| `ROLE_NOT_MAPPED` | watched state has no acting-role entry | add it in Settings |
| `ROLE_SUPERVISOR_AMBIGUOUS` | 2+ candidates matched | pin a person, or fix HRMS |
| `NO_ROLE_SUPERVISOR` | 0 candidates anywhere | create/activate the supervisor, or pin |

`NO_ASSIGNEES` remains the reason while the feature is disabled; its
plain-language explanation gains "enable 'Escalate complaints nobody has
picked up' under Escalation behaviour to act on these."

### Provenance (auditability)

Every role-escalation outcome and its Kafka event carry:
`resolutionStrategy` (`R1_PIN` | `R2_LADDER` | `R3_REPORTING`),
`actingRole`, `candidateCount`, `departmentFiltered` (bool — false when the
tenant-wide retry fired), plus the existing slaSource/level fields; the same
go on the OTEL span. The audit comment reads:
*"Auto-escalated (no recorded assignee): assigned to %s (%s) — acting role
%s%s"* with the department-fallback noted when it fired. Without this, the
moment HRMS data changes, "why did Subham get this?" is unrecoverable.

### Concurrency

`@Scheduled(fixedDelay)` never overlaps itself, but `/escalation/_trigger`
runs the same scan concurrently with the cron. A non-dry-run scan takes an
in-process guard (atomic flag); a second concurrent mutating scan returns
HTTP 409 `SCAN_IN_PROGRESS` (dry runs are unaffected). This is sufficient for
the single-replica deployments this stack targets; multi-replica would need a
shared lock and is out of scope.

Two live observations belong here. First, the cron transitions under a
**SYSTEM identity**, and on current Bomet `egov-workflow-v2` accepts the
cron's ESCALATE even at states whose action role lists do not include
`SYSTEM` (ESCALATE at `PENDINGFORASSIGNMENT` carries only
`GRO`/`AUTO_ESCALATE`/`PGR_VIEWER`) — confirmed MUTATING live by the r2r3
suite's sentinel; the behaviour has flipped across Bomet builds, so the
suite measures it instead of assuming a branch. With `roleEscalation`
enabled the background cron therefore escalates unattended complaints
autonomously — intended per the PRD — but whether workflow should honour
SYSTEM transitions the state's role list does not grant is an open upstream
question. Second, the e2e suites that reconfigure the production-shared
`CRS.EscalationPolicy` singleton must be **serialized** (the r2r3 spec
fails fast with a concurrent-writer diagnostic) — see Verification.

## Operator UI (Escalation Settings)

- **Card 2 opt-in block**: checkbox *"Escalate complaints nobody has picked
  up"* → reveals per-watched-state acting-role selects (role list from
  ACCESSCONTROL-ROLES; the business-service mismatch warning is the descoped
  follow-up noted under Configuration), the role→supervisor-role rows,
  max-per-scan, and *"Pin a specific person per role…"* (RoleSupervisors
  editor: role, department or "All departments", HRMS employee picker).
- **Known limitation — pinning city-tenant employees**: the pin editor's
  employee look-up searches HRMS at the *page* (state) tenant, so an employee
  who exists only on a city tenant cannot be looked up — and therefore cannot
  be pinned — through the UI today. The failure is graceful ("No active
  employee found…", the Save-pin gate stays closed; asserted in the UI e2e
  spec). Until a tenant-scoped look-up ships, such pins are seeded via the
  API/MDMS (`CRS.RoleSupervisors`) directly.
- **Enable flow guardrails**: enabling prompts *"Run a test scan first"* (the
  dry-run twin `previewEscalation` resolves through the same R1→R3 path, so
  `WOULD_ESCALATE` counts and provenance are exact); and warns when the
  tenant's workflow service predates the #1674 fix.
- **Verify card**: the three new skip reasons join the dictionary with the
  actionable copy above; recurring `ROLE_SUPERVISOR_AMBIGUOUS` counts are the
  operator's discovery signal (push alerting on recurring skips is a
  follow-up, tracked — without some discovery path, skip-don't-guess would
  quietly recreate the rotting-complaint problem this feature exists to fix).

## Interim limitation: supervisor visibility

ESCALATE is a self-loop — the complaint stays in `PENDINGATLME` /
`PENDINGFORASSIGNMENT` with a new assignee. If the supervisor's roles don't
include those states' inbox roles, the complaint may not appear in their
default inbox view (search always works). This is the deferred P5
(inbox-ownership semantics, upstream). The rollout runbook includes a live
check on the target tenant; until P5 lands, supervisors find escalated items
via search/assigned-to-me views. Citizen notification on escalation remains
G5, same as named-assignee escalations.

## Verification

> Methodology (pacing, sentinels, snapshot/restore discipline, dry-run-first,
> fixture rules) is defined centrally in the design doc's
> [Testing methodology](./escalation-feature-design.md#testing-methodology) —
> binding for these suites too.

Four live suites cover the matrix end to end on Bomet:

| Suite | What it proves |
|---|---|
| [`pgr-escalation-full-flow.spec.ts`](../tests/integration-tests/tests/lifecycle/pgr-escalation-full-flow.spec.ts) | The named-assignee baseline: tuple-scoped 15 s SLA, ASSIGN (#1674 regression read), dryRun → real escalation, OTEL trace from Tempo. |
| [`pgr-escalation-role-flow.spec.ts`](../tests/integration-tests/tests/lifecycle/pgr-escalation-role-flow.spec.ts) | **R1** end to end: unassigned complaint + `GRO.ALL` pin → dryRun with `R1_PIN` provenance → real escalation to the pinned supervisor → `escalation.complaint` child span. |
| [`pgr-escalation-r2r3-flow.spec.ts`](../tests/integration-tests/tests/lifecycle/pgr-escalation-r2r3-flow.spec.ts) | **R2** exactly-one (real) and ambiguous (read-only skip), **R3** consensus (real) and split (skip), plus the cross-tenant memo proof — one scan resolving the same acting role to different people on two city tenants. |
| [`escalation-settings-flow.spec.ts`](../configurator/e2e/escalation-settings-flow.spec.ts) | The operator journey through the real UI: enable → save (read-after-write) → dry-run test scan → pin-lookup limitation UX → disable, with API asserts on the exact persisted `roleEscalation` object. |

**Run cadence: serialize these suites.** All four snapshot/reconfigure the
production-shared `CRS.EscalationPolicy` singleton; the r2r3 spec fails fast
with an explicit CONCURRENT WRITER diagnostic when another session touches
the row mid-run. The R2/R3/cross-tenant scenarios run on the persistent
fixture tenants `ke.etoeroles` / `ke.etoebeta` (roles
`E2E_SUP1`/`E2E_SUP2`/`E2E_ROLE3`/`E2E_ROLE4` at root `ke`, eight employees
across the two tenants; zero `E2E_*` holders at production `ke.bomet` by
invariant), built create-or-verify-idempotently by
[`tests/integration-tests/scripts/setup-role-fixture.mjs`](../tests/integration-tests/scripts/setup-role-fixture.mjs)
— re-run it for a no-op verify.

## Rollout

1. Deploy a workflow image containing the #1674 fix; verify
   `eg_wf_assignee_v2` rows appear on a fresh ASSIGN.
2. Register/patch schemas (`add-role-escalation.sql`, `CRS.RoleSupervisors`).
3. Configure mappings in Settings; run a dry-run scan; review
   `WOULD_ESCALATE` + provenance.
4. Enable with the default `maxPerScan`; watch the first scans drain the
   backlog gradually.

New-tenant seeding (CRSLoader / tenant bootstrap / Ansible) should template
the standard PGR mapping (`GRO`/`PGR_LME` → supervisor role) so the PRD's
primary journey is on-by-default for fresh tenants once the feature has a
deployment cycle of soak; existing tenants stay opt-in.

## Out of scope (unchanged)

Inbox ownership transfer + N+1 visibility (P5/P11, upstream); pre-breach
delivery (G5); business SLA clock (P6 second half); widening the watched-state
list; multi-replica scan locking.
