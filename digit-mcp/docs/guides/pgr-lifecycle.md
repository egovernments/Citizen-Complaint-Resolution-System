# PGR Complaint Lifecycle

> Create, assign, resolve, and rate complaints — the complete PGR workflow from filing to closure.

## Prerequisites

- Authenticated via [`configure`](../api/tools/configure.md)
- Tool groups enabled: `pgr`, `employees`
- A city tenant with complaint types and employees set up (see [City Setup Guide](city-setup.md))

## The PGR Workflow

```
                    ┌──── REJECT ────► REJECTED
                    │
CITIZEN creates ──► PENDINGFORASSIGNMENT
                    │
                    └──── ASSIGN ────► PENDINGATLME
                                       │
                              ┌────────┴────────┐
                              │                 │
                           RESOLVE           (auto)
                              │                 │
                              ▼                 ▼
                           RESOLVED    PENDINGFORREASSIGNMENT
                              │                 │
                    ┌─────────┤              REASSIGN
                    │         │                 │
                  RATE     REOPEN               │
                    │         │                 ▼
                    ▼         └──► PENDINGFORASSIGNMENT
           CLOSEDAFTERRESOLUTION
```

> **Note:** The `(auto)` transition from PENDINGATLME to PENDINGFORREASSIGNMENT is triggered when the complaint's SLA timer expires without the LME resolving or rejecting it.

**Roles:**
- **Citizen** — Creates complaints, reopens resolved ones, rates closed ones
- **GRO (Grievance Routing Officer)** — Assigns complaints to LME, rejects invalid ones
- **PGR_LME (Last Mile Employee)** — Resolves complaints in the field

## Step 1: Search Existing Complaints

Call [`pgr_search`](../api/tools/pgr_search.md):
```json
{ "tenant_id": "pg.citya" }
```

Filter by status:
```json
{ "tenant_id": "pg.citya", "status": "PENDINGFORASSIGNMENT" }
```

Look up a specific complaint by its service request ID:
```json
{ "tenant_id": "pg.citya", "service_request_id": "PG-PGR-2026-02-28-000123" }
```

## Step 2: Create a Complaint

Call [`pgr_create`](../api/tools/pgr_create.md):
```json
{
  "tenant_id": "pg.citya",
  "service_code": "StreetLightNotWorking",
  "description": "Street light on Main St has been out for 3 days",
  "address": { "locality": { "code": "SUN04" } },
  "citizen_name": "Ravi Kumar",
  "citizen_mobile": "9876543210"
}
```

Returns a `serviceRequestId` (e.g. `PG-PGR-2026-02-28-000123`) and the initial workflow state `PENDINGFORASSIGNMENT`.

**Important:** Any user with the EMPLOYEE role can create complaints on behalf of a citizen. You do not need to re-authenticate as a citizen. Pass the citizen's name and mobile number directly.

### Finding valid inputs

| Input | How to find valid values |
|-------|--------------------------|
| `service_code` | [`validate_complaint_types`](../api/tools/validate_complaint_types.md) |
| `locality.code` | [`validate_boundary`](../api/tools/validate_boundary.md) |
| `tenant_id` | [`validate_tenant`](../api/tools/validate_tenant.md) |

## Step 3: Check Workflow State

Call [`workflow_process_search`](../api/tools/workflow_process_search.md):
```json
{
  "tenant_id": "pg.citya",
  "business_ids": ["PG-PGR-2026-02-28-000123"]
}
```

This returns the full audit trail of every state transition the complaint has gone through, including who performed each action and when.

To inspect the workflow state machine itself (all possible states and transitions), use [`workflow_business_services`](../api/tools/workflow_business_services.md):
```json
{ "tenant_id": "pg.citya", "business_services": ["PGR"] }
```

## Step 4: Assign to Employee (GRO Action)

First, find employees who have the `PGR_LME` role using [`validate_employees`](../api/tools/validate_employees.md):
```json
{ "tenant_id": "pg.citya", "required_roles": ["PGR_LME"] }
```

Then call [`pgr_update`](../api/tools/pgr_update.md) with the ASSIGN action:
```json
{
  "tenant_id": "pg.citya",
  "service_request_id": "PG-PGR-2026-02-28-000123",
  "action": "ASSIGN",
  "assignees": ["employee-uuid-here"],
  "comment": "Assigning to field team"
}
```

The complaint moves from `PENDINGFORASSIGNMENT` to `PENDINGATLME`.

If you omit `assignees`, PGR auto-routes based on department and locality configuration.

## Step 5: Resolve (LME Action)

The assigned last-mile employee resolves the complaint after completing the work:

```json
{
  "tenant_id": "pg.citya",
  "service_request_id": "PG-PGR-2026-02-28-000123",
  "action": "RESOLVE",
  "comment": "Fixed the street light — replaced bulb and repaired wiring"
}
```

The complaint moves from `PENDINGATLME` to `RESOLVED`.

## Step 6: Rate and Close (Citizen Action)

The citizen rates the resolution and closes the complaint:

```json
{
  "tenant_id": "pg.citya",
  "service_request_id": "PG-PGR-2026-02-28-000123",
  "action": "RATE",
  "rating": 5,
  "comment": "Great service, fixed within a day"
}
```

The complaint moves from `RESOLVED` to `CLOSEDAFTERRESOLUTION`. This is a terminal state.

## Alternative Flows

### Reject a Complaint (GRO)

A GRO can reject invalid or duplicate complaints from the `PENDINGFORASSIGNMENT` state:

```json
{
  "tenant_id": "pg.citya",
  "service_request_id": "PG-PGR-2026-02-28-000123",
  "action": "REJECT",
  "comment": "Duplicate of PG-PGR-2026-02-27-000099"
}
```

The complaint moves to `REJECTED`, which is a terminal state.

### Reopen After Resolution (Citizen)

If the issue was not actually fixed, the citizen can reopen:

```json
{
  "tenant_id": "pg.citya",
  "service_request_id": "PG-PGR-2026-02-28-000123",
  "action": "REOPEN",
  "comment": "Street light went out again after one day"
}
```

The complaint moves from `RESOLVED` back to `PENDINGFORASSIGNMENT`, restarting the assignment cycle.

### Reassign to a Different Employee (GRO)

If the wrong employee was assigned, or if the complaint needs to be handed off:

```json
{
  "tenant_id": "pg.citya",
  "service_request_id": "PG-PGR-2026-02-28-000123",
  "action": "REASSIGN",
  "assignees": ["new-employee-uuid"],
  "comment": "Reassigning to electrical team — plumbing team cannot handle this"
}
```

## Complete Lifecycle Example

Here is a full walkthrough from creation to closure:

1. **Create** the complaint with `pgr_create`
2. **Search** to confirm it exists with `pgr_search` (status: `PENDINGFORASSIGNMENT`)
3. **Find** an LME employee with `validate_employees`
4. **Assign** with `pgr_update` action `ASSIGN` (status: `PENDINGATLME`)
5. **Resolve** with `pgr_update` action `RESOLVE` (status: `RESOLVED`)
6. **Rate** with `pgr_update` action `RATE` with rating 1-5 (status: `CLOSEDAFTERRESOLUTION`)

At any point, call `workflow_process_search` to see the full audit trail.

## Troubleshooting

### "User is not authorized"

This usually means cross-tenant role mismatch. The logged-in user needs roles tagged to the target tenant root. Fix with [`user_role_add`](../api/tools/user_role_add.md):
```json
{ "tenant_id": "pg.citya" }
```
This adds all standard PGR roles (CITIZEN, EMPLOYEE, CSR, GRO, PGR_LME, DGRO, SUPERUSER) for the target tenant root.

### "Workflow not found" or "BusinessService not found"

The PGR workflow definition has not been registered for this tenant. Fix with [`workflow_create`](../api/tools/workflow_create.md):
```json
{ "tenant_id": "pg.citya", "copy_from_tenant": "pg" }
```
This copies the entire PGR state machine from a working tenant.

### Invalid service code

The complaint type does not exist. Verify available service codes with [`validate_complaint_types`](../api/tools/validate_complaint_types.md):
```json
{ "tenant_id": "pg.citya" }
```

### Cannot find locality code

The boundary data may be missing. Check with [`validate_boundary`](../api/tools/validate_boundary.md):
```json
{ "tenant_id": "pg.citya" }
```
This shows the full boundary tree and all locality codes.

### Complaint stuck in PENDINGFORASSIGNMENT

Either no GRO employee exists, or auto-routing failed. Verify employees have the GRO role:
```json
{ "tenant_id": "pg.citya", "required_roles": ["GRO"] }
```

## What's Next

- [Debugging & Monitoring](debugging.md) — Trace failed API calls and check persister health
- [Building a PGR UI](../ui.md) — Frontend development guide
- [API Reference: PGR Tools](../api/README.md#pgr--workflow-pgr) — Detailed tool documentation
