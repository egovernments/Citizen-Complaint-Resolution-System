import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  getGeographyMapLegend,
  getGeographyMapLegendFooter,
  getGeographyMapLegendTitle,
  getCreatedCountFillStyle,
  getOpenShareFillStyle,
  getResolvedShareFillStyle,
} from "../config/geographyMapPresentation";
import { buildMapHoverTooltipHtml, buildComplaintPinTooltipHtml } from "../config/mapHoverPresentation";
import useDashboardT from "../i18n/useDashboardT";
import { dimensionLabel } from "../i18n/dimensionLabel";
import { fetchBoundariesByCodes, fetchBoundaryRelationshipsByCodes } from "../services/boundaryService";
import { useMapResize } from "../hooks/useMapResize";
import {
  aggregateWardCountsToLevel,
  deriveBoundaryAncestorCodes,
  buildBoundaryLabelIndex,
  buildMapDisplayLayers,
  buildMapDrillHierarchy,
  fitMapToJoinedData,
  flyToDrillBounds,
  formatHierarchyGroupLabel,
  getDrillTier,
  getFeaturesInDrillScope,
  getHierarchyGroupKey,
  getMapCenter,
  getMapZoomLevelLabel,
  getWardFeaturesInHierarchyGroup,
  resolveDrillZoomFeatures,
  resolveComplaintPinPositions,
  getMapCityLabel,
  isWardDrillLevel,
  joinWardMapData,
  MAP_COMPLAINT_PIN_MAX_ZOOM,
  MAP_DRILL_MAX_LEVEL,
  MAP_WARD_MIN_ZOOM,
  markerRadiusForZoom,
  resolveMapRootLabel,
} from "../utils/mapGeoUtils";
import { VISUALIZATION_STYLES, VIZ_TYPE } from "../config/visualizationStyles";
import ViewToggle from "./demo/ViewToggle";

const mapStyles = VISUALIZATION_STYLES[VIZ_TYPE.MAP];

const MAP_HOVER_TOOLTIP_PANE = "dashboardMapHoverTooltips";

const HOVER_TOOLTIP_OPTIONS = {
  sticky: true,
  direction: "top",
  opacity: 1,
  className: "dashboard-map-hover-tooltip",
  pane: MAP_HOVER_TOOLTIP_PANE,
};

function resolveComplaintPinKey(pin) {
  const id = String(pin?.serviceRequestId ?? "").trim();
  if (id) return id;
  return `${pin?.lat},${pin?.lng}`;
}

function complaintPinPopupOffset(radius) {
  return L.point(0, -Math.max(radius + 10, 12));
}

function closeOtherPinPopups(activeCircle, pinLayersByKey = {}) {
  Object.values(pinLayersByKey).forEach((circle) => {
    if (circle !== activeCircle && circle.isPopupOpen?.()) {
      circle.closePopup();
    }
  });
}

function createComplaintPinPopup(pin, radius) {
  return L.popup({
    maxWidth: 260,
    className: "dashboard-map-pin-popup-wrapper",
    offset: complaintPinPopupOffset(radius),
    closeOnClick: false,
    autoClose: true,
    closeOnEscapeKey: true,
    autoPan: false,
  }).setContent(buildComplaintPinPopupContent(pin));
}


// Zoom thresholds that drive which boundary level renders (county/sub-county/ward).
const MAP_COUNTY_MAX_ZOOM = 10; // below -> county outline only
const MAP_SUBCOUNTY_MAX_ZOOM = 12; // below -> sub-counties; at/above -> wards

function resolveFeatureStyle(feature, layerMode, focusedCode, zoom = 11) {
  const props = feature?.properties ?? {};
  const isFocused = focusedCode && props.code === focusedCode;
  const base =
    layerMode === "open"
      ? getOpenShareFillStyle(props.openPct)
      : layerMode === "resolved"
        ? getResolvedShareFillStyle(props.resolvedPct)
        : getCreatedCountFillStyle(Number(props.count) || Number(props.created) || 0);

  const weight = isFocused ? 2.5 : zoom < 11 ? 0.75 : zoom < 14 ? 1.1 : 1.5;

  return {
    fillColor: base.fillColor,
    color: isFocused ? "#111827" : base.strokeColor,
    weight,
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
  layerMode = "created",
  onLayerModeChange,
  layerOptions = [],
  cityLabel = getMapCityLabel(),
}) => {
  const { t, language } = useDashboardT();
  const shellRef = useRef(null);
  const frameRef = useRef(null);
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const choroplethRef = useRef(null);
  const complaintPinsRef = useRef(null);
  const pinRendererRef = useRef(null);
  const pinLayersByKeyRef = useRef({});
  const selectedPinKeyRef = useRef(null);
  const updateComplaintPinRadiiRef = useRef(() => {});
  const layerByCodeRef = useRef({});
  const defaultViewRef = useRef({ center: getMapCenter(), zoom: 11 });

  // Synced on every map zoom/move; read from layer callbacks via ref so GeoJSON
  // layers are not rebuilt on each scroll step.
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

  // Zoom-driven boundary level: zoomed out shows the county outline, mid shows
  // sub-counties, zoomed in shows wards. Thresholds are deliberately coarse.
  const activeLevel =
    zoomLevel < MAP_COUNTY_MAX_ZOOM
      ? "county"
      : zoomLevel < MAP_SUBCOUNTY_MAX_ZOOM
        ? "subCounty"
        : "ward";

  const geoLevel =
    activeLevel === "county"
      ? t("DASHBOARD_GEO_LEVEL_0", "County")
      : activeLevel === "subCounty"
        ? t("DASHBOARD_GEO_LEVEL_1", "Sub-county")
        : getMapZoomLevelLabel({
            drillTrailLength: drillTrail.length,
            focusedCode,
            drillLevel,
          });

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
    // Fetch relationships first so we know the parent (county/sub-county) codes, then
    // fetch geometries for wards AND parents — the zoom-driven levels need all three.
    fetchBoundaryRelationshipsByCodes(wardCodes)
      .then((rels) => {
        const parentCodes = deriveBoundaryAncestorCodes(rels);
        return Promise.all([
          fetchBoundariesByCodes([...wardCodes, ...parentCodes]),
          Promise.resolve(rels),
        ]);
      })
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
    [wardCounts, boundaries, language]
  );

  // Parent-level joins for the zoom-driven boundary levels (counts rolled up to the
  // sub-county / county, joined against the seeded parent polygons).
  const subCountyJoined = useMemo(
    () => joinWardMapData(aggregateWardCountsToLevel(wardCounts, hierarchyIndex, 1), boundaries),
    [wardCounts, hierarchyIndex, boundaries, language]
  );
  const countyJoined = useMemo(
    () => joinWardMapData(aggregateWardCountsToLevel(wardCounts, hierarchyIndex, 0), boundaries),
    [wardCounts, hierarchyIndex, boundaries, language]
  );
  // Active level by zoom; fall back to wards if a level's parent polygons are missing.
  const activeJoined =
    activeLevel === "county" && countyJoined.geoFeatures.features.length
      ? countyJoined
      : activeLevel === "subCounty" && subCountyJoined.geoFeatures.features.length
        ? subCountyJoined
        : joined;

  const drillHierarchyIndex = useMemo(
    () =>
      buildMapDrillHierarchy({
        apiIndex: hierarchyIndex,
        wardCodes,
        features: joined.geoFeatures?.features ?? [],
      }),
    [hierarchyIndex, wardCodes, joined.geoFeatures?.features]
  );

  const mapRootLabel = useMemo(
    () => resolveMapRootLabel(cityLabel, drillHierarchyIndex, wardCodes, boundaries),
    [cityLabel, drillHierarchyIndex, wardCodes, boundaries, language]
  );

  const boundaryLabelIndex = useMemo(
    () => buildBoundaryLabelIndex(boundaries),
    [boundaries, language]
  );

  const focusedWard = useMemo(
    () => wardCounts.find((r) => r.wardCode === focusedCode),
    [focusedCode, wardCounts]
  );

  const activeFilterLabel = useMemo(() => {
    if (focusedWard?.label) return focusedWard.label;
    if (drillTrail.length) return drillTrail[drillTrail.length - 1]?.label ?? null;
    return null;
  }, [focusedWard, drillTrail]);

  const displayLayers = useMemo(() => {
    // Pass [] for pins here so buildMapDisplayLayers doesn't run the (heavy) pin
    // resolution against the active level — we place pins by ward code below.
    const layers = buildMapDisplayLayers(activeJoined, drillLevel, [], drillHierarchyIndex);
    // Pins are placed by ward code, so position them via the ward-level join even when
    // a parent level (county/sub-county) is rendered — otherwise every pin is dropped.
    layers.complaintPins = complaintPins.length
      ? resolveComplaintPinPositions(complaintPins, joined)
      : [];
    return layers;
  }, [activeJoined, joined, drillLevel, complaintPins, drillHierarchyIndex]);

  const visibleComplaintPins = displayLayers.complaintPins ?? [];

  const legendItems = useMemo(() => getGeographyMapLegend(layerMode), [layerMode, language]);
  const legendTitle = getGeographyMapLegendTitle(layerMode);
  const legendFooter = getGeographyMapLegendFooter(drillTrail.length);

  // Reset drill state when layer mode changes.
  useEffect(() => {
    setFocusedCode(null);
    setDrillLevel(0);
    setDrillTrail([]);
    selectedPinKeyRef.current = null;
    mapRef.current?.closePopup();
  }, [layerMode]);

  const updateComplaintPinRadii = useCallback((zoom) => {
    Object.entries(pinLayersByKeyRef.current).forEach(([, circle]) => {
      if (!circle?.setRadius) return;

      const radius = markerRadiusForZoom(zoom, false, { complaint: true });
      const isSelected = circle.isPopupOpen?.();

      circle.setRadius(isSelected ? radius + 2 : radius);

      const popup = circle.getPopup?.();
      if (!popup) return;

      popup.options.offset = complaintPinPopupOffset(radius);
      if (isSelected) popup.update();
    });
  }, []);

  updateComplaintPinRadiiRef.current = updateComplaintPinRadii;

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
  const handleDrillInto = useCallback(
    ({
      nextLevel,
      memberFeatures,
      clickedFeature,
      allWardFeatures,
      scopedWardFeatures,
      tierId,
      groupKey,
      label,
    }) => {
      const map = mapRef.current;
      if (!map) return;

      setDrillLevel(nextLevel);
      setDrillTrail((prev) => [...prev, { label, groupKey, tierId }]);
      setFocusedCode(null);

      const zoomFeatures = resolveDrillZoomFeatures({
        memberFeatures,
        clickedFeature,
        allFeatures: allWardFeatures,
        scopedFeatures: scopedWardFeatures,
        hierarchyIndex: drillHierarchyIndex,
        tierId,
      });

      flyToDrillBounds(map, zoomFeatures, { maxZoom: MAP_COMPLAINT_PIN_MAX_ZOOM });
    },
    [drillHierarchyIndex]
  );

  const handleWardFocus = useCallback((wardCode, clickedFeature, label) => {
    const map = mapRef.current;
    if (!map) return;
    setFocusedCode(wardCode);
    if (label) {
      setDrillTrail((prev) => {
        if (prev.length && prev[prev.length - 1]?.label === label) return prev;
        return [...prev, { label, groupKey: wardCode, tierId: "ward" }];
      });
    }
    setDrillLevel(MAP_DRILL_MAX_LEVEL);
    flyToDrillBounds(map, clickedFeature ? [clickedFeature] : [], {
      padding: 0.18,
      maxZoom: MAP_COMPLAINT_PIN_MAX_ZOOM,
    });
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

    // Dedicated pane for complaint pins, above polygons, below hover tooltips.
    if (!map.getPane("complaintPins")) {
      map.createPane("complaintPins");
      map.getPane("complaintPins").style.zIndex = 640;
    }
    // Ward hover cards sit above pin popups (Leaflet popup pane is 700).
    if (!map.getPane(MAP_HOVER_TOOLTIP_PANE)) {
      map.createPane(MAP_HOVER_TOOLTIP_PANE);
      map.getPane(MAP_HOVER_TOOLTIP_PANE).style.zIndex = 800;
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
      updateComplaintPinRadiiRef.current(z);
    };
    const onZoom = () => {
      const z = map.getZoom();
      zoomLevelRef.current = z;
      updateComplaintPinRadiiRef.current(z);
    };
    const repositionOpenPopup = () => {
      const selectedKey = selectedPinKeyRef.current;
      if (!selectedKey) return;
      const circle = pinLayersByKeyRef.current[selectedKey];
      if (circle?.isPopupOpen?.()) circle.getPopup()?.update();
    };

    map.on("zoomend", sync);
    map.on("moveend", sync);
    map.on("zoom", onZoom);
    map.on("move", repositionOpenPopup);
    sync();

    setTimeout(() => map.invalidateSize(), 150);
    return () => {
      map.off("zoomend", sync);
      map.off("moveend", sync);
      map.off("zoom", onZoom);
      map.off("move", repositionOpenPopup);
      map.remove();
      mapRef.current = null;
      choroplethRef.current = null;
      complaintPinsRef.current = null;
      layerByCodeRef.current = {};
    };
  }, []);

  // ── draw choropleth (data / drill / mode; zoom styles updated separately below) ─
  useEffect(() => {
    const map = mapRef.current;
    const choroplethLayer = choroplethRef.current;
    if (!map || !choroplethLayer) return;

    choroplethLayer.clearLayers();
    layerByCodeRef.current = {};

    const { geoFeatures } = displayLayers;

    if (!geoFeatures?.features?.length) return;

    const allWardFeatures = joined.geoFeatures?.features ?? [];

    L.geoJSON(geoFeatures, {
      style: (feature) =>
        resolveFeatureStyle(feature, layerMode, focusedCode, zoomLevelRef.current),
      onEachFeature: (feature, layer) => {
        layer.feature = feature;
        const code = feature?.properties?.code;
        if (code) layerByCodeRef.current[code] = layer;

        const props = feature?.properties ?? {};

        layer.bindTooltip(
          buildMapHoverTooltipHtml(props, { layerMode, geoLevel }),
          HOVER_TOOLTIP_OPTIONS
        );

        layer.on("mouseover", () => {
          const s = resolveFeatureStyle(
            feature,
            layerMode,
            focusedCode,
            zoomLevelRef.current
          );
          layer.setStyle({ ...s, weight: 2.5, fillOpacity: Math.min(s.fillOpacity + 0.1, 0.75) });
          layer.bringToFront?.();
        });

        layer.on("mouseout", () => {
          layer.setStyle(
            resolveFeatureStyle(feature, layerMode, focusedCode, zoomLevelRef.current)
          );
        });

        layer.on("click", () => {
          if (!code) return;

          if (isWardDrillLevel(drillLevel)) {
            const wardLabel =
              props.label ||
              boundaryLabelIndex[code] ||
              dimensionLabel(code, "boundary");
            handleWardFocus(code, feature, wardLabel);
            return;
          }

          const currentTier = getDrillTier(drillLevel);
          const scopedWardFeatures = getFeaturesInDrillScope(
            allWardFeatures,
            drillHierarchyIndex,
            drillTrail
          );
          const memberFeatures = getWardFeaturesInHierarchyGroup(
            scopedWardFeatures,
            code,
            drillHierarchyIndex,
            currentTier.id
          );
          const groupKey = getHierarchyGroupKey(code, drillHierarchyIndex, currentTier.id);
          const groupLabel = formatHierarchyGroupLabel(groupKey, boundaryLabelIndex);

          handleDrillInto({
            nextLevel: Math.min(drillLevel + 1, MAP_DRILL_MAX_LEVEL),
            memberFeatures: memberFeatures.length ? memberFeatures : [feature],
            clickedFeature: feature,
            allWardFeatures,
            scopedWardFeatures,
            tierId: currentTier.id,
            groupKey,
            label: groupLabel || props.label || t("DASHBOARD_MAP_AREA", "Area"),
          });
        });
      },
    }).addTo(choroplethLayer);
  }, [
    boundaryLabelIndex,
    displayLayers,
    drillLevel,
    focusedCode,
    geoLevel,
    handleDrillInto,
    handleWardFocus,
    drillHierarchyIndex,
    drillTrail,
    joined.geoFeatures?.features,
    // Leaflet tooltips are drawn imperatively — redraw layers on language switch
    // (#882 ward-tooltip precedent) so bound tooltip text picks up the new locale.
    language,
    layerMode,
  ]);

  // ── update choropleth border weights when zoom / focus / mode changes ─────
  useEffect(() => {
    Object.values(layerByCodeRef.current).forEach((layer) => {
      const feature = layer.feature;
      if (!feature) return;
      layer.setStyle(
        resolveFeatureStyle(feature, layerMode, focusedCode, zoomLevel)
      );
    });
  }, [focusedCode, layerMode, zoomLevel]);

  // ── draw complaint pins — redraw on data change; resize on zoom without closing popup
  useEffect(() => {
    const map = mapRef.current;
    const pinLayer = complaintPinsRef.current;
    if (!map || !pinLayer) return;

    const selectedKey = selectedPinKeyRef.current;

    pinLayer.clearLayers();
    pinLayersByKeyRef.current = {};

    if (!visibleComplaintPins.length) {
      selectedPinKeyRef.current = null;
      map.closePopup();
      return;
    }

    const currentZoom = zoomLevelRef.current;

    visibleComplaintPins.forEach((pin) => {
      if (pin.lat == null || pin.lng == null) return;

      const key = resolveComplaintPinKey(pin);
      const baseRadius = markerRadiusForZoom(currentZoom, false, { complaint: true });
      const popup = createComplaintPinPopup(pin, baseRadius);

      const circle = L.circleMarker([pin.lat, pin.lng], {
        renderer: pinRendererRef.current ?? undefined,
        pane: "complaintPins",
        radius: baseRadius,
        color: "#b45309",
        weight: 1.5,
        fillColor: "#f59e0b",
        fillOpacity: 0.92,
      });

      circle.on("click", () => {
        closeOtherPinPopups(circle, pinLayersByKeyRef.current);
        map.closeTooltip();
      });

      circle.on("mouseover", function () {
        if (this.isPopupOpen?.()) return;
        this.setStyle({ weight: 3, fillOpacity: 1, radius: baseRadius + 2 });
        this.bringToFront?.();
      });

      circle.on("mouseout", function () {
        if (this.isPopupOpen?.()) return;
        const radius = markerRadiusForZoom(zoomLevelRef.current, false, { complaint: true });
        this.setStyle({ weight: 1.5, fillOpacity: 0.9, radius });
      });

      circle.on("popupopen", function () {
        closeOtherPinPopups(this, pinLayersByKeyRef.current);
        selectedPinKeyRef.current = key;
        map.closeTooltip();
        const radius = markerRadiusForZoom(zoomLevelRef.current, false, { complaint: true });
        Object.entries(pinLayersByKeyRef.current).forEach(([, layer]) => {
          const layerRadius = markerRadiusForZoom(zoomLevelRef.current, false, { complaint: true });
          if (layer.isPopupOpen?.()) {
            layer.setStyle({ weight: 3, fillOpacity: 1, radius: layerRadius + 2 });
          } else {
            layer.setStyle({ weight: 1.5, fillOpacity: 0.9, radius: layerRadius });
          }
        });
        const activePopup = this.getPopup();
        if (activePopup) {
          activePopup.options.offset = complaintPinPopupOffset(radius);
          activePopup.update();
        }
      });

      circle.on("popupclose", function () {
        if (selectedPinKeyRef.current === key) selectedPinKeyRef.current = null;
        const radius = markerRadiusForZoom(zoomLevelRef.current, false, { complaint: true });
        this.setStyle({ weight: 1.5, fillOpacity: 0.9, radius });
      });

      circle.bindPopup(popup);
      pinLayersByKeyRef.current[key] = circle;
      circle.addTo(pinLayer);
    });

    pinLayer.bringToFront?.();

    if (selectedKey && pinLayersByKeyRef.current[selectedKey]) {
      pinLayersByKeyRef.current[selectedKey].openPopup();
    } else {
      selectedPinKeyRef.current = null;
    }
    // `language` dep: popup content is baked at bind time — rebuild pins on
    // language switch so pin tooltips re-render localized (#882 precedent).
  }, [visibleComplaintPins, language]);

  // ── initial fit ───────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (
      !map ||
      focusedCode ||
      drillTrail.length > 0 ||
      !joined.geoFeatures?.features?.length
    ) {
      return undefined;
    }

    const refit = () => {
      map.invalidateSize({ animate: false, pan: false });
      const fitted = fitMapToJoinedData(map, joined, { padding: 0.12 });
      if (fitted) defaultViewRef.current = fitted;
    };

    const id = window.requestAnimationFrame(() => window.requestAnimationFrame(refit));
    return () => window.cancelAnimationFrame(id);
  }, [focusedCode, drillTrail.length, joined, resizeToken]);

  useEffect(() => {
    const map = mapRef.current;
    if (
      !map ||
      focusedCode ||
      drillTrail.length > 0 ||
      !joined.geoFeatures?.features?.length
    ) {
      return undefined;
    }
    map.invalidateSize({ animate: false, pan: false });
    const fitted = fitMapToJoinedData(map, joined, { padding: 0.12 });
    if (fitted) defaultViewRef.current = fitted;
    return undefined;
  }, [focusedCode, drillTrail.length, joined]);

  // ── render ────────────────────────────────────────────────────────────────
  const showEmpty = !boundariesLoading && !wardCounts.length && !boundariesError;
  const showLoading = boundariesLoading && !joined.markers.length;

  const toggleOptions = layerOptions.map((l) => ({ id: l.id, label: l.label }));

  return (
    <div
      ref={frameRef}
      className="dashboard-map-frame tw-relative tw-flex tw-min-h-0 tw-flex-1 tw-flex-col"
    >
      <div className="dashboard-map-toolbar-row tw-flex tw-shrink-0 tw-items-center tw-gap-3 tw-border-b tw-border-border tw-px-2 tw-py-2">
        {onLayerModeChange && toggleOptions.length ? (
          <ViewToggle
            value={layerMode}
            onChange={onLayerModeChange}
            variant="primary"
            options={toggleOptions}
          />
        ) : null}

        <div className="dashboard-map-breadcrumb tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-1.5 tw-text-[11px] tw-font-medium tw-text-foreground">
          <HomeIcon />
          <span className="tw-truncate">{mapRootLabel}</span>
          {drillTrail.map((step, i) => (
            <React.Fragment key={`trail-${i}`}>
              <span className="tw-text-muted-foreground">&gt;</span>
              <span
                className={`tw-truncate ${
                  i === drillTrail.length - 1 && !focusedWard ? "tw-font-semibold" : ""
                }`}
              >
                {step.label}
              </span>
            </React.Fragment>
          ))}
          {focusedWard && drillTrail[drillTrail.length - 1]?.label !== focusedWard.label ? (
            <>
              <span className="tw-text-muted-foreground">&gt;</span>
              <span className="tw-truncate tw-font-semibold">{focusedWard.label}</span>
            </>
          ) : null}
        </div>

        <div className="dashboard-map-zoom-badge tw-shrink-0 tw-rounded-sm tw-border tw-border-border tw-bg-muted/40 tw-px-2 tw-py-0.5 tw-text-[10px] tw-text-muted-foreground">
          {t("DASHBOARD_MAP_ZOOM", "zoom")} {zoomLevel} · {geoLevel}
          {visibleComplaintPins.length
            ? ` · ${visibleComplaintPins.length} ${
                visibleComplaintPins.length === 1
                  ? t("DASHBOARD_MAP_COMPLAINT_COUNT_SINGULAR", "complaint")
                  : t("DASHBOARD_MAP_COMPLAINT_COUNT_PLURAL", "complaints")
              }`
            : ""}
        </div>

        <div className="dashboard-map-controls tw-flex tw-shrink-0 tw-items-center">
          <button
            type="button"
            className="dashboard-map-control-btn"
            title={t("DASHBOARD_MAP_LOCATE_ME", "Locate me")}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleLocate}
          >
            <LocateIcon />
          </button>
          <button
            type="button"
            className="dashboard-map-control-btn dashboard-map-control-btn--text"
            title={t("DASHBOARD_MAP_RESET_VIEW", "Reset view")}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={resetView}
          >
            <ResetIcon />
            <span>{t("DASHBOARD_MAP_RESET", "Reset")}</span>
          </button>
          <button
            type="button"
            className="dashboard-map-control-btn"
            title={
              isFullscreen
                ? t("DASHBOARD_MAP_EXIT_FULLSCREEN", "Exit fullscreen")
                : t("DASHBOARD_MAP_FULLSCREEN", "Fullscreen")
            }
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
            {t("DASHBOARD_MAP_LOADING_BOUNDARIES", "Loading boundaries…")}
          </div>
        ) : null}
        {showEmpty ? (
          <div className="tw-pointer-events-none tw-absolute tw-inset-0 tw-z-[500] tw-flex tw-items-center tw-justify-center tw-bg-surface/70 tw-p-4 tw-text-[12px] tw-text-muted-foreground">
            {t("DASHBOARD_MAP_NO_GEO_DATA", "No geographic data")}
          </div>
        ) : null}
        <div
          ref={elRef}
          className={`${mapStyles.container} dashboard-map-canvas tw-h-full tw-min-h-[220px] tw-w-full tw-flex-1`}
        />

        {activeFilterLabel ? (
          <div className="dashboard-map-filter-chip tw-pointer-events-auto tw-absolute tw-right-3 tw-top-3 tw-z-[1000] tw-flex tw-items-center tw-gap-2 tw-rounded-sm tw-border tw-border-border tw-bg-surface/95 tw-px-2.5 tw-py-1.5 tw-text-[10px] tw-shadow-sm">
            <span className="tw-text-muted-foreground">{t("DASHBOARD_MAP_FILTER", "Filter:")}</span>
            <span className="tw-font-semibold tw-text-foreground">{activeFilterLabel}</span>
            <button
              type="button"
              className="dashboard-map-filter-clear"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={resetView}
            >
              {t("DASHBOARD_MAP_CLEAR", "Clear")}
            </button>
          </div>
        ) : null}

        {boundariesError ? (
          <div className="tw-pointer-events-none tw-absolute tw-right-3 tw-top-12 tw-z-[1000] tw-rounded tw-bg-surface/90 tw-px-2 tw-py-1 tw-text-[10px] tw-text-muted-foreground">
            {t("DASHBOARD_MAP_BOUNDARIES_ERROR", "Could not load ward boundaries")}
          </div>
        ) : null}
        {complaintPinsError ? (
          <div className="tw-pointer-events-none tw-absolute tw-right-3 tw-top-20 tw-z-[1000] tw-max-w-[220px] tw-rounded tw-bg-amber-50/95 tw-px-2 tw-py-1 tw-text-[10px] tw-text-amber-900">
            {t(
              "DASHBOARD_MAP_PINS_UNAVAILABLE",
              "Complaint pins unavailable: analytics API must expose latitude, longitude, and service_request_id on the facts grain."
            )}
          </div>
        ) : null}
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
              aria-label={
                legendCollapsed
                  ? t("DASHBOARD_MAP_LEGEND_EXPAND", "Expand legend")
                  : t("DASHBOARD_MAP_LEGEND_COLLAPSE", "Collapse legend")
              }
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
