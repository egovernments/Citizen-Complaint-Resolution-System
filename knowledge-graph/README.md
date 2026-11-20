# CCRS knowledge graph

A source-code-driven knowledge graph of the Citizen Complaint Resolution System (CMS v2.20): what the parts are, how a complaint moves through them, which APIs, tables and Kafka topics are involved, and where the risks are.

- **Snapshot:** `master` at `64d5abe92` (30 Oct 2026, after the v2.20 tag).
- **Method:** controllers, services, repositories, Flyway SQL, persister/indexer YAML, `application.properties`, compose files, Helm charts, `pom.xml`/`package.json` and CI workflows were read directly. README files were used only for orientation.
- **Evidence convention:** `path:line` or `Class#method`. Java paths are abbreviated: `$P/` = `backend/pgr-services/src/main/java/org/egov/pgr/`, `props:N` = `backend/pgr-services/src/main/resources/application.properties` line N.
- **Confirmed vs inferred:** in the diagrams a solid arrow is CONFIRMED (seen in code or config) and a dotted arrow is INFERRED (a conclusion from code, explained in this README). Tables mark inferred items explicitly.

## How this folder is organized

The graph is arranged in **five connected layers**, not one large diagram. Cross-cutting views and an impact-analysis tool sit on top of the layers.

```
knowledge-graph/
├── layers/                    ← start here: one diagram per layer
│   ├── 0-overview.mmd           the five layers + cross-layer link counts (generated from impact/graph)
│   ├── 1-business.mmd           concepts, PGR state machine, business rules enforced in code
│   ├── 2-application.mmd        screens, API clients, services, key classes
│   ├── 3-data.mmd               tables, fields, masters, how analytics views are derived
│   ├── 4-integration.mmd        Kafka producers → topics → consumers, DIGIT core APIs, external systems
│   └── 5-infrastructure.mmd     build, Compose/Ansible, Helm, Kong/nginx, config files, deploy drift
├── *.mmd                      ← cross-cutting views (table below)
└── impact/                    ← impact-analysis graph: data, validator, query tool, worked scenarios
```

Each layer diagram ends with a **"Connections to other layers"** panel; its counts come from the impact graph. Small grey text under a node is that node's **impact-graph id**. Pass it to `impact/impact.mjs` to see everything that depends on it. See [`impact/README.md`](impact/README.md).

| Layer | Nodes in impact graph | Main links out |
|---|---|---|
| 1 · Business | 32 (`wf:`, `biz:`) | (target of 375 status-literal references) |
| 2 · Application | 558 (`screen:`, `api:`, `class:`, `code:`, `config:`, `test:`) | business 449, data 380, integration 214 |
| 3 · Data | 122 (`table:`, `field:`, `master:`) | business 12 (state literals in analytics view SQL) |
| 4 · Integration | 82 (`topic:`, `coreapi:`, `ext:`) | infrastructure 54 |
| 5 · Infrastructure | 250 (`service:`, `infra:`) | application 159, integration 71, data 26 |

## Diagrams

Cross-cutting views (these span several layers):

| File | Shows | Type |
|---|---|---|
| [`complete-knowledge-graph.mmd`](complete-knowledge-graph.mmd) | One-page condensed view of all five layers. For navigation use `layers/` | flowchart |
| [`system-architecture.mmd`](system-architecture.mmd) | Actors → nginx → Kong / identity → services → Kafka → persister / indexer → Postgres / ES, plus notification and external systems | flowchart |
| [`business-workflows.mmd`](business-workflows.mmd) | PGR workflow state machine, and the registration, update, reopen, escalation and notification pipelines | flowchart |
| [`api-dependencies.mmd`](api-dependencies.mmd) | pgr-services endpoints → controllers → services → repositories, tables, topics and outbound calls | flowchart |
| [`data-model.mmd`](data-model.mmd) | Tables, materialized views, platform tables and MDMS masters, with real FKs vs logical links | erDiagram |
| [`integrations.mmd`](integrations.mmd) | Kafka producer → topic → consumer, notification delivery, identity/auth, DIGIT calls, external systems | flowchart |
| [`module-dependencies.mmd`](module-dependencies.mmd) | Maven and npm dependencies, shared packages, verified cycles, runtime coupling | flowchart |

All seven files were rendered with `@mermaid-js/mermaid-cli` 11.4.2 without errors. GitHub renders `.mmd` files natively; for large graphs, open them in [mermaid.live](https://mermaid.live) to zoom.

---

## 1. System overview

CCRS lets citizens file civic complaints (web, WhatsApp) and lets city employees route, resolve and escalate them. In v2.20 it is also a self-serve SaaS: a government admin signs up, creates a workspace (tenant) and configures it without eGov engineers.

The repository builds the CMS-specific parts. The DIGIT platform services (users, workflow, MDMS, HRMS, boundaries, persister, indexer and so on) are consumed as pre-built `egovio/*` images.

**Complaint path in one line:** UI → nginx → Kong (token check + RBAC) → `pgr-services` → synchronous calls to MDMS, boundary, user, idgen and workflow → Kafka `save-pgr-request` → `egov-persister` writes Postgres → `NotificationService` emits `complaints.domain.events` → `novu-bridge` → Novu → SMS / email / WhatsApp.

## 2. Repository structure

| Folder | What it is | Built here? |
|---|---|---|
| `backend/pgr-services/` | Complaint service, Java 17, Spring Boot 3.2.2. Also onboarding, analytics, escalation, dashboards | yes (`egovio/pgr-services`, `-db`) |
| `backend/novu-bridge/` | Notification router: Kafka → Novu, per-tenant Novu accounts | yes |
| `backend/digit-config-service/` | Schema-validated, tenant-scoped config store with a resolve API | yes |
| `backend/digit-user-preferences-service/` | Per-user channel, language and consent | yes |
| `backend/identity-bff/` | Browser session boundary between Keycloak and DIGIT users (TypeScript, Express 5, Redis) | yes |
| `backend/xstate-chatbot/` | WhatsApp chatbot (Node, XState) | yes |
| `backend/novu-worker-providers/` | JS shims adding SMSCountry, Jasmin and Ozeki to the stock Novu 2.3.0 worker | mounted at runtime |
| `keycloak/` | Realm config script, Keycloak 26.7.3 image with magic-link, login themes | yes (`identity-keycloak`) |
| `configurator/` | DIGIT Studio admin console (React 19, Vite, react-admin core) | yes |
| `digit-ui-esbuild/` | Citizen and employee UI served in every deploy (React 17). The PGR screens come from `products/pgr/src`: `esbuild.build.js:121` aliases `@egovernments/digit-ui-module-pgr` to it, so the upstream `packages/modules/pgr` is not built | yes |
| `digit-mcp/` | MCP server with 70 tools in 15 groups; `@digit-mcp/data-provider` | yes |
| `turbopass/` | Boundary search (NestJS) over Overture / geoBoundaries data | yes (separate workflow) |
| `frontend/micro-ui/` | Legacy webpack UI. Still built as image `digit-ui` by `build/build-config.yml` but not deployed | legacy |
| `digit-ui-v2/` | **No tracked files.** `local-setup/ansible/playbook-deploy.yml:181-192` says the app was removed. CLAUDE.md is out of date on this | removed |
| `configs/` | egov-persister and egov-indexer YAML (byte-identical copies under `local-setup/configs/`) | config |
| `local-setup/` | Docker Compose stack, Kong, nginx, seeds, Ansible deploy, Tiltfiles, monitoring | deploy |
| `devops/deploy-as-code/` | Helmfile + charts for Kubernetes; `devops/infra-as-code/` Terraform | deploy |
| `utilities/` | `default-data-handler` (MDMS / localization seeds), `crs_dataloader` (spreadsheet loaders) | tools |
| `tests/integration-tests/` | Canonical Playwright end-to-end suite | tests |
| `build/`, `.github/workflows/` | Image catalog and CI | CI |

## 3. Major components

| Component | Role | Key evidence |
|---|---|---|
| `RequestsApiController` | Complaint APIs: `_create`, `_update`, `_search`, `_count`, `_plainsearch`, inbox, dashboard | `$P/web/controllers/RequestsApiController.java:29-161` |
| `PGRService` (629 lines, 15 collaborators) | Hub of the complaint domain | `$P/service/PGRService.java:74-100` |
| `WorkflowService` | Calls egov-workflow-v2; `applicationStatus` is always copied from the workflow response | `WorkflowService.java:68-75, 243-250` |
| `ServiceRequestValidator` | Source, boundary, MDMS, department, assignee and reopen rules | `$P/validator/ServiceRequestValidator.java` |
| `EnrichmentService` / `UserService` | IDs, audit, citizen lookup or creation | `EnrichmentService.java:55-123`, `UserService.java:46-109` |
| `EscalationService`, `EscalationScheduler`, `EscalationLockManager` | Manual and automatic escalation to the HRMS `reportingTo` | `EscalationService.java:117-171`, `EscalationScheduler.java:71` |
| `SearchAccessPolicyService`, `PolicyDrivenScopeResolver` | Record-level ABAC on search: SQL scope + JsonLogic filter | `SearchAccessPolicyService.java:98-151` |
| `VisibilityService` | MINE / TEAM inbox from the HRMS reporting tree | `VisibilityService.java:79-138` |
| `NotificationService` + `ThinEventBuilder` | Turns persisted save/update events into thin domain events | `NotificationService.java:131-165`, `ThinEventBuilder.java:65-131` |
| Onboarding (`OnboardingRunner`, `OnboardingSteps`, `WorkspaceService`) | Self-serve workspace provisioning saga | `OnboardingRunner.java:25-29`, `OnboardingProvisionerClient.java:67-92` |
| Analytics (`AnalyticsController`, `AnalyticsService`, `KpiCatalogService`) | KPI queries over materialized views, public dashboard | `$P/analytics/AnalyticsController.java:39-416` |
| novu-bridge | Consumes domain and SMS events, routes by `NOTIFICATIONS.*` masters, sends through Novu, logs to `nb_dispatch_log` | `consumer/DomainEventConsumer.java:56-112` |
| identity-bff | OIDC with Keycloak, Redis sessions, DIGIT token minting, onboarding internals | `backend/identity-bff/src/contract/routes.ts` |
| Kong | Routing; global Lua pre-function for token resolution and RBAC | `local-setup/kong/kong.yml:100-600` |

## 4. Business capabilities

| Capability | Where | Notes |
|---|---|---|
| File a complaint (web, WhatsApp, on behalf of a citizen) | `PGRService#create`; chatbot `egov-pgr.js:910` | Allowed sources: `whatsapp,web,mobile,RB Bot` (`props:141`) |
| Classify by complaint type, department and SLA | MDMS `RAINMAKER-PGR.ComplaintHierarchy` leaf rows (`department`, `slaHours`) | `ServiceDefs` is retired (`V20260731000000__repoint_grain_mvs_to_complainthierarchy.sql`) |
| Route, assign, reassign, resolve, reject | egov-workflow-v2 business service `PGR` | Roles enforced by workflow, not pgr-services |
| Escalate on SLA breach | `EscalationScheduler` | Off by default (`pgr.escalation.enabled=false`, `props:177`) |
| Reopen within a window, rate the outcome | `ServiceRequestValidator#validateReOpen`; RATE via generic update | Window from MDMS `UIConstants.REOPENSLA`, fallback 72h |
| Notify citizens and employees per workspace | `NotificationService` → novu-bridge → Novu | Templates and routing in `NOTIFICATIONS.*` masters |
| Restrict who sees which complaints | ABAC scope on search; inbox MINE/TEAM | Visibility off by default (`props:216`) |
| Dashboards and analytics, including public | `DashboardService`, `AnalyticsService` | MVs refreshed every 5 min (`props:188-189`) |
| Self-serve workspace onboarding | `/v2/onboarding/*`, identity-bff, novu-bridge | Steps listed in §6.7 |

## 5. Business workflow: the complaint lifecycle

Diagram: [`business-workflows.mmd`](business-workflows.mmd).

### 5.1 State machine (business service `PGR`)

Source: `local-setup/dataloader/templates/PgrWorkflowConfig.json`. The same graph also lives in `utilities/default-data-handler/src/main/resources/PgrWorkflowConfig.json`, `utilities/crs_dataloader/templates/PgrWorkflowConfig.json` and `backend/pgr-services/src/main/resources/onboarding/platform-baseline-v1.json` (key `workflow`). `businessServiceSla` = 432000000 ms (5 days).

| State | Action → next state [roles] |
|---|---|
| *(start)* | APPLY → PENDINGFORASSIGNMENT [CITIZEN, CSR] |
| PENDINGFORASSIGNMENT | ASSIGN → PENDINGATLME [GRO, PGR_VIEWER]; REJECT → REJECTED [GRO, PGR_VIEWER]; COMMENT → self [CITIZEN] |
| PENDINGFORREASSIGNMENT | ASSIGN → PENDINGATLME; REJECT → REJECTED [GRO, PGR_VIEWER]; COMMENT → self |
| PENDINGATLME | RESOLVE → RESOLVED; REASSIGN → PENDINGFORREASSIGNMENT [PGR_LME, PGR_VIEWER]; ESCALATE → self [PGR_LME, PGR_VIEWER, SYSTEM]; COMMENT → self |
| RESOLVED | RATE → CLOSEDAFTERRESOLUTION [CFC, CITIZEN]; REOPEN → PENDINGFORASSIGNMENT [CFC, CITIZEN, CSR, PGR_VIEWER]; COMMENT → self |
| REJECTED | RATE → CLOSEDAFTERREJECTION [CFC, CITIZEN]; REOPEN → PENDINGFORASSIGNMENT; COMMENT → self |
| CLOSEDAFTERRESOLUTION, CLOSEDAFTERREJECTION, CANCELLED | terminal; no action leads to CANCELLED |

### 5.2 Lifecycle steps

| # | Step | Trigger API → controller | Business methods | DB | Kafka | External calls | Transition | Roles |
|---|---|---|---|---|---|---|---|---|
| 1 | Registration | `POST /v2/request/_create` → `requestsCreatePost` | `PGRService#create` (`:108-154`) | persister INSERT into `eg_pgr_service_v2`, `eg_pgr_address_v2`, `eg_pgr_document_v2` | `save-pgr-request`, `inbox-pgr-events` | MDMS, boundary, egov-user, idgen, enc (extended attributes), workflow | → PENDINGFORASSIGNMENT | CITIZEN, CSR |
| 2 | Validation | (inside 1 and 3) | `ServiceRequestValidator#validateCreate` (`:60-69`), `#validateUpdate` (`:77-117`) | reads persisted record on update | – | boundary `/boundary/_search`; HRMS on update | – | – |
| 3 | Acknowledgement | `NotificationConsumer#listen` on save/update topics | `NotificationService#process`, `ThinEventBuilder#build` | – | → `complaints.domain.events` | workflow, egov-user, HRMS, MDMS, url-shortener | – | – |
| 4 | Assignment | `POST /v2/request/_update` ASSIGN | `validateAssignee` (`:183-194`), `validateDepartment` (`:201-246`), `EscalationService#prepareUpdate` | persister UPDATE | `update-pgr-request`, `inbox-pgr-events` | HRMS, workflow | → PENDINGATLME | GRO, PGR_VIEWER |
| 5 | Processing / comments | `_update` COMMENT or REASSIGN | generic `updateInternal` (`:250-311`) | UPDATE refreshes `lastmodifiedtime` | update topics | workflow | self or → PENDINGFORREASSIGNMENT | CITIZEN; PGR_LME |
| 6 | Status updates | every `_update` | `WorkflowService#updateWorkflowStatus` | UPDATE `applicationstatus` | update topics | workflow `_transition` | per action | per action |
| 7 | Escalation | `_update` ESCALATE, or `EscalationScheduler#scanAndEscalate` | `EscalationService#prepareEscalation` (`:117-171`), `EscalationLockManager` | advisory lock + UPDATE | + `pgr-escalation-events` | HRMS `reportingTo`, workflow history | PENDINGATLME self-loop | PGR_LME, PGR_VIEWER, SYSTEM |
| 8 | SLA monitoring | scheduler (5 min); search `sortBy=sla` | `MDMSUtils#getServiceCodeToSlaMillis` (`:110-170`), `EscalationConfigurationService#resolve` | MV columns `sla_target_ms`, `sla_breached` | – | MDMS | – | – |
| 9 | Resolution | `_update` RESOLVE | generic update | UPDATE | update topics | workflow | → RESOLVED | PGR_LME, PGR_VIEWER |
| 10 | Feedback | `_update` RATE with `service.rating` (1–5, `Service.java:68-71`) | generic update | UPDATE `rating` | update topics | workflow | → CLOSEDAFTER* | CFC, CITIZEN |
| 11 | Reopen | `_update` REOPEN | `ServiceRequestValidator#validateReOpen` (`:264-286`) | UPDATE | update topics | MDMS `REOPENSLA` | → PENDINGFORASSIGNMENT | CFC, CITIZEN, CSR, PGR_VIEWER |
| 12 | Notifications | novu-bridge `DomainEventConsumer#listen` | `ThinEventPipelineService#process` | `nb_dispatch_log` | consumes `complaints.domain.events` | MDMS `NOTIFICATIONS.*`, localization, user-preferences, egov-user, Novu | – | – |

## 6. API interactions

Diagram: [`api-dependencies.mmd`](api-dependencies.mmd). There are 30 endpoints in 6 controllers, all under `/pgr-services`.

| Method + path | Handler | Auth in code | Main dependencies |
|---|---|---|---|
| POST `/v2/request/_create` | `RequestsApiController#requestsCreatePost` | none (Kong + workflow roles) | `PGRService#create` |
| POST `/v2/request/_update` | `#requestsUpdatePost` | REOPEN owner check only | `PGRService#update` |
| POST `/v2/request/_search` | `#requestsSearchPost` | per-user-type params; citizen pinned to self; ABAC scope | `PGRService#search`, `#getDynamicData` |
| POST `/v2/request/_count` | `#requestsCountPost` | same scope as search, no Tier-2 filter | `PGRService#count` |
| POST `/v2/request/_plainsearch` | `#requestsPlainSearchPost` | **no record or field scoping** | `PGRService#plainSearch` |
| POST `/v2/request/inbox/_search`, `/_count` | `#inboxSearchPost`, `#inboxCountPost` | needs visibility flags + user uuid | `VisibilityService#resolve` |
| GET `/v2/dashboard` | `#dashboard` | **none; `Cache-Control: public`** | `DashboardService#getDashboardData` |
| POST `/v2/employee/_context` | `EmployeeContextController#context` | EMPLOYEE only | `EmployeeContextService` → HRMS |
| POST `/v2/analytics/*` (10, 4 anonymous) | `AnalyticsController` | capability grants via accesscontrol; public routes gated by MDMS flag | `AnalyticsService`, `KpiCatalogService` |
| POST `/v2/onboarding/*` (7) | `OnboardingApiController` | session cookie introspected at identity-bff | `OnboardingService` |
| POST `/v2/onboarding/workspaces/*` (3) | `WorkspaceApiController` | `ACCOUNT_ADMIN` for the tenant via `/user/_details` | `WorkspaceService`, `WorkspaceGateway` |
| POST `/migration/_transform` | `MigrationController` | none; bean only if `migration.enabled=true` | `MigrationService` |

**Request-to-response for `_create`:** controller → `MDMSUtils#mDMSCall` → `validateCreate` (boundary HTTP) → `enrichCreateRequest` (user search/create, idgen) → department into `additionalDetail` → optional extended-attribute encryption → `WorkflowService#updateWorkflowStatus` (HTTP `_transition`) → `Producer#push` to `save-pgr-request` and `inbox-pgr-events` → `ServiceResponse` returned. The row is written later by egov-persister.

**Other first-party APIs:** novu-bridge exposes 34 endpoints under `/novu-bridge/novu-adapter/v1/*`; identity-bff about 35 under `/identity/v1/*` and `/internal/identity/v1/*`; config-service 4 under `/config-service/config/v1/*`; user-preferences 2 under `/user-preference/v1/*`; xstate-chatbot 4 webhooks; turbopass 5 under `/boundary/*`.

**Contract files:** `backend/pgr-services/swagger-contract.yml` documents `/requests/*` paths that do not exist (the real paths are `/request/*`). `OpenAPI-PGR-Requests.yaml` covers only the 5 core request endpoints. novu-bridge publishes an OpenAPI contract at `/novu-adapter/v1/contract/openapi`.

## 7. Database interactions

Diagram: [`data-model.mmd`](data-model.mmd).

| Table / view | Owner | Written by | Read by |
|---|---|---|---|
| `eg_pgr_service_v2`, `eg_pgr_address_v2`, `eg_pgr_document_v2` | pgr-services (Flyway) | **egov-persister only**, from `save-pgr-request` / `update-pgr-request` (`configs/egov-persister/pgr-services-persister.yml:16,51,100,139,169`) | `PGRRepository` via `PGRQueryBuilder.java:40-42`; dashboard; MVs |
| `eg_pgr_hrms_projection` | pgr-services | `HrmsProjectionRepository` from `save/update-hrms-employee` | `VisibilityService` (recursive CTE) |
| `complaint_facts`, `complaint_events` (MVs), `complaint_open_state_daily`, `pgr_mv_*` | pgr-services | `DashboardRefreshScheduler` (refresh + daily insert) | `AnalyticsService`, `DashboardRepository` |
| `eg_pgr_onboarding_*` (7 tables) | pgr-services | `OnboardingRepository`, `WorkspaceRepository` | same |
| `nb_dispatch_log`, `nb_tenant_account` | novu-bridge | `DispatchLogRepository`, `TenantAccountRepository` | same |
| `user_preference` | user-preferences | `PreferenceRepository` | same; read by novu-bridge over HTTP |
| `eg_config_data` | config-service | `ConfigDataRepository` | same |
| `eg_chat_state_v2` | xstate-chatbot | `postgres-repo.js` | same |
| `eg_wf_*`, `eg_user`, `eg_hrms_*`, `eg_mdms_data`, `boundary_*` | DIGIT core | platform services / persister | **also read directly by pgr MVs and `DashboardQueryBuilder`** |

**Only three real foreign keys** exist in the complaint core: address → service, document → service, and the onboarding child tables. Every cross-service link (citizen, workflow, boundary, complaint type, assignee) is logical only.

**Master data:** `RAINMAKER-PGR.ComplaintHierarchy` (+ `ComplaintHierarchyDefinition`), `EscalationConfig`, `UIConstants`, `InboxVisibilityConfig`, `ComplaintTemplateType`/`ComplaintExtendedAttributeSchema`, `common-masters.Department`/`Designation`, `NOTIFICATIONS.*`, `ACCESSCONTROL-*`, `tenant.tenants`, `dss.*`. Seeds live in `utilities/default-data-handler/src/main/resources/{schema,mdmsData,mdmsData-dev}` and in `platform-baseline-v1.json`.

## 8. Integration points

Diagram: [`integrations.mmd`](integrations.mmd).

### 8.1 Kafka topics

| Topic | Producer | Consumers |
|---|---|---|
| `save-pgr-request` | pgr-services `PGRService#create` (`props:113`) | egov-persister, egov-indexer, pgr `NotificationConsumer` |
| `update-pgr-request` | pgr-services `#updateInternal` (`props:114`) | egov-persister, egov-indexer, pgr `NotificationConsumer`, xstate-chatbot |
| `inbox-pgr-events` | pgr-services (`props:118-119`) | egov-indexer → ES `inbox-pgr-services` |
| `complaints.domain.events` | pgr `NotificationService#process` (`props:120`) | novu-bridge `DomainEventConsumer` |
| `pgr-escalation-events` | pgr-services on ESCALATE (`props:185`) | **none in repo** |
| `save-hrms-employee`, `update-hrms-employee` | egov-hrms | egov-persister, pgr `HrmsProjectionConsumer` |
| `egov.core.notification.sms` | user-otp | novu-bridge `CoreSmsConsumer` |
| `egov.core.notification.email` | user-otp | **none** (no mail service deployed) |
| `notifications.events` | **none in repo** | novu-bridge |
| `novu-bridge.dlq` | novu-bridge | **none** |
| `save-pgr-request-batch`, `save-wf-transitions-batch` | pgr `MigrationService` | egov-persister |

### 8.2 DIGIT core services used by pgr-services

egov-workflow-v2 (transition, process search, business-service search), mdms (v1 `_search`, v2 for onboarding), egov-user (search, create, update, `_details`, oauth), boundary-service (boundary and relationship search), egov-hrms (employee search), egov-idgen, egov-enc-service, egov-accesscontrol (`/access/v1/actions/mdms/_get`), egov-url-shortening, egov-localization (onboarding). Property keys are in `props:47-211`.

### 8.3 Authentication and authorization

- **Kong** resolves `RequestInfo.authToken` through `egov-user-proxy:8107/user/_details` on every authenticated request and checks action RBAC with `/access/v1/actions/_authorize` (`kong.yml:346-348, 420-435, 503-562`).
- **identity-bff** handles browser sign-in with Keycloak (OIDC, admin API, magic link) and mints DIGIT tokens. Sessions are kept in Redis behind per-surface cookies.
- **pgr-services** adds ABAC search scoping and workflow role checks. In-code ownership checks cover REOPEN only.
- **Kubernetes** uses the DIGIT Spring `gateway` chart instead of Kong. `.github/workflows/gateway-whitelist-parity.yml` keeps the whitelists in step.

### 8.4 External systems

Novu 2.3.0 (+ MongoDB); Twilio, SMSCountry, Jasmin, Ozeki, SMTP; Kaleyra and ValueFirst for WhatsApp; Google and GitHub OAuth; Google Maps and OSM tiles; Overture, Overpass, geoBoundaries and Geoapify (turbopass); Matomo and PostHog; OTel → Tempo, Loki, Prometheus, Grafana; OpenBao for deploy-time secrets.

## 9. Dependency explanations

Diagram: [`module-dependencies.mmd`](module-dependencies.mmd).

- **Java:** five independent Spring Boot services with no Maven dependencies on each other. pgr-services and novu-bridge use `org.egov.services:tracer 2.9.0-SNAPSHOT` (brings Kafka); pgr-services also uses `org.egov:mdms-client 2.9.0-SNAPSHOT` and `json-logic-java` for ABAC.
- **Node:** configurator depends on its **own vendored copy** of `@digit-mcp/data-provider` (`configurator/packages/data-provider`, `file:` + Vite alias). It has diverged from `digit-mcp/packages/data-provider` in 7 files. configurator is the only importer of `ui-shared/featureFlags.ts`. digit-mcp copies `platform-baseline-v1.json` from pgr-services at prebuild.
- **Verified cycles:**
  - `digit-ui-esbuild`: `react-components` ↔ `digit-ui-components` (`react-components/src/atoms/SearchComponent.js:9`, `hoc/InboxSearchComposer.js:2` ↔ `digit-ui-components/src/hoc/UploadAndDownloadDocumentHandler.js:12`).
  - Both `data-provider` packages list themselves as a dependency.
- **Runtime coupling (not compile-time):** pgr-services ↔ identity-bff and pgr-services ↔ novu-bridge during onboarding; identity-bff → novu-bridge for email; xstate-chatbot → pgr-services (create) and pgr-services → chatbot (`update-pgr-request`).
- **Infrastructure:**
  - Compose base `local-setup/docker-compose.egov-digit.yaml` (55 services), plus `docker-compose.migrations.yml` (Flyway `-db` containers), monitoring, matomo, opensre and optional fast-path / per-tenant overlays, all layered by Ansible (`playbook-deploy.yml` ~L2631-2643).
  - Helm: `digit-helmfile.yaml` → backbone, core, common, identity, urban, analytics, auxiliary and monitoring sub-helmfiles, using the shared `charts/common` library chart.
  - CI: `build/build-config.yml` lists 17 images, published by `build-images.yml` and `release-build.yml`.

---

## 10. Architectural insights

### 10.1 Observed facts

**Critical services**
1. `pgr-services` is the hub. `PGRService` has 15 collaborators, and every create or update synchronously depends on MDMS, egov-user, workflow and (on create) boundary and idgen (`PGRService.java:74-100`).
2. `egov-user` is on the auth path of every request. Kong, novu-bridge `ProxyAuthFilter`, identity-bff and pgr-services all call it.
3. `egov-workflow-v2` is the source of truth for status and assignee. `eg_pgr_service_v2` has no assignee column, and `applicationStatus` is copied from the workflow response (`WorkflowService.java:72`).

**High-dependency modules**
4. `ServiceRequestRepository` and `MDMSUtils` are choke points for about 40 outbound call sites. `ServiceRequestRepository#fetchResult` returns `null` on non-4xx errors and the shared RestTemplate has no timeouts (`ServiceRequestRepository.java:67-80`).

**Single points of failure (Compose tier)**
5. One Postgres behind one PgBouncer serves every service (`docker-compose.egov-digit.yaml` L333-362).
6. One Redpanda broker (`--smp 1`, 256M) with **no volume**, so Kafka data is lost when the container is recreated.
7. Redis, Elasticsearch, Kong and MinIO are single instances. On Kubernetes most services run `replicas: 1` and Postgres is expected to be external.

**Consistency and coupling**
8. **Split write.** The workflow transition is synchronous HTTP, but the complaint row is written later by egov-persister. `Producer#push` sends with no key and no callback, and producer retries are 0 (`Producer.java:25`, `props:24`). (INFERRED) A failed Kafka send after a successful transition leaves workflow and `eg_pgr_service_v2` out of step.
9. **Shared-database coupling.** The pgr MVs and `DashboardQueryBuilder` read workflow, user, MDMS and boundary tables directly. A platform schema change can break CMS analytics.
10. **Workflow definition in four copies** (three template JSONs with different hashes, plus `platform-baseline-v1.json`).

**Duplicated logic**
11. Four or five DIGIT API clients or endpoint maps: digit-mcp data-provider, configurator's vendored copy, configurator `src/api/client.ts`, digit-ui-esbuild `urls.js`, xstate `env-variables.js`.
12. In pgr-services: the SYSTEM `RequestInfo` builder (`EscalationScheduler` vs `HrmsProjectionService`); the workflow URL builder (`WorkflowService` vs `MigrationUtils`); the search/count preamble (`PGRService.java:174-185` vs `:343-358`).

12a. **The SLA is calculated in five independent places:** `MDMSUtils` (search sort), the escalation ladder, `complaint_facts` SQL, the indexer, and the digit-ui inbox, which carries its own `DEFAULT_SLA_MS = 432000000`. The onboarding default is 72 h, while the backend default is 5 days. See [impact scenario 4](impact/README.md#4-the-sla-calculation-changes).
12b. **State names are part of the notification contract.** The event name is `COMPLAINTS.WORKFLOW.<ACTION>.<STATE>`, and novu-bridge routes on that exact string, so renaming a state also changes the seeded `NOTIFICATIONS.*` masters. 48 test files hard-code state names. See [impact scenario 1](impact/README.md#1-the-complaint-status-model-changes).

**Scalability bottlenecks**
13. Every `_search` runs 2 extra aggregate SQL queries and returns a hard-coded complaint-type count of `13` (`props:167`). Every create or update makes an extra business-service lookup (`WorkflowService.java:189`). The TEAM inbox makes up to 25 sequential workflow calls (`props:226`).
14. Three schedulers (escalation, dashboard MV refresh, HRMS projection rebuild) run on every replica with no leader election. Escalation relies on a per-complaint advisory lock.
15. The Tier-2 ABAC filter runs **after** SQL `LIMIT/OFFSET`, and `_count` skips it (`PGRService.java:189-194, 361`). Pages can come back short, and counts can disagree with search results.

**Correctness and security observations**
16. The update persister mapping has no `eg_pgr_document_v2` insert, although update enrichment assigns IDs to new documents. (INFERRED) Documents added on update are not saved.
17. `_plainsearch` has no record or field scoping. `GET /v2/dashboard` needs no `RequestInfo` and is publicly cacheable.
18. RATE and COMMENT have no complainant-ownership check in pgr-services. (INFERRED) A citizen COMMENT on a resolved complaint refreshes `lastmodifiedtime` and so extends the reopen window.
19. Orphan topics: `pgr-escalation-events`, `novu-bridge.dlq`, `egov.core.notification.email` (no consumer) and `notifications.events` (no producer). novu-bridge preference checks fail open (`novu.bridge.preference.fail.open=true`).
20. `digit-config-service` has no Kong route, and novu-bridge does not call it despite a compose comment saying so. Its only caller is a gated profile-page call in digit-ui-esbuild.

**Drift between deploy paths**
21. On `master`, Helm and Compose pin different tags for egov-user, mdms-v2, egov-accesscontrol, egov-hrms, egov-bndry-mgmnt and user-otp (fix proposed in PR #2762). Kong (Compose) and the Spring gateway (Kubernetes) are different products.
22. Build drift: Spring Boot 3.2.2 vs 3.3.3; two Postgres driver versions; Flyway 9 library vs 10 migrator images; SNAPSHOT eGov libraries; `@anthropic-ai/claude-agent-sdk@latest` unpinned; React 16 to 19; Node 14 base images in digit-ui-esbuild sub-packages.
23. No pull-request workflow runs Java unit tests. Maven runs only inside image builds (`build/maven/Dockerfile`).

**Documentation gaps**
24. `swagger-contract.yml` uses non-existent `/requests/*` paths. No contract covers inbox, dashboard, analytics, employee context, onboarding or workspace APIs.
25. CLAUDE.md still describes `digit-ui-v2` as being rolled in, and `local-setup/db/notif-mdms-seed/README.md` describes a config-service path novu-bridge no longer uses.
26. Several behaviour-changing defaults are not documented in one place: escalation off, visibility off, Flyway off in-app, department validation on create off, ABAC strict mode off, onboarding runner on.

### 10.2 Recommendations (suggestions, not facts)

| Priority | Recommendation | Addresses |
|---|---|---|
| High | Make the complaint write reliable: add a Kafka send callback with retries, or an outbox table written in the same transaction as a local status record; reconcile workflow vs `eg_pgr_service_v2` periodically | 8 |
| High | Add the missing document insert to the `update-pgr-request` persister mapping, with a test | 16 |
| High | Decide whether `_plainsearch` and `GET /v2/dashboard` should be public; if not, require auth at Kong and in the controller | 17 |
| High | Add complainant-ownership checks for RATE and COMMENT, and measure the reopen window from the RESOLVED/REJECTED transition time rather than `lastModifiedTime` | 18 |
| High | Add a PR workflow that runs `mvn test` for the five Java services | 23 |
| Medium | Throw a typed error from `ServiceRequestRepository#fetchResult` and set RestTemplate connect/read timeouts | 4 |
| Medium | Give Redpanda a volume, and document HA expectations (Postgres, Kafka, Redis) per deploy tier | 5–7 |
| Medium | Add leader election (for example ShedLock) to the three schedulers | 14 |
| Medium | Apply the Tier-2 ABAC filter before pagination, or fold it into SQL; apply the same rules to `_count` | 15 |
| Medium | Either add consumers for the orphan topics (at least a DLQ replay tool) or stop producing them; route email OTPs through novu-bridge | 19 |
| Medium | Keep one workflow definition and generate the other copies; merge PR #2762 and add a CI check for Compose/Helm image parity | 10, 21 |
| Medium | Replace direct reads of platform tables in MVs with an event-fed read model, or version the dependency explicitly | 9 |
| Low | Converge on one DIGIT API client package (publish `@digit-mcp/data-provider` once and consume it everywhere); break the esbuild component cycle | 11, cycles |
| Low | Cache the PGR business service; compute the complaint-type count; batch TEAM inbox workflow calls | 13 |
| Low | Fix `swagger-contract.yml`, publish an OpenAPI file for all 30 endpoints, update CLAUDE.md and the notif-mdms-seed README, and document the behaviour flags | 24–26 |

## 11. Questions this graph answers

| Question | Where to look |
|---|---|
| What are the major components? | §2, §3, `system-architecture.mmd` |
| How does a complaint flow through the system? | §5, `business-workflows.mmd` |
| Which APIs trigger which business operations? | §6, `api-dependencies.mmd` |
| Which services touch which tables? | §7, `data-model.mmd` |
| Where are Kafka events published and consumed? | §8.1, `integrations.mmd` |
| Which DIGIT core services are integrated? | §8.2, `system-architecture.mmd` |
| What are the internal and external dependencies? | §9, `module-dependencies.mmd` |
| What breaks if I change module X? | Run `node knowledge-graph/impact/impact.mjs <id>`. Worked examples for status model, Kafka topics, DIGIT core APIs and SLA are in [`impact/README.md`](impact/README.md#worked-scenarios) |

## 12. Keeping it current

The impact graph keeps itself honest: `node knowledge-graph/impact/validate.mjs` re-checks every relationship's evidence line against the source and fails when code drifts. Add it to CI. Update a module's `impact/graph/<module>.json` when that module changes, then regenerate with `impact/scenarios/generate.sh` and `impact/layers.mjs`.

The hand-drawn diagrams are not validated automatically. Re-check these sources when they change: `RequestsApiController` and other controllers, `application.properties` topic and host keys, `configs/egov-persister/*.yml`, Flyway migrations, `PgrWorkflowConfig.json`, `local-setup/kong/kong.yml`, `docker-compose.egov-digit.yaml`, the helmfiles and `build/build-config.yml`. Render-check with `npx -p @mermaid-js/mermaid-cli mmdc -i <file>.mmd -o /tmp/out.svg`.
