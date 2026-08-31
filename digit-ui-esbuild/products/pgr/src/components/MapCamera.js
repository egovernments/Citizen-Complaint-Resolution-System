import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";

/**
 * Applies a camera frame (centre + zoom) from OUTSIDE the map.
 *
 * <MapContainer>'s `center`/`zoom` props are MOUNT-ONLY in react-leaflet v3:
 * once the map exists they are never read again. So a coordinate that arrives
 * or changes after mount — a restored draft, an async complaint fetch, a
 * tenant's MapConfig resolving from MDMS — moves the MARKER but leaves the
 * CAMERA on the mount frame. That is the "pin is right, view is wrong" bug.
 *
 * It has to be a CHILD to work: MapContainer renders its children one commit
 * after the parent's own effects run, so a parent-held mapRef is still null
 * during the parent's mount effects and a setView there silently no-ops.
 * useMap() here always has the live instance.
 *
 * The applied-target guard is what makes this safe to drive from a value
 * computed during render: without it, a fresh object identity on every render
 * re-fires the effect and yanks the camera back to the pin each time the user
 * pans away.
 */
/**
 * Keeps the map's zoom bounds in step with MapConfig.
 *
 * MapContainer's minZoom/maxZoom are latched at construction like center and
 * zoom, so a tenant's configured bounds arriving later from MDMS never reach
 * Leaflet. setMinZoom/setMaxZoom also re-clamp the current zoom, so a map
 * already sitting outside the new bounds corrects itself.
 */
export const MapZoomBounds = ({ minZoom, maxZoom }) => {
  const map = useMap();

  useEffect(() => {
    if (Number.isFinite(minZoom) && minZoom !== map.getMinZoom()) map.setMinZoom(minZoom);
    if (Number.isFinite(maxZoom) && maxZoom !== map.getMaxZoom()) map.setMaxZoom(maxZoom);
  }, [map, minZoom, maxZoom]);

  return null;
};

const MapCamera = ({ target }) => {
  const map = useMap();
  const appliedRef = useRef(null);

  useEffect(() => {
    if (!target) return;
    const { lat, lng, zoom, animate } = target;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const key = `${lat},${lng},${zoom}`;
    if (appliedRef.current === key) return;
    appliedRef.current = key;

    if (animate) {
      map.flyTo([lat, lng], zoom, { duration: 0.8 });
    } else {
      map.setView([lat, lng], zoom);
    }
  }, [map, target]);

  return null;
};

export default MapCamera;
