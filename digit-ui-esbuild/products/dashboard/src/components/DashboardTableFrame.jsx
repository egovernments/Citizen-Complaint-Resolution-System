import React, { useCallback, useRef } from "react";
import { DATA_TABLE_STYLES } from "../config/visualizationStyles";
import { seriesEntryLabel } from "../i18n/textResolver";
import SubtleScroll from "./SubtleScroll";

/**
 * Pinned table header + scrollable body. react-grid-layout positions widgets
 * with CSS transform, which breaks position:sticky inside the scroll region —
 * so the header lives outside the overflow container instead.
 *
 * Accessibility contract for the split: the visual head table keeps the
 * interactive sort controls (so they stay reachable), while the body table —
 * the one assistive tech reads as the data table — restores its column
 * semantics via a visually-hidden <thead> (SrOnlyTableHead below). Screen
 * readers may announce the header-only table first; that redundancy is the
 * accepted cost of keeping cells associated with their column names.
 */

/** Screen-reader-only column header row for the scrollable body table. */
export const SrOnlyTableHead = ({ columns }) => (
  <thead className="dashboard-table-sr-head">
    <tr>
      {columns.map((col) => (
        <th key={col.id} scope="col">
          {seriesEntryLabel(col, col.label)}
        </th>
      ))}
    </tr>
  </thead>
);

const DashboardTableFrame = ({ head, body }) => {
  const headPaneRef = useRef(null);

  const onBodyScroll = useCallback((event) => {
    const headPane = headPaneRef.current;
    if (!headPane) return;
    headPane.scrollLeft = event.currentTarget.scrollLeft;
  }, []);

  return (
    <div className={DATA_TABLE_STYLES.frame}>
      <div ref={headPaneRef} className={DATA_TABLE_STYLES.headPane}>
        {head}
      </div>
      <SubtleScroll className={DATA_TABLE_STYLES.scroll} onScroll={onBodyScroll}>
        {body}
      </SubtleScroll>
    </div>
  );
};

export default DashboardTableFrame;
