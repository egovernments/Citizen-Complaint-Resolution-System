# PGR escalation self-loop rollout

This rollout implements #2048. It must be performed per supported state-level tenant; changing repository seeds does not rewrite an already-provisioned workflow.

## Target contract

- Configuration: the singleton `code: DEFAULT` record in MDMS v2 `RAINMAKER-PGR.EscalationConfig`, resolved as complete city record → complete state record → service defaults. Any sole record is accepted with a warning when its code is not `DEFAULT`; ambiguous records are ignored with an error log.
- Eligible automatic-escalation states come from `EscalationConfig.eligibleStatuses`; the shipped value is the assigned resolver state (`PENDINGATLME`). A tenant may add another state only when its workflow keeps a concrete assignee there and exposes an `ESCALATE` self-loop to `SYSTEM`.
- `ESCALATE` is a self-loop. The backend resolves the current workflow assignee's HRMS `reportingTo`; callers do not choose the target.
- No assignee, no `reportingTo`, disabled level, or `maxDepth` reached means no automatic escalation. Manual requests receive an explicit error.
- Both triggers enter `PGRService.update` and write `escalationLevel`, `lastEscalatedAt`, `assignmentChangedAt`, `escalatedFrom`, `escalatedTo`, and `escalationTrigger`.
- Automatic thresholds are cumulative from `auditDetails.createdTime`; updates and reassignments do not reset this clock. `REOPEN` starts a fresh cycle in `additionalDetails.escalationWindowStartedAt` and resets `escalationLevel` to zero.
- `auditDetails.lastModifiedTime` is not an SLA clock: every accepted complaint `_update` regenerates it, including `COMMENT`, `ASSIGN`, `REASSIGN`, `ESCALATE`, `RESOLVE`, `REJECT`, `REOPEN`, `RATE`, and edits to complaint fields, documents, or contact details. Using it postpones escalation whenever unrelated work touches the complaint.
- `createdTime` and `now` are epoch milliseconds, so elapsed-time triggering is UTC/time-zone independent; tenant time zones affect display and reporting, not the threshold calculation.
- `defaultSlaPercentageByLevel` is applied to the complaint type's existing `ComplaintHierarchy.slaHours`. Shipped `[80,120,200]` means a 10-hour complaint escalates at hours 8, 12, and 20—not after 8+12+20 hours. Percentages must increase and are capped at 200.
- `defaultSlaByLevel` remains the strictly increasing absolute-millisecond fallback when no valid percentage ladder or no `slaHours` exists. It is not a second complaint-type SLA, and its last entry is final just like the percentage ladder. Existing interval-style or repeated arrays must be converted to explicit cumulative thresholds before rollout.
- Manual escalation increments `escalationLevel`, so automatic escalation waits for the next cumulative threshold. `ASSIGN` and `REASSIGN` update assignment audit metadata but preserve `escalationLevel`.

`EscalationConfig.overrides` keys are exact leaf `ComplaintHierarchy.code` / complaint `serviceCode` values. Hierarchy depth does not affect lookup, and parent-category inheritance is not supported.

## Configuration ownership

The policy uses one MDMS v2 master, `RAINMAKER-PGR.EscalationConfig`. Its schema is in `utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json`. The base complaint SLA remains `RAINMAKER-PGR.ComplaintHierarchy.slaHours`. A complete city escalation record overrides the complete state record; fields are not merged. The state record is the shared baseline. Service defaults apply only when neither level returns a record. The checked-in development example is under `utilities/default-data-handler/src/main/resources/mdmsData-dev/`; Nairobi's deployable record is under `ansible/nairobi-mdms/mdms/`; local `full-dump.sql` contains the `pg` default. The Configurator rejects PGR writes through the competing generic `Workflow.AutoEscalation*` screens. Existing PGR rows in those generic masters must be disabled manually before rollout; pgr-services does not migrate the MDMS database. Runtime fails closed with `PGR_ESCALATION_CONFIG_CONFLICT` if an active competing PGR row remains; generic workflow escalation remains available to non-PGR products.

If the record is absent or unreadable, pgr-services falls back to `PGR_ESCALATION_ELIGIBLE_STATUSES` / `pgr.escalation.eligible.statuses` (`PENDINGATLME`), `PGR_ESCALATION_DEFAULT_SLA_MS` / `pgr.escalation.default.sla.ms` (432000000 ms per rung, expanded cumulatively up to the fallback depth), and `PGR_ESCALATION_MAX_DEPTH` / `pgr.escalation.max.depth` (3). `PGR_ESCALATION_ENABLED` / `pgr.escalation.enabled` defaults to `false`; enable it only after preflight. It and `PGR_ESCALATION_INTERVAL_MS` / `pgr.escalation.interval.ms` control only the automatic scheduler; disabling it does not disable manual `ESCALATE`. `PGR_ESCALATION_BATCH_SIZE` / `pgr.escalation.batch.size` is the scheduler page size, not a total-run cap. `PGR_ESCALATION_LOCK_POOL_SIZE` (default 4) and `PGR_ESCALATION_LOCK_CONNECTION_TIMEOUT_MS` (default 30000) bound a private PostgreSQL advisory-lock pool. Locks have no TTL: they cover the whole update, cannot expire mid-call, and PostgreSQL releases them if the process or connection dies. `STATE_LEVEL_TENANT_ID` / `state.level.tenant.id` selects the state root used for tenant discovery. Every configured eligible state must expose an active `ESCALATE` self-loop authorizing `SYSTEM`.

## Preflight

For every tenant:

1. Disable `PGR_ESCALATION_ENABLED`.
2. Disable active PGR records in `Workflow.AutoEscalation` and `Workflow.AutoEscalationStatesToIgnore` through MDMS administration.
3. Fetch the live `PGR` BusinessService. Do not infer it from repository seeds, and count complaints in `PENDINGATSUPERVISOR` and `RESOLVEDBYSUPERVISOR`.
4. Verify every currently assigned employee and each intended escalation target has a valid current HRMS assignment, an acyclic `reportingTo` chain, jurisdiction, and PGR access.
5. Verify the effective city → state `EscalationConfig` resolution, confirm every `eligibleStatuses` value has an active `ESCALATE` self-loop, and confirm every override key is a live leaf service code.
6. Convert legacy per-level duration arrays to strictly increasing cumulative complaint-age thresholds; repeated/decreasing ladders are rejected and fall back to the next valid policy.

Do not remove a legacy state while an active complaint still occupies it.

## Data and workflow migration

1. Move each active `PENDINGATSUPERVISOR` complaint to its last working state, normally `PENDINGATLME`, preserving its current assignee and process history. Send exceptions to an owned recovery queue.
2. Normalize current `RESOLVEDBYSUPERVISOR` complaints to `RESOLVED` where reporting requires one terminal vocabulary. Never rewrite historical process instances.
3. Install the canonical BusinessService from one of the three aligned sources:
   - `utilities/default-data-handler/src/main/resources/PgrWorkflowConfig.json`
   - `utilities/crs_dataloader/templates/PgrWorkflowConfig.json`
   - `local-setup/dataloader/templates/PgrWorkflowConfig.json`
4. Confirm the `PENDINGATLME` `ESCALATE` action points to its own current-state UUID and authorizes `SYSTEM`.
5. Confirm `FORWARD`, `ASSIGNEDBYAUTOESCALATION`, `RESOLVEBYSUPERVISOR`, `PENDINGATSUPERVISOR`, and `RESOLVEDBYSUPERVISOR` are absent from the active BusinessService.

Keep legacy localization strings so historical timelines remain readable.
Keep the global `SUPERVISOR` and `AUTO_ESCALATE` role definitions and defensive non-notifiable-audience handling: they are shared access-control vocabulary. The active PGR workflow no longer grants either role an escalation action; the scheduler acts as `SYSTEM`. Canonical `PENDINGATLME` actions also authorize `GRO`, so a typical `reportingTo` target can act on the complaint without acquiring a literal supervisor role.

## Deploy and validate

Deploy the backend and UI before re-enabling the scheduler. Then verify:

1. `A --manual ESCALATE--> B --automatic ESCALATE--> C` stays in the same state and ends at level 2.
2. Both hops follow actual HRMS `reportingTo` edges; a manual first hop consumes level 1, so automation next evaluates level 2's cumulative threshold.
3. Comments, assignment, reassignment, and escalation do not move the `createdTime`-based threshold clock. Reassignment preserves `escalationLevel`.
4. An arbitrary manual target is rejected as `INVALID_ESCALATION_ASSIGNEE`; use `REASSIGN` for lateral routing.
5. Unassigned complaints—including canonical `PENDINGFORASSIGNMENT` and `PENDINGFORREASSIGNMENT` complaints—are skipped before the update pipeline. Reassignment therefore pauses automatic escalation until the complaint is assigned again. A tenant workflow may opt a state in only if it preserves an assignee there. Top-of-chain complaints remain unchanged with an observable reason.
6. A 10-hour complaint with `[80,120,200]` escalates at complaint ages 8h, 12h, and 20h, then stops; absolute fallback and exact leaf-service-code overrides behave identically for manual and automatic triggers.
7. Update, inbox, domain/notification, analytics, and `pgr-escalation-events` consumers receive the same escalation event shape, differing only by `escalationTrigger`.
8. A city with its own complete `EscalationConfig` uses that policy; a city without one uses the state policy.
9. Concurrent scheduler/manual attempts return `ESCALATION_IN_PROGRESS`; a dedicated-pool PostgreSQL advisory lock covers the complete update, releases in `finally`, and is released by PostgreSQL on connection/process failure. History/metadata reconciliation checks the next rung on a later attempt.
10. `REOPEN` resets the level and begins a fresh cumulative clock; earlier workflow `ESCALATE` events do not consume rungs in the new cycle.

Re-enable `PGR_ESCALATION_ENABLED` only after these checks pass. `PGR_ESCALATION_BATCH_SIZE` is a page size; one scheduler run continues through all pages rather than stopping after the first batch.

`ESCALATE` is not an idempotent workflow command. A caller that loses the response must not blindly retry: the next successful call intentionally advances to the next reporting rung. Durable retry safety requires a caller-supplied idempotency key in the API contract. Analytics classifies an escalation with a missing actor record as `unknown`, not `auto`; keep the configured internal microservice user present as a `SYSTEM` user to retain exact source attribution.

Contact sync deliberately runs after complaint validation but before the workflow call. This avoids committing a complaint transition with stale contact data, but a later workflow failure can leave the user contact updated while the complaint is unchanged; retry or reconcile that contact update operationally.
