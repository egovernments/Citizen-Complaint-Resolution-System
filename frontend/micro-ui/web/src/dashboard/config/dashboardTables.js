export const TRENDING_COMPLAINTS_COLUMNS = [
  { id: "rank", label: "#", align: "left", type: "integer", width: "8%" },
  { id: "label", label: "Sub-type", align: "left", type: "text", width: "38%" },
  { id: "volume", label: "Volume", align: "right", type: "integer", width: "20%" },
  { id: "wow", label: "WoW", align: "right", type: "trend", width: "22%" },
];

export const RESOLUTION_BY_TYPE_COLUMNS = [
  { id: "label", label: "Complaint sub-type", align: "left", type: "text" },
  { id: "closurePct", label: "Closure", align: "right", type: "percent" },
  { id: "ontimePct", label: "On-time", align: "right", type: "percent" },
  { id: "avgTtrMs", label: "Avg. resolution", align: "right", type: "hours" },
];

export const LOCALITY_COLUMNS = [
  { id: "label", label: "Ward", align: "left", type: "text", width: "36%" },
  { id: "logged", label: "Logged", align: "right", type: "integer", width: "18%" },
  { id: "open", label: "Open", align: "right", type: "integer", width: "18%" },
  { id: "ontimePct", label: "On-time %", align: "right", type: "percent", width: "28%" },
];

export const WORKFLOW_STAGE_COLUMNS = [
  { id: "label", label: "Stage", align: "left", type: "text", width: "34%" },
  { id: "avgDwellMs", label: "Avg dwell", align: "right", type: "hours", width: "22%" },
  { id: "medianDwellMs", label: "Median dwell", align: "right", type: "hours", width: "24%" },
  { id: "samples", label: "Samples", align: "right", type: "integer", width: "20%" },
];

export const EMPLOYEE_PERFORMANCE_COLUMNS = [
  { id: "officerName", label: "Name", align: "left", type: "text", width: "14%" },
  { id: "role", label: "Role", align: "left", type: "text", width: "10%" },
  { id: "dept", label: "Dept", align: "left", type: "text", width: "12%" },
  { id: "statusTags", label: "Status", align: "left", type: "tags", width: "14%" },
  { id: "assigned", label: "Assigned", align: "right", type: "integer", width: "8%" },
  { id: "open", label: "Open", align: "right", type: "integer", width: "7%", thresholdKey: "open" },
  { id: "resolved", label: "Resolved", align: "right", type: "integer", width: "8%" },
  {
    id: "reopenRate",
    label: "Reopen rate",
    align: "right",
    type: "percent",
    width: "9%",
    thresholdKey: "reopenRate",
  },
  { id: "avgCsat", label: "CSAT", align: "right", type: "rating", width: "7%", thresholdKey: "avgCsat" },
  {
    id: "escalationRate",
    label: "Escalation rate",
    align: "right",
    type: "percent",
    width: "11%",
    thresholdKey: "escalationRate",
  },
];

export const COMPLAINT_TYPE_DETAILS_COLUMNS = [
  { id: "subtypeLabel", label: "Subtype", align: "left", type: "text", width: "16%" },
  { id: "typeLabel", label: "Type", align: "left", type: "text", width: "12%" },
  {
    id: "avgResolutionMs",
    label: "Avg resolution time",
    align: "right",
    type: "hoursDays",
    width: "13%",
  },
  { id: "idealSlaMs", label: "Ideal (SLA)", align: "right", type: "hoursDays", width: "11%" },
  { id: "reopenRate", label: "Reopen rate", align: "right", type: "percent", width: "10%" },
  {
    id: "oldestOpenMs",
    label: "Oldest complaint",
    align: "right",
    type: "hoursDays",
    width: "13%",
  },
  {
    id: "ontimeRate",
    label: "Resolved on-time rate",
    align: "right",
    type: "percent",
    width: "13%",
  },
  { id: "avgCsat", label: "CSAT", align: "right", type: "rating", width: "8%" },
];

export const TABLE_WIDGET_CONFIG = {
  "cl-table-complaint-type-details": {
    columns: COMPLAINT_TYPE_DETAILS_COLUMNS,
    dataKey: "complaintTypeDetails",
  },
  "ep-table-employee-performance": {
    columns: EMPLOYEE_PERFORMANCE_COLUMNS,
    dataKey: "employeePerformance",
  },
  /** @deprecated saved layouts may still reference this id */
  "cl-chart-workflow-stages": {
    columns: WORKFLOW_STAGE_COLUMNS,
    dataKey: "workflowStages",
  },
};

export function isTableWidget(widgetId) {
  return Boolean(TABLE_WIDGET_CONFIG[widgetId]);
}
