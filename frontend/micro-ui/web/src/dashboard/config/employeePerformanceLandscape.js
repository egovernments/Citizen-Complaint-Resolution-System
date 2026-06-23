/**
 * Employee performance landscape — table widget only (no standalone KPI cards).
 */

export const EMPLOYEE_PERFORMANCE_SECTION = "Employee performance";

export const EMPLOYEE_PERFORMANCE_METRICS = [];

export const EMPLOYEE_PERFORMANCE_CHARTS = [
  {
    id: "ep-table-employee-performance",
    type: "data-table",
    metric: "Employee performance",
    subMetric: "One row per officer",
    outputFormat:
      "Assigned, open, resolved, reopen rate, CSAT, escalation rate — live workload with threshold coloring",
    queryKey: "ep_table_employee_performance",
  },
];
