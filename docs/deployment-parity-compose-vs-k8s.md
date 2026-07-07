# Deployment Parity: Ansible/Compose vs Kubernetes (deploy-as-code)

**Status: 🚧 Living document — updated as the parity test progresses.**

Comparing the two ways CCRS/DIGIT is deployed:

| | Stack | Orchestrator | Gateway | Infra |
|---|---|---|---|---|
| **Compose** | `local-setup/` | Ansible → `docker compose` | Kong | all in-container (single box) |
| **K8s** | `devops/deploy-as-code/` | Helmfile → Helm | Spring-Cloud `gateway` | EKS + managed RDS/S3 (`terraform/sample-aws`) |

Both share the **same ~24 `egov-*` microservice core**. Parity is meaningful at the **application layer**; the **platform layer** is intentionally different.

## Progress tracker

| Area | Item | Status | Verdict (short) |
|---|---|---|---|
| Gateway | OTP (`/user-otp`, `/otp`) | ✅ | Not at parity by default (compose mocks) |
| Gateway | `/egov-location` | ✅ | Modern boundary ✅; legacy egov-location a K8s gap |
| Gateway | `/egov-user-event` | ✅ | In-app feed mocked on compose / real on K8s |
| Gateway | Auth enforcement | ✅ | Different model (authn + RBAC on K8s only) |
| Gateway | `/health/*` | ✅ | Mechanism difference, not a functional gap |
| Config | Tenant-identity model | ✅ | Not at parity structurally; benign on `pg` |
| Config | Feature toggles | ✅ | Match where explicit on both |
| Services | K8s-only services | ✅ | Optional/feature-adjacent, not core-PGR |
| Data | Bootstrap parity | ✅ | Different mechanism (dump vs migrations) |
| Infra | Secrets model | ✅ | Different backend + key origin (not portable) |

## Platform dimensions

| Dimension | Compose (Ansible) | Kubernetes | At parity? |
|---|---|---|---|
| Orchestrator | Ansible → `docker compose` | Helmfile → Helm | intentional diff |
| Unit of deploy | 1 host per tenant (`host_vars`) | 1 cluster per env (`env.yaml`) | intentional diff |
| API gateway | Kong | Spring-Cloud `gateway` | ❌ different |
| Edge/TLS | certbot + host nginx | cert-manager + ingress-nginx | intentional diff |
| Postgres | in-container + `db_fast_path` dump | external RDS (`postgresql` chart off) | intentional diff |
| Object store | in-container MinIO | external S3 (`minio` chart off) | intentional diff |
| Kafka | Redpanda | `kafka-kraft` | ✅ equivalent |
| Secrets | OpenBao (per-host) | SOPS + AWS-KMS | ❌ different |
| Health/observability | Docker healthchecks + Gatus + OTEL (default on) | kubelet probes + Prometheus (opt-in) | intentional diff |

> Structural note: **`Kong ≈ ingress-nginx + gateway`** — compose collapses edge + API into Kong (+ host nginx); K8s splits them.

## Gateway parity — route by route

| Route / concern | Compose (Kong) | K8s (Spring gateway) | Parity |
|---|---|---|---|
| `/mdms-v2`, `/user`, `/egov-*` core APIs | routed to service | routed to service (zuul discovery) | ✅ |
| `/user-otp`, `/otp` | **mocked** (canned 200); real via `otp` profile + de-mock | real OTP services | ❌ default |
| `/egov-location` (modern `/boundary-service/*`) | routed to boundary-service | routed to boundary-service | ✅ |
| `/egov-location` (legacy API) | **Kong Lua adapter** → boundary-service + reshape | no service, dangling refs | ❌ K8s gap |
| `/egov-user-event` (in-app feed) | **mocked empty** (service not deployed) | real service | ❌ (compose gap) |
| Novu notifications | real (behind `notifications` profile) | real | ✅ (opt-in) |
| Auth — **authentication** | none (forwards to service) | validates token → 401 | ❌ |
| Auth — **RBAC (role→action)** | none | `egov-accesscontrol` | ❌ |
| Auth — **userInfo enrich + anti-spoof** | Kong Lua | `AuthCheckFilterHelper` | ✅ |
| Auth — **session-expiry re-login** | broken (Kong never emits `InvalidAccessTokenException`) | works | ❌ |
| `/health/*` | Kong routes + Gatus | kubelet probes + Prometheus | mechanism diff |

> Fixed-OTP `123456` (`citizen-otp-fixed-enabled`) is enabled on **both** stacks. The auth-enforcement difference has a security implication tracked separately (not in this public doc).

## Service coverage

**Shared core (~24, at parity):** mdms-v2, egov-user, egov-enc-service, egov-accesscontrol, egov-workflow-v2, egov-persister, egov-indexer, egov-filestore, egov-idgen, egov-localization, egov-otp, user-otp, egov-url-shortening, egov-notification-sms, boundary-service, egov-hrms, egov-user-event, digit-config-service, digit-user-preferences-service, novu-bridge, pgr-services, default-data-handler, digit-ui, egov-bndry-mgmnt, inbox.

**K8s-only** (deployed on K8s, absent from compose):

| Service | Purpose | Core-PGR? | Note |
|---|---|---|---|
| `audit-service` | audit-trail query API | no | audit still *captured* on compose via persister; only query API absent |
| `pdf-service` | PDF generation (receipts) | no | optional feature |
| `egov-notification-mail` | email channel | no | compose uses SMS + Novu |
| `service-request` | generic service-request registry | no | — |
| `boundary-bulk-bff` | bulk-boundary BFF | no | compose onboards boundaries via MCP/configurator |
| `dashboard-analytics`, `dashboard-ingest` (DSS) | analytics dashboards | no | separate analytics stack |

**Compose-only:** Kong, digit-mcp, Keycloak + token-exchange, configurator, Jupyter, Gatus, OpenBao, OTEL tracing (tempo/promtail).

> K8s-only services are **optional / feature-adjacent** — the core complaint lifecycle works without them (compose runs lean and passes the PGR lifecycle test). Intentional scope difference; port to compose only if the specific feature is needed. (`user-onboard`, `xstate-chatbot` charts exist but are not enabled on K8s either.)

## Config parity

### Tenant identity — ❌ not at parity (structurally)

| Aspect | Compose | K8s |
|---|---|---|
| Source of tenant IDs | hardcoded per-service in base compose (`pg` / `pg.citya` / `mz`) | single `<tenant_id>` placeholder in `env.yaml` |
| How normalized | Ansible `replace`/overlay + **deferred** `STATE_LEVEL` rewrites, gated on `enable_mcp` **and** `state_root != 'pg'` | Helm templating, uniform |
| Result | conditional; residual drift (`egov-enc-service`, `egov-user-proxy` left on `pg.citya`) | consistent by construction |

Benign on a `pg` tenant (auth/login verified). **Latent risk**: a non-`pg` tenant deployed without MCP could keep wrong `STATE_LEVEL_TENANT_ID` → encryption/login issues. **Recommendation:** derive all tenant vars on compose from the single inventory value, unconditionally.

### Feature toggles

| | Compose | K8s |
|---|---|---|
| Where set | scattered (compose env + Ansible + `digit.env.j2` + image `application.properties` defaults) | explicit in one `env.yaml` |
| Overlap | matches where explicit on both (e.g. fixed-OTP `123456`) | — |
| Verdict | no functional divergence found; full toggle-vs-image-default diff low value | — |

## Data bootstrap — ❌ different mechanism

| | Compose | K8s |
|---|---|---|
| Schema | `db_fast_path` loads `db/full-dump.sql` (54 tables + Flyway history + test tenant) | per-service Flyway migration (init container), full replay, no dump |
| Seed data | bundled `pg`/`pg.citest` tenant + `user-seed.sh` + optional MCP bootstrap | `default-data-handler` + `boundary-bulk-bff`; starts empty |
| Consequence | fast, deterministic, but dump is a **maintenance burden** (regenerate as migrations evolve) | clean replay; "works on compose" ≠ proof of clean K8s migration |

Both converge on an equivalent **schema**, but differ on **out-of-box data** and **path**.

## Secrets model — ❌ different backend *and* key origin

| Aspect | Compose | K8s |
|---|---|---|
| Backend | OpenBao (runtime, per-host; seeded `cas=0` → `.env`) | SOPS + AWS-KMS `env-secrets.yaml` (git) → k8s Secrets |
| Encryption master key | **inherited from the dump** (`eg_enc_*_keys`, pinned ES master pw `asd@#$@$!132123`) | **generated** from `master_password`/`master_salt`/`master_initialvector` |
| Secret sets | db, user, hrms, notification, keycloak | db, user, hrms, notification, enc keys |

> **Data-portability blocker:** the two stacks use **different encryption master keys**, so data encrypted on one (usernames, PII) is **not decryptable on the other** — separate from the "which backend" question.

## Overall summary

| Layer | Parity | Items |
|---|---|---|
| **Application** | largely ✅ with a few real gaps | ~24 shared services + core routes; gaps: legacy `/egov-location`, `/egov-user-event` feed, auth-enforcement model, tenant-identity config model |
| **Platform** | intentionally different | gateway, secrets backend + key origin, data bootstrap, managed vs in-cluster infra, optional K8s-only services |
| **Portability blockers** | to be aware of | encryption master keys differ; dump-vs-migrations schema-drift risk |

**Realistic parity target:** the application layer + config semantics — not the platform layer.
