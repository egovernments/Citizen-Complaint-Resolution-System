# City Setup Guide

> Bootstrap a new tenant, create a city, configure departments, employees, and complaint types -- everything needed for PGR.

## Prerequisites

- Authenticated via [`configure`](../api/tools/configure.md)
- Tool groups enabled: `mdms`, `boundary`, `masters`, `employees`, `pgr`, `localization`, `admin`

```
enable_tools({ enable: ["mdms", "boundary", "masters", "employees", "pgr", "localization", "admin"] })
```

## Overview

Setting up a new city for PGR (Public Grievance Redressal) requires these steps in order:

1. Bootstrap state tenant root (schemas, MDMS data, workflows)
2. Create city tenant (tenant record, ADMIN user, boundaries)
3. Verify the boundary hierarchy
4. Add master data (departments, designations, complaint types)
5. Create employees (GRO to route complaints, LME to resolve them)
6. Add localization labels (UI translations)
7. Validate the full setup
8. Test with a real complaint

Each step builds on the previous one. Skipping steps or running them out of order will cause failures downstream.

---

## Step 1: Bootstrap the State Tenant

Every city belongs to a state-level root tenant. The root must be bootstrapped first with schemas, master data, and workflow definitions. Call [`tenant_bootstrap`](../api/tools/tenant_bootstrap.md):

```
tenant_bootstrap({
  target_tenant: "mytenant",
  source_tenant: "pg"
})
```

This single call performs five operations:

- Copies all MDMS v2 schema definitions from `"pg"` to `"mytenant"`
- Creates a root tenant self-record in `tenant.tenants`
- Copies essential MDMS data: roles, departments, designations, ID formats, PGR service definitions, gender types, employee types, StateInfo, DataSecurity policies, and InboxQueryConfiguration
- Provisions an ADMIN user on `"mytenant"` with roles: EMPLOYEE, CITIZEN, CSR, GRO, PGR_LME, DGRO, SUPERUSER, INTERNAL_MICROSERVICE_ROLE
- Copies workflow definitions (PGR, PT, TL, FSM, etc.) from the source

Call this **once** per new tenant root. It is idempotent -- running it again skips duplicates and reactivates inactive records.

**Important:** If you are adding a city under an existing root (e.g. `"pg"`), skip this step. The root is already bootstrapped.

---

## Step 2: Create the City Tenant

Call [`city_setup`](../api/tools/city_setup.md) to create the city-level tenant:

```
city_setup({
  tenant_id: "mytenant.springfield",
  city_name: "Springfield"
})
```

This creates:

- A tenant record in MDMS under `tenant.tenants`
- A dual-scoped ADMIN user with roles on both `"mytenant"` and `"mytenant.springfield"`
- Workflow definitions copied to the root (if not already present)
- A default ADMIN boundary hierarchy: Country > State > District > City > Ward > Locality
- One auto-generated locality code: `LOC_SPRINGFIELD_1`

The tenant ID must contain a dot (root.city format). The city code is derived from the part after the dot.

### Custom Localities

If you need multiple localities or specific codes, pass them explicitly:

```
city_setup({
  tenant_id: "mytenant.springfield",
  city_name: "Springfield",
  locality_codes: ["LOC_SPR_DOWNTOWN", "LOC_SPR_NORTH", "LOC_SPR_SOUTH"]
})
```

This creates three wards and three localities instead of the default single locality.

### Skip Boundary Creation

If you plan to load real-world boundary data separately (e.g. from the [DIGIT-Boundaries-OpenData](https://github.com/ChakshuGautam/DIGIT-Boundaries-OpenData) repository), skip the default boundaries:

```
city_setup({
  tenant_id: "mytenant.springfield",
  city_name: "Springfield",
  create_boundaries: false
})
```

Then use [`boundary_create`](../api/tools/boundary_create.md) to load actual geographic boundaries.

---

## Step 3: Verify Boundaries

Call [`validate_boundary`](../api/tools/validate_boundary.md) to confirm the hierarchy was created:

```
validate_boundary({ tenant_id: "mytenant.springfield" })
```

Expected output: `"Found 1 boundary tree(s) with 8 total node(s) for hierarchy \"ADMIN\""`. The 8 nodes represent the full hierarchy: Country, State, District, City, Ward, and Locality levels with one entity at each.

If boundaries are missing, the validator returns a `BOUNDARY_MISSING` error. Fix this by re-running `city_setup` or calling `boundary_create` directly.

---

## Step 4: Add Master Data

`tenant_bootstrap` copies default departments, designations, and complaint types from the source tenant. You can use them as-is or add your own.

### Check What Was Copied

Verify existing master data before adding more:

```
validate_departments({ tenant_id: "mytenant" })
validate_designations({ tenant_id: "mytenant" })
validate_complaint_types({ tenant_id: "mytenant" })
```

The bootstrap typically copies departments like `DEPT_1` through `DEPT_25`, designations like `DESIG_1` through `DESIG_26`, and PGR service definitions like `StreetLightNotWorking`, `GarbageNotCollected`, `WaterSupply`, etc.

### Add a Custom Department

Use [`mdms_create`](../api/tools/mdms_create.md) at the **state root** level (not the city level):

```
mdms_create({
  tenant_id: "mytenant",
  schema_code: "common-masters.Department",
  unique_identifier: "DEPT_PARKS",
  data: {
    code: "DEPT_PARKS",
    name: "Parks and Recreation",
    active: true
  }
})
```

### Add a Custom Designation

```
mdms_create({
  tenant_id: "mytenant",
  schema_code: "common-masters.Designation",
  unique_identifier: "DESIG_INSPECTOR",
  data: {
    code: "DESIG_INSPECTOR",
    name: "Field Inspector",
    active: true
  }
})
```

### Add a Custom Complaint Type

```
mdms_create({
  tenant_id: "mytenant",
  schema_code: "RAINMAKER-PGR.ServiceDefs",
  unique_identifier: "ParkBenchBroken",
  data: {
    serviceCode: "ParkBenchBroken",
    name: "Park Bench Broken",
    department: "DEPT_PARKS",
    slaHours: 48,
    menuPath: "Parks",
    active: true
  }
})
```

The `department` field links the complaint type to a department. When a GRO assigns a complaint, the system uses this to route it to employees in the matching department. The `slaHours` defines the service level agreement -- how many hours the city has to resolve the complaint.

**Key point:** All master data is created at the state root (`"mytenant"`), not at the city level (`"mytenant.springfield"`). City tenants inherit master data from their root.

---

## Step 5: Create Employees

PGR requires two employee roles to function:

- **GRO** (Grievance Routing Officer): Reviews incoming complaints and assigns them to field workers
- **PGR_LME** (Last Mile Employee): Resolves complaints in the field

Both must include the base `EMPLOYEE` role. Create them at the **city** level using [`employee_create`](../api/tools/employee_create.md).

### Create a GRO

```
employee_create({
  tenant_id: "mytenant.springfield",
  name: "Jane Smith",
  mobile_number: "9876543210",
  roles: [
    { code: "EMPLOYEE", name: "Employee" },
    { code: "GRO", name: "Grievance Routing Officer" },
    { code: "DGRO", name: "Department Grievance Routing Officer" }
  ],
  department: "DEPT_1",
  designation: "DESIG_1",
  jurisdiction_boundary_type: "City",
  jurisdiction_boundary: "mytenant.springfield"
})
```

The response includes the generated employee code (e.g. `"EMP-0001"`), which is the employee's **login username** -- not their mobile number. The default password is `eGov@123`.

Adding `DGRO` alongside `GRO` allows the employee to route complaints within their own department as well as across departments.

### Create an LME

```
employee_create({
  tenant_id: "mytenant.springfield",
  name: "John Doe",
  mobile_number: "9876543211",
  roles: [
    { code: "EMPLOYEE", name: "Employee" },
    { code: "PGR_LME", name: "PGR Last Mile Employee" }
  ],
  department: "DEPT_1",
  designation: "DESIG_1",
  jurisdiction_boundary_type: "City",
  jurisdiction_boundary: "mytenant.springfield"
})
```

For larger deployments, create multiple LMEs across different departments so that complaints can be routed to the right team:

```
// LME for the Parks department
employee_create({
  tenant_id: "mytenant.springfield",
  name: "Bob Wilson",
  mobile_number: "9876543212",
  roles: [
    { code: "EMPLOYEE", name: "Employee" },
    { code: "PGR_LME", name: "PGR Last Mile Employee" }
  ],
  department: "DEPT_PARKS",
  designation: "DESIG_INSPECTOR",
  jurisdiction_boundary_type: "City",
  jurisdiction_boundary: "mytenant.springfield"
})
```

### Validate Employees Before Creating

Use `validate_departments` and `validate_designations` to confirm valid codes before calling `employee_create`. Invalid department or designation codes will cause creation to fail:

```
validate_departments({ tenant_id: "mytenant", required_departments: ["DEPT_1", "DEPT_PARKS"] })
validate_designations({ tenant_id: "mytenant", required_designations: ["DESIG_1", "DESIG_INSPECTOR"] })
```

---

## Step 6: Add Localization Labels

The DIGIT UI uses localization keys to render department names, complaint types, and other labels. Without localization entries, the UI shows raw codes like `DEPT_PARKS` instead of "Parks and Recreation".

Call [`localization_upsert`](../api/tools/localization_upsert.md) at the state root:

```
localization_upsert({
  tenant_id: "mytenant",
  messages: [
    { code: "DEPT_PARKS", message: "Parks and Recreation", module: "rainmaker-common" },
    { code: "DESIG_INSPECTOR", message: "Field Inspector", module: "rainmaker-common" },
    { code: "SERVICEDEFS.PARKBENCHBROKEN", message: "Park Bench Broken", module: "rainmaker-pgr" },
    { code: "COMPLAINT_CATEGORY_Parks", message: "Parks", module: "rainmaker-pgr" }
  ]
})
```

Naming conventions for localization codes:

| Entity | Code Pattern | Module | Example |
|--------|-------------|--------|---------|
| Department | `DEPT_<CODE>` | `rainmaker-common` | `DEPT_PARKS` -> "Parks and Recreation" |
| Designation | `DESIG_<CODE>` | `rainmaker-common` | `DESIG_INSPECTOR` -> "Field Inspector" |
| Complaint type | `SERVICEDEFS.<SERVICECODE>` | `rainmaker-pgr` | `SERVICEDEFS.PARKBENCHBROKEN` -> "Park Bench Broken" |
| Complaint category | `COMPLAINT_CATEGORY_<menuPath>` | `rainmaker-pgr` | `COMPLAINT_CATEGORY_Parks` -> "Parks" |

If the bootstrapped data already includes standard departments and complaint types, their localization labels are typically already present from the source tenant. You only need to add labels for **custom** master data you created in Step 4.

### Verify Labels

Use [`localization_search`](../api/tools/localization_search.md) to confirm your labels are registered:

```
localization_search({ tenant_id: "mytenant", module: "rainmaker-pgr" })
```

---

## Step 7: Validate the Full Setup

Run all validators to confirm every component is in place:

```
validate_departments({ tenant_id: "mytenant" })
validate_designations({ tenant_id: "mytenant" })
validate_complaint_types({ tenant_id: "mytenant" })
validate_boundary({ tenant_id: "mytenant.springfield" })
validate_employees({
  tenant_id: "mytenant.springfield",
  required_roles: ["GRO", "PGR_LME"]
})
```

The employee validator checks that at least one employee has each required role. If any validator reports errors, fix the issue before proceeding to testing.

---

## Step 8: Test with a Complaint

Create a test complaint to verify the full PGR pipeline works end-to-end. Call [`pgr_create`](../api/tools/pgr_create.md):

```
pgr_create({
  tenant_id: "mytenant.springfield",
  service_code: "StreetLightNotWorking",
  description: "Street light on Main St has been out for 3 days",
  address: {
    locality: { code: "LOC_SPRINGFIELD_1" },
    city: "Springfield"
  },
  citizen_name: "Test Citizen",
  citizen_mobile: "9999999999"
})
```

The response includes the `serviceRequestId` (e.g. `"PB-PGR-2026-02-28-000001"`) and `citizenLogin` credentials. The complaint starts in `PENDINGFORASSIGNMENT` status.

### Walk Through the Full Workflow

After creating the complaint, walk it through the complete lifecycle to verify that assignment, resolution, and rating all work:

```
// 1. Get the LME employee UUID from validate_employees
validate_employees({ tenant_id: "mytenant.springfield" })
// Note the UUID of the PGR_LME employee

// 2. GRO assigns the complaint to the LME
pgr_update({
  tenant_id: "mytenant.springfield",
  service_request_id: "PB-PGR-2026-02-28-000001",
  action: "ASSIGN",
  assignees: ["<lme-employee-uuid>"],
  comment: "Assigning to field team"
})

// 3. LME resolves the complaint
pgr_update({
  tenant_id: "mytenant.springfield",
  service_request_id: "PB-PGR-2026-02-28-000001",
  action: "RESOLVE",
  comment: "Replaced the bulb, light is working now"
})

// 4. Citizen rates the resolution
pgr_update({
  tenant_id: "mytenant.springfield",
  service_request_id: "PB-PGR-2026-02-28-000001",
  action: "RATE",
  rating: 5,
  comment: "Fixed quickly, thank you"
})
```

If any step fails, check the error message. Common issues:

- **"BusinessService not found"**: Workflow definitions are missing. Run `workflow_create({ tenant_id: "mytenant.springfield", copy_from_tenant: "pg" })`.
- **"User is not authorized"**: The logged-in user lacks roles on the target tenant. Run `user_role_add({ tenant_id: "mytenant" })` and re-authenticate.
- **Invalid locality code**: The boundary code does not exist. Verify with `validate_boundary`.

For the complete complaint lifecycle reference, see the [PGR Lifecycle Guide](pgr-lifecycle.md).

---

## Cleanup

To tear down a test tenant and all its data, call [`tenant_cleanup`](../api/tools/tenant_cleanup.md):

```
tenant_cleanup({ tenant_id: "mytenant" })
```

This soft-deletes all MDMS records (`isActive: false`) and deactivates users. Schema definitions are left in place so that re-bootstrapping is faster -- `tenant_bootstrap` will skip existing schemas and only re-create data records.

To clean up only the city without affecting the root:

```
tenant_cleanup({
  tenant_id: "mytenant.springfield",
  schemas: ["tenant.tenants"],
  deactivate_users: true
})
```

---

## Quick Reference

### Step Summary

| Step | Tool | Tenant Level | Purpose |
|------|------|-------------|---------|
| 1 | `tenant_bootstrap` | Root (`"mytenant"`) | Schemas, MDMS data, workflows, ADMIN user |
| 2 | `city_setup` | City (`"mytenant.springfield"`) | Tenant record, boundaries, dual-scoped ADMIN |
| 3 | `validate_boundary` | City | Confirm boundaries exist |
| 4 | `mdms_create` | Root | Custom departments, designations, complaint types |
| 5 | `employee_create` | City | GRO and LME employees |
| 6 | `localization_upsert` | Root | UI labels for custom master data |
| 7 | `validate_*` | Both | Confirm everything is configured |
| 8 | `pgr_create` + `pgr_update` | City | End-to-end complaint test |

### Root vs. City -- Where to Create What

| Data Type | Create At | Why |
|-----------|----------|-----|
| Schemas | Root | Inherited by all cities |
| Departments | Root | Shared across cities |
| Designations | Root | Shared across cities |
| Complaint types | Root | Shared across cities |
| Localization labels | Root | Shared across cities |
| Boundaries | City | Each city has its own geography |
| Employees | City | Employees belong to a specific city |
| Complaints | City | Complaints are filed against a city |

---

## What's Next

- [PGR Complaint Lifecycle](pgr-lifecycle.md) -- Full complaint workflow: create, assign, resolve, reject, reopen, rate
- [Building a PGR UI](../ui.md) -- Frontend development guide for complaint management interfaces
- [Debugging and Monitoring](debugging.md) -- Trace failures, inspect Kafka lag, check persister health
- [API Reference](../api/README.md) -- Detailed documentation for every tool
