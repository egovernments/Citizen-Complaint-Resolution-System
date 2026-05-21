# Changelog
All notable changes to this module will be documented in this file.

# Changelog
All notable changes to this module will be documented in this file.

## [1.0.47] - 2026-05-21

### Fixed

- **CI publish & Docker build failing on `yarn install` — `node-releases@2.0.45` requires Node >= 18, CI runs Node 14 (`package.json` resolutions)**:
  - Both the `publishAllPackagesRelease` GitHub Actions workflow and the UI Docker image build run `yarn install` against Node 14 (workflow pins `node-version: 14`; Dockerfile uses `node:14-bullseye-slim`). A recent `node-releases` release (pulled in transitively via `browserslist`) bumped its `engines` to `>=18`, so the install aborts with `error Found incompatible module` before any package can be built.
  - Fix: pinned `node-releases` to `2.0.14` (last version that still supports Node 14) via yarn `resolutions` in this module's `package.json`. Mirror resolutions were added to the workspace root, sibling `packages/css`, and the outer `frontend/micro-ui/web` workspace so every `yarn install` entry point — leaf publish, workspace-root publish, and Docker build — picks up the pin.
  - Effect: `yarn install` once again resolves under Node 14, unblocking both the npm publish workflow and the Docker UI build. No runtime change for consumers of this package; `node-releases` is a build-time / browserslist-time dependency only.

## [1.0.46] - 2026-05-21

### Changed

- **Timeline — Assignee Mobile Numbers Masked to Last 4 Digits (`components/TimeLine.js`, `components/TimeLineWrapper.js`, `components/timelineInstances/pendingAtLme.js`, `services/workflow/Workflow.js`)**:
  - Assignee mobile numbers were rendered in full on every timeline row that displayed the assignee block (citizen detail, employee detail, LME-pending checkpoints), exposing PII on each detail-page render.
  - Fix: added a `maskPhoneNumber(phone)` helper that returns `XXXXXX` plus the last 4 digits (e.g. `9876543210` → `XXXXXX3210`); empty / short inputs pass through unchanged. Wired the helper at every render site that prints a number:
    - `TimeLine.js:31` — citizen-side `<TimelineCaption>` `ES_COMMON_CONTACT_DETAILS` line.
    - `TimeLineWrapper.js:100` — employee-side assignee sub-element.
    - `timelineInstances/pendingAtLme.js:15` — `<TelePhone mobile={...}>` call for LME-pending rows.
  - Helper is also defined in `services/workflow/Workflow.js` alongside `getAssignerDetails` so any future caller consuming the workflow service directly can mask consistently.
  - Effect: full mobile numbers no longer appear in any timeline UI. The raw number is still present on the `ProcessInstance` payload, so click-to-call and backend-driven contact actions that depend on the real number are unaffected.

### Fixed

- **Citizen Create Complaint — Photo Upload Tenant Resolution on Multi-Root (`pages/citizen/Create/Steps/SelectImages.js`)**:
  - `SelectImages` no longer pulls `tenantId` from a single source. The new resolution order is: (1) the city code the citizen picked on the preceding Address step (`formData?.SelectAddress?.city?.code`), (2) `Digit.ULBService.getCurrentTenantId()` when `Digit.Utils.getMultiRootTenant()` is true, (3) the `CITIZEN.COMMON.HOME.CITY` session entry, (4) `Digit.ULBService.getCurrentTenantId()`. The resolved id is passed straight to `ImageUploadHandler`.
  - Effect: complaint photos are uploaded against the tenant the citizen actually selected for the complaint — important on multi-root deployments where the home/session tenant can differ from the picked city, which previously caused photos to land in the wrong tenant's filestore.

## [1.0.45] - 2026-05-19

### Changed

- **SelectImages — removed `FormStep` wrapper (`pages/citizen/Create/Steps/SelectImages.js`)**: Replaced the `<FormStep>` container with a plain centered flex `<div>`, eliminating the built-in Next/Skip navigation buttons from the image upload step so navigation is handled entirely by the parent `FormComposerV2`.
- **Complaint images upload config — added `withoutLabel` flag (`pages/citizen/Create/steps-config/complaintsUploadimages.js`)**: Set `"withoutLabel": true` on the `SelectImages` field so the upload step renders without a field label, matching the new layout after the `FormStep` removal.

---

## [1.0.44] - 2026-05-18

### Changed

- **Complaint card — added localized "Date:" label with bold formatting (`components/Complaint.js`)**: The date display now renders `<strong>{t("CS_COMMON_DATE")}:</strong> {formattedDate}`, matching the label-first pattern used by the Complaint No row.
- **Mobile number prefix dropdown — custom SVG arrow, dynamic width (`components/MobileNumberWithPrefix.js`)**: Replaced the plain browser-styled `<select>` with a positioned wrapper `<div>` + `appearance: none` select and an inline SVG chevron icon. Width is calculated dynamically as `calc(${selectedPrefix.length}ch + 40px)` so the control sizes to its content.
- **WhatsApp tracking prefix dropdown — same custom arrow refactor (`components/TrackOnWhatsApp.js`)**: Applied the identical positioned-wrapper + SVG-chevron pattern to the country-code selector inside the WhatsApp popup.
- **Boundary selection label — required asterisk indicator (`pages/citizen/Create/FormExplorer.js`, `pages/employee/CreateComplaint/createComplaintForm.js`)**: Added CSS rule `h2.boundary-selection-label::after { content: " *"; color: #d4351c; }` to both the citizen create flow and the employee create complaint form, so boundary-hierarchy headings show a red asterisk without modifying the component markup.

---

## [1.0.43] - 2026-05-15

### Changed

- **Complaint card — removed calendar emoji, bolded complaint number label (`components/Complaint.js`)**: Stripped the `📅` span from the date row and wrapped the "Complaint No:" label text in `<strong>` for improved visual hierarchy.
- **Citizen Complaint Details — localization key dot-to-underscore sanitisation (`pages/citizen/ComplaintDetails.js`)**: Single-value detail fields now call `t((value || "").replace(/\./g, "_"))` before translation, preventing raw keys like `SOME.KEY` from painting when the catalog entry uses underscores.
- **Previous button sizing CSS (`pages/citizen/Create/FormExplorer.js`)**: Added scoped `<style>` rule `.previous-button.digit-button-secondary { height: 2.5rem !important; min-width: 15rem; }` to ensure the previous button is consistently sized across browsers.
- **Complaint images upload config — `subHead` instead of `label` (`pages/citizen/Create/steps-config/complaintsUploadimages.js`)**: Moved the `CS_ADDCOMPLAINT_UPLOAD_PHOTO_TEXT` string from the field-level `label` property to the step-level `subHead` property so it renders as a step subtitle rather than a field label.

---

## [1.0.42] - 2026-05-14

### Changed

- **Module component registration order fix (`src/Module.js`)**: Moved `PGRComplaintDetailsPage` and `PGRResponseCitzen` to an earlier position in `componentsToRegister` (before `PGRResponse`), correcting a registration ordering inconsistency introduced in 1.0.41.

---

## [1.0.41] - 2026-05-14

### Changed

- **Module component registration order (`src/Module.js`)**: Swapped the positions of `SelectAddress` and `SelectImages` in `componentsToRegister` to match the intended registration sequence.

---

## [1.0.40] - 2026-05-14

### Fixed

- **Citizen Complaint Details — Address row double-prefixed in multi-root tenants, rendering raw codes like `ADMIN_ADMIN_SUN04 HARIBBB` (fixed upstream in `digit-ui-libraries/hooks/pgr/useComplaintDetails.js`)**:
  - Reproducer (sandbox-demo, `HARIBBB` tenant): `/citizen/pgr/complaints/<id>` showed the Address row as two stacked lines `ADMIN_ADMIN_SUN04` / `HARIBBB`, while the equivalent employee page rendered it correctly as `Central Plaza, HARIBBB`.
  - Root cause was the hard-coded `ADMIN_` prefix in the shared libraries hook ([`DIGIT-Frontend/micro-ui/web/micro-ui-internals/packages/libraries/src/hooks/pgr/useComplaintDetails.js:22`](DIGIT-Frontend/micro-ui/web/micro-ui-internals/packages/libraries/src/hooks/pgr/useComplaintDetails.js#L22)). In multi-root mode the hook composed the address-row locality entry as `` `ADMIN_${service.address.locality.code}` ``, but multi-root tenants like `HARIBBB` store locality codes **already prefixed** (e.g. `ADMIN_SUN04`), so the resulting i18n key was `ADMIN_ADMIN_SUN04` — no catalog entry → raw key painted. The bottom boundary-hierarchy row on the same page works fine because it reads `boundaryHierarchy.LOCALITY` (which is just `ADMIN_SUN04`) and calls `t()` on it directly, hitting the real catalog entry that renders as `Central Plaza`.
  - Fix: removed the hard-coded `ADMIN_` from the libraries hook so the multi-root branch passes `service.address.locality.code` straight through to the row array — identical pattern to the boundary-hierarchy row that already worked. `Digit.Utils.locale.getLocalityCode(...)` is still used for non-multi-root tenants (behaviour unchanged there).
  - Effect: any consumer of `Digit.Hooks.pgr.useComplaintDetails` — including this module's citizen `ComplaintDetailsPage` — now receives the un-prefixed locality code in `complaintDetails.details.ES_CREATECOMPLAINT_ADDRESS[1]`. The citizen page's existing `<Row>` map calls `t()` on each address-array element, which now resolves the locality entry to `Central Plaza` instead of painting raw. **The fix lives in `@egovernments/digit-ui-libraries`; this module's source only needs to consume a libraries version that includes it.** No `ES_CREATECOMPLAINT_ADDRESS` override added to `pages/citizen/ComplaintDetails.js`.

- **Citizen Complaint Details — Complaint Type / Sub-Type rendered as raw `SERVICEDEFS_<CODE>` keys instead of human-readable text (`pages/citizen/ComplaintDetails.js`)**:
  - Reproducer (sandbox-demo, `HARIBBB` tenant): `/citizen/pgr/complaints/<id>` showed rows like `Complaint Type: SERVICEDEFS_INTERNET` / `Complaint Sub-Type: SERVICEDEFS_NOINTERNET`, while the equivalent `/employee/pgr/complaint/details/<id>` rendered them correctly as `Internet` / `No internet`.
  - Root cause — divergent resolution paths between citizen and employee:
    - Employee `PGRDetails.js` resolves the readable strings directly from the `ServiceDefs` MDMS master via `getServiceCategoryByCode(serviceCode) → match.category || match.menuPath` and `getServiceNameByCode(serviceCode) → match.name`. Those fields are already human-readable, so the row renders correctly even with no i18n entry.
    - Citizen `ComplaintDetails.js` relied on `Digit.Hooks.pgr.useComplaintDetails` from `digit-ui-libraries`, which builds the row values as `SERVICEDEFS_${complaintType}` / `SERVICEDEFS_${serviceCode}`. When the deployed localization catalog has no entry for that exact key (common on per-tenant deployments where service codes are tenant-specific), `t()` falls back to returning the raw key — which is what the user saw.
  - Fix: citizen `ComplaintDetailsPage` now loads the same `RAINMAKER-PGR / ServiceDefs` MDMS master the employee page uses (via `Digit.Hooks.useCustomMDMS` with `schemaCode: "SERVICE_DEFS_MASTER_DATA"`), defines the same `getServiceCategoryByCode` / `getServiceNameByCode` helpers, and — inside the `<StatusTable>` row map — resolves the two affected rows at render time with the **exact same `t(getServiceXByCode(serviceCode, serviceDefs) || "NA")` pattern** the employee `PGRDetails` page uses for its field pairs:
    - row `CS_ADDCOMPLAINT_COMPLAINT_TYPE` → `t(getServiceCategoryByCode(serviceCode, serviceDefs) || "NA")` (which returns `category || menuPath`)
    - row `CS_ADDCOMPLAINT_COMPLAINT_SUB_TYPE` → `t(getServiceNameByCode(serviceCode, serviceDefs) || "NA")` (which returns `name`)
    - The libraries-hook `SERVICEDEFS_<CODE>` value for these two keys is no longer read at all — the `.map((flag) => ...)` callback now branches on the flag and calls the MDMS helpers directly, so the citizen-side row rendering for these two rows is byte-for-byte parallel to the employee `SummaryCard` field pair definition. The early-return loader now also waits on `isMDMSLoading` so the table never paints before MDMS resolves. All other rows (Complaint No, Application Status, Description, Filed Date, Address, boundary hierarchy, attachments, map, workflow) iterate the libraries-hook output unchanged.
  - Effect: citizen Complaint Type / Sub-Type now render the same readable strings as the employee page on every tenant, without depending on per-service-code i18n entries existing in the deployed catalog. Independent from any `SERVICEDEFS.` vs `SERVICEDEFS_` separator discrepancy in older dist artifacts — the citizen page no longer constructs that key at all for these two rows.

## [1.0.39] - 2026-05-12

### Fixed

- **Citizen Complaint Details — Timeline inconsistent / rating missing on slow connections and non-Chrome browsers (`pages/citizen/ComplaintDetails.js`, `components/TimeLine.js`)**:
  - Symptom (reproducible on Ubuntu / Firefox / throttled 3G): after submitting a rating the timeline sometimes painted without stars, sometimes without the synthetic "Complaint Filed" step. After "a while" it filled in. Inconsistent between page loads.
  - Two underlying bugs:
    1. **Stale-data flash on warm cache.** `ComplaintDetailsPage` and `WorkflowComponent` previously gated their first paint on a fixed 700ms `setTimeout` plus the hook's `isLoading`. With cached data react-query returns `isLoading=false` immediately and runs the refetch in the background. On a slow connection the 700ms timer expired *before* the refetch returned, so stale cached data painted (missing stars / wrong status) and only flipped to fresh data when the network later caught up — visible as a flash and "rating sometimes not showing."
    2. **Mutating timeline append.** `TimeLine.js` appended a synthetic `COMPLAINT_FILED` checkpoint inside a `useEffect` by calling `timeline.push(...)` directly. Because no state update followed, the appended entry only became visible whenever some *other* trigger caused a re-render — non-deterministic on slow networks and producing the "timeline inconsistent / filed step sometimes missing" symptom.
  - Fix:
    - `ComplaintDetailsPage` and `WorkflowComponent` now await the Promise returned by `revalidate()` (which is `queryClient.invalidateQueries(...)` and resolves only after the matched refetches complete) and only flip `hasFreshDetails` / `hasFreshWorkflow` to true after that resolution. The fixed 700ms timer is gone. The loader stays up for exactly as long as the refetch takes, regardless of network speed — slow connections wait longer, fast/cached cases barely show the loader. Defensive fallback to `Promise.resolve()` if `revalidate()` is ever sync.
    - `TimeLine.js` converts the timeline-append `useEffect` into a pure `useMemo` returning a new array (`augmentedTimeline`). No mutation, deterministic on every render, and re-derives whenever the underlying `timeline` reference changes — eliminating the "depends on a re-render lottery" race.
  - Effect: rating stars and the full timeline are reliably visible on the first paint after the user navigates back from rating submission, regardless of browser or network speed. No flash of stale state, no "appears after a while" behaviour.

- **Citizen Complaint Details — Stars Missing After Citizen Rates a REJECTED Complaint (`components/TimeLine.js`)**:
  - Reproducer: employee rejects a complaint → citizen submits a rating from the timeline RATE link → complaint workflow transitions REJECTED → CLOSEDAFTERREJECTION → citizen returns to the detail page. The new "Closed after rejection" checkpoint at the top of the timeline rendered with the user's comment but **no star icons**.
  - Root cause: `TimeLine.js` had no `case "CLOSEDAFTERREJECTION":` branch — it fell through to the `default` case which only renders a label, never the `<StarRated />` element. The happy-path equivalent (`CLOSEDAFTERRESOLUTION`) does render stars.
  - Fix: added `case "CLOSEDAFTERREJECTION":` mirroring the existing `CLOSEDAFTERRESOLUTION` branch — renders the standard checkpoint label plus `<StarRated text={t("CS_ADDCOMPLAINT_YOU_RATED")} rating={rating} />` when a rating exists.
  - Design choice: the `rating` prop on `case "REJECTED":` is intentionally **not** passed (it stays out of the JSX), mirroring how `resolved.js` keeps its `action === "RATE"` branch's `<StarRated />` commented out. Stars belong to the rating checkpoint above (`CLOSEDAFTERREJECTION` / `CLOSEDAFTERRESOLUTION`), not to the parent action checkpoint — passing `rating` to both produced duplicate "You Rated ★★★" rows.
  - Effect: rating stars now show consistently on `CLOSEDAFTERREJECTION` in the rejection-path flow, symmetric with the existing `CLOSEDAFTERRESOLUTION` behaviour on the happy path. Exactly one "You Rated" row in either flow.

## [1.0.38] - 2026-05-12

### Fixed

- **Employee Create Complaint / Inbox — Page Auto-Scrolls Downward on First Load — Proper Fix (`public/index.html` in host app; `pages/employee/CreateComplaint/index.js`, `pages/employee/PGRInbox.js`)**:
  - The 1.0.37 fix (`useEffect`-based mount-time neutralization with an 800ms→1500ms timeout) was a misdiagnosis. The buggy `scrollIntoView` fires from inside the `Dropdown` component itself *after* MDMS resolves, so a mount-time window in the parent CreateComplaint / PGRInbox screens was racing the async smooth scroll on first load / hard reload — which is exactly the "happens on hard reload but not on cached nav" symptom users reported.
  - Real root cause: the `Dropdown` component in `@egovernments/digit-ui-components@0.2.5` runs a mount-time `useEffect(()=>{...},[])` that calls `scrollIntoView({behavior:"smooth",block:"center",inline:"center"})` on *its own root `<div>`* (class `digit-dropdown-employee-select-wrap` / `digit-dropdown-select-wrap`) whenever `getBoundingClientRect()` reports it as off-screen. Tall PGR forms render many Dropdowns below the fold, each one scrolls the page, the last one wins. On cached internal navigation the form mounts before layout has expanded to its tall size, so the off-screen check fails and the bug is silently skipped.
  - Fix:
    - Removed the brittle per-screen `useEffect` workaround from `CreateComplaint/index.js` and `PGRInbox.js` (it raced async MDMS and only worked when the MDMS round-trip finished inside the timeout window).
    - Added a host-app patch to `public/index.html` that wraps `Element.prototype.scrollIntoView`. The wrapper no-ops the call **only** when (a) the target's className matches the Dropdown root regex **and** (b) `location.pathname` matches `/employee/pgr/complaint/create` or `/employee/pgr/inbox`. Every other page and every other `scrollIntoView` call (stepper active-step, OTP focus, validation focus, etc.) passes through unchanged.
    - Patch was added to all known host-app `index.html` files: `DIGIT-Frontend/micro-ui/web/public/index.html`, `DIGIT-Frontend/micro-ui/web/micro-ui-internals/example/public/index.html`, `Citizen-Complaint-Resolution-System/frontend/micro-ui/web/public/index.html`, `Citizen-Complaint-Resolution-System/frontend/micro-ui/web/micro-ui-internals/example/public/index.html`, `DIGIT-UI-LIBRARIES/react/example/public/index.html`. **Deployments that don't pick up this `index.html` change will still see the bug.**

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
  - Root cause (as understood at the time): a component inside `@egovernments/digit-ui-components` calls `element.scrollIntoView({ behavior: "smooth", block: "center" })` on mount when its element is outside the visible viewport. On a tall form that element sits below the fold, so the smooth scroll pulls the page downward. A single `window.scrollTo(0, 0)` on mount couldn't compete with the still-animating smooth scroll.
  - Fix: temporarily neutralize `Element.prototype.scrollIntoView` (replace with a no-op) for the first 800 ms after mount so the library's call becomes a no-op; pin `window.scrollTo(0, 0)` on mount and on the next animation frame; disable browser scroll restoration for the page.
  - **Note:** this workaround did not survive first-load / hard-reload because the offending Dropdown mount runs *after* MDMS resolves, often outside the 800ms window. Superseded by the proper fix in 1.0.38.

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