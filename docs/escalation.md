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

For escalation level `n`, it uses `overrides[serviceCode][n]`, then
`defaultSlaByLevel[n]`; the last array value repeats. A hierarchy leaf's `code`
is the complaint `serviceCode`, so overrides work with any complaint-hierarchy
depth. There is no parent inheritance, and `ComplaintHierarchy.slaHours` is not
read by escalation.

Service properties enable the scheduler and set its interval, batch size,
fallback SLA, fallback maximum depth, and Kafka topic (`pgr.escalation.*`).

## Logic

1. Scan `PENDINGATLME` and `PENDINGFORASSIGNMENT` complaints.
2. Skip complaints with no current workflow assignee or at `maxDepth`.
3. Compare the level SLA with `now - auditDetails.lastModifiedTime` (falling
   back to `createdTime`).
4. Read each current assignee's HRMS `reportingTo`; use the first match.
5. Submit `ESCALATE` as a workflow self-loop with that employee as assignee,
   increment `additionalDetails.escalationLevel`, and publish the update/event.

No `reportingTo` means no escalation. Neither a literal `SUPERVISOR` role nor a
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
