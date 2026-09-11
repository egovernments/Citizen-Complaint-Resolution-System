# CCRS Migration Guide — v2.11 to v2.12-beta

*Operator-facing upgrade guide for an existing v2.11 deployment moving to v2.12 (`master` @ `81168120a`, 2026-08-03; originally drafted against `develop` @ `43635f737`, 2026-07-20).*
*Read alongside [release-config-changelog-v2.12-beta.md](release-config-changelog-v2.12-beta.md) for full context on each item below (post-beta changes are catalogued in its Section 5), and [release-notes-v2.12-beta.md](release-notes-v2.12-beta.md) for the consolidated feature-enablement matrix.*

---

## 1. Who this is for

This guide is for an operator with a live v2.11 tenant (data, users, complaints already in production) who wants to move that deployment to v2.12-beta. If you are standing up a brand-new tenant instead, most of the "manual re-seed" items below do not apply — a fresh install auto-seeds the new master data.

## 2. Before you start — backups

- **Full database backup** of every service schema (pgr-services, egov-user, novu-bridge if in use, etc.) before running any Flyway migration. Several new migrations do `DROP MATERIALIZED VIEW ... CASCADE` and recreate — safe by design, but back up first.
- **Back up `/opt/digit/.openbao/init.json`** immediately after your first v2.12-beta deploy, out-of-band (e.g. to a password manager or offline vault). OpenBao is initialized with a single Shamir key (`secret_shares:1, secret_threshold:1`) and this file is the only copy of the root token + unseal key. There is no recovery path if it is lost.
- If you use the Ansible deploy path for the first time (moving off a hand-rolled v2.11 compose setup), read `local-setup/ansible/runbooks/01-openbao.md` before proceeding.

## 3. Breaking changes requiring manual action

### 3.1 Complaint classification: ServiceDefs → ComplaintHierarchy

> **Action required:** Hand-migrate every existing `RAINMAKER-PGR.ServiceDefs` row into the new two-master model — `ComplaintHierarchyDefinition` (the hierarchy shape) + `ComplaintHierarchy` (the actual category/sub-type tree). No automated backfill ships in this repo.

- Keep each leaf node's `code` identical to the old `serviceCode` — already-filed complaints reference this value and remain valid as long as the code is reused.
- Verify `Workflow.BusinessServiceMasterConfig` has a `PGR` row (`active:true, isStatelevel:true`) — required for escalation/notification-routing features that key off `businessService`.

### 3.2 Mobile validation: UserValidation → MobileNumberValidation

> **Action required:** `common-masters.UserValidation` is gone. Create/adjust a `common-masters.MobileNumberValidation` record for your tenant's country before upgrading `egov-user`, **and** explicitly set `default: true` on exactly one record — regardless of country.

- New shape: `{ countryCode, mobileNumberRegex, default }`, unique on `countryCode`, plus the generic MDMS-v2 `isActive` flag. Name, email, and postal-code rules live in the separate `common-masters.FormValidations` master (one row per `fieldType` with a `regex`) — see Section 3.7.
- Only one record ships by default, pinned to a single calling code and national-number regex (`+254`, `^0?[17][0-9]{8}$`) — and it ships with **`default: false`**. If your tenant's numbering format differs, create your own record with the right `countryCode` and `mobileNumberRegex`.
- **Set `default: true` on exactly one record.** The real consumers are `egov-user` (backend validation) and the PGR frontend `useMobileValidation` hook — the latter falls back silently (to the first active record, or a hardcoded `+91`/10-digit pattern) if nothing is flagged default, so an unconfigured tenant on a different numbering format risks quietly validating against the wrong pattern. (`novu-bridge` has a similar-looking MDMS lookup with no fallback, but it's only reachable from a pass-through test/debug endpoint, not the real WhatsApp delivery path — see the companion changelog Section 1.4 for detail. Real WhatsApp delivery relies on the complaint's own `service.citizen.countryCode`, not this master.)
- **Bump `egov-user` too** — the old image has India's mobile-number rule hardcoded in Java; without an upgrade it never reads the `mobileNumberRegex` you just set above. Use `egovio/egov-user:2.12-87e13fe` (the 2.12 core-services merge, what `local-setup/docker-compose.egov-digit.yaml` now pins) or `registry.preview.egov.theflywheel.in/egovio/egov-user:1044-preview` (the Ansible default, `EGOV_USER_IMAGE` in `digit.env.j2`) — don't pick a tag yourself. Both also include a tenant-aware encryption fix (Digit-Core#1044) and a `SafeHtmlValidator` regression fix that otherwise blocks citizen registration (CCRS#771). **Avoid the plain `egovio/egov-user:master-e22c7c5` Docker Hub tag** — it lacks all three and is only meant as a preview-registry-unreachable fallback.

### 3.3 novu-bridge behaviour changes (if you already run it)

- **Default notification channel changed from WhatsApp to SMS.** If your `.env` did not explicitly pin `novu.bridge.channel`, review what channel you actually want after upgrading.
- **WhatsApp is now off by default** at the channel-enablement level too (`novu.bridge.channels.enabled` defaults to `SMS,EMAIL`) — set it explicitly to include `WHATSAPP` if you rely on it, or events will persist as `SKIPPED/NB_NO_PROVIDER`.
- Removed properties `novu.bridge.max.retries` and the `novu.bridge.config.host`/`.resolve.path`/`.search.path` trio — delete these from any custom `.env`/property overrides, they no longer do anything.
- Run the new out-of-order Flyway migration `V20260701000000__extend_dispatch_unique_key.sql` with `spring.flyway.out-of-order=true` set (already the repo default) — do not edit the older checksummed migrations to work around ordering.

### 3.4 pgr-services default boundary host changed

> **Check your override:** `egov.boundary.host` default changed from `http://localhost:8081` to `http://boundary-service.egov:8080/` (in-cluster service name). If you already set this explicitly you are unaffected; if you relied on the old default, set it explicitly to your actual boundary-service address.

### 3.5 RBAC / security-policy re-seed

> **Action required:** default-data-handler seeding is create-only — an already-live tenant will not automatically pick up the new `CMS_SCREENING_OFFICER` role/role-actions or the expanded `DataSecurity.SecurityPolicy` PII-visibility grants. Re-run the relevant seed step manually, or apply the equivalent MDMS records by hand, and review the new PII-visibility defaults before applying them to a tenant with its own custom security policy.

### 3.6 Dashboard analytics now fail-closed on missing HRMS department

> **Check your HRMS data:** dashboard/analytics rows are now scoped by jurisdiction (`boundary_path` prefix) and by the viewing employee's department, both resolved from HRMS — and the resolver fails closed. **Any HRMS employee with no department set will see structurally empty dashboards after upgrade**, even if they previously saw data. Audit department assignments for employees who use the dashboard before or immediately after upgrading (`dss.DashboardConfig.departmentScoping` can disable the department axis tenant-wide if needed).

### 3.7 Form validations & reopen window (post-beta)

> **Action required (validation):** the new `common-masters.FormValidations` master (one row per `fieldType`: `postalCode`, `name`, `email`, each with a `regex`) is now the primary per-tenant rule and **outranks** the host_vars `core_postal_configs` pattern in DIGIT Studio and all PGR create-complaint flows. Fresh tenants get a default 5-digit `postalCode` row seeded automatically; **existing tenants must seed the rows manually** (default-data-handler seeding is create-only).

- host_vars shape change: `core_postal_configs` lost `postalCodeLength` and `postalCodeErrorMessage` — `postalCodePattern` is the only remaining knob and the localized error message is derived from it. Delete the two removed keys from your tenant's host_vars.

> **Check your reopen window:** `RAINMAKER-PGR.UIConstants.REOPENSLA` is now actually read — previously a hardcoded 1-hour default won regardless of this value — and the deadline is now enforced server-side too. New tenants ship 259200000 ms (72 hours); **existing tenants keep whatever they already have** (typically 432000000 = 5 days), so set `REOPENSLA` explicitly if 72 hours is what you want.
>
> **Unset `time-before-closing-complaint` in your deployment values.** It maps to `PGR_COMPLAIN_IDLE_TIME`, which used to be the enforced window and is now only a fallback. Leaving it set pins one window server-side while the UI honours the per-tenant `REOPENSLA` — the two disagree and citizens get a "Complaint is closed" error on a REOPEN button the UI still offered. See §5.2 of the config changelog.

## 4. New mandatory infrastructure (always-on after upgrade)

These have no off-switch — every v2.12-beta deployment gets them, whether or not you use the features they support:

- **OpenTelemetry agent** — every Java service now mounts `./otel/opentelemetry-javaagent.jar` and sets `JAVA_TOOL_OPTIONS=-javaagent:...`. Run `local-setup/otel/download-agent.sh` (pinned version 2.11.0) **before** `docker compose up`, or every Java container fails to start on a missing mount source.
- **Full observability stack** — otel-collector, Tempo (tracing), Promtail+Loki (logs), Grafana+Prometheus (dashboards/metrics) start unconditionally. Budget the extra RAM/CPU/disk, and be aware of the new loopback ports (Loki 13100, Prometheus 19090, Tempo 13200, OTel-collector 14317/14318/13133, OpenBao 18200).
- **Client-side dashboard render-lag instrumentation** — ships two new **public-facing** Kong ingest routes, `/otel/v1/metrics` and `/otel/v1/logs`, so the browser can report metrics directly. Set `dashboard_metrics_enabled: false` (ansible) / `DASHBOARD_METRICS_ENABLED=false` (globalConfigs) to turn it off if you don't want the extra public routes. See `docs/observability/dashboard-metrics.md` for what it measures and how to read it (it now covers both the client and server sides).
- **OpenBao** — see the backup note in Section 2. Initializes and auto-unseals on every deploy run.
- **audit-service, db-migrations, hrms-prereq-gate, user-seed** — new always-on compose services with no profile gate.
- **egov-enc-service dependency** — pgr-services now calls this service for PII encryption on every request path that touches it; it must be deployed and reachable or those calls fail.

Two related items are **not** in the same category — they are ordinary Spring Boot flags, default-enabled rather than unconditional, and can be turned off:

- **PGR escalation scheduler and dashboard MV refresh** — both default enabled (`pgr.escalation.enabled=true`, `pgr.dashboard.refresh.enabled=true`) but genuinely toggleable; setting either to `false` disables that scheduler. The escalation scheduler needs the `pgr-escalation-events` Kafka topic to exist while enabled.

## 5. Required database migrations

Run all pending Flyway migrations for pgr-services (and novu-bridge, xstate-chatbot if in use) as part of the upgrade. They must run in order — several `DROP MATERIALIZED VIEW ... CASCADE` and recreate later in the sequence:

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
| — | `V20260701000000__extend_dispatch_unique_key.sql` (out-of-order) | novu-bridge, if in use |
| — | `V20260505000000__chat.sql` (new DB) | xstate-chatbot, if in use |

*Before running these in production, check the new `flyway-dump-alignment` CI gate's logic (`.github/workflows/flyway-dump-alignment.yml`) — it exists specifically to catch a `SPRING_FLYWAY_TABLE` / seeded-dump mismatch that makes Flyway try to re-run already-applied migrations and crash with `42P07 relation already exists`.*

## 6. Optional features you may want to enable

None of these are required to upgrade — enable only what you need:

| Feature | Flag(s) | Notes |
|---|---|---|
| Config-driven PGR notifications (SMS/WhatsApp/Email) | `pgr.notification.config.driven=true` + your own approved WhatsApp Content templates persisted into `RAINMAKER-PGR.NotificationProviderTemplate` (via Configurator's **Sync WhatsApp templates** UI or `local-setup/scripts/persist-provider-templates.py`) | Do **not** rely on `local-setup/db/notif-mdms-seed/seed.sh` — it seeds `TemplateBinding`/`ProviderDetail`, which the config-driven WhatsApp path no longer reads. The seeded reference Content SIDs are Twilio-account- and Meta-approval-bound; you must author and get your own approved on your own Twilio account. See Section 3.3 for channel defaults to review first |
| Supervisor dashboard | Seed `dss.DashboardConfig`, capability-based `dss.KpiDefinition` / `dss.DashboardPack`, actions 2640–2648, navigation action 4557 and matching roleactions | MV refresh is already default-enabled (Section 4); `DashboardConfig` no longer carries employee role access |
| PGR Visibility V1 (My/All inbox tabs, reportee-scoped inbox) | `pgr.visibility.enabled=true` / `PGR_VISIBILITY_ENABLED` + `RAINMAKER-PGR.InboxVisibilityConfig` record | Needs the new `eg_pgr_hrms_projection` table (migration #8) and HRMS Kafka topics |
| digit-ui-v2 citizen SPA | `enable_digit_ui_v2` | Serves alongside the existing citizen UI at `/citizen/` |
| Elasticsearch-backed inbox v2 | `enable_search_stack` | ~3GB additional RAM |
| Real OTP delivery | `enable_otp_services` | Kong mocks a fixed OTP otherwise |
| Turbopass / self-hosted Overpass | `enable_turbopass` / `enable_overpass` | OSM-based location autocomplete for Configurator |

## 7. Suggested upgrade procedure

1. Back up all service databases and, once deployed, the OpenBao `init.json` (Section 2).
2. Create/verify country-specific master data before flipping any validation-related service: `common-masters.MobileNumberValidation` for your locale (Section 3.2), `core_postal_configs`/`core_mobile_configs` in your tenant's `host_vars/<tenant>.yml`.
3. Migrate `ServiceDefs` → `ComplaintHierarchyDefinition` + `ComplaintHierarchy` for your tenant's complaint types (Section 3.1), and confirm the `Workflow.BusinessServiceMasterConfig` `PGR` row exists.
4. Re-seed / manually apply the new RBAC role, role-actions, and security-policy rows (Section 3.5).
5. Run `local-setup/otel/download-agent.sh` before bringing up the new compose stack (Section 4).
6. Deploy v2.12-beta (Ansible: populate `host_vars/<tenant>.yml` from `_example.yml`, run `deploy.sh <tenant>`; Compose: use `docker-compose.egov-digit.yaml`).
7. Let Flyway apply the migrations in Section 5 (in order); verify with the app logs / `flyway_schema_history` table that all listed migrations show `success=true`.
8. Review `novu-bridge` channel defaults if you already used it (Section 3.3) before assuming WhatsApp still works unchanged.
9. Opt into any features from Section 6 as needed.
10. Run through Section 8's verification checklist.

## 8. Post-upgrade verification checklist

- [ ] Complaint create/assign/resolve/escalate flow works end-to-end for at least one complaint type per (migrated) hierarchy branch.
- [ ] Employee inbox loads and paginates; if Visibility V1 is enabled, the My/All tabs return the expected scoped results.
- [ ] Mobile-number entry accepts your tenant's real number format on both citizen and employee create-complaint forms.
- [ ] Dashboard loads without errors and KPI tiles show non-null values (confirms the new materialized views populated correctly). If tiles are unexpectedly empty for a given employee, check their HRMS department is set (Section 1.3 of the companion changelog — the new scoping fails closed).
- [ ] If notifications are enabled: `drive-test-complaint.py` (local-setup/scripts) completes and a real SMS/WhatsApp message is received using your **own** approved Content templates, not the seeded reference SIDs.
- [ ] Grafana/Prometheus/Loki/Tempo are reachable on their new ports and receiving data from at least one Java service; if dashboard render-lag metrics are enabled, see `docs/observability/dashboard-metrics.md` for how to read them.
- [ ] The backed-up OpenBao `init.json` matches what is currently on disk at `/opt/digit/.openbao/init.json`.

---

*This document was compiled from a structured survey of the git history between tag `v2.11` and `develop` @ `43635f737`. A small number of items are flagged in the companion changelog as unverified in full depth (e.g. the complete Kong route diff, and full xstate-chatbot config audit) — confirm those directly before relying on this guide for a production cutover.*
