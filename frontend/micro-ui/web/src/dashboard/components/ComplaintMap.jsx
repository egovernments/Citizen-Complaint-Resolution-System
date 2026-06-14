import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Bomet town — the map opens centred here regardless of pin spread.
const BOMET_CENTER = [-0.7833, 35.3416];
const DEFAULT_ZOOM = 12;

function createPopupContent(pin) {
  const root = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = pin.serviceCode || "Complaint";
  root.appendChild(title);
  if (pin.status) {
    root.appendChild(document.createElement("br"));
    root.appendChild(document.createTextNode(pin.status));
  }
  if (pin.count > 1) {
    root.appendChild(document.createElement("br"));
    root.appendChild(document.createTextNode(`${pin.count} complaints`));
  }
  return root;
}

/**
 * Complaint location map. One circle marker per complaint location
 * ({ lat, lng, count, serviceCode, status }), centred on Bomet.
 * Uses plain Leaflet (circleMarker = SVG, no icon assets) for renderer stability.
 */
export default function ComplaintMap({ pins = [] }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  // init once
  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, { scrollWheelZoom: false }).setView(
      BOMET_CENTER,
      DEFAULT_ZOOM
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    // grid cell may size after mount — settle the tiles
    setTimeout(() => map.invalidateSize(), 150);
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // (re)draw pins
  useEffect(() => {
    const layer = layerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    layer.clearLayers();
    pins.forEach((p) => {
      L.circleMarker([p.lat, p.lng], {
        radius: 6,
        color: "#0d9488",
        weight: 1,
        fillColor: "#0d9488",
        fillOpacity: 0.65,
      })
        .bindPopup(createPopupContent(p))
        .addTo(layer);
    });
    map.invalidateSize();
  }, [pins]);

  return (
    <div
      ref={elRef}
      className="tw-h-full tw-w-full tw-rounded"
      style={{ minHeight: 220 }}
    />
  );
}
