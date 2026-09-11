import { useCallback, useEffect, useState } from "react";

/**
 * Keeps a Leaflet map in sync when the dashboard grid item or map shell resizes.
 */
export function useMapResize(mapRef, containerRef) {
  const [resizeToken, setResizeToken] = useState(0);

  const invalidateMap = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.invalidateSize({ animate: false, pan: false });
    setResizeToken((token) => token + 1);
  }, [mapRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(invalidateMap);
    });

    observer.observe(container);
    const gridItem = container.closest(".react-grid-item");
    if (gridItem && gridItem !== container) {
      observer.observe(gridItem);
    }

    return () => observer.disconnect();
  }, [containerRef, invalidateMap]);

  return { resizeToken, invalidateMap };
}
