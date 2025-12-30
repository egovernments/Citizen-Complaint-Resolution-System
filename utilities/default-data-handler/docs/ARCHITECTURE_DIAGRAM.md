# Default Data Handler - Architecture Diagram

## Visual Overview

```
╔═══════════════════════════════════════════════════════════════════════════════════════╗
║                          DEFAULT DATA HANDLER ARCHITECTURE                              ║
╚═══════════════════════════════════════════════════════════════════════════════════════╝

                           ┌─────────────────────────────┐
                           │    application.properties   │
                           │  ┌───────────────────────┐  │
                           │  │ modules.enabled=PGR,TL│  │
                           │  │ modules.common=true   │  │
                           │  └───────────────────────┘  │
                           └──────────────┬──────────────┘
                                          │
                                          ▼
╔═════════════════════════════════════════════════════════════════════════════════════════╗
║                              RESOURCE FOLDER STRUCTURE                                   ║
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                          ║
║   src/main/resources/                                                                    ║
║   │                                                                                      ║
║   ├── schema/                          MDMS SCHEMA DEFINITIONS                           ║
║   │   │                                                                                  ║
║   │   ├── common/  ◄──────────────── ALWAYS LOADED ───────────────────┐                 ║
║   │   │   ├── common-masters.json     (Department, IdFormat, etc.)    │                 ║
║   │   │   ├── tenant.json             (Tenant configs)                │                 ║
║   │   │   ├── DataSecurity.json       (Encryption policies)          │  TIER 1         ║
║   │   │   ├── Workflow.json           (Base workflow schemas)        │  COMMON         ║
║   │   │   └── egov-hrms.json          (HRMS schemas)                 │                 ║
║   │   │                                                              │                 ║
║   │   └── modules/  ◄─────────────── IF MODULE ENABLED ──────────────┤                 ║
║   │       ├── PGR/                                                   │                 ║
║   │       │   └── RAINMAKER-PGR.json  (PGR service defs)            │  TIER 2         ║
║   │       ├── TL/                                                    │  MODULE         ║
║   │       │   └── TradeLicense.json   (TL trade types)              │                 ║
║   │       └── PT/                                                    │                 ║
║   │           └── PropertyTax.json    (PT property types)           ─┘                 ║
║   │                                                                                      ║
║   ├── mdmsData/                        MASTER DATA                                       ║
║   │   │                                                                                  ║
║   │   ├── common/  ◄──────────────── ALWAYS LOADED ───────────────────┐                 ║
║   │   │   ├── common-masters/                                        │                 ║
║   │   │   │   ├── common-masters.Department.json                     │                 ║
║   │   │   │   ├── common-masters.GenderType.json                     │  TIER 1         ║
║   │   │   │   └── common-masters.Designation.json                    │  COMMON         ║
║   │   │   ├── tenant/                                                │                 ║
║   │   │   │   └── tenant.citymodule.json                            │                 ║
║   │   │   └── DataSecurity/                                          │                 ║
║   │   │       └── DataSecurity.*.json                               ─┘                 ║
║   │   │                                                                                  ║
║   │   └── modules/  ◄─────────────── IF MODULE ENABLED ──────────────┐                 ║
║   │       │                                                          │                 ║
║   │       ├── PGR/                    ┌──────────────────────────┐   │                 ║
║   │       │   ├── RAINMAKER-PGR/      │ Self-contained module:   │   │                 ║
║   │       │   │   └── *.json          │ - Module schemas         │   │  TIER 2         ║
║   │       │   ├── ACCESSCONTROL/      │ - Module data            │   │  MODULE         ║
║   │       │   │   └── *.json          │ - Module roles           │   │                 ║
║   │       │   └── common-masters/     │ - Module-specific common │   │                 ║
║   │       │       └── *.json          └──────────────────────────┘   │                 ║
║   │       │                                                          │                 ║
║   │       └── TL/                                                    │                 ║
║   │           ├── TradeLicense/                                      │                 ║
║   │           ├── ACCESSCONTROL/                                     │                 ║
║   │           └── common-masters/                                   ─┘                 ║
║   │                                                                                      ║
║   ├── localisations/                   UI LABELS                                         ║
║   │   │                                                                                  ║
║   │   ├── common/  ◄──────────────── ALWAYS LOADED ───────────────────┐                 ║
║   │   │   ├── en_IN/digit-common.json                                │  TIER 1         ║
║   │   │   └── hi_IN/digit-common.json                               ─┘  COMMON         ║
║   │   │                                                                                  ║
║   │   └── modules/  ◄─────────────── IF MODULE ENABLED ──────────────┐                 ║
║   │       ├── PGR/                                                   │  TIER 2         ║
║   │       │   ├── en_IN/rainmaker-pgr.json                          │  MODULE         ║
║   │       │   └── hi_IN/rainmaker-pgr.json                          │                 ║
║   │       └── TL/                                                   ─┘                 ║
║   │                                                                                      ║
║   ├── workflow/                        WORKFLOW CONFIGS                                  ║
║   │   └── modules/  ◄─────────────── IF MODULE ENABLED ──────────────┐                 ║
║   │       ├── PGR/PgrWorkflowConfig.json                            │  TIER 2         ║
║   │       └── TL/TlWorkflowConfig.json                             ─┘  MODULE         ║
║   │                                                                                      ║
║   └── employees/                       USER DATA                                         ║
║       │                                                                                  ║
║       ├── common/  ◄──────────────── ALWAYS LOADED ───────────────────┐                 ║
║       │   └── HRMS.json              (SUPERUSER, base roles)         │  TIER 1         ║
║       │                                                              ─┘  COMMON         ║
║       └── modules/  ◄─────────────── IF MODULE ENABLED ──────────────┐                 ║
║           ├── PGR/HRMS.json          (GRO, RESOLVER)                │  TIER 2         ║
║           └── TL/HRMS.json           (APPROVER, VERIFIER)          ─┘  MODULE         ║
║                                                                                          ║
╚═════════════════════════════════════════════════════════════════════════════════════════╝


                                          │
                                          ▼

╔═════════════════════════════════════════════════════════════════════════════════════════╗
║                                    LOADING FLOW                                          ║
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                          ║
║   ┌─────────────────────────────────────────────────────────────────────────────────┐   ║
║   │                              STARTUP SEQUENCE                                    │   ║
║   └─────────────────────────────────────────────────────────────────────────────────┘   ║
║                                                                                          ║
║   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ║
║   │SCHEMAS  │──▶│MDMS DATA│──▶│BOUNDARY │──▶│LOCALIZ- │──▶│WORKFLOWS│──▶│EMPLOYEES│   ║
║   │         │   │         │   │         │   │ATIONS   │   │         │   │         │   ║
║   └────┬────┘   └────┬────┘   └─────────┘   └────┬────┘   └────┬────┘   └────┬────┘   ║
║        │             │                           │             │             │          ║
║        ▼             ▼                           ▼             ▼             ▼          ║
║   ┌─────────┐   ┌─────────┐                 ┌─────────┐   ┌─────────┐   ┌─────────┐   ║
║   │1.Common │   │1.Common │                 │1.Common │   │ Module  │   │1.Common │   ║
║   │2.Module │   │2.Module │                 │2.Module │   │  Only   │   │2.Module │   ║
║   │3.Legacy │   │3.Legacy │                 │3.Legacy │   │         │   │3.Legacy │   ║
║   └─────────┘   └─────────┘                 └─────────┘   └─────────┘   └─────────┘   ║
║                                                                                          ║
╚═════════════════════════════════════════════════════════════════════════════════════════╝


                                          │
                                          ▼

╔═════════════════════════════════════════════════════════════════════════════════════════╗
║                                   JAVA CLASSES                                           ║
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                          ║
║   ┌───────────────────────────────────────────────────────────────────────────────┐     ║
║   │                        ServiceConfiguration.java                               │     ║
║   │  ┌─────────────────────────────────────────────────────────────────────────┐  │     ║
║   │  │  modules.enabled        → List<String> ["PGR", "TL"]                    │  │     ║
║   │  │  modules.common.enabled → boolean true                                   │  │     ║
║   │  │  modules.localization.enabled → boolean true                            │  │     ║
║   │  │  modules.workflow.enabled → boolean true                                │  │     ║
║   │  │  modules.employees.enabled → boolean true                               │  │     ║
║   │  └─────────────────────────────────────────────────────────────────────────┘  │     ║
║   └───────────────────────────────────────────────────────────────────────────────┘     ║
║                                          │                                               ║
║                                          ▼                                               ║
║   ┌───────────────────────────────────────────────────────────────────────────────┐     ║
║   │                        DataHandlerService.java                                 │     ║
║   │  ┌─────────────────────────────────────────────────────────────────────────┐  │     ║
║   │  │  createMdmsSchemaFromFile()                                             │  │     ║
║   │  │  ├── loadSchemasFromPattern("schema/common/*.json")                     │  │     ║
║   │  │  ├── loadSchemasFromPattern("schema/modules/{MOD}/*.json")              │  │     ║
║   │  │  └── loadLegacySchemas()                                                │  │     ║
║   │  │                                                                         │  │     ║
║   │  │  createAllModuleWorkflowConfigs()                                       │  │     ║
║   │  │  └── for each module: createModuleWorkflowConfig()                      │  │     ║
║   │  │                                                                         │  │     ║
║   │  │  createAllModuleEmployees()                                             │  │     ║
║   │  │  ├── createCommonEmployees()  ◄─── NEW                                  │  │     ║
║   │  │  └── for each module: createModuleEmployees()                           │  │     ║
║   │  └─────────────────────────────────────────────────────────────────────────┘  │     ║
║   └───────────────────────────────────────────────────────────────────────────────┘     ║
║                                          │                                               ║
║                        ┌─────────────────┴─────────────────┐                            ║
║                        ▼                                   ▼                            ║
║   ┌─────────────────────────────────┐   ┌─────────────────────────────────┐             ║
║   │      MdmsBulkLoader.java        │   │     LocalizationUtil.java       │             ║
║   │  ┌───────────────────────────┐  │   │  ┌───────────────────────────┐  │             ║
║   │  │ loadAllMdmsData()         │  │   │  │ loadAllLocalizations()    │  │             ║
║   │  │ ├── loadCommonMdmsData()  │◄─┼───┼──┼─► loadCommonLocalizations()│  │             ║
║   │  │ ├── loadModuleMdmsData()  │  │   │  │ ├── loadModuleLocal...()  │  │             ║
║   │  │ └── loadLegacyMdmsData()  │  │   │  │ └── loadLegacyLocal...()  │  │             ║
║   │  └───────────────────────────┘  │   │  └───────────────────────────┘  │             ║
║   └─────────────────────────────────┘   └─────────────────────────────────┘             ║
║                                                                                          ║
╚═════════════════════════════════════════════════════════════════════════════════════════╝
```

---

## Quick Reference Table

```
┌────────────────────┬──────────────────────────────────┬─────────────────────────────────┐
│     Category       │         Common (Always)          │      Module (If Enabled)        │
├────────────────────┼──────────────────────────────────┼─────────────────────────────────┤
│                    │                                  │                                 │
│  SCHEMAS           │  schema/common/                  │  schema/modules/{MOD}/          │
│                    │  • common-masters.json           │  • RAINMAKER-PGR.json           │
│                    │  • tenant.json                   │  • TradeLicense.json            │
│                    │  • DataSecurity.json             │  • PropertyTax.json             │
│                    │  • Workflow.json                 │                                 │
│                    │                                  │                                 │
├────────────────────┼──────────────────────────────────┼─────────────────────────────────┤
│                    │                                  │                                 │
│  MDMS DATA         │  mdmsData/common/                │  mdmsData/modules/{MOD}/        │
│                    │  • common-masters/*.json         │  • {MODULE-NAME}/*.json         │
│                    │  • tenant/*.json                 │  • ACCESSCONTROL/*.json         │
│                    │  • DataSecurity/*.json           │  • common-masters/*.json        │
│                    │  • Workflow/*.json               │    (module-specific additions)  │
│                    │                                  │                                 │
├────────────────────┼──────────────────────────────────┼─────────────────────────────────┤
│                    │                                  │                                 │
│  LOCALIZATIONS     │  localisations/common/           │  localisations/modules/{MOD}/   │
│                    │  • en_IN/digit-common.json       │  • en_IN/rainmaker-pgr.json     │
│                    │  • hi_IN/digit-common.json       │  • hi_IN/rainmaker-pgr.json     │
│                    │                                  │                                 │
├────────────────────┼──────────────────────────────────┼─────────────────────────────────┤
│                    │                                  │                                 │
│  WORKFLOWS         │  (None - all module-specific)    │  workflow/modules/{MOD}/        │
│                    │                                  │  • PgrWorkflowConfig.json       │
│                    │                                  │  • TlWorkflowConfig.json        │
│                    │                                  │                                 │
├────────────────────┼──────────────────────────────────┼─────────────────────────────────┤
│                    │                                  │                                 │
│  EMPLOYEES         │  employees/common/               │  employees/modules/{MOD}/       │
│                    │  • HRMS.json (SUPERUSER)         │  • HRMS.json (GRO, RESOLVER)    │
│                    │                                  │                                 │
└────────────────────┴──────────────────────────────────┴─────────────────────────────────┘
```

---

## One-Page Summary

```
╔═════════════════════════════════════════════════════════════════════════════╗
║                    DEFAULT DATA HANDLER - ONE PAGE SUMMARY                   ║
╠═════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  ENABLE A MODULE:                                                            ║
║  ────────────────                                                            ║
║    modules.enabled=PGR,TL,PT         (application.properties)                ║
║                                                                              ║
║  FOLDER STRUCTURE:                                                           ║
║  ─────────────────                                                           ║
║    {type}/common/      → Always loaded (shared data)                         ║
║    {type}/modules/     → If module enabled                                   ║
║                                                                              ║
║  FILE NAMING:                                                                ║
║  ────────────                                                                ║
║    Schema code: {Module}.{Entity}      → RAINMAKER-PGR.ServiceDefs           ║
║    File name:   {schemaCode}.json      → RAINMAKER-PGR.ServiceDefs.json      ║
║                                                                              ║
║  PLACEHOLDER:                                                                ║
║  ───────────                                                                 ║
║    {tenantid}  → Auto-replaced with actual tenant ID                         ║
║                                                                              ║
║  ADD NEW MODULE:                                                             ║
║  ───────────────                                                             ║
║    1. Create schema/modules/{MOD}/*.json                                     ║
║    2. Create mdmsData/modules/{MOD}/**/*.json                                ║
║    3. Create localisations/modules/{MOD}/**/*.json                           ║
║    4. Create workflow/modules/{MOD}/*.json                                   ║
║    5. Create employees/modules/{MOD}/*.json                                  ║
║    6. Add {MOD} to modules.enabled                                           ║
║                                                                              ║
║  KEY CLASSES:                                                                ║
║  ────────────                                                                ║
║    DataHandlerService.java    → Main orchestrator                            ║
║    MdmsBulkLoader.java        → MDMS data loading                            ║
║    LocalizationUtil.java      → Localization loading                         ║
║    ServiceConfiguration.java  → Config properties                            ║
║                                                                              ║
║  LOADING ORDER:                                                              ║
║  ─────────────                                                               ║
║    Schemas → MDMS Data → Boundary → Localizations → Workflows → Employees    ║
║                                                                              ║
╚═════════════════════════════════════════════════════════════════════════════╝
```

---

*Architecture Diagram v1.0 - December 2024*