import React, { useMemo, useState } from "react";
import { getChartColor } from "../../config/chartColors";
import {
  DATA_TABLE_STYLES,
  getDataTableTdClass,
  getDataTableThClass,
  VISUALIZATION_STYLES,
  VIZ_TYPE,
} from "../../config/visualizationStyles";
import DataTableChrome from "../DataTableChrome";
import DepartmentBarChart from "../DepartmentBarChart";
import ViewToggle from "./ViewToggle";

const SLA_BUCKETS = [
  { id: "within", label: "Within SLA", count: 11, color: getChartColor(0) },
  { id: "breaching", label: "Breaching SLA", count: 15, color: getChartColor(1) },
  { id: "breached", label: "Breached SLA", count: 34, color: getChartColor(2) },
];

const SlaBucketTable = ({ rows }) => {
  const styles = DATA_TABLE_STYLES;

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th className={getDataTableThClass()}>Bucket</th>
          <th className={getDataTableThClass("right")}>Count</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td className={getDataTableTdClass()}>
              <span className={styles.legendLabel}>
                <span
                  className={styles.legendSwatch}
                  style={{ backgroundColor: row.color }}
                  aria-hidden
                />
                <span>{row.label}</span>
              </span>
            </td>
            <td
              className={`${getDataTableTdClass("right")} ${styles.valueEmphasis}`}
              style={{ color: row.color }}
            >
              {row.count}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const ComplaintsBySlaWidget = () => {
  const [view, setView] = useState("table");
  const tableStyles = DATA_TABLE_STYLES;
  const barBodyClass = VISUALIZATION_STYLES[VIZ_TYPE.BAR_CHART].body;
  const slaToggleBodyBar = VISUALIZATION_STYLES[VIZ_TYPE.SLA_TOGGLE].bodyBar;

  const barChartData = useMemo(
    () => SLA_BUCKETS.map(({ label, count }) => ({ label, count })),
    []
  );

  const bodyClassName =
    view === "table"
      ? tableStyles.body
      : `${barBodyClass} ${slaToggleBodyBar} tw-min-w-0 tw-w-full tw-flex-1`;

  return (
    <DataTableChrome
      title="Complaints by SLA"
      headerActions={
        <ViewToggle
          value={view}
          onChange={setView}
          options={[
            { id: "table", label: "Table" },
            { id: "bar", label: "Bar" },
          ]}
        />
      }
      bodyClassName={bodyClassName}
      scrollable={view === "table"}
    >
      {view === "table" ? (
        <SlaBucketTable rows={SLA_BUCKETS} />
      ) : (
        <DepartmentBarChart data={barChartData} compact />
      )}
    </DataTableChrome>
  );
};

export default ComplaintsBySlaWidget;
