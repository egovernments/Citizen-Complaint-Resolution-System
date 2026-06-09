# PGR Escalation Feature — Bomet Deployment Notes

This document covers the PGR escalation feature that's been ported into this monorepo across `backend/pgr-services`, `configurator/`, `workflow-designer/` and `tests/integration-tests/`. It mirrors the live state on the Bomet tenant (`bometfeedbackhub.digit.org`) as of the branch `feat/escalation-otel-configurator-designer`.

## What landed in the monorepo

### `backend/pgr-services` (2 commits already on this branch)

- **NEW**: `util/EscalationSkipReason.java` — enum with 7 structured skip reasons (`NO_ASSIGNEES`, `SLA_NOT_BREACHED`, `MAX_DEPTH_REACHED`, …).
- **NEW**: `web/controllers/EscalationController.java` — `POST /escalation/_trigger` for synchronous, on-demand scans (no waiting for the scheduler tick).
- **NEW**: `web/models/EscalationTriggerRequest.java`, `EscalationTriggerResponse.java`.
- **NEW**: `test/service/EscalationServiceTest.java` (6 tests), `test/validator/ServiceRequestValidatorTest.java` (4 new tests).
- **EDIT**: `service/EscalationScheduler.java` — structured skip logs + OpenTelemetry attributes + a reusable `scanAndEscalateOnce()` so the controller and the @Scheduled tick share one code path.
- **EDIT**: `service/EscalationService.java` — per-complaint OTEL attributes, a typed `EscalationResult`, and a `history=true` fallback in `getCurrentAssignees()` for terminal/sub-terminal states.
- **EDIT**: `validator/ServiceRequestValidator.java` — mandatory comment when the manual `ESCALATE` action is invoked.
- **EDIT**: `pom.xml` — adds `io.opentelemetry:opentelemetry-api:1.45.0`.

### `configurator/` (this commit)

- **NEW**: `src/admin/schemaDescriptors/escalation-config.ts` — descriptor for the new `RAINMAKER-PGR.EscalationConfig` MDMS schema (single record per root tenant).
- **NEW**: `src/admin/themeEditor/EscalationConfigEditor.tsx` — custom editor (the generic form bypasses for this schema) that drives both the SLA-by-level + service-overrides editors and a designation tree side panel.
- **NEW**: `src/components/widgets/SlaByLevelInput.tsx`, `ServiceOverridesEditor.tsx`, `DesignationTreePanel.tsx`, `DesignerIframe.tsx`.
- **EDIT**: `src/admin/schemaDescriptors/types.ts` — adds `'sla-by-level'` and `'service-overrides'` to `WidgetKind`.
- **EDIT**: `src/admin/schemaDescriptors/index.ts` — registers the new descriptor.
- **EDIT**: `src/admin/widgets/index.tsx` — dispatches the 2 new widgets.
- **EDIT**: `src/admin/themeEditor/index.ts` — registers `EscalationConfigEditor` against the `escalation-config` key.
- **EDIT**: `src/resources/workflow-services/WorkflowServiceShow.tsx` — adds a "Visual" tab that mounts the workflow designer in an iframe + handles its `save-workflow` `postMessage` by posting to `/egov-workflow-v2/egov-wf/businessservice/_update`.
- **EDIT**: `packages/data-provider/src/providers/resourceRegistry.ts` — registers `escalation-config` so the generic admin CRUD routes work.
- **EDIT**: `vite.config.ts` — adds a `/designer/` dev proxy when `VITE_DESIGNER_UPSTREAM` is set (so `npm run dev` can talk to the deployed designer host without CORS gymnastics).

### `workflow-designer/` (new top-level dir, this commit)

Forked from `workflow.egov.theflywheel.in/designer/`. Vanilla React 18 SPA, esbuild bundle, dagre auto-layout, `postMessage` bridge keyed on `bometfeedbackhub.digit.org` / `naipepea.digit.org` / `localhost`. Built `dist/` ships to `/var/www/.../designer/` on each tenant host.

### `tests/integration-tests/` (this commit)

- **NEW**: `tests/utils/tempo.ts` — small helper to query the per-tenant Tempo (`http://10.0.0.2:13200/api/traces/...`) and assert OTEL span attributes.
- **NEW**: `tests/lifecycle/pgr-escalation-trigger-bomet.spec.ts` — full API path: complaint → assign → cap SLA → trigger → assert OTEL attributes in Tempo.
- **NEW**: `tests/lifecycle/pgr-manual-escalate-comment.spec.ts` — `ESCALATE_COMMENT_REQUIRED` validator (manual escalate without a comment must fail).
- **NEW**: `tests/admin/escalation-configurator-bomet.spec.ts` — UI drive of the new escalation editor in the configurator.

## What works end-to-end on Bomet (verified)

1. **`POST /pgr-services/escalation/_trigger`** returns HTTP 200 with a synchronous breakdown:
   ```json
   {
     "scanned": 55,
     "escalated": 0,
     "skipped": 55,
     "skipBreakdown": {"NO_ASSIGNEES": 55},
     "details": [{"serviceRequestId": "...", "action": "SKIPPED", "reason": "NO_ASSIGNEES", "detail": "workflow returned 0 assignees"}, ...]
   }
   ```

2. **Structured skip-reason logs** in `pgr-services` stdout:
   ```
   Escalation skip — srid=PG-PGR-2026-06-09-082555, status=PENDINGATLME, level=0, reason=SLA_NOT_BREACHED, detail=elapsed=512908ms, sla=3600000ms
   Escalation scan complete: scanned=6, escalated=0, skipped=5, skipBreakdown={SLA_NOT_BREACHED=5}
   ```

3. **OTEL custom attributes in Tempo** — confirmed via `http://10.0.0.2:13200/api/traces/<id>`:
   ```
   pgr-services :: POST /pgr-services/escalation/_trigger
     escalation.scanned     = 55
     escalation.tenantId    = ke
     escalation.escalated   = 0
     escalation.skipped     = 55
     escalation.skipped.no_assignees    = 51
     escalation.skipped.sla_not_breached = 4
   ```

4. **`ESCALATE_COMMENT_REQUIRED` validator** — present in the deployed image; covered by `tests/integration-tests/tests/lifecycle/pgr-manual-escalate-comment.spec.ts`.

5. **Designer postMessage bridge** — designer is self-hosted (0 unpkg refs in the bundle), `postmessage-bridge` code present, and the configurator's `DesignerIframe` consumes it.

## What does NOT yet escalate end-to-end (and why)

The escalation chain does not actually fire on Bomet today because of an **upstream DIGIT workflow-service bug**: the ASSIGN action does NOT persist assignees to `eg_wf_assignee_v2`. Verified:

- ASSIGN action succeeded (state → `PENDINGATLME`)
- Both `processInstance.assignes` AND `ServiceWrapper.workflow.assignes` come back as `null` / empty
- `SELECT * FROM eg_wf_assignee_v2 WHERE processinstanceid IN (...)` returns 0 rows

The new `history=true` fallback in `getCurrentAssignees()` is harmless but cannot rescue this — the data is missing from the DB itself. **Tracked as a follow-up** (TASK-052 in the operator's TODO).

When that upstream bug is fixed, the chain fires automatically for any complaint with assignees + breached SLA. `/escalation/_trigger` will then return `escalated >= 1` with full per-complaint details, and OTEL spans get the per-complaint custom attributes (`escalation.fromAssignee`, `toAssignee`, `fromLevel`, `toLevel`, …) that are already wired in the code.

## Repro / operator runbook

```bash
# Trigger a synchronous scan (replace TOKEN with an ADMIN/ke OAuth token)
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"RequestInfo":{...},"tenantId":"ke","serviceRequestIds":["PG-PGR-..."]}' \
  https://bometfeedbackhub.digit.org/pgr-services/escalation/_trigger

# Check structured skip logs
ssh egov-bomet 'docker logs --tail 50 digit-pgr-services-1 | grep "Escalation skip\|skipBreakdown"'

# Query Tempo for the trace
TRACE_ID=$(ssh egov-bomet "docker logs --since=30s digit-pgr-services-1 | grep EscalationScheduler | grep -oE 'trace_id=[a-f0-9]{32}' | tail -1 | sed 's/trace_id=//'")
ssh egov-bomet "curl -s http://10.0.0.2:13200/api/traces/$TRACE_ID" \
  | jq '.batches[].scopeSpans[].spans[] | select(.attributes[]?.key | startswith("escalation."))'

# Open the configurator escalation editor
open https://bometfeedbackhub.digit.org/configurator/

# Open the workflow designer
open https://bometfeedbackhub.digit.org/designer/
```

## Bomet ops layout (informational)

| Path on `egov-bomet` | Purpose |
|---|---|
| `/opt/digit-builds/pgr-services-escalation/` | runtime Dockerfile + start.sh + app.jar used to bake the deployed image |
| `/var/www/workflow-designer/` | built `workflow-designer/dist/` (4 files, ~1.2 MB) |
| `/var/www/configurator/` | built `configurator/dist/` |
| `/etc/nginx/sites-available/bometfeedbackhub.digit.org` | `location /designer/` block added idempotently |
| `/opt/digit/docker-compose.egov-digit.yaml.bak-pre-otel` | backup taken before image swap |

## Follow-ups

- **Upstream DIGIT workflow-service ASSIGN bug**: `eg_wf_assignee_v2` stays empty after ASSIGN; the escalation chain can't fire until this is fixed upstream.
- **Push + PR** the equivalent changes to the dev configurator + workflow-designer + integration-tests environments mirrored in this monorepo, then validate the new docs match on Nairobi too.
