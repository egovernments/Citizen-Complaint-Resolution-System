/**
 * Icon kinds for the supervisor Add-KPI inventory list.
 * Keys are catalog kpiId values (KpiDefinition.data.id).
 *
 * Kinds: trend-down | gauge | shield | target
 */
export const ADD_KPI_INVENTORY_ICON_BY_ID = {
  cl_new_created_count: "trend-down",
  cl_total_complaints_count: "trend-down",
  cl_open_complaints_live: "trend-down",
  cl_resolved_date_range_count: "gauge",
  cl_created_today_count: "trend-down",
  cl_resolution_rate_count: "gauge",
  cl_oldest_open_age: "gauge",
  cl_avg_resolution_time: "gauge",
  cl_reopen_rate_count: "shield",
  cl_csat_avg: "target",
  cl_first_assignment_rate_count: "shield",
  cl_sla_compliance_rate_count: "gauge",
  cl_sla_noncompliance_rate_count: "gauge",
  cl_resolved_on_time_rate_count: "gauge",
  cl_flow_ratio_count: "gauge",
  cl_chart_over_time_created_daily: "trend-down",
  cl_chart_complaints_by_type: "trend-down",
  cl_chart_departments_by_type: "trend-down",
  cl_chart_officer_sla: "gauge",
  cl_chart_wards_by_sla: "gauge",
  cl_table_subtype_performance: "gauge",
  cl_table_recurring_ward_subtype: "trend-down",
  cl_chart_complaints_over_time: "trend-down",
  cl_chart_department_breach_scatter: "gauge",
  cl_table_ward_performance: "gauge",
  cl_table_service_quality_by_channel: "gauge",
  cl_chart_open_by_type_stage: "gauge",
  cl_map_ward_wow_current: "gauge",
  cl_chart_department_resolution_rate: "gauge",
  cl_chart_open_by_channel: "gauge",
  cl_table_complaint_type_details: "gauge",
  cl_chart_open_by_age: "gauge",
  ep_table_employee_performance: "gauge",
  cl_table_complaints_at_risk: "shield",
  cl_chart_department_flow_ratio: "gauge",
};

export function resolveAddKpiInventoryIcon(item) {
  return ADD_KPI_INVENTORY_ICON_BY_ID[item?.id] ?? null;
}
