# Changelog

**Covers:** v2.11 → v2.12 (the 2.12-beta build was a milestone along this path, not a separate scope — everything from v2.11 onward is covered here). **Who this is for:** developers and operators upgrading or deploying this version.

This lists every config key, master data change, and infra change in this release, so you know what to update before deploying.

**See also:** [Release Notes](release-notes-v2.12.md) for the feature-level summary. This page is just the technical details.

***

### 1. Master Data Changes (MDMS)

#### Complaint Categories

⚠️ **Breaking change:** `RAINMAKER-PGR.ServiceDefs` is removed and replaced by `RAINMAKER-PGR.ComplaintHierarchyDefinition` + `RAINMAKER-PGR.ComplaintHierarchy`.

* **What changed:** the old master was a flat list (name, keywords, department, slaHours, serviceCode, menuPath). The new model is a two-part tree: `ComplaintHierarchyDefinition` declares the levels (e.g. Category → Sub-Type), and `ComplaintHierarchy` is the adjacency-list data itself. A leaf's `code` **is** the old `serviceCode`, kept verbatim, so already-filed complaints stay valid.
* **Default data shipped:** new installs get a 2-level tree (Category → Sub-type) automatically.
* **What you need to do:** existing tenants must convert their `ServiceDefs` rows by hand or with the validated migration tool — see the [Migration Guide](migration-guide-v2.11-to-v2.12.md).

> 💡 **Watch out for:** two gaps found during real-world validation, not previously documented anywhere — (1) a complaint whose category hasn't been migrated yet will fail to send notifications on its next workflow action, even though it still opens and displays fine (create/read paths degrade gracefully; notification dispatch does not); (2) the analytics reporting views resolve a category's department by a global, cross-tenant dedup on category code rather than scoping to the complaint's own tenant — two cities sharing a common default category code with different departments will have one silently show the other's department on its dashboard tiles. See [servicedefs-to-complainthierarchy-migration.md](../migration/servicedefs-to-complainthierarchy-migration.md) §4.2–4.3 for exposure-check queries.

#### Access Control / RBAC

* `RAINMAKER-PGR.EscalationConfig` *(new)* — per-tenant auto-escalation timing (`maxDepth`, per-level SLA, optional per-category overrides). Design default: 3 levels at 1h/4h/24h; no record at all falls back to 5 days.
* `RAINMAKER-PGR.MapConfig`, `.InboxVisibilityConfig` *(new, schema only)* — per-tenant map settings and the "My/All" inbox visibility flag. No default data; safe by default if absent.
* `RAINMAKER-PGR.ComplaintExtendedAttributeSchema`, `.ComplaintRelatedToMap`, `.ComplaintTemplateType` *(new)* — confidential/extended complaint fields.
* New role `CMS_SCREENING_OFFICER` *(new)* — screens complaints and routes them to the right department.
* `DataSecurity.DecryptionABAC` *(changed)* — new PII-visibility grants for `EMPLOYEE, GRO, PGR_LME, DGRO, CSR, SUPERUSER, PGR_VIEWER, MDMS_ADMIN` on fields including name, mobile number, email, PAN, Aadhaar, addresses. (Not `DataSecurity.SecurityPolicy` — that's a separate, pattern/masking-based master with no role-keyed grants; the earlier beta docs named the wrong master here.)
* A dashboard access-scope policy record (action `2008` and its role-scopes) *(new)* — drives the new row-level access-control (ABAC) engine for dashboard/analytics/search.

> 💡 **Watch out for:** default-data-handler is no longer run as a compose/Kubernetes service — it's only referenced today as static file paths that a couple of notification scripts read directly, not a seeder that runs on deploy. Its schema-creation list also doesn't include `EscalationConfig`, `InboxVisibilityConfig`, `ComplaintExtendedAttributeSchema`, `ComplaintRelatedToMap`, or `ComplaintTemplateType` at all (they exist only under an unused `mdmsData-dev/` profile), and none of them — nor the `CMS_SCREENING_OFFICER` role — have any rows in `full-dump.sql`, the actual seed for a fresh local install. **In practice, none of these ship with real default data to a tenant today**, despite existing as schemas/design: `EscalationConfig`'s "3 levels at 1h/4h/24h" default is design intent, not something a fresh tenant actually receives (the scheduler falls back to its hardcoded 5-day default when the MDMS record is absent, silently). The new role and the `DecryptionABAC` PII grants above have the same gap. Confirm what your own seed pipeline actually loads before assuming any of this is live for a given tenant, new or existing.
>
> An independent review of the new access-control policy engine found real gaps for admin-level roles: tenant-wide admin/supervisor roles can lose unrestricted dashboard access and see it go empty; a cross-tenant authorization gap lets one tenant's role refresh another tenant's dashboard config cache; the "department scoping disabled" override can be silently skipped; a fresh/source-less tenant bootstrap can seed zero row-scope policy with only a buried log line to show it; and the policy is duplicated (Java + a TypeScript seed) with no parity test between them. Verify directly for any admin/supervisor role your city relies on before enabling. *(Separately, two other bugs in this same area were fixed after 2026-08-25 — a search/dashboard jurisdiction-scope mismatch, and Grievance Routing Officers seeing every department instead of their own — but the admin-role gaps listed above are not among them and remain open.)*
>
> **Also confirmed against current seed data:** the DGRO role's seeded role-actions include the Dashboard nav-link action but none of the analytics capability actions — a DGRO employee sees the Dashboard menu entry, but every dashboard request it makes is denied. Grant DGRO the same capability actions as other supervisor-level roles if this role needs to actually use the dashboard.

#### Notifications

* `RAINMAKER-PGR.NotificationRouting` / `.NotificationTemplate` / `.NotificationProviderTemplate` *(new)* — config-driven notification routing/templates, replacing hardcoded SMS localization keys. Takes over once `pgr.notification.config.driven=true`.
* `common-masters.MobileNumberValidation` *(changed)* — replaces `common-masters.UserValidation`; reshaped to `{ countryCode, mobileNumberRegex, default }`, keyed on `countryCode`. Shipped record ships with `default: false`.
* `common-masters.FormValidations` *(new)* — postal code / name / email patterns, one row per `fieldType`. Outranks the deployment-file fallback.
* `RAINMAKER-PGR.UIConstants.REOPENSLA` *(new)* — the complaint reopen window in milliseconds. New-tenant default `259200000` (72 hours); existing tenants keep whatever value they already had.

> 💡 **Watch out for (fixed after 2026-08-25):** the `UIConstants` master originally shipped keyed on the `REOPENSLA` value itself (`x-unique: ["REOPENSLA"]`) — meaning the value doubled as the record's own identifier, so mdms-v2 refused any attempt to change it (`400 UNIQUE_KEY_UPDATE_ERR`). The reopen window was effectively frozen at whatever value a tenant was first seeded with. A later migration (`V20260827000000__uiconstants_recode_from_reopensla_key.sql`) re-keys every existing record onto a stable `code: "DEFAULT"` field instead, demoting `REOPENSLA` to an ordinary property — this is now editable via the Admin Console/API. The same historical defect existed on `RAINMAKER-PGR.MapConfig` and was fixed the same way, earlier (`V20260715000000__mapconfig_recode_from_colour_key.sql`).

> 💡 **Watch out for:** the shipped `MobileNumberValidation` record has no record marked `default: true` — you must mark exactly one, or the app silently falls back to a generic pattern with no error shown.

***

### 2. Config & Settings Changes

#### New config keys

| Key | What it controls | Default |
|---|---|---|
| `pgr.notification.config.driven` | Turns on MDMS-driven notification routing | `false` |
| `pgr.escalation.enabled` / `.interval.ms` / `.batch.size` / `.default.sla.ms` / `.max.depth` | Automatic escalation scheduler | `pgr.escalation.enabled=true` |
| `pgr.escalation.kafka.topic` | Escalation event topic | `pgr-escalation-events` |
| `pgr.dashboard.refresh.enabled` / `.interval.ms` | Dashboard reporting-table refresh | `true` |
| `pgr.analytics.config-cache-ttl-ms` | Analytics config cache lifetime | `300000` |
| `pgr.visibility.enabled` (env `PGR_VISIBILITY_ENABLED`) | "My/All" inbox visibility tabs | `false` |
| `egov.enc.host` / `.encrypt.endpoint` / `.decrypt.endpoint` | Encryption Service integration (mandatory) | `http://egov-enc-service:1234` |
| `dashboard_metrics_enabled` (Ansible) / `DASHBOARD_METRICS_ENABLED` (globalConfigs) | Dashboard client-side loading-speed telemetry | `true` |
| `novu.bridge.integration.id.whatsapp` (env `NOVU_BRIDGE_INTEGRATION_ID_WHATSAPP`, ansible `novu_bridge_integration_id_whatsapp`) *(landed after 2026-08-25)* | Which Novu provider integration a WhatsApp dispatch actually uses. Without it, WhatsApp — modeled in Novu as an "sms"-channel step — silently resolves to the primary (non-WhatsApp) SMS integration and Twilio rejects it | blank — must be set to your WhatsApp integration's ID (e.g. `twilio-whatsapp`) before WhatsApp delivery works |
| `pgr.employee.context.resolver-role-codes` / `.citizen-role-codes` / `.admin-role-codes` (env `PGR_EMPLOYEE_CONTEXT_*`) *(landed after 2026-08-25)* | Which roles the new employee working-context switcher treats as resolver / citizen-facing / admin | `PGR_LME,GRO,DGRO` / `CITIZEN` / `PGR_ADMIN,SUPERUSER,MDMS_ADMIN,HRMS_ADMIN,STADMIN,SUPERVISOR,PGR_SUPERVISOR` |

#### Changed defaults

⚠️ These changed behaviour — check if you rely on the old default.

| Key | Old default | New default |
|---|---|---|
| `novu.bridge.channel` | `WHATSAPP` | `SMS` |
| `novu.bridge.channels.enabled` | (not present) | `SMS,EMAIL` — WhatsApp now needs explicit opt-in |
| `egov.boundary.host` | `http://localhost:8081` | `http://boundary-service.egov:8080/` |
| `core_postal_configs` (host_vars) | had `postalCodeLength` / `postalCodeErrorMessage` | those two keys removed — `postalCodePattern` is the only knob |

#### Removed keys

* `novu.bridge.max.retries` — no longer used; retries are handled elsewhere.
* `novu.bridge.config.host` / `.resolve.path` / `.search.path` — routing moved to MDMS-driven config in pgr-services.
* `core_postal_configs.postalCodeLength` / `.postalCodeErrorMessage` (host_vars) — replaced by `postalCodePattern` alone; the translated error message is now derived from the pattern.
* `time-before-closing-complaint` — superseded by `RAINMAKER-PGR.UIConstants.REOPENSLA`; remove it from your deployment values or the screen and the server can disagree about whether a complaint is reopenable.

***

### 3. Database Migrations

| Migration file | Service | What it does |
|---|---|---|
| `V20260422000000__create_dashboard_mvs.sql` | pgr-services | Creates dashboard KPI reporting tables |
| `V20260608000000__create_v2_grain_mvs.sql` | pgr-services | Creates the newer, more detailed reporting tables |
| `V20260609000000__add_assignment_routing_flags_to_facts.sql` | pgr-services | Adds assignment/reassignment tracking |
| `V20260621000000__add_extended_attributes.sql` | pgr-services | Adds storage for extended/confidential complaint fields |
| `V20260623120000__open_complaint_age_buckets.sql` | pgr-services | Fixes how complaint "age" is grouped in reports |
| `V20260629000000__grain_scope_columns.sql` | pgr-services | Adds department/account scope columns to reporting tables |
| `V20260708000000__sla_and_hierarchy_grains.sql` | pgr-services | Fixes a missing resolution-time-target bug; adds category-tree reporting |
| `V20260715000000__create_hrms_projection.sql` | pgr-services | Creates a local copy of the staff reporting hierarchy (for inbox visibility) |
| `V20260716000000__hier_path_null_on_dotted_node_codes.sql` | pgr-services | Data-cleanup fix for legacy category codes |
| `V20260717000000__hier_path_null_on_dotted_parent_codes.sql` | pgr-services | Same class of fix, parent-code side |
| `V20260731000000__repoint_grain_mvs_to_complainthierarchy.sql` | pgr-services | Repoints reporting views from the removed `ServiceDefs` to `ComplaintHierarchy` |
| `V20260810000000__tenant_business_calendar_grains.sql` | pgr-services | *(found during validation, previously undocumented)* Fixes report time-groupings to use each city's own time zone instead of one hardcoded zone; supersedes the shape of the migration above for the same two tables |
| `V20260701000000__extend_dispatch_unique_key.sql` | novu-bridge | Widens a duplicate-message check; adds a `transaction_id` column |
| `V20260505000000__chat.sql` | xstate-chatbot | New database for the WhatsApp chatbot |
| `V20260715000000__mapconfig_recode_from_colour_key.sql` | egov-mdms-service | Re-keys `RAINMAKER-PGR.MapConfig` off a colour-derived unique key onto a stable `code` field — same defect and same fix pattern later applied to `UIConstants`/`REOPENSLA` below |
| `V20260827000000__uiconstants_recode_from_reopensla_key.sql` | egov-mdms-service | *(landed after 2026-08-25)* Re-keys `RAINMAKER-PGR.UIConstants` onto a stable `code` field so `REOPENSLA` becomes editable (previously the value doubled as the record's identifier, blocking any update) |

These must run in order — several rebuild the same reporting tables from scratch, and later ones assume the earlier shape exists. The novu-bridge migration is flagged out-of-order and requires `spring.flyway.out-of-order=true` (already set by default).

***

### 4. New Services & Endpoints

#### New services

| Service | What it does | How it's turned on |
|---|---|---|
| Notifications stack (Novu: bridge, bridge-endpoint, dashboard) | Sends/tracks SMS, WhatsApp, Email | `enable_novu` |
| OTP service (otp-publisher) | Real one-time passwords for login | `enable_otp_services` |
| WhatsApp chatbot (xstate-chatbot) | Citizens file/track complaints on WhatsApp | Kubernetes only (pilot) |
| Location search (turbopass) | Address/place auto-complete for boundary setup | `enable_turbopass` (off by default) |
| Audit service | Tamper-evident complaint/workflow log | Always on |
| Access-control policy engine (ABAC) | Row-level scoping for dashboard/analytics/search | Ships with the complaints service; policy is per-tenant seed data |
| Public Dashboard | Curated, no-login statistics view | City admin turns it on/off (and gets its shareable URL) via a single toggle; which KPIs are exposed is fixed by the shipped `public-default` KPI pack (MDMS seed data), not a per-KPI admin choice today |

#### New API endpoints

* `POST /v2/request/inbox/_search`, `POST /v2/request/inbox/_count` — visibility-scoped inbox search. Turned on by `pgr.visibility.enabled`.
* `GET /v2/dashboard` — dashboard endpoint backed by the new reporting tables.
* `POST /v2/analytics/_access` — the ABAC bootstrap call every dashboard/analytics screen makes first, to learn what the caller is allowed to see.
* `POST /v2/analytics/_query`, `/_schema`, `/packs`, `/catalog/_search` — token-required reporting/analytics API surface, subject to jurisdiction/department scoping.
* `POST /v2/analytics/config/_refresh` — busts a tenant's cached dashboard config. **This is the endpoint behind the cross-tenant authorization gap in Known Issues** — it doesn't check that the tenant you're refreshing is your own.
* `POST /v2/analytics/public/_query`, `/public/packs`, `/public/catalog/_search`, `/public/_options` — the Public Dashboard's own, unauthenticated API surface (deliberately excludes `/public/_schema`, which doesn't exist, to avoid exposing column/data structure).

***

### 5. Deployment Changes

#### New feature flags (off by default)

| Flag | What it enables |
|---|---|
| `enable_novu` | Notifications stack |
| `enable_otp_services` | Real OTP delivery |
| `enable_turbopass` / `enable_overpass` | Address auto-complete / self-hosted boundary maps |
| `enable_search_stack` | Faster, Elasticsearch-backed inbox (~3GB extra RAM) |
| `enable_digit_ui_v2` | The newer citizen web app, at `/citizen/` |
| `enable_mcp` (+ `nginx_features.mcp`) | City-onboarding automation tools |
| `pgr_notification_config_driven` | Config-driven PGR notifications |
| `pgr.visibility.enabled` (env `PGR_VISIBILITY_ENABLED`) | "My/All" inbox visibility tabs |
| `dashboard_metrics_enabled: false` | Turns **off** dashboard client-side loading-speed telemetry (on by default) |

#### Always-on additions

⚠️ These run on every deployment now, whether you use them or not — plan for the extra resources (RAM/CPU/disk/ports).

* Metrics-collection agent (OpenTelemetry Java agent) — must be downloaded once before first startup, or affected services fail to start.
* Secrets storage system (OpenBao) — sets itself up and unlocks automatically; back up `/opt/digit/.openbao/init.json`.
* Audit service, db-migrations, hrms-prereq-gate, user-seed — no on/off switch.
* Encryption Service dependency — the complaints service calls it on every request touching personal data; must be running and reachable.
* Dashboard loading-speed reporting — two new public-facing addresses, `/otel/v1/metrics` and `/otel/v1/logs`.

The fuller observability stack (Tempo/Grafana/Prometheus/Loki/Promtail) is **not** in this always-on category — it moved from always-on to three separate opt-in Compose profiles (`obs-traces`/`obs-metrics`/`obs-logs`). Turn on what you actually need.

Also changed: all container images now pull from one public registry (`egovio`) instead of a mix of internal/public sources — currently amd64-only, except Configurator and the citizen/employee UI, which are now built as multi-architecture (amd64+arm64) images by CI. `default-data-handler` was removed as a running compose/Kubernetes service — its seed data is now read directly by a couple of scripts instead of served by a container.

#### Kubernetes / Helm

Not a complete, validated deployment path for this release. Docker Compose and the Ansible one-command install (Ubuntu / macOS / WSL2) remain the supported paths.

#### Other fixes worth knowing about

* A missing `PGR_ADMIN` role in the seeded roles master was restored.
* New-city bootstrap admin credentials no longer come from a fixed, shared set of environment variables — each bootstrap now uses the deploying session's own credentials.
* A stale, unauthenticated gateway route to a decommissioned endpoint was dropped from both the Kong and Kubernetes gateway whitelists.
* Truncated/duplicated access-control seed rows that incorrectly blocked legitimate users from editing MDMS roles/actions in the Admin Console were fixed.
* Tenant-bootstrap tooling (`digit-mcp`) silently dropped already-fetched master-data rows when a later page of a paginated fetch failed — now keeps what succeeded.
* Creating a new complaint category via the Admin Console now correctly stamps the `hierarchyType`/`levelCode` metadata it needs (previously could produce a category invisible to the picker).
* PGR search now stays fully backward-compatible for a tenant that never authored a dashboard access-scope configuration at all, instead of silently defaulting to an overly restrictive scope.
* *(Landed after 2026-08-25)* The seeded local admin account is granted the account-administrator permission, now that city-bootstrap actions require it.
* *(Landed after 2026-08-25)* A missing `PGR_SUPERVISOR` role was added to the seed data — role-actions referenced it before the role record itself existed.
* *(Landed after 2026-08-25)* Action `4557` (the Dashboard sidebar nav-link action) was restored after being corrupted in the sample seed data for one tenant — affected any city bootstrapped from that sample.

***

### 6. What You Must Do Before Upgrading

* [ ] Run the validated migration for complaint categories — see the [Migration Guide](migration-guide-v2.11-to-v2.12.md) and [servicedefs-to-complainthierarchy-migration.md](../migration/servicedefs-to-complainthierarchy-migration.md) (Section 1).
* [ ] Seed the new RBAC role, PII-visibility, and escalation/extended-attribute records yourself — confirmed to have no row in the actual seed data for **any** tenant, new or existing, as of this validation (Section 1).
* [ ] Mark exactly one `MobileNumberValidation` record as `default: true` for each tenant, and update the User Service to its 2.12 build (Section 1).
* [ ] Review your `novu.bridge.channel`/`.channels.enabled` overrides if you already use notifications (Section 2).
* [ ] Download the OpenTelemetry agent before first startup (Section 5).
* [ ] Review the *Known Issues* in the Migration Guide before turning on the new dashboard access-control policy for admin-level roles.

***

### Quick Reference: What's On by Default

| Item | Status | How to turn on/off |
|---|---|---|
| Complaint category tree (`ComplaintHierarchy`) | Always on | n/a — the classification model itself |
| Automatic escalation | On by default | `pgr.escalation.enabled` |
| Dashboard reporting-table refresh | On by default | `pgr.dashboard.refresh.enabled` |
| Dashboard loading-speed telemetry | On by default | `dashboard_metrics_enabled: false` to disable |
| Audit service, db-migrations, hrms-prereq-gate, user-seed | Always on | n/a |
| Encryption Service dependency | Always on | n/a — mandatory |
| Observability stack (traces/metrics/logs) | Off by default | `obs-traces` / `obs-metrics` / `obs-logs` Compose profiles |
| Notifications stack | Off by default | `enable_novu` |
| Config-driven notifications | Off by default | `pgr_notification_config_driven` / `pgr.notification.config.driven` |
| Real OTP delivery | Off by default | `enable_otp_services` |
| "My/All" inbox visibility | Off by default | `pgr.visibility.enabled` |
| Faster search-backed inbox | Off by default | `enable_search_stack` |
| Location auto-complete / self-hosted boundary maps | Off by default | `enable_turbopass` / `enable_overpass` |
| Newer citizen web app | Off by default | `enable_digit_ui_v2` |
