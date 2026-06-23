import React, { useMemo, useState } from "react";
import {
  buildWidgetHeaderClassName,
  getWidgetBodyClassName,
  getWidgetScrollClassName,
  SHARED_CHROME,
  VIZ_TYPE,
} from "../../config/visualizationStyles";
import DashboardTable from "../DashboardTable";
import DepartmentBarChart from "../DepartmentBarChart";
import ViewToggle from "./ViewToggle";

const SLA_BUCKETS = [
  { id: "within", label: "Within SLA", count: 11 },
  { id: "breaching", label: "Breaching SLA", count: 15 },
  { id: "breached", label: "Breached SLA", count: 34 },
];

const SLA_TABLE_COLUMNS = [
  { id: "label", label: "Bucket", align: "left", type: "text" },
  { id: "count", label: "Count", align: "right", type: "integer" },
];

const ComplaintsBySlaWidget = () => {
  const [view, setView] = useState("table");
  const isTable = view === "table";
  const vizType = isTable ? VIZ_TYPE.DATA_TABLE : VIZ_TYPE.BAR_CHART;

  const tableRows = useMemo(
    () => SLA_BUCKETS.map(({ id, label, count }) => ({ id, label, count })),
    []
  );

  const barChartData = useMemo(
    () => SLA_BUCKETS.map(({ label, count }) => ({ label, count })),
    []
  );

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-flex-col">
      <header
        className={`${buildWidgetHeaderClassName(vizType)} tw-flex tw-shrink-0 tw-items-center tw-justify-between tw-gap-3 tw-pr-8`}
      >
        <div className="tw-min-w-0 tw-flex-1">
          <h2 className={SHARED_CHROME.dragHandleTitle}>Complaints by SLA</h2>
          <p className={SHARED_CHROME.dragHandleSubtitle}>Table and bar views</p>
        </div>
        <ViewToggle
          value={view}
          onChange={setView}
          options={[
            { id: "table", label: "Table" },
            { id: "bar", label: "Bar" },
          ]}
        />
      </header>
      <div className={getWidgetBodyClassName(vizType, { isTable })}>
        {isTable ? (
          <div className={getWidgetScrollClassName()}>
            <DashboardTable columns={SLA_TABLE_COLUMNS} rows={tableRows} />
          </div>
        ) : (
          <DepartmentBarChart data={barChartData} scrollKey="demo-viz-sla-toggle" />
        )}
      </div>
    </div>
  );
};

export default ComplaintsBySlaWidget;
