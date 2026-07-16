# Release Notes — v2.12 [DRAFT]

> **Status:** Draft — pending review before official release.
>
> Comparing v2.12 against the [v2.11](../docs/release-notes-v2.11.md) tag.

---

## Features

### Complaint Hierarchy (N-Level)
- Introduced configurable N-level complaint classification hierarchy, replacing the prior fixed 2-level ServiceDefs model. Complaints can now be organized across any number of sub-categories and departments via the new `ComplaintHierarchy` MDMS schema.
- Complaint details pages now display the full hierarchy path (category → sub-category → type).
- Added one-click migration tool in the Configurator for upgrading existing 2-level complaint trees to N-level without manual data changes.

### Dashboard & Analytics
- New supervisor dashboard with live analytics: KPI cards, drag-and-drop widget inventory, and configurable layouts.
- Supervisor dashboard wired to the real analytics query API; global time-window filter and per-complaint-type SLA metrics available.
- New V2 analytics grains (materialized views) and a dynamic JSON→SQL query API for ad-hoc KPI reporting.
- Geography map redesigned; SLA toggle, bar/line charts, and channel donut chart added.
- Per-card last-updated timestamps added; SLA status pill made read-only.

### Configurator
- Phase 2 supports dual path: one-click OSM boundary fetch alongside the existing Excel upload.
- Boundary maps added to the Management view.
- N-level hierarchy management UI; `COMPLAINT_HIERARCHY` localization seeding introduced.
- "Use existing tenant" path added on Phase 1; polygon picker moved to the verify step.
- Server-side pagination implemented for MDMS list views.
- Self-hosted Overpass server for boundary fetching; configurable boundary search limit.

### PGR / Complaints
- Employees can now filter the inbox by assignee when searching service requests.
- Geo-location map field added to the employee create-complaint form.
- Employee complaint type dropdowns scoped to the user's own department(s).
- Per-complaint-type SLA shown in the employee inbox with server-side SLA sort and status filter.
- Multi-department assign introduced; department localization applied on assign action.
- Routed department stamped onto `additionalDetail` on assignment for downstream grouping.

### Mobile Number Validation
- `common-masters.MobileNumberValidation` is now the single authoritative source across all surfaces (frontend, Configurator, MCP, employee profile, complaint forms).
- Mobile validation lengths derived entirely from the configured regex; static `mobileNumberLength` field removed.
- Real-time mobile validation added to the create-complaint page with i18n error messages.
- Country-specific defaults supported (Kenya +254, Ethiopia, India).

### Keycloak / Authentication
- Full Keycloak integration added behind `enable_keycloak` flag: OAuth2 Authorization Code flow with PKCE, KC-aware logout, and per-surface auth provider selection.
- Pluggable `AuthAdapter` layer introduced so DIGIT-native and Keycloak auth coexist.
- `digit-ui-v2` SPA published with platform-admin login, dashboard, and bootstrap wizard.

### Notifications (Novu / WhatsApp)
- Full Novu notification stack added behind a `notifications` Docker Compose profile.
- PGR complaint lifecycle events (create, assign, reassign, resolve, rate, escalate) wired to WhatsApp delivery via Twilio Content SIDs.
- OTP services enabled by default; `novu-bridge` endpoint added for channel-aware SMS and WhatsApp dispatch.

### MCP Tools
- `ComplaintHierarchy` and multi-department support added to all MCP tools.
- System-state snapshot and diff capability added to `digit-mcp`.
- `city_setup_from_xlsx` emits a GeoJSON sidecar for boundary polygons.

### Chatbot (WhatsApp / xstate)
- xstate PGR chatbot flow aligned with `ComplaintHierarchy` for complaint-type/category labels.
- Multi-tenant support added for the sandbox WhatsApp chatbot.
- Complaint lifecycle REASSIGN and RATE events wired into the chatbot notification flow.

### Observability
- Full observability stack added: JVM metrics, logs, and distributed traces via OpenTelemetry + Promtail. Grafana root URL exposed per tenant.

### Deployment / Infrastructure
- Nightly-build pipeline introduced for all high-churn container images (Configurator, digit-ui-v2, MCP, digit-ui-esbuild).
- macOS deployment path added with Darwin-specific OpenBao re-unseal.
- `digit-configurator`, `digit-mcp`, and `digit-ui-esbuild` vendored into the CCRS monorepo.
- `CMS_SCREENING_OFFICER` access role added with corresponding role-actions.

---

## Enhancements

### Localization / i18n
- Configurator UI fully internationalized: list column headers, page titles, resource labels, and all UI chrome translated (en/hi/fr/pt).
- Complaint status display uses a centralized localization service with consistent prefix across all surfaces.
- Complaint-type labels use the `COMPLAINT_HIERARCHY` localization prefix uniformly.
- MDMS cache moved to IndexedDB to prevent `localStorage QuotaExceededError` on large datasets.

### PGR / Complaints
- `additionalDetail` persisted correctly from DB reads; 600-character constraint removed.
- Inbox pagination enabled via `totalCountJsonPath`; inbox sort column headers made clickable.
- Assignment allowed for unmapped/NA-department complaint types.
- OSM map base theme for the citizen complaint map made configurable per tenant.

### Configurator
- Bulk-employee validation no longer false-negatives due to partial MDMS master fetch.
- Legacy (v1/v2) ThemeConfig records can now be shown and edited.
- Boundary picker restricted to LEAF boundary types only.

### Dashboard
- Analytics global date range applied consistently to all event-grain queries.
- Chart hover tooltips and cursor positioning unified across all viz types.
- Centralized viz style registry introduced; shared chart components extracted.

### Authentication / Profile
- Citizen sidebar avatar refreshed after Edit Profile save.
- Profile photo `fileStoreId` resolved before avatar render with fallback for thumbnails.

### Tests
- All Playwright/e2e specs parameterized via env helpers (no hardcoded tenant IDs).
- Lifecycle setup seeds two PGR complaints; downstream specs consume shared fixtures.
- `ServiceRequestValidatorTest` (10 tests) added for boundary and MDMS validation scenarios.

---

## Bug Fixes

### PGR / Complaints
- Location dropdown now appears correctly on the employee create-complaint form.
- Citizen location toast auto-dismissed; close button added.
- Complaint Type/Sub-Type dropdowns no longer blank out on employee complaint create.
- Department-undefined guard applied to `AssigneeComponent` to prevent crashes.
- All role-filtered employees shown in assignee dropdown when department is undefined.
- Employees can now create complaints for any department regardless of their own assignment.
- Boundary dropdown options deduplicated by code in the PGR citizen form.
- ESCALATE action added to `ACTION_CONFIGS` so the Escalate modal opens correctly.
- Hardcoded Nairobi ward sidecar removed from the complaint map.
- Ward `isLeaf` flag set correctly so boundary cascade enforcement fires on submit.
- Assignee name now resolved from `lastModifiedBy` via user search API.

### Configurator
- Phase 2 boundaries written at the city tenant, not the state root.
- Boundary multi-hierarchy fetch retrieves all hierarchy types, not just ADMIN.
- Employee mobile rule now sourced from MDMS, dropping the erroneous 10-digit HRMS clamp.
- Kenyan mobile numbers with optional trunk-zero accepted in the fallback validator.
- Dept/designation localizations written to `rainmaker-common` instead of incorrect module.
- Phase-1 branding card overflow fixed; Phase-4 default jurisdiction hierarchy defaults to ADMIN.

### Core / UI
- Button styling resolves correctly: design tokens loaded before Tailwind in digit-ui-v2.
- JPEG extension/MIME normalized on profile image upload.
- `.jsx` files now resolved and transpiled in the production webpack build.
- Login error shown as readable toast instead of raw localization key.

### Dashboard
- Bar chart x-axis labels hidden when cramped; yellow in-progress SLA pill hidden.
- Bar view chart size measured correctly when mounted after toggle.
- Saved dashboard layouts no longer reflow on page refresh; legacy storage keys migrated.

### Deploy / Infrastructure
- `token-exchange-svc` port changed to 18300 to avoid collision with OpenBao.
- HRMS post-bootstrap restart removed to eliminate HRMS bootstrap race condition.
- India pincode allowlist no longer seeded on new (non-India) tenants.
- Dataloader correctly creates city-level PGR workflow when only the parent tenant exists.
- `INTERNAL_USER` seeded on state root so HRMS survives non-pg tenants.

### Chatbot
- Correct tenant ID used for complaint tracking in sandbox mode.
- User `mobileNumber` preserved in session state to fix Twilio messaging.
- Complaint tracking flow and location resolution fixed.

### Analytics
- Global date range applied to events grain via `complaint_created_at`.
- `account_id` made groupable on facts for top-complainants query.
