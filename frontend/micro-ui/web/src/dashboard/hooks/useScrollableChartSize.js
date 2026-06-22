import { useEffect, useMemo, useState } from "react";
import {
  loadChartScrollBaseline,
  resolveDefaultChartAreaPx,
  resolveHorizontalBarMinHeight,
  saveChartScrollBaseline,
} from "../utils/chartScrollBaseline";
import { useChartContainerSize } from "./useChartContainerSize";

/**
 * Keeps chart render size at least the default / peak dimensions.
 * When the widget viewport shrinks, the chart does not scale down — the viewport scrolls.
 * Baseline is persisted per widget so refresh keeps scroll behaviour.
 *
 * @param {'xy' | 'y'} [scrollAxis='xy'] — `y` = vertical scroll only (horizontal bar charts).
 */
export function useScrollableChartSize({
  scrollKey,
  scrollAxis = "xy",
  categoryCount = 0,
  minContentWidth = 0,
} = {}) {
  const verticalOnly = scrollAxis === "y";
  const { containerRef: viewportRef, containerSize: viewport, containerNode } =
    useChartContainerSize();
  const [baseline, setBaseline] = useState(() =>
    scrollKey ? loadChartScrollBaseline(scrollKey) : null
  );

  const contentMinimum = useMemo(() => {
    if (verticalOnly) {
      return {
        width: 0,
        height: resolveHorizontalBarMinHeight(categoryCount),
      };
    }
    return { width: minContentWidth, height: 0 };
  }, [categoryCount, minContentWidth, verticalOnly]);

  useEffect(() => {
    if (viewport.width <= 0 || viewport.height <= 0) return;

    const layoutElement = containerNode?.closest(".layout");
    const defaultArea = scrollKey
      ? resolveDefaultChartAreaPx(scrollKey, layoutElement)
      : null;

    const targetBaseline = {
      width: verticalOnly
        ? viewport.width
        : Math.max(
            defaultArea?.width ?? 0,
            contentMinimum.width,
            scrollKey ? 0 : viewport.width
          ),
      height: Math.max(
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
    verticalOnly,
    viewport.height,
    viewport.width,
  ]);

  const chartSize = useMemo(() => {
    if (verticalOnly) {
      const width = viewport.width;
      const height = Math.max(
        viewport.height,
        baseline?.height ?? 0,
        contentMinimum.height
      );
      return { width, height };
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
    contentMinimum.height,
    contentMinimum.width,
    verticalOnly,
    viewport.height,
    viewport.width,
  ]);

  const isScrollable = verticalOnly
    ? chartSize.height > viewport.height + 1
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
