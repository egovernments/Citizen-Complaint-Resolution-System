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
| Config | Feature toggles | ✅ done | Explicit toggles match where they overlap; compose inherits image defaults for the rest |
| Services | K8s-only services (DSS, pdf, audit, service-request) | ✅ done | Mostly NOT gaps: compose delivers analytics/email/bulk-boundary via native/newer paths; some are unused eGov cruft |
| Data | Bootstrap parity | ✅ done | Different mechanism (dump vs migrations); converges on schema, differs on seed data |
| Infra | Secrets model | ✅ done | Different backend AND different encryption-key origin → encrypted data not portable between stacks |

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
- **Legacy `/egov-location/*`: ❌ gap (confirmed live break on K8s)** — compose provides a Kong Lua
  adapter that rewrites the legacy boundary API onto `boundary-service` and reshapes the response; K8s
  has **no such service** and no route/rewrite for it (verified across all manifests: no workload, no
  ingress rewrite, no gateway static route; the gateway routes only discovered k8s services). The K8s
  config even **contradicts itself** — the gateway whitelists `/egov-location/location/v11/boundarys/_search`
  and `service-host` maps `egov-location`, yet nothing serves it. Confirmed by inspecting the **exact
  deployed image** `egovio/digit-ui:v2.11-a520687`: its built bundle references
  `/egov-location/location/v11/boundarys/_search` **27×** (vs `/boundary-service/boundary-relationships/_search`
  9× — a half-migrated state). So the PGR ward/locality selector (and configurator/MCP boundary flows)
  would **fail on K8s**. Note the backend is already migrated — `pgr-services` uses `egov.boundary.host`
  (→ boundary-service); its injected `EGOV_LOCATION_HOST` is dead config. Recommended fix: migrate the
  remaining **client** callers to `/boundary-service/boundary-relationships/_search` (already at parity),
  removing the legacy dependency on both stacks.

### `/egov-user-event`  — in-app feed differs (confirmed used feature); Novu is separate
The in-app notification/events feed (`egov-user-event`, powering the bell) is **mocked-empty on
compose** (the service isn't deployed) and **real on K8s** (`egov-user-event:v1.3.0-…`, `installed:
true`). This is a **confirmed, bundled UI feature**, not vestigial — the exact deployed image
`egovio/digit-ui:v2.11-a520687` contains `NotificationBell` ×80, `useNotificationCount` ×10,
`engagement` ×118, and all five `/egov-user-event/v1/events/*` endpoints. PGR produces these events on
complaint lifecycle (`persist-user-events-async`) on **both** stacks — so on compose the events are
emitted but **nothing consumes them** and the reads are mocked → the bell/inbox render but stay
permanently empty. Reaching parity on compose = deploy `egov-user-event` (public
`egovio/egov-user-event`) to consume the topic + drop the Kong mock; it largely lights up the existing
pipeline. The separate **Novu** multi-channel stack (SMS/WhatsApp/email delivery) works on both and is
**not** a substitute for the in-app feed. Note: the K8s `egov-user-event` `service-host` entry uses a
stale `.staging` namespace, but the gateway routes via k8s service discovery, so it's dead config
rather than a functional break (tracked as item #3, worth cleaning up).

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

### Feature toggles
K8s makes behaviour toggles explicit in one `env.yaml` (`otp-validation`, `roles-state-level`,
`citizen-registration-withlogin`, `workflow-statelevel`, …). Compose spreads config across hardcoded
compose env, Ansible rewrites, `digit.env.j2`, and image `application.properties` defaults — so many
toggles aren't set as env vars and inherit image defaults. Where toggles are explicit on both, they
match (e.g. fixed-OTP `123456`, `citizen-otp-fixed-enabled: true`). A full toggle-vs-image-default diff
is low value because compose intentionally relies on image defaults; **no functional divergence found in
the overlapping explicit toggles.**

## Service coverage — the K8s-only set (deep-dive)

Deployed on K8s (`installed: true`) but absent from compose: `audit-service`, `pdf-service`,
`service-request`, `egov-notification-mail`, `boundary-bulk-bff`, and DSS analytics
(`dashboard-analytics`, `dashboard-ingest`). (`user-onboard`, `xstate-chatbot` charts exist but are
not enabled on K8s either.)

First: there is **no missed enable-switch** — these services are absent from *every* compose file and
none of the compose profiles (`notifications`, `otp`, `local-dev`, `search`, `keycloak`, `mcp`) gate
them. But "absent service" ≠ "absent capability". Looking at each on the **capability** level, most are
**not parity gaps** — the compose stack delivers the same capability a different way. They fall into
three buckets:

### Bucket 1 — capability exists on compose via a different (often newer / CCRS-native) path
- **Analytics / dashboards (DSS `dashboard-analytics` + `dashboard-ingest`).** CCRS built a **native
  analytics engine into `pgr-services`**: `/v2/analytics` (`/_query`, `/_schema`, `/catalog/_search`,
  `/packs`) backed by `KpiDefinition` tiles + `DashboardPack`, RBAC-aware (`PrincipalScopeResolver`),
  reading straight from the PGR DB — no Elasticsearch ingestion pipeline. Because it's the **same
  `pgr-services` image**, `/v2/analytics` is reachable on **both** stacks. So analytics is **at parity
  via the native endpoint**; the DSS stack on K8s is the *classic eGov* analytics that CCRS's native one
  supersedes — a K8s-only legacy layer, **not a compose gap**.
- **Email (`egov-notification-mail`).** Compose covers email via **Novu** (`novu-bridge` supports
  `whatsapp/sms/email/push`). Different mechanism (Novu multi-channel vs the classic single-channel mail
  consumer), same capability.
- **Bulk boundary (`boundary-bulk-bff`).** Compose handles boundary onboarding via **MCP / configurator
  / dataloader**. Different tooling, same capability.

### Bucket 2 — unused eGov inheritance (on K8s, needed by neither)
- **`service-request`.** The `ServiceRequest` type in `pgr-services` is PGR's **own complaint model**
  (a complaint *is* a "service request"), **not** a call to the `service-request` microservice. PGR does
  not use that service — it's inherited cruft on K8s.
- **`pdf-service`.** No references anywhere in CCRS/PGR. Unused.

### Bucket 3 — partial (capture yes, query no)
- **`audit-service`.** Audit records are **captured on both** stacks (both ship
  `audit-service-persister.yml`); only the audit **query API** is K8s-only. Low impact.

**Net:** the compose stack isn't missing analytics, email, or bulk-boundary — it implements them via
native/newer paths (pgr `/v2/analytics`, Novu, MCP), while K8s carries the classic eGov services. The
only truly-absent-and-relevant capability is audit *query* (data is still captured). In several of these
the compose side is the *more modern* implementation, so the K8s-only set is largely **not** a parity
gap to close on the compose side; if anything it flags **legacy services to reconsider on K8s** (DSS,
service-request, pdf).

This is an **intentional scope difference**, not a bug. For true parity, add these to compose *only if*
the specific feature (PDF receipts, email, DSS dashboards, audit querying) is required.

## Data bootstrap — ❌ different mechanism

| | Compose | K8s |
|---|---|---|
| Schema | `db_fast_path` loads `db/full-dump.sql` (prebuilt: 54 tables + Flyway history + `pg`/`pg.citest` test tenant + CI-ADMIN + 33 ServiceDefs + 20k localization). A `db-migrations` compose exists but the dump is the default path. | Each service runs its **own Flyway migration** via an init container (`dbMigration`, schema/locations/creds from secrets) — full replay from scratch, no dump. |
| Seed data | Dump ships a ready test tenant; `seeds/user-seed.sh` ensures ADMIN/GRO/INTERNAL_USER; optional MCP tenant bootstrap. | `default-data-handler` seeds MDMS/tenant data; `boundary-bulk-bff` for boundaries. Starts empty. |

Both converge on an **equivalent schema**, but via different paths and with **different out-of-box
data** (compose has a bundled test tenant; K8s onboards fresh). Two consequences: (1) the compose dump is
a **maintenance burden** — it must be regenerated as migrations evolve, or compose drifts behind K8s;
(2) "works on compose" is not proof of a clean migration path on K8s (which replays every migration).

## Secrets model — ❌ different backend *and* different key origin

| | Compose | K8s |
|---|---|---|
| Backend | **OpenBao** (runtime, per-host; `bootstrap_secrets` seeded once with `cas=0`, rendered to `.env`) | **SOPS + AWS-KMS** encrypted `env-secrets.yaml` in git; decrypted at `helmfile apply`, injected as k8s Secrets |
| Encryption master key | **Inherited from the dump** — `eg_enc_*_keys` decrypt only under the pinned `elasticsearch_master_password` (`asd@#$@$!132123`) | **Generated** from `egov-enc-service` `master_password`/`master_salt`/`master_initialvector` in `env-secrets.yaml` |

The important consequence: **the two stacks use different encryption master keys**, so data encrypted on
one (usernames, PII) is **not decryptable on the other**. That's a real **data-migration blocker** between
stacks, separate from the "which backend" difference. Secret *sets* mostly overlap (db, user, hrms,
notification), but there's no shared source of truth and the enc-key origin diverges by design.

## Overall parity summary

The **application layer** is largely at parity (same ~24 services, same core routes) with a handful of
real gaps: legacy `/egov-location`, the in-app `egov-user-event` feed, the auth-enforcement model, and
the tenant-identity config model. The **platform layer** (gateway, secrets backend + key origin, data
bootstrap, managed vs in-cluster infra, K8s-only optional services) is **intentionally different** and
not meant to be made identical — the realistic parity target is the app layer + config semantics, plus
the two data-portability blockers to be aware of (encryption keys, dump vs migrations).

---

## Action tracker

The consolidated list of concrete items surfaced by this audit. Update **Status** as items are resolved
(`☐` open · `🟡` in progress · `✅` done · `➖` accepted / won't-fix). "Type" legend: **Gap** = real
divergence to close · **Cleanup** = remove dead/legacy config · **Decision** = needs a call · **Harden**
= production-hardening · **Process** = ongoing discipline · **Awareness** = document, no code change.

| # | Item | Where | Type | Recommended action | Ref | Status |
|---|---|---|---|---|---|---|
| 1 | Legacy `/egov-location` API not served — **confirmed** live break on K8s (deployed `digit-ui` bundle calls it 27×; nothing serves it) → PGR ward selector, configurator, MCP break | K8s | Gap | **FIX IN PR #1098**: migrated all 4 client frontends (digit-ui-esbuild, digit-mcp, digit-ui-v2, configurator) to `/boundary-service/boundary-relationships/_search` via a client-side adapter that mirrors the compose Kong reshape (wrap `hierarchyType`→`{code,name}`; add `name`/`localname`/`label`; normalize `children`). Validated **byte-equivalent** to the Kong adapter live (tenant `pg`: same hierarchyType, node field-sets, 14/14 nodes). Lets the Kong `/egov-location` adapter be dropped once merged | #1098 | 🔧 PR |
| 2 | In-app `egov-user-event` feed mocked empty — **confirmed** used feature (deployed `digit-ui` bundle: `NotificationBell`×80, `useNotificationCount`×10, `engagement`×118, all 5 events endpoints). Works on K8s (`egov-user-event` deployed), dead on compose (Kong mock, no consumer). pgr already emits events → nothing consumes them | Compose | Gap | Deploy `egov-user-event` on compose (public `egovio/egov-user-event`) to consume `persist-user-events-async` + drop the Kong mock — "lights up" the existing pipeline. (Novu ≠ substitute; it's delivery, not the in-app feed). **Deferred — not urgent** (in-app bell/inbox render but stay empty on compose; cosmetic, no data loss or break; Novu handles actual notification delivery) | — | ⏸ deferred |
| 3 | `egov-user-event` `service-host` = stale `.staging` namespace — **confirmed dead config** (no chart consumes the key; gateway routes via k8s discovery to `egov-user-event.egov`, where the service actually deploys). One-off typo, no functional impact | K8s | Cleanup | **FIXED IN PR #1099**: `.staging` → `.egov` (+ trailing slash to match siblings) at `env.yaml:53` — the only occurrence (repo has no `configmaps/values.yaml` copy) | #1099 | 🔧 PR |
| 4 | Session-expiry re-login broken — **confirmed both sides**: deployed `digit-ui` bundle keys re-login off `InvalidAccessTokenException` (×9); K8s gateway JAR (`egovio/gateway:v2.9.2-4a60f20`) emits it; Kong never does (invalid token → `status:successful`/`NullPointerException`, verified live). On compose an expired token shows blank/error screens instead of redirecting to login. UX gap, not security | Compose | Gap | In the Kong `pre-function`, when a token is present but `/user/_details` fails, return the egov `InvalidAccessTokenException` envelope (guard on "token present" so open endpoints are unaffected). Full RBAC (#5) also fixes it. **FIXED IN PR #1101** — pre-function returns the 401 envelope on token rejection (transient `/user/_details` outages don't force logout). **Validated live**: invalid token → 401 `InvalidAccessTokenException`; valid token → 200; no-token open endpoint → 200 (no leak) | #1101 | 🔧 PR |
| 5 | Gateway does no authn/RBAC enforcement — compose runs production too, so "auth-soft" is not acceptable. **DECIDED: the gateway must enforce RBAC** (match K8s) | Compose | Gap | Extend the Kong `pre-function` to (a) reject unauthenticated/invalid-token requests on non-whitelisted paths and (b) call `egov-accesscontrol` for action-RBAC, using the same open/mixed-mode whitelist as the Spring gateway (keep the two in sync). **Subsumes #4** (authn + `InvalidAccessTokenException` come for free). **NB: gateway RBAC is action-level — record-ownership (#6) is still a separate service-side fix on both stacks** | — | ☐ |
| 6 | `pgr-services` search IDOR — **exact root cause**: `enrichSearchRequest` sets `criteria.accountId = caller.uuid` (intends to scope) but `PGRQueryBuilder` filters on `ser.accountId IN (criteria.userIds)` and **never reads `accountId`**; `userIds` comes from the **client-supplied `mobileNumber`** → citizen passes another mobile = IDOR, passes none = all complaints. Mis-wired field, both stacks. Gateway RBAC (#5) can't fix (record-level) | Both | Gap | In `enrichSearchRequest`, for a **pure citizen** (`isCitizen && !hasEmployeeRole`, reuse `PrincipalScopeResolver`) force `criteria.setUserIds({caller.uuid})` and ignore client `mobileNumber` → existing `accountId IN (userIds)` clause scopes to own; employees unaffected. **FIXED IN PR #1100** — pure-citizen test extracted to `PrincipalScopeResolver.isPureCitizen()` (single source of truth). **Validated live** (built the image, ran end-to-end): attacker unfiltered 2→0, attacker+mobileNumber 0, citizen sees own 1, employee ADMIN 2→2 (unaffected) | #1071, #1100 | 🔧 PR |
| 7 | Real-OTP enablement on compose is broken — **validated live, 3 issues**: (a) `otp`-profile services OOM at `memory:256M`/`Xmx192m` (`Exited 137`); (b) Kong `/otp` upstream is a dead `localhost:9999` → de-mock alone = **HTTP 502**; (c) undocumented (`/user-otp` has a TO-ENABLE comment, `/otp` doesn't). Proven: bump→512M = healthy; repoint `/otp`→`egov-otp:8089` = real validation (rejects bogus OTP vs mock's rubber-stamp) | Compose | Gap+Cleanup | (a) bump `otp` svcs `deploy.resources.limits.memory` 256M→~512M; (b) repoint Kong `/otp` → `egov-otp:8089`; (c) document enable steps (mirror `/user-otp` comment). NB: `kong reload` does NOT re-read declarative config here — needs a `kong-gateway` container restart. **FIXED IN PR #1102** — all three: otp svcs 256M→512M, `/otp`→`egov-otp:8089`, enable-steps comment. Default mock unchanged (dev/test still uses fixed `123456`); only unblocks the real path when an operator enables it. (Prerequisite for flipping #8 off) | #1102 | 🔧 PR |
| 8 | Fixed-OTP `123456` enabled by default on both stacks (repo defaults) — **confirmed live**: `mobile + 123456` logs in a citizen (no real OTP). Auth bypass if left on in prod. **Chains with #6**: IDOR harvests citizen mobiles → fixed-OTP logs in as them → mass account takeover. Legit dev/test toggle, but risky prod default | Both | Harden | **Verify every prod tenant** (compose + K8s) has `citizen-otp-fixed-enabled: false` **and** working real OTP. Order: fix #7 (real OTP) → then flip #8 off (else citizens can't log in). If any prod tenant has it ON → escalate to fix-now. Assess #6+#8 together | — | ☐ |
| 9 | Tenant-ID config drift (**PARKED**) — validated live: tenant labels map to **different encryption keys** (`pg`→489366, `pg.citya`→804559); `enc-service` mislabels the state-**root** as a city (`pg.citya`) instead of `pg`. **Harmless on `pg`** — each tenant uses its own key per-request, login/decrypt work; the mislabel is off the load-bearing path. Model = **one root per deployment + many cities (addable later)**, root fixed at deploy. Latent **wrong-key** for non-`pg` tenants: the normalization is conditional (gated on `enable_mcp`+`state_root!=pg`) AND regex-incomplete (`STATE_LEVEL_TENANT_ID: pg$` misses `pg.citya`/`mz`) | Compose | Gap | Derive all tenant-ID vars from a single inventory `state_root`/`state_tenant_id`, unconditionally (like K8s). Verify non-`pg` prod tenants for residual `pg.citya`/`mz` on `enc-service`/inbox | — | ⏸ |
| 10 | Data bootstrap is a **different mechanism** (validated live): compose loads a pre-seeded `full-dump.sql`; K8s builds schema via **per-service Flyway** (`<svc>-db` init containers) + seeds tenants via **DDH onboarding**. Same table skeleton, but **different provenance** — dump = fully-onboarded snapshot (33 complaint types, 8 users, workflow, no Flyway history); a DDH-onboarded tenant = base masters + login only. Both reach *functionally-equivalent* (not identical) working tenants. **Compose structurally bypasses the DDH onboarding path** — so "works on compose" doesn't validate K8s onboarding, which has real bugs (dead `MDMS.json` ref + missing `/mdms-v2/defaultdata/_create` endpoint). NB: complaint types come from the **configurator**, not DDH. No clean tenant teardown either (FK chains). | Compose / Both | Process + Gap | (a) CI check: dump == migrated schema; regenerate dump on migration changes. (b) Fix DDH onboarding (#1090) so K8s tenants provision cleanly. (c) Document the full onboarding sequence (`/tenant/new` → `/defaultdata/setup` → configurator) | #1090 | ☐ |
| 11 | Encryption master keys differ (confirmed live): compose `asd@#$@$!132123`/`qweasdzx`/`qweasdzxqwea` vs K8s `demo`/`q7.fr.cr`/`9J&asfgrU-H2`. Master wraps per-tenant DEKs (`eg_enc_symmetric/asymmetric_keys`) → **data not portable across stacks**. **SECURITY angle:** compose `db_fast_path` pins the master to a **public, hardcoded value** (in repo + `_example.yml`, since the dump's DEKs are wrapped under it) → **encryption-at-rest effectively defeated** on those tenants (DB leak → PII readable); public prod tenants (Bomet/Nairobi) inherit it. K8s can set a strong master via SOPS (the `demo` is a placeholder) — compose `db_fast_path` can't without re-keying the dump | Both | Awareness + Harden | (a) **Awareness:** cross-stack data migration needs master-key alignment or re-encryption. (b) **Harden:** verify prod compose tenants aren't relying on the public master; plan a re-key (fast-dump vs strong encryption tension) — same class as #8. K8s: set a real master via SOPS, not `demo` | — | ☐ |
| 12 | Legacy/unused services deployed on K8s (**confirmed** `installed:true`): `dashboard-analytics` + `dashboard-ingest` (DSS — superseded by CCRS-native pgr `/v2/analytics`), `service-request`, `pdf-service` (no calls from PGR/CCRS). Not used | K8s | Cleanup | Set `installed:false` / drop from the helmfile — cuts footprint + attack surface. Keep DSS only if those dashboards are actually used vs the native `/v2/analytics` | — | ☐ |
| 13 | Audit: **capture at parity** (confirmed — both stacks ship `audit-service-persister.yml` → records persisted), but the audit **query API** (`audit-service`) is deployed on K8s only, absent on compose | Compose | Decision | Deploy `audit-service` on compose only if an audit-query API is actually needed; else leave — capture already happens on both. Low priority | — | ☐ |
| 14 | K8s `service-host` + gateway whitelist carry **inherited non-CCRS baggage** (confirmed): hosts for products CCRS doesn't deploy — `fsm`×6, `sw/tl/ws-services`×4 each, `vehicle`×3, `property-services`/`bpa`/`noc`/`billing`×2 each — plus `.sanitation`/`.health` namespaces and the `.staging` typo (#3). Dead/stale config | K8s | Cleanup | One-time prune of `env.yaml` service-host + gateway whitelist down to what CCRS runs. NB: verify the `.es-cluster` `es-client` host separately (search-stack review) — may be a real wrong-namespace, not just cruft | — | ☐ |

**Not action items (intentional / at parity, listed for completeness):** modern `/boundary-service/*`
routing, feature toggles, `/health/*` mechanism, Novu email, MCP bulk-boundary, and the platform-layer
differences (managed RDS/S3 vs in-container, ingress split, secrets backend). These are by design.
