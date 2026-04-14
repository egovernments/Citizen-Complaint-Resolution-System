# Changelog
All notable changes to this module will be documented in this file.

## [1.0.24] - 2026-04-10

### Updated
- Version bumped to 1.0.24


## [1.0.23] - 2026-04-09

### Updated
- Version bumped to 1.0.23

## [1.0.22] - 2026-04-06

### Fixed

- **CCSD-1777**: Employee UI — Timeline assignee display now strictly follows business rule: employee info is shown **only when a user explicitly selected an assignee** (`assignes[0]` present). Previously, the `instance.assigner` (always populated by the backend) was being shown for non-assign actions, causing creator/rejector/resolver names to appear incorrectly.
  - `TimeLineWrapper.js`: Replaced action-type check (`ASSIGN`/`REASSIGN`) with a direct `assignes[0]` presence check — handles all six scenarios correctly including CSR reopen-with-assignee edge case.
  - **Affected actions now fixed**: `CREATE` (complaint filed), `REJECT` (GRO rejects), `RESOLVE` (LME resolves), `REOPEN` without assignee selection (CSR reopens).
  - **Unaffected / already correct**: `ASSIGN` (GRO → LME), `REASSIGN` (LME → GRO), `REOPEN` with assignee selected.

- **CCSD-Rating Flow**: Citizen rating submission now correctly updates `ComplaintDetails` and timeline without requiring a manual page refresh.
  - `SelectRating.js`: Calls `revalidateComplaint()` immediately after rating API completes to invalidate the SWR cache; writes `PGR_LAST_RATING` to session storage as a reliable fallback for the Response page banner.
  - `Response.js`: Added 800 ms loading state to allow Redux to settle; added session storage fallback so the success banner is always shown even if Redux state hasn't populated yet.
  - `ComplaintDetails.js`: Both `useComplaintDetails` and `useWorkflowDetails` revalidation delays extended from 1.5 s → 3 s when a rating was just submitted (detected via `PGR_LAST_RATING` session flag), giving the backend time to commit the `RATE` transition before the next fetch.

## [1.0.14] - 2026-03-16
### Fixed
 -var Digit = window.Digit || {}; removed

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