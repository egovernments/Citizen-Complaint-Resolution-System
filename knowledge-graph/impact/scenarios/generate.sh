#!/usr/bin/env bash
# Regenerates the worked impact scenarios (report + Mermaid) from graph/*.json.
#   bash knowledge-graph/impact/scenarios/generate.sh
set -euo pipefail
cd "$(dirname "$0")"
Q=../impact.mjs

STATES=wf:state:PENDINGFORASSIGNMENT,wf:state:PENDINGFORREASSIGNMENT,wf:state:PENDINGATLME,wf:state:RESOLVED,wf:state:REJECTED,wf:state:CLOSEDAFTERRESOLUTION,wf:state:CLOSEDAFTERREJECTION,wf:state:CANCELLED,wf:state:PENDINGFORASSIGNMENT_AFTERREOPEN

run() { # name, title, query, report depth, diagram depth
  node "$Q" "$3" --depth "$4" --mermaid "$1.mmd" --mermaid-depth "$5" --title "$2" > "$1.txt"
  echo "$1: $(tail -1 "$1.txt" | sed 's/^Mermaid written.*//')$(grep '^Total affected' "$1.txt")"
}

run 1-complaint-status-model "Scenario 1: the complaint status model changes (applicationStatus + workflow states)" \
  "field:Service.applicationStatus,$STATES" 2 1
run 2-kafka-topics "Scenario 2: the complaint Kafka topics change" \
  "topic:save-pgr-request,topic:update-pgr-request,topic:complaints.domain.events" 2 1
run 3-core-api-workflow "Scenario 3: a DIGIT core API changes (egov-workflow-v2)" \
  "service:egov-workflow-v2" 2 2
run 4-sla-calculation "Scenario 4: the SLA calculation changes" \
  "field:ComplaintHierarchy.slaHours,config:pgr.business.level.sla,config:pgr.escalation.default.sla.ms,master:RAINMAKER-PGR.EscalationConfig,field:EscalationConfig.defaultSlaByLevel,field:EscalationConfig.overrides,field:BusinessService.businessServiceSla" 2 1
