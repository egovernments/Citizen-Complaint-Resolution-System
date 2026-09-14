# PGR escalation self-loop rollout

This rollout implements #2048. It must be performed per supported state-level tenant; changing repository seeds does not rewrite an already-provisioned workflow.

## Target contract

- Configuration: `RAINMAKER-PGR.EscalationConfig` in MDMS v2, resolved as city record → state record → service defaults.
- Eligible automatic-escalation states come from `EscalationConfig.eligibleStatuses`; the shipped value is `PENDINGATLME` and `PENDINGFORASSIGNMENT`.
- `ESCALATE` is a self-loop. The backend resolves the current workflow assignee's HRMS `reportingTo`; callers do not choose the target.
- No assignee, no `reportingTo`, disabled level, or `maxDepth` reached means no automatic escalation. Manual requests receive an explicit error.
- Both triggers enter `PGRService.update` and write `escalationLevel`, `lastEscalatedAt`, `assignmentChangedAt`, `escalatedFrom`, `escalatedTo`, and `escalationTrigger`.
- `assignmentChangedAt` is the SLA clock. `auditDetails.lastModifiedTime` is only a fallback for records created before this field existed.
- Ordinary `ASSIGN` and `REASSIGN` start a new assignment window and reset `escalationLevel` to zero.

`EscalationConfig.overrides` keys are exact leaf `ComplaintHierarchy.code` / complaint `serviceCode` values. Hierarchy depth does not affect lookup, and parent-category inheritance is not supported.

## Configuration ownership

The policy uses one MDMS v2 master, `RAINMAKER-PGR.EscalationConfig`. Its schema is in `utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json`. A complete city record overrides the complete state record; fields are not merged between levels. The state record is the shared baseline. Service defaults apply only when neither level returns a record. The checked-in development example is under `utilities/default-data-handler/src/main/resources/mdmsData-dev/`; it is not a live deployment seed, and the local `full-dump.sql` contains no record.

If the record is absent or unreadable, pgr-services falls back to `PGR_ESCALATION_ELIGIBLE_STATUSES` / `pgr.escalation.eligible.statuses` (`PENDINGATLME,PENDINGFORASSIGNMENT`), `PGR_ESCALATION_DEFAULT_SLA_MS` / `pgr.escalation.default.sla.ms` (432000000 ms), and `PGR_ESCALATION_MAX_DEPTH` / `pgr.escalation.max.depth` (3). `PGR_ESCALATION_ENABLED` / `pgr.escalation.enabled` and `PGR_ESCALATION_INTERVAL_MS` / `pgr.escalation.interval.ms` control only the automatic scheduler; disabling it does not disable manual `ESCALATE`. `PGR_ESCALATION_BATCH_SIZE` / `pgr.escalation.batch.size` is the scheduler page size, not a total-run cap. Every configured eligible state must expose an active `ESCALATE` self-loop authorizing `SYSTEM`. Local Compose and local Kubernetes currently set only `PGR_ESCALATION_ENABLED=true`; the remaining values come from `backend/pgr-services/src/main/resources/application.properties` unless an environment overrides them.

## Preflight

For every tenant:

1. Disable `PGR_ESCALATION_ENABLED`.
2. Fetch the live `PGR` BusinessService. Do not infer it from repository seeds.
3. Count complaints in `PENDINGATSUPERVISOR` and `RESOLVEDBYSUPERVISOR`.
4. Verify every currently assigned employee and each intended escalation target has a valid current HRMS assignment, `reportingTo`, jurisdiction, and PGR access.
5. Verify the effective city → state `EscalationConfig` resolution, confirm every `eligibleStatuses` value has an active `ESCALATE` self-loop, and confirm every override key is a live leaf service code.

Do not remove a legacy state while an active complaint still occupies it.

## Data and workflow migration

1. Move each active `PENDINGATSUPERVISOR` complaint to its last working state, normally `PENDINGATLME`, preserving its current assignee and process history. Send exceptions to an owned recovery queue.
2. Normalize current `RESOLVEDBYSUPERVISOR` complaints to `RESOLVED` where reporting requires one terminal vocabulary. Never rewrite historical process instances.
3. Install the canonical BusinessService from one of the three aligned sources:
   - `utilities/default-data-handler/src/main/resources/PgrWorkflowConfig.json`
   - `utilities/crs_dataloader/templates/PgrWorkflowConfig.json`
   - `local-setup/dataloader/templates/PgrWorkflowConfig.json`
4. Confirm both `ESCALATE` actions point to their own current-state UUID and authorize `SYSTEM`.
5. Confirm `FORWARD`, `ASSIGNEDBYAUTOESCALATION`, `RESOLVEBYSUPERVISOR`, `PENDINGATSUPERVISOR`, and `RESOLVEDBYSUPERVISOR` are absent from the active BusinessService.

Keep legacy localization strings so historical timelines remain readable.
Keep the global `SUPERVISOR` and `AUTO_ESCALATE` role definitions and defensive non-notifiable-audience handling: they are shared access-control vocabulary. The active PGR workflow no longer grants either role an escalation action; the scheduler acts as `SYSTEM`.

## Deploy and validate

Deploy the backend and UI before re-enabling the scheduler. Then verify:

1. `A --manual ESCALATE--> B --automatic ESCALATE--> C` stays in the same state and ends at level 2.
2. Both hops follow actual HRMS `reportingTo` edges and start a new `assignmentChangedAt` window.
3. A comment between assignment and SLA expiry does not change `assignmentChangedAt` or delay escalation.
4. An arbitrary manual target is rejected as `INVALID_ESCALATION_ASSIGNEE`; use `REASSIGN` for lateral routing.
5. Unassigned and top-of-chain complaints remain unchanged with an observable reason.
6. Maximum depth and exact leaf-service-code overrides behave identically for manual and automatic triggers.
7. Update, inbox, domain/notification, analytics, and `pgr-escalation-events` consumers receive the same escalation event shape, differing only by `escalationTrigger`.
8. A city with its own complete `EscalationConfig` uses that policy; a city without one uses the state policy.

Re-enable `PGR_ESCALATION_ENABLED` only after these checks pass. `PGR_ESCALATION_BATCH_SIZE` is a page size; one scheduler run continues through all pages rather than stopping after the first batch.
