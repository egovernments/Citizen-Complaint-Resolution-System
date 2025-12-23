import React, { useState, useEffect } from "react";
import { Map, TileLayer, Marker, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { CardLabel } from "@egovernments/digit-ui-react-components";
import { useTranslation } from "react-i18next";

// Fix default icon issue in React builds
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.6.0/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.6.0/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.6.0/dist/images/marker-shadow.png",
});

const NavigationIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2L4.5 20.29L5.21 21L12 18L18.79 21L19.5 20.29L12 2Z" fill="white" />
  </svg>
);

const ComplaintLocationMap = ({ latitude, longitude, address }) => {
  const { t } = useTranslation();
  const [fetchedAddress, setFetchedAddress] = useState(null);
  const [isLoadingAddress, setIsLoadingAddress] = useState(false);

  // Fetch address details based on lat/lng using reverse geocoding
  useEffect(() => {
    if (!latitude || !longitude) return;

    const fetchAddressFromCoordinates = async () => {
      setIsLoadingAddress(true);
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`,
          {
            headers: {
              'Accept-Language': 'en'
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

  // If no coordinates provided, don't render the map
  if (!latitude || !longitude) {
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
          <Map
            center={[latitude, longitude]}
            zoom={15}
            style={{ height: "100%", width: "100%" }}
            zoomControl={true}
            dragging={true}
            scrollWheelZoom={false}
            doubleClickZoom={true}
            touchZoom={true}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Marker position={[latitude, longitude]}>
              {displayAddress && (
                <Tooltip permanent direction="top" offset={[0, -30]} opacity={1}>
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
                    {isLoadingAddress ? "Loading address..." : displayAddress}
                  </div>
                </Tooltip>
              )}
            </Marker>
          </Map>

          {/* Open in Google Maps Button */}
          <button
            onClick={handleOpenInGoogleMaps}
            style={{
              position: "absolute",
              bottom: "20px",
              right: "20px",
              zIndex: 999,
              backgroundColor: "#4285F4",
              color: "white",
              padding: "12px 20px",
              borderRadius: "8px",
              border: "none",
              boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "14px",
              fontWeight: "500",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#3367D6";
              e.currentTarget.style.transform = "scale(1.05)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "#4285F4";
              e.currentTarget.style.transform = "scale(1)";
            }}
            title={t("CS_OPEN_IN_GOOGLE_MAPS")}
          >
            <NavigationIcon />
            {t("CS_NAVIGATE")}
          </button>

          {/* Coordinates Info */}
          <div style={{
            position: "absolute",
            bottom: "20px",
            left: "20px",
            zIndex: 999,
            backgroundColor: "white",
            padding: "8px 12px",
            borderRadius: "8px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            fontSize: "12px",
            color: "#505A5F"
          }}>
            <div><strong>Lat:</strong> {latitude.toFixed(6)}</div>
            <div><strong>Lng:</strong> {longitude.toFixed(6)}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ComplaintLocationMap;
