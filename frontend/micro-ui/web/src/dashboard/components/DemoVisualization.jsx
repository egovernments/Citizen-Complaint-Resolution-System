import React from "react";
import {
  DEMO_VIZ_DATA,
  isDemoVizWidget,
} from "../config/demoVisualizations";
import StackedBarChart from "./StackedBarChart";

const DemoVisualization = ({ widgetId }) => {
  if (!isDemoVizWidget(widgetId)) return null;

  const meta = DEMO_VIZ_DATA[widgetId];

  if (widgetId === "demo-viz-stacked-horizontal") {
    return (
      <StackedBarChart
        categories={meta.categories}
        series={meta.series}
        colors={meta.colors}
        horizontal={Boolean(meta.horizontal)}
        referenceLines={meta.referenceLines}
        scrollKey={widgetId}
      />
    );
  }

  return null;
};

export default DemoVisualization;
