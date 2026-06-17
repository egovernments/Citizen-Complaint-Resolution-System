import React from "react";
import {
  DEMO_VIZ_DATA,
  isDemoVizWidget,
} from "../config/demoVisualizations";
import ComplaintMap from "./ComplaintMap";
import PieChart from "./PieChart";
import ComplaintsBySlaWidget from "./demo/ComplaintsBySlaWidget";
import DemoGauge from "./demo/DemoGauge";
import DepartmentBarChart from "./DepartmentBarChart";
import HorizontalBarChart from "./demo/HorizontalBarChart";
import LineChart from "./LineChart";
import SlaAtRiskTable from "./demo/SlaAtRiskTable";
import StackedBarChart from "./StackedBarChart";

const DemoVisualization = ({ widgetId, lastUpdatedLabel }) => {
  if (!isDemoVizWidget(widgetId)) return null;

  const meta = DEMO_VIZ_DATA[widgetId];

  switch (widgetId) {
    case "demo-viz-stacked":
    case "demo-viz-stacked-horizontal":
      return (
        <StackedBarChart
          categories={meta.categories}
          series={meta.series}
          colors={meta.colors}
          horizontal={Boolean(meta.horizontal)}
          referenceLines={meta.referenceLines}
        />
      );
    case "demo-viz-leaderboard":
      return (
        <HorizontalBarChart
          data={meta.data ?? meta}
          breakEven={meta.breakEven ?? 1}
        />
      );
    case "demo-viz-line":
      return (
        <LineChart
          headerTitle={meta.title}
          periods={meta.periods}
          defaultPeriod={meta.defaultPeriod}
          yAxis={meta.yAxis}
        />
      );
    case "demo-viz-pie":
      return <PieChart data={meta} />;
    case "demo-viz-sla-toggle":
      return <ComplaintsBySlaWidget />;
    case "demo-viz-map":
      return <ComplaintMap pins={meta} />;
    case "demo-viz-sla-risk":
      return <SlaAtRiskTable />;
    case "demo-viz-histogram":
      return <DepartmentBarChart data={meta} compact />;
    case "demo-viz-gauge":
      return <DemoGauge {...meta} />;
    default:
      return null;
  }
};

export default DemoVisualization;
