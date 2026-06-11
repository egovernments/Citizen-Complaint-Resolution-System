export const TRENDING_COMPLAINTS_COLUMNS = [
  { id: "rank", label: "#", align: "left", type: "integer", width: "8%" },
  { id: "label", label: "Sub-type", align: "left", type: "text", width: "42%" },
  { id: "volume", label: "Volume", align: "right", type: "integer", width: "18%" },
  { id: "wow", label: "WoW", align: "right", type: "trend", width: "22%" },
];

export const RESOLUTION_BY_TYPE_COLUMNS = [
  { id: "label", label: "Type", align: "left", type: "text", width: "36%" },
  { id: "closurePct", label: "Closed %", align: "right", type: "percent", width: "18%" },
  { id: "ontimePct", label: "On-time %", align: "right", type: "percent", width: "22%" },
  { id: "avgTtrMs", label: "Avg TTR", align: "right", type: "hours", width: "24%" },
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

export const TABLE_WIDGET_CONFIG = {
  "cl-list-categories": {
    columns: TRENDING_COMPLAINTS_COLUMNS,
    dataKey: "trendingComplaints",
  },
  "cl-table-resolution": {
    columns: RESOLUTION_BY_TYPE_COLUMNS,
    dataKey: "resolutionByType",
  },
  "cl-table-locality": {
    columns: LOCALITY_COLUMNS,
    dataKey: "locality",
  },
  "cl-table-workflow-stages": {
    columns: WORKFLOW_STAGE_COLUMNS,
    dataKey: "workflowStages",
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
