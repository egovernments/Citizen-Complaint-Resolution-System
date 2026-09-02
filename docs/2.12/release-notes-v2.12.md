# DIGIT Complaint Management System (DIGIT CMS) v2.12 — Release Notes

*Release Documentation: Complaint Management System*

{% hint style="info" %}
**Release Date:** _TBD — set at release sign-off. This document consolidates the 2.12-beta draft (2026-08-03) with everything that landed afterward, including a further sync pass after 2026-08-27 (208 additional commits) — items from that pass are marked "landed after the 2026-08-25 pass" throughout._
{% endhint %}

> **Note on product nomenclature:** The product is now called **the DIGIT Complaint Management System (DIGIT CMS)**. It was previously known as Public Grievance Redressal (PGR) and Citizen Complaint Resolution System (CCRS). This evolution positions the Complaints Management System to support a broader range of citizen engagement, case management, incident management and grievance resolution use cases across programmes and government contexts.
>
> The source-code repository continues to use the CCRS name while the updated product identity is introduced across communications. Retaining the existing repository name during this transition helps avoid disrupting integrations, deployment pipelines and other automations that implementation partners may have built around it.
>
> Some technical components, service names and configuration keys, such as `RAINMAKER-PGR.*` and `pgr.*`, continue to use the earlier PGR terminology for backward compatibility. These references relate only to the underlying implementation and should not be used as the product or feature name.

---

## About This Release (Indicative press release)

DIGIT CMS v2.12 is the most significant release of the Complaints Management System since the repository was consolidated. It expands the product from a conventional grievance-redressal system into a configurable platform that can support multiple complaint, service-request and case-management use cases. In practical terms, this allows a local government to:

- **Organize complaints in line with the structure in citizen charters.** Complaint categories are no longer fixed at two levels — complaint type and subtype; governments can configure complaint categories to the level of detail required and assign them to the appropriate responsible units, without being restricted to a fixed two-level hierarchy.
- **Monitor performance through a personalized dashboard.** Last mile resolvers and their supervisors see information relevant to their area of responsibility, including preset indicators on complaint volumes, resolution times, status and geographic distribution, with clear explanations of what each indicator represents.
- **Share performance publicly.** A new, curated public dashboard lets a city publish selected statistics for citizens and the public to see, with no login required — the city administrator chooses exactly which indicators are shown.
- **Keep citizens informed using a powerful notification engine.** Governments can automatically send timely updates through **SMS**, **WhatsApp** and **Email** at key stages of a complaint, including registration, assignment, resolution and reopening. Notification rules, channels and message templates can be configured without code changes.
- **Make sure nothing slips through!** Overdue complaints can be escalated either for action by the next responsible level or for visibility by supervisory authorities. A tamper-evident audit trail records every action and status change, supporting clear accountability and review.
- **Enable two-way engagement through WhatsApp.** Citizens can now receive complaint updates and respond through the same channel, allowing governments to collect additional information, support follow-up actions and keep communication connected to the complaint lifecycle.
- **Deploy across countries with built-in internationalisation.** Governments can configure country-specific formats and validation rules for phone numbers, postal codes, names and email addresses, rather than relying on requirements hardcoded for a single geography. Configurators are able to fetch geography information.
- **Decide precisely who can see what.** A new access-control policy engine governs who can see which dashboard and search results, replacing a handful of hardcoded role exemptions with a configurable, per-city policy.
- **Get up and running much faster and consistently with Ansible based setup.** The earlier Jupyter Notebook-led installation process has evolved into a streamlined, automated deployment workflow. Implementers now complete a single settings file for each local government and run one command, while built-in pre-flight checks identify common configuration issues before deployment begins.

The one-command deployment is supported on **Ubuntu** and **macOS**, with a validated quickstart for **Windows via WSL2** (see the [Windows quickstart guide](../../WINDOWS-QUICKSTART.md)). Native Windows and Red Hat Linux are not yet explicitly supported.

Most new capabilities are **switched off until a city chooses to turn them on**. An upgraded installation behaves like v2.11 until each feature is enabled (see [Turning Features On](#turning-features-on--configuration)). A small number of changes require action from the operations team before upgrading; they are summarised in [Changes That Need Attention Before Upgrading](#changes-that-need-attention-before-upgrading) and covered step-by-step in the migration guide.

## What Is New in v2.12

**For citizens**

- **Journey-wide notifications** through SMS, WhatsApp and email for filing, assignment, resolution, rating and escalation.
- **Two-way WhatsApp support** for filing, tracking and responding to complaints, available as a multi-city sandbox pilot.
- **A simpler complaint form** with map-based location capture, improved category selection, country-specific validation and local-language error messages.
- **Auditable, automated escalation** when complaints exceed their resolution time.
- **Public Dashboard** — a curated, no-login view of selected complaint statistics, so citizens can see how the city is performing without needing an account.

**For employees and supervisors**

- **Complaint hierarchies of any depth**, aligned with the local government's service structure or citizen charter.
- Improved **employee inbox** with assignee filters, SLA visibility, reliable sorting and pagination, and optional My Complaints and All Complaints views.
- An evolved **Grievance routing officer** role to review incoming complaints and route them to the right department with human-in-the-loop mechanisms.
- **Personalised Supervisor Dashboard** with live counts, resolution times, charts, complaint maps and CSV export, scoped by jurisdiction and department.
- **Automatic escalation** of complaints that stay unresolved past their allowed time.
- **A working-context switcher** in the top bar, so an employee holding more than one department/role can see and switch which one they're currently acting as.

**For city administrators (Admin Console / DIGIT Configurator)**

- **One-click geography setup** through OpenStreetMap, alongside Excel upload and map-based verification.
- Manage the new multi-level complaint categories, view the staff **organisation chart**, edit all languages side-by-side, and sync WhatsApp message templates with the provider.
- **Configurable reopening period** for resolved complaints, with a default window of five days.
- **Choose what's public.** Pick exactly which Supervisor Dashboard indicators are shown on the new Public Dashboard.
- **Control access precisely.** Configure the new access-control policy to decide which roles can see which dashboard and search results.
- **Expanded configuration tools** for complaint hierarchies, staff structures, multilingual content and WhatsApp templates.

**For the IT / operations team**

- **Local government deployment** using one settings file, with pre-flight checks before installation.
- **Automated test suites** are now available for the employee and citizen experiences.
- **System health monitoring built in.** Built-in observability through service logs, metrics, request traces and ready-made dashboards.
- **Stronger security and accountability** through tamper-evident audit trails, encrypted personal data and secure secrets management with OpenBao.
- **One place for every image.** Every service build now comes from a single public source instead of a mix of internal and public locations, so deployments work outside the internal network too. The Configurator and citizen/employee UI builds are now produced for both common processor architectures.
- **A validated path for Windows**, via WSL2.
- **Platform version** upgraded to 2.9.3.

## New Components in v2.12

| Component (plain name) | What it does | How it's switched on |
|---|---|---|
| **Supervisor Dashboard** | Live complaint statistics, charts, and maps for supervisors | Installer script on a running system (`enable-dashboard.sh`) |
| **Public Dashboard** | Curated, no-login view of selected statistics, for citizens/the public | City admin chooses which indicators are public, in the Admin Console |
| **Access-control policy engine** | Decides who can see which dashboard/analytics/search rows | Ships with the complaints service; policy is per-city setup data |
| **Reports & statistics engine** (v2 analytics, in the complaints service) | Answers the dashboards' questions ("how many complaints, where, how fast resolved") | Ships with the complaints service; refresh on by default |
| **Notification services** (Novu stack: novu-bridge & bridge-endpoint, dashboard) | Sends and tracks SMS / WhatsApp / Email messages | `enable_novu` deployment flag |
| **OTP service** (otp-publisher) | Sends real one-time passwords for login instead of a test stub | `enable_otp_services` deployment flag |
| **WhatsApp chatbot** (xstate-chatbot) | Lets citizens file and track complaints on WhatsApp | Kubernetes deployment only (pilot) |
| **Location search** (turbopass) | Address/place auto-complete when setting up city boundaries | `enable_turbopass` deployment flag (off by default) |
| **Audit service** | Keeps the tamper-evident record of complaint changes | Always on |
| **Host monitoring** (node-exporter) | Server CPU/memory/disk metrics for the monitoring dashboards | Always on |

---

## Turning Features On — Configuration

This section is the map of **how to turn each feature on** and **which settings it reads**. Settings live in three places:

- **Deployment settings** — one file per city: `local-setup/ansible/inventory/host_vars/<city>.yml` (see `_example.yml` for the annotated catalogue).
- **Complaints-service settings** — `application.properties`, overridable per deployment via environment variables (`PGR_*`).
- **City master data (MDMS)** — per-city data editable in the Admin Console (DIGIT Studio) or via the MDMS API. Fresh installations get sensible defaults automatically; **already-running cities must add the new records themselves** (seeding only happens at creation).

### 1. Multi-Level Complaint Categories — *always on*

Complaints are now classified using a category tree the city defines — for example *Sanitation → Garbage → Missed collection* — instead of a fixed two-level list. Already-filed complaints keep working as long as the same category codes are reused.

| | |
|---|---|
| Enable | Nothing to flip — this is the classification model in v2.12. |
| City data | `RAINMAKER-PGR.ComplaintHierarchyDefinition` (the shape: how many levels, their names), `RAINMAKER-PGR.ComplaintHierarchy` (the actual category tree; a leaf's `code` **is** the complaint's `serviceCode`). Default: a 2-level tree (Category → Sub-type). Editable in DIGIT Studio. |
| Existing cities | **Action required** — convert old `ServiceDefs` rows into the two new records, reusing leaf codes so existing complaints stay valid. Use the validated migration tool ([servicedefs-to-complainthierarchy-migration.md](../migration/servicedefs-to-complainthierarchy-migration.md)) rather than doing this by hand — migration guide Section 2.1. |
| Related | Migration `V20260731000000__repoint_grain_mvs_to_complainthierarchy.sql` (and, found during later validation, `V20260810000000__tenant_business_calendar_grains.sql`, which fixes report time-groupings to use each city's own time zone) repoint the reporting views to the new categories — run automatically. |
| Watch out for | Two gaps found during real-world validation of this migration: a complaint whose category hasn't been migrated yet will fail to send notifications on its next workflow action even though it still opens and displays fine; and the reporting views resolve a category's department by comparing across every city in the deployment rather than each city's own, so two cities sharing a default category code with different departments can end up showing one city's department on the other's dashboard tiles. See the migration tool's documentation for exposure-check queries. |

### 2. Supervisor Dashboard

Live counts, resolution times, charts, and a complaint map. Each supervisor sees only their own area and department; access is role-based.

| | |
|---|---|
| Enable | On a **running** deployment: `local-setup/scripts/enable-dashboard.sh` — registers the dashboard data definitions, loads 39 ready-made statistics + 1 dashboard pack (mapped to the roles that exist on that deployment), grants the menu entry, loads the dashboard's translations for every language, refreshes login tokens, and verifies end-to-end. |
| City data | `dss.KpiDefinition`, `dss.DashboardPack`, `dss.DashboardConfig` (who can see which pages, number formats, department scoping). |
| Service settings | `pgr.dashboard.refresh.enabled=true` (statistics refresh, on by default), `.interval.ms`; `pgr.analytics.config-cache-ttl-ms`. |
| Gateway | Whitelist `/v2/dashboard` **and** all of `/v2/analytics/_query`, `_schema`, `/packs`, `catalog/_search`. |
| Important caveat | The dashboard only shows a supervisor data for their own area **and department**, and errs on the side of showing nothing: **an employee whose HR record has no department will see an empty dashboard.** Check department assignments in HR data first; `dss.DashboardConfig.departmentScoping=false` turns the department restriction off city-wide. |
| Performance telemetry | The dashboard reports its own loading speed by default, which adds two public gateway routes (`/otel/v1/metrics`, `/otel/v1/logs`). `dashboard_metrics_enabled: false` stops the dashboard from *sending* this telemetry, but the two routes themselves stay in place — they are not removed by this setting. |
| An older dashboard | The pre-catalog dashboard that predates this KPI-catalog-driven Supervisor Dashboard is now hidden by default, kept only as a rollback aid. |

### 3. Public Dashboard

A curated, no-login view of selected Supervisor Dashboard statistics, for citizens and the public.

| | |
|---|---|
| Enable | City admin picks which KPIs to expose, in the Admin Console's public-dashboard screen; backed by `dss.DashboardConfig`. |
| Access | Served without a login session, at its own web address. Deliberately excludes the schema-introspection endpoint (`_schema`) from its gateway whitelist, so a public caller can't discover column/data structure — only `/packs`, `/catalog/_search`, and `/_query` are exposed. |
| Isolation | A public caller cannot escape the curated set of indicators the city admin selected — verified by dedicated isolation tests. |

### 4. Row-Level Access Control (Dashboards, Analytics & Search)

Decides which rows of dashboard, analytics, and search data a given role/employee can see, replacing a set of hardcoded role exemptions with a configurable policy.

| | |
|---|---|
| Enable | Ships with the complaints service; the policy is per-tenant seed data (a scope-policy record keyed to a specific access-control action, with per-role scopes). |
| What it does | For roles without an explicit scope entry, a default policy applies (typically: all departments, own jurisdiction only). If an employee's HR record has no resolvable jurisdiction or department, that axis resolves to a deny-all rather than an unrestricted view. |
| Watch out for | An independent review of this feature found real gaps for admin-level roles: tenant-wide admin/supervisor roles can lose unrestricted dashboard access and see it go empty; a cross-tenant authorization gap lets one tenant's role refresh another tenant's dashboard config cache; the "department scoping disabled" override can be silently skipped; and a fresh/source-less tenant bootstrap can end up with no row-scope policy seeded at all. **Verify this specifically for any admin/supervisor role your city relies on before enabling.** See Known Issues. |

### 5. Citizen Notifications — SMS, WhatsApp & Email

Automatic messages to citizens (and staff) at each step of a complaint — filed, assigned, reassigned, resolved, rating requested, escalated. Which audience gets which message on which channel is configuration, not code.

| | |
|---|---|
| Enable | (1) Deployment flag `enable_novu: true` (starts the notification services); (2) complaints-service setting `pgr.notification.config.driven=true` (deployment flag `pgr_notification_config_driven`); or simply run the guided installer `local-setup/scripts/enable-notifications.sh` on a running system. Verify with `local-setup/scripts/drive-test-complaint.py`. |
| City data | `RAINMAKER-PGR.NotificationRouting` (who is notified, on which step, on which channel), `.NotificationTemplate` (the message wording, with placeholders), `.NotificationProviderTemplate` (maps each WhatsApp message to the provider's approved template ID). |
| WhatsApp — read this | **The sample WhatsApp template IDs shipped with the product belong to the reference demo account and will not work anywhere else.** Each city must author its own WhatsApp message templates, get them approved (Meta approval via Twilio), and load *its own* template IDs — via the Admin Console's **Sync WhatsApp templates** screen or `local-setup/scripts/persist-provider-templates.py`. This is the single most common reason WhatsApp messages silently don't arrive. (Do **not** use the old `notif-mdms-seed/seed.sh` script — it loads data the current delivery path no longer reads.) |
| Channel defaults | The default channel is now **SMS** (previously WhatsApp), and **WhatsApp is off until explicitly enabled** (`novu.bridge.channels.enabled` defaults to `SMS,EMAIL`; WhatsApp events log as skipped until added). |
| Split-domain setups | Notification-dashboard URLs default to the city's own domain; if TLS terminates on a different public hostname set `novu_public_base_url` (per-URL overrides exist for rare cases). |
| Old messages | The previous fixed SMS wording (localisation keys) still works for cities that don't opt in — it is now deprecated. |

### 6. Automatic Escalation of Overdue Complaints — *on by default*

A complaint that stays unresolved past its allowed time moves up automatically — for example from the field worker to their supervisor — up to a configurable number of levels.

| | |
|---|---|
| Enable/disable | On by default (`pgr.escalation.enabled=true`); per-deployment override `PGR_ESCALATION_ENABLED`. |
| City data | `RAINMAKER-PGR.EscalationConfig` — how many levels (`maxDepth`), the time allowed per level, optional per-category overrides. Shipped default: 3 levels at 1 h / 4 h / 24 h; with no record at all, a 5-day fallback applies. |
| Service settings | `pgr.escalation.interval.ms`, `.batch.size`, `.default.sla.ms`, `.max.depth`, `.kafka.topic=pgr-escalation-events` — **this messaging topic must exist** while escalation is on. |
| Prerequisite | `Workflow.BusinessServiceMasterConfig` must contain a `PGR` row (`active:true, isStatelevel:true`). |

### 7. Employee Inbox — "My Complaints / All Complaints" — *off by default*

Adds two tabs to the employee inbox: complaints assigned to me (and my team), and all complaints I'm allowed to see, based on the HR reporting hierarchy.

| | |
|---|---|
| Enable | `pgr.visibility.enabled=true` (env `PGR_VISIBILITY_ENABLED`) **plus** a per-city `RAINMAKER-PGR.InboxVisibilityConfig` record. Without the record the inbox behaves as before. |
| Service settings | `pgr.visibility.hrms.employee.save.topic` / `.update.topic`, `.reportee.depth.default`, `.unassigned.states`, `.rebuild.cron`, `.rebuild.batch.size`, `.team.fanout.max`. |
| Endpoints | `POST /v2/request/inbox/_search`, `POST /v2/request/inbox/_count` (whitelist if enabling). |
| Data | Uses a local copy of the HR reporting hierarchy (`eg_pgr_hrms_projection`, created by migration `V20260715000000`). |

### 8. Country-Specific Form Checks — phone, postal code, name, email

Forms now validate against the city's own country rules — phone-number format, postal-code format, name and email patterns — instead of a hardcoded single-country default. Error messages are generated from the rule and translated automatically.

| | |
|---|---|
| Phone numbers | `common-masters.MobileNumberValidation` — one record per country code with the number pattern. **Exactly one record must be marked `default: true`** (the shipped record is not); otherwise the app quietly falls back to a built-in single-country pattern. Requires the 2.12 build of the User Service, which reads this record. |
| Postal code / name / email | **New record type `common-masters.FormValidations`** — one row per field (`postalCode`, `name`, `email`) with its pattern. This is the primary per-city rule and **wins over** the deployment-file fallback, in the Admin Console and all complaint forms. A default postal-code row is created for new cities — but the two seed paths that create it currently disagree (one ships a 5-digit pattern, the other a 6-digit pattern); reconcile before relying on a single format across fresh installs. |
| Deployment-file fallback | `core_mobile_configs` and `core_postal_configs.postalCodePattern` are used only when the city record is absent. The old `postalCodeLength` / `postalCodeErrorMessage` settings are **gone** — the pattern is the single source, and the translated error message ("enter a valid N-digit postal code") is derived from it. |
| Existing cities | **Action required** — the old `UserValidation` record type is removed (migration guide Section 2.2); cities created before v2.12 must add the `FormValidations` rows themselves. |

### 9. Complaint Reopen Window

How long a citizen has to reopen a resolved complaint is now a real city setting (default 72 hours). Previously a hardcoded 1-hour limit applied no matter what was configured, and the server enforced its own separate deployment-wide limit — so the screen and the API could disagree about whether a complaint was still reopenable.

| | |
|---|---|
| Config | `RAINMAKER-PGR.UIConstants.REOPENSLA` (milliseconds; shipped default `259200000` = 72 hours) drives the reopen window in the citizen timeline and the employee/counter action bar alike. Edit per city in DIGIT Studio. Cities onboarded before this release keep their existing value. |
| Enforcement | The deadline is also enforced on the server from the same `REOPENSLA` master, based on the stored complaint (not what the request claims). Deployments must unset `time-before-closing-complaint`, which used to override it. |

### 10. Tamper-Evident Audit Trail — *always on*

Every create/update of a complaint and every workflow step is recorded in a dedicated, signed audit log — who changed what, and when.

| | |
|---|---|
| What | Complaint and workflow changes flow through the persister → audit-service into the `eg_audit_logs` table. |
| Config | Persister mappings carry `isAuditEnabled` + module (`CMS` / `Workflow`); the audit service reads the local persister configs (`EGOV_PERSIST_YML_REPO_PATH`) to decide what to audit, and binds `PERSISTER_AUDIT_KAFKA_TOPIC=audit-create`. Wired by default; no flag. |

### 11. Other Optional Add-Ons (deployment flags)

| Flag | What you get | Notes |
|---|---|---|
| `enable_search_stack` | Faster inbox search (Elasticsearch) | ~3 GB extra RAM |
| `enable_otp_services` | Real one-time passwords for login | Replaces the built-in test OTP entirely; set `STATIC_OTP` for test environments |
| `enable_digit_ui_v2` | The new citizen web app at `/citizen/` | |
| `enable_mcp` (+ `nginx_features.mcp`) | City-onboarding automation tools | Uses a ready-built image by default — works outside the internal network; `build_mcp: true` builds from source |
| `enable_turbopass` / `enable_overpass` | Address auto-complete / self-hosted boundary maps | |
| `enable_integration_tests[_runner]` | Test dashboards + a run button | |
| `docker_log_max_size` / `docker_log_total_size` | Caps on container log disk usage | Defaults 100 MB / 1 GB; deployments run outside Ansible get **no** log rotation |
| `dashboard_metrics_enabled` | Dashboard loading-speed telemetry | Default on; `false` stops the browser from *sending* this data, but does not remove the two `/otel/v1/*` gateway routes themselves |
| `pgr_pincode_allowlist`, `login_tenant_allowlist`, `employee_module_denylist` | Service-area and access lists | Leave `pgr_pincode_allowlist` unset (not `[]`) to accept any postal code |
| `RAINMAKER-PGR.MapConfig` (city data) | Per-city map style, centre, and zoom | Optional; sensible defaults apply without it |

---

## New City Data & Settings Summary (v2.12)

| Record / key | Module | Default provided? | What it controls |
|---|---|---|---|
| `ComplaintHierarchyDefinition`, `ComplaintHierarchy` | RAINMAKER-PGR | Yes (2-level tree) | Complaint categories (replaces `ServiceDefs`) |
| `NotificationRouting`, `NotificationTemplate`, `NotificationProviderTemplate` | RAINMAKER-PGR | Yes (demo WhatsApp template IDs — replace them!) | Citizen notifications |
| `EscalationConfig` | RAINMAKER-PGR | **No** — schema/design only; no live seed path today (design intent is 3 levels at 1h/4h/24h) | Automatic escalation timings |
| `MapConfig` | RAINMAKER-PGR | Schema only | Per-city map settings |
| `InboxVisibilityConfig` | RAINMAKER-PGR | Schema only | My/All inbox tabs |
| `ComplaintExtendedAttributeSchema`, `ComplaintRelatedToMap`, `ComplaintTemplateType` | RAINMAKER-PGR | **No** — schema only, no live seed path today | Confidential/extended complaint fields |
| `UIConstants.REOPENSLA` | RAINMAKER-PGR | Yes (72 hours) | Complaint reopen window (now actually applied, UI + server) |
| `MobileNumberValidation` | common-masters | Yes (`default: false` — mark one record true) | Phone-number rules per country (replaces `UserValidation`) |
| `FormValidations` | common-masters | Yes (default row, but see the 5-vs-6-digit seed-path caveat above) | Postal-code / name / email rules |
| `KpiDefinition`, `DashboardPack`, `DashboardConfig` | dss | Via `enable-dashboard.sh` | Supervisor Dashboard (and, once configured, the Public Dashboard) |
| A dashboard/analytics access-scope policy record | ACCESSCONTROL | Ships with the complaints service | Drives the row-level access-control (ABAC) engine — see Known Issues before relying on it for admin roles |
| `BusinessServiceMasterConfig` (+`PGR` row) | Workflow | Yes | Prerequisite for escalation & notification routing |
| `DecryptionABAC` (expanded — not `SecurityPolicy`, a different, unrelated master; see the Changelog's Security section below) | DataSecurity | **No** — defined for new installs' schema but not present in the actual seed data; a live tenant won't have these grants without adding them by hand | Who may see personal data (name, phone, address…) — review before applying to live cities |
| New role `CMS_SCREENING_OFFICER` | ACCESSCONTROL | **No** — same gap, no row in the actual seed data today | Screening Officer: reviews and routes incoming complaints |


## Technical Enhancements & Fixes

For the engineering team, beyond the headline features: per-service database-migration init containers close the Compose/Kubernetes parity gap; four new CI gates guard migration/dump alignment, gateway-whitelist parity, health-check coverage, and frontend lockfile drift; Postgres shared memory is sized from the connection-pool settings; container logs are capped and rotated; the browser-side master-data cache moved to IndexedDB so large cities don't overflow it; expired sessions now trigger a clean re-login instead of a hang; the dashboard gained a cohesive auth module with silent token refresh that coexists with the main UI session; notification-service logging was hardened against exposing personal data and its diagnostics endpoint put behind authentication; email bodies escape user-supplied values; and the integration-test suite became deployment-agnostic with capability-based gating.

Since the 2.12-beta draft: every service build now comes from one public source instead of a mix of internal and public locations, so deployments no longer depend on access to an internal network — builds remain limited to one processor architecture for most services, except the Configurator and citizen/employee UI, which are now produced for both common architectures by an automated build pipeline instead of on the deploy host. The observability stack (traces, metrics dashboards, logs) moved from starting unconditionally to three separate opt-in switches, so operators only pay for what they turn on. A new row-level access-control (ABAC) policy engine now governs dashboard, analytics, and search visibility, replacing a set of hardcoded role exemptions — see Known Issues for gaps found in an independent review before relying on it for admin roles. Web-analytics (Matomo) support has also landed, but so far only as a Kubernetes/Helm chart — it is not yet available on the primary Docker Compose deployment path.

## Bug Fixes (selection)

| # | Area | Fix |
|---|---|---|
| 1 | Employee inbox | Complaint counts no longer stop at the page size; page navigation, column sorting, and time-allowed (SLA) calculations fixed (#1058, #1014, #1212, #1144) |
| 2 | Complaint updates | The chosen department is no longer overwritten on update; masked confidential values no longer wipe real data (#1077, #1092) |
| 3 | Citizen search | Citizens can only see their own complaints in search (#1100) |
| 4 | Dashboard statistics | "Complaints created today" now means the calendar day, not the last 24 hours (#1462, #1483) |
| 5 | Dashboard statistics | Reporting views now follow the new complaint categories; resolution-time targets fixed for city-level complaints (#1494, #1081) |
| 6 | Supervisor Dashboard | Broken header search removed; saved layouts no longer rearrange on refresh; date-filter no longer blanks the page (#1474, #1013) |
| 7 | Admin Console | Complaint-type edits no longer silently discarded; complaint workflow read from the correct city (#521) |
| 8 | Admin Console | City boundaries are saved to the city itself, not the state root |
| 9 | HR data | Employee-update crash fixed (#1056); a start-up race condition removed |
| 10 | Login & security | Admin account gets the correct encryption key after first-time setup (#1042); expired sessions no longer hang the app (#1101) |
| 11 | Complaint reopen | The reopen deadline is enforced on the server and follows the configured window (#925) |
| 12 | Postal codes | One postal-code rule everywhere, with translated error messages; raw browser pop-ups removed (#722, #1315) |
| 13 | Admin Console | A bug that incorrectly blocked legitimate users from editing MDMS roles/actions in the Admin Console is fixed |
| 14 | City/tenant setup | A tenant-setup failure partway through a multi-page data fetch no longer silently drops the master-data rows already fetched |
| 15 | Admin Console | Creating a new complaint category now correctly stamps the metadata it needs (previously could produce a category invisible to the citizen/employee picker) |
| 16 | Search | PGR search stays fully backward-compatible for a tenant that never configured a dashboard access-scope policy, instead of silently defaulting to an overly restrictive scope |
| 17 | Security & bootstrap | New-city bootstrap admin credentials no longer come from a fixed, shared set of environment variables — each bootstrap now uses the deploying session's own credentials |
| 18 | Security & bootstrap | A missing administrator role in the seeded roles master was restored |
| 19 | Security & bootstrap | A stale, unauthenticated gateway route to a decommissioned endpoint was dropped from both the Kong and Kubernetes gateway whitelists |
| 20 | Dashboard statistics | Report time-groupings (day/week/month/hour) now use each city's own time zone instead of one hardcoded zone (found during migration validation) |
| 21 | Complaint reopen | The reopen window (`REOPENSLA`) can now actually be edited via the Admin Console/API — previously blocked by a technical defect where the value doubled as the record's own identifier, so an edit silently failed to save |
| 22 | Access control | Fixed a severe scope mismatch: an employee with a coarse jurisdiction assignment (e.g. County-level, common for new employees) previously saw **zero results in search** but **nearly the entire tenant on the dashboard**, because the two features resolved jurisdiction differently. Both now expand a jurisdiction to itself plus every area beneath it, consistently |
| 23 | Access control | The Grievance Routing Officer role (and the unconfigured-role default) no longer sees every department's complaints regardless of their own assigned department — tightened to their own department, matching other supervisor-level roles |
| 24 | Admin Console | The Dashboard sidebar entry, corrupted in the sample seed data for one tenant, is restored — affected any city bootstrapped from that sample |
| 25 | Login & security | The seeded local admin account is granted the account-administrator permission it needs now that city-bootstrap actions require it; a missing Supervisor role was added to the seed data |
| 26 | Employee profile | A backend authentication/type-handling bug in the new employee working-context switcher (see New Features) is fixed |
| 27 | Notifications | A WhatsApp integration/provider-selection bug fixed |
| 28 | Employee & UI | Profile image visibility fixed; duplicate options removed from a dropdown; employee date-of-birth/date-of-appointment made optional where they shouldn't have been required |

## Known Issues

Limitations to be aware of before adopting this release:

- **Kubernetes deployment is incomplete.** The supported deployment paths for v2.12 are Docker Compose and the Ansible-driven one-command install (Ubuntu / macOS / Windows via WSL2). The Helm/Kubernetes path is not yet a complete, supported deployment for this release.
- **Windows support is WSL2-only.** Native Windows and Red Hat Linux are not yet supported.
- **No automated ServiceDefs → ComplaintHierarchy migration for hand-converting a tenant.** The old `ServiceDefs` complaint-category master is removed; a validated migration *tool* now exists (see [servicedefs-to-complainthierarchy-migration.md](../migration/servicedefs-to-complainthierarchy-migration.md)) and is the recommended path, but there is still no automatic, zero-touch conversion — someone must run it per tenant.
- **The new row-level access control for dashboards/analytics needs care before enabling for admin roles.** An independent review found that tenant-wide admin/supervisor roles can lose unrestricted dashboard access and see it go empty, a cross-tenant config-refresh authorization gap, and a case where the "department scoping disabled" override doesn't actually apply. If your city relies on admin roles seeing the full dashboard, verify this specifically before rollout.
- **Migrating multiple cities that share common category codes can show one city's department on another's dashboard tiles**, because the reporting views resolve a category's department by comparing across the whole deployment rather than each city's own. See the migration tool's documentation for a query that checks your exposure.
- **A complaint whose category hasn't been migrated will fail to send notifications** on its next workflow action (assign/resolve/escalate), even though it still opens and displays fine.
- **The Department Grievance Routing Officer (DGRO) role gets the Dashboard sidebar link but not the underlying permission to use it.** DGRO's seeded role-actions include the nav-link action but none of the analytics capability actions, so a DGRO employee sees the Dashboard menu entry but every dashboard request is denied. Confirmed against the current seed data — grant DGRO the same capability actions as other supervisor-level roles if you need this role to actually use the dashboard.

Open items tracked against this release (milestone *Release 2.12 (Nosy Build)*), to be addressed in subsequent releases:

| Area | Issue |
|---|---|
| Notifications | Error while creating the workflow in Novu (#1517) |
| Notifications | Sync WhatsApp templates from Twilio fails for some messages (#1516) |
| Notifications | Configure Notifications: Delete and Recreate features not working as expected (#1501) |
| Notifications | Employees are not yet notified on complaint assignment across email, SMS and WhatsApp (#904) |
| Notifications | `TemplateBinding` needs an `audience` selector and `body` field (blocks SMS work) (#905) |
| Notifications | Notification setup documentation for implementation teams still to be published (#1032) |
| Supervisor Dashboard | Employee dashboard: unable to add KPIs (#1276) |
| Supervisor Dashboard | Portuguese localisation and language dropdown driven by DIGIT-configured languages (#1108, #1169) |
| Supervisor Dashboard | Group-by across complaint hierarchy levels (Category / Sub-Type / Leaf) (#1111) |
| Supervisor Dashboard | Production render-lag instrumentation and load-time benchmarks at 1K / 50K / 100K records (#1110, #1109) |
| Supervisor Dashboard | Data dictionary asset creation for the CMS dashboard (#1575) |
| Complaint lifecycle | Reopen complaint timeline: increase to 72 hours and make it configurable (#1252) |
| Complaint lifecycle | Complaints at Risk: complaint ID click redirects to a wrong URL path (#1249) |
| Complaint lifecycle | Validate complaint types against the tenant master, dropping the state-level fallback (#902) |
| Configuration | Resolve the department master per tenant with state-level fallback (#901) |
| Deployment / operations | Ansible deploy: fixes needed for fresh-box and repeat deploys (#1245) |
| Deployment / operations | Image ↔ DB-migration version skew: floating tags can reintroduce login failures (#1023) |
| Deployment / operations | Default alert thresholds for Grafana (#1538); observability dashboards for operations & maintenance (#541) |
| Deployment / operations | Citizen login on the Docker Compose setup (#453) |
| Deployment / operations | Developer environment setup within an hour (#191);
| Platform | Rate-limiter configuration (#1253) |
| Quality & security | Vulnerability testing (#1482); testing-suite improvements (#1047) |

## Changes That Need Attention Before Upgrading

These require action from the operations team on existing installations — full procedure in the [migration guide](migration-guide-v2.11-to-v2.12.md):

1. **Complaint categories replaced** — the old `ServiceDefs` list is removed; convert it to the new category tree (`ComplaintHierarchyDefinition` + `ComplaintHierarchy`) reusing the same codes, ideally using the validated migration tool rather than by hand (Section 2.1).
2. **Phone/form validation replaced** — the old `UserValidation` record is removed; create `MobileNumberValidation` (mark one record as default) and the new `FormValidations` rows, and update the User Service to its 2.12 build (Section 2.2).
3. **Notification defaults changed** — the default channel is now SMS, and WhatsApp must be explicitly re-enabled; several old settings were removed (Section 2.3).
4. **Boundary-service address default changed** to the in-cluster service name — set it explicitly if you relied on the old default (Section 2.4).
5. **New role and data-privacy rules need loading, on every city — not just existing ones.** As of this validation, the actual seed data used for a fresh local install doesn't include the Screening Officer role or the new personal-data visibility rules either — this isn't only an "existing city" gap, confirm your own seed pipeline actually loads them for any city, new or existing (Section 2.5).
6. **Dashboard shows nothing for employees without a department** — check department assignments in HR data before rollout (see the migration guide's post-upgrade verification notes).
7. **New always-on infrastructure** — download the telemetry agent before starting; budget for the monitoring stack; back up the secrets-store key file `/opt/digit/.openbao/init.json` (Section 3).
8. **Review the new row-level access control before enabling it for admin roles** — see Known Issues above; verify admin/supervisor dashboard access specifically before rollout.

## Document Resources & Links

| Document | Description |
|---|---|
| [Complaints Management roadmap](https://docs.digit.org/complaints-management/community/roadmap) | Product roadmap (docs.digit.org) |
| [Changelog](#changelog--keep-a-changelog) (below) | Full engineering changelog (Keep a Changelog format) |
| [release-config-changelog-v2.12.md](release-config-changelog-v2.12.md) | Configuration & infrastructure changelog (city data, service settings, DevOps) |
| [migration-guide-v2.11-to-v2.12.md](migration-guide-v2.11-to-v2.12.md) | Operator upgrade procedure v2.11 → v2.12 |
| [servicedefs-to-complainthierarchy-migration.md](../migration/servicedefs-to-complainthierarchy-migration.md) | Validated, current procedure for the complaint-category migration (Docker Compose + Kubernetes commands) |
| [validation-log-2026-08-24.md](../migration/validation-log-2026-08-24.md) | Real evidence from running that migration end-to-end |
| [WINDOWS-QUICKSTART.md](../../WINDOWS-QUICKSTART.md) | Validated Windows setup path (via WSL2) |
| [local-setup/docs/ONBOARDING-AND-ADDONS.md](../../local-setup/docs/ONBOARDING-AND-ADDONS.md) | City onboarding + add-ons catalogue (every optional flag) |
| [complaint-hierarchy-feature.md](../complaint-hierarchy-feature.md) | Multi-level complaint categories — design |
| [docs/dashboard/dashboard-configuration.md](../dashboard/dashboard-configuration.md) | Supervisor Dashboard configuration reference |
| [docs/notifications-guide](../notifications-guide) | Notifications setup guide |
| [docs/observability](../observability) | Monitoring stack + dashboard telemetry |
| [local-setup/ansible/runbooks/01-openbao.md](../../local-setup/ansible/runbooks/01-openbao.md) | Secrets store (OpenBao) operations runbook |
| [Test Cases - CMS 2.12-beta.xlsx](../2.12-beta/Test%20Cases%20-%20CMS%202.12-beta.xlsx) | QA test case sheet for this release (asset still lives under `docs/2.12-beta/`) |

---

## Changelog — Keep a Changelog

*Full feature-level changelog: Added / Changed / Fixed / Deprecated / Removed / Security.*

### [2.12] - 2026-08-03

> **Status:** Consolidates the `[2.12-beta]` draft entry (covering `v2.11` → `master` @ `81168120a`, 2026-08-03) with everything that landed afterward, plus a further sync after 2026-08-27 (`master` @ `3c3d9facc`, 208 more commits). Items below are grouped by category the same way as the original draft; items from the first delta pass are marked *(Landed after the beta cutoff)*, items from the second are marked *(Landed after the 2026-08-25 pass)*.

#### Added

**Complaint Hierarchy (N-Level)**
- Configurable N-level complaint classification hierarchy, replacing the prior fixed 2-level ServiceDefs model. Complaints can now be organized across any number of sub-categories and departments via the new `ComplaintHierarchy` MDMS schema.
- Complaint details pages now display the full hierarchy path (category → sub-category → type).
- *(Landed after the beta cutoff)* A validated, repeatable migration tool for converting a tenant's `ServiceDefs` rows to the new model, with a preflight check and a documented validation run against a live deployment.

**Dashboard & Analytics**
- New supervisor dashboard with live analytics: KPI cards, drag-and-drop widget inventory, and configurable layouts.
- Supervisor dashboard wired to the real analytics query API; global time-window filter and per-complaint-type SLA metrics available.
- New V2 analytics grains (materialized views) and a dynamic JSON→SQL query API for ad-hoc KPI reporting.
- Geography map redesigned; SLA toggle, bar/line charts, and channel donut chart added.
- Per-card last-updated timestamps; SLA status pill made read-only.
- Supervisor dashboard now embeds as an ACS-gated employee module rather than a standalone app (#1062); route/card access resolves from MDMS (`dss.DashboardConfig`) with a code fallback (#1258).
- KPIs can be grouped by complaint-hierarchy level, with a per-widget "Group by" control and a tree-traversal complaint-type filter for one-widget subtree navigation (#1282, #1283, #1285).
- Tenant-configurable number display format (#1272); server-side query duration/row metrics with trace-correlated slow-query logging, plus client-side render-lag instrumentation (#1267, #1268).
- Dashboard wired to the localization service, with a `pt_PT` locale pack and full i18n coverage for widget text, picker titles, header/date, and CSV export (#1135, #1214, #1159, #1161).
- Employee dashboard layout, filters, and chart chrome polished; Add-KPI attach and drag-and-drop placement made reliable (#1311, #1287).
- `enable-dashboard.sh` installer: turns the supervisor dashboard on against a running deployment — schemas, KPI catalog (39 defs + 1 pack), role grants, localization, verification (#631); dashboard catalog now bootstraps from the repo rather than a source tenant.
- Cohesive dashboard auth module with silent token refresh, non-destructive 401 contract, and no interference with the co-hosted digit-ui session (#1466); "Powered by DIGIT" footer (#1453).
- *(Landed after the beta cutoff)* **Public Dashboard** — a curated, no-login statistics view for citizens/the public, with its own gateway whitelist (deliberately excluding the schema-introspection endpoint), an Admin Console screen for choosing which KPIs are public (backed by `dss.DashboardConfig`), a real seeded default pack, and dedicated isolation tests proving a public caller can't escape the curated scope.
- *(Landed after the beta cutoff)* **Row-level access-control (ABAC) policy engine** for dashboard, analytics, and search visibility, replacing hardcoded role exemptions with a per-tenant seed policy (see Known Issues for gaps found in review).

**Configurator**
- Phase 2 supports dual path: one-click OSM boundary fetch alongside the existing Excel upload.
- Boundary maps added to the Management view.
- N-level complaint hierarchy management UI; `COMPLAINT_HIERARCHY` localization seeding introduced.
- "Use existing tenant" path added on Phase 1; polygon picker moved to the verify step.
- Server-side pagination implemented for MDMS list views.
- Self-hosted Overpass server for boundary fetching; configurable boundary search limit.
- Org Chart view added for HRMS reporting hierarchy (#872).
- All locales can now be edited side-by-side in the localization list (#1004).

**PGR / Complaints**
- Employees can now filter the inbox by assignee when searching service requests.
- Geo-location map field added to the employee create-complaint form.
- Employee complaint type dropdowns scoped to the user's own department(s).
- Per-complaint-type SLA shown in the employee inbox with server-side SLA sort and status filter.
- Multi-department assign introduced; department localization applied on assign action.
- Routed department stamped onto `additionalDetail` on assignment for downstream grouping.
- My/All complaint inbox visibility tabs shipped, initially without notification counts (#1052, #1269).
- Complaint schema extended with encryption and extended attributes (#983).
- `RAINMAKER-PGR.MapConfig` established as the single source of truth for map tooling and starting position (#1162).
- *(Landed after the 2026-08-25 pass)* A working-context switcher in the employee top bar, for employees holding more than one department/role, so they can see and switch which one they're currently acting as.

**Form & Mobile Number Validation**
- New `common-masters.FormValidations` MDMS master: one row per `fieldType` (`postalCode`, `name`, `email`) with a regex; MDMS-first over the host_vars/globalConfigs fallback across DIGIT Studio and all PGR create-complaint flows (CCSD-1989/1990). Default rows seeded by default-data-handler and `full-dump.sql` — the two seed paths currently disagree on 5 vs. 6 digits for the postal-code pattern; reconcile before relying on one consistent format across fresh installs.
- Postal-code validation consolidated onto a single shared validator with real-time feedback and dynamically derived, localized error messages (#722, #1315); reopen window driven from MDMS `RAINMAKER-PGR.UIConstants.REOPENSLA` (default 72 hours) and enforced server-side from the same master (#925, #1252).
- `common-masters.MobileNumberValidation` is now the single authoritative source across all surfaces (frontend, Configurator, MCP, employee profile, complaint forms).
- Mobile validation lengths derived entirely from the configured regex.
- Real-time mobile validation added to the create-complaint page with i18n error messages.
- Country-specific defaults supported across multiple regions.

**Authentication**
- `digit-ui-v2` SPA published with platform-admin login, dashboard, and bootstrap wizard.

**Notifications (Novu / WhatsApp)**
- Full Novu notification stack added behind a `notifications` Docker Compose profile.
- PGR complaint lifecycle events (create, assign, reassign, resolve, rate, escalate) wired to WhatsApp delivery via Twilio Content SIDs.
- OTP services enabled by default; `novu-bridge` endpoint added for channel-aware SMS and WhatsApp dispatch.
- Config-driven PGR notifications: MDMS-routed, multi-channel, self-service configuration for SMS/Email/WhatsApp (#1059).
- WhatsApp Content-SID template delivery pipeline, with a Twilio sync UI/CLI and runbook (#1284).
- Novu dashboard image rebased onto a subpath so it survives redeploys (#926).

**MCP Tools**
- `ComplaintHierarchy` and multi-department support added to all MCP tools.
- System-state snapshot and diff capability added to `digit-mcp`.
- `city_setup_from_xlsx` emits a GeoJSON sidecar for boundary polygons.

**Chatbot (WhatsApp / xstate)**
- xstate PGR chatbot flow aligned with `ComplaintHierarchy` for complaint-type/category labels.
- Multi-tenant support added for the sandbox WhatsApp chatbot.
- Complaint lifecycle REASSIGN and RATE events wired into the chatbot notification flow.

**Observability**
- Full observability stack added: JVM metrics, logs, and distributed traces via OpenTelemetry + Promtail. Grafana root URL exposed per tenant.
- node-exporter added for host-level metrics; Prometheus config reloaded automatically after deploy (#1335).
- Signed audit logging enabled for PGR complaint create/update and workflow transitions via the persister → audit-service → `eg_audit_logs` chain (audit-service now parses the local persister configs to decide what to audit).

**Deployment / Infrastructure**
- macOS deployment path added with Darwin-specific OpenBao re-unseal.
- `digit-configurator`, `digit-mcp`, and `digit-ui-esbuild` vendored into the CCRS monorepo.
- Per-service Flyway init containers close the DB-migration parity gap between Compose and K8s, extended to every schema-owning service (#1142, #1273); audit-service kept on k8s and added to compose (#1157).
- `hot-deploy.sh` script + guide added for fast local iteration on pgr-services, digit-ui-esbuild, and configurator without a full compose rebuild (#1112).
- Ansible CI hardened: `ansible-lint`/`yamllint` gates, idempotent teardown/re-run, and static-validation phases (#700, #709); CodeRabbit wired up to auto-review PRs targeting develop (#1054).
- Docker container log rotation via Ansible-managed daemon.json (`docker_log_max_size`/`docker_log_total_size`, default 100m/1g cap) (#1365 follow-up); Postgres `/dev/shm` sized from the pgbouncer pool (#1365).
- Novu browser-facing URLs overridable for split-vhost TLS setups via `novu_public_base_url` (+ per-URL escape hatches) (#1435).
- *(Landed after the beta cutoff)* Every service image re-pointed from a private preview registry to a single public registry — third-party and eGov-built images alike; currently limited to one processor architecture for most services.
- *(Landed after the beta cutoff)* Configurator and the citizen/employee UI now build as ready-made images for two processor architectures via a dedicated CI pipeline, instead of building from source on the deploy host at deploy time.
- *(Landed after the beta cutoff)* A validated Windows quickstart via WSL2, with two sizing profiles (with/without the notifications stack).
- *(Landed after the 2026-08-25 pass)* Web-analytics (Matomo) support, as a new Kubernetes/Helm chart — not yet available on the Docker Compose deployment path.

**Testing**
- Integration suite made deployment-agnostic; stale specs audited and repaired (#1145).
- One-time deployment-profile discovery (tenant data, personas, seed plan, capability details) persisted for reuse across the suite, with expectations manifests and capability-based gating so only relevant assertions run per environment (#1304).

#### Changed

**Localization / i18n**
- Configurator UI fully internationalized: list column headers, page titles, resource labels, and all UI chrome translated (en/hi/fr/pt).
- Complaint status display uses a centralized localization service with consistent prefix across all surfaces.
- Complaint-type labels use the `COMPLAINT_HIERARCHY` localization prefix uniformly.
- MDMS cache moved to IndexedDB to prevent `localStorage QuotaExceededError` on large datasets.

**PGR / Complaints**
- `additionalDetail` persisted correctly from DB reads; 600-character constraint removed.
- Inbox pagination enabled via `totalCountJsonPath`; inbox sort column headers made clickable.
- Assignment allowed for unmapped/NA-department complaint types.
- OSM map base theme for the citizen complaint map made configurable per tenant.
- `PGR_ESCALATION_ENABLED` surfaced in deploy env blocks so escalation can be toggled per deployment (#1072).
- Legacy `egov-location` callers migrated onto `boundary-service` (#1098).
- Employees can now create complaints for any department regardless of their own assignment.

**Configurator**
- Bulk-employee validation no longer false-negatives due to partial MDMS master fetch.
- Legacy (v1/v2) ThemeConfig records can now be shown and edited.
- Boundary picker restricted to LEAF boundary types only.

**Mobile Number Validation**
- Validation consistency and i18n error messaging aligned across Configurator and PGR (#1152).
- `INTERNAL_USER`/`ADMIN` seed mobile numbers now derive from each tenant's `mobileNumberRegex` instead of a fixed default (#1125); `egov-user` mobile-validation defaults rewritten per tenant (#1264).
- A non-compiling MDMS mobile regex now warns instead of silently failing (#1154).

**Dashboard**
- Analytics global date range applied consistently to all event-grain queries.
- Chart hover tooltips and cursor positioning unified across all viz types.
- Centralized viz style registry introduced; shared chart components extracted.
- Supervisor KPI tiles and deltas aligned with the CSV spec (cohort formulas, uniform % / pp / duration delta formatting); complaints-by-channel pie respects the global date filter instead of always showing a live snapshot (#963).
- Geography choropleth extended with Created/Open/Resolved layers, real ward-polygon boundaries, and click-to-zoom drill (replacing convex-hull clustering) (#963).
- *(Landed after the beta cutoff)* An older, pre-catalog PGR dashboard is now hidden by default (kept only as a rollback aid) in favour of this KPI-catalog-driven Supervisor Dashboard.
- *(Landed after the beta cutoff)* Report time-groupings (day/week/month/hour/day-of-week/weekend/business-hour) now resolve from each city's own configured time zone instead of one hardcoded zone.

**Deploy / Infrastructure**
- Compose/K8s dual-deploy parity gaps closed across charts and the test harness (#1292).
- Gatus health dashboard expanded: missing services added, Postgres unmasked, optional stacks gated (#1297); the k3s tier unbroken and four false-green holes closed in the coverage guard (#1303).
- `audit_service_schema` registered in the flyway-history-map, fixing `develop` CI (#1221).
- Default boundary seed data cleaned up: ward-level nodes added between zones and blocks, with corrected boundary codes and parent-child relationships (#1302).
- On-host `digit-ui` build fixed to work on Ubuntu (Node 20 + npm) (#1065); unused services (DSS, service-request, PDF) disabled and their dead config pruned (#1103).
- Core services updated to their 2.12 builds: User Service, Encryption Service, Workflow Service, and Localization Service all move to the 2.12 release build; HRMS moves to its own updated 2.12 build. The Boundary Service is intentionally kept on its previous build for now (a newer build breaks the deployed UI's search behaviour).
- egov-enc-service embedded Flyway disabled — its schema migrates through the central db-migrations flow, and enc waits for db-migrations before starting.
- *(Landed after the beta cutoff)* The observability stack (traces, metrics dashboards, logs) moved from starting unconditionally to three separate opt-in switches, so an operator turns on only what's needed.
- *(Landed after the beta cutoff)* The `default-data-handler` background helper was removed as a running service; its seed data is now read directly by a couple of setup scripts instead of served by a container.

**Authentication / Profile**
- Citizen sidebar avatar refreshed after Edit Profile save.
- Profile photo `fileStoreId` resolved before avatar render with fallback for thumbnails.

**Tests**
- All Playwright/e2e specs parameterized via env helpers (no hardcoded tenant IDs).
- Lifecycle setup seeds two PGR complaints; downstream specs consume shared fixtures.
- `ServiceRequestValidatorTest` (10 tests) added for boundary and MDMS validation scenarios.

#### Fixed

**PGR / Complaints**
- Location dropdown now appears correctly on the employee create-complaint form.
- Citizen location toast auto-dismissed; close button added.
- Complaint Type/Sub-Type dropdowns no longer blank out on employee complaint create.
- Department-undefined guard applied to `AssigneeComponent` to prevent crashes.
- All role-filtered employees shown in assignee dropdown when department is undefined.
- Boundary dropdown options deduplicated by code in the PGR citizen form.
- ESCALATE action added to `ACTION_CONFIGS` so the Escalate modal opens correctly.
- Ward `isLeaf` flag set correctly so boundary cascade enforcement fires on submit.
- Assignee name now resolved from `lastModifiedBy` via user search API.
- Full address now shown on the complaint detail page; type pickers made sortable/searchable (#974).
- Citizen complaint search scoped to the citizen's own records (#1100).
- Assignee made optional in the Assign Complaint modal (#1048).
- Client-provided department no longer overwritten on service update (#1077); masked confidential-field placeholders no longer overwrite real data on update (#1092).
- Duplicate inbox hook fixed (#1122).
- Employee inbox: total count no longer caps at page size, pagination completed, column-header sort actually works, and SLA computation/status filter made resilient (#1058, #1014, #1212, #1144).
- Batch of Moz-QA product-bucket fixes: address dropping the tenant/city token, text input field sizing, header logo `object-fit`, inbox date-range control sizing, strict profile-email validation, and more (CCSD-1980–1993) (#1179).
- Reverse-geocode feedback loop broken in the complaint map; map pins resolved at the configured boundary level; citizen boundary cascade scoped to the filing tenant.
- Complaint labels resolve from `COMPLAINT_HIERARCHY` localization with a raw-service-code fallback when unseeded, including on the legacy notification path.
- *(Landed after the beta cutoff)* Creating a new complaint category via the Admin Console now correctly stamps the `hierarchyType`/`levelCode` metadata it needs (previously could produce a category invisible to the picker).
- *(Landed after the beta cutoff)* PGR search now stays fully backward-compatible for a tenant that never authored a dashboard access-scope configuration, instead of silently defaulting to an overly restrictive scope.

**Configurator**
- Phase 2 boundaries written at the city tenant, not the state root.
- Boundary multi-hierarchy fetch retrieves all hierarchy types, not just ADMIN.
- Employee mobile rule now sourced from MDMS, dropping the erroneous 10-digit HRMS clamp.
- Mobile numbers with an optional trunk-zero prefix accepted in the fallback validator.
- Dept/designation localizations written to `rainmaker-common` instead of incorrect module.
- Phase-1 branding card overflow fixed; Phase-4 default jurisdiction hierarchy defaults to ADMIN.
- Re-login prompt on an expired session during boundary create now clears correctly (#984).
- Stale form data no longer nulls `reActivateEmployee` (#1141).
- Encryption-service key now minted for wizard-created tenants and on the duplicate-tenant path — new tenants no longer end up without an encryption key.
- Complaint edits no longer silently discard themselves; list filters honored; Department filter added to the complaint-types list; a complaint's PGR workflow is read from its city tenant (#521).
- *(Landed after the beta cutoff)* Truncated/duplicated access-control seed rows that incorrectly blocked legitimate users from editing MDMS roles/actions are fixed.

**Core / UI**
- Button styling resolves correctly: design tokens loaded before Tailwind in digit-ui-v2.
- JPEG extension/MIME normalized on profile image upload.
- `.jsx` files now resolved and transpiled in the production webpack build.
- Login error shown as readable toast instead of raw localization key.
- Toast auto-dismiss and close button unified into one env-configurable timer (#993).
- Ward names localized on the citizen OSM map (#1002).
- Uploaded profile photo now shows in the employee topbar and citizen desktop sidebar (#1006).
- Hardcoded city-specific ward sidecar data removed from the complaint map.
- Deployment-agnostic fixes surfaced by running the full suite against a different-locale deployment: tenant de-hardcoding, onboarding logoId, boundary-leaf handling, citizen pages, data-provider (#1143).

**Dashboard**
- Bar chart x-axis labels hidden when cramped; yellow in-progress SLA pill hidden.
- Bar view chart size measured correctly when mounted after toggle.
- Saved dashboard layouts no longer reflow on page refresh; legacy storage keys migrated.
- Date-filter change no longer blanks the dashboard when `filterOptions` is null (#1013).
- V2 analytics grains and the daily-snapshot refresh scheduler fixed (#1005).
- Dashboard catalog kept in sync with on-disk runs (#1046); consolidated SLA/hierarchy-grain bug fixes plus configuration docs (#1081).
- *(Landed after the 2026-08-25 pass)* A severe scope mismatch between search and the dashboard is fixed: an employee with a coarse jurisdiction assignment (e.g. County-level) previously saw zero results in search but nearly the entire tenant on the dashboard, because the two features resolved "jurisdiction" differently (exact-match vs. full ancestor path). Both now expand a jurisdiction to itself plus everything beneath it, consistently.
- *(Landed after the 2026-08-25 pass)* The Grievance Routing Officer role (and the unconfigured-role default) no longer sees every department's complaints regardless of their own assigned department on the dashboard — tightened to their own department.
- *(Landed after the 2026-08-25 pass)* The Dashboard sidebar entry, corrupted in the sample seed data for one tenant, is restored — affected any city bootstrapped from that sample. This is a different bug from the DGRO capability-grant gap now called out separately in Known Issues.
- *(Landed after the 2026-08-25 pass)* Public Dashboard filter-bar visual-parity fixes (fonts, dropdown control types).

**Auth / Identity**
- ADMIN user re-provisioned with the correct encryption key post-bootstrap (#1042).
- HRMS always sets `reActivateEmployee`, avoiding a `NullPointerException` on `_update` (#1056).
- `egov-user-event` service-host namespace corrected (`.staging` → `.egov`) (#1099).
- Real-OTP enablement path on compose repaired; local-setup now defaults to OTP mock with documented steps to enable real OTP (#1102, #1060).
- *(Landed after the beta cutoff)* New-city bootstrap admin credentials no longer come from a fixed, shared set of environment variables — each bootstrap now uses the deploying session's own credentials.
- *(Landed after the beta cutoff)* A missing `PGR_ADMIN` role in the seeded roles master was restored.
- *(Landed after the beta cutoff)* A stale, unauthenticated gateway route to a decommissioned endpoint was dropped from both the Kong and Kubernetes gateway whitelists.
- *(Landed after the 2026-08-25 pass)* The complaint reopen window (`REOPENSLA`) can now actually be edited via the Admin Console/API — previously blocked by a technical defect where the value doubled as the record's own identifier, so an edit silently failed to save.
- *(Landed after the 2026-08-25 pass)* The seeded local admin account is granted the account-administrator permission it needs, now that city-bootstrap actions require it; a missing Supervisor role was added to the seed data.
- *(Landed after the 2026-08-25 pass)* A backend authentication/type-handling bug in the new employee working-context switcher (see Added) is fixed.
- *(Landed after the 2026-08-25 pass)* Profile image visibility fixed; a duplicate-options bug in a dropdown fixed; employee date-of-birth/date-of-appointment made optional where they shouldn't have been required.

**Notifications**
- `novu-bridge` no longer persists a dispatch-log row on a missing-`subscriberId` rejection (#1137).
- Novu dashboard `/env/` deep links now route to the dashboard SPA instead of 404ing (#1120).
- *(Landed after the 2026-08-25 pass)* A WhatsApp integration/provider-selection bug fixed.

**Deploy / Infrastructure**
- HRMS post-bootstrap restart removed to eliminate HRMS bootstrap race condition.
- A hardcoded regional pincode allowlist is no longer seeded onto new tenants outside that region.
- Dataloader correctly creates city-level PGR workflow when only the parent tenant exists.
- `INTERNAL_USER` seeded on state root so HRMS survives non-pg tenants.
- default-data-handler references PGR workflow states by name instead of per-tenant UUIDs; `boundary.additionaldetails` seeded as `'{}'` rather than NULL.
- Tilt onboarding path repaired; `digit-ui` build no longer floats to a stale image (#1288).
- Mobile-number validation schema updated and the DB dump cleaned up to match (#1022).
- *(Landed after the beta cutoff)* The sample database dump used for fresh local installs no longer ships the removed `ServiceDefs` category data (found during migration validation; a leftover schema definition and its sample rows have been dropped).

**Chatbot**
- Correct tenant ID used for complaint tracking in sandbox mode.
- User `mobileNumber` preserved in session state to fix Twilio messaging.
- Complaint tracking flow and location resolution fixed.

**Analytics**
- Global date range applied to events grain via `complaint_created_at`.
- `account_id` made groupable on facts for top-complainants query.
- Grain materialized views repointed from the removed `ServiceDefs` master to `ComplaintHierarchy` (#1494).
- "Complaints created today" pinned to the calendar day instead of a rolling 24-hour window (#1462, #1483).

#### Deprecated

- The legacy `egov-localization` SMS-message keys of the form `PGR_<ROLE>_<ACTION>_<STATUS>_SMS_MESSAGE` are superseded by the new MDMS-driven `RAINMAKER-PGR.NotificationTemplate` / `.NotificationRouting` masters once a tenant sets `pgr.notification.config.driven=true`. The old keys are left in place and still work — nothing breaks for tenants that haven't opted in — but new deployments should adopt the config-driven path; the legacy keys are expected to be removed in a future release once all tenants have migrated.

#### Removed

- **`RAINMAKER-PGR.ServiceDefs`** (MDMS master) — replaced by the new `ComplaintHierarchyDefinition` + `ComplaintHierarchy` masters. See [migration-guide-v2.11-to-v2.12.md](migration-guide-v2.11-to-v2.12.md) Section 2.1 for the required manual migration for existing tenants.
- **`common-masters.UserValidation`** (MDMS master) — replaced by `common-masters.MobileNumberValidation`, a differently-shaped record keyed by `countryCode` rather than `fieldType`. The shipped default record ships with `default: false`, so **every** tenant must set `default: true` on one record before enabling notifications. See [migration-guide-v2.11-to-v2.12.md](migration-guide-v2.11-to-v2.12.md) Section 2.2.
- Static `mobileNumberLength` field removed — validation length is now derived entirely from the configured `mobileNumberRegex`.
- `core_postal_configs.postalCodeLength` and `.postalCodeErrorMessage` (host_vars) removed — `postalCodePattern` is the single knob; the localized error message is derived from the pattern (CCRS#722).
- `novu-bridge`: removed properties `novu.bridge.max.retries` and the `novu.bridge.config.host`/`.resolve.path`/`.search.path` trio (routing moved to MDMS-driven config in pgr-services); removed classes `UserServiceClient`, `ResolvedProviderResponse`, `ResolvedTemplateResponse`.
- Dead `/egov-rainmaker` nginx passthrough and its feature flag removed (#958).
- *(Landed after the beta cutoff)* Two deployment settings that never had any effect (`build_novu_bridge`, `build_pgr_services`) were dropped from the example deployment file rather than left as knobs that quietly did nothing.

#### Security

- **New `CMS_SCREENING_OFFICER` role** added, with corresponding role-actions, to screen complaints and route them to the correct department.
- **Gateway RBAC phase 3**: complaint-facing routes now resolve against one whitelist with a parity CI check ensuring Kong's and the K8s gateway's whitelists stay identical (#1128).
- **`DataSecurity.DecryptionABAC` expanded** *(corrected — earlier drafts of this document, inherited from the beta, misnamed this master as `DataSecurity.SecurityPolicy`, which is a different, pattern/masking-based schema with no role-keyed grants)*: new PII-visibility grants (`PLAIN`, first+second level) added for roles `EMPLOYEE, GRO, PGR_LME, DGRO, CSR, SUPERUSER, PGR_VIEWER, MDMS_ADMIN` on fields including `name, mobileNumber, emailId, pan, aadhaarNumber, correspondenceAddress, permanentAddress`. Existing tenants should review these new PII-visibility defaults before they take effect — see the config changelog for re-seeding notes. As of this validation, these grants also have no row in the actual seed data (`full-dump.sql`) for a fresh local install — confirm your own seed pipeline actually loads them before assuming any tenant, new or existing, has them.
- **`novu-bridge` logging hardened against PII exposure**: DEBUG-by-default logging (which could leak message content) replaced by `NOVU_BRIDGE_LOG_LEVEL` (default INFO); a new `PiiMask` utility masks `providerResponse` in the `/logs` endpoint.
- Kong now emits `InvalidAccessTokenException` on an expired session so digit-ui re-logs in instead of hanging on a stale token (#1101); empty JSON arrays are now preserved through the auth-enrichment pre-function instead of being silently dropped (#1038).
- **Signed audit logging** enabled for PGR complaint writes and workflow transitions (persister → audit-service → `eg_audit_logs`).
- `novu-bridge` `/dispatch` diagnostics gated behind `ProxyAuthFilter`; EMAIL notification bodies HTML-escape user-supplied values.
- *(Landed after the beta cutoff)* **Row-level access-control (ABAC) policy engine** introduced for dashboard/analytics/search — see Known Issues above for gaps an independent review found for admin-level roles; these are flagged for follow-up and not yet resolved as of this document.
