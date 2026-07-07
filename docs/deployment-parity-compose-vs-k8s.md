# Deployment Parity: Ansible/Compose vs Kubernetes (deploy-as-code)

**Status: 🚧 Living document — updated as the parity test progresses.**

Comparing the two ways CCRS/DIGIT is deployed:

| | Stack | Orchestrator | Gateway | Infra | Comments |
|---|---|---|---|---|---|
| **Compose** | `local-setup/` | Ansible → `docker compose` | Kong | all in-container (single box) | dev/demo + some single-node prod tenants |
| **K8s** | `devops/deploy-as-code/` | Helmfile → Helm | Spring-Cloud `gateway` | EKS + managed RDS/S3 | multi-node production on AWS |

Both share the **same ~24 `egov-*` microservice core**. Parity is meaningful at the **application layer**; the **platform layer** is intentionally different.

## Progress tracker

| Area | Item | Status | Verdict / Comments |
|---|---|---|---|
| Gateway | OTP (`/user-otp`, `/otp`) | ✅ | Not at parity by default (compose mocks); fine for dev, enable real for prod |
| Gateway | `/egov-location` | ✅ | Modern boundary ✅; legacy egov-location a K8s gap |
| Gateway | `/egov-user-event` | ✅ | In-app feed mocked on compose / real on K8s |
| Gateway | Auth enforcement | ✅ | Different model (authn + RBAC on K8s only); security note tracked separately |
| Gateway | `/health/*` | ✅ | Mechanism difference, not a functional gap |
| Config | Tenant-identity model | ✅ | Not at parity structurally; benign on `pg`, latent risk otherwise |
| Config | Feature toggles | ✅ | Match where explicit on both |
| Services | K8s-only services | ✅ | Optional/feature-adjacent, not core-PGR |
| Data | Bootstrap parity | ✅ | Different mechanism (dump vs migrations) |
| Infra | Secrets model | ✅ | Different backend + key origin (not portable) |

## Platform dimensions

| Dimension | Compose (Ansible) | Kubernetes | At parity? | Comments |
|---|---|---|---|---|
| Orchestrator | Ansible → `docker compose` | Helmfile → Helm | intentional diff | both idempotent; different ops skill sets |
| Unit of deploy | 1 host per tenant (`host_vars`) | 1 cluster per env (`env.yaml`) | intentional diff | compose = per-tenant isolation; K8s = shared multi-tenant cluster |
| API gateway | Kong | Spring-Cloud `gateway` | ❌ different | biggest app-layer divergence — see gateway table |
| Edge/TLS | certbot + host nginx | cert-manager + ingress-nginx | intentional diff | manual-ish renew vs auto cert rotation |
| Postgres | in-container + `db_fast_path` dump | external RDS (`postgresql` chart off) | intentional diff | compose fast but ephemeral; K8s durable/managed/backed-up |
| Object store | in-container MinIO | external S3 (`minio` chart off) | intentional diff | same trade-off as Postgres |
| Kafka | Redpanda | `kafka-kraft` | ✅ equivalent | Redpanda is Kafka-API compatible |
| Secrets | OpenBao (per-host) | SOPS + AWS-KMS | ❌ different | no shared source of truth — see secrets table |
| Health/observability | Docker healthchecks + Gatus + OTEL (default on) | kubelet probes + Prometheus (opt-in) | intentional diff | compose more visible OOTB; K8s needs monitoring helmfile enabled |

> Structural note: **`Kong ≈ ingress-nginx + gateway`** — compose collapses edge + API into Kong (+ host nginx); K8s splits them.

## Gateway parity — route by route

| Route / concern | Compose (Kong) | K8s (Spring gateway) | Parity | Comments |
|---|---|---|---|---|
| `/mdms-v2`, `/user`, `/egov-*` core APIs | routed to service | routed to service (zuul discovery) | ✅ | same path→service on both |
| `/user-otp`, `/otp` | **mocked** (canned 200); real via `otp` profile + de-mock Kong + real SMS provider | real OTP services | ❌ default | compose fine for dev; enable real for prod |
| `/egov-location` (modern `/boundary-service/*`) | routed to boundary-service | routed to boundary-service | ✅ | what CCRS actually uses |
| `/egov-location` (legacy API) | **Kong Lua adapter** → boundary-service + reshape | no service, dangling refs | ❌ K8s gap | K8s would break PGR ward selector / configurator / MCP — migrate callers to boundary-service |
| `/egov-user-event` (in-app feed) | **mocked empty** (service not deployed) | real service | ❌ (compose gap) | notif bell empty on compose; deploy the service for parity. K8s's `.staging` service-host ref is **dead config, not a break** (gateway routes via k8s discovery) |
| Novu notifications | real (behind `notifications` profile) | real | ✅ | opt-in flag on both |
| Auth — **authentication** | none (forwards to service) | validates token → 401 | ❌ | compose relies on services failing closed (they do) |
| Auth — **RBAC (role→action)** | none | `egov-accesscontrol` | ❌ | record-level scoping is still a service responsibility (issue #1071) |
| Auth — **userInfo enrich + anti-spoof** | Kong Lua | `AuthCheckFilterHelper` | ✅ | forged `userInfo` in body is stripped on both |
| Auth — **session-expiry re-login** | broken (Kong never emits `InvalidAccessTokenException`) | works | ❌ | compose users see empty screens instead of a re-login prompt |
| `/health/*` | Kong routes + Gatus | kubelet probes + Prometheus | mechanism diff | map any external monitors to K8s probes/Prometheus |

> Fixed-OTP `123456` (`citizen-otp-fixed-enabled`) is enabled on **both** stacks. The auth-enforcement difference has a security implication tracked separately (not in this public doc).

## Service coverage

**Shared core (~24, at parity):** mdms-v2, egov-user, egov-enc-service, egov-accesscontrol, egov-workflow-v2, egov-persister, egov-indexer, egov-filestore, egov-idgen, egov-localization, egov-otp, user-otp, egov-url-shortening, egov-notification-sms, boundary-service, egov-hrms, egov-user-event, digit-config-service, digit-user-preferences-service, novu-bridge, pgr-services, default-data-handler, digit-ui, egov-bndry-mgmnt, inbox.

**K8s-only** (deployed on K8s, absent from compose):

| Service | Purpose | Core-PGR? | Comments |
|---|---|---|---|
| `audit-service` | audit-trail query API | no | audit still *captured* on compose via persister; only query API absent |
| `pdf-service` | PDF generation (receipts) | no | optional; add if you need downloadable complaint PDFs |
| `egov-notification-mail` | email channel | no | compose covers notifications via SMS + Novu |
| `service-request` | generic service-request registry | no | not used by core PGR v2 |
| `boundary-bulk-bff` | bulk-boundary BFF | no | compose onboards boundaries via MCP/configurator |
| `dashboard-analytics`, `dashboard-ingest` (DSS) | analytics dashboards | no | separate analytics stack; port only if dashboards are needed |

**Compose-only:** Kong, digit-mcp, Keycloak + token-exchange, configurator, Jupyter, Gatus, OpenBao, OTEL tracing (tempo/promtail).

> K8s-only services are **optional / feature-adjacent** — the core complaint lifecycle works without them (compose runs lean and passes the PGR lifecycle test). (`user-onboard`, `xstate-chatbot` charts exist but are not enabled on K8s either.)

## Config parity

### Tenant identity — ❌ not at parity (structurally)

| Aspect | Compose | K8s | Comments |
|---|---|---|---|
| Source of tenant IDs | hardcoded per-service (`pg` / `pg.citya` / `mz`) | single `<tenant_id>` placeholder in `env.yaml` | K8s = one source of truth |
| How normalized | Ansible `replace`/overlay + **deferred** `STATE_LEVEL` rewrites, gated on `enable_mcp` **and** `state_root != 'pg'` | Helm templating, uniform | compose path is fragile / conditional |
| Result | residual drift (`egov-enc-service`, `egov-user-proxy` on `pg.citya`) | consistent by construction | drift observed live; benign on `pg`, risky on other tenants without MCP |

**Recommendation:** derive all tenant vars on compose from the single inventory value, unconditionally.

### Feature toggles

| Aspect | Compose | K8s | Comments |
|---|---|---|---|
| Where set | scattered (compose env + Ansible + `digit.env.j2` + image defaults) | explicit in one `env.yaml` | K8s easier to audit |
| Overlap | matches where explicit on both (e.g. fixed-OTP `123456`) | — | no functional divergence found |
| Non-explicit toggles | inherit image `application.properties` defaults | explicit values | full diff low value — compose intentionally uses defaults |

## Data bootstrap — ❌ different mechanism

| Aspect | Compose | K8s | Comments |
|---|---|---|---|
| Schema | `db_fast_path` loads `db/full-dump.sql` (54 tables + Flyway history + `pg.citest`/CI-ADMIN test tenant + 33 ServiceDefs + 20k localization rows) | per-service Flyway migration (init container), full replay | converges on equivalent schema |
| Seed data | bundled `pg`/`pg.citest` tenant + `user-seed.sh` + optional MCP | `default-data-handler` + `boundary-bulk-bff`; starts empty | different out-of-box data |
| Consequence | fast, deterministic | clean replay | dump is a **maintenance burden**; "works on compose" ≠ clean K8s migration |

## Secrets model — ❌ different backend *and* key origin

| Aspect | Compose | K8s | Comments |
|---|---|---|---|
| Backend | OpenBao (runtime, per-host; seeded `cas=0` → `.env`) | SOPS + AWS-KMS `env-secrets.yaml` (git) → k8s Secrets | no shared source of truth |
| Encryption master key | **inherited from the dump** (`eg_enc_*_keys`, pinned ES master pw) | **generated** from `master_password`/`master_salt`/`master_initialvector` | **data-portability blocker** — keys differ |
| Secret sets | db, user, hrms, notification, keycloak | db, user, hrms, notification, enc keys | mostly overlap; enc-key origin diverges |

> **Data-portability blocker:** the two stacks use different encryption master keys, so data encrypted on one (usernames, PII) is **not decryptable on the other**.

## Overall summary

| Layer | Parity | Items | Comments |
|---|---|---|---|
| **Application** | largely ✅ (few real gaps) | ~24 shared services + core routes | gaps: legacy `/egov-location`, `/egov-user-event` feed, auth model, tenant-config model |
| **Platform** | intentionally different | gateway, secrets, bootstrap, managed infra, K8s-only services | not meant to be identical |
| **Portability blockers** | ⚠️ be aware | encryption master keys; dump-vs-migrations | affect data migration between stacks |

**Realistic parity target:** the application layer + config semantics — not the platform layer.
