# Changelog
All notable changes to this module will be documented in this file.

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