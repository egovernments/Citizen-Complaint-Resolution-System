# Parity fixes — exact reproducible steps (per finding)

The **blueprint for the fix PRs**. Each entry matches a finding in issue #1160 and the `Fix` column of `PARITY-TEST-MATRIX.md`. It records *both* what was changed and how, so a fix PR can be raised without reconstructing anything.

**Status legend**
- ✅ **Permanent (in-files)** — the change is a chart/config edit on branch `fix/dual-deploy-parity`; the PR just needs to commit it.
- ⚠️ **Live-only** — applied to the running cluster via `kubectl`/SQL this session; **not yet in any file**. The PR must turn it into chart/seed content (guidance under *Permanent fix*).
- 🔀 **Mixed** — config is in-files, but part (a secret / seed row) is live-only.

> **Credentials are redacted** (`<...>`) — the live commands used the deployment's dev defaults; a PR should source them from the deployment's secrets, never hardcode. `KUBECONFIG=~/.kube/config`, namespaces `egov` (apps) / `backbone` (data).

---

## §1.2 · Deploy `configurator` + `digit-mcp` on k8s  ⚠️ Live-only
**Symptom:** `/configurator/`, `/mcp` 404 on k8s → no in-cluster admin/onboarding.
**Permanent fix (the PR):** add `configurator` (nginx serving the built dist + Service + Ingress `/configurator`) and `digit-mcp` (the shim + its session postgres) charts to the helmfile. The manifest below is the reference for the MCP chart's Deployment/Service/Ingress and env.
**Applied this session:**
```bash
# 1. import the local MCP image into k3s containerd
docker save digit-mcp:local -o /tmp/digit-mcp-local.tar
sudo k3s ctr -n k8s.io images import /tmp/digit-mcp-local.tar

# 2. create the MCP session DB + role in the shared postgres
kubectl exec -i -n backbone postgresql-0 -- env PGPASSWORD=<pg-pass> psql -U postgres -d postgres <<'SQL'
DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='mcp')
  THEN CREATE ROLE mcp LOGIN PASSWORD '<mcp-pass>'; END IF; END $$;
CREATE DATABASE mcp_sessions OWNER mcp;
SQL

# 3. apply the Deployment + Service + Ingress (full manifest: scratchpad/digit-mcp-k3s.yaml)
#    key env: CRS_API_URL=http://gateway:8080 (k8s Spring gw = compose kong:8000),
#    CRS_TENANT_ID=pg, DIGIT_DB_HOST=postgresql.backbone/egov,
#    SESSION_DB_HOST=postgresql.backbone/mcp_sessions, EGOV_REDIS_HOST=redis.backbone,
#    MCP_PORT=3000, MCP_TRANSPORT=http; Ingress paths /mcp and /v1 -> digit-mcp:3000
kubectl apply -f digit-mcp-k3s.yaml
```
Verify: `curl -sk https://<domain>/v1/version` → 200 with `city_setup_from_xlsx` in the tool list; `mdms_get_tenants` returns tenants (MCP→gateway auth works).

---

## §1.3 · postgres chart pins the dead Bitnami registry  ✅ Permanent
**Fix (committed diff):** `backbone-services/postgresql/values.yaml`
```diff
-  repository: bitnami/postgresql            +  repository: bitnamilegacy/postgresql
-    repository: bitnami/bitnami-shell       +    repository: bitnamilegacy/bitnami-shell
-    repository: bitnami/postgres-exporter   +    repository: bitnamilegacy/postgres-exporter
```
Long-term: mirror to `egovio/` (bitnamilegacy is frozen). `grep -rn "repository: bitnami/" charts/` for stragglers.

---

## §1.4 · JVM `-Xmx` == `memory_limits` → cgroup OOM  ✅ Permanent
**Fix (committed diff):** raise `memory_limits` per chart `values.yaml` (or use `-XX:MaxRAMPercentage=60`).
```diff
mdms-v2/values.yaml          -  memory_limits: 512Mi   +  memory_limits: 1024Mi
boundary-service/values.yaml -  memory_limits: "512Mi" +  memory_limits: "1024Mi"
# also raised for pgr-services, egov-workflow-v2, default-data-handler
```

---

## §1.5 · `user-otp` chart never sets a Redis host  ✅ Permanent
**Fix (committed diff):** `core-services/user-otp/values.yaml` — add both the SB2 and SB3 property names:
```diff
+  - name: SPRING_REDIS_HOST         # SB2 compat
+    value: redis.backbone
+  - name: SPRING_DATA_REDIS_HOST    # SB3 (user-otp is Spring Boot 3)
+    value: redis.backbone
+  - name: SPRING_DATA_REDIS_PORT
+    value: "6379"
```
Audit all SB3 services for the `SPRING_*` → `SPRING_DATA_*` rename.

---

## §1.6 · egov-user image divergence — mobile validation  ✅ Permanent *(needs product decision)*
**Fix (committed diff):** `core-services/egov-user/values.yaml`
```diff
-  repository: "egov-user"                                     -  tag: master-d69ce29
+  repository: "registry.preview.egov.theflywheel.in/egovio/egov-user"
+  tag: "mobilevalidation-jdk8-4984479"    +  pullPolicy: "IfNotPresent"
-otp-validation: "true"                    +otp-validation: "false"
```
The `mobilevalidation` build reads the per-tenant mobile rule from MDMS (Compose already runs it). Decision pending: is this the intended prod image? Align `OTP_VALIDATION_REGISTER_MANDATORY` across stacks.

---

## §1.7 · Filestore has no object store on k8s (minio)  🔀 Mixed
**Symptom:** uploads → `Error in Configuration`, then `AWS Access Key Id … does not exist`.
**In-files (committed):** `environments/env.yaml`
```diff
-        minio-url: "http://minio-svc.backbone:9000/"   +        minio-url: "http://minio.backbone:9000/"
-  minio-enabled: false                                 +  minio-enabled: true
-  fixed-bucketname: <bucket>                           +  fixed-bucketname: parity-bucket
```
`backboneservices-helmfile.yaml`: `minio installed: false → true`.
**Live-only (the PR must chart-template these):**
```bash
# the minio client rejects the trailing slash — remove it (env.yaml still has it):
kubectl patch configmap egov-service-host -n egov --type merge \
  -p '{"data":{"minio-url":"http://minio.backbone:9000"}}'

# egov-filestore (minio-enabled path) reads creds from a secret named `minio` in the *egov* ns,
# keys accesskey/secretkey — the minio chart only creates its secret in `backbone`, so create it:
kubectl create secret generic minio -n egov \
  --from-literal=accesskey=<minio-user> --from-literal=secretkey=<minio-pass>

# create the bucket (mc, with HOME writable):
kubectl exec -n backbone <minio-pod> -- sh -c \
  'mc alias set loc http://localhost:9000 <minio-user> <minio-pass> && mc mb loc/parity-bucket'
kubectl rollout restart deploy egov-filestore -n egov
```
**Permanent fix:** drop the trailing slash in `env.yaml`; have the filestore chart **template the egov-ns `minio` secret from the minio release**; create the bucket as an init/job. Then it's fully in-files.

---

## §1.8 · digit-ui `globalConfigs.js` → India defaults  ⚠️ Live-only
**Symptom:** k8s UI shows `+91` / missing CCRS labels (external-S3 config 403 → silent India fallback).
**Applied this session:**
```bash
# mount the compose-rendered Maputo globalConfigs.js over the pod's baked-in one
kubectl create configmap digit-ui-globalconfigs -n egov \
  --from-file=globalConfigs.js=<maputo-globalConfigs.js>
kubectl patch deploy digit-ui -n egov --type json -p '[{"op":"add",
  "path":"/spec/template/spec/...","value": <configmap volume + subPath mount
  at /var/web/digit-ui/globalConfigs.js>}]'
```
**Permanent fix:** have the k8s digit-ui **render `globalConfigs.js` locally from the tenant config** (like Compose) instead of the external-S3 injection; at minimum make a missing/unreachable config **fail loudly** rather than silently degrade to India defaults.

---

## §2.4 · Configurator writes fail on k8s — missing RBAC grant  ⚠️ Live-only
**Symptom:** `POST /mdms-v2/v2/_create/common-masters.Department` → 401. The write actions exist in the `ACCESSCONTROL-ACTIONS-TEST.actions-test` MDMS master but are granted only to `MDMS_ADMIN`; the operator (`ADMIN`) lacks it.
**Applied this session (raw SQL into the MDMS store — grants SUPERUSER, which the operator has):**
```bash
kubectl exec -i -n backbone postgresql-0 -- env PGPASSWORD=<pg-pass> psql -U egov -d egov <<'SQL'
INSERT INTO eg_mdms_data (id,tenantid,schemacode,uniqueidentifier,isactive,createdby,lastmodifiedby,createdtime,lastmodifiedtime,data)
SELECT gen_random_uuid()::text,'mz','ACCESSCONTROL-ROLEACTIONS.roleactions','SUPERUSER.'||(a.data->>'id'),
  true,'parity-seed','parity-seed',(extract(epoch from now())*1000)::bigint,(extract(epoch from now())*1000)::bigint,
  jsonb_build_object('id',(a.data->>'id')::int,'actionid',(a.data->>'id')::int,'rolecode','SUPERUSER','tenantId','mz','actioncode','')
FROM eg_mdms_data a
WHERE a.schemacode='ACCESSCONTROL-ACTIONS-TEST.actions-test' AND a.tenantid='mz'
  AND (a.data->>'url' LIKE '/mdms-v2/v2/_create/%' OR a.data->>'url' LIKE '/mdms-v2/v2/_update/%')
  AND NOT EXISTS (SELECT 1 FROM eg_mdms_data r WHERE r.schemacode='ACCESSCONTROL-ROLEACTIONS.roleactions'
    AND r.tenantid='mz' AND r.uniqueidentifier='SUPERUSER.'||(a.data->>'id'))
ON CONFLICT (tenantid,schemacode,uniqueidentifier) DO NOTHING;
SQL
kubectl rollout restart deploy egov-accesscontrol mdms-v2 -n egov   # flush the role-action cache
```
**Permanent fix:** seed these grants to a **dedicated config-admin role (or `MDMS_ADMIN`)** — not `SUPERUSER` — via the **MDMS roleactions master in the seed data** (not raw SQL, `createdby='parity-seed'` marks the demo rows: `DELETE … WHERE createdby='parity-seed'` to revert). Add a CI check that drives one configurator create with RBAC enforced.

---

## §2.5 · egov-hrms was never deployed on k8s  🔀 Mixed
**Symptom:** `/egov-hrms/employees/_search` → 404 (nothing answers `/egov-hrms`; it's a `common-services` release the deploy never ran).
**In-files (committed diff):** `common-services/egov-hrms/values.yaml`
```diff
-    enabled: true    +    enabled: false   # restore-based: hrms schema already present
-  repository: "egov-hrms"                    -  tag: "hrms-boundary-0a4e737"
+  repository: "registry.preview.egov.theflywheel.in/egovio/egov-hrms"
+  tag: "800-preview"   +  pullPolicy: "IfNotPresent"
```
**Applied this session:**
```bash
docker save registry.preview.egov.theflywheel.in/egovio/egov-hrms:800-preview -o /tmp/hrms.tar
sudo k3s ctr -n k8s.io images import /tmp/hrms.tar
cd charts/common-services && helmfile -f common-services-helmfile.yaml -e env -l name=egov-hrms apply --skip-deps
kubectl rollout restart deploy gateway -n egov   # gateway-kubernetes-discovery re-scans → /egov-hrms route
```
**Permanent fix:** wire `common-services-helmfile.yaml` (egov-hrms + the other 4 releases) into the k8s deploy sequence; ensure the gateway starts/restarts *after* services exist (its route discovery is startup-time). Smoke-check `/egov-hrms/employees/_search` returns JSON on both stacks.

---

## (minor) mdms-v2 image drift  ✅ Permanent
`core-services/mdms-v2/values.yaml`: `tag v2.9.2-4a60f20 → maven-jdk21-9f83afb` + `pullPolicy: IfNotPresent` (align k8s with the Compose-baked image; behaves identically — parity cleanliness, not a bug).

---

## §2.6 · Test harness sends string roles → 500 on k8s gateway  ✅ Permanent (test code)
**Symptom:** configurator-manage tests (`complaint-types` list, `tenants` show/search, `users` create) fail on k8s at their API-sanity call — `500/401 Cannot construct Role from String ('DGRO')` — while passing on Compose.
**Cause:** the harness copies `auth.user` (whose `roles` are code strings from the configurator storageState) straight into `RequestInfo.userInfo`. Kong re-resolves userInfo from the token (tolerates strings); the stock k8s gateway forwards them verbatim → the service can't deserialize `Role` from a string. The real SPA is unaffected (it sends objects).
**Fix (committed):** in both harness builders — `tests/integration-tests/tests/utils/manage/api.ts` (`buildRequestInfo`) and `tests/integration-tests/tests/admin/users.spec.ts` (`requestInfo`) — expand string roles to Role objects:
```ts
userInfo: auth.user
  ? { ...auth.user, roles: (auth.user.roles ?? []).map(r =>
        typeof r === 'string' ? { code: r, name: r, tenantId: auth.user.tenantId } : r) }
  : undefined,
```
Flips 4 of the 5 cluster tests on k8s. **§2.6b (the 5th, `users create`):** `/user/_search` is open on Compose but RBAC-enforced on k8s → 401; fix by **granting** the `/user/_search` action to the config-admin role (a §2.4-family seed) — do **not** open the endpoint on k8s (that copies Compose's fail-open PII search).

---

## §1.6b · OTP mode — mock OTP on k8s to match Compose  🔀 Mixed (fix verified)
**Symptom:** citizen register-OTP fails on k8s (3 citizen-UI tests) — the tests hardcode `FIXED_OTP=123456` and expect the OTP screen; k8s runs *real* OTP which rejects it.
**Root cause:** Compose default **mocks** OTP (services behind `profiles:["otp"]`, unstarted; Kong request-termination rubber-stamps `123456`); the k8s helmfile brings up **real** `user-otp`+`egov-otp`, which 400 on `MobileNumberValidation`. The tests target the mock (no test reads a real OTP).
**Fix (verified) — replicate Compose's mock on k8s:**
```bash
# 1. deploy an nginx that returns the exact Kong mock bodies (send-success + validate-success):
kubectl apply -f tests/integration-tests/deploy/otp-mock.k8s.yaml   # ConfigMap + Deployment (app=otp-mock)
# 2. repoint the OTP Services at it (replace selector wholesale — a merge keeps `group:` and breaks matching):
kubectl patch svc user-otp -n egov --type json -p '[{"op":"replace","path":"/spec/selector","value":{"app":"otp-mock"}}]'
kubectl patch svc egov-otp -n egov --type json -p '[{"op":"replace","path":"/spec/selector","value":{"app":"otp-mock"}}]'
```
- **In-files (committed):** egov-user OTP flags aligned to Compose — `charts/core-services/egov-user/values.yaml` + `env.yaml`: `otp-validation`, `citizen-otp-enabled`, `citizen-registration-withlogin` set **empty** (not emitted), keeping only `citizen-otp-fixed=123456`/`-enabled`. (Drops the earlier `OTP_VALIDATION_REGISTER_MANDATORY=false`/`withlogin=true` workarounds — the mock makes them unnecessary.)
**Verified:** citizen provisioning + all 3 UI tests (`fresh phone → OTP → name+email`, `upload JPEG/photo`) pass on k8s.
**Permanent fix:** wire the OTP mock into the k8s helmfile (deploy `otp-mock` and point the `user-otp`/`egov-otp` Services at it — or a gateway short-circuit for `/user-otp/*`+`/otp/v1/_validate`), matching Compose's default. *(Or `enable_otp_services:true` on both + fix the `user-otp` `MobileNumberValidation` match — the production-like path.)*

## §1.9 · PGR businessservice missing at the city tenant on **Compose**  🔀 Mixed (fix verified)
**Symptom (Compose-side, not k8s):** the complaint pipeline fails on Compose while passing on k3s+bomet — `PGR business service is present` → `undefined`, `citizen creates complaint` → false, and ~15 downstream tests (My Complaints, detail page, rate, reopen, assign→resolve, the `@p0`/`@p1` search tests) fail or skip. This is the one gap where **Compose was behind k3s** — the reverse of every other finding here.
**Root cause:** egov-workflow-v2's `PGR` businessservice was seeded only at the **root** tenant (`mz`), not the **city** tenant (`mz.maputo`) where complaints actually run. The workflow lookup for a `mz.maputo` complaint does **not** fall back to the root, so `APPLY` finds no businessservice and creation fails. k3s had PGR registered at *both* `mz` and `mz.maputo`; the Compose Maputo onboarding created only the root one.
**Fix (verified) — seed PGR@`mz.maputo` on Compose from k3s's exact config:**
```bash
# 1. Pull the working businessservice from k3s (search returns states/actions linked by UUID):
#    POST /egov-workflow-v2/egov-wf/businessservice/_search?tenantId=mz.maputo&businessServices=PGR
# 2. Rebuild a _create payload: REMAP each action currentState/nextState from k3s state-UUID → state NAME
#    (the format _create relinks by), keeping ONLY the null start-state placeholder UUID and the single
#    benign FORWARD phantom (04752227…) that k3s itself carries. Do NOT re-post the raw _search output —
#    _create mints fresh state UUIDs, so UUID-linked actions become dangling (21 broken refs).
# 3. POST the remapped payload to Compose:
#    POST /egov-workflow-v2/egov-wf/businessservice/_create   (tenantId=mz.maputo, ADMIN@mz token)
# Verify: search returns 11 states, exactly ONE dangling nextState (the FORWARD phantom, == k3s).
```
If a prior broken attempt exists, delete it first (FK order: actions → states → businessservice; `docker exec` needs `-i` for heredoc SQL):
```bash
docker exec docker-postgres psql -U egov -d egov -c "DELETE FROM eg_wf_action_v2 WHERE tenantid='mz.maputo';"
docker exec docker-postgres psql -U egov -d egov -c "DELETE FROM eg_wf_state_v2 WHERE businessserviceid='<bs-uuid>';"
docker exec docker-postgres psql -U egov -d egov -c "DELETE FROM eg_wf_businessservice_v2 WHERE uuid='<bs-uuid>';"
```
**Verified:** re-ran api+smoke + citizen+employee on Compose → **17 tests flipped fail/skip → pass, 0 regressions**; Compose reaches **113 pass, level with k3s**.
**Permanent fix:** the city-tenant onboarding (`digit-xlsx-onboard` / `tenant_bootstrap`) must register the `PGR` businessservice at the **city** tenant, not only the root — *or* configure egov-workflow-v2 to fall back to the root-tenant businessservice when a city has none.

## §1.10 · Configurator DSS / PGR dashboard doesn't render on **k3s** — Spring gateway NPEs on bodyless GET  🅿️ DEFERRED (root-caused; needs upstream gateway image rebuild)
**Status:** parked as a known, accepted k3s-only gap (5 dashboard tests). Fully root-caused below; not fixable via CCRS chart/env/config — needs an upstream `egovernments/Digit-Core` gateway fix + image rebuild. Compose/bomet unaffected. Revisit when the gateway image is rebuilt or an upstream issue is filed.
**Symptom (k3s-only):** 5 admin tests — `overview card shows 3 KPI metrics`, `KPI values show numbers`, `all chart canvases render`, `chart section titles are visible`, `breakdown table with 4 tabs` — pass on Compose **and** bomet but fail on k3s. Not stale data: a k3s admin re-run *with PGR complaints present* (post-§1.9) reproduced the failures byte-identically (40/22/51).
**How it surfaced:** invisible until §1.9 — the complaint pipeline had to work before the dashboard tests could reach the chart assertions. Fixing Compose (§1.9) exposed this mirror-image k3s gap.
**Root cause (confirmed):** the dashboard (`${CONFIGURATOR_BASE}/manage/pgr-dashboard`, Chart.js) fetches aggregates from **`GET /pgr-services/v2/dashboard?tenantId=<state>`** (bare `fetch`, no auth — `configurator/src/hooks/usePgrDashboardData.ts:251`). The hook returns `null` when the fetch fails, so the whole dashboard renders a blank shell (which is why even the section titles/canvases are absent, not just empty). On k3s that GET returns **HTTP 500 `NullPointerException: "value"`** — and the request **never reaches pgr-services** (no TracerFilter log). The 500 comes from the **k3s Spring Cloud Gateway**:
```
java.lang.NullPointerException: value
  at java.util.Objects.requireNonNull(Objects.java:235)
  at reactor.core.publisher.Mono.just(Mono.java:753)
  at com.example.gateway.filters.pre.helpers.CorrelationIdFilterHelper.apply(CorrelationIdFilterHelper.java:77)
  at ...ModifyRequestBodyGatewayFilterFactory$1.lambda$filter$1(ModifyRequestBodyGatewayFilterFactory.java:74)
```
The gateway (`egovio/gateway:v2.9.2-4a60f20`, `gateway-1.0.1-SNAPSHOT.jar`) has a `CorrelationIdFilter` **GlobalFilter** that rewrites every request body to inject the correlation id into `RequestInfo`. Decompiled dispatch (`CorrelationIdFilter.filter()`):
```java
String contentType = headers.getFirst("Content-Type");
if (path.contains("/filestore"))          return chain.filter(exchange);   // hardcoded skip
if (contentType != null && (contentType.contains("multipart/form-data")
                         || contentType.contains("x-www-form-urlencoded")))
      → CorrIdFormDataFilterHelper (MultiValueMap);
else  → CorrelationIdFilterHelper (JSON, inClass=Map);   // ← null Content-Type lands HERE
```
`CorrelationIdFilterHelper.apply(exchange, Map body)` ends (line 77) with `return Mono.just(body)`. For a bodyless request `body` is **null** → `Mono.just(null)` → `Objects.requireNonNull` NPE with message `"value"`.
**Trigger is body-presence, NOT the HTTP verb (proven):** `POST` with a JSON body → 200; the *same* `POST` with **no** body → 500; `GET` with `Content-Type: application/json` and no body → 500. Any request that reaches the JSON helper with an absent body NPEs.
**Blast radius — much wider than the dashboard:** *every* bodyless GET through the k3s gateway 500s. Probed live on k3s: `/pgr-services/v2/dashboard`, `/egov-workflow-v2/...` (as GET), `/egov-hrms/...` (as GET) → all 500; `/filestore/...` → 200 (the hardcoded carve-out). All `@GetMapping` endpoints are affected (also `novu-bridge`'s `/integrations`,`/logs`,`/preferences`,`/providers/templates`). The suite only *surfaces* the dashboard because DIGIT is ~99% POST-based — the dashboard is the one GET the UI tests drive. **The hardcoded `/filestore` skip is evidence the bug was known upstream but patched only for the one case they hit, never generalized.**
**Ruled out (with evidence):** not data (MVs `pgr_mv_kpi/monthly/dimension` identical + no nulls on both); not image drift (pgr-services same digest `sha256:66dbe74ba0fe`, same jar); not a missing MV; not `state.level.tenantid.length` (=1 on both); not the service at all (request never reaches pgr-services — no TracerFilter log; the trace is in the gateway pod).
**No config mitigation exists (verified):** the gateway's `ApplicationProperties` exposes only `openEndpointsWhitelist` / `mixedModeEndpointsWhitelist` / `encryptedUrlSet` (all auth-scoped) — none gate the body-modify. The `/filestore` skip is a compiled-in string literal, not configurable. Adding the endpoint to `EGOV_OPEN_ENDPOINTS_WHITELIST` + restart was tested → still 500 (whitelist governs auth; the body-modify runs globally, pre-auth). So this **cannot** be fixed by chart/env/whitelist.
**Permanent fix — upstream gateway image rebuild (`egovio/gateway`):**
1. *Dispatch (preferred):* in `CorrelationIdFilter.filter()`, generalize the `/filestore` carve-out — skip the ModifyRequestBody when the request carries no body (e.g. `GET`/`DELETE`/`HEAD`, or `Content-Length == 0`): `return chain.filter(exchange);`. The correlation id is body-only enrichment (into `RequestInfo` + MDC), so bodyless requests need no rewrite.
2. *Defensive (also):* in `CorrelationIdFilterHelper.apply` **and** `CorrIdFormDataFilterHelper.apply`, return `Mono.justOrEmpty(body)` instead of `Mono.just(body)` so a null body can never NPE.
This is an upstream DIGIT platform bug (any bodyless GET 500s), not a CCRS/config issue. Until the image is rebuilt, the DSS dashboard cannot render on k3s; Kong-fronted deployments (Compose) are unaffected because Kong does no body rewrite.
**Upstream status (checked 2026-07): NOT reported.** Source confirmed at `egovernments/Digit-Core` → `core-services/gateway/src/main/java/com/example/gateway/filters/pre/CorrelationIdFilter.java` (`/filestore` skip + content-type dispatch) and `.../helpers/CorrelationIdFilterHelper.java:77` (`return Mono.just(body);`) — our decompiled line number matched the source exactly, and HEAD is still unfixed. A GitHub issue search (org-wide + global, every phrasing) found **no** issue describing the general bodyless-GET NPE. → worth filing upstream against `egovernments/Digit-Core`.

**Mistake or conscious choice? → Mistake (unguarded null on the framework-return path), not a design decision to reject GETs.** Evidence, all from the source:
- The gateway has a dedicated, **HTTP-method-aware** helper `CommonUtils.isRequestBodyCompatible()` = `(POST|PUT|PATCH) && (json|form)` — i.e. it *explicitly* classifies GET/DELETE/HEAD as bodyless. `getTenantIdsFromRequest()` uses it and, for bodyless requests, **gracefully falls back to `setTenantIdsFromQueryParams()`**. So bodyless requests were consciously modelled and handled correctly — the intended behaviour for them is "read tenant from query params and pass through," not "500."
- `apply()` never writes the correlation id **into** the body (it goes to `MDC` + exchange attributes). The `ModifyRequestBody` wrap is used only as a filter hook; `return Mono.just(body)` just echoes the body back per the `RewriteFunction` contract. The null case was simply forgotten — a one-word fix (`Mono.justOrEmpty(body)`) resolves it.
- The `/filestore` bypass was **added in PR [#400](https://github.com/egovernments/Digit-Core/pull/400)** ("Gateway filestore fix", 2024-05-28) — the *same* PR that also touched `CommonUtils.java`. So in the very change where they added bodyless-awareness, they special-cased the one bodyless route that crashed (filestore GET downloads) instead of guarding the return. That's a symptom band-aid under deadline, not a stance that GETs are unsupported.
- A deliberate "POST-only" gateway would reject GETs with a clean 4xx or pass them through — not throw `NullPointerException`/500.
- *Underlying context (the kernel of truth):* DIGIT's convention is POST-with-`RequestInfo` for **every** API (even `_search`/`_count`), and the gateway is designed around body enrichment — so GET APIs are genuinely unconventional here, and the `/pgr-services/v2/dashboard` GET is mildly against that grain. But an unconventional-yet-valid request crashing the gateway is still a defect: the code's own bodyless-handling path shows what it *should* have done.
