import React, { useMemo, useState } from "react";
import Chart from "react-apexcharts";
import { DASHBOARD_FONT_FAMILY } from "../../config/dashboardConfig";
import ViewToggle from "./ViewToggle";

const SLA_BUCKETS = [
  { id: "within", label: "Within SLA", count: 11, color: "var(--status-resolved)" },
  { id: "breaching", label: "Breaching SLA", count: 15, color: "var(--status-progress)" },
  { id: "breached", label: "Breached SLA", count: 34, color: "var(--status-breach)" },
];

const SlaBucketTable = ({ rows }) => (
  <table className="dashboard-table tw-w-full">
    <thead>
      <tr>
        <th className="dashboard-table-th tw-py-1 tw-font-medium">Bucket</th>
        <th className="dashboard-table-th dashboard-table-th-right tw-py-1 tw-font-medium">
          Count
        </th>
      </tr>
    </thead>
    <tbody>
      {rows.map((row) => (
        <tr key={row.id} className="tw-border-t tw-border-border">
          <td className="dashboard-table-td tw-py-2">
            <span className="tw-inline-flex tw-items-center tw-gap-2">
              <span
                className="tw-h-2 tw-w-2 tw-shrink-0 tw-rounded-full"
                style={{ backgroundColor: row.color }}
                aria-hidden
              />
              <span>{row.label}</span>
            </span>
          </td>
          <td
            className="dashboard-table-td dashboard-table-td-right tw-py-2 tw-font-semibold tw-tabular-nums"
            style={{ color: row.color }}
          >
            {row.count}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

const ComplaintsBySlaWidget = () => {
  const [view, setView] = useState("table");

  const categories = SLA_BUCKETS.map((b) => b.label);
  const values = SLA_BUCKETS.map((b) => b.count);
  const colors = SLA_BUCKETS.map((b) => b.color);

  const chartOptions = useMemo(
    () => ({
      chart: {
        type: "bar",
        toolbar: { show: false },
        fontFamily: DASHBOARD_FONT_FAMILY,
      },
      plotOptions: {
        bar: {
          borderRadius: 2,
          columnWidth: "42%",
          distributed: true,
        },
      },
      colors,
      dataLabels: { enabled: false },
      legend: { show: false },
      xaxis: {
        categories,
        labels: { style: { fontSize: "10px" } },
      },
      yaxis: {
        labels: { style: { fontSize: "10px" } },
      },
      grid: {
        borderColor: "var(--border)",
        strokeDashArray: 3,
      },
      tooltip: { theme: "light" },
    }),
    [categories, colors]
  );

  const series = useMemo(() => [{ name: "Complaints", data: values }], [values]);

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-flex-col">
      <header className="dashboard-drag-handle tw-flex tw-shrink-0 tw-items-center tw-justify-between tw-gap-3 tw-border-b tw-border-border tw-px-4 tw-py-2.5 tw-pr-8">
        <h2 className="dashboard-drag-handle-title">Complaints by SLA</h2>
        <ViewToggle
          value={view}
          onChange={setView}
          options={[
            { id: "table", label: "Table" },
            { id: "bar", label: "Bar" },
          ]}
        />
      </header>
      <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-overflow-hidden tw-p-4">
        {view === "table" ? (
          <SlaBucketTable rows={SLA_BUCKETS} />
        ) : (
          <div className="tw-h-full tw-min-h-0 tw-w-full">
            <Chart options={chartOptions} series={series} type="bar" height="100%" width="100%" />
          </div>
        )}
      </div>
    </div>
  );
};

export default ComplaintsBySlaWidget;
