/**
 * Combined supervisor dashboard inventory and metric exports.
 */
import {
  COMPLAINT_LANDSCAPE_SECTION,
  INVENTORY_SECTIONS as COMPLAINT_INVENTORY_SECTIONS,
  LANDSCAPE_CHARTS,
  LANDSCAPE_METRICS,
  getSubMetricDef,
  subMetricValueKey,
} from "./complaintLandscape";
import {
  EMPLOYEE_PERFORMANCE_METRICS,
  EMPLOYEE_PERFORMANCE_SECTION,
} from "./employeePerformanceLandscape";

export {
  COMPLAINT_LANDSCAPE_SECTION,
  EMPLOYEE_PERFORMANCE_SECTION,
  LANDSCAPE_METRICS,
  LANDSCAPE_CHARTS,
  EMPLOYEE_PERFORMANCE_METRICS,
  getSubMetricDef,
  subMetricValueKey,
};

export const CHART_WIDGETS = LANDSCAPE_CHARTS;
export const KPI_METRICS = [...LANDSCAPE_METRICS, ...EMPLOYEE_PERFORMANCE_METRICS];

export const INVENTORY_SECTIONS = [
  ...COMPLAINT_INVENTORY_SECTIONS,
  {
    id: "employee-performance",
    label: EMPLOYEE_PERFORMANCE_SECTION,
    description: "Officer load, resolution speed, and quality signals",
    metricIds: EMPLOYEE_PERFORMANCE_METRICS.map((m) => m.id),
  },
];
