export const TRENDING_COMPLAINTS_COLUMNS = [
  { id: "rank", label: "#", align: "left", type: "integer", width: "8%" },
  { id: "label", label: "Sub-type", align: "left", type: "text", width: "38%" },
  { id: "volume", label: "Volume", align: "left", type: "integer", width: "20%" },
  { id: "wow", label: "WoW", align: "left", type: "trend", width: "22%" },
];

export const RESOLUTION_BY_TYPE_COLUMNS = [
  { id: "label", label: "Complaint sub-type", align: "left", type: "text" },
  { id: "closurePct", label: "Closure", align: "left", type: "percent" },
  { id: "ontimePct", label: "On-time", align: "left", type: "percent" },
  { id: "avgTtrMs", label: "Avg. resolution", align: "left", type: "hours" },
];

export const LOCALITY_COLUMNS = [
  { id: "label", label: "Ward", align: "left", type: "text", width: "36%" },
  { id: "logged", label: "Logged", align: "left", type: "integer", width: "18%" },
  { id: "open", label: "Open", align: "left", type: "integer", width: "18%" },
  { id: "ontimePct", label: "On-time %", align: "left", type: "percent", width: "28%" },
];

export const WORKFLOW_STAGE_COLUMNS = [
  { id: "label", label: "Stage", align: "left", type: "text", width: "34%" },
  { id: "avgDwellMs", label: "Avg dwell", align: "left", type: "hours", width: "22%" },
  { id: "medianDwellMs", label: "Median dwell", align: "left", type: "hours", width: "24%" },
  { id: "samples", label: "Samples", align: "left", type: "integer", width: "20%" },
];

export const EMPLOYEE_PERFORMANCE_COLUMNS = [
  { id: "officerName", label: "Name", align: "left", type: "text", width: "16%" },
  { id: "role", label: "Role", align: "left", type: "text", width: "12%" },
  { id: "dept", label: "Dept", align: "left", type: "text", width: "14%" },
  { id: "assigned", label: "Assigned", align: "left", type: "integer", width: "9%" },
  { id: "open", label: "Open", align: "left", type: "integer", width: "8%", thresholdKey: "open" },
  { id: "resolved", label: "Resolved", align: "left", type: "integer", width: "9%" },
  {
    id: "reopenRate",
    label: "Reopen rate",
    align: "left",
    type: "percent",
    width: "10%",
    thresholdKey: "reopenRate",
  },
  { id: "avgCsat", label: "CSAT", align: "left", type: "rating", width: "8%", thresholdKey: "avgCsat" },
  {
    id: "escalationRate",
    label: "Escalation rate",
    align: "left",
    type: "percent",
    width: "14%",
    thresholdKey: "escalationRate",
  },
];

export const COMPLAINT_TYPE_DETAILS_COLUMNS = [
  { id: "subtypeLabel", label: "Subtype", align: "left", type: "text", width: "16%" },
  { id: "typeLabel", label: "Type", align: "left", type: "text", width: "12%" },
  {
    id: "avgResolutionMs",
    label: "Avg resolution time",
    align: "left",
    type: "hoursDays",
    width: "13%",
    thresholdKey: "avgResolutionMs",
  },
  {
    id: "idealSlaMs",
    label: "SLA",
    align: "left",
    type: "hoursDays",
    width: "11%",
  },
  {
    id: "reopenRate",
    label: "Reopen rate",
    align: "left",
    type: "percent",
    width: "10%",
    thresholdKey: "reopenRate",
  },
  {
    id: "oldestOpenMs",
    label: "Oldest complaint",
    align: "left",
    type: "hoursDays",
    width: "13%",
    thresholdKey: "oldestOpenMs",
  },
  {
    id: "ontimeRate",
    label: "Resolved on-time rate",
    align: "left",
    type: "percent",
    width: "13%",
    thresholdKey: "ontimeRate",
  },
  {
    id: "avgCsat",
    label: "CSAT",
    align: "left",
    type: "rating",
    width: "8%",
    thresholdKey: "avgCsat",
  },
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
