import React from "react";
import { SHARED_CHROME } from "../config/visualizationStyles";

const ChartScrollViewport = ({
  viewportRef,
  chartSize,
  isScrollable,
  chartClassName = "",
  scrollAxis = "xy",
  children,
}) => {
  const { width, height } = chartSize;
  const verticalOnly = scrollAxis === "y";

  return (
    <div
      ref={viewportRef}
      className={`${SHARED_CHROME.chartScrollViewport}${
        isScrollable ? ` ${SHARED_CHROME.chartScrollViewportActive}` : ""
      }${verticalOnly ? ` ${SHARED_CHROME.chartScrollViewportVertical}` : ""}`}
    >
      <div
        className={`${SHARED_CHROME.chartScrollCanvas}${
          chartClassName ? ` ${chartClassName}` : ""
        }`.trim()}
        style={
          verticalOnly
            ? { width: "100%", height, minHeight: height, maxWidth: "100%" }
            : { width, height, minWidth: width, minHeight: height }
        }
      >
        {children}
      </div>
    </div>
  );
};

export default ChartScrollViewport;
