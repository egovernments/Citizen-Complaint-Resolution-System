# CCRS Migration Guide — v2.11 to v2.12-beta

*Operator-facing upgrade guide for an existing v2.11 deployment moving to v2.12-beta (`develop` @ `43635f737`, 2026-07-20).*
*Read alongside [release-config-changelog-v2.12-beta.md](release-config-changelog-v2.12-beta.md) for full context on each item below.*

> **Status: BETA** — this document describes `develop` as of the date above and will be finalized alongside the v2.12 tag.

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
- `ansible/nairobi-mdms/v2.11-user-service-upgrade.md` documents a worked example for one real tenant's upgrade — useful as a template, but its own `ServiceDefs.json` snapshot has *not* been converted, so treat it as a starting point, not a finished migration.
- Verify `Workflow.BusinessServiceMasterConfig` has a `PGR` row (`active:true, isStatelevel:true`) — required for escalation/notification-routing features that key off `businessService`.

### 3.2 Mobile validation: UserValidation → MobileNumberValidation

> **Action required:** `common-masters.UserValidation` is gone. Create a `common-masters.MobileNumberValidation` record for your tenant's country before upgrading `egov-user`.

- New shape: `{ countryCode, mobileNumberRegex, default, emailRegex?, nameRegex? }`, unique on `countryCode`, plus the generic MDMS-v2 `isActive` flag. Note the Configurator admin UI's edit form only exposes `countryCode`, `mobileNumberRegex`, `default`, and `isActive` — set `emailRegex`/`nameRegex` via the raw MDMS API if you need them.
- The only record shipped by default is for **Kenya** (`+254`, `^0?[17][0-9]{8}$`). If your tenant is not Kenya, create your own record (e.g. India: `countryCode:"+91"`, a 10-digit regex) — otherwise mobile validation silently applies the wrong country's rule.
- Bump `egov-user` to `egovio/egov-user:master-e22c7c5` (or later) and set `MOBILE_NUMBER_VALIDATION_WORKAROUND_ENABLED=false` to activate MDMS-based validation.
- Double-check `novu-bridge`'s `MdmsServiceClient` and the PGR frontend `useMobileValidation` hook both resolve the same record (they look for `default:true`) once you enable WhatsApp/SMS notifications.

### 3.3 novu-bridge behaviour changes (if you already run it)

- **Default notification channel changed from WhatsApp to SMS.** If your `.env` did not explicitly pin `novu.bridge.channel`, review what channel you actually want after upgrading.
- **WhatsApp is now off by default** at the channel-enablement level too (`novu.bridge.channels.enabled` defaults to `SMS,EMAIL`) — set it explicitly to include `WHATSAPP` if you rely on it, or events will persist as `SKIPPED/NB_NO_PROVIDER`.
- Removed properties `novu.bridge.max.retries` and the `novu.bridge.config.host`/`.resolve.path`/`.search.path` trio — delete these from any custom `.env`/property overrides, they no longer do anything.
- Run the new out-of-order Flyway migration `V20260701000000__extend_dispatch_unique_key.sql` with `spring.flyway.out-of-order=true` set (already the repo default) — do not edit the older checksummed migrations to work around ordering.

### 3.4 pgr-services default boundary host changed

> **Check your override:** `egov.boundary.host` default changed from `http://localhost:8081` to `http://boundary-service.egov:8080/` (in-cluster service name). If you already set this explicitly you are unaffected; if you relied on the old default, set it explicitly to your actual boundary-service address.

### 3.5 RBAC / security-policy re-seed

> **Action required:** default-data-handler seeding is create-only — an already-live tenant will not automatically pick up the new `CMS_SCREENING_OFFICER` role/role-actions or the expanded `DataSecurity.SecurityPolicy` PII-visibility grants. Re-run the relevant seed step manually, or apply the equivalent MDMS records by hand, and review the new PII-visibility defaults before applying them to a tenant with its own custom security policy.

## 4. New mandatory infrastructure (always-on after upgrade)

These are not feature flags — every v2.12-beta deployment gets them, whether or not you use the features they support:

- **OpenTelemetry agent** — every Java service now mounts `./otel/opentelemetry-javaagent.jar` and sets `JAVA_TOOL_OPTIONS=-javaagent:...`. Run `local-setup/otel/download-agent.sh` (pinned version 2.11.0) **before** `docker compose up`, or every Java container fails to start on a missing mount source.
- **Full observability stack** — otel-collector, Tempo (tracing), Promtail+Loki (logs), Grafana+Prometheus (dashboards/metrics) start unconditionally. Budget the extra RAM/CPU/disk, and be aware of the new loopback ports (Loki 13100, Prometheus 19090, Tempo 13200, OTel-collector 14317/14318/13133, OpenBao 18200).
- **OpenBao** — see the backup note in §2. Initializes and auto-unseals on every deploy run.
- **audit-service, db-migrations, hrms-prereq-gate, user-seed** — new always-on compose services with no profile gate.
- **egov-enc-service dependency** — pgr-services now calls this service for PII encryption on every request path that touches it; it must be deployed and reachable or those calls fail.
- **PGR escalation scheduler and dashboard MV refresh** — both default ON (`pgr.escalation.enabled`, `pgr.dashboard.refresh.enabled`). The escalation scheduler needs the `pgr-escalation-events` Kafka topic to exist.

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
| — | `V20260701000000__extend_dispatch_unique_key.sql` (out-of-order) | novu-bridge, if in use |
| — | `V20260505000000__chat.sql` (new DB) | xstate-chatbot, if in use |

*Before running these in production, check the new `flyway-dump-alignment` CI gate's logic (`.github/workflows/flyway-dump-alignment.yml`) — it exists specifically to catch a `SPRING_FLYWAY_TABLE` / seeded-dump mismatch that makes Flyway try to re-run already-applied migrations and crash with `42P07 relation already exists`.*

## 6. Optional features you may want to enable

None of these are required to upgrade — enable only what you need:

| Feature | Flag(s) | Notes |
|---|---|---|
| Config-driven PGR notifications (SMS/WhatsApp/Email) | `pgr.notification.config.driven=true` + `local-setup/db/notif-mdms-seed/seed.sh` + Twilio creds | See §3.3 for channel defaults to review first |
| PGR Visibility V1 (My/All inbox tabs, reportee-scoped inbox) | `pgr.visibility.enabled=true` / `PGR_VISIBILITY_ENABLED` + `RAINMAKER-PGR.InboxVisibilityConfig` record | Needs the new `eg_pgr_hrms_projection` table (migration #8) and HRMS Kafka topics |
| Keycloak SSO | `enable_keycloak` + `auth_provider: keycloak` | Two-step cutover by design — enabling the service does not switch auth until `auth_provider` is flipped |
| digit-ui-v2 citizen SPA | `enable_digit_ui_v2` | Serves alongside the existing citizen UI at `/citizen/` |
| Elasticsearch-backed inbox v2 | `enable_search_stack` | ~3GB additional RAM |
| Real OTP delivery | `enable_otp_services` | Kong mocks a fixed OTP otherwise |
| Turbopass / self-hosted Overpass | `enable_turbopass` / `enable_overpass` | OSM-based location autocomplete for Configurator |

## 7. Suggested upgrade procedure

1. Back up all service databases and, once deployed, the OpenBao `init.json` (§2).
2. Create/verify country-specific master data before flipping any validation-related service: `common-masters.MobileNumberValidation` for your locale (§3.2), `core_postal_configs`/`core_mobile_configs` in your tenant's `host_vars/<tenant>.yml`.
3. Migrate `ServiceDefs` → `ComplaintHierarchyDefinition` + `ComplaintHierarchy` for your tenant's complaint types (§3.1), and confirm the `Workflow.BusinessServiceMasterConfig` `PGR` row exists.
4. Re-seed / manually apply the new RBAC role, role-actions, and security-policy rows (§3.5).
5. Run `local-setup/otel/download-agent.sh` before bringing up the new compose stack (§4).
6. Deploy v2.12-beta (Ansible: populate `host_vars/<tenant>.yml` from `_example.yml`, run `deploy.sh <tenant>`; Compose: use `docker-compose.egov-digit.yaml`).
7. Let Flyway apply the migrations in §5 (in order); verify with the app logs / `flyway_schema_history` table that all listed migrations show `success=true`.
8. Review `novu-bridge` channel defaults if you already used it (§3.3) before assuming WhatsApp still works unchanged.
9. Opt into any features from §6 as needed.
10. Run through §8's verification checklist.

## 8. Post-upgrade verification checklist

- [ ] Complaint create/assign/resolve/escalate flow works end-to-end for at least one complaint type per (migrated) hierarchy branch.
- [ ] Employee inbox loads and paginates; if Visibility V1 is enabled, the My/All tabs return the expected scoped results.
- [ ] Mobile-number entry accepts your tenant's real number format on both citizen and employee create-complaint forms.
- [ ] Dashboard loads without errors and KPI tiles show non-null values (confirms the new materialized views populated correctly).
- [ ] If notifications are enabled: `drive-test-complaint.py` (local-setup/scripts) completes and a real SMS/WhatsApp message is received.
- [ ] Grafana/Prometheus/Loki/Tempo are reachable on their new ports and receiving data from at least one Java service.
- [ ] The backed-up OpenBao `init.json` matches what is currently on disk at `/opt/digit/.openbao/init.json`.

---

*This document was compiled from a structured survey of the git history between tag `v2.11` and `develop` @ `43635f737`. A small number of items are flagged in the companion changelog as unverified in full depth (e.g. the complete Kong route diff, and full xstate-chatbot config audit) — confirm those directly before relying on this guide for a production cutover.*
