import React from "react";
import {
  DEMO_VIZ_DATA,
  isDemoVizWidget,
} from "../config/demoVisualizations";
import ComplaintMap from "./ComplaintMap";
import ChannelDonutChart from "./demo/ChannelDonutChart";
import ComplaintsBySlaWidget from "./demo/ComplaintsBySlaWidget";
import DemoGauge from "./demo/DemoGauge";
import DemoHistogram from "./demo/DemoHistogram";
import DemoLineChart from "./demo/DemoLineChart";
import DemoStackedBarChart from "./demo/DemoStackedBarChart";
import HorizontalBarChart from "./demo/HorizontalBarChart";
import NumberTile from "./demo/NumberTile";
import SlaAtRiskTable from "./demo/SlaAtRiskTable";
import SparklineNumberTile from "./demo/SparklineNumberTile";
import DepartmentBarChart from "./DepartmentBarChart";

const DemoVisualization = ({ widgetId }) => {
  if (!isDemoVizWidget(widgetId)) return null;

  const meta = DEMO_VIZ_DATA[widgetId];

  switch (widgetId) {
    case "demo-viz-number":
      return <NumberTile {...meta} />;
    case "demo-viz-sparkline":
      return <SparklineNumberTile {...meta} />;
    case "demo-viz-bar":
      return <DepartmentBarChart data={meta} />;
    case "demo-viz-leaderboard":
      return <HorizontalBarChart data={meta} />;
    case "demo-viz-line":
      return <DemoLineChart categories={meta.categories} series={meta.series} />;
    case "demo-viz-pie":
      return <ChannelDonutChart data={meta} />;
    case "demo-viz-sla-toggle":
      return <ComplaintsBySlaWidget />;
    case "demo-viz-stacked":
      return (
        <DemoStackedBarChart categories={meta.categories} series={meta.series} />
      );
    case "demo-viz-map":
      return <ComplaintMap pins={meta} />;
    case "demo-viz-sla-risk":
      return <SlaAtRiskTable />;
    case "demo-viz-histogram":
      return <DemoHistogram data={meta} />;
    case "demo-viz-gauge":
      return <DemoGauge {...meta} />;
    default:
      return null;
  }
};

export default DemoVisualization;
