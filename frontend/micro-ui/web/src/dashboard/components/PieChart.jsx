import React, { useMemo, useState } from "react";
import { resolveDashboardCssColor } from "../config/chartColors";
import {
  getPieChartValueLabelColor,
  normalizePieChartData,
  PIE_CHART_VIEWBOX,
} from "../config/pieChartPresentation";
import { VISUALIZATION_STYLES, VIZ_TYPE, SHARED_CHROME } from "../config/visualizationStyles";

const PieChart = ({ data = [] }) => {
  const [activeIndex, setActiveIndex] = useState(null);

  const slices = useMemo(() => normalizePieChartData(data), [data]);
  const sliceStroke = useMemo(
    () => resolveDashboardCssColor("var(--surface)") || "#ffffff",
    [slices]
  );
  const active = activeIndex != null ? slices[activeIndex] : null;
  const pieStyles = VISUALIZATION_STYLES[VIZ_TYPE.PIE_CHART];
  const valueLabelColor = getPieChartValueLabelColor();

  if (!slices.length) return null;

  return (
    <div className={`${pieStyles.container} tw-flex tw-h-full tw-min-h-0 tw-w-full tw-flex-col`}>
      <div className="tw-relative tw-min-h-0 tw-flex-1">
        <svg
          viewBox={`${PIE_CHART_VIEWBOX.x} ${PIE_CHART_VIEWBOX.y} ${PIE_CHART_VIEWBOX.width} ${PIE_CHART_VIEWBOX.height}`}
          preserveAspectRatio="xMidYMax meet"
          className="tw-h-full tw-w-full"
          role="img"
          aria-label="Donut chart"
        >
          {slices.map((slice) => {
            const fill =
              resolveDashboardCssColor(slice.color) || slice.color || "currentColor";

            return (
            <g key={slice.label}>
              <path
                d={slice.path}
                style={{ fill, stroke: sliceStroke }}
                strokeWidth={2}
                className={pieStyles.slice}
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
                fill={fill}
                fontSize="11"
                fontWeight="500"
                pointerEvents="none"
              >
                {slice.labelLines.map((line, lineIndex) => (
                  <tspan
                    key={`${slice.label}-${lineIndex}`}
                    x={slice.labelX}
                    dy={lineIndex === 0 ? 0 : 12}
                  >
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
            );
          })}
        </svg>
        {active ? (
          <div
            className={`${SHARED_CHROME.chartTooltip} ${SHARED_CHROME.chartTooltipAnchored}`}
            style={{
              left: `${((active.hoverX - PIE_CHART_VIEWBOX.x) / PIE_CHART_VIEWBOX.width) * 100}%`,
              top: `${((active.hoverY - PIE_CHART_VIEWBOX.y) / PIE_CHART_VIEWBOX.height) * 100}%`,
            }}
          >
            <div className={SHARED_CHROME.chartTooltipTitle}>{active.label}</div>
            <div
              className={SHARED_CHROME.chartTooltipRow}
              style={{ color: active.color }}
            >
              Count : {active.count} ({active.pct}%)
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default PieChart;
