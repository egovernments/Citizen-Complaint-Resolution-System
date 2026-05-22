# Changelog
All notable changes to this module will be documented in this file.

## 1.0.0 - 2026-04-17

### Bug Fixes
- Fixed `REFERENCE_VALIDATION_ERR` on new tenant creation by sorting MDMS resource files before loading — ensures `ACCESSCONTROL-ACTIONS-TEST` and `ACCESSCONTROL-ROLES` are loaded before `ACCESSCONTROL-ROLEACTIONS` which cross-references both
- Fixed compilation error in `MdmsV2Util` caused by Java 16+ pattern-matching `instanceof` syntax incompatible with egov tracer's compiler override; replaced with traditional cast

### Features
- New `/tenant/new` API to bootstrap a complete new tenant with production-ready MDMS schemas, data, users, and employees in a single call
- Async localization loading during tenant creation to avoid timeout on large locale datasets
- Boundary management integration: schema and MDMS data for `CRS-ADMIN-CONSOLE.adminSchema`, `CMS-BOUNDARY.HierarchySchema`, boundary hierarchy definition, entity, and relationship creation
- Mobile number validation schema (`common-masters.UserValidation`) with configurable allowed starting digits
- Config data bulk loader for `config-service` entries (notification channels, provider details, template bindings)
- Separated dev and production MDMS/localization data paths; `dev.enabled` flag controls dev-only data loading
- Excel validation schema for tenant onboarding via boundary management workbench
- City module master, state info, and `uiHomePage` added to default MDMS data

### Improvements
- MDMS bulk loader processes each record individually and skips failures, preventing a single bad record from blocking the rest
- Localization loading now scans locale folders dynamically instead of hardcoded filenames
- Startup scheduler retries up to 4 times after app start to handle slow service dependencies
- Cleaned up role actions: removed unused entries, added `WORKFLOW_ADMIN`, `PGR_VIEWER`, `AUTO_ESCALATE`, `CONFIG_ADMIN`, and boundary-related role mappings
- Localization cleanup: removed entries not required for CMS, consolidated `rainmaker-common` English messages

### Data Updates
- Added MDMS actions and role mappings for boundary management endpoints (`/egov-bndry-mgmnt/v1/_process`, `_generate`, `_generate-search`, `_process-search`)
- Added actions and role mappings for MDMS v2 create/update endpoints across all masters
- Updated `ACCESSCONTROL-ACTIONS-TEST` and `ACCESSCONTROL-ROLEACTIONS` with all required entries for PGR, HRMS, workflow, localization, and workbench flows
