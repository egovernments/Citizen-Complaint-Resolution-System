# tenant_bootstrap

> Bootstrap a new state-level tenant root by copying all schemas, essential MDMS data, an ADMIN user, and workflow definitions from an existing tenant.

**Group:** `mdms` | **Risk:** `write` | **DIGIT Service:** multiple (egov-mdms-service, user-otp, egov-workflow-v2)

## Description

This is the foundational setup tool for creating a new tenant root in DIGIT. It must be called once before any employees, PGR complaints, or other services can operate under the new root. The tool performs five steps in sequence:

1. **Copy all schema definitions** from the source tenant (e.g. `"pg"`) to the target. This includes every schema registered in MDMS v2 -- departments, designations, roles, PGR service definitions, ID formats, and more.

2. **Create a root tenant self-record** under `tenant.tenants` so that the new root is discoverable by DIGIT services that resolve tenant codes via MDMS.

3. **Copy essential MDMS data records** from the source. This includes: `ACCESSCONTROL-ROLES.roles` (required before user provisioning), `common-masters.IdFormat`, `common-masters.Department`, `common-masters.Designation`, `common-masters.StateInfo`, `common-masters.GenderType`, `egov-hrms.EmployeeStatus`, `egov-hrms.EmployeeType`, `egov-hrms.DeactivationReason`, `RAINMAKER-PGR.ServiceDefs`, `Workflow.BusinessService`, `INBOX.InboxQueryConfiguration`, and all four `DataSecurity.*` schemas (required by services embedding egov-enc-service).

4. **Provision an ADMIN user** on the target tenant with standard roles: EMPLOYEE, CITIZEN, CSR, GRO, PGR_LME, DGRO, SUPERUSER, and INTERNAL_MICROSERVICE_ROLE. If the user already exists, missing roles are added. This ensures direct API login with `tenantId=<target>` works.

5. **Copy workflow definitions** (PGR, PT, TL, FSM, BPA, etc.) from the source to the target root. Workflow state machines are stored at the root level and inherited by city tenants.

Each step is idempotent: duplicates are skipped, inactive records are reactivated. The tool is safe to run multiple times.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `target_tenant` | string | yes | -- | The new tenant root to bootstrap (e.g. `"tenant"`, `"ke"`, `"mz"`) |
| `source_tenant` | string | no | `"pg"` | Existing tenant root to copy from |

## Response

```json
{
  "success": true,
  "source": "pg",
  "target": "ke",
  "summary": {
    "schemas_copied": 22,
    "schemas_skipped": 3,
    "schemas_failed": 0,
    "data_copied": 45,
    "data_skipped": 12,
    "data_failed": 0,
    "workflows_created": 2,
    "workflows_skipped": 5,
    "workflows_failed": 0
  },
  "adminUser": {
    "provisioned": true,
    "username": "ADMIN",
    "tenantId": "ke",
    "roles": ["EMPLOYEE", "CITIZEN", "CSR", "GRO", "PGR_LME", "DGRO", "SUPERUSER", "INTERNAL_MICROSERVICE_ROLE"],
    "note": "ADMIN user \"ADMIN\" provisioned on \"ke\" with roles: EMPLOYEE, CITIZEN, CSR, GRO, PGR_LME, DGRO, SUPERUSER, INTERNAL_MICROSERVICE_ROLE. Direct login with tenantId=\"ke\" now works."
  },
  "results": {
    "schemas": {
      "copied": ["common-masters.Department", "common-masters.Designation", "..."],
      "skipped": ["tenant.tenants"],
      "failed": []
    },
    "data": {
      "copied": ["ACCESSCONTROL-ROLES.roles/EMPLOYEE", "common-masters.Department/DEPT_1", "..."],
      "skipped": ["tenant.tenants/ke (root self-record)"],
      "failed": []
    },
    "workflow": {
      "created": ["PGR"],
      "skipped": ["PT.CREATE", "PT.UPDATE"],
      "failed": []
    }
  },
  "nextSteps": [
    "Create a city tenant: use city_setup with tenant_id=\"ke.nairobi\" and a city name",
    "NOTE: DIGIT Java services (PGR, HRMS, inbox) use STATE_LEVEL_TENANT_ID from their config. A new root tenant requires restarting these services. For testing, create cities under \"pg\" instead."
  ]
}
```

## Examples

### Basic Usage

Bootstrap a new tenant root using defaults (copies from `"pg"`):

```
tenant_bootstrap({ target_tenant: "ke" })
```

### Copy from a Different Source

Use a non-default source tenant:

```
tenant_bootstrap({
  target_tenant: "mz",
  source_tenant: "statea"
})
```

### Typical Workflow

Set up a complete new tenant from scratch:

```
// Step 1: Bootstrap the root
tenant_bootstrap({ target_tenant: "ke" })

// Step 2: Create a city under the root
city_setup({ tenant_id: "ke.nairobi", city_name: "Nairobi" })

// Step 3: Create employees
employee_create({
  tenant_id: "ke.nairobi",
  name: "John Doe",
  mobile_number: "9876543210",
  department: "DEPT_1",
  designation: "DESIG_1",
  roles: [
    { code: "EMPLOYEE", name: "Employee" },
    { code: "GRO", name: "Grievance Routing Officer" }
  ],
  jurisdiction_boundary_type: "City",
  jurisdiction_boundary: "ke.nairobi"
})

// Step 4: File a complaint
pgr_create({
  tenant_id: "ke.nairobi",
  service_code: "StreetLightNotWorking",
  description: "Street light broken on Main St",
  address: { locality: { code: "LOC_NAIROBI_1" } },
  citizen_name: "Jane Smith",
  citizen_mobile: "9988776655"
})
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Not authenticated` | No active session | Call `configure` first |
| `schemas_failed > 0` | Some schemas could not be copied | Check the `results.schemas.failed` array for specific errors |
| `data_failed > 0` | Some data records could not be copied | Check `results.data.failed` -- often caused by schema dependency ordering |
| `adminUser.provisioned: false` | User creation or update failed | Use `user_create` manually to provision an admin user on the target tenant |
| `workflows_failed > 0` | Workflow copy errors | Use `workflow_create` with `copy_from_tenant` to retry individually |

## See Also

- [city_setup](city_setup.md) -- next step after bootstrap: create city-level tenants with boundaries
- [tenant_cleanup](tenant_cleanup.md) -- tear down a test tenant by soft-deleting all MDMS data and deactivating users
