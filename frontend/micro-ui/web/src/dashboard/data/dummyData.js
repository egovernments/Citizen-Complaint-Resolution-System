/** All KPI metrics available in the inventory (dummy data). */
export const KPI_INVENTORY = [
  { id: "kpi-total", label: "Total Complaints Filed", value: "320", accent: "teal" },
  { id: "kpi-resolved", label: "Complaints Resolved", value: "210", accent: "green" },
  { id: "kpi-pending", label: "Complaints Pending", value: "85", accent: "amber" },
  { id: "kpi-escalated", label: "Complaints Escalated", value: "25", accent: "red" },
  { id: "kpi-avg-time", label: "Average Resolution Time", value: "4.2 days", accent: "slate" },
  { id: "kpi-satisfaction", label: "Citizen Satisfaction Rate", value: "87%", accent: "teal" },
  { id: "kpi-response-time", label: "Avg First Response Time", value: "2.1 days", accent: "green" },
  { id: "kpi-reopened", label: "Reopened Complaints", value: "12", accent: "amber" },
  { id: "kpi-sla-breach", label: "SLA Breaches", value: "8", accent: "red" },
  { id: "kpi-citizen-portal", label: "Citizen Portal Submissions", value: "145", accent: "slate" },
];

/** @deprecated use KPI_INVENTORY */
export const kpiMetrics = KPI_INVENTORY;

export const departmentComplaints = [
  { department: "Public Works", count: 80 },
  { department: "Health", count: 60 },
  { department: "Water", count: 55 },
  { department: "Education", count: 45 },
  { department: "Roads", count: 40 },
  { department: "Other", count: 40 },
];

export const monthlyTrend = {
  months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
  filed: [42, 48, 55, 50, 62, 63],
  resolved: [35, 40, 45, 48, 52, 55],
};
