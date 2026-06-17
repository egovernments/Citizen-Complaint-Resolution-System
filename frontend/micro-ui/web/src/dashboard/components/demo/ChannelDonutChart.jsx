import React, { useMemo, useState } from "react";

import { getChartColor } from "../../config/chartColors";

const CX = 160;
const CY = 118;
const OUTER_R = 72;
const INNER_R = 42;
const LABEL_R = 94;

function toRad(deg) {
  return ((deg - 90) * Math.PI) / 180;
}

function polar(cx, cy, r, deg) {
  const rad = toRad(deg);
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx, cy, rOuter, rInner, startDeg, endDeg) {
  const outerStart = polar(cx, cy, rOuter, startDeg);
  const outerEnd = polar(cx, cy, rOuter, endDeg);
  const innerEnd = polar(cx, cy, rInner, endDeg);
  const innerStart = polar(cx, cy, rInner, startDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;

  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

function labelAnchor(midDeg) {
  const rad = toRad(midDeg);
  const cos = Math.cos(rad);
  if (cos > 0.25) return "start";
  if (cos < -0.25) return "end";
  return "middle";
}

function labelOffset(midDeg) {
  const rad = toRad(midDeg);
  const cos = Math.cos(rad);
  if (cos > 0.25) return 6;
  if (cos < -0.25) return -6;
  return 0;
}

const ChannelDonutChart = ({ data = [] }) => {
  const [activeIndex, setActiveIndex] = useState(null);

  const slices = useMemo(() => {
    const total = data.reduce((sum, item) => sum + item.count, 0) || 1;
    let cursor = 0;
    return data.map((item, index) => {
      const color = item.color || getChartColor(index);
      const sweep = (item.count / total) * 360;
      const start = cursor;
      const end = cursor + sweep;
      const mid = start + sweep / 2;
      cursor = end;
      const pct = Math.round((item.count / total) * 100);
      const label = polar(CX, CY, LABEL_R, mid);
      const anchor = labelAnchor(mid);
      const dx = labelOffset(mid);
      const hoverPoint = polar(CX, CY, OUTER_R + 8, mid);
      return {
        ...item,
        color,
        index,
        mid,
        pct,
        path: arcPath(CX, CY, OUTER_R, INNER_R, start, end),
        labelX: label.x + dx,
        labelY: label.y,
        labelAnchor: anchor,
        hoverX: hoverPoint.x,
        hoverY: hoverPoint.y,
      };
    });
  }, [data]);

  const active = activeIndex != null ? slices[activeIndex] : null;

  return (
    <div className="channel-donut-chart tw-flex tw-h-full tw-min-h-0 tw-w-full tw-flex-col">
      <div className="tw-relative tw-min-h-0 tw-flex-1">
        <svg
          viewBox="0 0 320 230"
          className="tw-h-full tw-w-full"
          role="img"
          aria-label="Complaints by channel donut chart"
        >
          {slices.map((slice) => (
            <g key={slice.label}>
              <path
                d={slice.path}
                fill={slice.color}
                stroke="var(--surface)"
                strokeWidth={2}
                className="channel-donut-slice"
                onMouseEnter={() => setActiveIndex(slice.index)}
                onMouseLeave={() => setActiveIndex(null)}
              />
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
                {slice.pct}%
              </text>
            </g>
          ))}
        </svg>
        {active ? (
          <div
            className="channel-donut-tooltip"
            style={{
              left: `${(active.hoverX / 320) * 100}%`,
              top: `${(active.hoverY / 230) * 100}%`,
            }}
          >
            {active.label} : {active.count} ({active.pct}%)
          </div>
        ) : null}
      </div>
      <div className="channel-donut-legend tw-flex tw-flex-wrap tw-items-center tw-justify-center tw-gap-x-4 tw-gap-y-1 tw-px-2 tw-pb-1">
        {slices.map((slice) => (
          <span
            key={slice.label}
            className="tw-inline-flex tw-items-center tw-gap-1.5 tw-text-[11px] tw-text-foreground"
          >
            <span
              className="tw-h-2 tw-w-2 tw-shrink-0 tw-rounded-full"
              style={{ backgroundColor: slice.color }}
              aria-hidden
            />
            {slice.label}
          </span>
        ))}
      </div>
    </div>
  );
};

export default ChannelDonutChart;
