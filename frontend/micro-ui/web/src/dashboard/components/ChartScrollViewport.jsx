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
  const horizontalOnly = scrollAxis === "x";

  const canvasStyle = verticalOnly
    ? { width: "100%", height, minHeight: height, maxWidth: "100%" }
    : horizontalOnly
      ? { width, minWidth: width, height: "100%", minHeight: "100%" }
      : { width, height, minWidth: width, minHeight: height };

  return (
    <div
      ref={viewportRef}
      className={`${SHARED_CHROME.chartScrollViewport}${
        isScrollable ? ` ${SHARED_CHROME.chartScrollViewportActive}` : ""
      }${verticalOnly ? ` ${SHARED_CHROME.chartScrollViewportVertical}` : ""}${
        horizontalOnly ? ` ${SHARED_CHROME.chartScrollViewportHorizontal}` : ""
      }`}
    >
      <div
        className={`${SHARED_CHROME.chartScrollCanvas}${
          chartClassName ? ` ${chartClassName}` : ""
        }`.trim()}
        style={canvasStyle}
      >
        {children}
      </div>
    </div>
  );
};

export default ChartScrollViewport;
