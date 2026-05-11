# Changelog
All notable changes to this module will be documented in this file.

# Changelog
All notable changes to this module will be documented in this file.

## [1.0.37] - 2026-05-12

### Fixed

- **Employee Take Action — Workflow Options Overlap Button (`pages/employee/PGRDetails.js`)**:
  - On the complaint details page, clicking the orange "Take action" button opened the workflow options (`Assign`, `Reject`, etc.) menu so close to the button that the last option overlapped it.
  - Fix: bumped the `actionButton`'s `menuStyles.bottom` from `40px` to `56px` so the menu floats clear of the button.

- **Toast Position + Inbox Horizontal Slide on Small Screens (`Module.js`)**:
  - At 1280x720, the bottom-centred toast (`.digit-toast-success`) sat at `bottom: 4.5rem` and overlapped the Submit footer on `/employee/pgr/complaint/create` and the bottom rows on `/employee/pgr/inbox`. Inline `style` props on the `<Toast>` component lose to the upstream CSS animation's `forwards` fill, so a normal React style override couldn't push the toast higher. Additionally the inbox grid on small screens forced the whole page to slide horizontally.
  - Fix: at module-import time `PGRModule` now injects a `<style id="pgr-ui-overrides">` element into `document.head` with `.digit-toast-success, .digit-toast-success.animate { bottom: 8rem !important; }` and `.digit-inbox-search-wrapper { max-width: 100%; overflow-x: auto; }`. `!important` outranks the animation in the cascade, and the rule lands before any React mount so it survives refreshes.

- **Citizen Complaint Summary — Section Titles Rendered as Plain Text on Deploy (`pages/citizen/ComplaintDetails.js`, `components/TimeLine.js`)**:
  - "Complaint Details", "Attachments", "Complaint Location", and "Complaint Timeline" subheaders rendered as plain text on the sandbox deploy (typography CSS missing/lost in the deployed bundle), even though they appeared bold locally.
  - Fix: applied inline heading styles (`fontSize: 24px, fontWeight: 700, lineHeight: 28px, color: #0b0c0c`) directly on each `<CardSubHeader>` so they render correctly without depending on external CSS being present. The timeline-wrapper's existing inline `<style>` block now also forces `font-weight: 700` on checkpoint labels so timeline statuses (e.g. "Complaint resolved") render bold instead of plain.

- **Citizen Complaint Summary — Boundary Row Label Overflows Value Column (`pages/citizen/ComplaintDetails.js`)**:
  - When a boundary level's locale key was missing (e.g. `EGOV_LOCATION_BOUNDARYTYPE_REGION`), `t()` returned the raw key. The long key overflowed the `<Row>` component's label column and visually overlapped the value (`Southwest ETPMO People's Region`).
  - Fix: added a `labelForLevel(level)` helper. When `t(key) === key` (no translation), it falls back to a title-cased level name (`REGION` → `Region`, `WARD` → `Ward`) so the label stays short enough to align with the value column. If/when the locale key is added to MDMS later, the translated string takes precedence automatically.

- **Citizen Complaint Details — Stars Missing After Rating Submission (`pages/citizen/ComplaintDetails.js`, `components/TimeLine.js`, `components/timelineInstances/resolved.js`)**:
  - After submitting a rating, the citizen sometimes saw the timeline render without stars: the read API briefly returned stale data (cached or pre-RATE-commit), the page painted, and stars only appeared after a background revalidate landed. On slow connections / Ubuntu the original single fixed-delay retry could miss the commit entirely.
  - Fix:
    - `ComplaintDetailsPage` and `WorkflowComponent` now gate their first render on a `hasFreshDetails` / `hasFreshWorkflow` flag plus a 700ms minimum wait. On mount the page shows `<Loader />` while `revalidate()` runs; only after the gate clears does the page paint — so the freshly-fetched `audit.rating` is in the data on first paint, no flash of stale state.
    - `TimeLine.js` now passes `rating` to the `Resolved` checkpoint (`index <= 1 ? rating : undefined`) — was previously commented out.
    - `resolved.js` renders `<StarRated />` in the `RESOLVE` action branch so stars are visible under the RESOLVED checkpoint even before the workflow transitions to `CLOSEDAFTERRESOLUTION`.
  - Effect: rating stars are reliably visible on the first paint after the user navigates back from rating submission, regardless of network speed or backend commit timing. No session-storage shadow state — single source of truth is the API.

## [1.0.36] - 2026-05-11

### Fixed

- **Citizen Reopen — Attachment Not Visible on Complaint Details (`citizen/ReopenComplaint/AddtionalDetails.js`)**:
  - When a citizen reopened a complaint with an attached photo, the file was only persisted on the `workflow.verificationDocuments` of the REOPEN `ProcessInstance`. The complaint's "Attachments" section (which iterates `service.documents`) never showed it, and on the employee side only a count surfaced — no preview.
  - Fix: in `reopenComplaint()`, also append the uploaded docs (already shaped as `{ documentType, fileStoreId, documentUid, additionalDetails }` by the upload step) to `complaintDetails.service.documents`. Existing service documents (e.g. original create-time photos) are preserved via array spread; nothing is removed.
  - Effect: reopen photos now render alongside the original complaint photos under the "Attachments" section on both citizen and employee detail pages — no timeline-render workaround needed.

- **Employee Timeline — Star Rating Missing on RATE Step (`components/TimeLineWrapper.js`, `pages/employee/PGRDetails.js`)**:
  - After a citizen submitted a star rating, the RATE step in the employee timeline showed only the action label — the star value itself was never rendered. The citizen-side `TimeLine.js` already handled this for `CLOSEDAFTERRESOLUTION`, but the new `TimelineWrapper` used on the employee `PGRDetails` page had no rating-render path.
  - Fix:
    - Added a `rating` prop to `TimelineWrapper` and imported the existing `StarRated` component (`Rating` from `digit-ui-react-components`).
    - When an instance has `action === "RATE"`, the wrapper now pushes a `<StarRated>` element into that step's `subElements`. The rating value is resolved from `instance.rating` first (some backends expose it on the ProcessInstance) and falls back to the `rating` prop sourced from `service.rating`.
    - The label uses the new key `CS_COMMON_CITIZEN_RATED` (with a plain-English `"Citizen rated "` fallback when the key isn't yet in the locale bundle) so the employee view doesn't read "You Rated".
    - `PGRDetails.js` now passes `rating={pgrData?.ServiceWrappers?.[0]?.service?.rating}` to the wrapper.

- **Employee Create Complaint — Page Auto-Scrolls Downward on Mount (`pages/employee/CreateComplaint/index.js`)**:
  - On short laptop viewports the create-complaint page nudged ~50–100px downward when the form mounted, hiding the page header.
  - Root cause: a component inside `@egovernments/digit-ui-components` calls `element.scrollIntoView({ behavior: "smooth", block: "center" })` on mount when its element is outside the visible viewport. On a tall form that element sits below the fold, so the smooth scroll pulls the page downward. A single `window.scrollTo(0, 0)` on mount couldn't compete with the still-animating smooth scroll.
  - Fix: temporarily neutralize `Element.prototype.scrollIntoView` (replace with a no-op) for the first 800 ms after mount so the library's call becomes a no-op; pin `window.scrollTo(0, 0)` on mount and on the next animation frame; disable browser scroll restoration for the page. The override is restored after 800 ms and on unmount — user-initiated focus and validation-driven `scrollIntoView` work normally afterward.

## [1.0.33] - 2026-05-10

### Fixed

- **PGR Inbox — Search Results column-header sort toggle did nothing (`PGRSearchInboxConfig.js`, `UICustomizations.js`)**:
  - Clicking any column header in the Search Results table flipped the toggle arrow but never reordered the rows.
  - Root cause: `ResultsDataTableWrapper` inside `@egovernments/digit-ui-components@0.2.4` passes a no-op `(rowA, rowB) => 0` to `react-data-table-component` whenever a column does not declare its own `sortFunction`. That overrides the library's built-in selector-based sort, so toggling has no effect.
  - Fix:
    - Added a generic `compareByJsonPath(jsonPath)` helper in `PGRSearchInboxConfig.js` and wired a per-column `sortFunction` for all 5 inbox result columns (`complaintNumber`, `locality`, `status`, `currentOwner`, `slaDaysRemaining`). The Current Owner column sorts on `ProcessInstance.assignes[0].name` to match the displayed value; SLA days uses numeric compare.
- **PGR Inbox — Console flooded with `selectionHandler is not defined or is not a function` (`UICustomizations.js`)**:
  - Upstream `ResultsDataTableWrapper` calls `configModule?.selectionHandler` (and `actionSelectHandler`, `linkColumnHandler`) unconditionally on every table update and `console.error`s when they are missing. PGR doesn't use row selection or row actions, but the warnings still flooded the console on every sort/render.
  - Fix: declared no-op `selectionHandler`, `actionSelectHandler`, `linkColumnHandler` in `UICustomizations.PGRInboxConfig`.

- **Local Dev Proxy — Inbox Search returning HTML instead of JSON (`web/src/setupProxy.js`)**:
  - PGR employee inbox search was failing locally because `/inbox/v2/_search` was not in `setupProxy.js`'s forwarded-path list. Webpack-dev-server's static handler was returning `index.html` instead of forwarding to the backend, causing JSON parse failures and an empty inbox.
  - Fix: added `/inbox` to the proxied paths so all `/inbox/*` calls are forwarded to `REACT_APP_PROXY_URL`. Prod was unaffected (gateway handles it directly).

### Changed

- **Employee Action Modal — Upload Component (`ActionUploadComponent.js`)**:
  - Replaced the bulky `ImageUploadHandler` (camera icon + large dropzone) with a compact custom uploader: a small "+ Add file" dashed button (DIGIT orange) and file-name chips with × remove buttons.
  - Removed the duplicate "Attachments" label — the FormComposer's outer field label was already rendering it; the inner one is replaced with a one-line helper text ("Add screenshots or documents (max 2MB each)").
  - Added a `tr(key, fallback)` helper so untranslated keys (`CS_COMMON_ADD_FILE`, `CS_COMMON_UPLOADING`, `CS_COMMON_REMOVE`, etc.) fall back to plain English instead of leaking the raw key into the UI.
  - Maintains the original `Digit.UploadServices.Filestorage` contract — emits `fileStoreId[]` via `onSelect(config.key, ids)` so the form integration is unchanged. Supports JPG, PNG, and PDF up to 2MB; shows inline error for oversize files and an "Uploading…" state.

## [1.0.32] - 2026-05-07

### Fixed

- **PGR Inbox Search — Mobile Number Country Code Not Reflected in Payload (`PGRSearchInboxConfig.js`, `MobileNumberWithPrefix.js`, `UICustomizations.js`)**:
  - Switching the country code dropdown in the inbox mobile number search always sent `+91` in the `countryCode` field regardless of selection.
  - Root cause: `countryCode` was not declared in the search form's `defaultValues`, so React Hook Form never registered it as a tracked field. `setValue("countryCode", ...)` stored the value internally but `state.searchForm` never included it — UICustomizations always fell through to the `+91` hardcoded default.
  - Fix:
    - Added `countryCode: ""` to `defaultValues` in `PGRSearchInboxConfig.js` so RHF registers and tracks the field.
    - `MobileNumberWithPrefix` now writes the selected prefix to `window.__PGR_INBOX_COUNTRY_CODE__` in both `pushToForm` and the MDMS-sync `useEffect`.
    - `UICustomizations` reads `window.__PGR_INBOX_COUNTRY_CODE__` as a reliable fallback before the MDMS default / `+91`.

## [1.0.31] - 2026-05-06

### Fixed

- **Employee Create Complaint — Country Code Not Reflected in Payload (`createComplaintForm.js`, `MobileNumberWithPrefix.js`)**:
  - Changing the country code dropdown in the mobile number field was not being captured in the `_create` API payload — it always sent `+91` regardless of selection.
  - Root cause: `countryCode` was written via react-hook-form's `setValue` on an unregistered field name, so `watch()` and `getValues()` both returned `undefined` — the fallback `"+91"` always applied.
  - Fix: `MobileNumberWithPrefix` now calls an `onCountryCodeChange` callback (injected via field config) that writes directly to a `countryCodeRef` in `createComplaintForm`. At submit time, `countryCodeRef.current` is used as the authoritative source, bypassing react-hook-form entirely.

## [1.0.30] - 2026-05-05

### Fixed
- **Employee Complaint Details — Workflow Actions (`PGRDetails.js`)**:
  - Filtered out purely citizen-facing actions (e.g., `RATE`, `COMMENT`, `REOPEN`) from the "Take Action" dropdown for `SUPERUSER` accounts on the employee UI.
  - Ensured the "Take Action" button is completely hidden instead of appearing disabled on terminal states (like `REJECTED` or `RESOLVED`) where all possible next actions are restricted to citizens.

## [1.0.29] - 2026-04-30

  ### Changed
  - Upgraded `@egovernments/digit-ui-module-cms` to version `1.0.29`.
  - Integrated Matomo analytics script for usage tracking.
  - Dynamic boundary hierarchy support in complaint details (PGR) — structured index-mapped object replacing flat array, with backward compatibility.
  - WhatsApp consent flow fixes: explicit auth-token propagation and language-preference preservation during post-login preference sync.
  - Inbox search, filter, and pagination restored after code migration.
  - Minor bug fixes and stability improvements.




## [1.0.28] - 2026-04-27

### Fixed

- **Employee Complaint Details — Address Display (`PGRDetails.js`)**:
  - Added combined address field to the employee complaint details page, mirroring the citizen-side pattern.
  - Locality code is used directly as a translation key (no double `ADMIN_` prefix) for multi-root tenant deployments.
  - Address parts (landmark, locality, tenant, pincode) now render line by line instead of comma-separated.

- **PGR Inbox Search — Country Code (`UICustomizations.js`)**:
  - Added `countryCode` alongside `mobileNumber` in the inbox search API criteria so mobile number lookups work correctly with country prefix validation.
  - Falls back to `MDMSValidationPatterns.mobileNumberValidation.prefix` or `+91` when not set in the search form.

## [1.0.27] - 2026-04-27 - Code Merge

### Added / Fixed

- **Dynamic Mobile Validation & Prefix Support**: 
  - Integrated full MDMS-driven validation rules into the Employee PGR workflows natively using the new `useMobileValidation` hook.
  - Implemented the custom `MobileNumberWithPrefix` component to enforce consistent, standard-compliant mobile input dropdowns.
  - Added real-time automated mapping for mapping and extracting `"countryCode"` based on the globally loaded MDMS `"default": true` configurations directly into backend `citizen` request payloads for the `_create` APIs.

## [1.0.26] - 2026-04-23

### Added

- **Inbox Toggle (`USE_INBOX_V1`)**: Employee inbox now supports runtime switching between two inbox implementations via the `USE_INBOX_V1` flag in `globalConfigs.js`.
  - `PGRInbox.js`: Wraps `PGRInboxV1` (legacy) and `PGRSearchInboxV2` (InboxSearchComposer-based). Reads `window.globalConfigs.getConfig("USE_INBOX_V1")` — if `true`, renders V1; otherwise renders V2.
  - `globalConfigs.js` (`local-setup/nginx/`): Added `USE_INBOX_V1: true` entry and corresponding `getConfig` case to enable V1 by default in local development.

### Fixed

- **`PGRInboxV1` default filter**: Changed initial `assignee` filter from `[{ code: uuid }]` (current user only) to `[]` (all complaints) so the inbox is not empty on first load.
- **`DesktopInbox` locality lookup**: Added `getLocalityCodeForMultiTenant()` helper and `Digit.Utils.getMultiRootTenant()` check to correctly resolve locality codes in multi-root tenant deployments (matches DIGIT-Frontend reference implementation).

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