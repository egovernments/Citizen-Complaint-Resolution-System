import React, { useState, useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Tooltip, GeoJSON } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { injectGlassTooltipStyle } from "../utils/mapTooltipStyle";
import { CardLabel } from "@egovernments/digit-ui-react-components";
import { useTranslation } from "react-i18next";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point as turfPoint } from "@turf/helpers";
import useMapConfig from "../hooks/pgr/useMapConfig";
import VectorBaseLayer from "./VectorBaseLayer";
import MapCamera from "./MapCamera";
import { brandPin } from "./mapPin";
import useTenantBoundaries from "../hooks/pgr/useTenantBoundaries";

// Fix default icon issue in React builds (still needed by other maps)
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.6.0/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.6.0/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.6.0/dist/images/marker-shadow.png",
});

// Branded pin shared across the PGR maps — see mapPin.js.

// Frosted-glass styling for the address tooltip so it no longer covers the map.
injectGlassTooltipStyle();

const NavigationIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2L4.5 20.29L5.21 21L12 18L18.79 21L19.5 20.29L12 2Z" fill="white" />
  </svg>
);

const ComplaintLocationMap = ({ latitude, longitude, address }) => {
  const { t, i18n } = useTranslation();
  const [fetchedAddress, setFetchedAddress] = useState(null);
  const [isLoadingAddress, setIsLoadingAddress] = useState(false);
  // Map theming resolved per tenant from MDMS RAINMAKER-PGR.MapConfig:
  // base tile theme (defaults to the light voyager basemap) + ward-highlight
  // colour (defaults to the legacy orange #FFA74F).
  const {
    isReady,
    tileUrl,
    tileAttribution,
    tileClassName,
    vectorStyleUrl,
    wardHighlightColor: WARD_COLOR,
    minZoom,
    maxZoom,
    geocodeCountryCodes,
  } = useMapConfig();

  // This map always opens on a known complaint, so the starting position is the
  // complaint itself rather than the tenant's configured centre. Only the zoom
  // is a presentation choice: 16 frames the street tightly, clamped to tenant bounds.
  const DETAIL_ZOOM = Math.min(Math.max(16, minZoom), maxZoom);

  // Nominatim Accept-Language is ISO 639-1; derive from i18n locale (e.g.
  // `sw_KE` → `sw`). Falls back to English (closes egovernments/CCRS#520
  // for the address-text part — map TILE labels are baked into the
  // CARTO raster tiles and need a vector-tile provider swap to render
  // in Swahili).
  const nominatimLang = ((i18n?.language || Digit?.StoreData?.getCurrentLanguage?.() || "en") + "").split("_")[0] || "en";

  // Tenant ward polygons from boundary-service for the configured MAP_TENANT.
  // Null while the fetch is in flight; empty collection when the tenant has
  // no usable geometry (no overlay — never another tenant's static wards).
  const tenantBoundaries = useTenantBoundaries();

  // MapContainer latches centre and zoom at mount. DETAIL_ZOOM only settles
  // once MapConfig resolves from MDMS, and the complaint's coordinates can
  // change under a mounted map (react-query refetch, or the details screen
  // reused for another complaint) — both leave the marker right and the view
  // wrong. MapCamera re-frames whenever this target actually changes.
  const cameraTarget = useMemo(
    () => ({ lat: Number(latitude), lng: Number(longitude), zoom: DETAIL_ZOOM }),
    [latitude, longitude, DETAIL_ZOOM]
  );

  const matchedWard = useMemo(() => {
    const wardCollection = tenantBoundaries;
    if (!latitude || !longitude || !wardCollection?.features?.length) return null;
    const pt = turfPoint([longitude, latitude]);
    return wardCollection.features.find((f) => {
      try { return booleanPointInPolygon(pt, f); } catch { return false; }
    }) || null;
  }, [latitude, longitude, tenantBoundaries]);

  const wardLayerStyle = (feature) => {
    const isMatch = matchedWard && feature?.properties?.code === matchedWard.properties.code;
    // The matched ward reads as an outline with a whisper of fill — the old
    // 0.35 fill washed the whole basemap orange and buried the street detail.
    return isMatch
      ? { color: WARD_COLOR, weight: 2.5, opacity: 0.95, fillColor: WARD_COLOR, fillOpacity: 0.08 }
      : { color: WARD_COLOR, weight: 0.6, opacity: 0.25, fillColor: WARD_COLOR, fillOpacity: 0    };
  };

  // Fetch address details based on lat/lng using reverse geocoding
  useEffect(() => {
    if (!latitude || !longitude) return;

    const fetchAddressFromCoordinates = async () => {
      setIsLoadingAddress(true);
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1${geocodeCountryCodes ? `&countrycodes=${encodeURIComponent(geocodeCountryCodes)}` : ""}`,
          {
            headers: {
              'Accept-Language': nominatimLang
            }
          }
        );

        if (response.ok) {
          const data = await response.json();

          // Construct a readable address from the response
          const addressParts = [];

          if (data.address) {
            // Add building or house number
            if (data.address.building || data.address.house_number) {
              addressParts.push(data.address.building || data.address.house_number);
            }

            // Add road/street
            if (data.address.road) {
              addressParts.push(data.address.road);
            }

            // Add suburb or neighbourhood
            if (data.address.suburb || data.address.neighbourhood) {
              addressParts.push(data.address.suburb || data.address.neighbourhood);
            }

            // Add city/town/village
            if (data.address.city || data.address.town || data.address.village) {
              addressParts.push(data.address.city || data.address.town || data.address.village);
            }

            // Add state
            if (data.address.state) {
              addressParts.push(data.address.state);
            }

            // Add postcode
            if (data.address.postcode) {
              addressParts.push(data.address.postcode);
            }
          }

          const formattedAddress = addressParts.length > 0
            ? addressParts.join(", ")
            : data.display_name || `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;

          setFetchedAddress(formattedAddress);
        }
      } catch (error) {
        console.error("Error fetching address from coordinates:", error);
        setFetchedAddress(`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
      } finally {
        setIsLoadingAddress(false);
      }
    };

    fetchAddressFromCoordinates();
  }, [latitude, longitude]);

  // Nothing to show without coordinates. Also hold until MapConfig resolves:
  // MapContainer latches zoom/minZoom/maxZoom at mount, so mounting first and
  // letting MDMS answer later leaves the map on the built-in bounds and
  // silently ignores the ones the tenant configured.
  if (!latitude || !longitude || !isReady) {
    return null;
  }

  const handleOpenInGoogleMaps = () => {
    const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
    window.open(googleMapsUrl, "_blank");
  };

  // Use fetched address or fallback to provided address
  const displayAddress = fetchedAddress || address;

  return (
    <div style={{ marginBottom: "24px" }}>

      <div style={{ position: "relative", height: "400px", width: "100%" }}>
        {/* Map Container */}
        <div style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: "12px",
          overflow: "hidden",
          border: "1px solid #d6d5d4",
          boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
          zIndex: 0
        }}>
          <MapContainer
            center={[latitude, longitude]}
            zoom={DETAIL_ZOOM}
            minZoom={minZoom}
            maxZoom={maxZoom}
            style={{ height: "100%", width: "100%" }}
            zoomControl={true}
            dragging={true}
            scrollWheelZoom={false}
            doubleClickZoom={true}
            touchZoom={true}
          >
            <MapCamera target={cameraTarget} />
            {vectorStyleUrl ? (
              <VectorBaseLayer styleUrl={vectorStyleUrl} attribution={tileAttribution} />
            ) : (
              <TileLayer key={tileUrl} attribution={tileAttribution} url={tileUrl} className={tileClassName} />
            )}
            {tenantBoundaries?.features?.length > 0 && (
              <GeoJSON
                key={`${matchedWard?.properties?.code || "_"}-${tenantBoundaries.features.length}`}
                data={tenantBoundaries}
                style={wardLayerStyle}
              />
            )}
            <Marker position={[latitude, longitude]} icon={brandPin}>
              {/* Hover-only tooltip; the always-visible address moved to the
                  bottom bar so it no longer covers the streets around the pin. */}
              {displayAddress && (
                <Tooltip direction="top" opacity={1} className="pgr-loc-tooltip">
                  {displayAddress}
                </Tooltip>
              )}
            </Marker>
          </MapContainer>

          {/* Bottom overlay: address bar + navigate, one calm row over the map */}
          <div className="pgr-map-bar">
            <div className="pgr-map-address" title={displayAddress || ""}>
              {isLoadingAddress ? t("CS_COMMON_LOADING") : (displayAddress || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`)}
              {displayAddress && (
                <span className="pgr-map-coords">{latitude.toFixed(5)}, {longitude.toFixed(5)}</span>
              )}
            </div>
            <button className="pgr-map-navigate" onClick={handleOpenInGoogleMaps} title={t("CS_OPEN_IN_GOOGLE_MAPS")}>
              <NavigationIcon />
              {t("CS_NAVIGATE")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ComplaintLocationMap;
