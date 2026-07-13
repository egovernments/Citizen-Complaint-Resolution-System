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
