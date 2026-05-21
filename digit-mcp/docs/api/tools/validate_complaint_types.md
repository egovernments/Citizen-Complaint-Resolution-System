# validate_complaint_types

> Validate PGR complaint type (service definition) setup for a tenant, checking that each type exists and references a valid department.

**Group:** `masters` | **Risk:** `read` | **DIGIT Service:** `egov-mdms-service`

## Description

Queries the `RAINMAKER-PGR.ServiceDefs` schema in MDMS v2 for the given tenant and returns all registered PGR complaint types (service definitions). Each service definition includes its service code, name, department reference, SLA, and active status. This is the authoritative check for what complaint types are available for `pgr_create`.

When `check_department_refs` is enabled (the default), the tool cross-references each complaint type's department code against the `common-masters.Department` schema. Complaint types that reference a non-existent or inactive department are flagged as warnings, since PGR auto-routing depends on valid department assignments.

The tool also warns about complaint types that are missing an SLA value, which affects workflow escalation timelines. Service definitions are stored at the state tenant root level and inherited by city-level tenants.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID to validate complaint types for (e.g. `"pg"`, `"pg.citya"`) |
| `check_department_refs` | boolean | no | `true` | Cross-reference each complaint type's department against MDMS departments |

## Response

```json
{
  "success": true,
  "tenantId": "pg",
  "totalServiceDefs": 4,
  "activeServiceDefs": 4,
  "inactiveServiceDefs": 0,
  "serviceDefs": [
    {
      "serviceCode": "StreetLightNotWorking",
      "name": "Street Light Not Working",
      "department": "DEPT_1",
      "sla": 259200000,
      "active": true
    },
    {
      "serviceCode": "GarbageNeedsToBeCleared",
      "name": "Garbage Needs To Be Cleared",
      "department": "DEPT_25",
      "sla": 259200000,
      "active": true
    }
  ],
  "departmentValidation": {
    "checked": true,
    "allValid": true,
    "invalidRefs": []
  }
}
```

When department references are invalid:

```json
{
  "success": true,
  "tenantId": "tenant",
  "totalServiceDefs": 2,
  "activeServiceDefs": 2,
  "inactiveServiceDefs": 0,
  "serviceDefs": [
    {
      "serviceCode": "StreetLightNotWorking",
      "name": "Street Light Not Working",
      "department": "DEPT_UNKNOWN",
      "sla": null,
      "active": true
    }
  ],
  "departmentValidation": {
    "checked": true,
    "allValid": false,
    "invalidRefs": [
      {
        "serviceCode": "StreetLightNotWorking",
        "department": "DEPT_UNKNOWN",
        "reason": "Department not found in MDMS"
      }
    ]
  },
  "warnings": ["StreetLightNotWorking has no SLA configured"]
}
```

## Examples

### Basic Usage

List all complaint types and validate their department references:

```
validate_complaint_types({ tenant_id: "pg" })
```

### Skip Department Cross-Reference

List complaint types without checking department validity (faster):

```
validate_complaint_types({
  tenant_id: "pg",
  check_department_refs: false
})
```

### Pre-flight for PGR Complaint Creation

Verify complaint types exist before filing a complaint:

```
// Step 1: Validate complaint types are set up
validate_complaint_types({ tenant_id: "pg" })

// Step 2: Use a valid service code to create a complaint
pgr_create({
  tenant_id: "pg.citya",
  service_code: "StreetLightNotWorking",
  description: "Street light out near main road",
  address: { locality: { code: "LOC_CITYA_1" } },
  citizen_name: "John Doe",
  citizen_mobile: "9876543210"
})
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Not authenticated` | No active session | Call `configure` first |
| `totalServiceDefs: 0` | No complaint types registered | Run `tenant_bootstrap` to copy from `"pg"`, or create with `mdms_create` using schema `RAINMAKER-PGR.ServiceDefs` |
| `departmentValidation.allValid: false` | Complaint type references a missing department | Create the missing department with `mdms_create`, or update the complaint type's department reference |
| Warnings about missing SLA | Service definition has no `slaHours` configured | Update the MDMS record to include SLA value |

## See Also

- [pgr_create](pgr_create.md) -- create a PGR complaint using a valid service code from this validation
- [mdms_create](mdms_create.md) -- create new complaint type definitions in MDMS
- [validate_departments](validate_departments.md) -- validate department codes independently
- [Guide: City Setup](../../guides/city-setup.md) -- end-to-end guide for setting up PGR in a new city
