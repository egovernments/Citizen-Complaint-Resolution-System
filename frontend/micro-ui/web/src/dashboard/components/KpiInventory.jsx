import React, { useMemo } from "react";
import { KPI_INVENTORY } from "../data/dummyData";

const DRAG_TYPE = "application/x-bomet-kpi";

const KpiInventory = ({ visibleKpiIds, onAddKpi, onDragKpiStart, onDragKpiEnd }) => {
  const availableKpis = useMemo(
    () => KPI_INVENTORY.filter((kpi) => !visibleKpiIds.includes(kpi.id)),
    [visibleKpiIds]
  );

  const handleDragStart = (event, kpiId) => {
    event.dataTransfer.setData("text/plain", kpiId);
    event.dataTransfer.setData(DRAG_TYPE, kpiId);
    event.dataTransfer.effectAllowed = "copy";
    onDragKpiStart?.(kpiId);
  };

  const handleDragEnd = () => {
    onDragKpiEnd?.();
  };

  return (
    <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-border-t tw-border-teal-800">
      <div className="tw-px-3 tw-pt-3">
        <h3 className="tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wider tw-text-teal-200">
          KPI inventory
        </h3>
        <p className="tw-mt-0.5 tw-text-xs tw-text-teal-300">
          Drag onto dashboard · {availableKpis.length} available
        </p>
      </div>

      <div className="tw-min-h-0 tw-flex-1 tw-overflow-y-auto tw-p-3 tw-pt-2">
        {availableKpis.length === 0 ? (
          <p className="tw-text-xs tw-leading-relaxed tw-text-teal-300 tw-opacity-80">
            All KPIs are on the dashboard. Remove one to see it here again.
          </p>
        ) : (
          <ul className="tw-space-y-2">
            {availableKpis.map((kpi) => (
              <li key={kpi.id}>
                <div
                  draggable
                  onDragStart={(event) => handleDragStart(event, kpi.id)}
                  onDragEnd={handleDragEnd}
                  className="kpi-inventory-item tw-cursor-grab tw-rounded-md tw-border tw-border-teal-700 tw-bg-teal-900/40 tw-px-3 tw-py-2 active:tw-cursor-grabbing"
                  title="Drag to dashboard"
                >
                  <div className="tw-flex tw-items-start tw-justify-between tw-gap-2">
                    <div className="tw-min-w-0">
                      <p className="tw-text-xs tw-font-medium tw-leading-snug tw-text-teal-50">
                        {kpi.label}
                      </p>
                      <p className="tw-mt-0.5 tw-text-xs tw-text-teal-300">{kpi.value}</p>
                    </div>
                    <button
                      type="button"
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={() => onAddKpi(kpi.id)}
                      className="tw-flex-shrink-0 tw-rounded tw-bg-teal-700 tw-px-1.5 tw-py-0.5 tw-text-[10px] tw-font-medium tw-text-white hover:tw-bg-teal-600"
                      title="Add to dashboard"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default KpiInventory;
