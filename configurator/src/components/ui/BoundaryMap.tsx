import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// A GeoJSON geometry (Polygon / MultiPolygon / Point) or a full
// FeatureCollection. boundary-service stores per-boundary `geometry`; the
// overview view passes a FeatureCollection of many boundaries.
type GeoJsonInput =
  | { type: 'FeatureCollection'; features: unknown[] }
  | { type: 'Feature'; geometry: unknown; properties?: unknown }
  | { type: 'Polygon' | 'MultiPolygon' | 'Point'; coordinates: unknown };

interface BoundaryMapProps {
  /** GeoJSON geometry, Feature, or FeatureCollection to highlight. */
  data: GeoJsonInput | null | undefined;
  /** Map container height (CSS value). Defaults to 360px. */
  height?: string;
  /** Highlight fill/stroke colour. Defaults to DIGIT brand green. */
  color?: string;
  className?: string;
}

// Normalise whatever we're handed into a Feature/FeatureCollection L.geoJSON
// accepts. A bare geometry is wrapped in a Feature.
function toGeoJsonLayerInput(data: GeoJsonInput): GeoJSON.GeoJsonObject {
  if (data.type === 'FeatureCollection' || data.type === 'Feature') {
    return data as unknown as GeoJSON.GeoJsonObject;
  }
  return { type: 'Feature', properties: {}, geometry: data } as unknown as GeoJSON.GeoJsonObject;
}

// True when the geometry carries at least one real coordinate. Guards
// against the unit-square / empty placeholders boundary-service emits for
// geometry-less boundaries — no point showing a map of nothing.
function hasCoordinates(data: GeoJsonInput): boolean {
  if (data.type === 'FeatureCollection') return data.features.length > 0;
  if (data.type === 'Feature') {
    const g = (data as { geometry?: { coordinates?: unknown } }).geometry;
    return !!g && Array.isArray(g.coordinates) && g.coordinates.length > 0;
  }
  return Array.isArray(data.coordinates) && data.coordinates.length > 0;
}

/**
 * Renders one or many boundary geometries on an OSM basemap, highlighted and
 * auto-fitted to bounds. Vanilla Leaflet (not react-leaflet) to stay
 * React-version agnostic and avoid the marker-icon bundling dance — we only
 * draw polygons. Returns a graceful placeholder when there's no geometry.
 */
export function BoundaryMap({ data, height = '360px', color = '#0b4d2c', className }: BoundaryMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || !data || !hasCoordinates(data)) return;

    const map = L.map(containerRef.current, { scrollWheelZoom: false });
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const layer = L.geoJSON(toGeoJsonLayerInput(data), {
      style: { color, weight: 2, fillColor: color, fillOpacity: 0.25 },
      pointToLayer: (_feature, latlng) => L.circleMarker(latlng, { radius: 6, color, fillColor: color, fillOpacity: 0.6 }),
      onEachFeature: (feature, lyr) => {
        const props = (feature.properties || {}) as Record<string, unknown>;
        const label = props.name || props.code;
        if (label) lyr.bindTooltip(String(label), { sticky: true });
      },
    }).addTo(map);

    try {
      const bounds = layer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [16, 16] });
      else map.setView([0, 0], 2);
    } catch {
      map.setView([0, 0], 2);
    }

    // Leaflet mis-sizes when the container animates/lays out after mount.
    const t = setTimeout(() => map.invalidateSize(), 100);

    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
    };
  }, [data, color]);

  if (!data || !hasCoordinates(data)) {
    return (
      <div
        className={className}
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f3f4f6',
          color: '#6b7280',
          borderRadius: 8,
          fontSize: 14,
        }}
      >
        No geometry to display on the map.
      </div>
    );
  }

  return <div ref={containerRef} className={className} style={{ height, borderRadius: 8, overflow: 'hidden' }} />;
}

export default BoundaryMap;
