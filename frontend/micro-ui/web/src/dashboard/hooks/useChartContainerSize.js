import { useCallback, useEffect, useState } from "react";

export function useChartContainerSize() {
  const [containerNode, setContainerNode] = useState(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Callback ref so ResizeObserver attaches when the container mounts later
  // (e.g. table/bar toggle in ComplaintsBySlaWidget).
  const containerRef = useCallback((node) => {
    setContainerNode(node);
  }, []);

  useEffect(() => {
    if (!containerNode) {
      setContainerSize({ width: 0, height: 0 });
      return undefined;
    }

    const updateSize = () => {
      const { width, height } = containerNode.getBoundingClientRect();
      setContainerSize({
        width: Math.floor(width),
        height: Math.floor(height),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(containerNode);

    // react-grid-layout resizes the grid item wrapper; observing it keeps charts
    // in sync during horizontal drag-resize inside nested flex chrome (e.g. SLA toggle).
    const gridItem = containerNode.closest(".react-grid-item");
    if (gridItem && gridItem !== containerNode) {
      observer.observe(gridItem);
    }

    return () => observer.disconnect();
  }, [containerNode]);

  return { containerRef, containerSize };
}
