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

## Escalating from additional statuses

Listing a status in `eligibleStatuses` only makes the scheduler scan it.
Escalating is a workflow `ESCALATE` transition, and the shipped PGR
BusinessService has that action on `PENDINGATLME` only. Complaints in any other
listed status fail every scan with `INVALID ACTION: Action ESCALATE not found in
config`, and Take Action never offers Escalate. pgr-services does not change the
workflow; an implementer who needs another status makes the change below.

Escalation goes to the current assignee's `reportingTo`, so the state must keep
a named assignee. `PENDINGFORREASSIGNMENT` has one when the resolver's
`REASSIGN` names a grievance officer. `PENDINGFORASSIGNMENT` straight after
filing never does.

**1. Check the state.** This read-only query lists every `ESCALATE` on the
target state, including inactive ones, which `_search` hides. Expect no rows.

```sql
SELECT a.uuid, a.active, a.roles, ns.state AS next_state
  FROM eg_wf_action_v2 a
  JOIN eg_wf_state_v2 s  ON s.uuid  = a.currentstate
  JOIN eg_wf_state_v2 ns ON ns.uuid = a.nextstate
  JOIN eg_wf_businessservice_v2 b ON b.uuid = s.businessserviceid
 WHERE b.businessservice = 'PGR' AND b.tenantid = '<state root, e.g. ke>'
   AND s.state = 'PENDINGFORREASSIGNMENT' AND a.action = 'ESCALATE';
```

**2. Add an `ESCALATE` self-loop.** Search the live graph at the state root, not
a city, immediately before writing. Then post back the BusinessService exactly
as returned, cut down to the one state, carrying only the new action. The action
has the same shape as the seeded `ESCALATE` on `PENDINGATLME`:
`nextState` is the state's own `uuid`, and the roles are the employee roles that
already act on the state plus `SYSTEM` for the scheduler. Use `["SYSTEM"]` for
automatic escalation only.

```bash
HOST=https://<gateway> TENANT=ke STATE=PENDINGFORREASSIGNMENT TOKEN=<admin auth token>
curl -s -X POST "$HOST/egov-workflow-v2/egov-wf/businessservice/_search?tenantId=$TENANT&businessServices=PGR" \
  -H 'Content-Type: application/json' -d "{\"RequestInfo\":{\"authToken\":\"$TOKEN\"}}" > pgr-bs.json

jq --arg st "$STATE" --arg tok "$TOKEN" '
  {RequestInfo: {authToken: $tok},
   BusinessServices: [.BusinessServices[0]
     | .states |= map(select(.applicationStatus == $st)
         | .actions = [{action: "ESCALATE", nextState: .uuid,
                        roles: ["GRO", "PGR_VIEWER", "SYSTEM"], active: true}])]}' \
  pgr-bs.json > escalate-update.json

curl -s -X POST "$HOST/egov-workflow-v2/egov-wf/businessservice/_update" \
  -H 'Content-Type: application/json' -d @escalate-update.json
```

The persister upserts every state and action sent, column by column, and never
deletes: what is left out stays as it is, and what is sent is written back from
your copy. Hence one state, one action, and every other field as searched.

**3. Restart egov-workflow-v2.** It caches the BusinessService in JVM memory.
`_update` clears the cache only on the replica that served it, and before the
asynchronous persister writes, so a search in that gap caches the old graph
again. Once the step 1 query returns the new row, restart every
egov-workflow-v2 replica. pgr-services needs no restart.

**4. Turn on automatic escalation.** Add the status to `eligibleStatuses` in
the `EscalationConfig` record that applies to the city. Manual escalation works
after step 3; automatic escalation needs both.

**Verify.** A `_search` at the state root and at one city shows exactly one
`ESCALATE` on the state: `active`, `nextState` equal to the state's `uuid`,
roles including `SYSTEM`. On a complaint in that state with a named assignee,
the assignee sees Escalate in Take Action, and it lands on their `reportingTo`
without changing state. Once due, the scheduler records an `ESCALATE` by the
internal `SYSTEM` user, `escalationLevel` increases, and pgr-services logs no
`INVALID ACTION` for the complaint.

**Roll back.** Remove the status from `eligibleStatuses`; automatic escalation
stops at the next scan. Then re-run the step 2 search, post the body below to
`_update`, and restart egov-workflow-v2 again. workflow-v2 has no delete, so the
inactive row stays.

```bash
jq --arg st "$STATE" --arg tok "$TOKEN" '
  {RequestInfo: {authToken: $tok},
   BusinessServices: [.BusinessServices[0]
     | .states |= map(select(.applicationStatus == $st)
         | .actions |= map(select(.action == "ESCALATE") | .active = false))]}' \
  pgr-bs.json > escalate-rollback.json
```

**Pitfalls**

- Don't post a stale or whole graph. Every action in the request overwrites the
  live row, so a copy taken before someone else's edit reverts that edit.
- Keep one `ESCALATE` per state, and always a self-loop. Don't add `SYSTEM` to,
  or reactivate, an inactive or legacy `ESCALATE` such as one pointing at
  `PENDINGATSUPERVISOR`: that revives the transition the
  [self-loop migration](../../operations/data-migration/pgr-escalation-self-loop.md)
  retired. Deactivate the old action and add a fresh self-loop.
- Don't copy citizen roles. `COMMENT`, `REOPEN` and `RATE` carry `CITIZEN`,
  `CFC` or `CSR`; take roles only from the employee actions on the state.
- The change is state-wide. The PGR workflow lives at the state root, so every
  city under it gets the action, even when only one city's `EscalationConfig`
  lists the status.
- If several states share the `applicationStatus`, each needs the self-loop;
  the scheduler scans by status.
