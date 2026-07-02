#!/usr/bin/env bash
# Publish executive dashboard KPIs + pack to bomet MDMS.
#
# Bomet's MDMS schema only accepts legacy viz.kind values (e.g. "scalar"),
# not "number-tile-sparkline" / "number-tile-delta". The dashboard FE treats
# scalar as a KPI card. Compose types like resolvedOverFiledRate are also
# blocked on create — flow ratio uses a query ratio measure instead.
# Chart KPIs use kind "stacked-bar"; if MDMS rejects that enum, seed via ansible
# or ask your manager to extend the schema (same as cl_chart_officer_sla).
#
# Usage:
#   export TOKEN="<ADMIN access_token from /user/oauth/token>"
#   ./scripts/publish-executive-dashboard-bomet.sh
#
# After success: log in as DEMO_EXECUTIVE → delete ccrs.dashboard.catalog-layout.v1
# from localStorage → Reset → hard refresh.

set -euo pipefail

BASE_URL="${BASE_URL:-https://bometfeedbackhub.digit.org}"
TENANT="${TENANT:-ke}"
TOKEN="${TOKEN:?Set TOKEN to your ADMIN access_token}"

post_mdms() {
  local path="$1"
  local body="$2"
  curl -sS -X POST "${BASE_URL}${path}" \
    -H "Content-Type: application/json" \
    -d "${body}"
}

upsert_kpi() {
  local uid="$1"
  local data_json="$2"
  local msg_id="$3"

  echo "--> create ${uid}"
  local create_resp
  create_resp="$(post_mdms "/mdms-v2/v2/_create/dss.KpiDefinition" "$(cat <<EOF
{
  "RequestInfo": {
    "apiId": "Rainmaker",
    "authToken": "${TOKEN}",
    "msgId": "${msg_id}-create"
  },
  "Mdms": {
    "tenantId": "${TENANT}",
    "schemaCode": "dss.KpiDefinition",
    "uniqueIdentifier": "${uid}",
    "isActive": true,
    "data": ${data_json}
  }
}
EOF
)")"
  echo "${create_resp}"

  if echo "${create_resp}" | grep -qiE 'already exists|duplicate'; then
    echo "--> ${uid} exists, updating instead"
    local search_resp
    search_resp="$(post_mdms "/mdms-v2/v2/_search" "$(cat <<EOF
{
  "RequestInfo": {
    "apiId": "Rainmaker",
    "authToken": "${TOKEN}",
    "msgId": "${msg_id}-search"
  },
  "MdmsCriteria": {
    "tenantId": "${TENANT}",
    "schemaCode": "dss.KpiDefinition",
    "limit": 200
  }
}
EOF
)")"
    local record
    record="$(python3 - <<'PY' "${search_resp}" "${uid}"
import json, sys
payload = json.loads(sys.argv[1])
uid = sys.argv[2]
for row in payload.get("mdms", []):
    if row.get("uniqueIdentifier") == uid:
        print(json.dumps(row))
        break
PY
)"
    if [[ -z "${record}" ]]; then
      echo "ERROR: could not find ${uid} after duplicate create"
      return 1
    fi
    local kpi_id audit
    kpi_id="$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['id'])" "${record}")"
    audit="$(python3 -c "import json,sys; print(json.dumps(json.loads(sys.argv[1])['auditDetails']))" "${record}")"
    local update_resp
    update_resp="$(post_mdms "/mdms-v2/v2/_update/dss.KpiDefinition" "$(cat <<EOF
{
  "RequestInfo": {
    "apiId": "Rainmaker",
    "authToken": "${TOKEN}",
    "msgId": "${msg_id}-update"
  },
  "Mdms": {
    "tenantId": "${TENANT}",
    "schemaCode": "dss.KpiDefinition",
    "id": "${kpi_id}",
    "uniqueIdentifier": "${uid}",
    "isActive": true,
    "auditDetails": ${audit},
    "data": ${data_json}
  }
}
EOF
)")"
    echo "${update_resp}"
  elif echo "${create_resp}" | grep -q '"Errors"'; then
    echo "ERROR: create ${uid} failed"
    return 1
  fi
  echo
}

TOTAL_COMPLAINTS_DATA='{
  "id": "cl_total_complaints_count",
  "version": "1.0.0",
  "status": "published",
  "query": {
    "grain": "facts",
    "measures": [{ "name": "total", "agg": "count" }]
  },
  "supportsSeries": true,
  "viz": {
    "kind": "scalar",
    "format": "integer",
    "valueKey": "total",
    "accent": "teal",
    "group": "complaint-landscape",
    "titleKey": "RAINMAKER-PGR.DASHBOARD_KPI_CL_TOTAL_COMPLAINTS_COUNT",
    "compose": null,
    "pii": false,
    "title": "Total complaints",
    "subtitle": "Complaints filed in period",
    "delta": { "mode": "percent", "compare": "prior" },
    "deltaLabel": "vs prior period",
    "dateKey": "created_date",
    "sparklineMeasureKey": "total"
  },
  "params": [{
    "name": "window",
    "default": "last_7d",
    "allowed": ["last_1d", "last_7d", "last_30d", "wtd", "mtd"]
  }],
  "rbac": {
    "visibleTo": [
      "SUPERVISOR", "PGR_SUPERVISOR", "GRO", "DGRO",
      "PGR_LME", "PGR_ADMIN", "SUPERUSER",
      "TICKET_REPORT_VIEWER", "PGR_VIEWER"
    ]
  }
}'

FLOW_RATIO_DATA='{
  "id": "cl_flow_ratio_count",
  "version": "1.0.0",
  "status": "published",
  "query": {
    "grain": "facts",
    "measures": [{
      "name": "ratio",
      "agg": "ratio",
      "numerator": {
        "agg": "count",
        "filter": { "is_resolved": true },
        "window": { "timeRole": "resolved_at" }
      },
      "denominator": {
        "agg": "count"
      }
    }]
  },
  "supportsSeries": false,
  "viz": {
    "kind": "scalar",
    "format": "decimalTwo",
    "valueKey": "ratio",
    "accent": "teal",
    "group": "complaint-landscape",
    "titleKey": "RAINMAKER-PGR.DASHBOARD_KPI_CL_FLOW_RATIO_COUNT",
    "compose": null,
    "pii": false,
    "title": "Flow ratio",
    "subtitle": "Resolved in period ÷ created in period",
    "delta": { "mode": "rating", "compare": "prior" },
    "deltaLabel": "vs prior period"
  },
  "params": [{
    "name": "window",
    "default": "last_7d",
    "allowed": ["last_1d", "last_7d", "last_30d", "wtd", "mtd"]
  }],
  "rbac": {
    "visibleTo": ["TICKET_REPORT_VIEWER", "PGR_VIEWER"]
  }
}'

WARDS_BY_SLA_DATA='{
  "id": "cl_chart_wards_by_sla",
  "version": "1.0.0",
  "status": "published",
  "query": {
    "grain": "daily",
    "dimensions": ["ward_code", "sla_status_bucket"],
    "measures": [{ "name": "total", "agg": "count" }],
    "limit": 120
  },
  "supportsSeries": false,
  "viz": {
    "kind": "bar",
    "orientation": "horizontal",
    "format": "integer",
    "valueKey": "total",
    "accent": "teal",
    "group": "complaint-landscape",
    "titleKey": "RAINMAKER-PGR.DASHBOARD_KPI_CL_CHART_WARDS_BY_SLA",
    "dimensionKey": "ward_code",
    "measureKey": "total",
    "measureKeys": ["total"],
    "stackKey": "sla_status_bucket",
    "stackSeries": [
      { "key": "resolved", "label": "Resolved", "color": "var(--status-resolved-bg)" },
      { "key": "within", "label": "On track", "color": "var(--chart-1)" },
      { "key": "approaching", "label": "Nearing breach", "color": "var(--chart-2)" },
      { "key": "breached", "label": "Breached", "color": "var(--status-breach)" }
    ],
    "sortBySegment": "breached",
    "limit": 12,
    "labelFormat": "dimension",
    "compose": null,
    "pii": false,
    "title": "Complaints by Wards",
    "subtitle": "All complaints by SLA state — per ward"
  },
  "params": [{
    "name": "window",
    "default": "last_7d",
    "allowed": ["last_1d", "last_7d", "last_30d", "wtd", "mtd"]
  }],
  "rbac": {
    "visibleTo": ["TICKET_REPORT_VIEWER", "PGR_VIEWER"]
  }
}'

SUBTYPE_PERFORMANCE_DATA='{
  "id": "cl_table_subtype_performance",
  "version": "1.0.0",
  "status": "published",
  "query": {
    "grain": "facts",
    "dimensions": ["service_code"],
    "measures": [
      { "name": "total", "agg": "count" },
      {
        "name": "avg_resolution_ms",
        "agg": "avg",
        "column": "resolution_ms",
        "filter": { "is_resolved": true }
      },
      { "name": "ideal_sla_ms", "agg": "avg", "column": "sla_target_ms" }
    ],
    "sort": [{ "by": "total", "dir": "desc" }],
    "limit": 30
  },
  "supportsSeries": false,
  "viz": {
    "kind": "rankedList",
    "format": "hoursDays",
    "valueKey": "avg_resolution_ms",
    "accent": "teal",
    "group": "complaint-landscape",
    "titleKey": "RAINMAKER-PGR.DASHBOARD_KPI_CL_TABLE_SUBTYPE_PERFORMANCE",
    "dimensionKey": "service_code",
    "measureKeys": ["total", "avg_resolution_ms", "ideal_sla_ms"],
    "tableProfile": "subtypePerformance",
    "compose": null,
    "pii": false,
    "title": "Complaint sub-type performance",
    "subtitle": "Share, resolution time and SLA by subtype",
    "columns": [
      { "id": "subtypeLabel", "label": "Subtype", "align": "left", "type": "text", "width": "30%" },
      { "id": "share_pct", "label": "% of complaints", "align": "left", "type": "percent", "width": "18%" },
      { "id": "avgResolutionMs", "label": "Avg resolution", "align": "left", "type": "hoursDays", "width": "22%" },
      { "id": "idealSlaMs", "label": "SLA", "align": "left", "type": "hoursDays", "width": "18%" }
    ]
  },
  "params": [{
    "name": "window",
    "default": "last_7d",
    "allowed": ["last_1d", "last_7d", "last_30d", "wtd", "mtd"]
  }],
  "rbac": {
    "visibleTo": ["TICKET_REPORT_VIEWER", "PGR_VIEWER"]
  }
}'

RECURRING_WARD_SUBTYPE_DATA='{
  "id": "cl_table_recurring_ward_subtype",
  "version": "1.0.0",
  "status": "published",
  "query": {
    "grain": "facts",
    "dimensions": ["ward_code", "service_code"],
    "measures": [{ "name": "total", "agg": "count" }],
    "sort": [{ "by": "total", "dir": "desc" }],
    "limit": 200
  },
  "supportsSeries": false,
  "viz": {
    "kind": "rankedList",
    "format": "integer",
    "valueKey": "total",
    "accent": "teal",
    "group": "complaint-landscape",
    "titleKey": "RAINMAKER-PGR.DASHBOARD_KPI_CL_TABLE_RECURRING_WARD_SUBTYPE",
    "dimensionKey": "ward_code",
    "measureKeys": ["total"],
    "tableProfile": "wardSubtypeRecurring",
    "needsPrior": true,
    "minCount": 3,
    "compose": null,
    "pii": false,
    "title": "Recurring complaints by ward & sub-type",
    "subtitle": "Ward × subtype pairs with ≥ 3 complaints in period",
    "columns": [
      { "id": "wardLabel", "label": "Ward", "align": "left", "type": "text", "width": "28%" },
      { "id": "subtypeLabel", "label": "Sub-type", "align": "left", "type": "text", "width": "32%" },
      { "id": "total", "label": "Total", "align": "left", "type": "integer", "width": "18%" },
      { "id": "trendPct", "label": "Trend", "align": "left", "type": "trend", "width": "22%" }
    ]
  },
  "params": [{
    "name": "window",
    "default": "last_7d",
    "allowed": ["last_1d", "last_7d", "last_30d", "wtd", "mtd"]
  }],
  "rbac": {
    "visibleTo": ["TICKET_REPORT_VIEWER", "PGR_VIEWER"]
  }
}'

OPEN_DAILY_DATA='{
  "id": "cl_chart_over_time_open_daily",
  "version": "1.0.0",
  "status": "published",
  "query": {
    "grain": "daily",
    "filters": { "is_open": true },
    "dimensions": ["snapshot_date"],
    "measures": [{ "name": "open", "agg": "count" }],
    "sort": [{ "by": "snapshot_date", "dir": "asc" }],
    "limit": 366
  },
  "supportsSeries": false,
  "viz": {
    "kind": "line",
    "format": "integer",
    "valueKey": "open",
    "accent": "teal",
    "group": "complaint-landscape",
    "titleKey": "RAINMAKER-PGR.DASHBOARD_KPI_CL_CHART_OVER_TIME_OPEN_DAILY",
    "dimensionKey": "snapshot_date",
    "compose": null,
    "pii": false,
    "title": "Open complaints over time (daily)"
  },
  "params": [{
    "name": "window",
    "default": "last_7d",
    "allowed": ["last_1d", "last_7d", "last_30d", "wtd", "mtd"]
  }],
  "rbac": {
    "visibleTo": ["TICKET_REPORT_VIEWER"]
  }
}'

COMPLAINTS_OVER_TIME_DATA='{
  "id": "cl_chart_complaints_over_time",
  "version": "1.0.0",
  "status": "published",
  "query": {
    "grain": "facts",
    "dimensions": ["created_date"],
    "measures": [{ "name": "created", "agg": "count" }],
    "sort": [{ "by": "created_date", "dir": "asc" }],
    "limit": 366
  },
  "supportsSeries": false,
  "viz": {
    "kind": "line",
    "format": "integer",
    "valueKey": "created",
    "accent": "teal",
    "group": "complaint-landscape",
    "titleKey": "RAINMAKER-PGR.DASHBOARD_KPI_CL_CHART_COMPLAINTS_OVER_TIME",
    "dimensionKey": "created_date",
    "labelFormat": "date-dow",
    "measureKeys": ["created", "resolved", "open", "on_time"],
    "compose": null,
    "seriesDefs": [
      { "name": "Created", "measureKey": "created", "color": "var(--chart-1)", "yAxisGroup": "count", "chartType": "column" },
      { "name": "Resolved", "measureKey": "resolved", "color": "var(--chart-2)", "yAxisGroup": "count", "chartType": "column" },
      { "name": "Open", "measureKey": "open", "color": "var(--chart-3)", "yAxisGroup": "count", "chartType": "column" },
      { "name": "On-time %", "numeratorKey": "on_time", "denominatorKey": "resolved", "color": "var(--chart-4)", "yAxisGroup": "percent", "chartType": "line" }
    ],
    "pii": false,
    "title": "Complaints over time",
    "subtitle": "Created, resolved and open per day"
  },
  "params": [{
    "name": "window",
    "default": "last_7d",
    "allowed": ["last_1d", "last_7d", "last_30d", "wtd", "mtd"]
  }],
  "rbac": {
    "visibleTo": ["TICKET_REPORT_VIEWER", "PGR_VIEWER"]
  }
}'

DEPARTMENT_BREACH_SCATTER_DATA='{
  "id": "cl_chart_department_breach_scatter",
  "version": "1.0.0",
  "status": "published",
  "query": {
    "grain": "daily",
    "filters": { "is_open": true },
    "dimensions": ["department_code"],
    "measures": [
      { "name": "open", "agg": "count" },
      { "name": "breached", "agg": "count", "filter": { "sla_status_bucket": "breached" } },
      {
        "name": "sla_elapsed",
        "agg": "count",
        "filter": { "sla_status_bucket": { "in": ["within", "approaching", "breached"] } }
      }
    ],
    "sort": [{ "by": "open", "dir": "desc" }],
    "limit": 50
  },
  "supportsSeries": false,
  "viz": {
    "kind": "line",
    "format": "percentOneDecimal",
    "valueKey": "open",
    "accent": "teal",
    "group": "complaint-landscape",
    "titleKey": "RAINMAKER-PGR.DASHBOARD_KPI_CL_CHART_DEPARTMENT_BREACH_SCATTER",
    "dimensionKey": "department_code",
    "measureKeys": ["open", "breached", "sla_elapsed"],
    "scatterProfile": "departmentBreachCaseload",
    "xMeasureKey": "open",
    "numeratorKey": "breached",
    "denominatorKey": "sla_elapsed",
    "xAxisLabel": "Caseload (open)",
    "yAxisLabel": "Breach rate (%)",
    "labelFormat": "department",
    "compose": null,
    "pii": false,
    "title": "Breach rate vs caseload by department",
    "subtitle": "Open caseload vs breach rate at period end"
  },
  "params": [{
    "name": "window",
    "default": "last_7d",
    "allowed": ["last_1d", "last_7d", "last_30d", "wtd", "mtd"]
  }],
  "rbac": {
    "visibleTo": ["TICKET_REPORT_VIEWER", "PGR_VIEWER"]
  }
}'

WARD_OPEN_DAILY_DATA='{
  "id": "cl_table_ward_open_daily",
  "version": "1.0.0",
  "status": "published",
  "query": {
    "grain": "daily",
    "filters": { "is_open": true },
    "dimensions": ["ward_code"],
    "measures": [{ "name": "open", "agg": "count" }],
    "sort": [{ "by": "open", "dir": "desc" }],
    "limit": 200
  },
  "supportsSeries": false,
  "viz": {
    "kind": "line",
    "format": "integer",
    "valueKey": "open",
    "accent": "teal",
    "group": "complaint-landscape",
    "titleKey": "RAINMAKER-PGR.DASHBOARD_KPI_CL_TABLE_WARD_OPEN_DAILY",
    "dimensionKey": "ward_code",
    "compose": null,
    "pii": false,
    "title": "Open complaints by ward (daily)"
  },
  "params": [{
    "name": "window",
    "default": "last_7d",
    "allowed": ["last_1d", "last_7d", "last_30d", "wtd", "mtd"]
  }],
  "rbac": {
    "visibleTo": ["TICKET_REPORT_VIEWER"]
  }
}'

WARD_PERFORMANCE_DATA='{
  "id": "cl_table_ward_performance",
  "version": "1.0.0",
  "status": "published",
  "query": {
    "grain": "facts",
    "dimensions": ["ward_code"],
    "measures": [
      { "name": "created", "agg": "count" },
      {
        "name": "reopen_rate",
        "agg": "ratio",
        "numerator": {
          "agg": "count",
          "filter": { "is_reopened": true, "is_resolved": true },
          "window": { "timeRole": "resolved_at" }
        },
        "denominator": {
          "agg": "count",
          "filter": { "is_resolved": true },
          "window": { "timeRole": "resolved_at" }
        }
      },
      {
        "name": "ontime_rate",
        "agg": "ratio",
        "numerator": {
          "agg": "count",
          "filter": { "is_resolved": true, "sla_breached": false },
          "window": { "timeRole": "resolved_at" }
        },
        "denominator": {
          "agg": "count",
          "filter": { "is_resolved": true },
          "window": { "timeRole": "resolved_at" }
        }
      },
      {
        "name": "avg_csat",
        "agg": "avg",
        "column": "rating",
        "filter": { "is_resolved": true, "has_rating": true },
        "window": { "timeRole": "resolved_at" }
      }
    ],
    "sort": [{ "by": "created", "dir": "desc" }],
    "limit": 200
  },
  "supportsSeries": false,
  "viz": {
    "kind": "rankedList",
    "format": "integer",
    "valueKey": "created",
    "accent": "teal",
    "group": "complaint-landscape",
    "titleKey": "RAINMAKER-PGR.DASHBOARD_KPI_CL_TABLE_WARD_PERFORMANCE",
    "dimensionKey": "ward_code",
    "measureKeys": ["created", "open", "reopen_rate", "ontime_rate", "avg_csat"],
    "tableProfile": "wardPerformance",
    "compose": null,
    "pii": false,
    "title": "Ward performance",
    "subtitle": "Created, open, reopen, on-time and CSAT by ward",
    "columns": [
      { "id": "wardLabel", "label": "Ward", "align": "left", "type": "text", "width": "24%" },
      { "id": "created", "label": "Created", "align": "left", "type": "integer", "width": "14%" },
      { "id": "open", "label": "Open", "align": "left", "type": "integer", "width": "14%" },
      { "id": "reopenRate", "label": "Reopen %", "align": "left", "type": "percent", "width": "16%" },
      { "id": "ontimeRate", "label": "On-time %", "align": "left", "type": "percent", "width": "16%" },
      { "id": "avgCsat", "label": "CSAT", "align": "left", "type": "rating", "width": "16%" }
    ]
  },
  "params": [{
    "name": "window",
    "default": "last_7d",
    "allowed": ["last_1d", "last_7d", "last_30d", "wtd", "mtd"]
  }],
  "rbac": {
    "visibleTo": ["TICKET_REPORT_VIEWER", "PGR_VIEWER"]
  }
}'

SERVICE_QUALITY_BY_CHANNEL_DATA='{
  "id": "cl_table_service_quality_by_channel",
  "version": "1.0.0",
  "status": "published",
  "query": {
    "grain": "facts",
    "dimensions": ["source"],
    "measures": [
      { "name": "volume", "agg": "count" },
      {
        "name": "resolved",
        "agg": "count",
        "filter": { "is_resolved": true },
        "window": { "timeRole": "resolved_at" }
      },
      {
        "name": "avg_csat",
        "agg": "avg",
        "column": "rating",
        "filter": { "is_resolved": true, "has_rating": true },
        "window": { "timeRole": "resolved_at" }
      }
    ],
    "sort": [{ "by": "volume", "dir": "desc" }],
    "limit": 100
  },
  "supportsSeries": false,
  "viz": {
    "kind": "rankedList",
    "format": "integer",
    "valueKey": "volume",
    "accent": "teal",
    "group": "complaint-landscape",
    "titleKey": "RAINMAKER-PGR.DASHBOARD_KPI_CL_TABLE_SERVICE_QUALITY_BY_CHANNEL",
    "dimensionKey": "source",
    "measureKeys": ["volume", "resolved", "avg_csat"],
    "tableProfile": "serviceQualityByChannel",
    "compose": null,
    "pii": false,
    "title": "Service quality by channel",
    "subtitle": "Volume, resolution rate and CSAT by intake channel",
    "columns": [
      { "id": "channelLabel", "label": "Channel", "align": "left", "type": "text", "width": "28%" },
      { "id": "volume", "label": "Volume", "align": "left", "type": "integer", "width": "20%" },
      { "id": "resolutionRate", "label": "Resolution", "align": "left", "type": "percent", "width": "26%" },
      { "id": "avgCsat", "label": "CSAT", "align": "left", "type": "rating", "width": "26%" }
    ]
  },
  "params": [{
    "name": "window",
    "default": "last_7d",
    "allowed": ["last_1d", "last_7d", "last_30d", "wtd", "mtd"]
  }],
  "rbac": {
    "visibleTo": ["TICKET_REPORT_VIEWER", "PGR_VIEWER"]
  }
}'

DEPARTMENT_FLOW_RATIO_DATA='{
  "id": "cl_chart_department_flow_ratio",
  "version": "1.0.0",
  "status": "published",
  "query": {
    "grain": "facts",
    "dimensions": ["department_code"],
    "measures": [
      { "name": "filed", "agg": "count" },
      {
        "name": "resolved",
        "agg": "count",
        "filter": { "is_resolved": true },
        "window": { "timeRole": "resolved_at" }
      }
    ],
    "limit": 500
  },
  "supportsSeries": false,
  "viz": {
    "kind": "bar",
    "orientation": "horizontal",
    "format": "decimalTwo",
    "valueKey": "resolved",
    "accent": "green",
    "group": "complaint-landscape",
    "dimensionKey": "department_code",
    "measureKeys": ["filed", "resolved"],
    "limit": 12,
    "labelFormat": "department",
    "compose": null,
    "pii": false,
    "title": "Flow ratio by department",
    "subtitle": "Resolved ÷ created — break-even at 1.00",
    "numeratorKey": "resolved",
    "denominatorKey": "filed",
    "breakEven": 1
  },
  "params": [{
    "name": "window",
    "default": "last_7d",
    "allowed": ["last_1d", "last_7d", "last_30d", "wtd", "mtd"]
  }],
  "rbac": {
    "visibleTo": ["TICKET_REPORT_VIEWER", "PGR_VIEWER"]
  }
}'

echo "==> 1/13 Upsert cl_total_complaints_count"
upsert_kpi "cl_total_complaints_count" "${TOTAL_COMPLAINTS_DATA}" "cl-total-complaints"

echo "==> 2/13 Upsert cl_flow_ratio_count"
upsert_kpi "cl_flow_ratio_count" "${FLOW_RATIO_DATA}" "cl-flow-ratio"

echo "==> 3/13 Upsert cl_chart_wards_by_sla"
upsert_kpi "cl_chart_wards_by_sla" "${WARDS_BY_SLA_DATA}" "cl-chart-wards-sla" || {
  echo "WARN: cl_chart_wards_by_sla upsert failed."
}

echo "==> 4/13 Upsert cl_table_subtype_performance"
upsert_kpi "cl_table_subtype_performance" "${SUBTYPE_PERFORMANCE_DATA}" "cl-table-subtype-perf" || {
  echo "WARN: cl_table_subtype_performance upsert failed."
}

echo "==> 5/13 Upsert cl_table_recurring_ward_subtype"
upsert_kpi "cl_table_recurring_ward_subtype" "${RECURRING_WARD_SUBTYPE_DATA}" "cl-table-recurring" || {
  echo "WARN: cl_table_recurring_ward_subtype upsert failed."
}

echo "==> 6/13 Upsert cl_chart_over_time_open_daily"
upsert_kpi "cl_chart_over_time_open_daily" "${OPEN_DAILY_DATA}" "cl-chart-open-daily" || {
  echo "WARN: cl_chart_over_time_open_daily upsert failed."
}

echo "==> 7/13 Upsert cl_chart_complaints_over_time"
upsert_kpi "cl_chart_complaints_over_time" "${COMPLAINTS_OVER_TIME_DATA}" "cl-chart-over-time" || {
  echo "WARN: cl_chart_complaints_over_time upsert failed."
}

echo "==> 8/13 Upsert cl_chart_department_breach_scatter"
upsert_kpi "cl_chart_department_breach_scatter" "${DEPARTMENT_BREACH_SCATTER_DATA}" "cl-chart-dept-scatter" || {
  echo "WARN: cl_chart_department_breach_scatter upsert failed."
}

echo "==> 9/13 Upsert cl_table_ward_open_daily"
upsert_kpi "cl_table_ward_open_daily" "${WARD_OPEN_DAILY_DATA}" "cl-table-ward-open-daily" || {
  echo "WARN: cl_table_ward_open_daily upsert failed."
}

echo "==> 10/13 Upsert cl_table_ward_performance"
upsert_kpi "cl_table_ward_performance" "${WARD_PERFORMANCE_DATA}" "cl-table-ward-perf" || {
  echo "WARN: cl_table_ward_performance upsert failed."
}

echo "==> 11/13 Upsert cl_table_service_quality_by_channel"
upsert_kpi "cl_table_service_quality_by_channel" "${SERVICE_QUALITY_BY_CHANNEL_DATA}" "cl-table-channel-quality" || {
  echo "WARN: cl_table_service_quality_by_channel upsert failed."
}

echo "==> 12/13 Upsert cl_chart_department_flow_ratio"
upsert_kpi "cl_chart_department_flow_ratio" "${DEPARTMENT_FLOW_RATIO_DATA}" "cl-chart-dept-flow" || {
  echo "WARN: cl_chart_department_flow_ratio upsert failed."
}

echo "==> 13/13 Update executive-default DashboardPack"
PACK_SEARCH="$(post_mdms "/mdms-v2/v2/_search" "$(cat <<EOF
{
  "RequestInfo": {
    "apiId": "Rainmaker",
    "authToken": "${TOKEN}",
    "msgId": "search-executive-pack"
  },
  "MdmsCriteria": {
    "tenantId": "${TENANT}",
    "schemaCode": "dss.DashboardPack",
    "limit": 50
  }
}
EOF
)")"

PACK_RECORD="$(python3 - <<'PY' "${PACK_SEARCH}"
import json, sys
payload = json.loads(sys.argv[1])
for row in payload.get("mdms", []):
    if row.get("uniqueIdentifier") == "executive-default":
        print(json.dumps(row))
        break
PY
)"

if [[ -z "${PACK_RECORD}" ]]; then
  echo "ERROR: executive-default pack not found on tenant ${TENANT}"
  echo "${PACK_SEARCH}"
  exit 1
fi

PACK_ID="$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['id'])" "${PACK_RECORD}")"
AUDIT="$(python3 -c "import json,sys; print(json.dumps(json.loads(sys.argv[1])['auditDetails']))" "${PACK_RECORD}")"

post_mdms "/mdms-v2/v2/_update/dss.DashboardPack" "$(cat <<EOF
{
  "RequestInfo": {
    "apiId": "Rainmaker",
    "authToken": "${TOKEN}",
    "msgId": "update-executive-pack"
  },
  "Mdms": {
    "tenantId": "${TENANT}",
    "schemaCode": "dss.DashboardPack",
    "id": "${PACK_ID}",
    "uniqueIdentifier": "executive-default",
    "isActive": true,
    "auditDetails": ${AUDIT},
    "data": {
      "id": "executive-default",
      "description": "Default executive dashboard pack — KPI strip, charts, tables, and map",
      "roles": ["TICKET_REPORT_VIEWER", "PGR_VIEWER"],
      "tiles": [
        "cl_resolved_on_time_rate_count",
        "cl_resolved_date_range_count",
        "cl_total_complaints_count",
        "cl_flow_ratio_count",
        "cl_oldest_open_age",
        "cl_csat_avg",
        "cl_chart_wards_by_sla",
        "cl_table_subtype_performance",
        "cl_map_ward_wow_current",
        "cl_table_recurring_ward_subtype",
        "cl_chart_complaints_over_time",
        "cl_chart_department_breach_scatter",
        "cl_table_ward_performance",
        "cl_table_service_quality_by_channel",
        "cl_chart_department_flow_ratio"
      ],
      "layout": [
        { "kpiId": "cl_resolved_on_time_rate_count", "x": 0, "y": 0, "w": 2, "h": 2 },
        { "kpiId": "cl_resolved_date_range_count", "x": 2, "y": 0, "w": 2, "h": 2 },
        { "kpiId": "cl_total_complaints_count", "x": 4, "y": 0, "w": 2, "h": 2 },
        { "kpiId": "cl_flow_ratio_count", "x": 6, "y": 0, "w": 2, "h": 2 },
        { "kpiId": "cl_oldest_open_age", "x": 8, "y": 0, "w": 2, "h": 2 },
        { "kpiId": "cl_csat_avg", "x": 10, "y": 0, "w": 2, "h": 2 },
        { "kpiId": "cl_chart_wards_by_sla", "x": 0, "y": 2, "w": 8, "h": 6 },
        { "kpiId": "cl_table_subtype_performance", "x": 8, "y": 2, "w": 4, "h": 6 },
        { "kpiId": "cl_map_ward_wow_current", "x": 0, "y": 8, "w": 12, "h": 9 },
        { "kpiId": "cl_table_recurring_ward_subtype", "x": 0, "y": 17, "w": 8, "h": 6 },
        { "kpiId": "cl_chart_complaints_over_time", "x": 0, "y": 23, "w": 8, "h": 6 },
        { "kpiId": "cl_chart_department_breach_scatter", "x": 0, "y": 29, "w": 8, "h": 6 }
      ]
    }
  }
}
EOF
)"
echo

echo "Done. Next as DEMO_EXECUTIVE:"
echo "  1. DevTools → Application → Local Storage → delete ccrs.dashboard.catalog-layout.v1"
echo "  2. Click Reset"
echo "  3. Hard refresh"
