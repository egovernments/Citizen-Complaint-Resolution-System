import React from "react";
import { DATA_TABLE_STYLES } from "../config/visualizationStyles";
import SubtleScroll from "./SubtleScroll";

/**
 * Fixed table header + scrollable body. Sticky `thead` is unreliable inside
 * react-grid-layout items (transform ancestors), so the header lives outside
 * the scroll container and column widths are kept in sync via shared colgroup.
 */
const DashboardTableFrame = ({ tableClassName = "", colgroup, header, children }) => {
  const styles = DATA_TABLE_STYLES;
  const tableClass = [styles.table, tableClassName].filter(Boolean).join(" ");

  return (
    <div className={styles.tableFrame}>
      <div className={styles.tableHead}>
        <table className={tableClass}>
          {colgroup}
          <thead>{header}</thead>
        </table>
      </div>
      <SubtleScroll className={styles.scroll}>
        <table className={tableClass}>
          {colgroup}
          <tbody>{children}</tbody>
        </table>
      </SubtleScroll>
    </div>
  );
};

export default DashboardTableFrame;
