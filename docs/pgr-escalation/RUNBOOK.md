# PGR auto-escalation — runbook

Enable `pgr-services`' `EscalationScheduler` (auto-reassign an overdue complaint to the
current assignee's HRMS supervisor) on a **running** DIGIT/CMS deployment. Terse; every
command here was run and verified on a real box (tenant `mz`).

**Script** — [`enable-escalation.sh`](../../local-setup/scripts/enable-escalation.sh) is the
runnable form of everything below: six independent, idempotent steps you can run individually,
in any subset, in any order (`--only`, `--from`, `--to`), or all at once.

---

## 1. What has to be true for a complaint to actually escalate

Four independent things, all required — missing any one means the scheduler either does
nothing or errors on that complaint:

| # | What | Where it lives | Failure mode if missing |
|---|---|---|---|
| 1 | `pgr.escalation.enabled=true` + `pgr.escalation.states=<comma states>` | `pgr-services` env (`PGR_ESCALATION_ENABLED`, `PGR_ESCALATION_STATES`) | Scheduler never runs, or scans states your workflow doesn't use |
| 2 | An `ESCALATE` action wired on each scanned state, role matching the scheduler's request | `egov-workflow-v2`'s `eg_wf_action_v2` (per tenant, per `BusinessService`) | `_transition` call rejected — "action not found" / role mismatch |
| 3 | The complaint has a **named assignee** at that state (not a role-pool state) | `eg_wf_assignee_v2` | Silently skipped — `getCurrentAssignees()` returns empty, nothing logged as an error |
| 4 | That assignee has `reportingTo` set on their **current** HRMS assignment | `eg_hrms_assignment.reportingto` | `WARN: No supervisor found for any assignee`, skipped |

There is a **fifth**, easy-to-miss one: the scheduler authenticates every transition as a
`SYSTEM` user whose UUID comes from `egov.internal.microservice.user.uuid`
(`EGOV_INTERNAL_MICROSERVICE_USER_UUID` env). The property's baked-in default
(`4fef6612-07a8-4751-97e9-0e0ac0687ebe`) is a **placeholder that does not exist** in any real
tenant's `egov-user` — every escalation attempt 400s with
`INVALID UUID: User not found for uuid: ...` until this is set to the tenant's actual
`INTERNAL_MICROSERVICE_ROLE` SYSTEM user (different per tenant/install — the script discovers
it live, see step 4 below).

### SLA / level semantics

`RAINMAKER-PGR.EscalationConfig` (MDMS, module `RAINMAKER-PGR`) controls timing, independent
of the workflow config above:
```json
{ "maxDepth": 3, "defaultSlaByLevel": [3600000, 14400000, 86400000], "overrides": {} }
```
- `defaultSlaByLevel[i]` = how long the complaint must sit **since its last escalation**
  before hop `i+1` fires (here: 1h before hop 1, 4h before hop 2, 24h before hop 3).
- `maxDepth` = hard ceiling on hops per complaint, regardless of SLA.
- `overrides.<serviceCode>` = a different SLA array for a specific complaint type.
- The workflow's own `state.sla` / `businessServiceSla` columns are **not** read by this
  feature at all — don't bother setting them for escalation's sake, they drive something else.
- **Self-loop design**: this setup wires `ESCALATE` as `currentState == nextState` (assignee
  changes, `applicationStatus` doesn't). That one action definition covers every level
  automatically, since the complaint stays in the scanned state after each hop — no
  per-level or per-"seniority" config needed. The trade-off: nothing visible to a citizen
  changes on escalation; if you want that, you need a different (state-per-level) design —
  out of scope for this script.

---

## 2. Run it

```bash
cd local-setup/scripts
PGR_SERVICES_IMAGE=<your pushed image tag> \
EMPLOYEE_UUID=<assignee uuid to link>  SUPERVISOR_UUID=<their new supervisor uuid> \
TENANT=mz \
./enable-escalation.sh
```

`PGR_SERVICES_IMAGE`, `EMPLOYEE_UUID`, `SUPERVISOR_UUID` have **no default** — this script
never builds an image (bring your own, already pushed) and never guesses your org chart.
Everything else is a tunable env var with a sane default; see the CONFIG block at the top of
the script for the full list (`BUSINESS_SERVICE`, `ESCALATE_STATE`, `ESCALATE_ROLE`,
`PGR_ESCALATION_STATES`, `DB_CONTAINER`, …).

**See what it would do first**: prefix with `DRY_RUN=true` — every step prints the exact
command/API call/SQL it would run without touching anything.

### The six steps

| Step | Does | Idempotent? |
|---|---|---|
| `workflow-action` | Adds `ESCALATE` (self-loop, role `ESCALATE_ROLE`) to `ESCALATE_STATE` on `BUSINESS_SERVICE` for `TENANT` | Yes — checks for an existing `ESCALATE` action on that state first, skips if present |
| `mdms-check` | Reports whether `RAINMAKER-PGR.EscalationConfig` exists for `TENANT`; seeds it (schema+data, `MAX_DEPTH`/`SLA_BY_LEVEL`) only if `ESCALATION_SEED=true` | Yes — read-only unless seeding, and seeding checks first too |
| `hrms-link` | Sets `EMPLOYEE_UUID`'s current HRMS assignment `reportingTo = SUPERVISOR_UUID` | Yes — plain `UPDATE`, safe to rerun with the same values |
| `lookup-system-user` | Read-only: finds the tenant's real `INTERNAL_MICROSERVICE_ROLE` SYSTEM user uuid | Always (read-only) |
| `deploy` | Sets `PGR_SERVICES_IMAGE` (`.env`) + `PGR_ESCALATION_STATES` / `EGOV_INTERNAL_MICROSERVICE_USER_UUID` (compose file), recreates `pgr-services` (`--no-deps`), waits for healthy | Yes — replaces existing lines in place, never appends duplicates |
| `verify` | Polls `pgr-services` logs for the latest `Escalation scan complete` line | Read-only |

Run just one:
```bash
TENANT=mz ./enable-escalation.sh --only workflow-action
TENANT=mz ESCALATION_SEED=true ./enable-escalation.sh --only mdms-check
EMPLOYEE_UUID=... SUPERVISOR_UUID=... ./enable-escalation.sh --only hrms-link
./enable-escalation.sh --only lookup-system-user
PGR_SERVICES_IMAGE=... ./enable-escalation.sh --only deploy
./enable-escalation.sh --only verify
```
Or a range: `--from deploy` (deploy + verify), `--to hrms-link` (the first three).

### Worked example (tenant `mz`, live run)
```
==> [workflow-action] Add ESCALATE (INVESTIGATION self-loop, role SYSTEM) to PGR / mz
   [ OK ] ESCALATE already present on INVESTIGATION — nothing to do
==> [mdms-check] Check RAINMAKER-PGR.EscalationConfig for mz
   [ OK ] EscalationConfig already present for mz (1 row(s))
==> [hrms-link] Link EMPLOYEE_UUID -> SUPERVISOR_UUID in HRMS reportingTo
   [ OK ] verified: eca6a910-... now reports to 97430b68-...
==> [lookup-system-user] Discover INTERNAL_MICROSERVICE_ROLE user uuid for mz
   [ OK ] INTERNAL_MICROSERVICE_ROLE uuid for mz: a3efc86f-93e7-43b9-9361-8dd77c94423d
==> [deploy] Deploy pgr-services with escalation config
   [ OK ] digit-pgr-services-1 is healthy
==> [verify] Check pgr-services logs for the latest escalation scan
   [ OK ] Escalation scan complete: scanned=8, escalated=6, skipped=2
```
The 2 skipped there are real complaints whose case managers had no `reportingTo` set yet —
exactly item 4 in the table above, not a bug.

---

## 3. Troubleshooting

**`INVALID UUID: User not found for uuid: 4fef6612-...`** — the property default (item 5
above). Fix: `./enable-escalation.sh --only deploy` (it self-resolves the real UUID via
`lookup-system-user` when `SYSTEM_USER_UUID` is unset).

**`NullPointerException: ... "responeMap" is null` from `egov-workflow-v2`** — usually not a
workflow-v2 bug in itself; it's `UserService.parseResponse` choking because `egov-user` 502'd
underneath the proxy. Check `docker ps -a` for `digit-egov-user-1` sitting in `Created` (never
started) — a leftover from a `docker compose up` that aborted on an unrelated one-shot
migration container before reaching it. `docker start digit-egov-user-1` fixes it. The
`egov-user-proxy` container reporting "healthy" does **not** mean the backend behind it is up —
its healthcheck only checks nginx itself.

**`db-migrations` / `db-history-normalize` "didn't complete successfully: exit 1"` aborts a
plain `docker compose up -d <service>`** — those one-shot containers aren't idempotent for a
second run. Either include the full compose overlay set the original deploy used
(`fast-path.yml migrations.yml monitoring.yml bomet.yml`), or scope the `up` with `--no-deps`
(what `deploy` does) so dependent one-shots are never re-triggered for a config-only change.

**A step's own postcondition check fails right after a real write succeeds** (e.g.
`workflow-action` reports "ESCALATE action not found after update" but the DB shows it exists
moments later) — `egov-workflow-v2` persists business-service writes asynchronously; the API
response lands before the DB write is visible. Both `workflow-action` and `verify` poll with a
short retry for this reason — if you hit it anyway, the fix is to wait and re-check, not to
assume the write failed.

**Complaints keep getting skipped forever, not escalated** — check which of the four
preconditions in §1 is missing for that specific complaint: no assignee (common for
role-pool states like `PENDINGFORASSIGNMENT`), no `reportingTo` on the assignee, no
`ESCALATE` action on that state, or `escalationLevel >= maxDepth` already.

---

## 4. Design notes / known gaps

- **Adding a new state to the chain** needs *two* changes together, not one:
  `ESCALATE_STATE=<state>` on `workflow-action` (wires the transition) **and**
  `PGR_ESCALATION_STATES` including that state (so the scheduler actually scans it). Adding
  either alone leaves it half-configured — looks done, does nothing.
- **Multi-hop escalation** (level 1→2→3) only continues if the state an escalation lands in is
  itself in `PGR_ESCALATION_STATES` *and* the new assignee also has `reportingTo` set. With the
  self-loop design this is automatic for hops within the same state; it stops the moment either
  condition breaks, silently (a `WARN` log, not an error).
- **This is a local-machine `/opt/digit` runbook, not a cloud-VM one.** A fresh
  `./deploy.sh <tenant>` (see `local-setup/ansible/`) overwrites the compose file from this
  repo's checked-in `docker-compose.egov-digit.yaml`, which does not yet carry
  `PGR_ESCALATION_STATES` / the `EGOV_INTERNAL_MICROSERVICE_USER_UUID` fix. Until that's added
  to the canonical file (and a real `pgr-services` image with the `pgr.escalation.states`
  support is built and pushed by CI), re-running this script is what makes it work on this box,
  but a fresh cloud deploy would need those source changes first.
