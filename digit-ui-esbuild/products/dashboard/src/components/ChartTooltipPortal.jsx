import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { resolveNearCursorTooltipPosition } from "../config/chartTooltipPresentation";
import { SHARED_CHROME } from "../config/visualizationStyles";

const TOOLTIP_OFFSET = 10;

const ChartTooltipPortal = ({ tooltip, children }) => {
  const ref = useRef(null);
  const [position, setPosition] = useState(() =>
    tooltip
      ? resolveNearCursorTooltipPosition(tooltip.x, tooltip.y, {}, TOOLTIP_OFFSET)
      : { left: 0, top: 0 }
  );

  useLayoutEffect(() => {
    if (!tooltip || !ref.current) return;

    const { width, height } = ref.current.getBoundingClientRect();
    setPosition(
      resolveNearCursorTooltipPosition(
        tooltip.x,
        tooltip.y,
        { width, height },
        TOOLTIP_OFFSET
      )
    );
  }, [tooltip]);

  if (!tooltip) return null;

  return createPortal(
    <div
      ref={ref}
      className={`${SHARED_CHROME.dashboardRoot} ${SHARED_CHROME.chartTooltip} ${SHARED_CHROME.chartTooltipFixed}`}
      style={{ left: `${position.left}px`, top: `${position.top}px` }}
      role="tooltip"
    >
      {children}
    </div>,
    document.body
  );
};

export default ChartTooltipPortal;
