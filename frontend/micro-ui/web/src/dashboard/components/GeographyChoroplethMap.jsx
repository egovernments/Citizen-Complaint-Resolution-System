import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { fetchBoundariesByCodes } from "../services/boundaryService";
import {
  countToColor,
  countToRadius,
  getMapCenter,
  joinWardMapData,
} from "../utils/mapGeoUtils";
import { VISUALIZATION_STYLES, VIZ_TYPE } from "../config/visualizationStyles";

const mapStyles = VISUALIZATION_STYLES[VIZ_TYPE.MAP];
const DEFAULT_ZOOM = 11;
const TEAL_SCALE = ["#ccfbf1", "#5eead4", "#14b8a6", "#0d9488", "#115e59"];

function createPopupContent(label, count, layerLabel) {
  const root = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = label || "Ward";
  root.appendChild(title);
  root.appendChild(document.createElement("br"));
  root.appendChild(
    document.createTextNode(`${count} ${layerLabel?.toLowerCase() ?? "complaints"}`)
  );
  return root;
}

const GeographyChoroplethMap = ({ wardCounts = [], layerLabel = "Open" }) => {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const choroplethRef = useRef(null);
  const markersRef = useRef(null);
  const [boundaries, setBoundaries] = useState([]);
  const [boundariesLoading, setBoundariesLoading] = useState(false);
  const [boundariesError, setBoundariesError] = useState(null);

  const wardCodes = useMemo(
    () =>
      [...new Set(wardCounts.map((ward) => String(ward.wardCode ?? "").trim()).filter(Boolean))],
    [wardCounts]
  );

  useEffect(() => {
    let cancelled = false;

    if (!wardCodes.length) {
      setBoundaries([]);
      setBoundariesError(null);
      return undefined;
    }

    setBoundariesLoading(true);
    setBoundariesError(null);

    fetchBoundariesByCodes(wardCodes)
      .then((items) => {
        if (cancelled) return;
        setBoundaries(items);
      })
      .catch(() => {
        if (cancelled) return;
        setBoundaries([]);
        setBoundariesError("Could not load ward boundaries");
      })
      .finally(() => {
        if (!cancelled) setBoundariesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [wardCodes.join("|")]);

  const joined = useMemo(
    () => joinWardMapData(wardCounts, boundaries),
    [wardCounts, boundaries]
  );

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, { scrollWheelZoom: false }).setView(
      getMapCenter(),
      DEFAULT_ZOOM
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    choroplethRef.current = L.layerGroup().addTo(map);
    markersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 150);
    return () => {
      map.remove();
      mapRef.current = null;
      choroplethRef.current = null;
      markersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const choroplethLayer = choroplethRef.current;
    const markerLayer = markersRef.current;
    if (!map || !choroplethLayer || !markerLayer) return;

    choroplethLayer.clearLayers();
    markerLayer.clearLayers();

    const { geoFeatures, markers, maxCount } = joined;

    if (geoFeatures?.features?.length) {
      L.geoJSON(geoFeatures, {
        style: (feature) => {
          const count = Number(feature?.properties?.count) || 0;
          return {
            fillColor: countToColor(count, maxCount),
            weight: 1,
            opacity: 1,
            color: "#ffffff",
            fillOpacity: 0.82,
          };
        },
        onEachFeature: (feature, layer) => {
          const { label, count } = feature.properties ?? {};
          layer.bindPopup(createPopupContent(label, count, layerLabel));
        },
      }).addTo(choroplethLayer);
    }

    markers.forEach((marker) => {
      const radius = countToRadius(marker.count, joined.maxCount);
      L.circleMarker([marker.lat, marker.lng], {
        radius: geoFeatures?.features?.length ? Math.max(6, radius * 0.45) : radius,
        color: countToColor(marker.count, joined.maxCount),
        weight: 1,
        fillColor: countToColor(marker.count, joined.maxCount),
        fillOpacity: 0.75,
      })
        .bindPopup(createPopupContent(marker.label, marker.count, layerLabel))
        .addTo(markerLayer);
    });

    if (markers.length) {
      const bounds = L.latLngBounds(markers.map((marker) => [marker.lat, marker.lng]));
      if (bounds.isValid()) {
        map.fitBounds(bounds.pad(0.12), { animate: false, maxZoom: 13 });
      }
    } else {
      map.setView(getMapCenter(), DEFAULT_ZOOM);
    }

    map.invalidateSize();
  }, [joined, layerLabel]);

  const legendStops = useMemo(() => {
    const maxCount = joined.maxCount || 1;
    return TEAL_SCALE.map((color, index) => {
      const ratio = index / Math.max(TEAL_SCALE.length - 1, 1);
      const value = Math.round(maxCount * ratio);
      return { color, value };
    });
  }, [joined.maxCount]);

  const showEmpty =
    !boundariesLoading && !wardCounts.length && !boundariesError;
  const showLoading = boundariesLoading && !joined.markers.length;

  return (
    <div className={`${mapStyles.body} tw-relative tw-h-full tw-min-h-0`}>
      {showLoading ? (
        <div className="tw-pointer-events-none tw-absolute tw-inset-0 tw-z-[500] tw-flex tw-items-center tw-justify-center tw-bg-surface/70 tw-text-[12px] tw-text-muted-foreground">
          Loading boundaries…
        </div>
      ) : null}
      {showEmpty ? (
        <div className="tw-flex tw-h-full tw-min-h-[220px] tw-items-center tw-justify-center tw-p-4 tw-text-[12px] tw-text-muted-foreground">
          No geographic data
        </div>
      ) : (
        <>
          <div
            ref={elRef}
            className={`${mapStyles.container} tw-h-full tw-min-h-[220px] tw-w-full tw-flex-1 tw-rounded`}
          />
          {joined.maxCount > 0 ? (
            <div className="tw-pointer-events-none tw-absolute tw-bottom-3 tw-left-3 tw-z-[400] tw-rounded tw-border tw-border-border tw-bg-surface/95 tw-p-2 tw-shadow-sm">
              <div className="tw-mb-1 tw-text-[10px] tw-font-semibold tw-uppercase tw-tracking-wide tw-text-muted-foreground">
                {layerLabel}
              </div>
              <div className="tw-flex tw-items-center tw-gap-1">
                {legendStops.map((stop) => (
                  <div key={stop.color} className="tw-flex tw-flex-col tw-items-center tw-gap-0.5">
                    <span
                      className="tw-h-2.5 tw-w-5 tw-rounded-sm"
                      style={{ backgroundColor: stop.color }}
                    />
                    <span className="tw-text-[9px] tw-text-muted-foreground">{stop.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {boundariesError ? (
            <div className="tw-pointer-events-none tw-absolute tw-right-3 tw-top-3 tw-z-[400] tw-rounded tw-bg-surface/90 tw-px-2 tw-py-1 tw-text-[10px] tw-text-muted-foreground">
              {boundariesError}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
};

export default GeographyChoroplethMap;
