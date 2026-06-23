/**
 * Supervisor dashboard metric and widget catalog.
 */
import {
  LANDSCAPE_CHARTS,
  LANDSCAPE_METRICS,
  getSubMetricDef,
  subMetricValueKey,
} from "./complaintLandscape";
import {
  EMPLOYEE_PERFORMANCE_CHARTS,
} from "./employeePerformanceLandscape";
import {
  RESOLUTION_SLA_METRICS,
} from "./resolutionSlaLandscape";
import {
  CITIZEN_EXPERIENCE_METRICS,
} from "./citizenExperienceLandscape";
import { DEMO_VIZ_WIDGETS } from "./demoVisualizations";
import {
  isInventoryMetric,
  isInventoryWidget,
} from "./inventoryAllowlist";

export {
  LANDSCAPE_METRICS,
  LANDSCAPE_CHARTS,
  getSubMetricDef,
  subMetricValueKey,
  isInventoryMetric,
  isInventoryWidget,
};
export { DEFAULT_VIEW_KPI_IDS, DEFAULT_VIEW_WIDGET_IDS } from "./inventoryAllowlist";
export { INVENTORY_SECTIONS } from "./complaintLandscape";

export const CHART_WIDGETS = [
  ...LANDSCAPE_CHARTS,
  ...EMPLOYEE_PERFORMANCE_CHARTS,
  ...DEMO_VIZ_WIDGETS,
];

export const KPI_METRICS = [
  ...LANDSCAPE_METRICS,
  ...RESOLUTION_SLA_METRICS,
  ...CITIZEN_EXPERIENCE_METRICS,
];

/** KPI cards and widgets offered in the header “add KPI” menu. */
export const INVENTORY_KPI_METRICS = KPI_METRICS.filter((m) =>
  isInventoryMetric(m.id)
);
export const INVENTORY_CHART_WIDGETS = CHART_WIDGETS.filter((w) =>
  isInventoryWidget(w.id)
);
