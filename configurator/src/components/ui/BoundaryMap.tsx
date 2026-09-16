import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { drawGeoJsonOnGoogleMap } from '@/utils/googleMaps';

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
  /** Draw on Google Maps with this key instead of OpenStreetMap tiles — pass the
   *  tenant's MapConfig provider (useMapProviderConfig().google). */
  google?: { apiKey: string };
}

// Rough bounding-box area of a Polygon/MultiPolygon outer ring(s) — a cheap
// proxy for "how big is this boundary" used only for draw ordering.
function bboxArea(geometry: { type?: string; coordinates?: unknown } | undefined): number {
  if (!geometry || !Array.isArray(geometry.coordinates)) return 0;
  const rings: number[][][] =
    geometry.type === 'MultiPolygon'
      ? (geometry.coordinates as number[][][][]).map((poly) => poly[0])
      : geometry.type === 'Polygon'
        ? [(geometry.coordinates as number[][][])[0]]
        : [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const ring of rings) {
    if (!Array.isArray(ring)) continue;
    for (const pt of ring) {
      if (!Array.isArray(pt) || pt.length < 2) continue;
      minX = Math.min(minX, pt[0]); maxX = Math.max(maxX, pt[0]);
      minY = Math.min(minY, pt[1]); maxY = Math.max(maxY, pt[1]);
    }
  }
  if (minX === Infinity) return 0;
  return (maxX - minX) * (maxY - minY);
}

// Normalise whatever we're handed into a Feature/FeatureCollection L.geoJSON
// accepts. A bare geometry is wrapped in a Feature. For a collection, features
// are sorted largest-area-first so Leaflet draws big containers (e.g. a county)
// BENEATH the smaller boundaries inside them — otherwise the county polygon
// covers its children and every hover/tooltip resolves to the county.
function toGeoJsonLayerInput(data: GeoJsonInput): GeoJSON.GeoJsonObject {
  if (data.type === 'FeatureCollection') {
    const features = [...(data.features as Array<{ geometry?: { type?: string; coordinates?: unknown } }>)].sort(
      (a, b) => bboxArea(b.geometry) - bboxArea(a.geometry),
    );
    return { type: 'FeatureCollection', features } as unknown as GeoJSON.GeoJsonObject;
  }
  if (data.type === 'Feature') {
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
 * Renders one or many boundary geometries, highlighted and auto-fitted to
 * bounds: on OpenStreetMap tiles via vanilla Leaflet (React-version agnostic,
 * no marker-icon bundling — we only draw polygons), or on Google Maps when
 * `google` carries a key. If Google won't load, it falls back to Leaflet and
 * says why. Returns a graceful placeholder when there's no geometry.
 */
export function BoundaryMap({ data, height = '360px', color = '#0b4d2c', className, google }: BoundaryMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Tagged with the key it belongs to, so a changed key never shows a stale error.
  const [googleError, setGoogleError] = useState<{ key: string; message: string } | null>(null);
  const googleKey = google?.apiKey;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !data || !hasCoordinates(data)) return;
    const input = toGeoJsonLayerInput(data);
    let cleanup = () => {};
    let cancelled = false;

    const drawLeaflet = () => {
      const map = L.map(container, { scrollWheelZoom: false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      const layer = L.geoJSON(input, {
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
      cleanup = () => {
        clearTimeout(t);
        map.remove();
      };
    };

    if (googleKey) {
      drawGeoJsonOnGoogleMap(container, input, color, googleKey)
        .then((dispose) => {
          if (cancelled) dispose();
          else cleanup = dispose;
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setGoogleError({ key: googleKey, message: e instanceof Error ? e.message : String(e) });
          drawLeaflet();
        });
    } else {
      drawLeaflet();
    }

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [data, color, googleKey]);

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

  return (
    <div className={className}>
      <div ref={containerRef} style={{ height, borderRadius: 8, overflow: 'hidden' }} />
      {googleError && googleError.key === googleKey && (
        <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
          Google Maps couldn't load ({googleError.message}) — showing OpenStreetMap tiles instead.
        </p>
      )}
    </div>
  );
}

export default BoundaryMap;
