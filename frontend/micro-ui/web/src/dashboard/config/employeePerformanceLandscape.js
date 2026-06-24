/**
 * Employee performance landscape — separate widgets:
 * - Employees with most open complaints (horizontal stacked bar)
 * - Employee performance (data table)
 */

export const EMPLOYEE_PERFORMANCE_SECTION = "Employee performance";

export const EMPLOYEE_PERFORMANCE_METRICS = [];

export const EMPLOYEE_OFFICER_OPEN_CHART = {
  id: "cl-chart-officer-sla",
  type: "stacked-bar",
  stackOrientation: "horizontal",
  metric: "Employees with most open complaints",
  subMetric: "Open complaints by SLA state per officer",
  outputFormat:
    "On track / Nearing breach / Breached — sorted by most breached",
  queryKey: "cl_chart_officer_sla",
};

export const EMPLOYEE_PERFORMANCE_TABLE = {
  id: "ep-table-employee-performance",
  type: "data-table",
  metric: "Employee performance",
  subMetric: "One row per officer",
  outputFormat:
    "Assigned, open, resolved, reopen rate, CSAT, escalation rate — live workload with threshold coloring",
  queryKey: "ep_table_employee_performance",
};

/** Inventory order: chart first, then table. */
export const EMPLOYEE_PERFORMANCE_CHARTS = [
  EMPLOYEE_OFFICER_OPEN_CHART,
  EMPLOYEE_PERFORMANCE_TABLE,
];
