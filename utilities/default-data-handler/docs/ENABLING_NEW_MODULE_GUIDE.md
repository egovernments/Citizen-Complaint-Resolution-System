# Enabling a New Module in Default-Data-Handler

## Overview

This guide explains how to add support for a new module (e.g., Trade License, Water & Sewerage, Property Tax) in the default-data-handler utility. The utility provisions default MDMS data, schemas, localizations, workflows, and employees when a new tenant is created.

---

## Current Architecture

### Data Flow
```
┌─────────────────────────────────────────────────────────────────────┐
│                        ENTRY POINTS                                  │
├──────────────────┬─────────────────────┬────────────────────────────┤
│  Kafka Event     │  Startup Scheduler  │  REST API                  │
│  (create-tenant) │  (10s/4min delays)  │  (/defaultdata/setup)      │
└────────┬─────────┴──────────┬──────────┴─────────────┬──────────────┘
         │                    │                        │
         └────────────────────┼────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    DataHandlerService                                │
├─────────────────────────────────────────────────────────────────────┤
│ 1. createMdmsSchemaFromFile()  → Scans schema/*.json                │
│ 2. loadAllMdmsData()           → Scans mdmsData/**/*.json           │
│ 3. createBoundaryDataFromFile()                                      │
│ 4. upsertLocalizationFromFile() → Scans localisations/**/*.json     │
│ 5. createWorkflowConfig()      → Currently PGR only (hardcoded)     │
│ 6. createEmployees()           → Currently PGR roles (hardcoded)    │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Concept: Schema vs Data

| Component | Description | Created |
|-----------|-------------|---------|
| **Schema** | Structure definition (fields, types, validation) | **ONCE** per schema code |
| **Data** | Actual records/entries | **Multiple times** (merges) |

**Example:**
- Schema `common-masters.Department` is created **once**
- Data for departments can be loaded from multiple modules and **merges**

---

## Current Folder Structure

```
src/main/resources/
├── schema/                              # Schema definitions (created ONCE)
│   ├── RAINMAKER-PGR.json
│   ├── common-masters.json
│   ├── ACCESSCONTROL-ROLEACTIONS.json
│   ├── ACCESSCONTROL-ROLES.json
│   └── ...
│
├── mdmsData/                            # MDMS data (currently mixed)
│   ├── RAINMAKER-PGR/
│   ├── common-masters/
│   ├── ACCESSCONTROL-ROLE/
│   ├── ACCESSCONTROL-ROLEACTIONS/
│   └── ...
│
├── localisations/                       # UI labels by locale
│   ├── default/
│   ├── en_IN/
│   └── hi_IN/
│
├── PgrWorkflowConfig.json               # PGR workflow (hardcoded)
├── HRMS.json                            # Employee templates (PGR roles)
└── application.properties
```

---

## Proposed Module-Based Structure

To support multiple modules cleanly, restructure data by module:

```
src/main/resources/
├── schema/                              # ALL schemas (created once)
│   ├── common-masters.json
│   ├── ACCESSCONTROL-ROLES.json
│   ├── ACCESSCONTROL-ROLEACTIONS.json
│   ├── ACCESSCONTROL-ACTIONS-TEST.json
│   ├── RAINMAKER-PGR.json
│   ├── TradeLicense.json                # New module schema
│   ├── ws-services.json                 # New module schema
│   └── ...
│
├── mdmsData/
│   └── modules/
│       │
│       ├── PGR/                         # ══════ PGR MODULE ══════
│       │   ├── RAINMAKER-PGR/
│       │   │   ├── RAINMAKER-PGR.ServiceDefs.json
│       │   │   └── RAINMAKER-PGR.UIConstants.json
│       │   ├── common-masters/
│       │   │   ├── common-masters.Department.json
│       │   │   └── common-masters.IdFormat.json
│       │   ├── ACCESSCONTROL-ROLE/
│       │   │   └── ACCESSCONTROL-ROLES.roles.json
│       │   ├── ACCESSCONTROL-ROLEACTIONS/
│       │   │   └── ACCESSCONTROL-ROLEACTIONS.roleactions.json
│       │   └── ACCESSCONTROL-ACTIONS-TEST/
│       │       └── ACCESSCONTROL-ACTIONS-TEST.actions-test.json
│       │
│       ├── TL/                          # ══════ TRADE LICENSE MODULE ══════
│       │   ├── TradeLicense/
│       │   │   ├── TradeLicense.TradeType.json
│       │   │   ├── TradeLicense.AccessoriesCategory.json
│       │   │   ├── TradeLicense.ApplicationType.json
│       │   │   └── TradeLicense.Documents.json
│       │   ├── common-masters/
│       │   │   ├── common-masters.Department.json
│       │   │   └── common-masters.IdFormat.json
│       │   ├── ACCESSCONTROL-ROLE/
│       │   │   └── ACCESSCONTROL-ROLES.roles.json
│       │   ├── ACCESSCONTROL-ROLEACTIONS/
│       │   │   └── ACCESSCONTROL-ROLEACTIONS.roleactions.json
│       │   └── ACCESSCONTROL-ACTIONS-TEST/
│       │       └── ACCESSCONTROL-ACTIONS-TEST.actions-test.json
│       │
│       ├── WS/                          # ══════ WATER & SEWERAGE MODULE ══════
│       │   ├── ws-services-masters/
│       │   ├── ws-services-calculation/
│       │   ├── common-masters/
│       │   ├── ACCESSCONTROL-ROLE/
│       │   ├── ACCESSCONTROL-ROLEACTIONS/
│       │   └── ACCESSCONTROL-ACTIONS-TEST/
│       │
│       └── PT/                          # ══════ PROPERTY TAX MODULE ══════
│           └── ...
│
├── localisations/
│   └── modules/
│       ├── PGR/
│       │   ├── en_IN/rainmaker-pgr.json
│       │   └── hi_IN/rainmaker-pgr.json
│       ├── TL/
│       │   ├── en_IN/rainmaker-tl.json
│       │   └── hi_IN/rainmaker-tl.json
│       └── WS/
│           └── ...
│
├── workflow/
│   └── modules/
│       ├── PGR/PgrWorkflowConfig.json
│       ├── TL/TlWorkflowConfig.json
│       └── WS/WsWorkflowConfig.json
│
├── employees/
│   └── modules/
│       ├── PGR/HRMS.json                # PGR employees (GRO, LME, CSR)
│       ├── TL/HRMS.json                 # TL employees (TL_CREATOR, TL_APPROVER)
│       └── WS/HRMS.json                 # WS employees
│
└── application.properties
```

---

## Step-by-Step: Adding a New Module (e.g., Trade License)

### Step 1: Create Schema (if new)

If the module has unique master types, add schema definition:

**File:** `schema/TradeLicense.json`
```json
[
  {
    "code": "TradeLicense.TradeType",
    "tenantId": "{tenantid}",
    "description": "Trade types for license applications",
    "definition": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "properties": {
        "tenantId": { "type": "string" },
        "code": { "type": "string" },
        "name": { "type": "string" },
        "uom": { "type": "string" },
        "active": { "type": "boolean" }
      },
      "required": ["tenantId", "code", "name"]
    },
    "isActive": true
  },
  {
    "code": "TradeLicense.AccessoriesCategory",
    "tenantId": "{tenantid}",
    "description": "Accessories categories for trade license",
    "definition": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "properties": {
        "tenantId": { "type": "string" },
        "code": { "type": "string" },
        "name": { "type": "string" },
        "active": { "type": "boolean" }
      },
      "required": ["tenantId", "code"]
    },
    "isActive": true
  }
]
```

### Step 2: Create Module MDMS Data Folder

Create folder structure:
```
mdmsData/modules/TL/
├── TradeLicense/
├── common-masters/
├── ACCESSCONTROL-ROLE/
├── ACCESSCONTROL-ROLEACTIONS/
└── ACCESSCONTROL-ACTIONS-TEST/
```

### Step 3: Add Module-Specific Masters

**File:** `mdmsData/modules/TL/TradeLicense/TradeLicense.TradeType.json`
```json
[
  {
    "tenantId": "{tenantid}",
    "code": "RETAIL.ECOM.ONFA",
    "name": "Clothing Online",
    "uom": "GROSSUNITS",
    "active": true,
    "type": "TL"
  },
  {
    "tenantId": "{tenantid}",
    "code": "RETAIL.ELEC.ELST",
    "name": "Electronics Store",
    "uom": "GROSSUNITS",
    "active": true,
    "type": "TL"
  }
]
```

### Step 4: Add Module-Specific Departments

**File:** `mdmsData/modules/TL/common-masters/common-masters.Department.json`
```json
[
  {
    "tenantId": "{tenantid}",
    "code": "TL_DEPT",
    "name": "Trade License Department",
    "active": true
  },
  {
    "tenantId": "{tenantid}",
    "code": "REVENUE",
    "name": "Revenue Department",
    "active": true
  }
]
```

### Step 5: Add Module-Specific ID Format

**File:** `mdmsData/modules/TL/common-masters/common-masters.IdFormat.json`
```json
[
  {
    "tenantId": "{tenantid}",
    "format": "TL/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_TL]",
    "idname": "tl.aplnumber"
  },
  {
    "tenantId": "{tenantid}",
    "format": "TL/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_TL_RCPT]",
    "idname": "tl.receipt.id"
  }
]
```

### Step 6: Add Module-Specific Roles

**File:** `mdmsData/modules/TL/ACCESSCONTROL-ROLE/ACCESSCONTROL-ROLES.roles.json`
```json
[
  {
    "code": "TL_CREATOR",
    "name": "Trade License Creator",
    "description": "Can create trade license applications"
  },
  {
    "code": "TL_APPROVER",
    "name": "Trade License Approver",
    "description": "Can approve trade license applications"
  },
  {
    "code": "TL_FIELD_INSPECTOR",
    "name": "Field Inspector",
    "description": "Can inspect and verify trade license applications"
  },
  {
    "code": "TL_DOC_VERIFIER",
    "name": "Document Verifier",
    "description": "Can verify documents for trade license"
  }
]
```

### Step 7: Add Role-Actions Mapping

**File:** `mdmsData/modules/TL/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json`
```json
[
  {
    "rolecode": "TL_CREATOR",
    "actionid": 1001,
    "actioncode": "",
    "tenantId": "{tenantid}"
  },
  {
    "rolecode": "TL_APPROVER",
    "actionid": 1002,
    "actioncode": "",
    "tenantId": "{tenantid}"
  }
]
```

### Step 8: Add Actions (API Endpoints)

**File:** `mdmsData/modules/TL/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json`
```json
[
  {
    "id": 3001,
    "name": "Create Trade License",
    "url": "/tl-services/v1/_create",
    "displayName": "Create Trade License Application",
    "orderNumber": 1,
    "enabled": true,
    "serviceCode": "TL"
  },
  {
    "id": 3002,
    "name": "Update Trade License",
    "url": "/tl-services/v1/_update",
    "displayName": "Update Trade License Application",
    "orderNumber": 2,
    "enabled": true,
    "serviceCode": "TL"
  },
  {
    "id": 3003,
    "name": "Search Trade License",
    "url": "/tl-services/v1/_search",
    "displayName": "Search Trade License Applications",
    "orderNumber": 3,
    "enabled": true,
    "serviceCode": "TL"
  },
  {
    "id": 3004,
    "url": "url",
    "name": "TL Inbox",
    "path": "TLInbox",
    "enabled": true,
    "leftIcon": "TLIcon",
    "displayName": "Trade License Inbox",
    "orderNumber": 1,
    "serviceCode": "TL",
    "parentModule": "rainmaker-tl",
    "navigationURL": "/digit-ui/employee/tl/inbox"
  }
]
```

### Step 9: Add Localizations

**File:** `localisations/modules/TL/en_IN/rainmaker-tl.json`
```json
{
  "TL_COMMON_APPLY": "Apply for Trade License",
  "TL_COMMON_SEARCH": "Search Trade License",
  "TL_COMMON_INBOX": "Trade License Inbox",
  "TL_STATUS_PENDING": "Pending",
  "TL_STATUS_APPROVED": "Approved",
  "TL_STATUS_REJECTED": "Rejected",
  "TL_ERROR_REQUIRED_FIELD": "This field is required",
  "TL_TRADE_TYPE_LABEL": "Trade Type",
  "TL_LICENSE_NUMBER": "License Number"
}
```

### Step 10: Add Workflow Configuration

**File:** `workflow/modules/TL/TlWorkflowConfig.json`
```json
{
  "RequestInfo": {
    "apiId": "Rainmaker",
    "ver": ".01"
  },
  "BusinessServices": [
    {
      "tenantId": "{tenantid}",
      "businessService": "NewTL",
      "business": "tl-services",
      "businessServiceSla": 432000000,
      "states": [
        {
          "sla": null,
          "state": null,
          "applicationStatus": "INITIATED",
          "docUploadRequired": false,
          "isStartState": true,
          "isTerminateState": false,
          "isStateUpdatable": true,
          "actions": [
            {
              "action": "APPLY",
              "nextState": "APPLIED",
              "roles": ["CITIZEN", "TL_CREATOR"]
            }
          ]
        },
        {
          "sla": null,
          "state": "APPLIED",
          "applicationStatus": "APPLIED",
          "docUploadRequired": false,
          "isStartState": false,
          "isTerminateState": false,
          "isStateUpdatable": true,
          "actions": [
            {
              "action": "FORWARD",
              "nextState": "FIELDINSPECTION",
              "roles": ["TL_DOC_VERIFIER"]
            },
            {
              "action": "REJECT",
              "nextState": "REJECTED",
              "roles": ["TL_DOC_VERIFIER"]
            }
          ]
        },
        {
          "sla": null,
          "state": "FIELDINSPECTION",
          "applicationStatus": "FIELDINSPECTION",
          "docUploadRequired": false,
          "isStartState": false,
          "isTerminateState": false,
          "isStateUpdatable": true,
          "actions": [
            {
              "action": "APPROVE",
              "nextState": "APPROVED",
              "roles": ["TL_APPROVER"]
            },
            {
              "action": "REJECT",
              "nextState": "REJECTED",
              "roles": ["TL_APPROVER"]
            }
          ]
        },
        {
          "sla": null,
          "state": "APPROVED",
          "applicationStatus": "APPROVED",
          "docUploadRequired": false,
          "isStartState": false,
          "isTerminateState": true,
          "isStateUpdatable": false,
          "actions": null
        },
        {
          "sla": null,
          "state": "REJECTED",
          "applicationStatus": "REJECTED",
          "docUploadRequired": false,
          "isStartState": false,
          "isTerminateState": true,
          "isStateUpdatable": false,
          "actions": null
        }
      ]
    }
  ]
}
```

### Step 11: Add Module Employees

**File:** `employees/modules/TL/HRMS.json`
```json
[
  {
    "tenantId": "{tenantid}.citya",
    "employeeStatus": "EMPLOYED",
    "code": "TL_CREATOR_01",
    "dateOfAppointment": 1596220200000,
    "jurisdictions": [
      {
        "hierarchy": "ADMIN",
        "boundaryType": "City",
        "boundary": "{tenantid}",
        "tenantId": "{tenantid}.citya",
        "roles": [
          {
            "code": "TL_CREATOR",
            "name": "Trade License Creator",
            "tenantId": "{tenantid}.citya"
          },
          {
            "code": "EMPLOYEE",
            "name": "Employee",
            "tenantId": "{tenantid}.citya"
          }
        ]
      }
    ],
    "user": {
      "name": "TL Creator",
      "mobileNumber": "9999999301",
      "type": "EMPLOYEE",
      "emailId": "tlcreator@test.com",
      "roles": [
        {
          "code": "TL_CREATOR",
          "name": "Trade License Creator",
          "tenantId": "{tenantid}.citya"
        },
        {
          "code": "EMPLOYEE",
          "name": "Employee",
          "tenantId": "{tenantid}.citya"
        }
      ],
      "password": "eGov@123",
      "tenantId": "{tenantid}.citya"
    },
    "assignments": [
      {
        "fromDate": 1596220200000,
        "isCurrentAssignment": true,
        "department": "TL_DEPT",
        "designation": "CLERK"
      }
    ]
  },
  {
    "tenantId": "{tenantid}.citya",
    "employeeStatus": "EMPLOYED",
    "code": "TL_APPROVER_01",
    "dateOfAppointment": 1596220200000,
    "jurisdictions": [
      {
        "hierarchy": "ADMIN",
        "boundaryType": "City",
        "boundary": "{tenantid}",
        "tenantId": "{tenantid}.citya",
        "roles": [
          {
            "code": "TL_APPROVER",
            "name": "Trade License Approver",
            "tenantId": "{tenantid}.citya"
          },
          {
            "code": "EMPLOYEE",
            "name": "Employee",
            "tenantId": "{tenantid}.citya"
          }
        ]
      }
    ],
    "user": {
      "name": "TL Approver",
      "mobileNumber": "9999999302",
      "type": "EMPLOYEE",
      "emailId": "tlapprover@test.com",
      "roles": [
        {
          "code": "TL_APPROVER",
          "name": "Trade License Approver",
          "tenantId": "{tenantid}.citya"
        },
        {
          "code": "EMPLOYEE",
          "name": "Employee",
          "tenantId": "{tenantid}.citya"
        }
      ],
      "password": "eGov@123",
      "tenantId": "{tenantid}.citya"
    },
    "assignments": [
      {
        "fromDate": 1596220200000,
        "isCurrentAssignment": true,
        "department": "TL_DEPT",
        "designation": "OFFICER"
      }
    ]
  }
]
```

### Step 12: Update application.properties

```properties
# ═══════════════════════════════════════════════════════════════
# MODULE CONFIGURATION
# ═══════════════════════════════════════════════════════════════

# Enabled modules (comma-separated)
modules.enabled=PGR,TL,WS,PT

# OR load all modules from mdmsData/modules/
modules.load.all=false

# ═══════════════════════════════════════════════════════════════
# SCHEMA CONFIGURATION
# ═══════════════════════════════════════════════════════════════

# All schemas to create (module-independent)
default.mdms.schema.create.list=common-masters.Department,common-masters.Designation,common-masters.IdFormat,common-masters.GenderType,ACCESSCONTROL-ROLES.roles,ACCESSCONTROL-ROLEACTIONS.roleactions,ACCESSCONTROL-ACTIONS-TEST.actions-test,RAINMAKER-PGR.ServiceDefs,TradeLicense.TradeType,TradeLicense.AccessoriesCategory

# Module-to-schema mapping (for REST API)
mdms.schemacode.map={\
  PGR:'RAINMAKER-PGR.ServiceDefs,common-masters.Department,common-masters.IdFormat',\
  TL:'TradeLicense.TradeType,TradeLicense.AccessoriesCategory,common-masters.Department,common-masters.IdFormat',\
  HRMS:'common-masters.Department,common-masters.Designation'\
}

# ═══════════════════════════════════════════════════════════════
# LOCALIZATION CONFIGURATION
# ═══════════════════════════════════════════════════════════════

default.localization.locale.list=en_IN,hi_IN
default.localization.module.create.list=digit-ui,rainmaker-pgr,rainmaker-tl,rainmaker-common,rainmaker-hr
```

---

## Data File Naming Convention

The file name determines the schema code for MDMS data loading:

| File Name | Schema Code |
|-----------|-------------|
| `RAINMAKER-PGR.ServiceDefs.json` | `RAINMAKER-PGR.ServiceDefs` |
| `common-masters.Department.json` | `common-masters.Department` |
| `TradeLicense.TradeType.json` | `TradeLicense.TradeType` |
| `ACCESSCONTROL-ROLES.roles.json` | `ACCESSCONTROL-ROLES.roles` |

**Pattern:** `{ModuleName}.{MasterName}.json` → `{ModuleName}.{MasterName}`

---

## Data Format Reference

### Module-Specific Master Data Format
```json
[
  {
    "tenantId": "{tenantid}",        // Placeholder - replaced at runtime
    "code": "UNIQUE_CODE",
    "name": "Display Name",
    "active": true,
    // ... other fields as per schema
  }
]
```

### Role Definition Format
```json
[
  {
    "code": "ROLE_CODE",              // Must be unique
    "name": "Role Display Name",
    "description": "Role description"
  }
]
```

### Role-Action Mapping Format
```json
[
  {
    "rolecode": "ROLE_CODE",
    "actionid": 1001,                 // Must match action ID
    "actioncode": "",
    "tenantId": "{tenantid}"
  }
]
```

### Action (API Endpoint) Format
```json
[
  {
    "id": 1001,                       // Unique action ID
    "name": "Action Name",
    "url": "/service/v1/_endpoint",   // API endpoint
    "displayName": "Display Name",
    "orderNumber": 1,
    "enabled": true,
    "serviceCode": "MODULE_CODE"
  }
]
```

### ID Format Definition
```json
[
  {
    "tenantId": "{tenantid}",
    "format": "PREFIX/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_NAME]",
    "idname": "module.entity.id"
  }
]
```

**Format Placeholders:**
- `[CITY.CODE]` - City code
- `[fy:yyyy-yy]` - Financial year
- `[cy:yyyy-MM-dd]` - Current date
- `[SEQ_NAME]` - Sequence name

---

## Checklist: New Module Enablement

### Required Files

| # | File/Folder | Purpose | Status |
|---|-------------|---------|--------|
| 1 | `schema/{Module}.json` | Schema definition | ☐ |
| 2 | `mdmsData/modules/{MODULE}/` | Module data folder | ☐ |
| 3 | `mdmsData/modules/{MODULE}/{Module}/` | Module-specific masters | ☐ |
| 4 | `mdmsData/modules/{MODULE}/common-masters/` | Department, IdFormat | ☐ |
| 5 | `mdmsData/modules/{MODULE}/ACCESSCONTROL-ROLE/` | Module roles | ☐ |
| 6 | `mdmsData/modules/{MODULE}/ACCESSCONTROL-ROLEACTIONS/` | Role-action mapping | ☐ |
| 7 | `mdmsData/modules/{MODULE}/ACCESSCONTROL-ACTIONS-TEST/` | API endpoints/actions | ☐ |
| 8 | `localisations/modules/{MODULE}/{locale}/` | UI labels | ☐ |
| 9 | `workflow/modules/{MODULE}/WorkflowConfig.json` | Workflow states | ☐ |
| 10 | `employees/modules/{MODULE}/HRMS.json` | Default employees | ☐ |
| 11 | `application.properties` | Enable module | ☐ |

### Data Validation Checklist

| # | Check | Status |
|---|-------|--------|
| 1 | All JSON files are valid JSON | ☐ |
| 2 | `{tenantid}` placeholder used (not hardcoded tenant) | ☐ |
| 3 | Role codes match between roles.json and roleactions.json | ☐ |
| 4 | Action IDs match between actions-test.json and roleactions.json | ☐ |
| 5 | Schema code in schema file matches data file naming | ☐ |
| 6 | Department codes used in HRMS.json exist in Department.json | ☐ |
| 7 | Designation codes used in HRMS.json exist in Designation.json | ☐ |

---

## Code Changes Required

### Current Hardcoded Items (Need Modification)

| File | Method | Issue |
|------|--------|-------|
| `TenantConsumer.java:74` | `createPgrWorkflowConfig()` | Only PGR workflow loaded |
| `DataHandlerService.java:453` | `setupDefaultData()` | Only PGR/HRMS modules supported |
| `DataHandlerService.java:601` | `defaultEmployeeSetup()` | Only RESOLVER/ASSIGNER created |
| `MdmsBulkLoader.java` | `loadAllMdmsData()` | Loads from `mdmsData/**` (no module filtering) |

### Recommended Code Changes

1. **MdmsBulkLoader.java** - Modify to load from `mdmsData/modules/{MODULE}/**`
2. **DataHandlerService.java** - Add generic `createWorkflowConfig(module)` method
3. **DataHandlerService.java** - Add generic `createModuleEmployees(module)` method
4. **LocalizationUtil.java** - Modify to load from `localisations/modules/{MODULE}/**`
5. **application.properties** - Add `modules.enabled` configuration

---

## Quick Reference: Existing Module Data (from mdms unified-demo-data)

### PGR Module
```
RAINMAKER-PGR/
└── ServiceDefs.json          # Complaint types (NoStreetlight, GarbageNeedsTobeCleared, etc.)
```

### Trade License Module
```
TradeLicense/
├── TradeType.json            # Trade types (Clothing Online, Electronics Store, etc.)
├── AccessoriesCategory.json  # Accessory categories
├── ApplicationType.json      # NEW, RENEWAL
├── Documents.json            # Required documents
├── Penalty.json              # Late fee penalties
├── Rebate.json               # Early payment rebates
└── CommonFieldsConfig.json   # UI field configurations
```

### HRMS Module
```
egov-hrms/
├── EmployeeType.json         # PNT, TMP, DEP, CNT
├── EmployeeStatus.json       # EMPLOYED, RETIRED, SUSPENDED
├── Degree.json               # Educational qualifications
├── Designation.json          # Job titles
├── DeactivationReason.json   # Reasons for deactivation
└── Specalization.json        # Specializations
```

### Common Masters (Shared)
```
common-masters/
├── Department.json           # Departments for all modules
├── Designation.json          # Designations for all modules
├── IdFormat.json             # ID formats for ALL modules (26KB - 800+ lines)
├── GenderType.json           # MALE, FEMALE, OTHERS
├── StateInfo.json            # State configuration
└── wfSlaConfig.json          # SLA configuration
```

---

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Schema creation fails | Schema already exists | Check if schema code is unique |
| Data not loading | Wrong file naming | Ensure filename matches `{Module}.{Master}.json` |
| Role not found | Missing role definition | Add role to `ACCESSCONTROL-ROLES.roles.json` |
| Action not authorized | Missing role-action mapping | Add entry to `ACCESSCONTROL-ROLEACTIONS.roleactions.json` |
| Employee creation fails | Missing department/designation | Add department/designation to common-masters |
| Workflow not created | Hardcoded PGR only | Modify code to load module workflow |

---

## Contact & Support

For issues or questions, refer to:
- DIGIT Documentation: https://core.digit.org
- GitHub Issues: https://github.com/egovernments/DIGIT-OSS
