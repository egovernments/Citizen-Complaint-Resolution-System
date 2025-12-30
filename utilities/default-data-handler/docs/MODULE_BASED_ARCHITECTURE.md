# Default Data Handler - Module-Based Architecture

## Table of Contents
1. [Overview](#overview)
2. [Problem Statement](#problem-statement)
3. [Solution: Module-Based Architecture](#solution-module-based-architecture)
4. [Architecture Comparison](#architecture-comparison)
5. [Folder Structure](#folder-structure)
6. [Code Changes Explained](#code-changes-explained)
7. [Configuration](#configuration)
8. [Data File Formats](#data-file-formats)
9. [How To: Add a New Module](#how-to-add-a-new-module)
10. [How To: Remove a Module](#how-to-remove-a-module)
11. [Startup Flow](#startup-flow)
12. [Troubleshooting](#troubleshooting)

---

## Overview

The **Default Data Handler** service is responsible for bootstrapping a new tenant with all required master data when a tenant is created in the DIGIT platform. This includes:

| Data Type | Description |
|-----------|-------------|
| **MDMS Schemas** | JSON Schema definitions for master data validation |
| **MDMS Data** | Master data records (departments, roles, service definitions, etc.) |
| **Localizations** | UI labels in multiple languages (en_IN, hi_IN, etc.) |
| **Workflows** | Business service workflow configurations (states, actions, SLAs) |
| **Employees** | Default employees with module-specific roles |

---

## Problem Statement

### Before: Hardcoded PGR-Specific Implementation

The original implementation was tightly coupled to the PGR (Public Grievance Redressal) module:

```
Problems:
1. MDMS data files contained PGR-specific data mixed with "common" data
2. Workflow loading was hardcoded: createPgrWorkflowConfig()
3. Employee creation used a single HRMS.json with PGR roles (RESOLVER, ASSIGNER)
4. Localizations were in flat folders without module separation
5. Adding a new module required code changes in multiple Java files
```

**Example of hardcoded logic (DataHandlerService.java - BEFORE):**
```java
if (Objects.equals(dataSetupRequest.getModule(), "PGR")) {
    createPgrWorkflowConfig(dataSetupRequest.getTargetTenantId());  // Hardcoded!
}
```

---

## Solution: Module-Based Architecture

### After: Generic Module-Driven Implementation

The service now uses a **configuration-driven, folder-scanning approach**:

```
Solution:
1. Each module has its own isolated folder with complete data
2. Modules are enabled/disabled via application.properties
3. Code scans folders dynamically based on enabled modules
4. Zero code changes required to add new modules
```

**Key Principle:**
> "Drop files in the right folder, add module name to config, restart - done."

---

## Architecture Comparison

### BEFORE (Hardcoded)

```
┌─────────────────────────────────────────────────────────┐
│                    application.properties                │
│                    (No module config)                    │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│                   DataHandlerService                     │
│  ┌─────────────────────────────────────────────────┐    │
│  │ if (module == "PGR") {                          │    │
│  │     createPgrWorkflowConfig();  // Hardcoded    │    │
│  │ }                                               │    │
│  │ if (module == "HRMS") {                         │    │
│  │     // Different hardcoded logic                │    │
│  │ }                                               │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│                   resources/                             │
│  ├── mdmsData/           (Mixed PGR + common data)      │
│  ├── localisations/      (Flat structure)               │
│  ├── PgrWorkflowConfig.json  (Single file)              │
│  └── HRMS.json               (PGR employees only)       │
└─────────────────────────────────────────────────────────┘
```

### AFTER (Generic)

```
┌─────────────────────────────────────────────────────────┐
│                    application.properties                │
│              modules.enabled=PGR,TL,PT                   │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│                   DataHandlerService                     │
│  ┌─────────────────────────────────────────────────┐    │
│  │ for (String module : enabledModules) {          │    │
│  │     loadModuleMdmsData(module);                 │    │
│  │     loadModuleLocalizations(module);            │    │
│  │     createModuleWorkflowConfig(module);         │    │
│  │     createModuleEmployees(module);              │    │
│  │ }                                               │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│                   resources/                             │
│  ├── mdmsData/modules/                                  │
│  │   ├── PGR/            (Complete PGR data)            │
│  │   ├── TL/             (Complete TL data)             │
│  │   └── PT/             (Complete PT data)             │
│  ├── workflow/modules/                                  │
│  │   ├── PGR/            (PGR workflows)                │
│  │   ├── TL/             (TL workflows)                 │
│  │   └── PT/             (PT workflows)                 │
│  ├── employees/modules/                                 │
│  │   ├── PGR/            (PGR employees)                │
│  │   ├── TL/             (TL employees)                 │
│  │   └── PT/             (PT employees)                 │
│  └── localisations/modules/                             │
│      ├── PGR/{locale}/   (PGR labels)                   │
│      ├── TL/{locale}/    (TL labels)                    │
│      └── PT/{locale}/    (PT labels)                    │
└─────────────────────────────────────────────────────────┘
```

---

## Folder Structure

### Complete Resource Folder Structure

```
src/main/resources/
│
├── application.properties          # Module configuration here
│
├── schema/                         # MDMS Schema definitions
│   ├── common/                     # COMMON schemas (always loaded)
│   │   ├── ACCESSCONTROL-ROLEACTIONS.json
│   │   ├── common-masters.json
│   │   ├── DataSecurity.json
│   │   ├── egov-hrms.json
│   │   ├── tenant.json
│   │   └── Workflow.json
│   │
│   └── modules/                    # MODULE-SPECIFIC schemas
│       ├── PGR/
│       │   └── RAINMAKER-PGR.json
│       ├── TL/
│       │   └── TradeLicense.json
│       └── PT/
│           └── PropertyTax.json    # (example)
│
├── mdmsData/
│   ├── modules/                    # NEW: Module-based structure
│   │   ├── PGR/
│   │   │   ├── RAINMAKER-PGR/
│   │   │   │   └── RAINMAKER-PGR.ServiceDefs.json
│   │   │   ├── common-masters/
│   │   │   │   ├── common-masters.Department.json
│   │   │   │   └── common-masters.IdFormat.json
│   │   │   ├── ACCESSCONTROL-ROLE/
│   │   │   │   └── ACCESSCONTROL-ROLES.roles.json
│   │   │   ├── ACCESSCONTROL-ROLEACTIONS/
│   │   │   │   └── ACCESSCONTROL-ROLEACTIONS.roleactions.json
│   │   │   └── ACCESSCONTROL-ACTIONS-TEST/
│   │   │       └── ACCESSCONTROL-ACTIONS-TEST.actions-test.json
│   │   │
│   │   └── TL/
│   │       ├── TradeLicense/
│   │       │   ├── TradeLicense.TradeType.json
│   │       │   ├── TradeLicense.ApplicationType.json
│   │       │   └── TradeLicense.AccessoriesCategory.json
│   │       ├── common-masters/
│   │       │   ├── common-masters.Department.json
│   │       │   └── common-masters.IdFormat.json
│   │       ├── ACCESSCONTROL-ROLE/
│   │       │   └── ACCESSCONTROL-ROLES.roles.json
│   │       ├── ACCESSCONTROL-ROLEACTIONS/
│   │       │   └── ACCESSCONTROL-ROLEACTIONS.roleactions.json
│   │       └── ACCESSCONTROL-ACTIONS-TEST/
│   │           └── ACCESSCONTROL-ACTIONS-TEST.actions-test.json
│   │
│   └── (legacy files - still supported for backward compatibility)
│
├── workflow/
│   ├── modules/                    # NEW: Module-based workflows
│   │   ├── PGR/
│   │   │   └── PgrWorkflowConfig.json
│   │   └── TL/
│   │       └── TlWorkflowConfig.json
│   │
│   └── PgrWorkflowConfig.json      # Legacy (still supported)
│
├── employees/
│   ├── modules/                    # NEW: Module-based employees
│   │   ├── PGR/
│   │   │   └── HRMS.json
│   │   └── TL/
│   │       └── HRMS.json
│   │
│   └── HRMS.json                   # Legacy (still supported)
│
└── localisations/
    ├── modules/                    # NEW: Module-based localizations
    │   ├── PGR/
    │   │   ├── en_IN/
    │   │   │   └── rainmaker-pgr.json
    │   │   └── hi_IN/
    │   │       └── rainmaker-pgr.json
    │   └── TL/
    │       ├── en_IN/
    │       │   └── rainmaker-tl.json
    │       └── hi_IN/
    │           └── rainmaker-tl.json
    │
    ├── en_IN/                      # Legacy (still supported)
    └── hi_IN/                      # Legacy (still supported)
```

---

## Code Changes Explained

### 1. ServiceConfiguration.java

**Location:** `src/main/java/org/egov/handler/config/ServiceConfiguration.java`

**What was added:**
```java
// Module Configuration
@Value("#{'${modules.enabled:}'.split(',')}")
private List<String> enabledModules;

@Value("${modules.localization.enabled:true}")
private boolean localizationModuleEnabled;

@Value("${modules.workflow.enabled:true}")
private boolean workflowModuleEnabled;

@Value("${modules.employees.enabled:true}")
private boolean employeesModuleEnabled;
```

**Purpose:**
- Reads the list of enabled modules from config
- Provides feature flags to enable/disable specific data types

---

### 2. MdmsBulkLoader.java

**Location:** `src/main/java/org/egov/handler/util/MdmsBulkLoader.java`

**What was added:**

```java
/**
 * Load MDMS data for all enabled modules
 */
public void loadAllMdmsData(String tenantId, RequestInfo requestInfo) {
    List<String> enabledModules = serviceConfig.getEnabledModules();

    if (enabledModules == null || enabledModules.isEmpty()) {
        // Backward compatibility: load from legacy folder
        loadLegacyMdmsData(tenantId, requestInfo);
        return;
    }

    // Load each enabled module
    for (String module : enabledModules) {
        loadModuleMdmsData(tenantId, requestInfo, module.trim());
    }
}

/**
 * Load MDMS data for a specific module
 * Scans: classpath:mdmsData/modules/{MODULE}/**/*.json
 */
public void loadModuleMdmsData(String tenantId, RequestInfo requestInfo, String moduleName) {
    PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
    String pattern = "classpath:mdmsData/modules/" + moduleName + "/**/*.json";

    Resource[] resources = resolver.getResources(pattern);

    for (Resource resource : resources) {
        processResource(tenantId, requestInfo, resource);
    }
}
```

**How it works:**
```
1. Read modules.enabled from config → ["PGR", "TL"]
2. For each module:
   - Build pattern: "classpath:mdmsData/modules/PGR/**/*.json"
   - Scan all JSON files recursively
   - For each file:
     - Extract schemaCode from filename (e.g., "RAINMAKER-PGR.ServiceDefs")
     - Replace {tenantid} placeholder with actual tenant
     - POST to MDMS create API
```

---

### 3. LocalizationUtil.java

**Location:** `src/main/java/org/egov/handler/util/LocalizationUtil.java`

**What was added:**

```java
/**
 * Load localizations from module folders + legacy folders
 */
public List<Message> addMessagesFromFile(DefaultDataRequest defaultDataRequest) {
    List<Message> messages = new ArrayList<>();
    List<String> enabledModules = serviceConfig.getEnabledModules();

    // Load from module folders
    if (enabledModules != null && !enabledModules.isEmpty()) {
        for (String module : enabledModules) {
            messages.addAll(loadModuleLocalizations(objectMapper, module.trim()));
        }
    }

    // Also load legacy localizations for backward compatibility
    messages.addAll(loadLegacyLocalizations(objectMapper));

    return messages;
}

/**
 * Load localizations for a specific module
 * Scans: classpath:localisations/modules/{MODULE}/**/*.json
 */
private List<Message> loadModuleLocalizations(ObjectMapper objectMapper, String moduleName) {
    String pattern = "classpath:localisations/modules/" + moduleName + "/**/*.json";
    Resource[] resources = resolver.getResources(pattern);

    for (Resource resource : resources) {
        // Parse JSON array of Message objects
        List<Message> fileMessages = Arrays.asList(
            objectMapper.readValue(inputStream, Message[].class)
        );
        messages.addAll(fileMessages);
    }
    return messages;
}
```

**How it works:**
```
1. Read modules.enabled → ["PGR", "TL"]
2. For each module:
   - Scan "classpath:localisations/modules/TL/**/*.json"
   - This picks up:
     - localisations/modules/TL/en_IN/rainmaker-tl.json
     - localisations/modules/TL/hi_IN/rainmaker-tl.json
3. Combine all messages
4. Batch upsert to localization service (100 messages per batch)
```

---

### 4. DataHandlerService.java

**Location:** `src/main/java/org/egov/handler/service/DataHandlerService.java`

**What was added:**

#### Workflow Loading:
```java
/**
 * Create workflow configs for all enabled modules
 */
public void createAllModuleWorkflowConfigs(String targetTenantId) {
    List<String> enabledModules = serviceConfig.getEnabledModules();

    if (enabledModules == null || enabledModules.isEmpty()) {
        // Fallback to legacy PGR workflow
        createPgrWorkflowConfig(targetTenantId);
        return;
    }

    for (String module : enabledModules) {
        createModuleWorkflowConfig(targetTenantId, module.trim());
    }
}

/**
 * Create workflow for a specific module
 * Scans: classpath:workflow/modules/{MODULE}/*.json
 */
public void createModuleWorkflowConfig(String targetTenantId, String moduleName) {
    String pattern = "classpath:workflow/modules/" + moduleName + "/*.json";
    Resource[] resources = resolver.getResources(pattern);

    for (Resource resource : resources) {
        // Read workflow config
        BusinessServiceRequest request = objectMapper.readValue(rawJson, BusinessServiceRequest.class);
        // Set tenant ID
        request.getBusinessServices().forEach(service -> service.setTenantId(targetTenantId));
        // Create via workflow service
        workflowUtil.createWfConfig(request);
    }
}
```

#### Employee Loading:
```java
/**
 * Create employees for all enabled modules
 */
public void createAllModuleEmployees(RequestInfo requestInfo) {
    List<String> enabledModules = serviceConfig.getEnabledModules();

    if (enabledModules == null || enabledModules.isEmpty()) {
        // Fallback to legacy HRMS.json
        createEmployeeFromFile(requestInfo);
        return;
    }

    for (String module : enabledModules) {
        createModuleEmployees(requestInfo, module.trim());
    }
}

/**
 * Create employees for a specific module
 * Scans: classpath:employees/modules/{MODULE}/*.json
 */
public void createModuleEmployees(RequestInfo requestInfo, String moduleName) {
    String pattern = "classpath:employees/modules/" + moduleName + "/*.json";
    Resource[] resources = resolver.getResources(pattern);

    for (Resource resource : resources) {
        // Read employee array
        ArrayNode employeesArray = objectMapper.readTree(rawJson);

        for (JsonNode employeeNode : employeesArray) {
            // Create employee via HRMS
            // Update password
        }
    }
}
```

---

## Configuration

### application.properties

```properties
#========================================
# MODULE CONFIGURATION
#========================================

# Comma-separated list of modules to load data for
# Add or remove modules here - no code changes needed
modules.enabled=PGR,TL

# Feature flags (all default to true)
modules.localization.enabled=true
modules.workflow.enabled=true
modules.employees.enabled=true
```

### Configuration Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `modules.enabled` | List | empty | Modules to bootstrap (e.g., `PGR,TL,PT`) |
| `modules.localization.enabled` | boolean | true | Load localization messages |
| `modules.workflow.enabled` | boolean | true | Create workflow configs |
| `modules.employees.enabled` | boolean | true | Create default employees |

---

## Data File Formats

### 1. MDMS Data Files

**Location:** `mdmsData/modules/{MODULE}/{SchemaPrefix}/{schemaCode}.json`

**Format:** JSON Array of objects
```json
[
  {
    "field1": "value1",
    "field2": "value2",
    "tenantId": "{tenantid}"    // Placeholder - replaced at runtime
  },
  {
    "field1": "value3",
    "field2": "value4",
    "tenantId": "{tenantid}"
  }
]
```

**Example:** `mdmsData/modules/TL/TradeLicense/TradeLicense.TradeType.json`
```json
[
  {
    "code": "GOODS.GROCERY",
    "name": "Grocery Store",
    "type": "GOODS",
    "uom": "SQFT",
    "active": true
  }
]
```

**Naming Convention:**
- Filename = schemaCode (e.g., `TradeLicense.TradeType.json`)
- This is used to identify which MDMS schema to create data for

---

### 2. Workflow Config Files

**Location:** `workflow/modules/{MODULE}/{Name}WorkflowConfig.json`

**Format:** BusinessServiceRequest
```json
{
  "RequestInfo": {},
  "BusinessServices": [
    {
      "tenantId": "{tenantid}",
      "businessService": "TL",
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
              "roles": ["TL_CEMP", "CITIZEN"]
            }
          ]
        }
        // ... more states
      ]
    }
  ]
}
```

---

### 3. Employee Files (HRMS)

**Location:** `employees/modules/{MODULE}/HRMS.json`

**Format:** JSON Array of Employee objects
```json
[
  {
    "tenantId": "{tenantid}",
    "employeeStatus": "EMPLOYED",
    "code": "TL_DOC_VERIFIER_01",
    "dateOfAppointment": 1596220200000,
    "jurisdictions": [
      {
        "hierarchy": "ADMIN",
        "boundaryType": "City",
        "boundary": "{tenantid}",
        "tenantId": "{tenantid}",
        "roles": [
          {
            "code": "TL_DOC_VERIFIER",
            "name": "TL Doc Verifier",
            "tenantId": "{tenantid}"
          }
        ]
      }
    ],
    "user": {
      "name": "TL Document Verifier",
      "mobileNumber": "9999999401",
      "type": "EMPLOYEE",
      "emailId": "tldocverifier@test.com",
      "roles": [
        {
          "code": "TL_DOC_VERIFIER",
          "name": "TL Doc Verifier",
          "tenantId": "{tenantid}"
        }
      ],
      "password": "eGov@123",
      "tenantId": "{tenantid}"
    },
    "assignments": [
      {
        "fromDate": 1596220200000,
        "isCurrentAssignment": true,
        "department": "TL_DEPT",
        "designation": "CLERK"
      }
    ]
  }
]
```

**Important:** Employee roles must match the workflow state roles!

---

### 4. Localization Files

**Location:** `localisations/modules/{MODULE}/{locale}/{module-name}.json`

**Format:** JSON Array of Message objects
```json
[
  {
    "code": "TL_COMMON_TABLE_COL_APP_NO",
    "message": "Application No.",
    "module": "rainmaker-tl",
    "locale": "en_IN"
  },
  {
    "code": "TL_STATUS_APPROVED",
    "message": "Approved",
    "module": "rainmaker-tl",
    "locale": "en_IN"
  }
]
```

---

## How To: Add a New Module

### Step-by-Step Guide for Adding Property Tax (PT) Module

#### Step 1: Update Configuration
```properties
# application.properties
modules.enabled=PGR,TL,PT    # Add PT here
```

#### Step 2: Create Folder Structure
```bash
# Create all required folders
mkdir -p src/main/resources/mdmsData/modules/PT/PropertyTax
mkdir -p src/main/resources/mdmsData/modules/PT/common-masters
mkdir -p src/main/resources/mdmsData/modules/PT/ACCESSCONTROL-ROLE
mkdir -p src/main/resources/mdmsData/modules/PT/ACCESSCONTROL-ROLEACTIONS
mkdir -p src/main/resources/mdmsData/modules/PT/ACCESSCONTROL-ACTIONS-TEST
mkdir -p src/main/resources/workflow/modules/PT
mkdir -p src/main/resources/employees/modules/PT
mkdir -p src/main/resources/localisations/modules/PT/en_IN
mkdir -p src/main/resources/localisations/modules/PT/hi_IN
```

#### Step 3: Add MDMS Data Files
Create JSON files in respective folders:
- `mdmsData/modules/PT/PropertyTax/PropertyTax.PropertyType.json`
- `mdmsData/modules/PT/common-masters/common-masters.Department.json`
- `mdmsData/modules/PT/ACCESSCONTROL-ROLE/ACCESSCONTROL-ROLES.roles.json`
- etc.

#### Step 4: Add Workflow Config
Create `workflow/modules/PT/PtWorkflowConfig.json` with PT workflow states.

#### Step 5: Add Employees
Create `employees/modules/PT/HRMS.json` with PT-specific employees:
- PT_DOC_VERIFIER
- PT_FIELD_INSPECTOR
- PT_APPROVER

#### Step 6: Add Localizations
Create localization files:
- `localisations/modules/PT/en_IN/rainmaker-pt.json`
- `localisations/modules/PT/hi_IN/rainmaker-pt.json`

#### Step 7: Restart Service
```bash
mvn spring-boot:run
```

**That's it! No code changes required.**

---

## How To: Remove a Module

### To Remove TL Module

#### Option 1: Disable in Config (Recommended)
```properties
# application.properties
modules.enabled=PGR    # Remove TL from list
```

#### Option 2: Delete Files (Permanent)
```bash
rm -rf src/main/resources/mdmsData/modules/TL
rm -rf src/main/resources/workflow/modules/TL
rm -rf src/main/resources/employees/modules/TL
rm -rf src/main/resources/localisations/modules/TL
```

---

## Startup Flow

### Complete Data Loading Sequence

```
┌─────────────────────────────────────────────────────────────────────┐
│                     SERVICE STARTUP                                  │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  1. Read application.properties                                      │
│     modules.enabled = PGR, TL                                        │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  2. TENANT CREATION EVENT RECEIVED                                   │
│     Kafka: create-tenant topic                                       │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  3. FOR EACH ENABLED MODULE (PGR, TL):                              │
│                                                                      │
│     ┌─────────────────────────────────────────────────────────┐     │
│     │  3a. Load MDMS Schemas                                   │     │
│     │      Scan: schema/*.json                                 │     │
│     │      POST: /mdms-v2/schema/v1/_create                    │     │
│     └─────────────────────────────────────────────────────────┘     │
│                              │                                       │
│                              ▼                                       │
│     ┌─────────────────────────────────────────────────────────┐     │
│     │  3b. Load MDMS Data                                      │     │
│     │      Scan: mdmsData/modules/{MODULE}/**/*.json           │     │
│     │      POST: /mdms-v2/v2/_create/{schemaCode}              │     │
│     └─────────────────────────────────────────────────────────┘     │
│                              │                                       │
│                              ▼                                       │
│     ┌─────────────────────────────────────────────────────────┐     │
│     │  3c. Load Localizations                                  │     │
│     │      Scan: localisations/modules/{MODULE}/**/*.json      │     │
│     │      POST: /localization/messages/v1/_upsert             │     │
│     │      (Batched: 100 messages per request)                 │     │
│     └─────────────────────────────────────────────────────────┘     │
│                              │                                       │
│                              ▼                                       │
│     ┌─────────────────────────────────────────────────────────┐     │
│     │  3d. Create Workflow Config                              │     │
│     │      Scan: workflow/modules/{MODULE}/*.json              │     │
│     │      POST: /egov-workflow-v2/egov-wf/businessservice/_create│  │
│     └─────────────────────────────────────────────────────────┘     │
│                              │                                       │
│                              ▼                                       │
│     ┌─────────────────────────────────────────────────────────┐     │
│     │  3e. Create Employees                                    │     │
│     │      Scan: employees/modules/{MODULE}/*.json             │     │
│     │      POST: /egov-hrms/employees/_create                  │     │
│     │      POST: /user/users/_updatenovalidate (password)      │     │
│     └─────────────────────────────────────────────────────────┘     │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  4. TENANT READY                                                     │
│     All module data loaded successfully                              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Troubleshooting

### Common Issues

#### 1. Module data not loading
**Symptom:** Module enabled but data not appearing

**Check:**
```bash
# Verify folder exists
ls -la src/main/resources/mdmsData/modules/TL/

# Verify JSON files are valid
cat src/main/resources/mdmsData/modules/TL/TradeLicense/TradeLicense.TradeType.json | jq .
```

#### 2. Workflow not created
**Symptom:** Workflow actions not available

**Check:**
- Verify `workflow/modules/{MODULE}/` folder exists
- Verify JSON is valid BusinessServiceRequest format
- Check logs for workflow creation errors

#### 3. Employees not created
**Symptom:** Cannot login as module employees

**Check:**
- Verify roles in HRMS.json match roles defined in ACCESSCONTROL-ROLES
- Verify department in assignments exists in common-masters.Department
- Check HRMS service logs

#### 4. Localizations not showing
**Symptom:** UI shows codes instead of labels

**Check:**
- Verify locale folder matches (en_IN, hi_IN)
- Verify `locale` field in JSON matches folder name
- Verify `module` field matches UI module name

### Debug Logging

Enable debug logs in application.properties:
```properties
logging.level.org.egov.handler=DEBUG
```

### Useful Log Messages

```
# Successful MDMS load
INFO  - Found 5 MDMS data files for module: TL
INFO  - Created MDMS entry for schemaCode: TradeLicense.TradeType

# Successful workflow creation
INFO  - Found 1 workflow config files for module: TL
INFO  - Created workflow config from TlWorkflowConfig.json for module: TL

# Successful employee creation
INFO  - Found 1 employee files for module: TL
INFO  - Employee created successfully for module TL: TL_DOC_VERIFIER_01
```

---

## Summary

| Aspect | Before | After |
|--------|--------|-------|
| Adding new module | Code changes in 3+ Java files | Config change only |
| Module isolation | Mixed data, shared files | Complete isolation per module |
| Backward compatibility | N/A | Fully supported (legacy folders) |
| Configuration | Hardcoded | application.properties driven |
| Maintenance | High (code changes) | Low (file drops) |

---

**Document Version:** 1.0
**Last Updated:** December 2024
**Author:** Default Data Handler Team
