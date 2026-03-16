# Changelog
All notable changes to this module will be documented in this file.

## [1.0.13] - 2026-03-16
### Fixed
- Fixed complaint subtype localization keys showing raw keys instead of translated labels
  - Changed `SERVICEDEFS.` (dot separator) to `SERVICEDEFS_` (underscore separator) to match localization entries
  - Updated across useServiceDefs hook, UICustomizations, Complaint component, and SelectSubType step

## [1.0.12] - 2026-03-13
- Fixed back button on complaint-success page to navigate to sandbox home with correct query params when in multi-.root tenant mode

## [1.0.11] - 2026-03-11
- multi-root tenant mode changes 

## [1.0.10] - 2026-03-11
- SUPERUSER Role added

## [1.0.9] - 2026-03-10
- Multiroot tenant city id updated and logics added

## [1.0.8] - 2026-03-10
- CMS Create multiroot tenant city id updated

## [1.0.7] - 2026-03-10
- CMS Create multiroot tenant city id updated

## [1.0.6] - 2026-03-10
- Digit-ui-libraries updated into 1.9.4

## [1.0.5] - 2026-03-10
### Updated
- **Libraries Package**: Updated digit-ui-libraries to version 1.9.4

### Version 1.0.4
- **Fixed**: Clear search button in PGR inbox now clears both text fields and search results in a single click
  - Updated `minReqFields` from 1 to 0 in PGRSearchInboxConfig.js to allow search with empty criteria
  - Previously required two clicks: one to clear fields, another to refresh results
  - Now automatically triggers search with cleared criteria on first click

## [1.0.3] - 2026-03-05
### Fixed
- **PGR Inbox Search and Filter Issues**
  - Fixed search and filter inputs losing values while typing
  - Fixed "Assigned to Me" filter triggering incorrect API calls
  - Fixed state mutation in UICustomizations preProcess function
  - Added mobile number validation with proper prefix and pattern rules
  - Memoized config object to prevent unnecessary re-renders
  - Consolidated config processing for better performance
  - Fixed lodash import in PGRInbox.js
  - Updated useEffect dependencies to prevent config reset on every render

**Files Modified:**
- `src/pages/employee/PGRInbox.js` - Config memoization, mobile validation, proper React hooks
- `src/configs/UICustomizations.js` - Deep cloning to avoid state mutation, improved filter handling

**Impact:**
- Search and filter inputs now retain values when typing
- "Assigned to Me" / "Assigned to All" filters work correctly
- Mobile validation active with MDMS rules
- No state corruption or unnecessary re-renders
- Search and filter operate independently

## [1.0.2] - 2026-02-27
### Fixed
- CCSD-1617: Employee inbox — restored broken search, filter, and pagination functionality on the PGR inbox page

## [1.0.1] - 2026-02-18
### Fixed
- CCSD-1616: Citizen header logo override — rewrote script with persistent dual-observer approach to survive React re-renders; added citizen-route guard so override only applies on `/citizen` pages - Header Removed

- Core version Updated in to 1.9.12

## 0.0.1 - 2025-02-13
### Intial Commit
  1. Initial commit with pgr module