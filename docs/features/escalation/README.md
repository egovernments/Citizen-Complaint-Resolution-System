# PGR escalation

PGR has one escalation flow. Manual and automatic `ESCALATE` both submit the
same workflow self-loop: the complaint stays in its current state and is
reassigned to the current assignee's HRMS `reportingTo`. The service increments
the same `additionalDetails.escalationLevel` metadata for both triggers. No
assignee or no `reportingTo` means no escalation; neither a `SUPERVISOR` role nor
a `PENDINGATSUPERVISOR` state participates. The canonical workflow exposes the
self-loop only on assigned `PENDINGATLME`, not on unassigned queue states.

Manual `ESCALATE` is authorized for `PGR_LME` and `PGR_VIEWER`; the scheduler
acts as `SYSTEM`. `GRO` is deliberately not on the transition, nor on any other
`PENDINGATLME` action: escalation walks the resolver's own `reportingTo` chain,
and the grievance officer's job ends when the complaint is assigned. A `GRO`
who is also an escalation target must hold `PGR_LME` to act on the complaint at
all.

The policy is the singleton `code: DEFAULT` record in MDMS v2
`RAINMAKER-PGR.EscalationConfig`. Resolution is complete city record, then
complete state record, then service defaults. `eligibleStatuses` controls which
states automation scans; the shipped value is the assigned resolver state
`PENDINGATLME`. Every configured state still requires a concrete workflow
assignee. Percentage ladders are cumulative from complaint creation and use the exact leaf
`ComplaintHierarchy.slaHours`; finite absolute-millisecond ladders are the
fallback. Manual escalation consumes a rung, so automation next evaluates the
following cumulative threshold. `ASSIGN`, `REASSIGN` and `REOPEN` do not reset
the clock or the escalation level; a reopened complaint keeps the rungs it has
already consumed.

## Per-complaint-type overrides

`overrides` is keyed by the exact leaf `ComplaintHierarchy.code` (the
complaint's `serviceCode`). Only these keys can be set per complaint type:

| Key | Per type | Meaning |
|---|---|---|
| `slaPercentageByLevel` | yes | Cumulative percentages of the type's `slaHours`. Strictly increasing, at most 200. |
| `slaByLevel` | yes | Cumulative milliseconds from creation. Strictly increasing. |
| `enabledByLevel` | yes | Turns individual levels on or off. |
| `maxDepth` | no | Global only. A type escalates at most `min(maxDepth, length of its ladder)` times. |
| `eligibleStatuses` | no | Global only. |
| `defaultSlaPercentageByLevel`, `defaultSlaByLevel` | no | The global ladders. Use `slaPercentageByLevel` / `slaByLevel` inside an override. |

A bare list (`"TYPE": [60000, 120000]`) is shorthand for `slaByLevel`. The MDMS
schema rejects any other key inside an override object.

The ladder for a complaint type is chosen in this order. The type's override
beats the global default, and at each level percentages beat milliseconds.
Percentage ladders apply only when the type has `slaHours`.

1. type `slaPercentageByLevel`
2. type `slaByLevel`
3. global `defaultSlaPercentageByLevel`
4. global `defaultSlaByLevel`

```json
{
  "code": "DEFAULT",
  "maxDepth": 3,
  "eligibleStatuses": ["PENDINGATLME"],
  "defaultSlaPercentageByLevel": [80, 120, 200],
  "defaultSlaByLevel": [3600000, 14400000, 86400000],
  "overrides": {
    "WATER_LEAK": { "slaPercentageByLevel": [50, 100], "enabledByLevel": [true, true] },
    "STREETLIGHT": { "slaByLevel": [1800000, 3600000] }
  }
}
```

With `slaHours: 4`, `WATER_LEAK` escalates 2 h and 4 h after creation and then
stops (two-entry ladder). `STREETLIGHT` escalates at 30 min and 60 min whatever
its `slaHours`. Every other type uses 80/120/200% of its own `slaHours`.

Runtime fallbacks and scheduling are configured with `PGR_ESCALATION_*`; the
state root used for tenant discovery is `STATE_LEVEL_TENANT_ID`. For configuration
locations, migration prerequisites, and validation steps, see
[the self-loop rollout guide](../../operations/data-migration/pgr-escalation-self-loop.md).
