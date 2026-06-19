# Jurisdiction-Based Workflow Routing Design

> **Document Status:** Draft — Validated against CCRS codebase (egov-workflow-v2, pgr-services, nairobi-mdms)
> **Last Updated:** 2026-06-05

---

## 1. Objective

Enhance the DIGIT workflow engine (`egov-workflow-v2`) to support jurisdiction-based routing and access control, ensuring that PGR service requests are automatically assigned to and managed by employees responsible for the relevant geographical area (Ward, Sub-County, Zone, etc.), eliminating manual assignment overhead and reducing service delivery delays.

---

## 2. Background

### 2.1 Current Architecture (Validated)

The existing system uses **egov-workflow-v2** with the following confirmed states for PGR:

```
PENDINGFORASSIGNMENT → PENDINGATLME → PENDINGATSUPERVISOR
                                    ↓
                           RESOLVED / REJECTED
                                    ↓
              CLOSEDAFTERRESOLUTION / CLOSEDAFTERREJECTION
```

**Confirmed active roles:** `CITIZEN`, `CSR`, `GRO`, `PGR_VIEWER`, `PGR_LME`, `SUPERVISOR`, `CFC`, `AUTO_ESCALATE`

**Existing data paths that this design builds on:**

| What | Where in code |
|---|---|
| Complaint type → Department mapping | `mdms/RAINMAKER-PGR/ServiceDefs.json` (fields: `code`, `department`) |
| Department master (18 departments) | `mdms/common-masters/Department.json` |
| Employee department lookup | `pgr-services/src/main/java/org/egov/pgr/util/HRMSUtil.java` → `$.Employees.*.assignments.*.department` |
| Employee wards field | `employees.json` → `wards[]` (captured in HRMS but **not yet used in routing**) |
| Locality stored per complaint | `eg_pgr_address_v2.locality` (non-null column) |
| Locality filter in search | `PGRQueryBuilder.java` → `ads.locality IN (...)` |
| Boundary hierarchy (Nairobi) | `boundaries.json` → County → Sub-County → Ward |
| Escalation chain | `mdms/RAINMAKER-PGR/EscalationConfig.json` + `HRMSUtil.getDepartment()` → `reportingTo` |

### 2.2 Confirmed Problems

- `PENDINGFORASSIGNMENT` is reached on every complaint creation. A `GRO` or `PGR_VIEWER` must manually execute the `ASSIGN` action.
- `HRMSUtil.java` fetches department for the current assignee but **locality/ward is never cross-referenced** against the employee's `wards` field during assignment filtering.
- The `localities` search parameter exists in `RequestSearchCriteria` but is not applied when generating the assignee list for workflow.
- All employees with the matching role are presented as assignment candidates regardless of jurisdiction.

---

## 3. Proposed Solution

### 3.1 Core Principle

> **Complaint Type → Department** (existing, unchanged)
> **Locality → Jurisdiction → Employee** (new layer)

Employees are filtered at assignment time by **both** their department AND their jurisdiction mapping. No locality-to-department mapping table is required.

### 3.2 Data Model: Employee Jurisdiction Mapping

The HRMS `wards[]` field already exists on employee records. It needs to be:
1. Extended to support the full boundary hierarchy (Ward, Sub-County, Zone, Circle).
2. Populated during tenant onboarding via the XLSX/Ansible flows.
3. Read by `HRMSUtil.java` during workflow assignment candidate resolution.

**Existing employee record shape (`employees.json`):**
```json
{
  "name": "Patrick Mbogo",
  "department": "Lands & Urban Planning",
  "designation": "CECM",
  "roles": ["EMPLOYEE", "PGR_LME"],
  "wards": ["ward-12", "ward-14"]
}
```

**Extended shape (proposed — backward compatible):**
```json
{
  "name": "Patrick Mbogo",
  "department": "Lands & Urban Planning",
  "designation": "CECM",
  "roles": ["EMPLOYEE", "PGR_LME"],
  "jurisdictions": [
    { "boundaryType": "Ward",       "code": "ward-12" },
    { "boundaryType": "Ward",       "code": "ward-14" },
    { "boundaryType": "Sub-County", "code": "makadara" }
  ]
}
```

A user mapped to a higher-level boundary (`Sub-County: makadara`) inherits access to all wards under it (see Section 5).

---

## 4. MDMS Configuration

### 4.1 Module-Level Jurisdiction Routing Flag

Add a new MDMS config file `mdms/RAINMAKER-PGR/JurisdictionConfig.json`:

```json
{
  "tenantId": "ke",
  "moduleName": "RAINMAKER-PGR",
  "masterDetails": [
    {
      "module": "PGR",
      "enableJurisdictionRouting": true,
      "fallbackToAllEligible": true,
      "boundaryHierarchy": ["Ward", "Sub-County", "County"]
    }
  ]
}
```

| Field | Purpose |
|---|---|
| `enableJurisdictionRouting` | Master switch — if `false`, current role-only behavior is preserved |
| `fallbackToAllEligible` | If no jurisdiction-matched employee exists, fall back to all department+role matches (prevents blocked queues) |
| `boundaryHierarchy` | Ordered list from finest to coarsest; used for hierarchy inheritance (Section 5) |

> **Note:** The existing `EscalationConfig.json` (`maxDepth: 3`, SLA per level) remains unchanged. Jurisdiction routing operates only during the `ASSIGN` action, not during escalation.

### 4.2 Complaint-Type → Department Mapping (Unchanged)

The existing `ServiceDefs.json` mapping is sufficient and requires no changes.

**Sample (existing):**

| Complaint Type | Department Code | Department Name |
|---|---|---|
| `NoWaterSupply` | `DEPT_01` | WATER AND SEWERAGE |
| `IncorrectBilling` | `DEPT_03` | FINANCE AND REVENUE |
| `IllegalHawking` | `DEPT_10` | BOROUGHS AND SUB COUNTY ADMINISTRATION |

---

## 5. Hierarchical Jurisdiction Support

### 5.1 Nairobi Boundary Hierarchy (Actual)

```
County: Nairobi City
  └── Sub-County: Makadara
        ├── Ward: Harambee
        ├── Ward: Maringo/Hamza
        ├── Ward: Makongeni
        └── Ward: Viwandani
  └── Sub-County: Kibra
        ├── Ward: Sarang'ombe
        ├── Ward: Makina
        └── ...
```

> **Correction from original document:** The hierarchy for this deployment is **County → Sub-County → Ward**, not Zone → Ward → Village. Generic terms (Zone, Village, Circle) should be used only in abstract documentation; tenant-specific design must use the boundary types defined in `boundaries.json`.

### 5.2 Inheritance Rule

When resolving eligible employees for a complaint in Ward `Harambee` (Sub-County: `Makadara`):

1. Match employees with `jurisdictions[].code = "harambee"` (Ward level).
2. If none, or if the employee is mapped at a higher level, also include employees with `jurisdictions[].code = "makadara"` (Sub-County level).
3. Continue up the hierarchy per `boundaryHierarchy` order in MDMS config.
4. If `fallbackToAllEligible = true` and still no match, include all department+role-eligible employees.

This ensures that a `GRO` mapped to `Sub-County: Makadara` can assign/view complaints from all wards beneath it, while a `PGR_LME` mapped only to `Ward: Harambee` cannot see complaints from `Ward: Maringo/Hamza`.

---

## 6. Workflow Assignment Flow (Revised)

### 6.1 Complaint Creation (Unchanged)

1. Citizen selects **Locality** and **Complaint Type**.
2. PGR service resolves `Complaint Type → Department` via MDMS (`ServiceDefs.json`).
3. Complaint is created; status set to `PENDINGFORASSIGNMENT`.
4. Locality code is stored in `eg_pgr_address_v2.locality`.

### 6.2 Assignment Candidate Resolution (New Logic)

When a `GRO` or `PGR_VIEWER` opens the ASSIGN action:

```
locality_code  ←  eg_pgr_address_v2.locality
department     ←  MDMS ServiceDefs[complaintType].department
hierarchy      ←  MDMS JurisdictionConfig.boundaryHierarchy

candidates = HRMS.searchEmployees(
  role         = workflow_action.assigneeRoles,   // e.g. PGR_LME
  department   = department,
  jurisdiction = resolveHierarchy(locality_code, hierarchy)
)

if candidates.isEmpty() and fallbackToAllEligible:
  candidates = HRMS.searchEmployees(role, department)
```

**Change required in:** `pgr-services/src/main/java/org/egov/pgr/util/HRMSUtil.java`
- Add method `getEligibleAssignees(role, department, localityCodes)` that passes the resolved jurisdiction codes as an additional HRMS filter.

### 6.3 Auto-Assignment (Optional Enhancement)

If `enableAutoAssignment: true` is set in `JurisdictionConfig.json`:
- Skip the manual ASSIGN step.
- System selects the first eligible candidate (or round-robins by active complaint count).
- Complaint moves directly to `PENDINGATLME`.

This is a Phase 2 feature; Phase 1 only narrows the assignee dropdown.

---

## 7. Access Control

### 7.1 View Access

| User mapping | Complaints visible |
|---|---|
| Employee mapped to `Ward: Harambee` | Only complaints with `locality = harambee` |
| Employee mapped to `Sub-County: Makadara` | All complaints in Makadara's wards |
| `GRO` with no jurisdiction mapping | All complaints (admin fallback) |

**Change required in:** `PGRQueryBuilder.java`
- The `localities` filter already exists (`ads.locality IN (...)`).
- Extend `RequestSearchCriteria` to auto-populate `localities` from the requesting user's jurisdiction mapping when the user is not a GRO/admin.

### 7.2 Action Access

- Workflow engine (`egov-workflow-v2`) enforces role-based action eligibility.
- Jurisdiction check is added as a **pre-condition** before the workflow action is allowed:
  - Resolve the complaint's locality.
  - Verify the acting employee is mapped to that locality (or an ancestor in the hierarchy).
  - If not → return `403 Forbidden` with error code `PGR_JURISDICTION_MISMATCH`.

### 7.3 Access Matrix

| Role | Own jurisdiction | Other jurisdiction |
|---|---|---|
| `PGR_LME` | View + Act | No access |
| `SUPERVISOR` | View + Act | No access |
| `GRO` | View + Assign | View + Assign (admin role, no restriction) |
| `PGR_VIEWER` | View + Assign | View (read-only) |
| `CITIZEN` | Own complaints only | N/A |

---

## 8. Module Considerations

### 8.1 PGR

- Complaint Type → Department mapping remains in `ServiceDefs.json`, unchanged.
- Citizen sees only Complaint Type and Locality — no department is exposed.
- Jurisdiction routing activates at the `ASSIGN` workflow action.
- Escalation chain (`EscalationConfig.json` + `HRMSUtil.reportingTo`) is unaffected; escalation uses the supervisor hierarchy, not jurisdiction.

### 8.2 OBPAS / Trade License

- Applications are geo-tagged to a locality at creation time.
- Inbox queries for `PGR_LME`-equivalent roles are filtered by jurisdiction automatically.
- No manual assignment change required; jurisdiction filter applies at the inbox/search level.

### 8.3 Multi-Tenant

- `JurisdictionConfig.json` is tenant-scoped (keyed by `tenantId`).
- A tenant may disable jurisdiction routing (`enableJurisdictionRouting: false`) without any code change.
- Boundary hierarchy is tenant-specific (Nairobi uses Sub-County/Ward; another city may use Circle/Village).

---

## 9. Implementation Phases

### Phase 1 — Filtered Assignee Dropdown

**Scope:** Narrow the assignee list shown during manual ASSIGN; no auto-assignment.

| Task | File | Change |
|---|---|---|
| Add `JurisdictionConfig.json` to MDMS | `nairobi-mdms/mdms/RAINMAKER-PGR/` | New file |
| Extend employee model with `jurisdictions[]` | `employees.json` + HRMS schema | Additive, backward compatible |
| Add `getEligibleAssignees()` | `HRMSUtil.java` | New method |
| Pass jurisdiction filter to HRMS search | `WorkflowService.java` | Modify assignee resolution call |
| Filter inbox by jurisdiction | `PGRQueryBuilder.java` | Extend `localities` filter |
| Jurisdiction pre-condition in action | `PGRService.java` | Add check before `wfService.callWorkFlow()` |

### Phase 2 — Auto-Assignment

- Add `enableAutoAssignment` to `JurisdictionConfig.json`.
- Implement round-robin or least-load selection among candidates.
- Move complaint directly to `PENDINGATLME` on creation.

### Phase 3 — Reporting

- Jurisdiction-wise complaint volume dashboard.
- SLA breach reports segmented by Ward / Sub-County.

---

## 10. Worked Example (Nairobi / Naipepea)

**Complaint:** Water leakage at Ward: Harambee (Sub-County: Makadara)

**MDMS lookup:**
```
NoWaterSupply → DEPT_01 (WATER AND SEWERAGE)
```

**HRMS employee lookup:**
```
role        = PGR_LME
department  = DEPT_01
localities  = ["harambee", "makadara"]   ← hierarchy-resolved
```

**Employee pool:**

| Employee | Department | Jurisdiction | Eligible? |
|---|---|---|---|
| User A | WATER AND SEWERAGE | Ward: Harambee | **Yes** |
| User B | WATER AND SEWERAGE | Sub-County: Makadara | **Yes** (inherited) |
| User C | WATER AND SEWERAGE | Ward: Sarang'ombe (Kibra) | No |
| User D | ELECTRICAL | Ward: Harambee | No (wrong dept) |

**Result:** GRO sees only User A and User B in the assignee dropdown.

---

## 11. Open Questions

| # | Question | Owner |
|---|---|---|
| 1 | Should `GRO` retain unrestricted view of all jurisdictions, or be scoped too? | Product |
| 2 | What is the fallback behaviour when no jurisdiction-matched employee has capacity (SLA risk)? | Engineering |
| 3 | Should escalation (`AUTO_ESCALATE`) also respect jurisdiction, or escalate to the nearest unblocked supervisor regardless of jurisdiction? | Product |
| 4 | How are jurisdiction mappings updated when ward boundaries are redrawn? Is a re-onboarding flow needed? | Ops |
| 5 | Does the `CITIZEN` role need any jurisdiction-aware UI (e.g., showing only wards in their Sub-County)? | UX |

---

## 12. Out of Scope

- Changes to `egov-workflow-v2` core engine (all changes are in `pgr-services` and MDMS config).
- Locality-to-department mapping table (explicitly rejected — see Section 3.1).
- Real-time load balancing across employees.
- Push notifications per jurisdiction (separate Novu workflow).
