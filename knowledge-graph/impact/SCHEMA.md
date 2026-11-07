# Impact graph — shared schema (all module passes MUST follow this exactly)

Paths are relative to the repo root. Snapshot: master @ 64d5abe92.
Each module pass writes one file, `graph/<module>.json`: { "module": "<name>", "nodes": [...], "edges": [...] }. The loader (`lib.mjs`) assigns each node its layer from its prefix.


## Node
{ "id": "<prefix>:<name>", "label": "<short human label>", "layer": "business|application|data|integration|infrastructure", "module": "<owning module/deployable>" }

Node id prefixes (use EXACTLY these; ids are how passes are merged — same thing ⇒ same id):
| prefix | meaning | id example |
|---|---|---|
| api: | HTTP endpoint exposed by a first-party service. Full path incl. context path, METHOD first | `api:POST /pgr-services/v2/request/_create` |
| coreapi: | DIGIT core / platform HTTP endpoint called by this repo (no METHOD; path as called, normalised to the service context path) | `coreapi:/egov-workflow-v2/egov-wf/process/_transition` |
| class: | Java class (simple name) | `class:PGRService` |
| code: | JS/TS/Python/Lua source file or module (repo-relative path) | `code:digit-ui-esbuild/packages/modules/pgr/src/pages/employee/ComplaintDetails.js` |
| screen: | user-facing UI screen/page; label = what the user sees. id = `screen:<app>/<ComponentName>` with app ∈ digit-ui, configurator, chatbot | `screen:digit-ui/ComplaintDetails` |
| table: | DB table, view or materialized view | `table:eg_pgr_service_v2` |
| field: | a domain field whose change has impact. `<Entity>.<field>`; JSON sub-keys with dots | `field:Service.applicationStatus`, `field:Service.additionalDetail.department`, `field:ComplaintHierarchy.slaHours` |
| topic: | Kafka topic (literal default value) | `topic:save-pgr-request` |
| master: | MDMS schema code | `master:RAINMAKER-PGR.ComplaintHierarchy` |
| wf: | workflow state or action: `wf:state:<STATE>`, `wf:action:<ACTION>`, business service `wf:bs:PGR` | `wf:state:PENDINGATLME` |
| config: | config property / env var / feature flag (key name) | `config:pgr.escalation.enabled` |
| service: | a deployable (container/chart) | `service:pgr-services`, `service:egov-workflow-v2`, `service:novu-bridge` |
| infra: | infra artefact: compose file, helm chart/helmfile, CI workflow, Dockerfile, Kong route, persister/indexer config file | `infra:.github/workflows/build-images.yml`, `infra:kong-route:/pgr-services` |
| test: | automated test file/suite (repo-relative path) | `test:tests/integration-tests/tests/lifecycle/complaint-lifecycle.spec.ts` |
| ext: | external system | `ext:novu`, `ext:twilio` |
| biz: | business concept | `biz:Complaint`, `biz:SLA`, `biz:Escalation`, `biz:ComplaintStatus` |

Shared canonical ids (use these, don't invent variants):
service:pgr-services, service:novu-bridge, service:identity-bff, service:keycloak, service:digit-config-service, service:digit-user-preferences-service, service:xstate-chatbot, service:digit-mcp, service:configurator, service:digit-ui, service:turbopass, service:egov-persister, service:egov-indexer, service:egov-workflow-v2, service:egov-user, service:mdms-v2, service:egov-hrms, service:boundary-service, service:egov-idgen, service:egov-enc-service, service:egov-accesscontrol, service:egov-localization, service:egov-filestore, service:egov-url-shortening, service:inbox, service:kong, service:novu
field:Service.applicationStatus, field:Service.rating, field:Service.serviceCode, field:Service.accountId, field:Service.additionalDetail, field:Service.additionalDetail.department, field:Service.additionalDetail.escalationLevel, field:Service.extendedAttributes, field:Workflow.action, field:Workflow.assignes, field:ComplaintHierarchy.slaHours, field:ComplaintHierarchy.department, field:Address.locality
biz:Complaint, biz:ComplaintStatus, biz:ComplaintType, biz:SLA, biz:Escalation, biz:Assignment, biz:Reopen, biz:Rating, biz:Notification, biz:Department, biz:Jurisdiction, biz:Citizen, biz:Employee, biz:Workspace

## Edge
{ "from": "<node id>", "to": "<node id>", "rel": "<rel>", "status": "confirmed|inferred",
  "evidence": { "file": "<repo-relative path>", "match": "<exact substring>", "line": <int> },
  "note": "<optional, short>" }

Direction rule: the edge points from the thing that DEPENDS to the thing it depends on (from = dependent, to = dependency). So "if `to` changes, `from` may be impacted".

rel vocabulary (use only these):
| rel | from → to |
|---|---|
| exposes | service → api it serves (inverse direction exception: a service depends on nothing here; still write service → api) |
| handled-by | api → class (controller) |
| calls | class/code/screen → class/code (in-process call) |
| invokes | class/code/screen → api or coreapi (HTTP call) |
| publishes | class/code → topic |
| consumes | class/code/service → topic |
| reads | class/code/service → table/field/master |
| writes | class/code/service → table/field |
| maps | infra (persister/indexer config) → table/field/topic |
| uses-config | class/code → config |
| uses-state | class/code/screen/test/table → wf:state or wf:action (references the literal) |
| renders | screen → field/api (displays it) |
| derives-from | field/table → field/table/master (computed from) |
| part-of | class/code/screen → service |
| routes-to | infra (kong route / nginx) → service |
| deploys | infra → service |
| builds | infra → service |
| tests | test → api/screen/service/wf |
| realises | class/api/screen → biz |
| transitions-to | wf:action → wf:state (and wf:state → wf:action available-in) |

## Evidence rules (validation is automated — an edge fails if these don't hold)
- `evidence.file` is repo-relative and exists.
- `evidence.match` is a SHORT exact substring (10–120 chars) that appears on ONE line of that file — copy it verbatim (whitespace exactly). It must prove the edge (the call, the topic literal, the SQL table name, the import, the state literal...).
- `evidence.line` is the 1-based line where `match` appears.
- Verify each match with grep before writing. If you cannot find line-level proof, either drop the edge or mark `"status":"inferred"` with the best supporting line and a `note` explaining the inference.
- Never invent nodes/edges from naming alone.
- Prefer quality over volume: 120–350 edges per pass. Cover everything relevant to the four impact questions:
  (1) Complaint Status model change, (2) Kafka topic change, (3) DIGIT core API change, (4) SLA calculation change.
