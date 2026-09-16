# Migration Guide

**Who this is for:** anyone with an existing v2.11 deployment upgrading to v2.12. If you're setting up a brand-new install instead, skip most of the "manual re-seed" steps below — fresh installs get new data automatically.

**See also:** [Config & Infra Changelog](release-config-changelog-v2.12.md) for full technical detail on each item · [Release Notes](release-notes-v2.12.md) for the feature summary.

***

### 1. Before You Start: Back Up These Things

* [ ] **Full database backup** for every service — complaints, user/login, and notifications if you use it. Several migrations drop and recreate reporting tables/views.
* [ ] **The secrets file** at `/opt/digit/.openbao/init.json` — back it up immediately after your first v2.12 deployment, somewhere safe and separate from the server. It's the *only* copy of the keys unlocking every secret this deployment stores. Lost means unrecoverable — there is no back door.
* [ ] First time using the automated (Ansible) deployment process for this city? Read the secrets-setup guide (`local-setup/ansible/runbooks/01-openbao.md`) before proceeding.

***

### 2. Breaking Changes You Must Handle

#### 2.1 Complaint categories: fixed two-level list → city-shaped tree

⚠️ **Action required:** convert your existing complaint categories to the new model, or complaint filing/routing for them breaks after the upgrade.

* **What changed:** `RAINMAKER-PGR.ServiceDefs` (a flat list) is removed, replaced by `ComplaintHierarchyDefinition` (the tree shape) + `ComplaintHierarchy` (the actual data). A leaf's `code` **is** the old `serviceCode`, kept verbatim, so already-filed complaints stay valid.
* **How to migrate:** use the validated migration tool — [servicedefs-to-complainthierarchy-migration.md](../migration/servicedefs-to-complainthierarchy-migration.md) — rather than rebuilding by hand. Run its preflight check first; it flags anything that needs a manual fix before you migrate. Also confirm `Workflow.BusinessServiceMasterConfig` has a `PGR` row (`active:true, isStatelevel:true`).
* **Watch out for:** two gaps found during real-world validation of this migration, not documented elsewhere — (1) a complaint whose category hasn't been migrated will fail to send notifications on its next workflow action, even though it still opens and displays fine; (2) the analytics reporting views resolve a category's department by a global, cross-tenant dedup on category code rather than each city's own — two cities sharing a common default category code with different departments can silently show one city's department on the other's dashboard tiles. See the migration tool's documentation, §4.2–4.3, for queries that check your exposure.

#### 2.2 Phone-number validation: hardcoded → per-country, but ships off

⚠️ **Action required:** set up and mark a default phone-number rule, or the app silently falls back to a generic pattern with no error shown.

* **What changed:** `common-masters.UserValidation` → `common-masters.MobileNumberValidation`, shaped `{ countryCode, mobileNumberRegex, default }`. The shipped sample record (`+254`, `^0?[17][0-9]{8}$`) has `default: false` — no record is marked default out of the box, for any tenant.
* **What to do:** set up a rule for your city's country (or confirm the sample matches, if it happens to), mark **exactly one** rule as `default: true`, and update the User Service to its 2.12 build — older builds never read this setting at all. Name/email/postal-code rules live separately (see 2.6).

#### 2.3 Notifications: WhatsApp → SMS default, WhatsApp needs explicit opt-in

* **What changed:** `novu.bridge.channel` default flipped `WHATSAPP` → `SMS`; `novu.bridge.channels.enabled` now defaults to `SMS,EMAIL`.
* **What to do:** if you already use WhatsApp notifications, turn it back on explicitly (include `WHATSAPP` in `novu.bridge.channels.enabled`) or events silently persist as `SKIPPED/NB_NO_PROVIDER`. Remove any custom settings referencing `novu.bridge.max.retries` or the `novu.bridge.config.host`/`.resolve.path`/`.search.path` trio — retired. No action needed if you don't use notifications yet.

#### 2.4 Boundary-service address default changed

* **What changed:** `egov.boundary.host` default: `http://localhost:8081` → `http://boundary-service.egov:8080/` (in-cluster address).
* **What to do:** if you already set this explicitly, unaffected. If you relied on the previous default, check it still points to your actual boundary service.

#### 2.5 New role and privacy rules need loading — on every city, not just existing ones

⚠️ **Action required, for new AND existing cities:** apply these manually, don't assume any city has them by default.

* **What changed:** v2.12 ships a new `CMS_SCREENING_OFFICER` staff role and expanded `DataSecurity.DecryptionABAC` PII-visibility grants (this is the correct master name — earlier drafts of this guide, inherited from the beta, misnamed it `DataSecurity.SecurityPolicy`). These are designed to auto-seed for brand-new cities only (default-data-handler seeding is create-only) — **but as of this validation, neither actually has a row in the seed data a fresh local install uses either.** This isn't only an "existing city" gap.
* **What to do:** have admin access re-run the setup step, or apply the records manually, for any city — new or existing. Confirm your own deployment's seed pipeline actually loads these before assuming a given tenant has them. Review the new privacy rules against your own policy before applying — they change who can see personal fields like phone number, address, and ID numbers.

#### 2.6 Postal-code/name/email rules, and the complaint reopen window

* **What changed:** postal-code/name/email rules move to a new `common-masters.FormValidations` master (one row per `fieldType`), outranking the old deployment-file `core_postal_configs` pattern. Separately, the complaint reopen window (`RAINMAKER-PGR.UIConstants.REOPENSLA`) is now actually enforced — previously a hidden 1-hour limit won regardless of the visible setting.
* **What to do:** new cities get a default `FormValidations` row and a 72-hour `REOPENSLA` automatically. **Existing cities must add the `FormValidations` row themselves**, and **keep whatever `REOPENSLA` value they already had** — update it if you want the new 72-hour default. Remove the now-unused `postalCodeLength`/`postalCodeErrorMessage` deployment settings and the older, conflicting `time-before-closing-complaint` setting if you have it — leaving it set can make the screen offer "Reopen" on a complaint the server then rejects.
* **Fixed after 2026-08-25:** `REOPENSLA` originally couldn't be edited at all via the Admin Console/API — the master was keyed on the value itself, so any change was rejected outright. A database migration (row 13 in Section 4) automatically re-keys it onto a stable identifier the first time you upgrade; no action needed beyond letting that migration run.

***

### 3. New Infrastructure You'll Get Automatically

| What | What it does | Anything you need to do first? |
|---|---|---|
| Metrics-collection agent (OpenTelemetry Java agent) | Every backend service reports its own performance | Download it once before first startup (`local-setup/otel/download-agent.sh`, pinned v2.11.0) — affected services fail to start otherwise |
| Secrets storage system (OpenBao) | Sets itself up and unlocks automatically | None — but back it up (see Section 1) |
| Audit service, db-migrations, hrms-prereq-gate, user-seed | Background helpers, no on/off switch | None |
| Encryption Service dependency | Complaints service calls it to protect personal data on every request that touches it | Must be running and reachable |
| Dashboard loading-speed reporting | Two new public-facing addresses, `/otel/v1/metrics` and `/otel/v1/logs` | None — switch off with `dashboard_metrics_enabled: false` if you'd rather not expose them |

**Resource note:** the fuller observability stack (Tempo/Grafana/Prometheus/Loki/Promtail) is **not** always-on — it moved behind three opt-in Compose profiles (`obs-traces`/`obs-metrics`/`obs-logs`). Turn on what you need and budget the extra RAM/CPU/disk once you do. New loopback ports once turned on: Loki 13100, Prometheus 19090, Tempo 13200, OTel-collector 14317/14318/13133, OpenBao 18200.

#### These are on by default but can be turned off

| Setting | Default | How to disable |
|---|---|---|
| Automatic complaint escalation | on | `pgr.escalation.enabled=false` |
| Scheduled dashboard-data refresh | on | `pgr.dashboard.refresh.enabled=false` |
| Dashboard loading-speed telemetry | on | `dashboard_metrics_enabled: false` |

***

### 4. Database Migrations to Run

Run these in order as part of the upgrade — several rebuild the same reporting tables from scratch, and later ones assume the earlier shape exists:

| Order | Migration | Service |
|---|---|---|
| 1 | `V20260422000000__create_dashboard_mvs.sql` | pgr-services |
| 2 | `V20260608000000__create_v2_grain_mvs.sql` | pgr-services |
| 3 | `V20260609000000__add_assignment_routing_flags_to_facts.sql` | pgr-services |
| 4 | `V20260621000000__add_extended_attributes.sql` | pgr-services |
| 5 | `V20260623120000__open_complaint_age_buckets.sql` | pgr-services |
| 6 | `V20260629000000__grain_scope_columns.sql` | pgr-services |
| 7 | `V20260708000000__sla_and_hierarchy_grains.sql` | pgr-services |
| 8 | `V20260715000000__create_hrms_projection.sql` | pgr-services |
| 9 | `V20260716000000__hier_path_null_on_dotted_node_codes.sql` | pgr-services |
| 10 | `V20260717000000__hier_path_null_on_dotted_parent_codes.sql` | pgr-services |
| 11 | `V20260731000000__repoint_grain_mvs_to_complainthierarchy.sql` | pgr-services |
| 12 | `V20260810000000__tenant_business_calendar_grains.sql` *(found during validation — fixes report time-groupings to use each city's own time zone; supersedes row 11's shape for the same two tables)* | pgr-services |
| — | `V20260701000000__extend_dispatch_unique_key.sql` (out-of-order; already configured to run that way) | novu-bridge, if in use |
| — | `V20260505000000__chat.sql` (new database) | xstate-chatbot, if in use |
| 13 | `V20260715000000__mapconfig_recode_from_colour_key.sql` (fixes `RAINMAKER-PGR.MapConfig` the same way row 14 fixes the reopen window) | egov-mdms-service |
| 14 | `V20260827000000__uiconstants_recode_from_reopensla_key.sql` *(landed after 2026-08-25 — makes the reopen window editable, see Section 2.6)* | egov-mdms-service |

***

### 5. Optional Features You Might Want to Turn On

None of these is required — enable only what you need.

| Feature | Flag(s) | Notes |
|---|---|---|
| Config-driven SMS/WhatsApp/Email notifications | `pgr.notification.config.driven` / `pgr_notification_config_driven` | Needs your own approved WhatsApp templates — don't use the old seeding script, it loads data the current delivery path no longer reads |
| Supervisor dashboard visibility | (setup data, no flag) | Reporting-data refresh is already on; this only controls who sees the dashboard menu/cards |
| "My Complaints / All Complaints" inbox tabs | `pgr.visibility.enabled` (env `PGR_VISIBILITY_ENABLED`) | Needs the staff-reporting-structure table from migration row 8, and a live HR service connection |
| Newer citizen web app | `enable_digit_ui_v2` | Served alongside the existing app, at `/citizen/` |
| Faster, search-index-backed inbox | `enable_search_stack` | ~3GB extra memory |
| Real one-time-password delivery for login | `enable_otp_services` | A fixed test code is used otherwise |
| Location auto-complete for boundary setup | `enable_turbopass` | Speeds up boundary setup in the Admin Console |

***

### 6. Step-by-Step Upgrade Procedure

1. Back up all service databases and, once deployed, the secrets file — Section 1.
2. Set up your country-specific phone-number and postal-code/name/email rules before turning on anything that depends on them — Section 2.2, 2.6.
3. Run the validated migration tool to convert your complaint categories, and confirm the workflow prerequisite exists — Section 2.1.
4. Re-add the new role, permissions, and privacy-rule updates for your city — Section 2.5.
5. Download the OpenTelemetry agent before starting the new deployment — Section 3.
6. Deploy v2.12 using your normal deployment process for this city.
7. Let the database updates in Section 4 run in order; confirm with your technical team that all of them completed successfully.
8. If you already use notifications, review the channel defaults before assuming WhatsApp still works unchanged — Section 2.3.
9. Turn on any optional features from Section 5 that your city wants.
10. Work through the verification checklist below.

***

### 7. After You Upgrade: Verify It Worked

* [ ] Filing, assigning, resolving, and escalating a complaint works end-to-end, for one complaint type per category branch.
* [ ] Employee inbox loads and pages correctly; "My/All" tabs (if on) show expected results.
* [ ] Phone-number entry accepts your city's real format on citizen and employee forms.
* [ ] Dashboard loads with real (non-empty) numbers; empty for a specific person → check their HR department (Section 2 dashboard-scoping note below).
* [ ] If notifications are on: a real test complaint sends a real message using **your own** approved templates, not the samples.
* [ ] Monitoring is reachable and receiving data, for whichever observability profiles you turned on.
* [ ] The backed-up secrets file matches what's on the server.

> 💡 **One more thing to know:** the dashboard only shows a staff member data for their own area **and** department, and fails closed — any staff member with no HR department set sees a **completely empty dashboard**, even if they saw data before. Check every dashboard-using staff member has a department in HR before or right after upgrading. A city-wide off-switch (`dss.DashboardConfig.departmentScoping`) exists if you'd rather disable the department axis entirely.
>
> Also review the new row-level dashboard/analytics access control before enabling it for admin-level roles — an independent review found tenant-wide admin/supervisor roles can lose unrestricted dashboard access, a cross-tenant config-refresh authorization gap, and a case where the "department scoping disabled" override doesn't actually apply. Verify this specifically if your city relies on admin roles seeing the full dashboard. *(Two related, separate bugs in this area were fixed after 2026-08-25: a severe scope mismatch where a coarsely-jurisdictioned employee saw zero results in search but nearly the whole tenant on the dashboard, and Grievance Routing Officers seeing every department's complaints instead of just their own. Neither of those fixes touches the admin-role gaps above, which remain open.)*

***

## Related Documents

| Document | Description |
|---|---|
| [release-notes-v2.12.md](release-notes-v2.12.md) | Plain-language feature overview for this release |
| [release-config-changelog-v2.12.md](release-config-changelog-v2.12.md) | Full technical config/infra changelog |
| [servicedefs-to-complainthierarchy-migration.md](../migration/servicedefs-to-complainthierarchy-migration.md) | Validated, current procedure for the complaint-category migration (Docker Compose + Kubernetes commands) |
| [validation-log-2026-08-24.md](../migration/validation-log-2026-08-24.md) | Real evidence from running that migration end-to-end |
| [operator-runbook.md](../migration/operator-runbook.md) | Historical, detailed gotcha catalog (G1–G10) from the original feature-branch rollout |
| [tenant-department-migration-guide.md](../migration/tenant-department-migration-guide.md) | Deep dive on department/analytics data correctness after migrating |
