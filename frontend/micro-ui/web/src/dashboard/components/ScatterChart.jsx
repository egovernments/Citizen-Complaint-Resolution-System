import React, { useMemo } from "react";
import Chart from "react-apexcharts";
import { DASHBOARD_FONT_FAMILY } from "../config/dashboardConfig";
import {
  buildScatterChartOptions,
  buildScatterChartSeries,
  resolveScatterChartColor,
} from "../config/scatterChartPresentation";
import { VISUALIZATION_STYLES, VIZ_TYPE } from "../config/visualizationStyles";
import { useChartContainerSize } from "../hooks/useChartContainerSize";

const ScatterChart = ({
  points = [],
  xAxisLabel = "Caseload (open)",
  yAxisLabel = "Breach rate (%)",
}) => {
  const { containerRef, containerSize } = useChartContainerSize();
  const { width: containerWidth, height: containerHeight } = containerSize;

  const series = useMemo(() => buildScatterChartSeries(points), [points]);

  const options = useMemo(() => {
    const base = buildScatterChartOptions({ points, xAxisLabel, yAxisLabel });
    return {
      ...base,
      chart: {
        ...base.chart,
        fontFamily: DASHBOARD_FONT_FAMILY,
      },
      colors: [resolveScatterChartColor(0)],
    };
  }, [points, xAxisLabel, yAxisLabel]);

  const lineStyles = VISUALIZATION_STYLES[VIZ_TYPE.LINE_CHART];
  const hasData = points.length > 0;

  if (!hasData) return null;

  return (
    <div
      ref={containerRef}
      className={`${lineStyles.container} tw-h-full tw-min-h-0 tw-w-full tw-flex-1 tw-overflow-visible`}
    >
      {containerHeight > 0 && containerWidth > 0 ? (
        <Chart
          key={`${containerHeight}-${containerWidth}-${points.length}`}
          options={options}
          series={series}
          type="scatter"
          height={containerHeight}
          width="100%"
        />
      ) : null}
    </div>
  );
};

export default ScatterChart;
