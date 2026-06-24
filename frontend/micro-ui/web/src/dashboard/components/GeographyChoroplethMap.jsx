import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  getGeographyMapLayerMeta,
  getGeographyMapLegend,
  getGeographyMapLegendFooter,
  getGeographyMapLegendTitle,
} from "../config/geographyMapPresentation";
import { buildMapHoverTooltipHtml, buildComplaintPinTooltipHtml } from "../config/mapHoverPresentation";
import { fetchBoundariesByCodes } from "../services/boundaryService";
import { useMapResize } from "../hooks/useMapResize";
import {
  breachShareToFillStyle,
  buildMapDisplayLayers,
  fitMapToJoinedData,
  getMapCenter,
  getMapCityLabel,
  getMapZoomTier,
  joinWardMapData,
  MAP_COMPLAINT_PIN_MIN_ZOOM,
  MAP_COMPLAINT_PIN_MAX_ZOOM,
  MAP_WARD_UNCLUSTER_ZOOM,
  markerRadiusForZoom,
  wowPctToFillStyle,
} from "../utils/mapGeoUtils";
import { VISUALIZATION_STYLES, VIZ_TYPE } from "../config/visualizationStyles";
import ViewToggle from "./demo/ViewToggle";

const mapStyles = VISUALIZATION_STYLES[VIZ_TYPE.MAP];
const DEFAULT_ZOOM = 11;
const HOVER_TOOLTIP_OPTIONS = {
  sticky: true,
  direction: "top",
  opacity: 1,
  className: "dashboard-map-hover-tooltip",
};

function bindFeatureInteractions({
  layer,
  feature,
  layerMode,
  focusedCode,
  geoLevel,
  map,
  resetView,
  setFocusedCode,
  zoomLevel,
}) {
  const code = feature?.properties?.code;
  const props = feature?.properties ?? {};

  layer.bindTooltip(buildMapHoverTooltipHtml(props, { geoLevel }), HOVER_TOOLTIP_OPTIONS);

  layer.on("mouseover", () => {
    const style = resolveFeatureStyle(feature, layerMode, focusedCode, zoomLevel);
    layer.setStyle({
      ...style,
      weight: 2,
      fillOpacity: Math.min(style.fillOpacity + 0.1, 0.75),
    });
    layer.bringToFront?.();
  });

  layer.on("mouseout", () => {
    layer.setStyle(resolveFeatureStyle(feature, layerMode, focusedCode, zoomLevel));
  });

  layer.on("click", () => {
    const clickProps = feature?.properties ?? {};

    if (clickProps.isCluster && feature.memberFeatures?.length > 1) {
      const group = L.featureGroup();
      L.geoJSON(
        { type: "FeatureCollection", features: feature.memberFeatures },
        {
          onEachFeature: (_member, memberLayer) => {
            group.addLayer(memberLayer);
          },
        }
      );
      const bounds = group.getBounds();
      if (bounds?.isValid()) {
        map.fitBounds(bounds.pad(0.18), {
          animate: true,
          maxZoom: Math.min(map.getZoom() + 2, MAP_COMPLAINT_PIN_MAX_ZOOM),
        });
      }
      return;
    }

    setFocusedCode((prev) => {
      if (prev === code) {
        resetView();
        return null;
      }
      if (layer.getBounds?.().isValid()) {
        map.fitBounds(layer.getBounds().pad(0.2), {
          animate: true,
          maxZoom: MAP_COMPLAINT_PIN_MAX_ZOOM,
        });
      }
      return code;
    });
  });
}

function resolveFeatureStyle(feature, layerMode, focusedCode, zoomLevel = 0) {
  const props = feature?.properties ?? {};
  const isFocused = focusedCode && props.code === focusedCode;
  const base =
    layerMode === "sla_breach"
      ? breachShareToFillStyle(props.breachSharePct)
      : wowPctToFillStyle(props.wowPct);

  const dimChoropleth = zoomLevel >= MAP_COMPLAINT_PIN_MIN_ZOOM;

  return {
    fillColor: base.fillColor,
    color: isFocused ? "#111827" : base.strokeColor,
    weight: isFocused ? 2.5 : 1.5,
    opacity: 1,
    fillOpacity: dimChoropleth
      ? Math.min(base.fillOpacity, 0.28)
      : isFocused
        ? Math.min(base.fillOpacity + 0.08, 0.88)
        : base.fillOpacity,
  };
}

function buildComplaintPinPopup(pin) {
  const root = document.createElement("div");
  root.className = "dashboard-map-pin-popup";
  root.innerHTML = buildComplaintPinTooltipHtml(pin);
  return root;
}

const HomeIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const ResetIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 9v6h6" />
    <path d="M21 15a8 8 0 0 0-14.9-4" />
  </svg>
);

const LocateIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </svg>
);

const FullscreenIcon = ({ active }) => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
    {active ? (
      <path d="M8 3v3H5M16 3v3h3M8 21v-3H5M16 21v-3h3" />
    ) : (
      <path d="M8 3H5v3M16 3h3v3M8 21H5v-3M16 21h3v-3" />
    )}
  </svg>
);

const GeographyChoroplethMap = ({
  wardCounts = [],
  complaintPins = [],
  layerMode = "wow_change",
  onLayerModeChange,
  layerOptions = [],
  cityLabel = getMapCityLabel(),
}) => {
  const shellRef = useRef(null);
  const frameRef = useRef(null);
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const choroplethRef = useRef(null);
  const markersRef = useRef(null);
  const complaintPinsRef = useRef(null);
  const layerByCodeRef = useRef({});
  const defaultViewRef = useRef({ center: getMapCenter(), zoom: DEFAULT_ZOOM });

  const [boundaries, setBoundaries] = useState([]);
  const [boundariesLoading, setBoundariesLoading] = useState(false);
  const [boundariesError, setBoundariesError] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(DEFAULT_ZOOM);
  const [focusedCode, setFocusedCode] = useState(null);
  const [legendCollapsed, setLegendCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const layerMeta = getGeographyMapLayerMeta(layerMode);
  const zoomTier = getMapZoomTier(zoomLevel);
  const geoLevel = focusedCode
    ? "Ward"
    : zoomTier === "complaint"
      ? "Complaint"
      : zoomTier === "city"
        ? "City"
        : zoomTier === "locality"
          ? "Locality"
          : layerMeta?.zoomLevelLabel ?? "Ward";
  const zoomLevelLabel = geoLevel;

  const { resizeToken } = useMapResize(mapRef, frameRef);

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

  const focusedWard = useMemo(
    () => wardCounts.find((row) => row.wardCode === focusedCode),
    [focusedCode, wardCounts]
  );

  const displayLayers = useMemo(
    () => buildMapDisplayLayers(joined, zoomLevel, complaintPins),
    [joined, zoomLevel, complaintPins]
  );

  useEffect(() => {
    setFocusedCode(null);
  }, [layerMode]);

  const legendItems = useMemo(() => getGeographyMapLegend(layerMode), [layerMode]);
  const legendTitle = getGeographyMapLegendTitle(layerMode);
  const legendFooter = getGeographyMapLegendFooter(layerMode);

  const resetView = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    setFocusedCode(null);
    const fitted = fitMapToJoinedData(map, joined, { padding: 0.3, animate: true });
    if (fitted) {
      defaultViewRef.current = fitted;
      setZoomLevel(map.getZoom());
      return;
    }
    const { center, zoom } = defaultViewRef.current;
    map.setView(center, zoom, { animate: true });
  }, [joined]);

  const handleLocate = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!navigator.geolocation) {
      resetView();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        map.flyTo([pos.coords.latitude, pos.coords.longitude], Math.max(map.getZoom(), 13));
      },
      () => resetView(),
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }, [resetView]);

  const toggleFullscreen = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    if (!document.fullscreenElement) {
      shell.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.();
    }
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      mapRef.current?.invalidateSize();
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, {
      scrollWheelZoom: true,
      zoomControl: false,
    }).setView(getMapCenter(), DEFAULT_ZOOM);

    L.control.zoom({ position: "topleft" }).addTo(map);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    if (!map.getPane("complaintPins")) {
      map.createPane("complaintPins");
      map.getPane("complaintPins").style.zIndex = 650;
    }

    choroplethRef.current = L.layerGroup().addTo(map);
    markersRef.current = L.layerGroup().addTo(map);
    complaintPinsRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    defaultViewRef.current = { center: getMapCenter(), zoom: DEFAULT_ZOOM };

    const syncMapView = () => {
      setZoomLevel(map.getZoom());
    };
    map.on("zoom", syncMapView);
    map.on("zoomend", syncMapView);
    map.on("moveend", syncMapView);
    syncMapView();

    setTimeout(() => map.invalidateSize(), 150);
    return () => {
      map.off("zoom", syncMapView);
      map.off("zoomend", syncMapView);
      map.off("moveend", syncMapView);
      map.remove();
      mapRef.current = null;
      choroplethRef.current = null;
      markersRef.current = null;
      complaintPinsRef.current = null;
      layerByCodeRef.current = {};
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const choroplethLayer = choroplethRef.current;
    const markerLayer = markersRef.current;
    const complaintPinLayer = complaintPinsRef.current;
    if (!map || !choroplethLayer || !markerLayer || !complaintPinLayer) return;

    choroplethLayer.clearLayers();
    markerLayer.clearLayers();
    complaintPinLayer.clearLayers();
    layerByCodeRef.current = {};

    const { geoFeatures, pointMarkers, complaintPins: visiblePins } = displayLayers;

    const showComplaintPins = zoomLevel >= MAP_COMPLAINT_PIN_MIN_ZOOM;

    if (geoFeatures?.features?.length) {
      L.geoJSON(geoFeatures, {
        style: (feature) => resolveFeatureStyle(feature, layerMode, focusedCode, zoomLevel),
        onEachFeature: (feature, layer) => {
          layer.feature = feature;
          const code = feature?.properties?.code;
          if (code) layerByCodeRef.current[code] = layer;
          bindFeatureInteractions({
            layer,
            feature,
            layerMode,
            focusedCode,
            geoLevel,
            map,
            resetView,
            setFocusedCode,
            zoomLevel,
          });
        },
      }).addTo(choroplethLayer);
    }

    if (!showComplaintPins) {
      pointMarkers.forEach((marker) => {
        const style =
          layerMode === "sla_breach"
            ? breachShareToFillStyle(marker.breachSharePct)
            : wowPctToFillStyle(marker.wowPct);
        const isFocused = focusedCode && marker.code === focusedCode;
        const markerFeature = { properties: { ...marker, code: marker.code } };
        const circle = L.circleMarker([marker.lat, marker.lng], {
          radius: markerRadiusForZoom(zoomLevel, isFocused),
          color: isFocused ? "#111827" : style.strokeColor,
          weight: isFocused ? 2 : 1,
          fillColor: style.fillColor,
          fillOpacity: style.fillOpacity,
        });
        circle.feature = markerFeature;
        bindFeatureInteractions({
          layer: circle,
          feature: markerFeature,
          layerMode,
          focusedCode,
          geoLevel,
          map,
          resetView,
          setFocusedCode: (updater) => {
            setFocusedCode((prev) => {
              const next = typeof updater === "function" ? updater(prev) : updater;
              if (next === marker.code && prev !== marker.code) {
                map.flyTo([marker.lat, marker.lng], Math.max(map.getZoom(), MAP_WARD_UNCLUSTER_ZOOM));
              } else if (next === null && prev === marker.code) {
                resetView();
              }
              return next;
            });
          },
          zoomLevel,
        });
        circle.addTo(markerLayer);
      });
    }

    visiblePins.forEach((pin) => {
      const circle = L.circleMarker([pin.lat, pin.lng], {
        pane: "complaintPins",
        radius: markerRadiusForZoom(zoomLevel, false, { complaint: true }),
        color: "#0f766e",
        weight: 2,
        fillColor: "#14b8a6",
        fillOpacity: 0.95,
      });
      circle.bindTooltip(buildComplaintPinTooltipHtml(pin), HOVER_TOOLTIP_OPTIONS);
      circle.on("mouseover", () => {
        circle.setStyle({ weight: 3, fillOpacity: 1 });
        circle.bringToFront?.();
      });
      circle.on("mouseout", () => {
        circle.setStyle({ weight: 2, fillOpacity: 0.95 });
      });
      circle.bindPopup(buildComplaintPinPopup(pin));
      circle.addTo(complaintPinLayer);
    });

    if (visiblePins.length) {
      complaintPinLayer.bringToFront?.();
    }
  }, [displayLayers, focusedCode, geoLevel, layerMode, resetView, zoomLevel]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || focusedCode) return undefined;

    const refit = () => {
      map.invalidateSize({ animate: false, pan: false });
      const fitted = fitMapToJoinedData(map, joined, { padding: 0.3 });
      if (fitted) {
        defaultViewRef.current = fitted;
        setZoomLevel(map.getZoom());
      }
    };

    const frameId = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(refit);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [focusedCode, joined, resizeToken]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || focusedCode || !joined.geoFeatures?.features?.length) return undefined;

    map.invalidateSize({ animate: false, pan: false });
    const fitted = fitMapToJoinedData(map, joined, { padding: 0.3 });
    if (!fitted) return undefined;

    defaultViewRef.current = fitted;
    setZoomLevel(map.getZoom());
    return undefined;
  }, [focusedCode, joined]);

  useEffect(() => {
    Object.entries(layerByCodeRef.current).forEach(([, layer]) => {
      const feature = layer.feature;
      if (!feature) return;
      layer.setStyle(resolveFeatureStyle(feature, layerMode, focusedCode, zoomLevel));
    });
  }, [focusedCode, layerMode, zoomLevel]);

  const showEmpty =
    !boundariesLoading && !wardCounts.length && !boundariesError;
  const showLoading = boundariesLoading && !joined.markers.length;

  const toggleOptions = layerOptions.map((layer) => ({
    id: layer.id,
    label: layer.label,
  }));

  return (
    <div
      ref={frameRef}
      className="dashboard-map-frame tw-relative tw-flex tw-min-h-0 tw-flex-1 tw-flex-col"
    >
      <div className="dashboard-map-toolbar-row tw-flex tw-shrink-0 tw-items-center tw-justify-between tw-gap-2 tw-border-b tw-border-border tw-px-2 tw-py-2">
        <div className="tw-flex tw-min-w-0 tw-flex-shrink-0 tw-items-center">
          {onLayerModeChange && toggleOptions.length ? (
            <ViewToggle
              value={layerMode}
              onChange={onLayerModeChange}
              variant="primary"
              options={toggleOptions}
            />
          ) : null}
        </div>

        <div className="dashboard-map-path tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-justify-center tw-gap-2">
          <div className="dashboard-map-breadcrumb tw-flex tw-min-w-0 tw-items-center tw-gap-1.5 tw-text-[11px] tw-font-medium tw-text-foreground">
            <HomeIcon />
            <span className="tw-truncate">{cityLabel}</span>
            {focusedWard ? (
              <>
                <span className="tw-text-muted-foreground">›</span>
                <span className="tw-truncate tw-font-semibold">{focusedWard.label}</span>
              </>
            ) : null}
          </div>
          <div className="dashboard-map-zoom-badge tw-shrink-0 tw-rounded-sm tw-border tw-border-border tw-bg-muted/40 tw-px-2 tw-py-0.5 tw-text-[10px] tw-text-muted-foreground">
            zoom {zoomLevel} · {zoomLevelLabel}
          </div>
        </div>

        <div className="dashboard-map-controls tw-flex tw-shrink-0 tw-items-center">
          <button
            type="button"
            className="dashboard-map-control-btn"
            title="Locate"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleLocate}
          >
            <LocateIcon />
          </button>
          <button
            type="button"
            className="dashboard-map-control-btn dashboard-map-control-btn--text"
            title="Reset view"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={resetView}
          >
            <ResetIcon />
            <span>Reset</span>
          </button>
          <button
            type="button"
            className="dashboard-map-control-btn"
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={toggleFullscreen}
          >
            <FullscreenIcon active={isFullscreen} />
          </button>
        </div>
      </div>

      <div
        ref={shellRef}
        className="dashboard-map-shell tw-relative tw-flex tw-min-h-0 tw-flex-1 tw-flex-col"
      >
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
              className={`${mapStyles.container} dashboard-map-canvas tw-h-full tw-min-h-[220px] tw-w-full tw-flex-1`}
            />

            {focusedWard ? (
              <div className="dashboard-map-filter-chip tw-pointer-events-auto tw-absolute tw-right-3 tw-top-3 tw-z-[1000] tw-flex tw-items-center tw-gap-2 tw-rounded-sm tw-border tw-border-border tw-bg-surface/95 tw-px-2.5 tw-py-1.5 tw-text-[10px] tw-shadow-sm">
                <span className="tw-text-muted-foreground">Filter:</span>
                <span className="tw-font-semibold tw-text-foreground">{focusedWard.label}</span>
                <button
                  type="button"
                  className="dashboard-map-filter-clear"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={resetView}
                >
                  Clear
                </button>
              </div>
            ) : null}

            {boundariesError ? (
              <div className="tw-pointer-events-none tw-absolute tw-right-3 tw-top-12 tw-z-[1000] tw-rounded tw-bg-surface/90 tw-px-2 tw-py-1 tw-text-[10px] tw-text-muted-foreground">
                {boundariesError}
              </div>
            ) : null}
          </>
        )}
      </div>

      {!showEmpty && !showLoading ? (
        <div className="dashboard-map-legend tw-pointer-events-auto tw-absolute tw-bottom-3 tw-left-3 tw-z-[1100]">
          <div className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-border-b tw-border-border tw-px-2.5 tw-py-2">
            <span className="tw-text-[11px] tw-font-semibold tw-text-foreground">
              {legendTitle}
            </span>
            <button
              type="button"
              className="dashboard-map-legend-toggle"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setLegendCollapsed((prev) => !prev)}
              aria-label={legendCollapsed ? "Expand legend" : "Collapse legend"}
            >
              {legendCollapsed ? "+" : "−"}
            </button>
          </div>
          {!legendCollapsed ? (
            <>
              <ul className="dashboard-map-legend-list tw-space-y-1.5 tw-px-2.5 tw-py-2">
                {legendItems.map((item) => (
                  <li key={item.id} className="tw-flex tw-items-center tw-gap-2">
                    <span
                      className="dashboard-map-legend-swatch"
                      style={{
                        backgroundColor: item.fill,
                        borderColor: item.stroke,
                      }}
                    />
                    <span className="tw-text-[10px] tw-leading-tight tw-text-foreground">
                      {item.label}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="tw-border-t tw-border-border tw-px-2.5 tw-py-2 tw-text-[9px] tw-leading-snug tw-text-muted-foreground">
                {legendFooter}
              </p>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default GeographyChoroplethMap;
