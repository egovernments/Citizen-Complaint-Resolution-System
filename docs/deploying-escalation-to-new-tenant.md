# Deploying CRS Escalation to a New Tenant — Operator Runbook

> **Audience**: deployment operators turning the escalation feature on for a
> fresh tenant (Kenya/PGR-flavoured, Mozambique/CRS-flavoured, or anything
> else).
> **Companions**: [`docs/escalation-feature-design.md`](./escalation-feature-design.md)
> for *why* each layer exists; [`docs/escalation-feature-bomet.md`](./escalation-feature-bomet.md)
> for the first live deployment's notes;
> [`docs/crs-configurator-roadmap.md`](./crs-configurator-roadmap.md) for
> related editor work.
> **PR**: [#770](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/770)
> · **Discussion**: [#773](https://github.com/egovernments/Citizen-Complaint-Resolution-System/discussions/773)

---

## Prerequisites

You need:

- **A running DIGIT installation** with the following services healthy:
  - `pgr-services` (with the PR #770 escalation patch baked in — image tag
    contains `escalation-otel` or later)
  - `mdms-v2`
  - `egov-persister`
  - `egov-workflow-v2`
  - `kafka` (or `redpanda`)
  - `tempo` (optional but strongly recommended — without it you lose the
    `escalation.slaSource` span attribute and trace-back is API-only)
- **An ADMIN account** with the `SUPERUSER` role in the root tenant
  (e.g. `tenantId=ke` for Kenya-style deployments, `tenantId=mz` for
  Mozambique). The escalation MDMS writes happen at the root level, not
  the city level.
- **Your tenant id** (e.g. `ke.bomet`, `ke.nairobi`, `mz.maputo`) for any
  per-city read-back verification.
- **Optional but useful**: SSH to the deployment host so you can grep
  `pgr-services` logs and run the recovery SQL described in
  [Common pitfalls](#common-pitfalls).

Throughout this runbook, replace:

- `<deployment>` with your hostname (e.g. `bometfeedbackhub.digit.org`)
- `<tenant>` with your root tenant id (e.g. `ke`)
- `<city>` with your city tenant id (e.g. `ke.bomet`)
- `$TOKEN` with the OAuth access token (see [Auth snippet](#auth-snippet)
  at the bottom)

---

## Architecture in one paragraph

The CRS escalation feature is a **three-layer SLA resolution** read by the
`pgr-services` scheduler — `CRS.CategorySLA` (per-tuple matrix) →
`CRS.StateSLA` (per-state singleton) → `RAINMAKER-PGR.EscalationConfig`
(legacy v0 fallback) — fronted by a fourth supporting schema
`CRS.WorkflowStateMapping` that translates the tenant's workflow state
names (`PENDINGFORASSIGNMENT`, `IN_TRIAGE`, ...) into the six canonical
SLA-column keys (`new | triage | forwarded | investigation | awaiting |
resolved`). The scheduler is tenant-agnostic; everything tenant-specific
lives in MDMS. See [`escalation-feature-design.md`](./escalation-feature-design.md)
for the full architecture, schemas, scheduler pseudocode and OTEL contract.

---

## Step 1: Seed `CRS.WorkflowStateMapping` (do this FIRST)

> **Why first?** The scheduler reads the mapping on every scan to translate
> the complaint's `applicationStatus` into the SLA-column key the other
> layers are keyed on. Without it, *every* candidate complaint trips
> `STATE_MAPPING_MISSING` and the scheduler falls all the way through to
> the legacy v0 EscalationConfig. You will see hours of "why nothing
> escalates" debugging that is entirely avoidable.

### PGR-flavoured deployment (Bomet, Nairobi, any DIGIT-PGR-derived tenant)

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "RequestInfo": { "authToken": "'"$TOKEN"'" },
    "Mdms": {
      "tenantId": "<tenant>",
      "schemaCode": "CRS.WorkflowStateMapping",
      "uniqueIdentifier": null,
      "data": {
        "singletonKey": "default",
        "mappings": {
          "PENDINGFORASSIGNMENT": "new",
          "PENDINGATLME":         "forwarded",
          "IN_TRIAGE":            "triage",
          "FORWARDED":            "forwarded",
          "UNDER_INVESTIGATION":  "investigation",
          "AWAITING_INFORMATION": "awaiting",
          "RESOLVED":             "resolved"
        }
      },
      "isActive": true
    }
  }' \
  "https://<deployment>/mdms-v2/v2/_create/CRS.WorkflowStateMapping"
```

### CRS-flavoured deployment (Mozambique BRD-style, or any custom workflow)

Adjust the keys to your `egov-workflow-v2` state names. The six canonical
values on the right (`new | triage | forwarded | investigation | awaiting
| resolved`) are fixed by the schema validator; *only* these strings are
accepted.

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "RequestInfo": { "authToken": "'"$TOKEN"'" },
    "Mdms": {
      "tenantId": "<tenant>",
      "schemaCode": "CRS.WorkflowStateMapping",
      "uniqueIdentifier": null,
      "data": {
        "singletonKey": "default",
        "mappings": {
          "RECEBIDA":     "new",
          "TRIADA":       "triage",
          "ENCAMINHADA":  "forwarded",
          "EM_APURACAO":  "investigation",
          "AGUARDANDO":   "awaiting",
          "RESOLVIDA":    "resolved"
        }
      },
      "isActive": true
    }
  }' \
  "https://<deployment>/mdms-v2/v2/_create/CRS.WorkflowStateMapping"
```

Expected response: HTTP 200 with `"mdms": [{ ... }]`. An empty `mdms`
array on HTTP 200 means the row already exists — see
[Common pitfalls → Phantom 200](#phantom-200-on-duplicate-create).

---

## Step 2: Seed `CRS.StateSLA` defaults

Per-state defaults answer the SLA lookup when no `CRS.CategorySLA` row
matches the complaint (or matches but the cell is null). It is one
singleton record per tenant. Six required numbers, each in hours,
range `0 < n ≤ 8760`.

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "RequestInfo": { "authToken": "'"$TOKEN"'" },
    "Mdms": {
      "tenantId": "<tenant>",
      "schemaCode": "CRS.StateSLA",
      "uniqueIdentifier": null,
      "data": {
        "singletonKey": "default",
        "stateDefaults": {
          "new":           24,
          "triage":        24,
          "forwarded":     48,
          "investigation": 120,
          "awaiting":      120,
          "resolved":      360
        }
      },
      "isActive": true
    }
  }' \
  "https://<deployment>/mdms-v2/v2/_create/CRS.StateSLA"
```

> **Operator note**: you do not have to use curl. Once the schemas are
> registered, an operator can edit the per-state defaults in the
> Configurator under **Manage → ESCALATION → SLA Matrix → Defaults
> strip**. The curl recipe is here because the configurator empty-state
> CTA assumes a human is driving it; CI/scripted onboarding usually wants
> a one-liner.

---

## Step 3: Seed `CRS.CategorySLA` rows

The per-tuple matrix. One row per `(path, category, subcategoryL1)`
combination, with a per-state cell map. Cells can be `number` (hours),
`[min, max]` range (UI shows range; scheduler uses max), or `null`
(falls through to `CRS.StateSLA`).

### Bulk path (preferred for > 10 rows): CSV import

1. Open the Configurator at
   `https://<deployment>/configurator/manage/crs-sla-matrix`.
2. Click **Bulk import…** in the toolbar.
3. Drop a CSV matching the seed format. The seed lives at
   [`configurator/src/resources/crs/sla-matrix/_seed/example.csv`](../configurator/src/resources/crs/sla-matrix/_seed/example.csv) —
   download it from the modal as the starter template.
4. The preview pane shows per-row status. Errored rows are flagged
   inline. Fix in your spreadsheet and re-drop, or "Import N valid rows"
   to land the clean ones (failures are listed in the post-import toast).

CSV format (verbatim from `_seed/example.csv`):

```csv
path,category,subcategoryL1,subcategoryL2,sla_new,sla_triage,sla_forwarded,sla_investigation,sla_awaiting,sla_resolved
SAMPLE,General,Standard,Default issues,,,,72,,
SAMPLE,General,Urgent,Critical issues,,,,24,,
SAMPLE,Other,Misc,Catch-all,,,,168,,
```

Notes:

- `path`, `category`, `subcategoryL1` form the join key — they MUST be
  populated. `subcategoryL2` is informational only (the scheduler does
  not key on it).
- Empty SLA columns are persisted as `null` cells, which means "use the
  per-state default from `CRS.StateSLA`". A row with all six SLA cells
  empty is legal but pointless — the matrix won't override anything.
- `path` is an opaque tenant-defined string. There is no enum — older
  deployments may still carry one; see
  [Common pitfalls → Path enum regression](#path-enum-regression).

### Per-row path (good for 1-5 rows or scripted onboarding)

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "RequestInfo": { "authToken": "'"$TOKEN"'" },
    "Mdms": {
      "tenantId": "<tenant>",
      "schemaCode": "CRS.CategorySLA",
      "uniqueIdentifier": null,
      "data": {
        "path": "Sanitation",
        "category": "Solid Waste",
        "subcategoryL1": "Missed Pickup",
        "isActive": true,
        "slaHoursByState": {
          "new":           4,
          "triage":        4,
          "forwarded":     12,
          "investigation": 48,
          "awaiting":      72,
          "resolved":      168
        }
      },
      "isActive": true
    }
  }' \
  "https://<deployment>/mdms-v2/v2/_create/CRS.CategorySLA"
```

The `(path, category, subcategoryL1)` triple is enforced unique by the
`x-unique` constraint on the schema. Duplicate creates return HTTP 200
with an empty `mdms` array (see
[Phantom 200](#phantom-200-on-duplicate-create)).

---

## Step 4: Verification checklist

Run all four. A green box on each means the tenant is fully wired.

### 4a. Confirm all four schemas registered

```bash
for code in CRS.CategorySLA CRS.StateSLA CRS.WorkflowStateMapping CRS.SLAAuditLog; do
  echo -n "$code: "
  curl -s -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{ \"RequestInfo\": { \"authToken\": \"$TOKEN\" }, \"SchemaDefCriteria\": { \"tenantId\": \"<tenant>\", \"codes\": [\"$code\"] } }" \
    "https://<deployment>/mdms-v2/schema/v1/_search" \
    | python3 -c "import json,sys;d=json.load(sys.stdin);print('OK' if d.get('SchemaDefinitions') else 'MISSING')"
done
```

Expect four `OK` lines. Any `MISSING` means the default-data-handler
hasn't run for that schema — re-run `register_schemas.py` from
`configurator/src/resources/crs/sla-matrix/_seed/` or post the schema
manually.

### 4b. Trigger a synchronous scan and inspect `skipBreakdown`

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "RequestInfo": { "authToken": "'"$TOKEN"'" },
    "tenantId": "<tenant>"
  }' \
  "https://<deployment>/pgr-services/escalation/_trigger" | python3 -m json.tool
```

What to look for:

- `skipBreakdown.STATE_MAPPING_MISSING` should be **0**. Any nonzero
  count means Step 1 didn't cover one of the workflow states currently
  in the open-complaint set — search the response `details[]` for the
  unmapped state name and add it to your `CRS.WorkflowStateMapping`
  row.
- `skipBreakdown.UNMAPPED_CATEGORY` is a *soft warning*. It means
  Strategy A/B (see design doc) isn't wired for some complaints. Those
  complaints still escalate via `CRS.StateSLA`, but you should plan to
  fix the mapping. Not a release blocker.
- `escalated`, `scanned`, `skipped` should sum to the open-complaint
  candidate set. If `escalated == 0` and `skipBreakdown` is dominated
  by `NO_ASSIGNEES`, see
  [Assignee-persistence upstream bug](#assignee-persistence-upstream-bug).

### 4c. Trace-back drawer (configurator UI)

Open `https://<deployment>/configurator/manage/crs-sla-matrix`, click
**Trace escalation…** top-right, paste a known service request id of an
open complaint, and inspect the **Resolved SLA** pane. The `source`
field should read `CRS.CategorySLA` or `CRS.StateSLA`. If you see
`v0.EscalationConfig`, you fell through all three CRS layers — most
commonly because Step 1 hasn't picked up the current workflow state.

### 4d. (Optional but recommended) OTEL trace assertion

If Tempo is up:

```bash
# Trigger a scan (capture the response so we can find the trace)
curl -sD - -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Correlation-ID: verify-$(date +%s)" \
  -d '{ "RequestInfo": {"authToken": "'"$TOKEN"'"}, "tenantId": "<tenant>" }' \
  "https://<deployment>/pgr-services/escalation/_trigger" > /tmp/resp.txt

# Grab the traceparent header and search Tempo (port varies by deployment)
TRACE_ID=$(grep -i '^traceparent:' /tmp/resp.txt | awk -F'-' '{print $2}')
curl -s "http://<deployment>:13200/api/traces/$TRACE_ID" \
  | python3 -c "import json,sys;t=json.load(sys.stdin);[print(a) for s in t['batches'] for sp in s['scopeSpans'] for span in sp['spans'] for a in span.get('attributes',[]) if 'escalation' in a['key']]"
```

Expect to see `escalation.slaSource = CRS.CategorySLA` (or `CRS.StateSLA`)
on at least one span. `v0.EscalationConfig` everywhere means the same
"didn't pick up the new MDMS" symptom as 4c — recheck Step 1.

---

## Step 5: First SLA in 10 minutes — end-to-end tutorial

Use this to *demonstrate* the feature is wired, end-to-end, on a fresh
tenant. The numbers are deliberately small (1 hour SLA) so the demo
finishes in one coffee break.

### 5.1 Create a test complaint (as a citizen)

```bash
# Citizen OTP login (mock OTP "123456" on dev tenants — adapt for prod)
CITIZEN_TOKEN=$(curl -s -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=" \
  -d "grant_type=password&username=9999999999&password=123456&tenantId=<city>&scope=read&userType=CITIZEN" \
  "https://<deployment>/user/oauth/token" \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['access_token'])")

# File a complaint
SRID=$(curl -s -X POST \
  -H "Authorization: Bearer $CITIZEN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "RequestInfo": { "authToken": "'"$CITIZEN_TOKEN"'" },
    "service": {
      "tenantId": "<city>",
      "serviceCode": "GarbageCollection",
      "description": "Runbook smoke test — please ignore",
      "source": "web",
      "address": { "city": "<city>", "geoLocation": { "latitude": 0, "longitude": 0 } }
    },
    "workflow": { "action": "APPLY" }
  }' \
  "https://<deployment>/pgr-services/v2/request/_create" \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['ServiceWrappers'][0]['service']['serviceRequestId'])")

echo "Created complaint $SRID"
```

### 5.2 Assign it (as an employee)

Log into the employee UI (`https://<deployment>/digit-ui/`) as a
GRO/LME-role user, open the complaint, click **Assign**, pick any
employee with the `LME` role and a `reportingTo` chain populated in
HRMS. (See
[`docs/escalation-feature-bomet.md`](./escalation-feature-bomet.md)
for the reportingTo prerequisite.) After assignment the complaint
status moves to `PENDINGATLME`.

### 5.3 Drop the SLA for that complaint's category to 1 hour

In the configurator (`/configurator/manage/crs-sla-matrix`):

1. Find the row whose `(path, category, subcategoryL1)` matches the
   complaint. If the row doesn't exist, **Add row** with those exact
   three values.
2. Click the **FORWARDED** cell → enter `1` → press Enter. (Or
   **NEW** if your assigned-state mapping resolves to `new`.)
3. Click **Save changes**.

### 5.4 Wait one hour (or skip the wait and trigger manually)

```bash
# Skip the wait — fire the scheduler synchronously
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "RequestInfo": { "authToken": "'"$TOKEN"'" },
    "tenantId": "<tenant>",
    "serviceRequestIds": ["'"$SRID"'"]
  }' \
  "https://<deployment>/pgr-services/escalation/_trigger"
```

(The `serviceRequestIds` filter scopes the scan to just the test
complaint — much faster than the global scan.)

### 5.5 Confirm it escalated

Search the complaint:

```bash
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "RequestInfo": {"authToken": "'"$TOKEN"'"}, "tenantId": "<city>", "serviceRequestIds": ["'"$SRID"'"] }' \
  "https://<deployment>/pgr-services/v2/request/_search" \
  | python3 -c "import json,sys;w=json.load(sys.stdin)['ServiceWrappers'][0];print('assignee:', w['service'].get('accountId'),'\nstate:', w['service']['applicationStatus'])"
```

The `assignee` should have flipped to the supervisor of the original
assignee (per HRMS `reportingTo`). The `state` should still be a
PENDING-state — escalation re-assigns, it does not advance state.

The same Trace-back drawer (Step 4c) on this SR id should now show
`source=CRS.CategorySLA`, `value=1h`, and a `Scheduler verdict` of
`action=ESCALATED, reason=SUCCESS`.

That's the loop: **create → assign → set SLA → trigger → observe**. If
all five steps pass, the feature is live on the tenant.

---

## Common pitfalls

### x-ref-schema regression

**Symptom**: `POST /mdms-v2/v2/_create/CRS.*` returns HTTP 400 with
`org.json.JSONObject cannot be cast to org.json.JSONArray` at
`MdmsDataValidator.validateReference:140`.

**Cause**: an older draft of `CRS.json` registered `x-ref-schema` as
`{}` instead of `[]`. mdms-v2 schema/v1 has no `_update` endpoint, so
the schema can't be re-uploaded over the broken row.

**Fix**: apply the recovery SQL —
[`configurator/src/resources/crs/sla-matrix/_seed/fix-xref-schema.sql`](../configurator/src/resources/crs/sla-matrix/_seed/fix-xref-schema.sql).
Safe to re-run; the WHERE clause skips already-fixed rows.

```bash
docker cp fix-xref-schema.sql docker-postgres:/tmp/
docker exec docker-postgres psql -U egov -d egov -f /tmp/fix-xref-schema.sql
```

### Path enum regression

**Symptom**: `POST /mdms-v2/v2/_create/CRS.CategorySLA` returns HTTP 400
"path must be one of [IGE, IGSAE]" when you try to use any other value.

**Cause**: the initial `CRS.CategorySLA` schema baked in a
Mozambique-specific `path` enum. Same `_update`-doesn't-exist issue as
above.

**Fix**: the same `fix-xref-schema.sql` includes the `2026-06-09
follow-up` block that drops the enum in place. Re-run it.

### Phantom 200 on duplicate create

**Symptom**: `POST /mdms-v2/v2/_create/CRS.*` returns HTTP 200 but the
`mdms` array in the response is empty.

**Cause**: the row already exists (by `x-unique`). mdms-v2 returns 200
without raising; the empty array is the only signal.

**Action**: read-back via `/v2/_search` to confirm what's there. If
the existing row is wrong, you cannot "update" via the v1 schema API —
either delete the row at the DB level and re-create, or (preferred)
patch it via the Configurator UI which uses the proper `_update`
endpoint on the data side.

### Persister lag — HTTP 202 means "accepted, not yet persisted"

**Symptom**: the `_create` returned HTTP 202 (not 200), but a read-back
within the next second or two still returns the old value.

**Cause**: `/mdms-v2/v2/_update` is asynchronous via Kafka → `egov-persister`.
The 202 is a queue ack, not a write ack.

**Action**: wait 3–5s and re-read. If the read still returns the old
value:

```bash
# Persister health
docker ps --filter name=egov-persister
# Kafka consumer-group lag (must be 0)
docker exec kafka kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --group egov-infra-persist --describe
```

If the persister is dead, every `_create`/`_update` returns 202 but
nothing lands. The persister has died silently in production before
(see [`docs/escalation-feature-bomet.md`](./escalation-feature-bomet.md)
for the Bomet incident). Restart it and re-issue the writes.

### Assignee-persistence upstream bug

**Symptom**: `/escalation/_trigger` returns
`skipBreakdown.NO_ASSIGNEES` dominating, even though employee UI clearly
shows the complaints are ASSIGNed.

**Cause**: upstream `egov-workflow-v2` ASSIGN action does not persist
the assignee to `eg_wf_assignee_v2`. This is an upstream DIGIT bug that
needs a fix in the workflow-v2 repo; CRS cannot work around it
generically. The new `history=true` fallback in
[`EscalationService.getCurrentAssignees`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationService.java)
covers the *terminal/sub-terminal-state* case but not the
ASSIGN-never-persisted case.

**Workaround**: backfill the assignee table directly while the upstream
fix is in flight, or wait for the upstream patch. Track on the
egov-workflow-v2 repo and cross-link from PR #770.

### `mapWorkflowStateToKey` returns null for a state the tenant actually uses

**Symptom**: `skipBreakdown.STATE_MAPPING_MISSING` > 0 after Step 1.

**Cause**: your tenant's `egov-workflow-v2` business service emits a
workflow state name your `CRS.WorkflowStateMapping` doesn't cover.

**Action**: grep the response `details[]` for the unmapped state name,
add it to the `mappings` object, and re-POST `CRS.WorkflowStateMapping`.
Because the schema's `x-unique` is `singletonKey`, you'll hit
[Phantom 200](#phantom-200-on-duplicate-create) — use the configurator
**Edit defaults… → State mapping** flow (or DB UPDATE on
`eg_mdms_data` for the singleton record) to mutate the existing row
rather than fight the create-only API.

---

## Where to look when nothing escalates

A debug recipe in priority order. Stop at the first signal that
explains the symptom.

1. **`/escalation/_trigger` response `skipBreakdown`** — see the
   `EscalationSkipReason` enum
   ([`EscalationSkipReason.java`](../backend/pgr-services/src/main/java/org/egov/pgr/util/EscalationSkipReason.java))
   for what each value means. The breakdown alone usually nails it.

2. **`pgr-services` stdout, scheduler skip lines** — every per-complaint
   decision logs a one-liner:

   ```
   Escalation skip — srid=PG-PGR-2026-06-09-082555, status=PENDINGATLME, level=0, reason=SLA_NOT_BREACHED, detail=elapsed=512908ms, sla=3600000ms
   ```

   ```bash
   docker logs digit-pgr-services 2>&1 | grep -i "Escalation skip" | tail -30
   ```

3. **MDMS read-back, all four schemas** — confirm what the scheduler is
   actually reading:

   ```bash
   for code in CRS.WorkflowStateMapping CRS.StateSLA CRS.CategorySLA; do
     echo "=== $code ==="
     curl -s -X POST \
       -H "Authorization: Bearer $TOKEN" \
       -H "Content-Type: application/json" \
       -d "{ \"RequestInfo\": {\"authToken\":\"$TOKEN\"}, \"MdmsCriteria\": { \"tenantId\": \"<tenant>\", \"schemaCode\": \"$code\" } }" \
       "https://<deployment>/mdms-v2/v2/_search" \
       | python3 -m json.tool
   done
   ```

4. **Trace-back drawer** (Step 4c above) on a specific SR id — read-only,
   side-effect-free, shows scheduler verdict + complaint + resolved SLA
   side by side.

5. **OTEL span on `POST /pgr-services/escalation/_trigger`** — check
   `escalation.slaSource`, `escalation.skipped.<reason>` (one
   counter attribute per skip-reason), `escalation.scanned`,
   `escalation.escalated`. Tempo URL is per-deployment (e.g.
   `http://10.0.0.2:13200/api/traces/<id>` on Bomet).

6. **`SLAAuditLog`** — if "the matrix looks wrong", the audit log shows
   exactly what was written and by whom:

   ```bash
   curl -s -X POST \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{ "RequestInfo": {"authToken":"'"$TOKEN"'"}, "MdmsCriteria": { "tenantId": "<tenant>", "schemaCode": "CRS.SLAAuditLog" } }' \
     "https://<deployment>/mdms-v2/v2/_search" \
     | python3 -m json.tool | head -60
   ```

---

## Rollback

If an SLA change paged the wrong supervisors, or a bad bulk import set
unreasonable values, you have three paths in increasing scope:

### Soft-rollback: deactivate the bad row

In the configurator, toggle the row's **Active** column to off and
**Save changes**. The scheduler skips inactive rows. The audit log
records this as a `delete` action with reason `soft-delete via
deactivation`. Reversible at any time.

### Edit-rollback: restore prior values from `CRS.SLAAuditLog`

Every successful matrix write produces an audit row with `beforeJson`
and `afterJson` snapshots. To restore the prior state:

```bash
# 1. Find the offending audit row by record identifier (the path/category/subcategoryL1 triple)
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "RequestInfo": {"authToken":"'"$TOKEN"'"}, "MdmsCriteria": { "tenantId": "<tenant>", "schemaCode": "CRS.SLAAuditLog", "filters": [["recordIdentifier", "Sanitation/SolidWaste/MissedPickup"]] } }' \
  "https://<deployment>/mdms-v2/v2/_search" \
  | python3 -m json.tool

# 2. Lift `beforeJson`, parse it, and POST it as a new CategorySLA row (or DB UPDATE the existing one)
```

### Full-rollback: revert to `v0.EscalationConfig`

Worst case — turn the new pipeline off entirely until the bad change
is sorted. Deactivate the singleton mapping:

```bash
# Set CRS.WorkflowStateMapping.isActive=false via DB (the v2 _update doesn't expose this cleanly today)
docker exec docker-postgres psql -U egov -d egov -c \
  "UPDATE eg_mdms_data SET data = jsonb_set(data, '{isActive}', 'false'::jsonb) WHERE schema_code = 'CRS.WorkflowStateMapping' AND tenant_id = '<tenant>';"
```

With the mapping inactive, `mapWorkflowStateToKey` returns null on
every state → trips `STATE_MAPPING_MISSING` → falls through to v0.
Escalation continues from `RAINMAKER-PGR.EscalationConfig` exactly as
before PR #770. Reactivate (`SET isActive=true`) once the fix is in.

---

## Auth snippet

The token shape used throughout this runbook:

```bash
TOKEN=$(curl -s -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=" \
  -d "grant_type=password&username=ADMIN&password=eGov%40123&tenantId=<tenant>&scope=read&userType=EMPLOYEE&userInfo=true" \
  "https://<deployment>/user/oauth/token" \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['access_token'])")
```

The ADMIN account must have `SUPERUSER` role in `<tenant>`. The Basic
header (`ZWdvdi11c2VyLWNsaWVudDo=`) is the standard
`egov-user-client:` client-credentials encoding used by every DIGIT
deployment.

---

## Cross-references

- **Design doc** (architecture, scheduler pseudocode, OTEL contract):
  [`docs/escalation-feature-design.md`](./escalation-feature-design.md)
- **Wiring strategies** (CategorySLA join key — rich-intake vs.
  ServiceDefs-extension): [`docs/escalation-feature-design.md#wiring-strategies-tenant-data--categorysla`](./escalation-feature-design.md#wiring-strategies-tenant-data--categorysla)
- **General CRS Configurator roadmap** (G1–G8 follow-up phases):
  [`docs/crs-configurator-roadmap.md`](./crs-configurator-roadmap.md)
- **Bomet operational notes** (first live deployment, the
  assignee-persistence incident, Tempo curl recipes):
  [`docs/escalation-feature-bomet.md`](./escalation-feature-bomet.md)
- **Recovery SQL** (x-ref-schema + path-enum):
  [`configurator/src/resources/crs/sla-matrix/_seed/fix-xref-schema.sql`](../configurator/src/resources/crs/sla-matrix/_seed/fix-xref-schema.sql)
- **Seed CSV** (generic starter template for CategorySLA bulk import):
  [`configurator/src/resources/crs/sla-matrix/_seed/example.csv`](../configurator/src/resources/crs/sla-matrix/_seed/example.csv)
- **Register-schemas helper** (idempotent script to push the four
  `CRS.*` schemas to a fresh tenant):
  [`configurator/src/resources/crs/sla-matrix/_seed/register_schemas.py`](../configurator/src/resources/crs/sla-matrix/_seed/register_schemas.py)
- **CSV import helper** (drives bulk-load against a deployment):
  [`configurator/src/resources/crs/sla-matrix/_seed/import_csv.py`](../configurator/src/resources/crs/sla-matrix/_seed/import_csv.py)
- **Implementation PR**:
  [#770 feat/escalation-otel-configurator-designer](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/770)
- **Discussion thread**:
  [#773 CRS Escalation — design + operator feedback](https://github.com/egovernments/Citizen-Complaint-Resolution-System/discussions/773)
