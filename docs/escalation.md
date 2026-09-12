# PGR automatic escalation

## Configuration

The scheduler reads the first state-tenant MDMS record at
`RAINMAKER-PGR.EscalationConfig`:

```json
{
  "maxDepth": 3,
  "defaultSlaByLevel": [3600000, 14400000, 86400000],
  "overrides": { "serviceCode": [1800000, 7200000, 43200000] }
}
```

The schema is
[`utilities/default-data-handler/.../schema/RAINMAKER-PGR.json`](../utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json).
Checked-in data exists in the
[`ansible/nairobi-mdms` seed](../ansible/nairobi-mdms/mdms/RAINMAKER-PGR/EscalationConfig.json)
and a
[`default-data-handler` development fixture](../utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.EscalationConfig.json),
but there is no generic live seed for a new tenant. The similarly named
`Workflow.AutoEscalation` master belongs to `im-services` terminal-state closure
and is unrelated.

For escalation level `n`, it uses `overrides[serviceCode][n]`, then
`defaultSlaByLevel[n]`; the last array value repeats. A hierarchy leaf's `code`
is the complaint `serviceCode`, so overrides work with any complaint-hierarchy
depth. There is no parent inheritance, and `ComplaintHierarchy.slaHours` is not
read by escalation.

`pgr-services` reads MDMS through `egov.mdms.host` and
`egov.mdms.search.endpoint` (the MDMS v1-compatible search API). Spring maps
these service properties to environment variables:

| Environment variable | Service property | Default / use |
|---|---|---|
| `PGR_ESCALATION_ENABLED` | `pgr.escalation.enabled` | `true`; master scheduler switch |
| `PGR_ESCALATION_INTERVAL_MS` | `pgr.escalation.interval.ms` | `300000`; scan interval |
| `PGR_ESCALATION_BATCH_SIZE` | `pgr.escalation.batch.size` | `100`; maximum rows per status |
| `PGR_ESCALATION_DEFAULT_SLA_MS` | `pgr.escalation.default.sla.ms` | `432000000`; fallback when MDMS is absent |
| `PGR_ESCALATION_MAX_DEPTH` | `pgr.escalation.max.depth` | `3`; fallback and service-side cap |
| `PGR_ESCALATION_KAFKA_TOPIC` | `pgr.escalation.kafka.topic` | `pgr-escalation-events` |

Defaults are in
[`application.properties`](../backend/pgr-services/src/main/resources/application.properties).
The checked-in `local-setup` Compose/Kubernetes manifests explicitly set only
`PGR_ESCALATION_ENABLED`; the other values use these defaults unless a
deployment injects them. The checked-in urban Helm chart does not expose any
`PGR_ESCALATION_*` value.

Three other environment settings are easy to confuse:

- `EGOV_UI_APP_HOST_MAP` (`egov.ui.app.host.map`): its **first key** is what the
  scheduler uses as the complaint-scan tenant and, after state-level
  normalization, the MDMS tenant.
- `EGOV_STATE_LEVEL_TENANT_ID` (`egov.state.level.tenant.id`): used here only as
  the synthetic `SYSTEM` role's tenant.
- `PGR_STATELEVEL_TENANTID` (`pgr.statelevel.tenantid`): used by migration code,
  not by `EscalationScheduler`.

## Logic

1. Scan `PENDINGATLME` and `PENDINGFORASSIGNMENT` complaints.
2. Skip complaints with no current workflow assignee or at `maxDepth`.
3. Compare the level SLA with `now - auditDetails.lastModifiedTime` (falling
   back to `createdTime`).
4. Read each current assignee's HRMS `reportingTo`; use the first match.
5. Reassign the complaint upward by submitting `ESCALATE` as a workflow
   self-loop: keep the same state, make that `reportingTo` employee the assignee,
   increment `additionalDetails.escalationLevel`, and publish the update/event.

In this automatic path, **submitting `ESCALATE` means reassigning the complaint
to the next higher employee**. It is not a state transition. No `reportingTo`
means no escalation. Neither a literal `SUPERVISOR` role nor a
`PENDINGATSUPERVISOR` state participates in this logic.

## Current gaps

- The clock is general complaint `lastModifiedTime`, not assignment time. Any
  update restarts it, while auto-escalation writes `lastEscalatedAt` but neither
  updates `lastModifiedTime` nor reads `lastEscalatedAt`; later SLAs are therefore
  cumulative from the last ordinary update.
- Checked-in workflow seeds retain the older state-transition model
  (`FORWARD`/`PENDINGATSUPERVISOR`) and do not consistently provide the required
  `ESCALATE` self-loop for both scanned states.
- The MDMS schema advertises `enabledByLevel` and structured override objects;
  runtime ignores the former and only accepts override arrays.
- MDMS `maxDepth` is also capped by the service-property maximum, and a missing
  MDMS record silently falls back to the service-wide SLA.
- The scan covers one state tenant and one unpaginated batch per status; inbox
  visibility and permitted actions for a newly assigned employee are separate
  configuration concerns.
