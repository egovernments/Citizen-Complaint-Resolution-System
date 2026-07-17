import React, { useCallback, useRef } from "react";
import { DATA_TABLE_STYLES } from "../config/visualizationStyles";
import SubtleScroll from "./SubtleScroll";

/**
 * Pinned table header + scrollable body. react-grid-layout positions widgets
 * with CSS transform, which breaks position:sticky inside the scroll region —
 * so the header lives outside the overflow container instead.
 */
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
