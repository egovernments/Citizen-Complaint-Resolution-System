# Citizen UI — Flows & Stories Catalogue

Source-of-truth map between **citizen user journeys** and the specs under
`tests/citizen/`. Each flow lists routes, page components, user actions,
API calls, and edge cases — grounded in what the live citizen UI
actually does, not what the source code suggests it might.

> **Last validated**: 2026-04-29 against `http://localhost:18080/digit-ui/citizen/`
> (digit-ui-esbuild dev server proxying naipepea backend).
> Filed a real complaint (`NCCG-PGR-2026-04-29-013280`) end-to-end and
> visited every reachable route.

When stories drift (UI redesigns, new wizard steps, route renames,
backend changes), update this doc in the same PR as the spec change so
the map stays accurate.

## Provenance

Catalogue first compiled by an Explore agent walking the digit-ui-esbuild
source on 2026-04-29, then walked in Chrome and rewritten to match the
live UI. Inferred-from-source claims that didn't survive the browser walk
are tracked as fix items in [issue #12](https://github.com/ChakshuGautam/digit-integration-tests/issues/12).

**File-path references** in each story are locator hints —
sample-verified, but most are off by ±10 lines due to source drift.
Re-confirm against the current source before quoting any line in a test.

## Citizen route table

Base: `http://localhost:18080/digit-ui/citizen/` (or `https://naipepea.digit.org/digit-ui/citizen/` in production).

| Route | Purpose |
|---|---|
| `/citizen/` | Redirects to `/citizen/all-services` |
| `/citizen/all-services` | **Default post-login landing.** "Citizen Complaint Resolution System" header + 2 yellow text links (File a Complaint, My Complaints). |
| `/citizen/pgr-home` | **Branded "Nai Pepea" PGR module home.** Hero with "Report a grievance, track the resolution" tagline. The sidebar "Citizen Complaint R…" item links here. |
| `/citizen/login` | Mobile-number entry (form titled "Provide your mobile number"). |
| `/citizen/login/otp` | OTP entry (6 single-digit inputs). |
| `/citizen/register` | Same form as login mobile entry, new-user path. |
| `/citizen/register/otp` | OTP entry, new-user path. |
| `/citizen/register/name` | Name + email entry, new-user path. |
| `/citizen/select-language` | Language selection (not part of the default boot sequence on this build). |
| `/citizen/user/profile` | Edit profile — Name + Gender + Email + photo. |
| `/citizen/pgr/create-complaint/complaint-type` | **All 6 wizard steps** — URL doesn't change as steps advance. |
| `/citizen/pgr/response` | Wizard confirmation ("Complaint Submitted" hero) AND post-rate response page (shared route). |
| `/citizen/pgr/complaints` | "My Complaints" list. |
| `/citizen/pgr/complaints/:id` | **Complaint detail page** (note: PLURAL — `Routes.js` exports `/complaint/details/:id` but the actually-mounted path is `/complaints/:id`). |
| `/citizen/pgr/rate/:id` | Rate complaint (1–5 stars + feedback). |
| `/citizen/pgr/reopen/:id` | Reopen complaint — multi-step wizard handled internally. |
| `/citizen/pgr-faq` | ❌ Renders "Something went wrong" — issue #12. |
| `/citizen/pgr-how-it-works` | ❌ Renders "Something went wrong" — issue #12. |

Routes declared in `products/pgr/src/constants/Routes.js` (`/subtype`, `/pincode`, `/landmark`, `/address`, `/upload-photo/:id`, `/addional-details/:id`) are **dead** — see issue #12.

## Sidebar (after login)

Items, top to bottom: avatar + mobile number, **Home** (→ /citizen/), **Citizen Complaint R…** (truncated, → /pgr-home), **Edit Profile** (→ /user/profile), **Logout** (modal), **HELPLINE** (renders raw key, click handler dead — issue #12).

There is **no** header user-dropdown on this build. Header has only the language pill ("English") + bell icon.

---

## Flow 1: Authentication

### Story 1.1: Login — enter mobile number

- **Route**: `/digit-ui/citizen/login`
- **Page component**: `SelectMobileNumber` (`packages/modules/core/src/pages/citizen/Login/SelectMobileNumber.js`)
- **Layout**: card on left side; form has heading "Provide your mobile number".
- **User actions**:
  - Mobile input shows `+254` as a non-typeable hint to the left of the field. Helper text below: "Enter your 10-digit mobile number" (count `N/10` updates as you type).
  - Click **"Next"** → `Digit.UserService.sendOtp()` → navigates to `/citizen/login/otp`.
  - "CS_LOGIN_REGISTER_WITH_EMAIL" link below the field — currently rendered as raw key (issue #12).
- **API calls**: `POST /user-otp/v1/_send` (TYPE_LOGIN).
- **Validation**: 10-digit mobile, Kenya pattern from MDMS `ValidationConfigs.mobileNumberValidation`.

### Story 1.2: Login — enter OTP

- **Route**: `/digit-ui/citizen/login/otp`
- **Page component**: `SelectOtp` (`packages/modules/core/src/pages/citizen/Login/SelectOtp.js`)
- **User actions**:
  - 6 separate `maxlength=1` inputs auto-advance focus.
  - "Resend another OTP N secs" countdown — clicking the link after countdown re-triggers send.
  - Click **"Next"** → submits OTP via `Digit.UserService.authenticate()`. On success, redirects to `/citizen/all-services`.
- **API calls**: `POST /user-otp/v1/_validate` (via authenticate).
- **Edge cases**:
  - Mobile number shown without `+254` prefix in the body text.
  - On naipepea, **mock OTP `123456`** is accepted for any phone (Kong `request-termination` plugin).
  - Auto-register-on-login fallback exists for unknown numbers.

### Story 1.3: Register (auto-register on first OTP for unknown number)

- **Route**: `/digit-ui/citizen/register` → `/register/otp` → `/register/name`
- **Behaviour**: enter mobile → OTP → if number is new, prompted for **Name** (mandatory) and **Email** (optional) on `/register/name` before landing on `/all-services`.
- **API calls**: `POST /user/_register`, `POST /user-otp/v1/_validate`.
- **Edge case**: Auto-register can also fire on the **login** path for an unknown number (covers Story 1.1 → registration flow).

---

## Flow 2: Home & Landing

### Story 2.1: All-services landing

- **Route**: `/digit-ui/citizen/all-services` (`/digit-ui/citizen/` redirects here).
- **Page component**: `Allservices` (`packages/modules/core/src/pages/citizen/Allservices/index.js`).
- **Content**: Title "Citizen Complaint Resolution System" + 2 yellow text links: **File a Complaint** (→ wizard step 1), **My Complaints** (→ list).
- **User actions**: tile click → respective module home.
- **Note**: This is the post-login default landing on this build, not a deep aux page.

### Story 2.2: PGR module home (branded)

- **Route**: `/digit-ui/citizen/pgr-home`
- **Content**: Hero banner with "**Nai Pepea**" headline, subtitle "Report a grievance, track the resolution", "Nairobi City County Government" tagline, "PGR" badge top-left. Below: "Citizen Complaint Resolution System" section with `My Complaints` and `File a Complaint` underline-style links.
- **User actions**: deep-link entry to PGR; the sidebar "Citizen Complaint R…" item routes here.

### Story 2.3: Header language pill

- **Component**: top-right header pill, currently shows "English". Click reveals dropdown of available languages from `common-masters.StateInfo.languages` MDMS.
- **User actions**: pick → `Digit.LocalizationService.changeLanguage()` → page re-renders.

---

## Flow 3: File Complaint (wizard — 6 steps)

The wizard is a `FormComposerV2` driven by 6 step configs in
`products/pgr/src/pages/citizen/Create/FormExplorer.js`. **URL stays at**
`/digit-ui/citizen/pgr/create-complaint/complaint-type` **for all 6 steps**.
Footer buttons: **NEXT** (yellow) + **BACK** (white outline). Step 6 swaps NEXT for **SUBMIT**.

### Story 3.1: Complaint Details (Type + Subtype)

- **Step config**: `createComplaint` (`steps-config/CreateComplients.js`)
- **Title**: "Complaint Details"
- **Fields**:
  - **Complaint Type \*** — dropdown. Values are unique `menuPath` from `RAINMAKER-PGR.ServiceDefs`, translated as `SERVICEDEFS.<UPPER>` (e.g. "Lands", "Innovation And Digital Economy", "Public Service").
  - **Complaint Subtype \*** — dropdown. Filtered by selected Type. Values render in **raw UPPER_SNAKE** because subtype keys aren't seeded (issue #12) — e.g. `LAND OWNERSHIP DISPUTE`, `SURVEYING DELAY`.
- **Data source**: `Digit.Hooks.useCustomMDMS(... RAINMAKER-PGR.ServiceDefs)`.
- **Note**: catalogue once mentioned a "Myself / Another User" radio at the top — this step config exists in source as `selectComplaintType` but is **not wired** into `FormExplorer.configs`, so it doesn't render (issue #12).

### Story 3.2: Pin Complaint Location

- **Step config**: `pinComplaintLocaton`
- **Title**: "Pin Complaint Location"
- **Component**: Leaflet map with reverse-geocoded address shown in a green box pointing at the pin.
- **User actions**:
  - Search bar above the map (autocomplete address search).
  - Drag the pin to a different location → reverse-geocode updates.
  - Recenter button (bottom-right circle icon) re-locates the pin.
  - Click NEXT without touching the map → wizard advances cleanly (CCRS#469 fix verified by PR #9).
- **Side effects**: address + postal code auto-populate downstream Location Details fields.

### Story 3.3: Location Details

- **Step config**: `locationDetails`
- **Title**: "Location Details"
- **Fields** (all optional):
  - **Address**
  - **Address Line 1**
  - **Landmark**
  - **Postal Code** — pre-filled from step 2 reverse-geocode (e.g. `40476` for Nairobi CBD).

### Story 3.4: Complaint's Location (boundary cascade)

- **Step config**: `complaintsLocation`
- **Title**: "Complaint's Location" (note apostrophe)
- **Component**: 3-level cascading dropdown (no Locality level on this build).
  - **County** — `Nairobi City` only.
  - **Sub County** — appears after County selected. Currently shows duplicate entries (Makadara/Kibra each twice — issue #12, root-`ke` boundary tree leak).
  - **Ward** — appears after Sub County selected. e.g. Viwandani, Harambee, Maringo/Hamza, Makongeni for Makadara.
- **Edge case**: Cascade gates each level — picking nothing shows only County (CCRS#477 fix verified by PR #9). Each step requires picking the parent first.

### Story 3.5: Additional Details

- **Step config**: `additionalDetails`
- **Title**: "Additional Details"
- **Field**: **Description** (textarea, mandatory, no visible char counter).

### Story 3.6: Upload photos + submit

- **Step config**: `complaintsUploadimages`
- **Title**: "Upload complaint photos"
- **Body text**: starts "Click on the icon below to upload the complaint photos as evidence. Y…" (truncated in the layout).
- **Component**: single dropzone with camera-icon "+" button. Optional.
- **API calls**: `POST /filestore/v1/files` per uploaded photo.
- **Footer**: **SUBMIT** (yellow) — final step.
- **Submit triggers**: `POST /pgr-services/v2/request/_create` with `serviceCode`, `description`, `address` (locality.code, pincode, landmark, geoLocation), `attachments[]`, `citizen.{name,mobile}`.

### Story 3.7: Confirmation

- **Route**: `/digit-ui/citizen/pgr/response`
- **Component**: `Response` (`products/pgr/src/pages/citizen/Response.js`)
- **Content**: green hero banner with thumbs-up icon, title "**Complaint Submitted**", "Complaint No." with the new `NCCG-PGR-YYYY-MM-DD-NNNNNN` ID, body "The notification along with complaint number is sent to your registered mobile number. You can track the complaint status using mobile or web app."
- **User actions**: single yellow button **"Go back to home page"** → returns to `/all-services`.
- **Note**: this route is also reused for the post-rate thank-you (Flow 6 reuses it) — content is identical; not state-aware.

---

## Flow 4: My Complaints

### Story 4.1: View My Complaints list

- **Route**: `/digit-ui/citizen/pgr/complaints`
- **Page component**: `ComplaintsList` (`products/pgr/src/pages/citizen/ComplaintsList.js`)
- **Title**: "My Complaints"
- **Card content** (per complaint):
  - **Subtype name** as the card title (e.g. "Land Ownership Dispute") — translated where seeded, raw UPPER_SNAKE otherwise.
  - 📅 calendar icon + filed date in `DD-Mon-YYYY` format.
  - "Complaint No" + the `NCCG-PGR-…` ID.
  - Status badge: pink/light pill **`OPEN`** or **`CLOSED`**.
  - Localised workflow status below (e.g. "Pending for assignment", "Resolved").
- **User actions**: card click → `/citizen/pgr/complaints/:id`.
- **API calls**: `POST /pgr-services/v2/request/_search?mobileNumber=…`.
- **Edge cases**: empty list → "No Complaints Found" card.

---

## Flow 5: Complaint detail + timeline

### Story 5.1: View complaint detail

- **Route**: `/digit-ui/citizen/pgr/complaints/:id` (PLURAL — see Routes table note).
- **Page component**: `ComplaintDetailsPage` (`products/pgr/src/pages/citizen/ComplaintDetails.js`).
- **Page heading**: "Complaint Summary".
- **Card 1 — "Complaint Details"** rows:
  - Complaint No.
  - Application Status (e.g. "Pending for assignment")
  - Complaint Type (the menuPath: e.g. "Lands")
  - Complaint Sub-Type
  - Additional Details (description text)
  - Filed Date (`DD-Mon-YYYY`)
  - Address — boundary chain rendered as: raw boundary code (e.g. `NAIROBI_CENTRAL` — issue #12), city ("Nairobi"), postal code.
- **Card 2 — Map**: shows `Lat: -1.292100 / Lng: 36.821900`-style overlay + blue **"Open in Maps"** button (opens external maps).
- **Card 3 — "Complaint Timeline"** (Story 5.2).
- **API calls**: `POST /pgr-services/v2/request/_search?serviceRequestId=…` + filestore for attachments.

### Story 5.2: View complaint timeline

- **Component**: vertical timeline below the detail card.
- **Title**: "Complaint Timeline".
- **Each checkpoint**:
  - Yellow dot (current state) or gray dot (past state).
  - Status name (translated: "Pending for assignment", "Complaint filed", "Resolved", "Rejected").
  - Date in `DD/MM/YYYY` format.
  - Actor: mobile-as-name (e.g. `712345678`) — rendered twice when `name === mobileNumber` (auto-register heuristic).
  - Channel: e.g. "Filed Via Web".
  - Comment + attachments (when present) per state.
- **States possible**: COMPLAINT_FILED → PENDINGFORASSIGNMENT → PENDINGATLME → RESOLVED → CLOSEDAFTERRESOLUTION (if rated). Branches: REJECTED → CLOSEDAFTERREJECTION; REOPEN → PENDINGFORASSIGNMENT.

---

## Flow 6: Rate complaint

### Story 6.1: Rate (UI render + submit)

- **Route**: `/digit-ui/citizen/pgr/rate/:id`
- **Page component**: `SelectRating` (`products/pgr/src/pages/citizen/Rating/SelectRating.js`)
- **Page renders for any complaint state** — UI doesn't gate by state (server rejects invalid actions on submit).
- **Heading**: "**How would you rate your experience with us?**" (rendered twice — page title + section title).
- **Fields**:
  - 5-star row.
  - Checkbox group "What was good ?" (note spaces around `?`): **Services** / **Resolution Time** / **Quality of Work** / **Others**.
  - Comments textarea.
- **Submit**: `PUT /pgr-services/v2/request/_update` with `workflow.action = "RATE"`, `rating` (1–5), `additionalDetail` (comma-joined feedback), `workflow.comments`.
- **Validation**: `rating > 0` is required; checkboxes + comments optional.
- **Post-submit**: redirects to `/citizen/pgr/response` (shared with the file-complaint confirmation — same template).

---

## Flow 7: Reopen complaint

### Story 7.1: Reopen wizard (multi-step)

- **Route**: `/digit-ui/citizen/pgr/reopen/:id` (sub-steps handled internally — declared paths in `Routes.js` are dead).
- **Page component**: `ReopenComplaint` (`products/pgr/src/pages/citizen/ReopenComplaint/index.js`)
- **Step 0 — Reason** (verified):
  - Title: "Choose Reason to Re-open the Complaint"
  - 4 radio options: "No work was done" / "Only partial work was done" / "Employee did not turn up" / "No permanent solution"
  - "Next" button.
- **Step 1 — Upload photos** (inferred): optional file picker.
- **Step 2 — Additional details** (inferred): freeform text.
- **Step 3 — Response** (inferred): confirmation.
- **Submit**: `PUT /pgr-services/v2/request/_update` with `workflow.action = "REOPEN"`.
- **Edge cases**: page renders for non-RESOLVED complaints (server rejects on submit).

---

## Flow 8: Profile

### Story 8.1: Edit profile (Name / Gender / Email / photo)

- **Route**: `/digit-ui/citizen/user/profile`
- **Page component**: `UserProfile` (`packages/modules/core/src/pages/citizen/Home/UserProfile.js`)
- **Fields rendered (the entire surface)**:
  - **Photo** placeholder + orange "+" camera button → file picker via `UploadDrawer`.
  - **Name \*** — pre-filled with mobile number for auto-registered citizens (`name === mobileNumber` heuristic).
  - **Gender** — dropdown.
  - **Email** — optional.
- **Submit**: red **"Save"** button → `PUT /user/{uuid}/_update` (and `POST /filestore/v1/files` for photo).
- **Validation**: name regex from MDMS (`/^[a-zA-Z ]+$/i` per `UserProfileValidationConfig`).
- **What's NOT here** (catalogue overstatements, none rendered): mobile field (immutable), language switcher, notification preferences, change-password modal. Issue #12 has the full list.

---

## Flow 9: Logout

### Story 9.1: Log out via sidebar

- **Trigger**: sidebar item "Logout" (NOT a header dropdown — none exists on this build).
- **Modal** on click:
  - Title: "Logout"
  - Body: "Are you sure you want to **Logout**"
  - Buttons: **Cancel** + **Yes, Logout** (yellow filled).
- **On confirm**: `Digit.UserService.logout()` → redirects to `/citizen/login`. Existing test `tests/citizen/logout.spec.ts` matches `:has-text("Yes")` — could tighten to `Yes, Logout` for fidelity.

---

## Flow 10: Auxiliary surfaces (mostly broken)

### Story 10.1: FAQ — ❌ broken

- **Route**: `/digit-ui/citizen/pgr-faq`
- **Status**: renders "Something went wrong" + Home button. Broken `<img>` placeholder shows raw text "error". Tracked in issue #12.

### Story 10.2: How it works — ❌ broken

- **Route**: `/digit-ui/citizen/pgr-how-it-works`
- **Status**: same "Something went wrong" page.

### Story 10.3: HELPLINE sidebar — ❌ dead handler

- **Trigger**: sidebar item "HELPLINE" (rendered raw, unlocalized).
- **Status**: click handler observed to do nothing (no nav, no modal, no `tel:` prompt). Tracked in issue #12.

### Story 10.4: What's New / events

- **Status**: not rendered on `/all-services` or `/pgr-home` on this build. Probably feature-flag-off; not validated.

---

## Cross-cutting reference

### Hooks → API endpoints

| Hook | Endpoint | Purpose |
|---|---|---|
| `useComplaintsListByMobile` | `POST /pgr-services/v2/request/_search` | citizen's complaints |
| `useComplaintDetails` | `POST /pgr-services/v2/request/_search` + filestore | one complaint with attachments |
| `usePGRUpdate` | `PUT /pgr-services/v2/request/_update` | rate / reopen / status transition |
| `useCustomMDMS(RAINMAKER-PGR.ServiceDefs)` | `GET /MDMS/v2/search` | complaint type list |
| `useStore.getInitData` | `GET /MDMS/v2/search` | tenant/UI/language config at boot |
| `usePGRInitialization` | boundary-service | populates `boundaryHierarchyOrder` in SessionStorage |
| `useWorkflowDetails` | `egov-workflow-v2` | timeline state transitions |

### Validation surface (citizen-side, sourced from MDMS)

- `ValidationConfigs.mobileNumberValidation` → mobile regex (10 digits, Kenya `07`/`01`)
- `UserProfileValidationConfig.name` → `/^[a-zA-Z ]+$/i`
- Pincode → 5 digits (Kenya, post-CCRS#478)
- Description → non-empty

### Where the citizen tenant comes from

```
Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code
  || Digit.ULBService.getCurrentTenantId()
```
On naipepea: citizen `tenantId` = `ke` (state); address `tenantId` = `ke.nairobi` (city). Split is enforced in the `_create` payload (CCRS-historical regression source).

### Known localization + data gaps (issue #12)

- `CS_LOGIN_REGISTER_WITH_EMAIL`, `HELPLINE` keys render raw.
- Subtype dropdown shows raw UPPER_SNAKE codes (e.g. `LAND OWNERSHIP DISPUTE`).
- `NAIROBI_CENTRAL` boundary code rendered raw in detail-page Address.
- Sub-County dropdown has duplicate entries (Makadara x2, Kibra x2 — root-`ke` boundary tree).
- `/pgr-faq` and `/pgr-how-it-works` render "Something went wrong".
- HELPLINE sidebar click is a dead handler.

---

## Coverage map (specs in `tests/citizen/`)

| Story | Spec covering it |
|---|---|
| 1.1 / 1.2 login | `login.spec.ts` |
| 1.1 mobile validator (CCRS#429) | `login-mobile.spec.ts` |
| 3.4 / 3.6 wizard payload (CCRS#478, address fields) | `create-fixes-2026-04-29.spec.ts` |
| 3.2 + 3.4 pin trap + cascade gate (CCRS#469, #477) | `pin-and-cascade-fixes-2026-04-29.spec.ts` |
| 3.1 complaint type localization | `complaint-type-labels.spec.ts` |
| 4.1 list + 5.1 detail + 5.2 timeline (citizen-fix subset) | `pgr-fixes.spec.ts` |
| 5.1 detail render no-crash | `complaint-details.spec.ts` |
| 5.2 + 6.1 timeline + rating localization (CCRS#473) | `timeline-fixes-2026-04-29.spec.ts` |
| 9.1 logout | `logout.spec.ts` |

### Material gaps (no citizen-side spec yet)

- **Story 1.3** new-user registration (only existing-user OTP login covered)
- **Story 2.1** all-services landing
- **Story 2.2** PGR brand home
- **Story 2.3** language switch
- **Story 3.7** end-to-end submit (citizen-driven happy path) — the lifecycle spec covers this but lives outside `tests/citizen/`
- **Story 6.1** rating UI happy path (only post-RATE backend assertion exists)
- **Story 7.1** reopen flow
- **Story 8.1** profile field-set guard (lock down what's exposed)
- **Story 10.1 / 10.2** aux page recovery (assert no "Something went wrong")
- **Story 10.3** HELPLINE smoke (when wired up)
