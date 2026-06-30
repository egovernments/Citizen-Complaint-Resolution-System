/**
 * Hover preview content for the header “Add KPI” inventory list.
 */

import { getKpiDisplayConfig, getKpiDisplayTitle } from "./kpiDisplay";

function formatPreviewTarget(metricId) {
  const threshold = getKpiDisplayConfig(metricId).threshold;
  if (!threshold) return null;

  const { kind, onTrack } = threshold;
  if (kind === "percent") return `Target: ${onTrack}%`;
  if (kind === "rating") return `Target: ${onTrack}/5`;
  if (kind === "count") {
    if (metricId === "cl-metric-oldest-open") return `Target: ${onTrack} days`;
    return `Target: ${onTrack}`;
  }
  return null;
}

function resolvePreviewDescription(item) {
  if (item.itemType === "kpi") {
    return item.metric;
  }
  return item.subMetric || item.outputFormat || null;
}

function isDisplayableValue(value) {
  return value != null && value !== "—" && value !== "…";
}

export function buildAddKpiPreviewContent(item, { kpiCardData } = {}) {
  if (!item) return null;

  if (item.itemType === "kpi") {
    const card = kpiCardData?.[item.id];
    return {
      title: getKpiDisplayTitle(item),
      value: isDisplayableValue(card?.value) ? card.value : null,
      target: formatPreviewTarget(item.id),
      description: resolvePreviewDescription(item),
    };
  }

  return {
    title: item.metric,
    value: null,
    target: null,
    description: resolvePreviewDescription(item),
  };
}

export const ADD_KPI_PREVIEW_WIDTH_PX = 228;
export const ADD_KPI_PREVIEW_GAP_PX = 12;
