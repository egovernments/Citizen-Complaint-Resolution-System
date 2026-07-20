# Release Notes — v2.12 [DRAFT]

> **Status:** Draft — pending review before official release.
>
> Comparing v2.12 against the [v2.11](../docs/release-notes-v2.11.md) tag.
> Originally drafted 2026-06-30; updated 2026-07-20 to fold in everything
> merged to `develop` since (through PR #1311).

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
- Supervisor dashboard now embeds as an ACS-gated employee module rather than a standalone app (#1062); route/card access resolves from MDMS (`dss.DashboardConfig`) with a code fallback (#1258).
- KPIs can be grouped by complaint-hierarchy level, with a per-widget "Group by" control and a tree-traversal complaint-type filter for one-widget subtree navigation (#1282, #1283, #1285).
- Tenant-configurable number display format (#1272); server-side query duration/row metrics with trace-correlated slow-query logging, plus client-side render-lag instrumentation (#1267, #1268).
- Dashboard wired to the localization service, with a pt_PT locale pack and full i18n coverage for widget text, picker titles, header/date, and CSV export (#1135, #1214, #1159, #1161).
- Employee dashboard layout, filters, and chart chrome polished; Add-KPI attach and drag-and-drop placement made reliable (#1311, #1287).

### Configurator
- Phase 2 supports dual path: one-click OSM boundary fetch alongside the existing Excel upload.
- Boundary maps added to the Management view.
- N-level hierarchy management UI; `COMPLAINT_HIERARCHY` localization seeding introduced.
- "Use existing tenant" path added on Phase 1; polygon picker moved to the verify step.
- Server-side pagination implemented for MDMS list views.
- Self-hosted Overpass server for boundary fetching; configurable boundary search limit.
- Org Chart view added for HRMS reporting hierarchy (#872).
- All locales can now be edited side-by-side in the localization list (#1004).

### PGR / Complaints
- Employees can now filter the inbox by assignee when searching service requests.
- Geo-location map field added to the employee create-complaint form.
- Employee complaint type dropdowns scoped to the user's own department(s).
- Per-complaint-type SLA shown in the employee inbox with server-side SLA sort and status filter.
- Multi-department assign introduced; department localization applied on assign action.
- Routed department stamped onto `additionalDetail` on assignment for downstream grouping.
- My/All complaint inbox visibility tabs shipped, initially without notification counts (#1052, #1269).
- Complaint schema extended with encryption and extended attributes (#983).
- `RAINMAKER-PGR.MapConfig` established as the single source of truth for map tooling and starting position (#1162).
- Gateway RBAC phase 3: complaint-facing routes now resolve against one whitelist with a parity CI check (#1128).

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
- Config-driven PGR notifications: MDMS-routed, multi-channel, self-service configuration for SMS/Email/WhatsApp (#1059).
- WhatsApp Content-SID template delivery pipeline, with a Twilio sync UI/CLI and runbook (#1284).
- Novu dashboard image rebased onto a subpath so it survives redeploys (#926).

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
- Per-service Flyway init containers close the DB-migration parity gap between Compose and K8s, extended to every schema-owning service (#1142, #1273); audit-service kept on k8s and added to compose (#1157).
- `hot-deploy.sh` script + guide added for fast local iteration on pgr-services, digit-ui-esbuild, and configurator without a full compose rebuild (#1112).
- On-host `digit-ui` build fixed to work on Ubuntu (Node 20 + npm) (#1065); unused services (DSS, service-request, PDF) disabled and their dead config pruned (#1103).
- Ansible CI hardened: `ansible-lint`/`yamllint` gates, idempotent teardown/re-run, and static-validation phases (#700, #709); CodeRabbit wired up to auto-review PRs targeting develop (#1054).

### Testing
- Integration suite made deployment-agnostic; stale specs audited and repaired (#1145).
- One-time deployment-profile discovery (tenant data, personas, seed plan, capability details) persisted for reuse across the suite, with expectations manifests and capability-based gating so only relevant assertions run per environment (#1304).

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
- `PGR_ESCALATION_ENABLED` surfaced in deploy env blocks so escalation can be toggled per deployment (#1072).
- Legacy `egov-location` callers migrated onto `boundary-service` (#1098).

### Configurator
- Bulk-employee validation no longer false-negatives due to partial MDMS master fetch.
- Legacy (v1/v2) ThemeConfig records can now be shown and edited.
- Boundary picker restricted to LEAF boundary types only.

### Mobile Number Validation
- Validation consistency and i18n error messaging aligned across Configurator and PGR (#1152).
- `INTERNAL_USER`/`ADMIN` seed mobile numbers now derive from each tenant's `mobileNumberRegex` instead of a fixed default (#1125); `egov-user` mobile-validation defaults rewritten per tenant (#1264).
- A non-compiling MDMS mobile regex now warns instead of silently failing (#1154).

### Dashboard
- Analytics global date range applied consistently to all event-grain queries.
- Chart hover tooltips and cursor positioning unified across all viz types.
- Centralized viz style registry introduced; shared chart components extracted.
- Supervisor KPI tiles and deltas aligned with the CSV spec (cohort formulas, uniform % / pp / duration delta formatting); complaints-by-channel pie respects the global date filter instead of always showing a live snapshot (#963).
- Geography choropleth extended with Created/Open/Resolved layers, real ward-polygon boundaries, and click-to-zoom drill (replacing convex-hull clustering) (#963).

### Deploy / Infrastructure
- Compose/K8s dual-deploy parity gaps closed across charts and the test harness (#1292).
- Gatus health dashboard expanded: missing services added, Postgres unmasked, optional stacks gated (#1297); the k3s tier unbroken and four false-green holes closed in the coverage guard (#1303).
- `audit_service_schema` registered in the flyway-history-map, fixing `develop` CI (#1221).
- Dead `/egov-rainmaker` nginx passthrough and its feature flag removed (#958).
- Default boundary seed data cleaned up: ward-level nodes added between zones and blocks, with corrected boundary codes and parent-child relationships (#1302).

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
- Full address now shown on the complaint detail page; type pickers made sortable/searchable (#974).
- Citizen complaint search scoped to the citizen's own records (#1100).
- Assignee made optional in the Assign Complaint modal (#1048).
- Client-provided department no longer overwritten on service update (#1077); masked confidential-field placeholders no longer overwrite real data on update (#1092).
- Duplicate inbox hook fixed (#1122).
- Employee inbox: total count no longer caps at page size, pagination completed, column-header sort actually works, and SLA computation/status filter made resilient (#1058, #1014, #1212, #1144).
- Batch of Moz-QA product-bucket fixes: address dropping the tenant/city token, text input field sizing, header logo `object-fit`, inbox date-range control sizing, strict profile-email validation, and more (CCSD-1980–1993) (#1179).

### Configurator
- Phase 2 boundaries written at the city tenant, not the state root.
- Boundary multi-hierarchy fetch retrieves all hierarchy types, not just ADMIN.
- Employee mobile rule now sourced from MDMS, dropping the erroneous 10-digit HRMS clamp.
- Kenyan mobile numbers with optional trunk-zero accepted in the fallback validator.
- Dept/designation localizations written to `rainmaker-common` instead of incorrect module.
- Phase-1 branding card overflow fixed; Phase-4 default jurisdiction hierarchy defaults to ADMIN.
- Re-login prompt on an expired session during boundary create now clears correctly (#984).
- Stale form data no longer nulls `reActivateEmployee` (#1141).

### Core / UI
- Button styling resolves correctly: design tokens loaded before Tailwind in digit-ui-v2.
- JPEG extension/MIME normalized on profile image upload.
- `.jsx` files now resolved and transpiled in the production webpack build.
- Login error shown as readable toast instead of raw localization key.
- Toast auto-dismiss and close button unified into one env-configurable timer (#993).
- Ward names localized on the citizen OSM map (#1002).
- Uploaded profile photo now shows in the employee topbar and citizen desktop sidebar (#1006).
- Deployment-agnostic fixes surfaced by running the full suite against a non-Kenya deployment: tenant de-hardcoding, onboarding logoId, boundary-leaf handling, citizen pages, data-provider (#1143).

### Dashboard
- Bar chart x-axis labels hidden when cramped; yellow in-progress SLA pill hidden.
- Bar view chart size measured correctly when mounted after toggle.
- Saved dashboard layouts no longer reflow on page refresh; legacy storage keys migrated.
- Date-filter change no longer blanks the dashboard when `filterOptions` is null (#1013).
- V2 analytics grains and the daily-snapshot refresh scheduler fixed (#1005).
- Dashboard catalog kept in sync with on-disk runs (#1046); consolidated SLA/hierarchy-grain bug fixes plus configuration docs (#1081).

### Auth / Identity
- ADMIN user re-provisioned with the correct encryption key post-bootstrap (#1042).
- HRMS always sets `reActivateEmployee`, avoiding a `NullPointerException` on `_update` (#1056).
- `egov-user-event` service-host namespace corrected (`.staging` → `.egov`) (#1099).
- Kong now emits `InvalidAccessTokenException` on an expired session so digit-ui re-logs in, instead of hanging (#1101); empty JSON arrays preserved through the auth-enrichment pre-function (#1038).
- Real-OTP enablement path on compose repaired; local-setup now defaults to OTP mock with documented steps to enable real OTP (#1102, #1060).

### Notifications
- `novu-bridge` no longer persists a dispatch-log row on a missing-`subscriberId` rejection (#1137).
- Novu dashboard `/env/` deep links now route to the dashboard SPA instead of 404ing (#1120).

### Deploy / Infrastructure
- `token-exchange-svc` port changed to 18300 to avoid collision with OpenBao.
- HRMS post-bootstrap restart removed to eliminate HRMS bootstrap race condition.
- India pincode allowlist no longer seeded on new (non-India) tenants.
- Dataloader correctly creates city-level PGR workflow when only the parent tenant exists.
- `INTERNAL_USER` seeded on state root so HRMS survives non-pg tenants.
- Tilt onboarding path repaired; `digit-ui` build no longer floats to a stale image (#1288).
- Mobile-number validation schema updated and the DB dump cleaned up to match (#1022).

### Chatbot
- Correct tenant ID used for complaint tracking in sandbox mode.
- User `mobileNumber` preserved in session state to fix Twilio messaging.
- Complaint tracking flow and location resolution fixed.

### Analytics
- Global date range applied to events grain via `complaint_created_at`.
- `account_id` made groupable on facts for top-complainants query.
