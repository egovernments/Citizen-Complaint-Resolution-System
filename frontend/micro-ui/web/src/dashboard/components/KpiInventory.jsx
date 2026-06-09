import React, { useMemo } from "react";
import { KPI_METRICS } from "../config/kpiQueries";
import { INVENTORY_SECTIONS, getSubMetricDef, subMetricValueKey } from "../config/complaintLandscape";

const DRAG_TYPE = "application/x-supervisor-dashboard-kpi";

const METRIC_LOOKUP = Object.fromEntries(KPI_METRICS.map((m) => [m.id, m]));

const KpiInventory = ({
  visibleKpiIds,
  onAddKpi,
  onDragKpiStart,
  onDragKpiEnd,
  subMetricValues = {},
  getSubMetricId,
}) => {
  const sections = useMemo(
    () =>
      INVENTORY_SECTIONS.map((section) => ({
        ...section,
        metrics: (section.metricIds || [])
          .map((id) => METRIC_LOOKUP[id])
          .filter(Boolean)
          .filter((m) => !visibleKpiIds.includes(m.id)),
      })),
    [visibleKpiIds]
  );

  const totalAvailable = sections.reduce((sum, section) => sum + section.metrics.length, 0);

  const previewValue = (metric) => {
    const subId = getSubMetricId?.(metric.id) || metric.defaultSubMetricId;
    const sub = getSubMetricDef(metric, subId);
    return subMetricValues[subMetricValueKey(metric.id, sub.id)] ?? "…";
  };

  const handleDragStart = (event, metricId) => {
    event.dataTransfer.setData("text/plain", metricId);
    event.dataTransfer.setData(DRAG_TYPE, metricId);
    event.dataTransfer.effectAllowed = "copy";
    onDragKpiStart?.(metricId);
  };

  return (
    <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-border-t tw-border-teal-800">
      <div className="tw-px-3 tw-pt-3">
        <h3 className="tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wider tw-text-teal-200">
          Metric inventory
        </h3>
        <p className="tw-mt-0.5 tw-text-xs tw-text-teal-300">
          Drag metrics onto dashboard · {totalAvailable} available
        </p>
      </div>

      <div className="tw-min-h-0 tw-flex-1 tw-overflow-y-auto tw-p-3 tw-pt-2">
        {totalAvailable === 0 ? (
          <div className="tw-space-y-4">
            {sections.map((section) => (
              <section key={section.id}>
                <div className="tw-mb-2">
                  <h4 className="tw-text-[11px] tw-font-semibold tw-uppercase tw-tracking-wide tw-text-teal-100">
                    {section.label}
                  </h4>
                  {section.description ? (
                    <p className="tw-mt-0.5 tw-text-[10px] tw-leading-snug tw-text-teal-400">
                      {section.description}
                    </p>
                  ) : null}
                </div>
                <p className="tw-text-xs tw-leading-relaxed tw-text-teal-300 tw-opacity-80">
                  All metrics in this category are on the dashboard.
                </p>
              </section>
            ))}
          </div>
        ) : (
          <div className="tw-space-y-4">
            {sections.map((section) => (
              <section key={section.id}>
                <div className="tw-mb-2">
                  <h4 className="tw-text-[11px] tw-font-semibold tw-uppercase tw-tracking-wide tw-text-teal-100">
                    {section.label}
                  </h4>
                  {section.description ? (
                    <p className="tw-mt-0.5 tw-text-[10px] tw-leading-snug tw-text-teal-400">
                      {section.description}
                    </p>
                  ) : null}
                </div>
                <ul className="tw-space-y-2">
                  {section.metrics.map((metric) => (
                    <li key={metric.id}>
                      <div
                        draggable
                        onDragStart={(event) => handleDragStart(event, metric.id)}
                        onDragEnd={onDragKpiEnd}
                        className="kpi-inventory-item tw-cursor-grab tw-rounded-md tw-border tw-border-teal-700 tw-bg-teal-900/40 tw-px-3 tw-py-2 active:tw-cursor-grabbing"
                      >
                        <div className="tw-flex tw-items-start tw-justify-between tw-gap-2">
                          <div className="tw-min-w-0">
                            <p className="tw-text-xs tw-font-medium tw-leading-snug tw-text-teal-50">
                              {metric.metric}
                            </p>
                            <p className="tw-mt-0.5 tw-text-[10px] tw-text-teal-400">
                              {metric.subMetrics.length} sub-metrics
                            </p>
                            <p className="tw-mt-0.5 tw-text-xs tw-font-semibold tw-text-teal-200">
                              {previewValue(metric)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={() => onAddKpi(metric.id)}
                            className="tw-flex-shrink-0 tw-rounded tw-bg-teal-700 tw-px-1.5 tw-py-0.5 tw-text-[10px] tw-font-medium tw-text-white hover:tw-bg-teal-600"
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default KpiInventory;
