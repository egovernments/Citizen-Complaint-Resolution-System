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
import {
  RESOLUTION_SLA_METRICS,
  RESOLUTION_SLA_SECTION,
} from "./resolutionSlaLandscape";
import {
  ESCALATIONS_RISK_METRICS,
  ESCALATIONS_RISK_SECTION,
} from "./escalationsRiskLandscape";
import {
  CITIZEN_EXPERIENCE_METRICS,
  CITIZEN_EXPERIENCE_SECTION,
} from "./citizenExperienceLandscape";
import {
  COMPARATIVE_REPORTING_METRICS,
  COMPARATIVE_REPORTING_SECTION,
} from "./comparativeReportingLandscape";
import { DEMO_VIZ_WIDGETS } from "./demoVisualizations";

export {
  COMPLAINT_LANDSCAPE_SECTION,
  EMPLOYEE_PERFORMANCE_SECTION,
  RESOLUTION_SLA_SECTION,
  ESCALATIONS_RISK_SECTION,
  CITIZEN_EXPERIENCE_SECTION,
  COMPARATIVE_REPORTING_SECTION,
  LANDSCAPE_METRICS,
  LANDSCAPE_CHARTS,
  EMPLOYEE_PERFORMANCE_METRICS,
  RESOLUTION_SLA_METRICS,
  ESCALATIONS_RISK_METRICS,
  CITIZEN_EXPERIENCE_METRICS,
  COMPARATIVE_REPORTING_METRICS,
  getSubMetricDef,
  subMetricValueKey,
};

export const CHART_WIDGETS = [...LANDSCAPE_CHARTS, ...DEMO_VIZ_WIDGETS];
export const KPI_METRICS = [
  ...LANDSCAPE_METRICS,
  ...EMPLOYEE_PERFORMANCE_METRICS,
  ...RESOLUTION_SLA_METRICS,
  ...ESCALATIONS_RISK_METRICS,
  ...CITIZEN_EXPERIENCE_METRICS,
  ...COMPARATIVE_REPORTING_METRICS,
];

export const INVENTORY_SECTIONS = [
  ...COMPLAINT_INVENTORY_SECTIONS,
  {
    id: "employee-performance",
    label: EMPLOYEE_PERFORMANCE_SECTION,
    description: "Officer load, resolution speed, and quality signals",
    metricIds: EMPLOYEE_PERFORMANCE_METRICS.map((m) => m.id),
    widgetIds: null,
  },
  {
    id: "resolution-sla",
    label: RESOLUTION_SLA_SECTION,
    description: "SLA compliance, breaches, closure, and backlog flow",
    metricIds: RESOLUTION_SLA_METRICS.map((m) => m.id),
    widgetIds: null,
  },
  {
    id: "escalations-risk",
    label: ESCALATIONS_RISK_SECTION,
    description: "Aging buckets, escalations, stale cases, and breach risk",
    metricIds: ESCALATIONS_RISK_METRICS.map((m) => m.id),
    widgetIds: null,
  },
  {
    id: "citizen-experience",
    label: CITIZEN_EXPERIENCE_SECTION,
    description: "CSAT, reopens, repeat flags, and first-response timeliness",
    metricIds: CITIZEN_EXPERIENCE_METRICS.map((m) => m.id),
    widgetIds: null,
  },
  {
    id: "comparative-reporting",
    label: COMPARATIVE_REPORTING_SECTION,
    description: "YoY trends, target benchmarks, and weekly commissioner digest",
    metricIds: COMPARATIVE_REPORTING_METRICS.map((m) => m.id),
    widgetIds: null,
  },
];
