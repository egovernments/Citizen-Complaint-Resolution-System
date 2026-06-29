import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  getGeographyMapLegend,
  getGeographyMapLegendFooter,
  getGeographyMapLegendTitle,
  isGeographyMapVolumeLayerId,
} from "../config/geographyMapPresentation";
import { buildMapHoverTooltipHtml, buildComplaintPinTooltipHtml } from "../config/mapHoverPresentation";
import { fetchBoundariesByCodes, fetchBoundaryRelationshipsByCodes } from "../services/boundaryService";
import { useMapResize } from "../hooks/useMapResize";
import {
  breachShareToFillStyle,
  buildMapDisplayLayers,
  fitMapToJoinedData,
  getDrillTierLabel,
  getMapCenter,
  getMapCityLabel,
  isWardDrillLevel,
  joinWardMapData,
  MAP_COMPLAINT_PIN_MAX_ZOOM,
  MAP_DRILL_MAX_LEVEL,
  MAP_WARD_MIN_ZOOM,
  markerRadiusForZoom,
  resolveComplaintPinPositions,
  countToFillStyle,
  wowPctToFillStyle,
} from "../utils/mapGeoUtils";
import { VISUALIZATION_STYLES, VIZ_TYPE } from "../config/visualizationStyles";
import ViewToggle from "./demo/ViewToggle";

const mapStyles = VISUALIZATION_STYLES[VIZ_TYPE.MAP];

const HOVER_TOOLTIP_OPTIONS = {
  sticky: true,
  direction: "top",
  opacity: 1,
  className: "dashboard-map-hover-tooltip",
};


function getMemberFeatures(feature) {
  if (feature?.memberFeatures?.length) return feature.memberFeatures;
  return feature ? [feature] : [];
}

function resolveFeatureStyle(feature, layerMode, focusedCode, maxCount = 0) {
  const props = feature?.properties ?? {};
  const isFocused = focusedCode && props.code === focusedCode;
  const base = layerMode === "sla_breach"
    ? breachShareToFillStyle(props.breachSharePct)
    : layerMode === "wow_change"
      ? wowPctToFillStyle(props.wowPct)
      : isGeographyMapVolumeLayerId(layerMode)
        ? countToFillStyle(Number(props.count) || 0, maxCount)
        : wowPctToFillStyle(props.wowPct);

  return {
    fillColor: base.fillColor,
    color: isFocused ? "#111827" : base.strokeColor,
    weight: isFocused ? 2.5 : 1.5,
    opacity: 1,
    fillOpacity: isFocused
      ? Math.min(base.fillOpacity + 0.08, 0.88)
      : base.fillOpacity,
  };
}

function buildComplaintPinPopupContent(pin) {
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
  complaintPinsError = null,
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
  const complaintPinsRef = useRef(null);
  const pinRendererRef = useRef(null);
  const layerByCodeRef = useRef({});
  const defaultViewRef = useRef({ center: getMapCenter(), zoom: 11 });

  // Keep a ref that always holds the latest zoom so layer callbacks don't
  // need zoomLevel as a dep (preventing full redraws on every scroll step).
  const zoomLevelRef = useRef(11);

  const [boundaries, setBoundaries] = useState([]);
  const [hierarchyIndex, setHierarchyIndex] = useState({});
  const [boundariesLoading, setBoundariesLoading] = useState(false);
  const [boundariesError, setBoundariesError] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(11);
  const [drillLevel, setDrillLevel] = useState(0);
  const [drillTrail, setDrillTrail] = useState([]);
  const [focusedCode, setFocusedCode] = useState(null);
  const [legendCollapsed, setLegendCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const geoLevel = focusedCode ? "Ward" : getDrillTierLabel(drillLevel);

  const activeScopeCodes = useMemo(() => {
    if (!drillTrail.length) return null;
    const last = drillTrail[drillTrail.length - 1];
    return last?.memberCodes?.length ? last.memberCodes : null;
  }, [drillTrail]);

  const { resizeToken } = useMapResize(mapRef, frameRef);

  // ── boundary fetch ────────────────────────────────────────────────────────
  const wardCodes = useMemo(
    () => [...new Set(wardCounts.map((w) => String(w.wardCode ?? "").trim()).filter(Boolean))],
    [wardCounts]
  );

  useEffect(() => {
    let cancelled = false;
    if (!wardCodes.length) {
      setBoundaries([]);
      setHierarchyIndex({});
      setBoundariesError(null);
      return undefined;
    }
    setBoundariesLoading(true);
    setBoundariesError(null);
    Promise.all([
      fetchBoundariesByCodes(wardCodes),
      fetchBoundaryRelationshipsByCodes(wardCodes),
    ])
      .then(([items, rels]) => {
        if (cancelled) return;
        setBoundaries(items);
        setHierarchyIndex(rels);
      })
      .catch(() => {
        if (cancelled) return;
        setBoundaries([]);
        setHierarchyIndex({});
        setBoundariesError("Could not load ward boundaries");
      })
      .finally(() => { if (!cancelled) setBoundariesLoading(false); });
    return () => { cancelled = true; };
  }, [wardCodes.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── data joins ───────────────────────────────────────────────────────────
  const joined = useMemo(
    () => joinWardMapData(wardCounts, boundaries),
    [wardCounts, boundaries]
  );

  const focusedWard = useMemo(
    () => wardCounts.find((r) => r.wardCode === focusedCode),
    [focusedCode, wardCounts]
  );

  // Choropleth layers change only when drill level or underlying data changes.
  const displayLayers = useMemo(
    () => buildMapDisplayLayers(joined, drillLevel, complaintPins, hierarchyIndex, activeScopeCodes),
    [joined, drillLevel, complaintPins, hierarchyIndex, activeScopeCodes]
  );

  // Resolved pin positions (all pins) — recomputed only when source data changes.
  const allResolvedPins = useMemo(
    () => (complaintPins.length ? resolveComplaintPinPositions(complaintPins, joined) : []),
    [complaintPins, joined]
  );

  const legendItems = useMemo(() => getGeographyMapLegend(layerMode), [layerMode]);
  const legendTitle = getGeographyMapLegendTitle(layerMode);
  const legendFooter = getGeographyMapLegendFooter(layerMode);

  // Reset drill state when layer mode changes.
  useEffect(() => {
    setFocusedCode(null);
    setDrillLevel(0);
    setDrillTrail([]);
  }, [layerMode]);

  // ── actions ──────────────────────────────────────────────────────────────
  const resetView = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    setFocusedCode(null);
    setDrillLevel(0);
    setDrillTrail([]);
    const fitted = fitMapToJoinedData(map, joined, { padding: 0.12, animate: true });
    if (fitted) { defaultViewRef.current = fitted; }
    else { map.setView(defaultViewRef.current.center, defaultViewRef.current.zoom, { animate: true }); }
  }, [joined]);

  // Drill into a clicked polygon — zoom to fit that region and advance the detail level.
  // Zoom is purely geographic: we fit the clicked polygon's bounds, so a smaller
  // region naturally zooms in further. No hardcoded zoom numbers.
  const handleDrillInto = useCallback(({ nextLevel, memberCodes, clickedFeature, label }) => {
    const map = mapRef.current;
    if (!map) return;

    setDrillLevel(nextLevel);
    setDrillTrail((prev) => [...prev, { label, memberCodes }]);
    setFocusedCode(null);

    try {
      const bounds = L.geoJSON(clickedFeature).getBounds();
      if (bounds?.isValid()) {
        map.flyToBounds(bounds.pad(0.12), { maxZoom: MAP_COMPLAINT_PIN_MAX_ZOOM });
        // #region agent log
        fetch("http://127.0.0.1:7630/ingest/ed402528-2e82-4433-9e5e-44ba3731c608", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "4338a9" },
          body: JSON.stringify({
            sessionId: "4338a9",
            runId: "post-fix",
            hypothesisId: "zoom",
            location: "GeographyChoroplethMap.jsx:handleDrillInto",
            message: "drill flyToBounds",
            data: {
              nextLevel,
              memberCodesLen: memberCodes?.length ?? 0,
              zoomBefore: map.getZoom(),
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        return;
      }
    } catch (_) { /* fall through */ }

    map.setZoom(Math.min(map.getZoom() + 2, MAP_COMPLAINT_PIN_MAX_ZOOM), { animate: true });
  }, []);

  const handleWardFocus = useCallback((wardCode, clickedFeature) => {
    const map = mapRef.current;
    if (!map) return;
    setFocusedCode(wardCode);
    try {
      const bounds = L.geoJSON(clickedFeature).getBounds();
      if (bounds?.isValid()) {
        map.flyToBounds(bounds.pad(0.18), { maxZoom: MAP_COMPLAINT_PIN_MAX_ZOOM });
      }
    } catch (_) { /* ignore */ }
  }, []);

  const handleLocate = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!navigator.geolocation) { resetView(); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => map.flyTo([pos.coords.latitude, pos.coords.longitude], Math.max(map.getZoom(), MAP_WARD_MIN_ZOOM)),
      () => resetView(),
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }, [resetView]);

  const toggleFullscreen = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    if (!document.fullscreenElement) { shell.requestFullscreen?.().catch(() => {}); }
    else { document.exitFullscreen?.(); }
  }, []);

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      mapRef.current?.invalidateSize();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // ── Leaflet init ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, {
      scrollWheelZoom: true,
      zoomControl: false,
    }).setView(getMapCenter(), 11);

    L.control.zoom({ position: "topleft" }).addTo(map);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    // Dedicated pane for complaint pins, above polygons, below tooltips/popups.
    if (!map.getPane("complaintPins")) {
      map.createPane("complaintPins");
      map.getPane("complaintPins").style.zIndex = 640;
    }
    // A renderer bound to that pane so circleMarkers actually draw into it.
    pinRendererRef.current = L.svg({ pane: "complaintPins" });

    choroplethRef.current = L.layerGroup().addTo(map);
    complaintPinsRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const sync = () => {
      const z = map.getZoom();
      zoomLevelRef.current = z;
      setZoomLevel(z);
    };
    map.on("zoomend", sync);
    map.on("moveend", sync);
    sync();

    setTimeout(() => map.invalidateSize(), 150);
    return () => {
      map.off("zoomend", sync);
      map.off("moveend", sync);
      map.remove();
      mapRef.current = null;
      choroplethRef.current = null;
      complaintPinsRef.current = null;
      layerByCodeRef.current = {};
    };
  }, []);

  // ── draw choropleth (only when data / drill changes, NOT on zoom) ─────────
  useEffect(() => {
    const map = mapRef.current;
    const choroplethLayer = choroplethRef.current;
    if (!map || !choroplethLayer) return;

    choroplethLayer.clearLayers();
    layerByCodeRef.current = {};

    const { geoFeatures } = displayLayers;

    if (!geoFeatures?.features?.length) return;

    L.geoJSON(geoFeatures, {
      style: (feature) =>
        resolveFeatureStyle(feature, layerMode, focusedCode, joined.maxCount),
      onEachFeature: (feature, layer) => {
        layer.feature = feature;
        const code = feature?.properties?.code;
        if (code) layerByCodeRef.current[code] = layer;

        const props = feature?.properties ?? {};

        layer.bindTooltip(
          buildMapHoverTooltipHtml(props, { geoLevel }),
          HOVER_TOOLTIP_OPTIONS
        );

        layer.on("mouseover", () => {
          const s = resolveFeatureStyle(feature, layerMode, focusedCode, joined.maxCount);
          layer.setStyle({ ...s, weight: 2.5, fillOpacity: Math.min(s.fillOpacity + 0.1, 0.75) });
          layer.bringToFront?.();
        });

        layer.on("mouseout", () => {
          layer.setStyle(
            resolveFeatureStyle(feature, layerMode, focusedCode, joined.maxCount)
          );
        });

        layer.on("click", () => {
          const members = getMemberFeatures(feature);
          const memberCodes = members.map((m) => m?.properties?.code).filter(Boolean);
          if (!memberCodes.length) return;

          if (isWardDrillLevel(drillLevel)) {
            handleWardFocus(memberCodes[0] ?? code, feature);
            return;
          }

          handleDrillInto({
            nextLevel: Math.min(drillLevel + 1, MAP_DRILL_MAX_LEVEL),
            memberCodes,
            clickedFeature: feature,
            label: props.label || props.code || "Area",
          });
        });
      },
    }).addTo(choroplethLayer);
  }, [displayLayers, drillLevel, focusedCode, geoLevel, handleDrillInto, handleWardFocus, joined.maxCount, layerMode]);

  // ── update choropleth styles when focus or mode changes ──────────────────
  useEffect(() => {
    Object.values(layerByCodeRef.current).forEach((layer) => {
      const feature = layer.feature;
      if (!feature) return;
      layer.setStyle(
        resolveFeatureStyle(feature, layerMode, focusedCode, joined.maxCount)
      );
    });
  }, [focusedCode, joined.maxCount, layerMode]);

  // ── draw complaint pins — always visible, resize on zoom ─────────────────
  useEffect(() => {
    const map = mapRef.current;
    const pinLayer = complaintPinsRef.current;
    if (!map || !pinLayer) return;

    pinLayer.clearLayers();

    if (!allResolvedPins.length) return;

    const currentZoom = zoomLevel;

    allResolvedPins.forEach((pin) => {
      if (pin.lat == null || pin.lng == null) return;

      const baseRadius = markerRadiusForZoom(currentZoom, false, { complaint: true });

      const circle = L.circleMarker([pin.lat, pin.lng], {
        renderer: pinRendererRef.current ?? undefined,
        pane: "complaintPins",
        radius: baseRadius,
        color: "#0f766e",
        weight: 1.5,
        fillColor: "#14b8a6",
        fillOpacity: 0.9,
      });

      circle.bindTooltip(buildComplaintPinTooltipHtml(pin), {
        ...HOVER_TOOLTIP_OPTIONS,
        permanent: false,
      });

      circle.on("mouseover", function () {
        this.setStyle({ weight: 3, fillOpacity: 1, radius: baseRadius + 2 });
        this.bringToFront?.();
      });

      circle.on("mouseout", function () {
        this.setStyle({ weight: 1.5, fillOpacity: 0.9, radius: baseRadius });
      });

      const popup = L.popup({
        maxWidth: 260,
        className: "dashboard-map-pin-popup-wrapper",
      }).setContent(buildComplaintPinPopupContent(pin));

      circle.bindPopup(popup);

      circle.addTo(pinLayer);
    });

    pinLayer.bringToFront?.();

    // #region agent log
    try {
      const added = pinLayer.getLayers().length;
      const sample = allResolvedPins.find((p) => p.lat != null && p.lng != null);
      let containerPt = null;
      let inViewport = null;
      if (sample) {
        const cp = map.latLngToContainerPoint([sample.lat, sample.lng]);
        const size = map.getSize();
        containerPt = { x: Math.round(cp.x), y: Math.round(cp.y) };
        inViewport = cp.x >= 0 && cp.y >= 0 && cp.x <= size.x && cp.y <= size.y;
      }
      const pane = map.getPane("complaintPins");
      fetch("http://127.0.0.1:7630/ingest/ed402528-2e82-4433-9e5e-44ba3731c608", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "4338a9" },
        body: JSON.stringify({
          sessionId: "4338a9",
          hypothesisId: "C",
          location: "GeographyChoroplethMap.jsx:447",
          message: "pin draw effect",
          data: {
            resolvedLen: allResolvedPins.length,
            circlesAdded: added,
            zoom: currentZoom,
            radius: markerRadiusForZoom(currentZoom, false, { complaint: true }),
            paneExists: Boolean(pane),
            paneZIndex: pane?.style?.zIndex ?? null,
            sampleLatLng: sample ? { lat: sample.lat, lng: sample.lng } : null,
            containerPt,
            inViewport,
            mapSize: (() => { const s = map.getSize(); return { x: s.x, y: s.y }; })(),
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    } catch (_) { /* ignore */ }
    // #endregion
  }, [allResolvedPins, zoomLevel]);

  // ── initial fit ───────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || focusedCode || !joined.geoFeatures?.features?.length) return undefined;

    const refit = () => {
      map.invalidateSize({ animate: false, pan: false });
      const fitted = fitMapToJoinedData(map, joined, { padding: 0.12 });
      if (fitted) defaultViewRef.current = fitted;
    };

    const id = window.requestAnimationFrame(() => window.requestAnimationFrame(refit));
    return () => window.cancelAnimationFrame(id);
  }, [focusedCode, joined, resizeToken]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || focusedCode || !joined.geoFeatures?.features?.length) return undefined;
    map.invalidateSize({ animate: false, pan: false });
    const fitted = fitMapToJoinedData(map, joined, { padding: 0.12 });
    if (fitted) defaultViewRef.current = fitted;
    return undefined;
  }, [focusedCode, joined]);

  // ── render ────────────────────────────────────────────────────────────────
  const showEmpty = !boundariesLoading && !wardCounts.length && !boundariesError;
  const showLoading = boundariesLoading && !joined.markers.length;

  const toggleOptions = layerOptions.map((l) => ({ id: l.id, label: l.label }));

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
            {drillTrail.map((step, i) => (
              <React.Fragment key={`trail-${i}`}>
                <span className="tw-text-muted-foreground">›</span>
                <span className="tw-truncate">{step.label}</span>
              </React.Fragment>
            ))}
            {focusedWard ? (
              <>
                <span className="tw-text-muted-foreground">›</span>
                <span className="tw-truncate tw-font-semibold">{focusedWard.label}</span>
              </>
            ) : null}
          </div>
          <div className="dashboard-map-zoom-badge tw-shrink-0 tw-rounded-sm tw-border tw-border-border tw-bg-muted/40 tw-px-2 tw-py-0.5 tw-text-[10px] tw-text-muted-foreground">
            {geoLevel}
            {allResolvedPins.length
              ? ` · ${allResolvedPins.length} complaint${allResolvedPins.length === 1 ? "" : "s"}`
              : ""}
          </div>
        </div>

        <div className="dashboard-map-controls tw-flex tw-shrink-0 tw-items-center">
          <button
            type="button"
            className="dashboard-map-control-btn"
            title="Locate me"
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
            {complaintPinsError ? (
              <div className="tw-pointer-events-none tw-absolute tw-right-3 tw-top-20 tw-z-[1000] tw-max-w-[220px] tw-rounded tw-bg-amber-50/95 tw-px-2 tw-py-1 tw-text-[10px] tw-text-amber-900">
                Complaint pins unavailable: analytics API must expose latitude, longitude, and service_request_id on the facts grain.
              </div>
            ) : null}
          </>
        )}
      </div>

      {!showEmpty && !showLoading ? (
        <div className="dashboard-map-legend tw-pointer-events-auto tw-absolute tw-bottom-3 tw-left-3 tw-z-[1100]">
          <div className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-border-b tw-border-border tw-px-2.5 tw-py-2">
            <span className="tw-text-[11px] tw-font-semibold tw-text-foreground">{legendTitle}</span>
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
                      style={{ backgroundColor: item.fill, borderColor: item.stroke }}
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
