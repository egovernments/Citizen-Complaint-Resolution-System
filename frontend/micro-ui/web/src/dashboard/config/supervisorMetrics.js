/**
 * Combined supervisor dashboard inventory and metric exports.
 */
import {
  COMPLAINT_LANDSCAPE_SECTION,
  INVENTORY_SECTIONS as COMPLAINT_INVENTORY_SECTIONS,
  LANDSCAPE_CHARTS,
  LANDSCAPE_METRICS,
  VISUALIZATIONS_SECTION,
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
import {
  filterInventoryMetricIds,
  filterInventoryWidgetIds,
  isInventoryMetric,
  isInventoryWidget,
} from "./inventoryAllowlist";

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
  isInventoryMetric,
  isInventoryWidget,
};
export { DEFAULT_VIEW_KPI_IDS, DEFAULT_VIEW_WIDGET_IDS } from "./inventoryAllowlist";

export const CHART_WIDGETS = [...LANDSCAPE_CHARTS, ...DEMO_VIZ_WIDGETS];
export const KPI_METRICS = [
  ...LANDSCAPE_METRICS,
  ...EMPLOYEE_PERFORMANCE_METRICS,
  ...RESOLUTION_SLA_METRICS,
  ...ESCALATIONS_RISK_METRICS,
  ...CITIZEN_EXPERIENCE_METRICS,
  ...COMPARATIVE_REPORTING_METRICS,
];

const INVENTORY_WIDGET_POOL = [
  ...LANDSCAPE_CHARTS.map((chart) => chart.id),
  ...DEMO_VIZ_WIDGETS.map((widget) => widget.id),
];

function buildInventorySection(section) {
  return {
    ...section,
    metricIds: section.metricIds
      ? filterInventoryMetricIds(section.metricIds)
      : null,
    widgetIds: section.widgetIds
      ? filterInventoryWidgetIds(section.widgetIds)
      : null,
  };
}

/** Sidebar inventory — only allowlisted metrics/widgets not already on the dashboard. */
export const INVENTORY_SECTIONS = [
  buildInventorySection(COMPLAINT_INVENTORY_SECTIONS[0]),
  {
    id: "visualizations",
    label: VISUALIZATIONS_SECTION,
    description: "Charts and tables available to add",
    metricIds: null,
    widgetIds: filterInventoryWidgetIds(INVENTORY_WIDGET_POOL),
  },
  buildInventorySection({
    id: "resolution-sla",
    label: RESOLUTION_SLA_SECTION,
    description: "SLA compliance, breaches, closure, and backlog flow",
    metricIds: RESOLUTION_SLA_METRICS.map((m) => m.id),
    widgetIds: null,
  }),
  buildInventorySection({
    id: "citizen-experience",
    label: CITIZEN_EXPERIENCE_SECTION,
    description: "CSAT, reopens, and satisfaction signals",
    metricIds: CITIZEN_EXPERIENCE_METRICS.map((m) => m.id),
    widgetIds: null,
  }),
].filter(
  (section) =>
    (section.metricIds?.length ?? 0) > 0 || (section.widgetIds?.length ?? 0) > 0
);

/** KPI cards and widgets offered in the header “add metric” menu. */
export const INVENTORY_KPI_METRICS = KPI_METRICS.filter((m) =>
  isInventoryMetric(m.id)
);
export const INVENTORY_CHART_WIDGETS = CHART_WIDGETS.filter((w) =>
  isInventoryWidget(w.id)
);
