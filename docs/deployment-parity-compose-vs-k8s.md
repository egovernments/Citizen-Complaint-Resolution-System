# Deployment Parity: Ansible/Compose vs Kubernetes (deploy-as-code)

**Status: 🚧 Living document — updated as the parity test progresses.**

This tracks a functional-parity comparison between the two ways CCRS/DIGIT is deployed:

- **`local-setup/`** — single-box **Docker Compose** stack, orchestrated by Ansible
  (`local-setup/ansible/`), fronted by **Kong**. Used for dev/demo and some single-node
  production tenants.
- **`devops/deploy-as-code/`** — multi-node **Kubernetes** stack (Helmfile + Helm charts),
  fronted by the **Spring-Cloud `gateway`**. On AWS, infra comes from
  `devops/infra-as-code/terraform/sample-aws` (EKS + RDS + S3).

The goal is to know, per capability, whether the two behave the same — and where they don't,
whether the difference is intentional (platform-idiomatic) or a real gap to close.

---

## Progress tracker

| Area | Item | Status | Verdict (short) |
|---|---|---|---|
| Gateway | OTP (`/user-otp`, `/otp`) | ✅ done | Not at parity by default (compose mocks; real is opt-in) |
| Gateway | `/egov-location` | ✅ done | Modern boundary ✅; legacy egov-location a K8s gap |
| Gateway | `/egov-user-event` | ✅ done | In-app feed mocked on compose / real on K8s; Novu at parity |
| Gateway | Auth enforcement | ✅ done | Different model (see below); security-sensitive parts tracked privately |
| Gateway | `/health/*` | ✅ done | Mechanism difference, not a functional gap |
| Config | Tenant-identity config model | ✅ done | Not at parity structurally; benign on `pg`, latent risk otherwise |
| Config | Full feature-toggle audit | ⬜ todo | |
| Services | K8s-only services (DSS, pdf, audit, service-request) | ⬜ todo | |
| Data | Bootstrap parity (dump+MCP vs migrations+DDH) | ⬜ todo | |
| Infra | Secrets model (OpenBao vs SOPS) | ⬜ todo | |

---

## Big picture

The two stacks **share the same ~24 `egov-*` microservice core** but are different platforms
around it. Parity is meaningful mainly at the **application layer** (same services, same routes,
same config semantics); the **platform layer** (managed DB/S3, ingress, HA, secrets backend) is
intentionally different and not something to "make identical".

Structural note: **`Kong ≈ ingress-nginx + gateway`.** Compose collapses the edge (TLS/UI) and the
API gateway into Kong (+ host nginx); K8s splits them into `ingress-nginx` (edge) and the Spring
`gateway` (API). Any route comparison has to account for that split.

## Platform dimensions

| Dimension | Compose (Ansible) | Kubernetes (deploy-as-code) |
|---|---|---|
| Orchestrator | Ansible → `docker compose` | Helmfile → Helm charts |
| Unit of deploy | 1 host per tenant (`host_vars`) | 1 cluster per env (`environments/env.yaml`) |
| API gateway | Kong | Spring-Cloud `gateway` |
| Secrets | OpenBao (per-host) | SOPS + AWS-KMS (`env-secrets.yaml`) |
| Postgres | in-container + `db_fast_path` dump | external managed (RDS); `postgresql` chart `installed:false` |
| Object store | in-container MinIO | external S3; `minio` chart `installed:false` |
| Kafka | Redpanda | `kafka-kraft` (in-cluster) |
| TLS / edge | certbot + host nginx | cert-manager + ingress-nginx |
| Health/observability | Docker healthchecks + Gatus + OTEL/Grafana/Loki (default on) | kubelet probes + Prometheus/Grafana (monitoring helmfile, opt-in) |

The K8s AWS infra (EKS + RDS + S3 + a default `gp3` StorageClass) is provisioned by
`terraform/sample-aws`, which is why the in-cluster `postgresql`/`minio` charts are off by design.

## Service coverage (summary)

- **Shared core (~24):** mdms-v2, egov-user, egov-enc-service, egov-accesscontrol, egov-workflow-v2,
  egov-persister, egov-indexer, egov-filestore, egov-idgen, egov-localization, egov-otp, user-otp,
  egov-url-shortening, egov-notification-sms, boundary-service, egov-hrms, egov-user-event,
  digit-config-service, digit-user-preferences-service, novu-bridge, pgr-services,
  default-data-handler, digit-ui, egov-bndry-mgmnt, inbox.
- **K8s-only (deployed there, absent from compose):** audit-service, service-request, pdf-service,
  egov-notification-mail, boundary-bulk-bff, DSS analytics (dashboard-analytics/ingest); the Spring
  `gateway`; ops/aux (cert-manager, ingress-nginx, oauth2-proxy, pgadmin, s3-proxy, kafka-connect).
- **Compose-only:** Kong, digit-mcp, Keycloak + token-exchange, configurator, Jupyter, Gatus,
  OpenBao, OTEL tracing (tempo/promtail).

## Gateway parity — per-row findings

### OTP — `/user-otp`, `/otp`  — ❌ not at parity by default
Compose short-circuits both at Kong with canned success responses; the real OTP services
(`egov-otp`/`user-otp`/`egov-notification-sms`) exist behind the `otp` compose profile and require
tearing out the Kong mock + a real SMS provider to enable. K8s runs them for real.
The fixed-OTP `123456` shortcut (`citizen-otp-fixed-enabled`) is enabled on **both** stacks.

### `/egov-location`  — split
- **Modern `/boundary-service/*` (hierarchy, relationships): ✅ at parity** — what CCRS actually uses
  (UI, `EGOV_BOUNDARY_HOST`). Deployed + routed on both.
- **Legacy `/egov-location/*`: ❌ gap** — compose provides a Kong Lua adapter that rewrites the legacy
  boundary API onto `boundary-service` and reshapes the response; K8s has dangling `egov-location`
  references and no such service. Still live-used by the PGR ward/locality selector, configurator, and
  MCP. Recommended fix: migrate remaining callers to `/boundary-service/boundary-relationships/_search`
  (already at parity), which removes the legacy dependency on both stacks.

### `/egov-user-event`  — in-app feed differs; Novu at parity
The in-app notification/events feed (`egov-user-event`, powering the bell) is **mocked-empty on
compose** (the service isn't deployed) and **real on K8s**. PGR produces these events on complaint
lifecycle (`persist-user-events-async`), so it's a real feature — reaching parity on compose means
deploying `egov-user-event`. The separate **Novu** multi-channel notification stack works on **both**
(compose behind the `notifications` profile). Note: the K8s `egov-user-event` `service-host` entry
uses a stale `.staging` namespace, but the gateway routes via k8s service discovery, so it's dead
config rather than a functional break (worth cleaning up).

### Auth enforcement  — different model
- **Compose (Kong):** performs userInfo enrichment (resolves `userInfo` from the token; strips
  client-supplied `userInfo` — anti-spoofing) but **no authentication rejection and no RBAC**.
- **K8s (Spring gateway):** enforces authentication (validates the token, rejects non-whitelisted
  calls) and authorization via `egov-accesscontrol`, driven by
  `EGOV_OPEN/MIXED_MODE_ENDPOINTS_WHITELIST`.

Consequence: unauthorized/expired-token behavior differs between stacks (e.g. the digit-ui's
`InvalidAccessTokenException`-based re-login path fires on K8s but not on compose, since Kong does not
emit that error). **Security-sensitive implications of this difference — including an access-control
gap that is not specific to either gateway — have been reported to the maintainers separately and are
tracked outside this public document.**

### `/health/*`  — mechanism difference, not a functional gap
Compose exposes friendly `/health/<svc>` gateway routes (Kong `request-transformer` → `/<svc>/health`)
plus a Gatus `/status/` board and Docker healthchecks. K8s uses native kubelet liveness/readiness
probes plus Prometheus/blackbox (via the opt-in `monitoring-helmfile`). Both check the same underlying
`/<svc>/health` endpoints; the tooling is platform-idiomatic. Only follow-up: map any external
monitors/runbooks that reference the compose `/health/<svc>` or `/status/` URLs to the K8s equivalents.

---

## Config parity

### Tenant-identity config model — ❌ not at parity (structurally)
The two stacks configure tenant identity (`STATE_LEVEL_TENANT_ID` etc.) very differently:
- **K8s:** a single `<tenant_id>` placeholder in `environments/env.yaml`, Helm-templated uniformly to
  every service. Consistent by construction — set the tenant once, everything follows.
- **Compose:** tenant IDs are hardcoded per-service in the base compose (a mix of `pg`, `pg.citya`,
  `mz`) and normalized to the real tenant by a chain of Ansible `replace`/overlay tasks plus a
  **deferred** batch of `STATE_LEVEL_TENANT_ID` rewrites that is gated on `enable_mcp` **and**
  `state_root != 'pg'`.

Consequence: on a `pg` tenant or an MCP-disabled deploy, the deferred rewrites don't run and some
services keep base defaults (observed: `egov-enc-service` and `egov-user-proxy` on `STATE_LEVEL_TENANT_ID:
pg.citya`). This is **benign for a `pg` tenant** (auth/login verified working) but is a latent
robustness gap — a non-`pg` tenant deployed without MCP could keep wrong tenant values and hit
encryption-tenant / login issues.

**Recommendation:** derive all tenant-ID vars on compose from the single inventory `state_root` /
`state_tenant_id` (as K8s does), unconditionally, rather than base defaults + conditional rewrites.

### Note on toggles
K8s makes behaviour toggles explicit in one `env.yaml` (`otp-validation`, `roles-state-level`,
`citizen-registration-withlogin`, …). Compose spreads config across hardcoded compose env, Ansible
rewrites, `digit.env.j2`, and image `application.properties` defaults — so many toggles aren't set as
env vars and inherit image defaults, making a clean key-by-key parity check harder. Explicit ones that
overlap match (e.g. fixed-OTP `123456`). A full toggle-vs-image-default audit is pending.

## Next up
- Full feature-toggle audit (env.yaml toggles vs compose image `application.properties` defaults).
- K8s-only services (DSS, pdf, audit, service-request) — decide which need porting for true parity.
- Data bootstrap parity (compose dump + MCP vs K8s migrations + default-data-handler).
- Secrets-model reconciliation (OpenBao vs SOPS/KMS).
