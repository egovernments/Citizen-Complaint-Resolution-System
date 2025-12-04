import React, { useState, useRef, useEffect, useCallback } from "react";
import { Map, TileLayer, Marker, Tooltip, Polygon } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { CardLabel, Loader, Toast } from "@egovernments/digit-ui-react-components";
import { useTranslation } from "react-i18next";
import _ from "lodash";

// Fix default icon issue in React builds
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.6.0/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.6.0/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.6.0/dist/images/marker-shadow.png",
});

const LocateIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 8C9.79 8 8 9.79 8 12C8 14.21 9.79 16 12 16C14.21 16 16 14.21 16 12C16 9.79 14.21 8 12 8ZM20.94 11C20.48 6.83 17.17 3.52 13 3.06V1H11V3.06C6.83 3.52 3.52 6.83 3.06 11H1V13H3.06C3.52 17.17 6.83 20.48 11 20.94V23H13V20.94C17.17 20.48 20.48 17.17 20.94 13H23V11H20.94ZM12 19C8.13 19 5 15.87 5 12C5 8.13 8.13 5 12 5C15.87 5 19 8.13 19 12C19 15.87 15.87 19 12 19Z" fill="#F47738" />
  </svg>
);

const SearchIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M15.5 14H14.71L14.43 13.73C15.41 12.59 16 11.11 16 9.5C16 5.91 13.09 3 9.5 3C5.91 3 3 5.91 3 9.5C3 13.09 5.91 16 9.5 16C11.11 16 12.59 15.41 13.73 14.43L14 14.71V15.5L19 20.49L20.49 19L15.5 14ZM9.5 14C7.01 14 5 11.99 5 9.5C5 7.01 7.01 5 9.5 5C11.99 5 14 7.01 14 9.5C14 11.99 11.99 14 9.5 14Z" fill="#F47738" />
  </svg>
);

const CloseIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12L19 6.41Z" fill="#505A5F" />
  </svg>
);

const PolygonIcon = ({ active }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M17 8L20 11L17 14L14 11L17 8ZM17 6L12 11L17 16L22 11L17 6ZM7 12L10 15L7 18L4 15L7 12ZM7 10L2 15L7 20L12 15L7 10ZM12 2L15 5L12 8L9 5L12 2ZM12 0L7 5L12 10L17 5L12 0Z" fill={active ? "#F47738" : "#505A5F"} />
  </svg>
);

const GeoLocations = ({ t, config, onSelect, formData }) => {
  const { t: trans } = useTranslation();
  const [coords, setCoords] = useState({ lat: 20.5937, lng: 78.9629 }); // Default center
  const [markerPos, setMarkerPos] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [address, setAddress] = useState("");
  const [showToast, setShowToast] = useState(null);
  const [isPolygonMode, setIsPolygonMode] = useState(false);
  const [polygonPoints, setPolygonPoints] = useState([]);
  const mapRef = useRef(null);
  const searchInputRef = useRef(null);

  useEffect(() => {
    if (formData?.[config.key]) {
      const { lat, lng } = formData[config.key];
      if (lat && lng) {
        setCoords({ lat, lng });
        setMarkerPos([lat, lng]);
        // Optionally fetch address if not present
        if (!address) {
          fetchAddress(lat, lng);
        }
      }
    }
  }, [formData, config.key]);

  const fetchAddress = async (lat, lng) => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
      );
      const data = await response.json();
      if (data && data.display_name) {
        setAddress(data.display_name);
        setSearchQuery(data.display_name); // Update search bar with fetched address
        // Extract pincode if available
        const pincode = data.address?.postcode;
        onSelect(config.key, { lat, lng, pincode, address: data.display_name });
      } else {
        onSelect(config.key, { lat, lng });
      }
    } catch (error) {
      console.error("Error fetching address:", error);
      onSelect(config.key, { lat, lng });
    }
  };

  const updateLocation = async (lat, lng) => {
    setCoords({ lat, lng });
    setMarkerPos([lat, lng]);
    setAddress(t("CS_FETCHING_ADDRESS"));
    setSearchQuery(t("CS_FETCHING_ADDRESS"));
    await fetchAddress(lat, lng);
  };

  const handleMapClick = (e) => {
    const { lat, lng } = e.latlng;

    if (isPolygonMode) {
      setPolygonPoints([...polygonPoints, [lat, lng]]);
    } else {
      updateLocation(lat, lng);
      setSuggestions([]); // Clear suggestions on map click
    }
  };

  const fetchSuggestions = async (query) => {
    if (!query || query.length < 3) {
      setSuggestions([]);
      return;
    }
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`
      );
      const data = await response.json();
      setSuggestions(data);
    } catch (error) {
      console.error("Error fetching suggestions:", error);
    }
  };

  // Debounce the fetchSuggestions function
  const debouncedFetchSuggestions = useCallback(_.debounce(fetchSuggestions, 500), []);

  const handleInputChange = (e) => {
    const value = e.target.value;
    setSearchQuery(value);
    debouncedFetchSuggestions(value);
  };

  const handleSuggestionSelect = (suggestion) => {
    const lat = parseFloat(suggestion.lat);
    const lng = parseFloat(suggestion.lon);

    setSearchQuery(suggestion.display_name);
    setSuggestions([]); // Clear suggestions

    updateLocation(lat, lng);

    if (mapRef.current) {
      mapRef.current.leafletElement.setView([lat, lng], 15);
    }
  };

  const handleSearch = async (e) => {
    if (e) e.preventDefault(); // Prevent form submission
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=1`
      );
      const data = await response.json();

      if (data && data.length > 0) {
        const { lat, lon } = data[0];
        const latitude = parseFloat(lat);
        const longitude = parseFloat(lon);

        updateLocation(latitude, longitude);
        setSuggestions([]);

        if (mapRef.current) {
          mapRef.current.leafletElement.setView([latitude, longitude], 15);
        }
      } else {
        setShowToast({ key: "error", label: t("CS_LOCATION_NOT_FOUND") });
      }
    } catch (error) {
      console.error("Error searching location:", error);
      setShowToast({ key: "error", label: t("CS_SEARCH_ERROR") });
    } finally {
      setIsSearching(false);
    }
  };

  const handleLocateMe = () => {
    if (navigator.geolocation) {
      setIsSearching(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          updateLocation(latitude, longitude);
          if (mapRef.current) {
            mapRef.current.leafletElement.setView([latitude, longitude], 15);
          }
          setIsSearching(false);
        },
        (error) => {
          console.error("Error getting location:", error);
          setShowToast({ key: "error", label: t("CS_GEOLOCATION_ERROR") });
          setIsSearching(false);
        }
      );
    } else {
      setShowToast({ key: "error", label: t("CS_GEOLOCATION_NOT_SUPPORTED") });
    }
  };

  const closeToast = () => {
    setShowToast(null);
  };

  const clearSearch = () => {
    setSearchQuery("");
    setAddress("");
    setMarkerPos(null);
    setSuggestions([]);
    setPolygonPoints([]);
  };

  const togglePolygonMode = () => {
    setIsPolygonMode(!isPolygonMode);
    setPolygonPoints([]); // Clear points when toggling
    if (!isPolygonMode) {
      setMarkerPos(null); // Clear marker when entering polygon mode
      setAddress("");
      setSearchQuery("");
    }
  };

  return (
    <div style={{ marginBottom: "24px" }}>
      <CardLabel>{t("CS_ADDCOMPLAINT_SELECT_GEOLOCATION_TEXT")}</CardLabel>

      <div style={{ position: "relative", height: "calc(100vh - 400px)", minHeight: "390px", width: "100%" }}>

        {/* Map Container - Responsible for the curved look */}
        <div style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: "20px",
          overflow: "hidden",
          border: "1px solid #d6d5d4",
          boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
          zIndex: 0
        }}>
          <Map
            ref={mapRef}
            center={coords}
            zoom={markerPos ? 15 : 5}
            style={{ height: "100%", width: "100%" }}
            onClick={handleMapClick}
            zoomControl={false}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {!isPolygonMode && markerPos && (
              <Marker position={markerPos}>
                {address && (
                  <Tooltip permanent direction="top" offset={[0, -30]} opacity={1} className="custom-leaflet-tooltip">
                    <div style={{
                      fontSize: "14px",
                      fontWeight: "600",
                      color: "#0B0C0C",
                      padding: "4px 8px",
                      whiteSpace: "normal",
                      textAlign: "center",
                      minWidth: "150px",
                      maxWidth: "300px"
                    }}>
                      {address}
                    </div>
                  </Tooltip>
                )}
              </Marker>
            )}
            {isPolygonMode && polygonPoints.length > 0 && (
              <Polygon positions={polygonPoints} color="#F47738" />
            )}
          </Map>

          {isSearching && (
            <div style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(255,255,255,0.7)",
              zIndex: 1000,
              display: "flex",
              justifyContent: "center",
              alignItems: "center"
            }}>
              <Loader />
            </div>
          )}
        </div>

        {/* Search Bar Overlay */}
        <div style={{
          position: "absolute",
          top: "20px",
          left: "20px",
          zIndex: 1001,
          width: "calc(100% - 40px)",
          maxWidth: "600px"
        }}>
          <div style={{
            backgroundColor: "white",
            borderRadius: "24px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            display: "flex",
            alignItems: "center",
            padding: "4px 8px 4px 16px",
            height: "48px",
            width: "100%",
            transition: "all 0.3s ease-in-out",
            position: "relative"
          }}>
            <div
              onClick={(e) => handleSearch(e)}
              style={{
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginRight: "8px"
              }}
            >
              <SearchIcon />
            </div>

            <input
              ref={searchInputRef}
              type="text"
              placeholder={isPolygonMode ? t("CS_MODE_POLYGON_DRAWING") : t("CS_COMMON_SEARCH_PLACEHOLDER")}
              value={searchQuery}
              onChange={handleInputChange}
              onKeyPress={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSearch(e);
                }
              }}
              disabled={isPolygonMode}
              style={{
                border: "none",
                outline: "none",
                width: "100%",
                padding: "8px 0",
                fontSize: "16px",
                color: "#0B0C0C",
                backgroundColor: "transparent"
              }}
            />

            {searchQuery && !isPolygonMode && (
              <div
                onClick={clearSearch}
                style={{
                  cursor: "pointer",
                  padding: "8px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#505A5F"
                }}
              >
                <CloseIcon />
              </div>
            )}

            <div style={{ width: "1px", height: "24px", backgroundColor: "#d6d5d4", margin: "0 8px" }}></div>

            <div
              onClick={togglePolygonMode}
              style={{
                cursor: "pointer",
                padding: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: isPolygonMode ? "#F47738" : "#505A5F"
              }}
              title={t("CS_TOGGLE_POLYGON_MODE")}
            >
              <PolygonIcon active={isPolygonMode} />
            </div>
          </div>

          {/* Suggestions Dropdown */}
          {suggestions.length > 0 && !isPolygonMode && (
            <div style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              backgroundColor: "white",
              borderRadius: "8px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              marginTop: "8px",
              maxHeight: "200px",
              overflowY: "auto",
              zIndex: 1002
            }}>
              {suggestions.map((suggestion, index) => (
                <div
                  key={index}
                  onClick={() => handleSuggestionSelect(suggestion)}
                  style={{
                    padding: "12px 16px",
                    cursor: "pointer",
                    borderBottom: index < suggestions.length - 1 ? "1px solid #eee" : "none",
                    fontSize: "14px",
                    color: "#0B0C0C",
                    transition: "background-color 0.2s"
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#f5f5f5"}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "white"}
                >
                  {suggestion.display_name}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Locate Me Button */}
        <div
          onClick={handleLocateMe}
          style={{
            position: "absolute",
            bottom: "30px",
            right: "20px",
            zIndex: 1001,
            backgroundColor: "white",
            padding: "12px",
            borderRadius: "50%",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "transform 0.2s"
          }}
          onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.1)"}
          onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
          title={t("CS_LOCATE_ME")}
        >
          <LocateIcon />
        </div>

      </div>

      {/* Polygon Coordinates Display */}
      {isPolygonMode && polygonPoints.length > 0 && (
        <div style={{ marginTop: "16px", padding: "16px", backgroundColor: "white", borderRadius: "12px", border: "1px solid #d6d5d4" }}>
          <div style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px", color: "#0B0C0C" }}>{t("CS_POLYGON_POINTS")}</div>
          <div style={{ maxHeight: "100px", overflowY: "auto" }}>
            {polygonPoints.map((point, index) => (
              <div key={index} style={{ fontSize: "12px", color: "#505A5F", marginBottom: "4px" }}>
                {t("CS_POINT")} {index + 1}: {point[0].toFixed(6)}, {point[1].toFixed(6)}
              </div>
            ))}
          </div>
        </div>
      )}

      {showToast && (
        <Toast
          error={showToast.key === "error"}
          label={showToast.label}
          onClose={closeToast}
        />
      )}
    </div>
  );
};

export default GeoLocations;
