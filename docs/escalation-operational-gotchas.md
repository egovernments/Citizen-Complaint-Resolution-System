# Escalation — Operational Gotchas (Bash Recipes)

Companion to [`escalation-feature-design.md`](escalation-feature-design.md). The
design doc names every trap; this doc gives you a verbatim block to paste into
a terminal connected to the affected deployment.

## How to use

Each gotcha below follows **Symptom → Root cause → Fix**. Copy the `Fix` block
verbatim into a terminal connected to the affected deployment (replace the
placeholders — `<tenant>`, `<schema-code>`, `<srid>`, `<TOKEN>` — with the
real values for the environment you are repairing).

Conventions:

- `docker-postgres` is the postgres container name on Bomet/Nairobi (DIGIT
  default). On older boxes it may be `digit-postgres-1`; substitute as needed.
- `<deployment-host>` stands for the SSH alias of the target box as configured
  in your own `~/.ssh/config`. Substitute `root@<ansible_host>` if you do not
  have an alias.
- Every `curl` against `/mdms-v2/v2/_search` assumes you already minted an
  ADMIN OAuth token and exported it as `TOKEN`. The first recipe below shows
  how.
- Recipes are idempotent unless flagged otherwise. Re-running a `Fix` block
  that already succeeded should be a no-op.

### Mint an ADMIN token (used by every `curl` recipe below)

```bash
DOMAIN=<deployment-domain>    # or <other-deployment-domain>
TENANT=ke                            # root tenant on Bomet/Nairobi

TOKEN=$(curl -sf -X POST \
  "https://$DOMAIN/user/oauth/token" \
  -H "Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=ADMIN&password=<ADMIN_PASSWORD>&grant_type=password&scope=read&tenantId=$TENANT&userType=EMPLOYEE" \
  | jq -r '.access_token')

echo "$TOKEN" | head -c 20; echo "..."   # sanity check it minted
```

---

## 1. `x-ref-schema` regression (HTTP 400 on `_create`)

**Symptom.** `POST /mdms-v2/v2/_create/CRS.*` returns HTTP 400 with
`org.json.JSONObject cannot be cast to org.json.JSONArray`, thrown at
`MdmsDataValidator.validateReference:140`.

**Root cause.** An earlier draft of `CRS.json` registered `x-ref-schema` as
`{}` instead of `[]`. mdms-v2 schema/v1 has no public `_update` endpoint, so
the schema cannot be re-uploaded through the API — it has to be patched
directly in Postgres.

**Fix.** Pipe the canonical seed script into the Postgres container. Safe to
re-run (the `WHERE` clauses skip already-fixed rows):

```bash
# From a checkout of this repo on the dev box:
ssh <deployment-host> docker exec -i docker-postgres psql -U egov -d egov \
  < configurator/src/resources/crs/sla-matrix/_seed/fix-xref-schema.sql

# Or, inline one-liner if the seed script is not handy (replace <schema-code>
# with e.g. CRS.CategorySLA):
ssh <deployment-host> docker exec -i docker-postgres psql -U egov -d egov -c \
  "UPDATE eg_mdms_schema_definition
      SET definition = jsonb_set(definition, '{x-ref-schema}', '[]'::jsonb)
    WHERE code = '<schema-code>'
      AND definition->'x-ref-schema' = '{}'::jsonb;"
```

**Verify.** This should return zero rows once the fix has applied:

```bash
ssh <deployment-host> docker exec docker-postgres psql -U egov -d egov -c \
  "SELECT code FROM eg_mdms_schema_definition
    WHERE code LIKE 'CRS.%'
      AND definition->'x-ref-schema' = '{}'::jsonb;"
```

**No service restart needed.** `egov-mdms-v2` re-reads the schema row on every
request — the next `_create` call picks up the patched definition.

---

## 2. Compose recreations knock `egov-user` into `Created`

**Symptom.** After re-creating `pgr-services` on Bomet (e.g. via Ansible
overlay swap), `digit-egov-user-1` is in `Created` state, not `Running`.
Any PGR `_create` call fails with HTTP 500 and a `Connection refused` to
egov-user in the pgr-services logs.

**Root cause.** Docker Compose v2 quirk — when a *dependent* service exits
non-gracefully during a `compose up` (e.g. its image swap takes too long for
the depends_on healthcheck), the dependency it relies on can be left in
`Created` instead of being restarted. The dependency graph is correct on
paper; the runtime just dropped it.

**Fix.** Start the container by name. No restart of anything else needed:

```bash
ssh <deployment-host> docker start digit-egov-user-1
```

**Verify.** Container should report `running` immediately, then `healthy`
within ~30s once the JVM warms up:

```bash
ssh <deployment-host> "docker inspect digit-egov-user-1 --format='{{.State.Status}}'"
# expected: running

ssh <deployment-host> "docker inspect digit-egov-user-1 --format='{{.State.Health.Status}}'"
# expected (after ~30s): healthy
```

If it goes back into `Created` on the next compose run, the dependent service
has a real failure — check its logs (`docker logs --tail 100 digit-pgr-services-1`).

---

## 3. `mdms-v2` schema/v1 has no public `_update` endpoint

**Symptom.** You shipped a broken schema (typo in a property name, wrong type
on an `additionalProperties` clause, etc.) and `POST /mdms-v2/schema/v1/_create`
now 409s because the row already exists. There is no `_update`.

**Root cause.** Schema definitions are intentionally write-once in mdms-v2
schema/v1 — preserving audit history was prioritised over in-place edits. The
only escape hatch is a direct `UPDATE` on `eg_mdms_schema_definition`.

**Fix.** Direct DB `UPDATE`. **Always preserve `auditDetails`**: do not let
the new definition clobber `createdBy`/`createdTime`. Pattern:

```bash
SCHEMA_CODE='<schema-code>'                  # e.g. CRS.CategorySLA
NEW_DEFN_FILE='/tmp/new-definition.json'     # JSON for the schema body

# Stage the new definition on the target host
scp "$NEW_DEFN_FILE" <deployment-host>:/tmp/new-definition.json

ssh <deployment-host> docker cp /tmp/new-definition.json docker-postgres:/tmp/

ssh <deployment-host> docker exec -i docker-postgres psql -U egov -d egov <<SQL
  UPDATE eg_mdms_schema_definition
     SET definition  = pg_read_file('/tmp/new-definition.json')::jsonb,
         lastmodifiedtime = (EXTRACT(EPOCH FROM now()) * 1000)::bigint,
         lastmodifiedby   = 'manual-schema-patch'
   WHERE code = '$SCHEMA_CODE';
SQL
```

**Verify** the row matches what you uploaded and audit timestamps moved:

```bash
ssh <deployment-host> docker exec docker-postgres psql -U egov -d egov -c \
  "SELECT code, createdby, lastmodifiedby,
          to_timestamp(lastmodifiedtime/1000) AS modified_at
     FROM eg_mdms_schema_definition WHERE code = '$SCHEMA_CODE';"
```

**No service restart needed** (same as Gotcha #1) — mdms-v2 re-reads on
every request.

---

## 4. Persister is async — `POST /_create` returns 202, not 200

**Symptom.** `POST /mdms-v2/v2/_create/...` returns HTTP 202; a subsequent
`POST /mdms-v2/v2/_search` returns the *old* value (or `mdms: []` for fresh
keys). Indistinguishable on the wire from a quietly dropped write.

**Root cause.** `mdms-v2` (and other DIGIT write paths) publish to a Kafka
topic; `egov-persister` is the consumer that writes to Postgres. The 202 says
"accepted into Kafka", not "written to DB". Reads can race the persister by
1-5s on a healthy box, indefinitely on a wedged one.

**Status semantics.**

| Code     | Meaning                                  | Recipe              |
| -------- | ---------------------------------------- | ------------------- |
| 200, 202 | Accepted — poll the read until it lands  | retry loop below    |
| 4xx      | Client error (bad payload, missing perm) | don't retry, fix it |
| 5xx      | Transient (persister wedged, Kafka down) | back off + retry    |

**Fix.** Poll the search until the new value appears, with a hard cap:

```bash
DOMAIN=<deployment-domain>
TENANT=ke
SCHEMA=CRS.WorkflowStateMapping           # whatever you just wrote
EXPECTED_DATA='{"singletonKey":"default","mappings":{"PENDINGFORASSIGNMENT":"new","PENDINGATLME":"forwarded"}}'
MATCHED=false

for i in 1 2 3 4 5; do
  RESP=$(curl -sf -X POST \
    "https://$DOMAIN/mdms-v2/v2/_search?tenantId=$TENANT" \
    -H "Content-Type: application/json" \
    -d "{\"RequestInfo\":{\"authToken\":\"$TOKEN\"},
         \"MdmsCriteria\":{\"tenantId\":\"$TENANT\",
            \"moduleDetails\":[{\"moduleName\":\"CRS\",
              \"masterDetails\":[{\"name\":\"WorkflowStateMapping\"}]}]}}")
  if printf '%s' "$RESP" \
       | jq -e --argjson expected "$EXPECTED_DATA" \
           'any(.mdms[]?; .data == $expected)' > /dev/null; then
    echo "Expected value persisted after ${i} polls"
    MATCHED=true
    break
  fi
  echo "Poll $i: not yet, sleeping 2s..."
  sleep 2
done

if [ "$MATCHED" != true ]; then
  echo "Expected value was not persisted after 5 polls" >&2
  exit 1
fi
```

**If the loop exhausts** (5 polls × 2s = 10s and still not landed),
egov-persister is wedged. Diagnose:

```bash
# Is the persister container up?
ssh <deployment-host> docker ps --filter name=egov-persister --format '{{.Status}}'

# Is its consumer group caught up?
ssh <deployment-host> \
  "docker exec digit-redpanda rpk group describe egov-infra-persist 2>&1 \
   | grep -E 'TOPIC|LAG'"
# LAG should be 0 or very small; a 4-figure lag means it's behind / dead.

# Restart if needed:
ssh <deployment-host> docker restart digit-egov-persister-1
```

---

## 5. Historical: workflow `ASSIGN` payload lost assignees

**Symptom.** `/escalation/_trigger` returns
`skipBreakdown: { NO_ASSIGNEES: 55 }` even though every complaint shows an
ASSIGN history entry in the UI and PGR `_search` returns
`workflow.action == "ASSIGN"` against `status == "PENDINGATLME"`.

**Historical root cause.** `egov-workflow-v2` bound only the misspelled
`assignes` field. Clients that sent the correctly spelled `assignees` field
were silently decoded without an assignee, so the transition succeeded but no
`eg_wf_assignee_v2` row was inserted. The escalation scheduler reads from that
table (via the workflow `_processInstanceSearch` API) and correctly reported
`NO_ASSIGNEES` because the data was missing at the source.

**Current prerequisite.** The workflow fix accepts `assignees` as a JSON alias
and is tracked in
[eGovStack/core-services#1674](https://github.com/eGovStack/core-services/issues/1674).
Bomet verified it with `egov-workflow-v2:maven-jdk21-43f925c2`. Before enabling
escalation on another tenant, deploy an image containing that fix, perform a
fresh ASSIGN, and verify the join row with the query below.

**Diagnostic.** Confirm you're hitting the upstream bug (and not, e.g., a
permissions issue) by counting the assignee rows for a specific complaint
that you know was ASSIGNed:

```bash
SRID='<srid>'   # e.g. PG-PGR-2026-06-09-082555

ssh <deployment-host> docker exec docker-postgres psql -U egov -d egov -c \
  "SELECT pi.id AS process_instance_id,
          pi.businessid AS srid,
          pi.state_id_,
          (SELECT count(*) FROM eg_wf_assignee_v2 a
            WHERE a.processinstanceid = pi.id) AS assignee_rows
     FROM eg_wf_processinstance_v2 pi
    WHERE pi.businessid = '$SRID'
    ORDER BY pi.lastmodifiedtime DESC;"
```

If `assignee_rows` is `0` for a fresh ASSIGN on the fixed image, stop rollout
and inspect the request payload and deployed image. The `history=true` fallback in
[`EscalationService.getCurrentAssignees`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationService.java)
helps when the *current* `ProcessInstance` is empty but a historical one
carries assignees — but it cannot rescue rows that were never written.

---

## 6. `STATE_MAPPING_MISSING` after SLA resolution reaches v0

**Symptom.** `/escalation/_trigger` returns
`skipBreakdown: { STATE_MAPPING_MISSING: 55 }`, scheduler logs read
`Escalation skip — ... reason=STATE_MAPPING_MISSING`, and the affected
complaints report `slaSource: v0.EscalationConfig`.

**Root cause.** `CRS.WorkflowStateMapping` (one of six MDMS schemas, a singleton
operator-defined dictionary that maps PGR workflow state names to the
CRS-level keys `new|triage|forwarded|investigation|awaiting|resolved`) has
not been seeded for this tenant. The scheduler's `mapWorkflowStateToKey`
does a dictionary lookup and gets `null`. Per-level
`CRS.CategorySLA.slaHoursByLevel` or
`CRS.EscalationPolicy.defaultSlaHoursByLevel` values can still answer because
they do not need a state key. If neither does, the lookup reaches v0 and
reports `STATE_MAPPING_MISSING`.

**Diagnostic.** Confirm the schema record is missing (not just malformed):

```bash
DOMAIN=<deployment-domain>
TENANT=ke

curl -sf -X POST \
  "https://$DOMAIN/mdms-v2/v2/_search?tenantId=$TENANT" \
  -H "Content-Type: application/json" \
  -d "{\"RequestInfo\":{\"authToken\":\"$TOKEN\"},
       \"MdmsCriteria\":{\"tenantId\":\"$TENANT\",
          \"moduleDetails\":[{\"moduleName\":\"CRS\",
            \"masterDetails\":[{\"name\":\"WorkflowStateMapping\"}]}]}}" \
  | jq '.mdms[0].data.mappings // "MISSING"'
```

- Output `"MISSING"` (or empty array) → schema row not seeded.
- Output a non-empty object like `{ "PENDINGFORASSIGNMENT": "new", ... }` →
  seeded; the scheduler is failing for a different reason (read its log line
  for the actual state it tried to map).

**Fix.** Seed the dictionary. The canonical seed payload + the deployment
recipe live in the tenant onboarding runbook (linked from the parent
escalation PR description). Once `WorkflowStateMapping` is present, the
scheduler picks it up on the next tick — no restart required.

**Operator rule of thumb:** seed `CRS.WorkflowStateMapping` **before**
`CRS.StateSLA` and state-indexed `CRS.CategorySLA` values. Otherwise those
state sources look ignored; only configured per-level sources can answer
before the v0 fallback.

---

## 7. `UNMAPPED_CATEGORY` for every complaint

**Symptom.** `/escalation/_trigger` returns
`skipBreakdown: { UNMAPPED_CATEGORY: N }` (or the scheduler logs the same
reason). Complaints fall through to `CRS.StateSLA` (or further to v0) every
time, and the `CRS.CategorySLA` matrix is effectively unused.

**Root cause.** The CategorySLA lookup is keyed on the tuple
`(path, category, subcategoryL1)`. The scheduler reads these three fields
off the complaint via one of two generic strategies:

- **Strategy A — additionalDetail.** Each complaint's `service.additionalDetail`
  carries `path`, `category`, and `subcategoryL1` (or `subCategoryL1`)
  fields, written at create-time by the citizen UI / CRS dataloader.
- **Strategy B — ServiceDef extension.** The complaint's `serviceCode` resolves
  to a ServiceDef record that itself carries the three fields; the scheduler
  joins the complaint to its ServiceDef on each scan.

Either strategy is fine — but one of them has to be in play, or every lookup
returns `null` and trips `UNMAPPED_CATEGORY`.

**Diagnostic — Strategy A** (check whether complaints carry the keys):

```bash
DOMAIN=<deployment-domain>
TENANT=ke

# Pull a recent batch of complaints; check whether additionalDetail has the
# three keys CategorySLA needs.
curl -sf -X POST \
  "https://$DOMAIN/pgr-services/v2/request/_search?tenantId=$TENANT" \
  -H "Content-Type: application/json" \
  -d "{\"RequestInfo\":{\"authToken\":\"$TOKEN\"}}" \
  | jq '.ServiceWrappers[].service.additionalDetail
        | {path, category, subcategoryL1: (.subcategoryL1 // .subCategoryL1)}' \
  | head -40
```

If most rows show `{path: null, category: null, ...}`, Strategy A is not in
effect for this tenant.

**Diagnostic — Strategy B** (check whether ServiceDefs carry the keys):

```bash
ssh <deployment-host> docker exec docker-postgres psql -U egov -d egov -c \
  "SELECT code, data->'path' AS path,
                data->'category' AS category,
                data->'subcategoryL1' AS subcategoryL1
     FROM eg_mdms_data
    WHERE schemacode = 'RAINMAKER-PGR.ServiceDefs'
    LIMIT 10;"
```

If `path`/`category`/`subcategoryL1` come back as `null` for every row,
Strategy B is also off.

**Fix.** Pick a strategy and apply it consistently for this tenant. The
two-strategies write-up lives in
[`escalation-feature-design.md` § How a tenant wires the CategorySLA lookup](escalation-feature-design.md)
— it documents the data-shape contract and points at the dataloader / MDMS
update path for each strategy. Once complaints (or their ServiceDefs)
carry the three keys, the next scheduler tick resolves CategorySLA without
any further deploy.

---

## See also

- [`escalation-feature-design.md`](escalation-feature-design.md) — full design
  doc with schemas, scheduler internals, and rollout plan.
- [`escalation-feature-bomet.md`](escalation-feature-bomet.md) — what landed
  on the Bomet deployment and the verified-vs-blocked breakdown.
- GitHub Discussion #773 — open Q&A thread on the escalation design.
