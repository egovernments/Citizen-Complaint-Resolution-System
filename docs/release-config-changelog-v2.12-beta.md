# CCRS v2.12-beta — Configuration & Infrastructure Changelog

*New master data, schemas, service-level configuration, and DevOps/infrastructure changes.*
*Scope: git tag `v2.11` (`47316a512`, 2026-04-17) through `develop` @ `43635f737` (2026-07-20).*
*Companion to [docs/release-notes-v2.12.md](release-notes-v2.12.md) (feature-level changelog) — this document is config/infra-focused, for release and operations audiences.*

---

## 1. New & Changed Master Data (MDMS)

All MDMS-v2 master data lives under `utilities/default-data-handler` (auto-seeded on fresh installs) unless noted otherwise. Items marked **BREAKING** require operator action on an existing tenant — they are not automatically backfilled by an in-place upgrade.

### 1.1 Complaint Hierarchy (RAINMAKER-PGR)

> **BREAKING —** `RAINMAKER-PGR.ServiceDefs` is removed. Replaced by a two-master model:

- **`RAINMAKER-PGR.ComplaintHierarchyDefinition`** (NEW) — declares ordered, tenant-configurable classification levels (`hierarchyType`, `levels[]` with `levelCode/order/parentLevel/isFreeText/isLeafServiceCode/label`). Default shipped data: a 2-level `PGR` hierarchy (`CATEGORY` → `SUB_TYPE`).
- **`RAINMAKER-PGR.ComplaintHierarchy`** (NEW) — single adjacency-list master holding both interior category nodes and leaf sub-types (`hierarchyType, levelCode, code, parentCode, path, name, order, active`; leaves add `department, departments[], slaHours, keywords`). A leaf's `code` **is** the `serviceCode` stored on a complaint, so already-filed complaints stay compatible as long as the same codes are reused.
- Migration path: any tenant's existing `ServiceDefs` rows must be hand-transformed into the two new masters. No automated backfill script ships in this repo.

- **`RAINMAKER-PGR.ComplaintExtendedAttributeSchema`** (NEW) — per-`schemaRef` JSON-Schema fragments for extended/confidential complaint fields (e.g. `IgeComplaintExtendedAttributes`), with `x-security` attribute lists.
- **`RAINMAKER-PGR.ComplaintRelatedToMap`** (NEW) — lookup driving which extended-attribute schema applies to a complaint (`IGE`, `IGSAE` codes).
- **`RAINMAKER-PGR.ComplaintTemplateType`** (NEW) — joins `caseRelatedTo` → `schemaRef` + allowed document types + allowed viewer roles (e.g. `CONFIDENTIAL_COMPLAINT_VIEWER`).
- **`RAINMAKER-PGR.EscalationConfig`** (NEW) — per-tenant auto-escalation SLA config (`maxDepth`, `defaultSlaByLevel[]`, optional per-serviceCode overrides). Without a record, pgr-services falls back to a hardcoded 5-day SLA. Shipped default: `maxDepth:3`, SLAs `[1h, 4h, 24h]`.
- **`RAINMAKER-PGR.MapConfig`** (NEW schema, no default data) — per-tenant map tiles/center/zoom/geocode-bbox config. Opt-in; UI falls back to globalConfigs/built-in defaults if no record exists.
- **`RAINMAKER-PGR.InboxVisibilityConfig`** (NEW schema, no default data) — feature flag + config for the employee inbox "My/All" tabs (Visibility V1). Missing record = legacy inbox behaviour; safe by default.

### 1.2 Notifications (RAINMAKER-PGR)

- **`RAINMAKER-PGR.NotificationRouting` / `.NotificationTemplate` / `.NotificationProviderTemplate`** (all NEW, auto-seeded via default-data-handler) — MDMS-driven replacement for the old hardcoded `PGR_<ROLE>_<ACTION>_<STATUS>_SMS_MESSAGE` localization-key messaging. Routing declares which audience is notified on which workflow transition over which channel (SMS/WhatsApp/Email); templates carry the `{placeholder}` message body rendered by pgr-services itself (`NotificationService.resolveProviderTemplate(...)`); provider-templates map a rendered WhatsApp message to a Twilio Content SID via `MDMSUtils.getNotificationProviderTemplates(tenantId)`. Old localization keys are left in place, so nothing breaks — but the new routing table takes precedence once `pgr.notification.config.driven=true` is set (see §2.3).

> **PRODUCTION FOOTGUN — Content SIDs are Twilio-account- and Meta-approval-bound.** The seeded `NotificationProviderTemplate` Content SIDs (`HX…`) belong to the reference/demo Twilio account and are dead on any other account. Any adopting tenant must **author and get Meta approval for their own WhatsApp Content templates** on their own Twilio account, then persist **their** SIDs into `RAINMAKER-PGR.NotificationProviderTemplate` — via the Configurator's **Sync WhatsApp templates** UI (`configurator/src/resources/notification-providers/SyncTwilioTemplatesDialog.tsx`) or `local-setup/scripts/persist-provider-templates.py`. This is the single most common reason WhatsApp delivery silently no-ops after an upgrade — it deserves more attention than "supply Twilio creds."

- **`TemplateBinding` / `ProviderDetail`** (MDMS-v2 schemas under `local-setup/db/notif-mdms-seed/`, with a `seed.sh` seeding script) — **legacy/vestigial as of v2.12-beta.** `novu-bridge` no longer resolves notifications through `digit-config-service`/these masters (that `ConfigServiceClient`/`triggerWithProviderConfig` resolution path was removed alongside #1059); the only remaining reference is a code comment in `DispatchPipelineService.testTrigger()`: *"contentSid/contentVariables are accepted for backward-compatible request shape but no longer used (PGR owns rendering)."* Do not use `seed.sh` to configure production WhatsApp delivery — it seeds masters the delivery path doesn't read. See the callout above for the actual mechanism.

- **`dss.DashboardConfig` / `dss.DashboardPack` / `dss.KpiDefinition`** (NEW schemas, same `notif-mdms-seed` area — unrelated to notifications, just co-located) — back the new dashboard/KPI-metrics feature. See §1.3 for the access-control/scoping behaviour these gate, and §2.5 for the v2 analytics API surface they configure.

### 1.3 Access Control / RBAC

- **New role: `CMS_SCREENING_OFFICER`** — screens complaints and routes them to the correct department, with a corresponding block of role-actions (+259 lines).
- **`DataSecurity.SecurityPolicy`** (MODIFIED) — new PII-visibility grants (`PLAIN`, first+second level) for roles `EMPLOYEE, GRO, PGR_LME, DGRO, CSR, SUPERUSER, PGR_VIEWER, MDMS_ADMIN` on fields including `name, mobileNumber, emailId, pan, aadhaarNumber, correspondenceAddress, permanentAddress`.

> **ACTION NEEDED —** default-data-handler loads are typically create-only; an already-live tenant will not automatically receive the new role/roleactions/security-policy rows — re-seed or apply manually.

- **Dashboard analytics are now jurisdiction- and department-scoped, fail-closed** (`PrincipalScopeResolver`, live behind the `dss.*` schemas in §1.2). Analytics rows are filtered by `boundary_path` prefix plus the employee's department, both resolved from HRMS. `dss.DashboardConfig.departmentScoping` can disable the department axis tenant-wide; certain roles are exempted via a `TENANT_WIDE_ROLES` list.

> **BREAKING —** because the resolver fails closed (unresolvable department → a deny-all sentinel, not "show everything"), **any HRMS employee record with no department set will see structurally empty dashboards** after upgrade, even if that employee previously saw dashboard data. Audit HRMS department assignments before/soon after upgrading if the dashboard is in active use.

### 1.4 Mobile & Postal Validation

> **BREAKING —** `common-masters.UserValidation` is removed, replaced by `common-masters.MobileNumberValidation` — a different shape, not just a rename:

- Old: `{ fieldType, rules: {pattern, minLength, maxLength, allowedStartingCharacters, errorMessage}, attributes: {prefix} }`, unique on `fieldType`.
- New: `{ countryCode, mobileNumberRegex, default, emailRegex?, nameRegex? }`, unique on `countryCode` (per the MDMS-v2 schema definition); each record also carries the generic MDMS-v2 `isActive` flag. The Configurator admin UI's edit form (`configurator/src/admin/schemaDescriptors/mobile-validation.ts`) only surfaces `countryCode`, `mobileNumberRegex`, `default`, and `isActive` — `emailRegex`/`nameRegex` are schema-valid but must be set via the raw MDMS API or a seed script if you need them.
- **Requires an `egov-user` image bump**: the old image had India's mobile-number rule hardcoded in Java; it needs to be on a build that reads `mobileNumberRegex` from this MDMS master instead, or the new per-tenant regex is simply ignored. This repo's own deploy configs pin `registry.preview.egov.theflywheel.in/egovio/egov-user:mobilevalidation-jdk8-4984479` in Compose (`local-setup/docker-compose.egov-digit.yaml`) and default to `...:1044-preview` in Ansible (`local-setup/ansible/templates/digit.env.j2`, `EGOV_USER_IMAGE`) — use one of those two rather than picking a tag yourself. Both also happen to carry two unrelated fixes worth having anyway: a tenant-aware encryption cherry-pick (Digit-Core#1044) and a fix for a `SafeHtmlValidator` regression that blocks citizen registration (CCRS#771). **Avoid the plain `egovio/egov-user:master-e22c7c5` Docker Hub tag** (only referenced as a preview-registry-unreachable fallback in `digit.env.j2`) — it lacks all three.
- Only one record ships by default, pinned to a single calling code and national-number regex (`+254`, `^0?[17][0-9]{8}$`) — and, notably, it ships with **`default: false`**. No record has `default: true` out of the box, for any tenant.
- Real consumers: `egov-user` (backend validation) and the PGR frontend `useMobileValidation` hook, which genuinely falls back silently (to the first active record, or a hardcoded `+91`/10-digit pattern if MDMS and globalConfigs are both absent) — so an unconfigured tenant on a different numbering format risks silently validating against the wrong pattern rather than failing loudly.
- `novu-bridge` is **not** a real-path consumer of this master despite an MDMS-lookup method (`MdmsServiceClient`, filtering for `default: true` with an `.orElseThrow(MDMS_MOBILE_VALIDATION_NOT_FOUND)` and no fallback to the first record) existing in its codebase — that lookup is only reachable from `DispatchPipelineService.testTrigger()` (a pass-through test/debug endpoint, called with `tenantId=null`), not from the real complaint-notification `dispatch()` path. On real WhatsApp delivery, `novu-bridge` never queries this master — it just prepends `whatsapp:+` to whatever number pgr-services already produced from the complaint's `service.citizen.countryCode` (see `NotificationService.buildMobileWithCountryCode()`). The `MDMS_MOBILE_VALIDATION_NOT_FOUND` failure mode is real but confined to that test endpoint.
- Postal-code validation follows the equivalent pattern via `core_postal_configs.postalCodePattern` in globalConfigs (see §3.1) — not an MDMS master.

### 1.5 Workflow

- **`Workflow.BusinessServiceMasterConfig`** — added a `PGR` businessService entry (`active:true, isStatelevel:true`) alongside the pre-existing `Incident` entry. Required for the new escalation/notification-routing features, which key off `businessService`.

### 1.6 Localization

- New keys in `rainmaker-pgr` (en_IN + default): `CS_COMPLAINT_DETAILS_PIN_LOCATION`, `PGR_INBOX_TAB_MY`, `PGR_INBOX_TAB_ALL`.
- New keys in `rainmaker-common` (en_IN + hi_IN): `MOBILE_VALIDATION_DIGITS`, `MOBILE_VALIDATION_AT_LEAST`, `MOBILE_VALIDATION_STARTING_WITH`, `MOBILE_VALIDATION_OR`.
- **New `pt_PT` locale pack for the dashboard** — `digit-mcp/src/tools/dashboard-l10n-seed.ts` defines `DASHBOARD_L10N_MESSAGES_PT_PT` (hundreds of entries) and registers it in `DASHBOARD_L10N_PACKS` alongside `en_IN`. This is scoped to the dashboard's own MCP-driven seed pipeline, distinct from the `utilities/default-data-handler` / `rainmaker-*` localization modules covered above — no `pt_PT` pack exists in that separate MDMS-localization path as of this scope.

### 1.7 Reference data snapshots (not live seed paths)

- `ansible/nairobi-mdms/` (NEW directory) — a real tenant's MDMS export used as a worked example/migration runbook (`v2.11-user-service-upgrade.md`), not a second live-seeding mechanism. Its `ServiceDefs.json` is still in the *old* pre-hierarchy shape — following it verbatim still requires the ComplaintHierarchy migration above.
- `configurator/src/resources/mdms-schemas/` (NEW) — admin-console UI for browsing MDMS-v2 schemas; a tooling addition, not new master data.

---

## 2. New & Changed Service-Level Configuration

### 2.1 New backend services/components

| Component | Purpose | Key config / env | Gate |
|---|---|---|---|
| novu-bridge-endpoint | Novu's Code-First "Bridge" — renders SMS/email workflow templates for self-hosted Novu | `NOVU_SECRET_KEY`, `STRICT_AUTH`, `PORT` | Compose profile `notifications` |
| novu-dashboard | Rebases the upstream Novu dashboard image to serve under `/novu` | `NOVU_DASHBOARD_VERSION`, `NOVU_BASE_PATH`, `VITE_API_HOSTNAME`, `VITE_WEBSOCKET_HOSTNAME` | Compose profile `notifications`, ansible `build_novu_dashboard` |
| xstate-chatbot | Node.js WhatsApp complaint chatbot (XState-based) + a dev-only dialog-authoring app | `ENABLE_SANDBOX_MODE` (multi-tenant sandbox), legacy Twilio/Kaleyra/ValueFirst creds | Not wired into local-setup compose/ansible — k8s Helm + CI build only |
| otp-publisher | Replaces the Kong mock OTP responder with a real generator → Redis → Kafka (`OTP.SEND`) pipeline consumed by novu-bridge → Twilio | `PORT`, `REDIS_URL`, `KAFKA_BROKERS`, `EVENT_TOPIC`, `OTP_TTL_SECONDS`, `STATIC_OTP` (dev/CI escape hatch) | Compose profile `notifications` |
| turbopass (search-api + data) | NestJS geo/place autocomplete (Trie-based fuzzy search over OSM data) for Configurator Phase 2 | `enable_turbopass` (ansible, default false), `turbopass_port` (default 13301) | Ansible-only, off by default |

> **BREAKING if enabled —** otp-publisher replaces the previous Kong mock OTP path entirely; operators relying on the old mock behaviour for non-prod parity need `STATIC_OTP` set.

### 2.2 novu-bridge — reworked (pre-existing service, 28 commits since v2.11)

- **Removed**: `novu.bridge.max.retries`, `novu.bridge.config.host`/`.resolve.path`/`.search.path` (routing moved to MDMS-driven config in pgr-services), `UserServiceClient`, `ResolvedProviderResponse`, `ResolvedTemplateResponse`.
- **Changed default (potentially BREAKING)**: `novu.bridge.channel` default flipped from `WHATSAPP` to `SMS`.
- **New**: `novu.bridge.proxy.auth.enabled`, `.user.details.path`, `.proxy.allowed.roles` (Keycloak/DIGIT-token proxy-auth gate); `novu.bridge.workflow.id.{sms,whatsapp,email}`; `novu.bridge.identify.cache.ttl.ms`; `novu.bridge.channels.enabled` (default `SMS,EMAIL` — **WhatsApp is off by default**, WhatsApp events persist as `SKIPPED/NB_NO_PROVIDER` until enabled); `novu.bridge.http.connect.timeout.ms`/`.read.timeout.ms`.
- `NOVU_BRIDGE_LOG_LEVEL` (default INFO) replaces DEBUG-by-default logging that risked exposing PII; a new `PiiMask` utility masks `providerResponse` in `/logs`.
- New DB migration `V20260701000000__extend_dispatch_unique_key.sql` widens the dispatch-log idempotency key and adds a `transaction_id` column — flagged **out-of-order**, requires `spring.flyway.out-of-order=true` (already set).

### 2.3 pgr-services — new `application.properties` keys

- **Changed default (potentially BREAKING)**: `egov.boundary.host` was `http://localhost:8081`, now `http://boundary-service.egov:8080/` (in-cluster service name).
- **Notifications** (default OFF): `pgr.notification.config.driven=false`, `.default.locale`, `.rolepool.page.size`, `.rolepool.max.pages`, `.mdms.cache.ttl.ms`.
- **Analytics cache**: `pgr.analytics.config-cache-ttl-ms=300000`.
- **Escalation scheduler** (default **ON**: `pgr.escalation.enabled=true`): `.interval.ms`, `.batch.size`, `.default.sla.ms`, `.max.depth`, `.kafka.topic=pgr-escalation-events` — requires this Kafka topic to exist after upgrade.
- **Dashboard MV refresh** (default **ON**): `pgr.dashboard.refresh.enabled=true`, `.interval.ms` — depends on the new materialized views (§2.4).
- **Encryption integration** (mandatory, no flag): `egov.enc.host=http://egov-enc-service:1234`, `.encrypt.endpoint`, `.decrypt.endpoint` — pgr-services now calls an `egov-enc-service` for PII encryption; requires that service to be deployed and reachable.
- **Visibility V1 / inbox scoping** (default OFF: `pgr.visibility.enabled=false`, env override `PGR_VISIBILITY_ENABLED`): `.hrms.employee.save.topic`, `.update.topic`, `.reportee.depth.default`, `.unassigned.states`, `.rebuild.cron`, `.rebuild.batch.size`, `.team.fanout.max` — also needs the per-tenant `RAINMAKER-PGR.InboxVisibilityConfig` MDMS record.

### 2.4 Flyway database migrations — new files

| Migration | Service | What it does |
|---|---|---|
| `V20260422000000__create_dashboard_mvs.sql` | pgr-services | Creates dashboard KPI materialized views |
| `V20260608000000__create_v2_grain_mvs.sql` | pgr-services | Creates `complaint_events` + `complaint_facts` MVs and `complaint_open_state_daily` table |
| `V20260609000000__add_assignment_routing_flags_to_facts.sql` | pgr-services | Recreates `complaint_facts` adding `has_been_assigned`/`is_reassigned` flags |
| `V20260621000000__add_extended_attributes.sql` | pgr-services | Adds `extended_attributes JSONB` + 2 expression indexes to `eg_pgr_service_v2` |
| `V20260623120000__open_complaint_age_buckets.sql` | pgr-services | Recreates `complaint_facts` with aligned aging-bucket labels |
| `V20260629000000__grain_scope_columns.sql` | pgr-services | Adds `department_code`/`account_id` scope columns to grains (CASCADE recreate) |
| `V20260708000000__sla_and_hierarchy_grains.sql` | pgr-services | Fixes `sla_target_ms` sourcing (was NULL for all city tenants) + adds arbitrary-depth hierarchy grains |
| `V20260715000000__create_hrms_projection.sql` | pgr-services | Creates `eg_pgr_hrms_projection` (local HRMS reporting-hierarchy cache for the visibility resolver) |
| `V20260716000000__hier_path_null_on_dotted_node_codes.sql` | pgr-services | Data-hygiene fix for legacy flat-imported hierarchy codes polluting rollup buckets |
| `V20260717000000__hier_path_null_on_dotted_parent_codes.sql` | pgr-services | Same class of fix, parent-code side |
| `V20260701000000__extend_dispatch_unique_key.sql` | novu-bridge | Widens dispatch-log idempotency key, adds `transaction_id` (out-of-order migration) |
| `V20260505000000__chat.sql` | xstate-chatbot | New service, new DB — creates `eg_chat_state_v2` |

The pgr-services migrations depend on each other's shape (several `DROP MATERIALIZED VIEW ... CASCADE` + recreate) and must run in order — standard Flyway behaviour, no special flag needed except for the novu-bridge one noted above.

### 2.5 New REST endpoints (pgr-services)

- `POST /v2/request/inbox/_search` and `POST /v2/request/inbox/_count` — visibility-scoped inbox search, gated by `pgr.visibility.enabled`. (`RequestsApiController` is class-annotated `@RequestMapping("/v2")`; both handler methods only add the `/request/inbox/...` suffix.)
- `GET /v2/dashboard` — restored/new dashboard endpoint backed by the new materialized views.
- `AnalyticsController` (class-annotated `@RequestMapping("/v2/analytics")`) exposes the v2 KPI API surface, all token-required and subject to the jurisdiction/department scoping in §1.3: `POST /v2/analytics/_query` (single + batch), `POST /v2/analytics/_schema`, `POST /v2/analytics/packs` (best-match `DashboardPack`), `POST /v2/analytics/catalog/_search`. Operators wiring Kong routes/whitelists need all of these, not just `/v2/dashboard`.

---

## 3. DevOps / Deployment Infrastructure

> **HEADLINE —** the entire Ansible-driven deployment system is net-new since v2.11. At v2.11, `local-setup/ansible/` was 2 files and only installed Docker + pulled images. It is now a 33-file, ~3,700-line, per-tenant `host_vars`-driven deployment model with runbooks. This is the single largest change for a migration guide to cover.

### 3.1 Ansible host_vars & globalConfigs (new files)

- **Tenant taxonomy** (was a single flat tenant before): `state_root`, `state_tenant_id`, `boot_tenant`, `tenant_id`, `ui_state_tenant_id`.
- **Country-specific validation** (no longer hardcoded to a single fixed country/format): `core_mobile_configs` (countryCode + regex), `core_postal_configs` (postalCodePattern) — surfaced to the frontend as globalConfigs keys `CORE_MOBILE_CONFIGS` / `CORE_POSTAL_CONFIGS`. Absent → legacy 5-digit postal default.
- `pgr_pincode_allowlist` — optional postal-code serviceability allowlist; unset accepts any code (must not be set to `[]`).
- `login_tenant_allowlist`, `employee_module_denylist` — new access-control lists (globalConfigs `LOGIN_TENANT_ALLOWLIST` / `EMPLOYEE_MODULE_DENYLIST`).
- `pgr_boundary_highest_level` / `pgr_boundary_lowest_level` / `boundary_type` / `hierarchy_type` — country-specific boundary taxonomy.
- `dashboard_metrics_enabled` (ansible var, default `true`) → globalConfigs `DASHBOARD_METRICS_ENABLED` — off-switch for the client-side dashboard render-lag instrumentation (#1268/#1110). See §3.3 for the Kong ingest routes this feature depends on.

### 3.2 Opt-in feature flags (default off)

| Flag | Enables |
|---|---|
| `enable_digit_ui_v2` | New Vite/React19 citizen SPA at `/citizen/` |
| `enable_search_stack` | Elasticsearch + egov-indexer + inbox-v2 (~3GB RAM) |
| `enable_mcp` | digit-mcp (default true in the example host_vars, but only reachable on the internal registry) |
| `enable_turbopass` / `enable_overpass` | OSM location autocomplete / self-hosted boundary-polygon service |
| `enable_novu` / `build_novu_dashboard` / `build_novu_bridge` / `pgr_notification_config_driven` | Novu + Twilio WhatsApp notification stack |
| `enable_keycloak` + `auth_provider` | SSO — inert until `auth_provider` is also flipped |
| `enable_otp_services` | Real OTP stack; Kong mocks OTP with a fixed value otherwise |
| `enable_integration_tests[_runner]` | Test dashboards + a run-button daemon |

### 3.3 Docker Compose — new services by profile

> **ALWAYS-ON, no profile gate —** `otel-collector`, `tempo`, `grafana`, `prometheus`, `loki`, `promtail` (full observability stack), plus `openbao`, `audit-service`, `db-migrations`, `hrms-prereq-gate`, `user-seed`, `default-data-handler`. Every deploy on the new compose base gets these unconditionally, consuming extra RAM/CPU/disk and ports (Loki 13100, Prometheus 19090, Tempo 13200, OTel-collector 14317/14318/13133, OpenBao 18200) regardless of whether any opt-in feature is used.
>
> Also new (unless `dashboard_metrics_enabled` is set to `false`): two **public-facing** Kong ingest routes, `/otel/v1/metrics` and `/otel/v1/logs` (`local-setup/kong/kong.yml`), whitelisted as auth-optional so the browser can ship client-side render-lag metrics directly to `otel-collector`. These are in scope for the `gateway-whitelist-parity.yml` CI gate (§3.5).

| Profile | Services |
|---|---|
| search (`enable_search_stack`) | elasticsearch, egov-indexer, inbox |
| otp (`enable_otp_services`) | egov-otp, user-otp, egov-notification-sms |
| mcp (`enable_mcp`) | mcp-postgres, digit-mcp |
| notifications (`enable_novu`) | novu-mongo, novu-api, novu-worker, novu-ws, novu-dashboard, novu-bridge-endpoint, digit-config-service, digit-user-preferences-service, novu-bridge, otp-publisher |
| keycloak (`enable_keycloak`) | keycloak-postgres, keycloak, token-exchange-svc |

### 3.4 Kubernetes / Helm (devops/deploy-as-code)

Pre-existing at v2.11 — not new. Only 13 files changed (91 insertions / 30 deletions): small values.yaml alignment fixes (egov-hrms, egov-user, mdms-v2, user-otp, boundary-service, configmaps, pgr-services, digit-ui, default-data-handler) plus gateway-whitelist parity fixes closing Compose/K8s dual-deploy gaps. No new charts. Low migration risk.

### 3.5 CI/CD — new workflows

- `digit-mcp-ci.yml` — build/test gate for digit-mcp.
- `flyway-dump-alignment.yml` — checks each service's `SPRING_FLYWAY_TABLE` matches the history-table name baked into `full-dump.sql`, preventing Flyway from re-running migrations and crashing with `42P07`.
- `frontend-lockfile-drift.yml` — guards `frontend/micro-ui/web/yarn.lock` against drift.
- `gateway-whitelist-parity.yml` — enforces Kong's auth-optional whitelist matches the K8s gateway's whitelist.
- `gatus-coverage.yml` — enforces every Compose/k3s service has a Gatus health check and both tiers' catalogs match.
- `local-setup/ansible/.ansible-lint`, `.yamllint`, `requirements.yml` — new lint/collection config (ansible had none at v2.11).

### 3.6 New operational scripts (local-setup/scripts/)

- `preflight.py` — rules-as-code gate on `host_vars/<tenant>.yml`, each rule citing a real past incident.
- `hot-deploy.sh` — push local code changes into an already-deployed stack without a full redeploy.
- `enable-notifications.sh` — 9-step resumable installer to flip on config-driven PGR notifications on a running deployment.
- `drive-test-complaint.py` — end-to-end proof that the WhatsApp/Novu pipeline works.
- `seed-notifications.py`, `seed-provider-templates.py`, `persist-provider-templates.py`, `seed-test-account-preferences.py` — MDMS/config seeding helpers.
- `ci-gatus-check.sh`, `ci-localization-check.sh`, `ci-notification-routing.py` — CI assertion helpers.

### 3.7 Auth infrastructure — Keycloak / OpenBao / token-exchange-svc

- **Keycloak SSO** (opt-in, `enable_keycloak: false` default) — adds keycloak + keycloak-postgres + token-exchange-svc, a realm template, and nginx `/auth/` + `/token-exchange/` blocks. Inert until `auth_provider: keycloak` is also set (a deliberate separate cutover step). Optional Google IdP support.

> **ALWAYS-ON, critical —** OpenBao (secrets backend) is unconditional, not opt-in. Initializes with `secret_shares:1, secret_threshold:1` (single Shamir key, no split-key safety) and auto-unseals every run. The root token + unseal key are persisted **unencrypted** at `/opt/digit/.openbao/init.json` (mode 0600) on the target host — losing this file means losing every secret in that tenant's OpenBao, with no recovery path.

---

## 4. Summary — Opt-in vs. Always-on

| Item | Status | Flag |
|---|---|---|
| Ansible host_vars deploy model | New, replaces v2.11 flow | n/a — structural |
| Observability stack (OTel/Tempo/Loki/Prometheus/Grafana/Promtail) | Always-on | none |
| OpenBao secrets backend | Always-on | none |
| audit-service, db-migrations, hrms-prereq-gate, user-seed | Always-on | none |
| PGR escalation scheduler | Default enabled (flag-controlled) | `pgr.escalation.enabled` (default true) |
| PGR dashboard MV refresh | Default enabled (flag-controlled) | `pgr.dashboard.refresh.enabled` (default true) |
| egov-enc-service dependency | Always-on, mandatory | none — hard dependency |
| Elasticsearch / indexer / inbox-v2 | Opt-in | `enable_search_stack` |
| Real OTP stack | Opt-in | `enable_otp_services` |
| digit-mcp | Opt-in (default true in example) | `enable_mcp` |
| Novu / Twilio WhatsApp notifications | Opt-in | `enable_novu` |
| PGR config-driven notifications | Opt-in | `pgr.notification.config.driven` (default false) |
| Keycloak SSO | Opt-in | `enable_keycloak` + `auth_provider` |
| digit-ui-v2 citizen SPA | Opt-in | `enable_digit_ui_v2` |
| Turbopass / self-hosted Overpass | Opt-in | `enable_turbopass` / `enable_overpass` |
| PGR Visibility V1 (inbox scoping) | Opt-in | `pgr.visibility.enabled` (default false) |

*See [migration-guide-v2.11-to-v2.12-beta.md](migration-guide-v2.11-to-v2.12-beta.md) for the operator-facing upgrade procedure derived from this changelog.*
