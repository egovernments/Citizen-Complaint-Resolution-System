# PGR escalation

PGR has one escalation flow. Manual and automatic `ESCALATE` both submit the
same workflow self-loop: the complaint stays in its current state and is
reassigned to the current assignee's HRMS `reportingTo`. The service increments
the same `additionalDetails.escalationLevel` metadata for both triggers. No
assignee or no `reportingTo` means no escalation; neither a `SUPERVISOR` role nor
a `PENDINGATSUPERVISOR` state participates. The canonical workflow exposes the
self-loop only on assigned `PENDINGATLME`, not on unassigned queue states.

Manual `ESCALATE` is authorized for `PGR_LME` and `PGR_VIEWER`; the scheduler
acts as `SYSTEM`. `GRO` is deliberately not on the transition: escalation walks
the resolver's own `reportingTo` chain, and the grievance officer already owns
`ASSIGN`/`REASSIGN` for moving work laterally. `GRO` keeps `RESOLVE` and
`REASSIGN` on `PENDINGATLME`. A `GRO` who is also the escalation target must
hold `PGR_LME` to escalate further up the chain.

The policy is the singleton `code: DEFAULT` record in MDMS v2
`RAINMAKER-PGR.EscalationConfig`. Resolution is complete city record, then
complete state record, then service defaults. `eligibleStatuses` controls which
states automation scans; the shipped value is the assigned resolver state
`PENDINGATLME`. Every configured state still requires a concrete workflow
assignee. Percentage ladders are cumulative from complaint creation (or the
latest `REOPEN`) and use the exact leaf
`ComplaintHierarchy.slaHours`; finite absolute-millisecond ladders are the
fallback. Manual escalation consumes a rung, so automation next evaluates the
following cumulative threshold. `ASSIGN` and `REASSIGN` do not reset the clock
or the escalation level. `REOPEN` resets both for a fresh complaint cycle.

Runtime fallbacks and scheduling are configured with `PGR_ESCALATION_*`; the
state root used for tenant discovery is `STATE_LEVEL_TENANT_ID`. For configuration
locations, migration prerequisites, and validation steps, see
[the self-loop rollout guide](migration/pgr-escalation-self-loop.md).
