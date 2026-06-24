import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CHART_WIDGETS,
  KPI_METRICS,
  INVENTORY_SECTIONS,
} from "../config/supervisorMetrics";
import { isInventoryMetric, isInventoryWidget } from "../config/inventoryAllowlist";

const DRAG_TYPE = "application/x-supervisor-dashboard-kpi";

const METRIC_LOOKUP = Object.fromEntries(KPI_METRICS.map((m) => [m.id, m]));
const WIDGET_LOOKUP = Object.fromEntries(CHART_WIDGETS.map((w) => [w.id, w]));

function findSectionForWidgetId(widgetId) {
  return INVENTORY_SECTIONS.find(
    (section) =>
      section.metricIds?.includes(widgetId) || section.widgetIds?.includes(widgetId)
  );
}

const KpiInventory = ({
  visibleLayoutIds,
  onAddWidget,
  onDragKpiStart,
  onDragKpiEnd,
}) => {
  const [expandedSectionId, setExpandedSectionId] = useState(null);
  const prevLayoutIdsRef = useRef(visibleLayoutIds);

  useEffect(() => {
    const prev = new Set(prevLayoutIdsRef.current);
    const curr = new Set(visibleLayoutIds);

    for (const id of prev) {
      if (!curr.has(id)) {
        const section = findSectionForWidgetId(id);
        if (section) {
          setExpandedSectionId(section.id);
        }
        break;
      }
    }

    prevLayoutIdsRef.current = visibleLayoutIds;
  }, [visibleLayoutIds]);

  const sections = useMemo(
    () =>
      INVENTORY_SECTIONS.map((section) => {
        const metrics = (section.metricIds || [])
          .map((id) => METRIC_LOOKUP[id])
          .filter(Boolean)
          .filter((m) => isInventoryMetric(m.id))
          .filter((m) => !visibleLayoutIds.includes(m.id));

        const widgets = (section.widgetIds || [])
          .map((id) => WIDGET_LOOKUP[id])
          .filter(Boolean)
          .filter((w) => isInventoryWidget(w.id))
          .filter((w) => !visibleLayoutIds.includes(w.id));

        return {
          ...section,
          metrics,
          widgets,
        };
      }),
    [visibleLayoutIds]
  );

  const totalAvailable = sections.reduce(
    (sum, section) => sum + section.metrics.length + section.widgets.length,
    0
  );

  const handleDragStart = (event, metricId) => {
    event.dataTransfer.setData("text/plain", metricId);
    event.dataTransfer.setData(DRAG_TYPE, metricId);
    event.dataTransfer.effectAllowed = "copy";
    onDragKpiStart?.(metricId);
  };

  const toggleSection = (sectionId) => {
    setExpandedSectionId((current) => (current === sectionId ? null : sectionId));
  };

  const renderInventoryItem = (item, { draggable = false } = {}) => (
    <li key={item.id}>
      <div
        draggable={draggable}
        onDragStart={draggable ? (event) => handleDragStart(event, item.id) : undefined}
        onDragEnd={draggable ? onDragKpiEnd : undefined}
        className={`kpi-inventory-item tw-flex tw-items-center tw-justify-between tw-gap-2 tw-rounded-md tw-border tw-border-[color-mix(in_srgb,var(--chrome-foreground)_18%,transparent)] tw-bg-[color-mix(in_srgb,var(--chrome-foreground)_8%,transparent)] tw-px-3 tw-py-2 ${
          draggable ? "tw-cursor-grab active:tw-cursor-grabbing" : ""
        }`}
      >
        <p className="tw-min-w-0 tw-flex-1 tw-text-xs tw-font-medium tw-leading-snug tw-text-chrome-foreground">
          {item.metric}
        </p>
        <button
          type="button"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => onAddWidget(item.id)}
          className="tw-flex-shrink-0 tw-rounded tw-bg-primary tw-px-1.5 tw-py-0.5 tw-text-[10px] tw-font-medium tw-text-primary-foreground hover:tw-bg-[color-mix(in_srgb,var(--primary)_85%,white)]"
        >
          Add
        </button>
      </div>
    </li>
  );

  return (
    <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-border-t tw-border-[color-mix(in_srgb,var(--chrome-foreground)_15%,transparent)]">
      <div className="tw-px-3 tw-pt-3">
        <h3 className="tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wider tw-text-chrome-muted">
          Metric inventory
        </h3>
        <p className="tw-mt-0.5 tw-text-xs tw-text-chrome-muted">
          Select a category · {totalAvailable} available
        </p>
      </div>

      <div className="tw-min-h-0 tw-flex-1 tw-overflow-y-auto tw-p-3 tw-pt-2">
        <div className="tw-space-y-1">
          {sections.map((section) => {
            const isExpanded = expandedSectionId === section.id;
            const itemCount = section.metrics.length + section.widgets.length;

            return (
              <section key={section.id}>
                <button
                  type="button"
                  onClick={() => toggleSection(section.id)}
                  aria-expanded={isExpanded}
                  className={`tw-flex tw-w-full tw-items-center tw-justify-between tw-gap-2 tw-rounded-md tw-border-0 tw-px-2.5 tw-py-2 tw-text-left tw-transition-colors ${
                    isExpanded
                      ? "tw-bg-surface tw-text-foreground tw-shadow-sm"
                      : "tw-bg-surface-2 tw-text-foreground hover:tw-bg-surface"
                  }`}
                >
                  <span className="tw-text-[11px] tw-font-semibold tw-uppercase tw-tracking-wide">
                    {section.label}
                  </span>
                  <span
                    className={`tw-flex-shrink-0 tw-text-[10px] tw-text-muted-foreground tw-transition-transform ${
                      isExpanded ? "tw-rotate-180" : ""
                    }`}
                    aria-hidden
                  >
                    ▾
                  </span>
                </button>

                {isExpanded ? (
                  <div className="tw-mt-1 tw-space-y-2 tw-pl-1 tw-pr-0.5">
                    {section.description ? (
                      <p className="tw-px-1 tw-text-[10px] tw-leading-snug tw-text-chrome-muted">
                        {section.description}
                      </p>
                    ) : null}
                    {itemCount === 0 ? (
                      <p className="tw-px-1 tw-text-xs tw-leading-relaxed tw-text-chrome-muted tw-opacity-80">
                        All metrics in this category are on the dashboard.
                      </p>
                    ) : (
                      <ul className="tw-space-y-2">
                        {section.metrics.map((metric) =>
                          renderInventoryItem(metric, { draggable: true })
                        )}
                        {section.widgets.map((widget) =>
                          renderInventoryItem(widget, { draggable: true })
                        )}
                      </ul>
                    )}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default KpiInventory;
