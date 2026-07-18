# Dump-based K8S seeding + DDH retirement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed the Helm (`devops/deploy-as-code`) deploy's external managed Postgres from the checked-in `full-dump.sql` via a guarded restore Job, make per-service Flyway no-op against the pre-loaded schema, and retire the `default-data-handler` (DDH) runtime seeder.

**Architecture:** A CI-built `db-dump` OCI image bakes `local-setup/db/full-dump.sql`. A new `db-dump-restore` Helm chart deploys a one-shot Job that runs *after* backbone-services (DB reachable) and *before* core-services (before any Flyway initContainer), gated by an opt-in flag **and** an empty-DB SQL sentinel; on a virgin DB it `psql`-restores the dump. Each service's Flyway `schemaTable` is repointed to the dump's actual history-table names so migrations register as applied. DDH is set `installed: false` (staged, reversible).

**Tech Stack:** Helm, Helmfile, Kubernetes Job, `psql` (postgres:16-alpine), Flyway (`egovio/flyway`), Bash.

## Global Constraints

- **Target only `devops/deploy-as-code`.** Do not touch `local-setup/k8s`, the compose files, or the ansible path.
- **DB is external + managed** (`egov-config` configmap: `db-host` = `host[:port]`, `db-name`, `db-url` = JDBC). No in-cluster Postgres, no `initdb.d`, no ConfigMap for the 11 MB dump.
- **DB credentials:** Kubernetes Secret named `db` in namespace `egov`, keys `username` / `password` (and `flyway-username` / `flyway-password`). Use `username`/`password` for the restore (DDL-capable).
- **Namespace:** `egov` for the Job (matches services); configmap `egov-config` and secret `db` live there.
- **Safety is non-negotiable:** the restore must be a no-op unless (a) `dbDump.enabled: true` AND (b) the DB has no `public.egov_user_schema_version` table. Both branches exit 0.
- **Dump is the single source of truth** at `local-setup/db/full-dump.sql` — reference it, do not copy it into `devops/`.
- **Frequent commits**, one per task.
- Work on branch `feat/k8s-dump-seeding-remove-ddh` (already checked out).

## Reference data (verified against the repo, 2026-07-18)

**Dump's Flyway history tables** (from `full-dump.sql`): `accesscontrol_schema_version`, `boundary_schema_version`, `egov_idgen_schema_version`, `egov_localization_schema_version`, `egov_url_shortening_schema_version`, `egov_user_schema_version`, `enc_schema_version`, `filestore_schema_version`, `hrms_schema_version`, `mdms_schema_version`, `pgr_services_schema`, `workflow_schema_version`.

**Flyway `schemaTable` reconciliation** (Helm current → must become the dump's name). Only services whose tables exist in the dump AND that have `dbMigration.enabled: true`:

| Service values.yaml | Current `schemaTable` | New `schemaTable` |
|---|---|---|
| `core-services/egov-filestore/values.yaml` | `"egov_filestore_schema"` | `"filestore_schema_version"` |
| `core-services/egov-url-shortening/values.yaml` | `"egov-url-shortening_schema"` | `"egov_url_shortening_schema_version"` |
| `core-services/boundary-service/values.yaml` | `"boundary_service_schema"` | `"boundary_schema_version"` |
| `core-services/egov-idgen/values.yaml` | `"egov_idgen_schema"` | `"egov_idgen_schema_version"` |
| `core-services/egov-user/values.yaml` | `"egov_user_schema"` | `"egov_user_schema_version"` |
| `core-services/egov-localization/values.yaml` | `"egov_localization_schema"` | `"egov_localization_schema_version"` |
| `core-services/mdms-v2/values.yaml` | `"mdms_v2_schema"` | `"mdms_schema_version"` |
| `core-services/egov-workflow-v2/values.yaml` | `"egov_workflow_v2_schema"` | `"workflow_schema_version"` |
| `core-services/egov-enc-service/values.yaml` | `"egov_enc_service_schema"` | `"enc_schema_version"` |
| `common-services/egov-hrms/values.yaml` | `"egov_hrms_schema"` | `"hrms_schema_version"` |

**No change needed:** `urban/pgr-services` (`pgr_services_schema` already matches); `egov-accesscontrol` (no `dbMigration` block — its dump history table is inert); every service whose tables are absent from the dump (xstate-chatbot, audit-service, service-request, egov-otp, boundary-bulk-bff, egov-indexer, pdf-service, novu-bridge, digit-config-service, egov-user-event, egov-bndry-mgmnt, digit-user-preferences-service) — those Flyway runs create their schema fresh, no conflict.

**Helmfile deploy order** (`digit-helmfile.yaml`): backbone → core → urban → common-services → analytics → auxiliary. The restore Job must be inserted **between backbone and core**.

---

## Task 1: `db-dump` image (Dockerfile + build registration)

**Files:**
- Create: `local-setup/db/Dockerfile`
- Modify: `build/build-config.yml` (append a build entry)

**Interfaces:**
- Produces: an image named `db-dump` containing `psql` and the dump at `/dump/full-dump.sql`. Consumed by Task 2's Job (`.Values.dbDump.image`).

- [ ] **Step 1: Write the Dockerfile**

Create `local-setup/db/Dockerfile`:

```dockerfile
# Minimal image carrying psql + the checked-in DIGIT DB snapshot.
# Consumed by the db-dump-restore Job (devops/deploy-as-code) to seed a
# fresh external managed Postgres. Dump stays the single source of truth
# at local-setup/db/full-dump.sql (also used by compose + local-setup/k8s).
FROM postgres:16-alpine
COPY full-dump.sql /dump/full-dump.sql
```

- [ ] **Step 2: Build the image and verify contents**

Run:
```bash
cd local-setup/db && docker build -t db-dump:test .
docker run --rm db-dump:test sh -c 'which psql && wc -l /dump/full-dump.sql'
```
Expected: prints a `psql` path and a non-zero line count (~thousands) for `/dump/full-dump.sql`.

- [ ] **Step 3: Register the image in build-config**

In `build/build-config.yml`, append a new top-level entry under the existing `config:` list (match the two-space indentation of the existing `- name:` entries; place it after the `utilities/default-data-handler` block):

```yaml
  - name: "builds/Citizen-Complaint-Resolution-System/local-setup/db"
    build:
      - work-dir: "local-setup/db"
        image-name: "db-dump"
        dockerfile: "local-setup/db/Dockerfile"
```

- [ ] **Step 4: Verify build-config is valid YAML and the entry parses**

Run:
```bash
python3 -c "import yaml,sys; d=yaml.safe_load(open('build/build-config.yml')); names=[b['image-name'] for c in d['config'] for b in c.get('build',[]) if 'image-name' in b]; print('db-dump' in names, names.count('db-dump'))"
```
Expected: `True 1`

- [ ] **Step 5: Commit**

```bash
git add local-setup/db/Dockerfile build/build-config.yml
git commit -m "feat(devops): add db-dump image baking full-dump.sql for K8S seeding"
```

---

## Task 2: `db-dump-restore` Helm chart (guarded restore Job)

**Files:**
- Create: `devops/deploy-as-code/charts/db-seed/db-dump-restore/Chart.yaml`
- Create: `devops/deploy-as-code/charts/db-seed/db-dump-restore/values.yaml`
- Create: `devops/deploy-as-code/charts/db-seed/db-dump-restore/templates/job.yaml`

**Interfaces:**
- Consumes: image from Task 1 (`.Values.dbDump.image.repository` / `.tag`); Secret `db`; ConfigMap `egov-config`.
- Produces: a Job `db-dump-restore` gated by `.Values.dbDump.enabled` + SQL sentinel. Consumed by Task 3's helmfile release (release name `db-dump-restore`, chart `./db-dump-restore`).

- [ ] **Step 1: Write Chart.yaml**

Create `devops/deploy-as-code/charts/db-seed/db-dump-restore/Chart.yaml`:

```yaml
apiVersion: v2
name: db-dump-restore
description: One-shot guarded Job that restores full-dump.sql into a fresh managed Postgres
type: application
version: 0.1.0
appVersion: "1.0"
```

- [ ] **Step 2: Write values.yaml**

Create `devops/deploy-as-code/charts/db-seed/db-dump-restore/values.yaml`:

```yaml
dbDump:
  # Master opt-in. Default false: no Job is rendered, deploy is a normal upgrade.
  enabled: false
  image:
    repository: db-dump   # operator overrides with the full registry path
    tag: latest
    pullPolicy: IfNotPresent
  # Namespace where the `db` secret and `egov-config` configmap live.
  namespace: egov
  # backoffLimit for the Job; guard makes re-runs safe no-ops.
  backoffLimit: 1
```

- [ ] **Step 3: Write the Job template**

Create `devops/deploy-as-code/charts/db-seed/db-dump-restore/templates/job.yaml`:

```yaml
{{- if .Values.dbDump.enabled }}
apiVersion: batch/v1
kind: Job
metadata:
  name: db-dump-restore
  namespace: {{ .Values.dbDump.namespace }}
  labels:
    app: db-dump-restore
    group: db-seed
spec:
  backoffLimit: {{ .Values.dbDump.backoffLimit }}
  template:
    metadata:
      labels:
        app: db-dump-restore
    spec:
      restartPolicy: OnFailure
      containers:
        - name: db-dump-restore
          image: "{{ .Values.dbDump.image.repository }}:{{ .Values.dbDump.image.tag }}"
          imagePullPolicy: {{ .Values.dbDump.image.pullPolicy }}
          env:
            - name: DB_HOST
              valueFrom:
                configMapKeyRef:
                  name: egov-config
                  key: db-host
            - name: DB_NAME
              valueFrom:
                configMapKeyRef:
                  name: egov-config
                  key: db-name
            - name: DB_USER
              valueFrom:
                secretKeyRef:
                  name: db
                  key: username
            - name: PGPASSWORD
              valueFrom:
                secretKeyRef:
                  name: db
                  key: password
          command:
            - /bin/sh
            - -c
            - |
              set -eu
              # db-host may be "host" or "host:port"; split it.
              HOST="${DB_HOST%%:*}"
              PORT="${DB_HOST##*:}"
              [ "$PORT" = "$DB_HOST" ] && PORT=5432
              PSQL="psql -h $HOST -p $PORT -U $DB_USER -d $DB_NAME -v ON_ERROR_STOP=1 -tA"
              echo "Checking whether $DB_NAME on $HOST:$PORT is already provisioned..."
              PROVISIONED=$($PSQL -c "SELECT (to_regclass('public.egov_user_schema_version') IS NOT NULL)::int;")
              if [ "$PROVISIONED" = "1" ]; then
                echo "DB already provisioned (public.egov_user_schema_version exists) — skipping restore."
                exit 0
              fi
              echo "DB is empty — restoring /dump/full-dump.sql ..."
              $PSQL -f /dump/full-dump.sql
              echo "Restore complete."
{{- end }}
```

- [ ] **Step 4: Verify the Job renders only when enabled**

Run:
```bash
cd devops/deploy-as-code/charts/db-seed
helm template db-dump-restore ./db-dump-restore | grep -c 'kind: Job'
helm template db-dump-restore ./db-dump-restore --set dbDump.enabled=true | grep -c 'kind: Job'
```
Expected: first prints `0`, second prints `1`.

- [ ] **Step 5: Verify the sentinel + restore appear in the rendered Job**

Run:
```bash
helm template db-dump-restore ./db-dump-restore --set dbDump.enabled=true | grep -E "egov_user_schema_version|full-dump.sql|skipping restore"
```
Expected: all three strings appear.

- [ ] **Step 6: Commit**

```bash
git add devops/deploy-as-code/charts/db-seed/db-dump-restore
git commit -m "feat(devops): db-dump-restore chart with opt-in flag + empty-DB sentinel"
```

---

## Task 3: Wire the restore release into helmfile ordering

**Files:**
- Create: `devops/deploy-as-code/charts/db-seed/db-seed-helmfile.yaml`
- Modify: `devops/deploy-as-code/digit-helmfile.yaml`

**Interfaces:**
- Consumes: chart from Task 2 (release `db-dump-restore`, chart `./db-dump-restore`).
- Produces: an ordered, waited release between backbone and core so the Job completes before Flyway initContainers run.

- [ ] **Step 1: Write the db-seed group helmfile**

Create `devops/deploy-as-code/charts/db-seed/db-seed-helmfile.yaml` (mirrors `urban-helmfile.yaml`'s structure; adds `wait`/`timeout` so helmfile blocks on Job completion):

```yaml
environments:
  env:
    values:
      - ../environments/env-secrets.yaml
      - ../environments/env.yaml
---
templates:
  default: &default
    chart: ./{{`{{ .Release.Name }}`}}
    namespace: egov
    missingFileHandler: Warn
    # Block helmfile until the restore Job completes, so core-services
    # Flyway initContainers see the pre-loaded schema.
    wait: true
    timeout: 900
    values:
      - {{ .Values | toYaml | nindent 8 }}

releases:
  - name: db-dump-restore
    installed: true
    <<: *default
```

- [ ] **Step 2: Insert the helmfile path between backbone and core**

In `devops/deploy-as-code/digit-helmfile.yaml`, add the db-seed path so the `helmfiles:` list reads exactly:

```yaml
helmfiles:
  - path: ./charts/backbone-services/backboneservices-helmfile.yaml
  - path: ./charts/db-seed/db-seed-helmfile.yaml
  - path: ./charts/core-services/coreservices-helmfile.yaml
  - path: ./charts/urban/urban-helmfile.yaml
  - path: ./charts/common-services/common-services-helmfile.yaml
  - path: ./charts/analytics/analytics-helmfile.yaml
  - path: ./charts/auxiliary-services/auxiliary-helmfile.yaml
```

- [ ] **Step 3: Verify order — db-seed sits between backbone and core**

Run:
```bash
cd devops/deploy-as-code
grep -n "path:" digit-helmfile.yaml
```
Expected: `db-seed-helmfile.yaml` appears on the line immediately after `backboneservices-helmfile.yaml` and before `coreservices-helmfile.yaml`.

- [ ] **Step 4: Verify the group helmfile lists the release**

Run:
```bash
grep -E "name: db-dump-restore|wait: true" charts/db-seed/db-seed-helmfile.yaml
```
Expected: both lines print.

- [ ] **Step 5: Commit**

```bash
git add devops/deploy-as-code/charts/db-seed/db-seed-helmfile.yaml devops/deploy-as-code/digit-helmfile.yaml
git commit -m "feat(devops): run db-dump-restore between backbone and core with wait"
```

---

## Task 4: Align per-service Flyway `schemaTable` to the dump's history tables

**Files (Modify — all under `devops/deploy-as-code/charts/`):**
- `core-services/egov-filestore/values.yaml`
- `core-services/egov-url-shortening/values.yaml`
- `core-services/boundary-service/values.yaml`
- `core-services/egov-idgen/values.yaml`
- `core-services/egov-user/values.yaml`
- `core-services/egov-localization/values.yaml`
- `core-services/mdms-v2/values.yaml`
- `core-services/egov-workflow-v2/values.yaml`
- `core-services/egov-enc-service/values.yaml`
- `common-services/egov-hrms/values.yaml`

**Interfaces:**
- Consumes: the dump's history-table names (Reference data table above).
- Produces: each listed service's `dbMigration` initContainer will use `SCHEMA_TABLE` = the dump's history table → Flyway sees migrations as applied → no `42P07`.

- [ ] **Step 1: Apply all ten `schemaTable` edits**

For each file, replace the `schemaTable:` value inside its `dbMigration:` block per the table below (the surrounding two-space indentation under `dbMigration:` is preserved; only the quoted value changes):

```
core-services/egov-filestore/values.yaml       "egov_filestore_schema"        -> "filestore_schema_version"
core-services/egov-url-shortening/values.yaml  "egov-url-shortening_schema"   -> "egov_url_shortening_schema_version"
core-services/boundary-service/values.yaml     "boundary_service_schema"      -> "boundary_schema_version"
core-services/egov-idgen/values.yaml           "egov_idgen_schema"            -> "egov_idgen_schema_version"
core-services/egov-user/values.yaml            "egov_user_schema"             -> "egov_user_schema_version"
core-services/egov-localization/values.yaml    "egov_localization_schema"     -> "egov_localization_schema_version"
core-services/mdms-v2/values.yaml              "mdms_v2_schema"               -> "mdms_schema_version"
core-services/egov-workflow-v2/values.yaml     "egov_workflow_v2_schema"      -> "workflow_schema_version"
core-services/egov-enc-service/values.yaml     "egov_enc_service_schema"      -> "enc_schema_version"
common-services/egov-hrms/values.yaml          "egov_hrms_schema"             -> "hrms_schema_version"
```

Use exact-string edits, e.g. for egov-filestore change `schemaTable: "egov_filestore_schema"` to `schemaTable: "filestore_schema_version"`.

- [ ] **Step 2: Verify every service now points at the dump's history table**

Run:
```bash
cd devops/deploy-as-code/charts
for pair in \
 "egov-filestore filestore_schema_version" \
 "egov-url-shortening egov_url_shortening_schema_version" \
 "boundary-service boundary_schema_version" \
 "egov-idgen egov_idgen_schema_version" \
 "egov-user egov_user_schema_version" \
 "egov-localization egov_localization_schema_version" \
 "mdms-v2 mdms_schema_version" \
 "egov-workflow-v2 workflow_schema_version" \
 "egov-enc-service enc_schema_version"; do
   set -- $pair; grep -q "schemaTable: \"$2\"" core-services/$1/values.yaml && echo "OK $1" || echo "FAIL $1"
 done
grep -q 'schemaTable: "hrms_schema_version"' common-services/egov-hrms/values.yaml && echo "OK egov-hrms" || echo "FAIL egov-hrms"
```
Expected: ten `OK ...` lines, zero `FAIL`.

- [ ] **Step 3: Verify no stale old names remain**

Run:
```bash
grep -rn 'schemaTable: "egov_filestore_schema"\|schemaTable: "mdms_v2_schema"\|schemaTable: "egov_workflow_v2_schema"\|schemaTable: "egov_enc_service_schema"\|schemaTable: "egov_hrms_schema"' devops/deploy-as-code/charts || echo "clean"
```
Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add devops/deploy-as-code/charts/core-services devops/deploy-as-code/charts/common-services/egov-hrms/values.yaml
git commit -m "fix(devops): point service Flyway schemaTable at dump history tables to avoid 42P07"
```

---

## Task 5: Retire DDH (staged — installed: false)

**Files:**
- Modify: `devops/deploy-as-code/charts/urban/urban-helmfile.yaml`

**Interfaces:**
- Produces: DDH no longer deployed; chart and `utilities/default-data-handler/src/main/resources` files kept (seed-notifications.py + drift tests depend on them).

- [ ] **Step 1: Set the DDH release to installed: false**

In `devops/deploy-as-code/charts/urban/urban-helmfile.yaml`, change the `default-data-handler` release's `installed: true` to `installed: false`. Add a trailing comment so the intent is clear:

```yaml
  - name: default-data-handler # Retired: dump-based seeding replaces DDH. Kept for rollback.
    installed: false
    <<: *default
```

- [ ] **Step 2: Verify DDH is the only release turned off and others remain on**

Run:
```bash
grep -n -A2 "name: default-data-handler" devops/deploy-as-code/charts/urban/urban-helmfile.yaml
grep -c "installed: true" devops/deploy-as-code/charts/urban/urban-helmfile.yaml
```
Expected: shows `installed: false` under `default-data-handler`; the `installed: true` count is `3` (pgr-services, digit-ui, egov-bndry-mgmnt).

- [ ] **Step 3: Verify the chart + resource files are untouched**

Run:
```bash
test -f devops/deploy-as-code/charts/urban/default-data-handler/Chart.yaml && test -d utilities/default-data-handler/src/main/resources && echo "files intact"
```
Expected: `files intact`.

- [ ] **Step 4: Commit**

```bash
git add devops/deploy-as-code/charts/urban/urban-helmfile.yaml
git commit -m "chore(devops): stop deploying default-data-handler (staged retirement)"
```

---

## Task 6: Integration verification (manual runbook)

No code changes. This task documents the exact steps the operator runs to prove the change end-to-end. Per project practice, verification is manual (operator self-verifies) — do not automate with headless scripting.

**Files:**
- Create: `docs/superpowers/plans/2026-07-18-k8s-dump-seeding-verification.md` (the runbook below)

- [ ] **Step 1: Write the verification runbook**

Create `docs/superpowers/plans/2026-07-18-k8s-dump-seeding-verification.md` with:

```markdown
# Verification: dump-based K8S seeding + DDH retirement

Prereqs: CI has built and pushed the `db-dump` image; `dbDump.image.repository`
in db-dump-restore values (or an env override) points at that pushed image;
`egov-config` (db-host/db-name) and secret `db` are set for the target env.

## A. Fresh DB, flag ON — dump loads, no Flyway conflicts
1. Point at a brand-new empty managed DB (no DIGIT schema).
2. Deploy with the flag on:
   `helmfile -f digit-helmfile.yaml sync --set dbDump.enabled=true`
3. Confirm the restore Job ran and loaded the dump:
   `kubectl -n egov logs job/db-dump-restore` → shows "DB is empty — restoring" then "Restore complete."
4. Confirm NO service dbMigration initContainer hit 42P07:
   `kubectl -n egov get pods` → all core/common/urban pods Running/Completed;
   spot-check `kubectl -n egov logs <pod> -c db-migration` for egov-user, mdms-v2,
   egov-workflow-v2, egov-enc-service, egov-hrms → Flyway reports "Successfully validated"
   / "up to date" (no "relation already exists").
5. Confirm DDH's former output is present (dump carried it):
   `psql ... -c "SELECT count(*) FROM tenant.tenants;"` → >= 1;
   MDMS DataSecurity + PGR ComplaintHierarchy present; enc-service pod Ready.
6. Confirm DDH is NOT deployed:
   `kubectl -n egov get deploy | grep default-data-handler` → no result.

## B. Re-deploy against the seeded DB — guard skips
1. Re-run: `helmfile -f digit-helmfile.yaml sync --set dbDump.enabled=true`
2. `kubectl -n egov logs job/db-dump-restore` (latest) → shows
   "DB already provisioned ... skipping restore." and exits 0. No data change.

## C. Flag OFF (default) — no Job at all
1. `helmfile -f digit-helmfile.yaml sync` (flag defaults false)
2. `kubectl -n egov get job db-dump-restore` → not found. Normal upgrade.

## Rollback
Set `default-data-handler` back to `installed: true` in urban-helmfile.yaml and
`helmfile sync` to restore the old seeding path.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-07-18-k8s-dump-seeding-verification.md
git commit -m "docs: verification runbook for dump-based K8S seeding + DDH retirement"
```

---

## Notes for the executor

- **Do not run `helmfile sync` yourself** against any real cluster — Tasks 1–5 are render/lint/grep-verified only; live verification (Task 6) is the operator's, run manually.
- If `helm`/`helmfile` binaries are unavailable in the execution environment, the `helm template` verification steps can be replaced by a `python3 -c "import yaml; yaml.safe_load(...)"` parse check of the rendered template file plus a `grep` of the raw template — note the substitution in the task's checkbox rather than skipping the verification.
- The `db-dump` image `repository` in Task 2 values defaults to a bare `db-dump`; the operator/env overrides it with the real registry path (same mechanism as other service images). Do not hardcode a registry.
