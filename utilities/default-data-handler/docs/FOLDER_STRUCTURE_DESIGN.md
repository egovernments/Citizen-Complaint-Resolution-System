# Default Data Handler - Folder Structure & Architecture Guide

## Table of Contents

1. [Overview](#overview)
2. [Architecture Philosophy](#architecture-philosophy)
3. [Folder Structure](#folder-structure)
4. [Data Loading Flow](#data-loading-flow)
5. [Adding a New Module](#adding-a-new-module)
6. [Configuration Reference](#configuration-reference)
7. [Best Practices](#best-practices)
8. [Troubleshooting](#troubleshooting)

---

## Overview

The Default Data Handler is a Spring Boot service that automatically provisions master data, schemas, localizations, workflows, and employees when a new tenant is created. It uses a **module-based architecture** that allows you to enable/disable entire modules through configuration.

### Key Features

```
+------------------+     +-------------------+     +------------------+
|   Configuration  | --> | Default Data      | --> | MDMS, Workflow,  |
|   modules.enabled|     | Handler Service   |     | Localization,    |
|   =PGR,TL,PT     |     |                   |     | HRMS APIs        |
+------------------+     +-------------------+     +------------------+
```

- **Zero-code module activation**: Enable modules via `application.properties`
- **Self-contained modules**: Each module carries all its required data
- **Backward compatible**: Legacy flat structure still works
- **Tenant-aware**: Automatic `{tenantid}` placeholder replacement

---

## Architecture Philosophy

### The Three-Tier Design

```
┌─────────────────────────────────────────────────────────────────┐
│                     TIER 1: COMMON (Always Loaded)              │
│  - Infrastructure schemas (tenant, security, workflow base)     │
│  - Shared master data (departments, gender types)               │
│  - Base localization labels                                     │
├─────────────────────────────────────────────────────────────────┤
│                     TIER 2: MODULE (Conditionally Loaded)       │
│  - Module-specific schemas (PGR service defs, TL trade types)   │
│  - Module roles & permissions (ACCESSCONTROL)                   │
│  - Module workflows & employees                                 │
├─────────────────────────────────────────────────────────────────┤
│                     TIER 3: LEGACY (Backward Compatibility)     │
│  - Old flat folder structure                                    │
│  - Automatically skipped if modules/ folder exists              │
└─────────────────────────────────────────────────────────────────┘
```

### Why This Design?

| Concern | Solution | Benefit |
|---------|----------|---------|
| **Modularity** | Separate `modules/{MODULE}/` folders | Easy to add/remove modules |
| **Configurability** | Single config property | One-line module activation |
| **Maintainability** | Clear ownership | PGR team owns `modules/PGR/*` |
| **Scalability** | Dynamic folder scanning | No hardcoded file paths |
| **Reusability** | Common folder for shared data | No duplication of base data |

---

## Folder Structure

### Complete Resource Structure

```
src/main/resources/
│
├── application.properties          # Module configuration
│
├── schema/                         # MDMS Schema Definitions
│   │
│   ├── common/                     # ALWAYS LOADED
│   │   │                           # Shared infrastructure schemas
│   │   ├── common-masters.json     # Department, IdFormat, GenderType, etc.
│   │   ├── tenant.json             # Tenant configuration schemas
│   │   ├── ACCESSCONTROL-ROLEACTIONS.json
│   │   ├── DataSecurity.json       # Encryption/masking policies
│   │   ├── Workflow.json           # Base workflow schemas
│   │   └── egov-hrms.json          # HRMS master schemas
│   │
│   └── modules/                    # LOADED IF MODULE ENABLED
│       ├── PGR/
│       │   └── RAINMAKER-PGR.json  # PGR-specific schemas
│       ├── TL/
│       │   └── TradeLicense.json   # Trade License schemas
│       ├── PT/
│       │   └── PropertyTax.json    # Property Tax schemas
│       └── WS/
│           └── WaterServices.json  # Water & Sewerage schemas
│
├── mdmsData/                       # MDMS Master Data
│   │
│   ├── common/                     # ALWAYS LOADED (Recommended: Add this)
│   │   ├── common-masters/
│   │   │   ├── common-masters.Department.json
│   │   │   ├── common-masters.GenderType.json
│   │   │   └── common-masters.Designation.json
│   │   ├── tenant/
│   │   │   └── tenant.citymodule.json
│   │   ├── DataSecurity/
│   │   │   ├── DataSecurity.EncryptionPolicy.json
│   │   │   └── DataSecurity.MaskingPatterns.json
│   │   └── Workflow/
│   │       └── Workflow.BusinessService.json
│   │
│   └── modules/                    # LOADED IF MODULE ENABLED
│       │
│       ├── PGR/                    # Complete PGR module data
│       │   ├── RAINMAKER-PGR/
│       │   │   ├── RAINMAKER-PGR.ServiceDefs.json
│       │   │   └── RAINMAKER-PGR.UIConstants.json
│       │   ├── common-masters/     # PGR-specific common masters
│       │   │   └── common-masters.IdFormat.json
│       │   └── ACCESSCONTROL/      # PGR roles & permissions
│       │       ├── ACCESSCONTROL-ROLES.roles.json
│       │       ├── ACCESSCONTROL-ROLEACTIONS.roleactions.json
│       │       └── ACCESSCONTROL-ACTIONS-TEST.actions-test.json
│       │
│       └── TL/                     # Complete TL module data
│           ├── TradeLicense/
│           │   ├── TradeLicense.TradeType.json
│           │   ├── TradeLicense.AccessoriesCategory.json
│           │   └── TradeLicense.Documents.json
│           ├── common-masters/
│           │   └── common-masters.IdFormat.json
│           └── ACCESSCONTROL/
│               └── ...
│
├── localisations/                  # UI Labels & Translations
│   │
│   ├── common/                     # ALWAYS LOADED (Recommended: Add this)
│   │   ├── en_IN/
│   │   │   └── digit-common.json
│   │   └── hi_IN/
│   │       └── digit-common.json
│   │
│   └── modules/                    # LOADED IF MODULE ENABLED
│       ├── PGR/
│       │   ├── en_IN/
│       │   │   └── rainmaker-pgr.json
│       │   └── hi_IN/
│       │       └── rainmaker-pgr.json
│       └── TL/
│           ├── en_IN/
│           │   └── rainmaker-tl.json
│           └── hi_IN/
│               └── rainmaker-tl.json
│
├── workflow/                       # Workflow Configurations
│   │
│   └── modules/                    # LOADED IF MODULE ENABLED
│       ├── PGR/
│       │   └── PgrWorkflowConfig.json
│       └── TL/
│           └── TlWorkflowConfig.json
│
├── employees/                      # Employee/User Data
│   │
│   ├── common/                     # ALWAYS LOADED (Recommended: Add this)
│   │   └── HRMS.json               # Base users (SUPERUSER, etc.)
│   │
│   └── modules/                    # LOADED IF MODULE ENABLED
│       ├── PGR/
│       │   └── HRMS.json           # PGR employees (GRO, RESOLVER)
│       └── TL/
│           └── HRMS.json           # TL employees (APPROVER, VERIFIER)
│
├── boundary/                       # Boundary Data (Always loaded)
│   ├── hierarchy-definition/
│   │   └── hierarchy.json
│   ├── entity/
│   │   └── entity.json
│   └── relationship/
│       └── relationship.json
│
└── (Legacy files - backward compatibility)
    ├── User.json
    ├── HRMS.json
    └── PgrWorkflowConfig.json
```

---

## Data Loading Flow

### Startup Sequence

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        SERVICE STARTUP SEQUENCE                             │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ STEP 1: Read Configuration                                                  │
│ ─────────────────────────────────────────────────────────────────────────── │
│   modules.enabled=PGR,TL                                                    │
│   modules.localization.enabled=true                                         │
│   modules.workflow.enabled=true                                             │
│   modules.employees.enabled=true                                            │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ STEP 2: Load Schemas (DataHandlerService.createMdmsSchemaFromFile)          │
│ ─────────────────────────────────────────────────────────────────────────── │
│   2.1  schema/common/*.json           → Always loaded                       │
│   2.2  schema/modules/PGR/*.json      → If PGR enabled                      │
│   2.3  schema/modules/TL/*.json       → If TL enabled                       │
│   2.4  schema/*.json (legacy)         → For backward compatibility          │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ STEP 3: Load MDMS Data (MdmsBulkLoader.loadAllMdmsData)                     │
│ ─────────────────────────────────────────────────────────────────────────── │
│   3.1  mdmsData/common/**/*.json      → Always loaded (if implemented)      │
│   3.2  mdmsData/modules/PGR/**/*.json → If PGR enabled                      │
│   3.3  mdmsData/modules/TL/**/*.json  → If TL enabled                       │
│   3.4  mdmsData/**/*.json (legacy)    → For backward compatibility          │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ STEP 4: Load Boundary Data                                                  │
│ ─────────────────────────────────────────────────────────────────────────── │
│   4.1  boundary/hierarchy-definition/hierarchy.json                         │
│   4.2  boundary/entity/entity.json                                          │
│   4.3  boundary/relationship/relationship.json                              │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ STEP 5: Load Localizations (LocalizationUtil)                               │
│ ─────────────────────────────────────────────────────────────────────────── │
│   5.1  localisations/common/**/*.json     → Always loaded (if implemented)  │
│   5.2  localisations/modules/PGR/**/*.json → If PGR enabled                 │
│   5.3  localisations/modules/TL/**/*.json  → If TL enabled                  │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ STEP 6: Load Workflows (DataHandlerService.createAllModuleWorkflowConfigs)  │
│ ─────────────────────────────────────────────────────────────────────────── │
│   6.1  workflow/modules/PGR/*.json    → If PGR enabled                      │
│   6.2  workflow/modules/TL/*.json     → If TL enabled                       │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ STEP 7: Create Employees (DataHandlerService.createAllModuleEmployees)      │
│ ─────────────────────────────────────────────────────────────────────────── │
│   7.1  employees/common/*.json        → Always loaded (if implemented)      │
│   7.2  employees/modules/PGR/*.json   → If PGR enabled                      │
│   7.3  employees/modules/TL/*.json    → If TL enabled                       │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                            ✅ TENANT READY
```

### Code Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     DataHandlerService.java                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  createMdmsSchemaFromFile()                                              │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ 1. loadSchemasFromPattern("schema/common/*.json")                │   │
│  │ 2. for each enabledModule:                                       │   │
│  │       loadSchemasFromPattern("schema/modules/{MOD}/*.json")      │   │
│  │ 3. loadLegacySchemas() // backward compat                        │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  createAllModuleWorkflowConfigs()                                        │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ for each enabledModule:                                          │   │
│  │   createModuleWorkflowConfig("workflow/modules/{MOD}/*.json")    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  createAllModuleEmployees()                                              │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ for each enabledModule:                                          │   │
│  │   createModuleEmployees("employees/modules/{MOD}/*.json")        │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        MdmsBulkLoader.java                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  loadAllMdmsData()                                                       │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ 1. loadCommonMdmsData() // NEW - needs implementation            │   │
│  │ 2. for each enabledModule:                                       │   │
│  │       loadModuleMdmsData("mdmsData/modules/{MOD}/**/*.json")     │   │
│  │ 3. loadLegacyMdmsData() // backward compat                       │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       LocalizationUtil.java                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  upsertLocalizationFromFile()                                            │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ 1. loadCommonLocalizations() // NEW - needs implementation       │   │
│  │ 2. for each enabledModule:                                       │   │
│  │       loadModuleLocalizations("localisations/modules/{MOD}/**")  │   │
│  │ 3. loadLegacyLocalizations() // backward compat                  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Adding a New Module

### Step-by-Step Guide: Adding Property Tax (PT) Module

#### Step 1: Create Folder Structure

```bash
# Navigate to resources folder
cd src/main/resources

# Create schema folder for PT
mkdir -p schema/modules/PT

# Create mdmsData folders for PT
mkdir -p mdmsData/modules/PT/PropertyTax
mkdir -p mdmsData/modules/PT/ACCESSCONTROL
mkdir -p mdmsData/modules/PT/common-masters

# Create localization folders
mkdir -p localisations/modules/PT/en_IN
mkdir -p localisations/modules/PT/hi_IN

# Create workflow folder
mkdir -p workflow/modules/PT

# Create employees folder
mkdir -p employees/modules/PT
```

#### Step 2: Add Schema Definition

Create `schema/modules/PT/PropertyTax.json`:

```json
[
  {
    "tenantId": "{tenantid}",
    "code": "PropertyTax.PropertyType",
    "description": "Property types for property tax",
    "isActive": true,
    "definition": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "required": ["code", "name", "active"],
      "x-unique": ["code"],
      "properties": {
        "code": { "type": "string" },
        "name": { "type": "string" },
        "active": { "type": "boolean" }
      }
    }
  },
  {
    "tenantId": "{tenantid}",
    "code": "PropertyTax.UsageCategory",
    "description": "Usage categories for properties",
    "isActive": true,
    "definition": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "required": ["code", "name"],
      "x-unique": ["code"],
      "properties": {
        "code": { "type": "string" },
        "name": { "type": "string" },
        "fromFY": { "type": "string" },
        "toFY": { "type": "string" }
      }
    }
  }
]
```

#### Step 3: Add MDMS Data Files

Create `mdmsData/modules/PT/PropertyTax/PropertyTax.PropertyType.json`:

```json
[
  {
    "code": "BUILTUP",
    "name": "Built Up",
    "active": true
  },
  {
    "code": "VACANT",
    "name": "Vacant Land",
    "active": true
  },
  {
    "code": "BUILTUP.INDEPENDENTPROPERTY",
    "name": "Independent Property",
    "active": true
  }
]
```

Create `mdmsData/modules/PT/ACCESSCONTROL/ACCESSCONTROL-ROLES.roles.json`:

```json
[
  {
    "code": "PT_CEMP",
    "name": "PT Counter Employee",
    "labelKey": "ACCESSCONTROL_ROLES_ROLES_PT_CEMP",
    "tenantId": "{tenantid}"
  },
  {
    "code": "PT_DOC_VERIFIER",
    "name": "PT Document Verifier",
    "labelKey": "ACCESSCONTROL_ROLES_ROLES_PT_DOC_VERIFIER",
    "tenantId": "{tenantid}"
  },
  {
    "code": "PT_FIELD_INSPECTOR",
    "name": "PT Field Inspector",
    "labelKey": "ACCESSCONTROL_ROLES_ROLES_PT_FIELD_INSPECTOR",
    "tenantId": "{tenantid}"
  },
  {
    "code": "PT_APPROVER",
    "name": "PT Approver",
    "labelKey": "ACCESSCONTROL_ROLES_ROLES_PT_APPROVER",
    "tenantId": "{tenantid}"
  }
]
```

#### Step 4: Add Localization

Create `localisations/modules/PT/en_IN/rainmaker-pt.json`:

```json
[
  {
    "code": "PT_PROPERTY_TYPE_BUILTUP",
    "message": "Built Up",
    "module": "rainmaker-pt",
    "locale": "en_IN"
  },
  {
    "code": "PT_PROPERTY_TYPE_VACANT",
    "message": "Vacant Land",
    "module": "rainmaker-pt",
    "locale": "en_IN"
  },
  {
    "code": "PT_COMMON_TABLE_COL_PROPERTY_ID",
    "message": "Property ID",
    "module": "rainmaker-pt",
    "locale": "en_IN"
  }
]
```

#### Step 5: Add Workflow Configuration

Create `workflow/modules/PT/PtWorkflowConfig.json`:

```json
{
  "RequestInfo": {
    "apiId": "Rainmaker",
    "ver": ".01"
  },
  "BusinessServices": [
    {
      "tenantId": "{tenantid}",
      "businessService": "PT.CREATE",
      "business": "PT",
      "businessServiceSla": 432000000,
      "states": [
        {
          "sla": null,
          "state": null,
          "applicationStatus": null,
          "docUploadRequired": false,
          "isStartState": true,
          "isTerminateState": false,
          "isStateUpdatable": true,
          "actions": [
            {
              "action": "OPEN",
              "nextState": "OPEN",
              "roles": ["CITIZEN", "PT_CEMP"]
            }
          ]
        },
        {
          "sla": 86400000,
          "state": "OPEN",
          "applicationStatus": "INWORKFLOW",
          "docUploadRequired": false,
          "isStartState": false,
          "isTerminateState": false,
          "isStateUpdatable": true,
          "actions": [
            {
              "action": "VERIFY",
              "nextState": "DOCVERIFIED",
              "roles": ["PT_DOC_VERIFIER"]
            },
            {
              "action": "REJECT",
              "nextState": "REJECTED",
              "roles": ["PT_DOC_VERIFIER"]
            }
          ]
        },
        {
          "sla": null,
          "state": "APPROVED",
          "applicationStatus": "APPROVED",
          "docUploadRequired": false,
          "isStartState": false,
          "isTerminateState": true
        }
      ]
    }
  ]
}
```

#### Step 6: Add Employees

Create `employees/modules/PT/HRMS.json`:

```json
[
  {
    "code": "PT-VERIFIER-001",
    "dateOfAppointment": 1640995200000,
    "employeeStatus": "EMPLOYED",
    "employeeType": "PERMANENT",
    "tenantId": "{tenantid}",
    "jurisdictions": [
      {
        "hierarchy": "ADMIN",
        "boundary": "{tenantid}",
        "boundaryType": "City",
        "tenantId": "{tenantid}",
        "roles": [
          {
            "code": "PT_DOC_VERIFIER",
            "name": "PT Document Verifier",
            "tenantId": "{tenantid}"
          },
          {
            "code": "EMPLOYEE",
            "name": "Employee",
            "tenantId": "{tenantid}"
          }
        ]
      }
    ],
    "user": {
      "userName": "PT-VERIFIER",
      "name": "PT Verifier",
      "gender": "MALE",
      "mobileNumber": "9999999991",
      "tenantId": "{tenantid}",
      "roles": [
        {
          "code": "PT_DOC_VERIFIER",
          "name": "PT Document Verifier",
          "tenantId": "{tenantid}"
        },
        {
          "code": "EMPLOYEE",
          "name": "Employee",
          "tenantId": "{tenantid}"
        }
      ]
    }
  }
]
```

#### Step 7: Enable the Module

Update `application.properties`:

```properties
# Before
modules.enabled=PGR,TL

# After
modules.enabled=PGR,TL,PT
```

#### Step 8: Verify

Restart the service and check logs:

```bash
# You should see:
# [INFO] Found 1 schema files for PT
# [INFO] [PT] Schema created: PropertyTax.PropertyType
# [INFO] Found 3 MDMS data files for module: PT
# [INFO] Created MDMS entry for schemaCode: PropertyTax.PropertyType
# [INFO] Created workflow config from PtWorkflowConfig.json for module: PT
# [INFO] Employee created successfully for module PT: PT-VERIFIER-001
```

---

## Configuration Reference

### Main Configuration Properties

```properties
# ═══════════════════════════════════════════════════════════════════════════
# MODULE CONFIGURATION (Master Switch)
# ═══════════════════════════════════════════════════════════════════════════

# Comma-separated list of enabled modules
# Available: PGR, TL, PT, WS, SW, FSM, BPA, etc.
modules.enabled=PGR,TL

# Feature toggles (all default to true)
modules.localization.enabled=true
modules.workflow.enabled=true
modules.employees.enabled=true

# ═══════════════════════════════════════════════════════════════════════════
# MDMS CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════

egov.mdms.host=http://localhost:8081
egov.mdms.schema.create.endpoint=/mdms-v2/schema/v1/_create
egov.mdms.data.create.endpoint=/mdms-v2/v2/_create/{schemaCode}

# Legacy schema code mapping (for backward compatibility)
mdms.schemacode.map={PGR:'RAINMAKER-PGR.ServiceDefs,common-masters.Department'}

# ═══════════════════════════════════════════════════════════════════════════
# LOCALIZATION CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════

egov.localization.host=http://localhost:8087
egov.localization.upsert.path=/localization/messages/v1/_upsert

# Supported locales
default.localization.locale.list=en_IN,hi_IN

# ═══════════════════════════════════════════════════════════════════════════
# WORKFLOW CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════

egov.workflow.host=http://localhost:8082
egov.workflow.businessservice.create.path=/egov-workflow-v2/egov-wf/businessservice/_create

# ═══════════════════════════════════════════════════════════════════════════
# HRMS CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════

egov.hrms.host=http://localhost:8084
egov.hrms.path=/egov-hrms/employees/_create

# ═══════════════════════════════════════════════════════════════════════════
# TENANT CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════

default.tenant.id=statea
```

### Module-Specific Configuration

Each module can have its own settings in the config:

```properties
# PGR-specific settings (example)
pgr.complaint.types.default=StreetLights,Garbage,WaterSupply

# TL-specific settings (example)
tl.license.validity.days=365
```

---

## Best Practices

### 1. File Naming Conventions

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Resource Type     │ Naming Pattern                │ Example                │
├───────────────────┼───────────────────────────────┼────────────────────────┤
│ Schema file       │ {SchemaPrefix}.json           │ RAINMAKER-PGR.json     │
│ MDMS data file    │ {schemaCode}.json             │ RAINMAKER-PGR.Service  │
│                   │                               │ Defs.json              │
│ Workflow file     │ {Module}WorkflowConfig.json   │ PgrWorkflowConfig.json │
│ Employee file     │ HRMS.json                     │ HRMS.json              │
│ Localization file │ {module-name}.json            │ rainmaker-pgr.json     │
└────────────────────────────────────────────────────────────────────────────┘
```

### 2. Tenant ID Placeholder

**Always use `{tenantid}` as a placeholder** - it gets replaced at runtime:

```json
{
  "tenantId": "{tenantid}",
  "code": "DEPT_ADMIN",
  "name": "Administration"
}
```

### 3. Schema Code Format

Use dot notation for schema codes:

```
{Module}.{Entity}

Examples:
- RAINMAKER-PGR.ServiceDefs
- PropertyTax.PropertyType
- common-masters.Department
- TradeLicense.TradeType
```

### 4. Module Isolation

Each module should be **completely self-contained**:

```
modules/PGR/
├── RAINMAKER-PGR/              # Module-specific data
│   └── RAINMAKER-PGR.ServiceDefs.json
├── common-masters/             # Module's required common data
│   └── common-masters.IdFormat.json
└── ACCESSCONTROL/              # Module's roles & permissions
    ├── ACCESSCONTROL-ROLES.roles.json
    └── ACCESSCONTROL-ROLEACTIONS.roleactions.json
```

### 5. Error Handling

The system continues processing even if individual files fail:

```java
// From DataHandlerService.java
try {
    // Process schema
} catch (Exception innerEx) {
    log.error("[{}] Failed to create schema: {}. Skipping...", source, schemaNode.get("code"));
    // Continue with next schema - don't fail entire process
}
```

---

## Troubleshooting

### Common Issues

#### 1. Module Not Loading

**Symptom:** Schema/data not being created for a module

**Check:**
```bash
# 1. Verify module is in config
grep "modules.enabled" application.properties
# Should show: modules.enabled=PGR,TL,PT

# 2. Verify folder exists
ls -la src/main/resources/schema/modules/PT/

# 3. Check logs for scanning
grep "Found.*schema files for PT" logs/app.log
```

**Fix:** Ensure module name in config matches folder name exactly (case-sensitive)

#### 2. Schema Creation Failed

**Symptom:** `Failed to create schema: XYZ for tenant: abc`

**Check:**
```bash
# 1. Validate JSON syntax
python -m json.tool schema/modules/PT/PropertyTax.json

# 2. Check schema structure
cat schema/modules/PT/PropertyTax.json | jq '.[0].code'
```

**Fix:** Ensure JSON is valid and has required fields: `code`, `tenantId`, `definition`

#### 3. MDMS Data Not Loading

**Symptom:** Empty responses from MDMS search

**Check:**
```bash
# 1. Verify file naming matches schema code
# File: mdmsData/modules/PGR/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json
# Schema code should be: RAINMAKER-PGR.ServiceDefs

# 2. Check file is valid JSON array
cat mdmsData/modules/PGR/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json | jq 'type'
# Should output: "array"
```

**Fix:** Ensure filename (without .json) exactly matches the schema code

#### 4. Tenant ID Not Replaced

**Symptom:** Data contains literal `{tenantid}` instead of actual tenant

**Check:**
```json
// Correct format
{
  "tenantId": "{tenantid}",  // Note: lowercase 'tenantid'
  "code": "XYZ"
}

// Wrong format (won't be replaced)
{
  "tenantId": "{tenantId}",  // Wrong: capital 'I'
  "tenantId": "${tenantid}", // Wrong: dollar sign
}
```

### Debug Mode

Enable detailed logging:

```properties
logging.level.org.egov.handler=DEBUG
logging.level.org.springframework.web=DEBUG
```

### Health Check Endpoints

```bash
# Manually trigger data setup
curl -X POST http://localhost:8080/default-data-handler/defaultdata/setup \
  -H "Content-Type: application/json" \
  -d '{
    "RequestInfo": {...},
    "targetTenantId": "statea.city1"
  }'
```

---

## Appendix: Quick Reference Card

```
┌────────────────────────────────────────────────────────────────────────────┐
│                    DEFAULT DATA HANDLER - QUICK REFERENCE                   │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ENABLE A MODULE:                                                          │
│  ─────────────────                                                         │
│  modules.enabled=PGR,TL,PT    (in application.properties)                  │
│                                                                            │
│  ADD MODULE DATA:                                                          │
│  ────────────────                                                          │
│  1. schema/modules/{MOD}/*.json        → Schema definitions                │
│  2. mdmsData/modules/{MOD}/**/*.json   → Master data                       │
│  3. localisations/modules/{MOD}/**/*   → UI labels                         │
│  4. workflow/modules/{MOD}/*.json      → Workflow configs                  │
│  5. employees/modules/{MOD}/*.json     → Module employees                  │
│                                                                            │
│  PLACEHOLDER:                                                              │
│  ────────────                                                              │
│  {tenantid}  → Replaced with actual tenant ID at runtime                   │
│                                                                            │
│  FILE NAMING:                                                              │
│  ────────────                                                              │
│  Schema code: Module.Entity        → RAINMAKER-PGR.ServiceDefs             │
│  File name:   {schemaCode}.json    → RAINMAKER-PGR.ServiceDefs.json        │
│                                                                            │
│  KEY CLASSES:                                                              │
│  ────────────                                                              │
│  DataHandlerService.java   → Main orchestrator                             │
│  MdmsBulkLoader.java       → MDMS data loading                             │
│  LocalizationUtil.java     → Localization loading                          │
│  ServiceConfiguration.java → Config properties bean                        │
│                                                                            │
│  LOADING ORDER:                                                            │
│  ─────────────                                                             │
│  1. Common schemas    → 2. Module schemas                                  │
│  3. Common MDMS data  → 4. Module MDMS data                                │
│  5. Boundary data     → 6. Localizations                                   │
│  7. Workflows         → 8. Employees                                       │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Dec 2024 | Initial module-based architecture |
| 1.1 | Dec 2024 | Added common folder support recommendation |

---

*Document maintained by the DIGIT Platform Team*
