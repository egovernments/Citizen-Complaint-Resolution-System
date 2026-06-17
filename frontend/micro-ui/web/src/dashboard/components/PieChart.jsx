import React, { useMemo, useState } from "react";
import {
  getPieChartValueLabelColor,
  normalizePieChartData,
  PIE_CHART_VIEWBOX,
} from "../config/pieChartPresentation";
import { VISUALIZATION_STYLES, VIZ_TYPE } from "../config/visualizationStyles";

const PieChart = ({ data = [] }) => {
  const [activeIndex, setActiveIndex] = useState(null);

  const slices = useMemo(() => normalizePieChartData(data), [data]);
  const active = activeIndex != null ? slices[activeIndex] : null;
  const pieClass = VISUALIZATION_STYLES[VIZ_TYPE.PIE_CHART].container;
  const valueLabelColor = getPieChartValueLabelColor();

  if (!slices.length) return null;

  return (
    <div className={`${pieClass} tw-flex tw-h-full tw-min-h-0 tw-w-full tw-flex-col`}>
      <div className="tw-relative tw-min-h-0 tw-flex-1">
        <svg
          viewBox={`0 0 ${PIE_CHART_VIEWBOX.width} ${PIE_CHART_VIEWBOX.height}`}
          className="tw-h-full tw-w-full"
          role="img"
          aria-label="Donut chart"
        >
          {slices.map((slice) => (
            <g key={slice.label}>
              <path
                d={slice.path}
                fill={slice.color}
                stroke="var(--surface)"
                strokeWidth={2}
                className="dashboard-pie-slice"
                onMouseEnter={() => setActiveIndex(slice.index)}
                onMouseLeave={() => setActiveIndex(null)}
              />
              {slice.showValue ? (
                <text
                  x={slice.valueX}
                  y={slice.valueY}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={valueLabelColor}
                  fontSize="10"
                  fontWeight="600"
                  pointerEvents="none"
                >
                  {slice.pct}%
                </text>
              ) : null}
              <text
                x={slice.labelX}
                y={slice.labelY}
                textAnchor={slice.labelAnchor}
                dominantBaseline="middle"
                fill={slice.color}
                fontSize="11"
                fontWeight="500"
                pointerEvents="none"
              >
                {slice.displayLabel}
              </text>
            </g>
          ))}
        </svg>
        {active ? (
          <div
            className="dashboard-pie-tooltip"
            style={{
              left: `${(active.hoverX / PIE_CHART_VIEWBOX.width) * 100}%`,
              top: `${(active.hoverY / PIE_CHART_VIEWBOX.height) * 100}%`,
            }}
          >
            {active.label} : {active.count} ({active.pct}%)
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default PieChart;
