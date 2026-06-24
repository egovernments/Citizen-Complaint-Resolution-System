import { useEffect, useMemo, useState } from "react";
import {
  loadChartScrollBaseline,
  resolveDefaultChartAreaPx,
  resolveHorizontalBarChartHeight,
  resolveMinChartAreaHeightPx,
  resolveMinChartAreaPx,
  resolveVerticalBarChartWidth,
  saveChartScrollBaseline,
} from "../utils/chartScrollBaseline";
import { useChartContainerSize } from "./useChartContainerSize";

/**
 * Keeps chart render size at least the default / peak dimensions.
 * When the widget viewport shrinks, the chart does not scale down — the viewport scrolls.
 * Baseline is persisted per widget so refresh keeps scroll behaviour.
 *
 * @param {'xy' | 'x' | 'y'} [scrollAxis='xy'] — `x` = horizontal only (vertical bar charts); `y` = vertical only (horizontal bar charts).
 */
export function useScrollableChartSize({
  scrollKey,
  scrollAxis = "xy",
  categoryCount = 0,
  minContentWidth = 0,
} = {}) {
  const verticalOnly = scrollAxis === "y";
  const horizontalOnly = scrollAxis === "x";
  const { containerRef: viewportRef, containerSize: viewport, containerNode } =
    useChartContainerSize();
  const [baseline, setBaseline] = useState(() =>
    scrollKey ? loadChartScrollBaseline(scrollKey) : null
  );

  const minChartWidth = useMemo(() => {
    if (!scrollKey || !containerNode) return 0;
    const layoutElement = containerNode.closest(".layout");
    return resolveMinChartAreaPx(scrollKey, layoutElement) ?? 0;
  }, [scrollKey, containerNode]);

  const minChartHeight = useMemo(() => {
    if (!scrollKey) return 0;
    return resolveMinChartAreaHeightPx(scrollKey) ?? 0;
  }, [scrollKey]);

  const contentMinimum = useMemo(() => {
    if (verticalOnly || horizontalOnly) {
      return { width: 0, height: 0 };
    }
    return { width: minContentWidth, height: 0 };
  }, [horizontalOnly, minContentWidth, verticalOnly]);

  useEffect(() => {
    if (viewport.width <= 0 || viewport.height <= 0) return;

    const layoutElement = containerNode?.closest(".layout");
    const defaultArea = scrollKey
      ? resolveDefaultChartAreaPx(scrollKey, layoutElement)
      : null;

    const targetBaseline = {
      width: verticalOnly || horizontalOnly
        ? viewport.width
        : Math.max(
            defaultArea?.width ?? 0,
            contentMinimum.width,
            scrollKey ? 0 : viewport.width
          ),
      height: horizontalOnly || verticalOnly
        ? viewport.height
        : Math.max(
            defaultArea?.height ?? 0,
            contentMinimum.height,
            scrollKey ? 0 : viewport.height
          ),
    };

    setBaseline((prev) => {
      const next = scrollKey
        ? targetBaseline
        : {
            width: Math.max(prev?.width ?? 0, targetBaseline.width),
            height: Math.max(prev?.height ?? 0, targetBaseline.height),
          };

      if (
        scrollKey &&
        (next.width !== prev?.width || next.height !== prev?.height)
      ) {
        saveChartScrollBaseline(scrollKey, next);
      }

      return next;
    });
  }, [
    containerNode,
    contentMinimum.height,
    contentMinimum.width,
    scrollKey,
    horizontalOnly,
    verticalOnly,
    viewport.height,
    viewport.width,
  ]);

  const chartSize = useMemo(() => {
    if (verticalOnly) {
      const height = resolveHorizontalBarChartHeight(
        categoryCount,
        viewport.height,
        minChartHeight
      );
      return { width: viewport.width, height };
    }

    if (horizontalOnly) {
      const width = resolveVerticalBarChartWidth(
        categoryCount,
        viewport.width,
        minChartWidth
      );
      return { width, height: viewport.height };
    }

    const width = Math.max(
      viewport.width,
      baseline?.width ?? 0,
      contentMinimum.width
    );
    const height = Math.max(
      viewport.height,
      baseline?.height ?? 0,
      contentMinimum.height
    );

    return { width, height };
  }, [
    baseline?.height,
    baseline?.width,
    categoryCount,
    contentMinimum.height,
    contentMinimum.width,
    horizontalOnly,
    minChartHeight,
    minChartWidth,
    verticalOnly,
    viewport.height,
    viewport.width,
  ]);

  const isScrollable = verticalOnly
    ? chartSize.height > viewport.height + 1
    : horizontalOnly
      ? chartSize.width > viewport.width + 1
      : chartSize.width > viewport.width + 1 ||
        chartSize.height > viewport.height + 1;

  const isReady = chartSize.width > 0 && chartSize.height > 0;

  return {
    viewportRef,
    viewport,
    chartSize,
    isScrollable,
    isReady,
    scrollAxis,
  };
}
