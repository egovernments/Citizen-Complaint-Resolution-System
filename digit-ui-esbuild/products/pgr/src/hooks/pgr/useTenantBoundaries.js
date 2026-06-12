import { useState, useEffect } from "react";
import keNairobiWardsFallback from "../../assets/boundaries/ke_nairobi_wards.json";

// boundary-service historically returns a unit-square placeholder polygon
// for boundaries created without real geometry (XLSX onboarding with no
// lat/long, pre-#621 seeds). Rendering those paints meaningless specks on
// the map and — worse — lets point-in-polygon "resolve" a ward nowhere
// near the pin. Detect them cheaply: a single ring of <= 5 points whose
// bounding box spans less than ~0.001° (≈ 100 m) on both axes is treated
// as geometry-less.
const DEGENERATE_SPAN_DEG = 0.001;

const isDegenerateRing = (ring) => {
  if (!Array.isArray(ring) || ring.length === 0) return true;
  if (ring.length > 5) return false;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const pt of ring) {
    if (!Array.isArray(pt) || pt.length < 2) return true; // malformed → treat as placeholder
    if (pt[0] < minX) minX = pt[0];
    if (pt[0] > maxX) maxX = pt[0];
    if (pt[1] < minY) minY = pt[1];
    if (pt[1] > maxY) maxY = pt[1];
  }
  return maxX - minX < DEGENERATE_SPAN_DEG && maxY - minY < DEGENERATE_SPAN_DEG;
};

// Only Polygon / MultiPolygon are renderable as ward areas; anything else
// (missing geometry, Point centroids, placeholder squares) is dropped.
const hasRealGeometry = (geometry) => {
  if (!geometry || !Array.isArray(geometry.coordinates)) return false;
  if (geometry.type === "Polygon") {
    return geometry.coordinates.length > 0 && !isDegenerateRing(geometry.coordinates[0]);
  }
  if (geometry.type === "MultiPolygon") {
    // Real if at least one member polygon's outer ring is non-degenerate.
    return geometry.coordinates.some(
      (poly) => Array.isArray(poly) && poly.length > 0 && !isDegenerateRing(poly[0])
    );
  }
  return false;
};

// Resolves the ward-boundary FeatureCollection the complaint maps render
// and resolve pins against. Fetches the tenant's ADMIN hierarchy from
// boundary-service when MAP_TENANT is configured (globalConfigs first,
// build-time env second); falls back to the bundled static Nairobi wards
// when MAP_TENANT is absent, the fetch fails, or every returned row is
// geometry-less / placeholder.
//
// Returns null while the fetch is in flight — consumers already treat
// null as "use the static fallback for point-in-polygon" and gate the
// <GeoJSON> layer on features.length, so the swap-in re-render keying
// stays exactly as before.
const useTenantBoundaries = () => {
  const [tenantBoundaries, setTenantBoundaries] = useState(null);

  useEffect(() => {
    const MAP_TENANT = window?.globalConfigs?.getConfig?.("MAP_TENANT") || process.env.REACT_APP_MAP_TENANT;
    if (!MAP_TENANT) {
      console.log("No MAP_TENANT configured, falling back to static Nairobi wards.");
      setTenantBoundaries(keNairobiWardsFallback);
      return;
    }

    const fetchBoundaries = async () => {
      try {
        const response = await Digit.CustomService.getResponse({
          url: "/boundary-service/boundary/_search",
          params: {},
          body: {
            Boundary: { tenantId: MAP_TENANT, hierarchyType: "ADMIN" }
          },
          method: "POST"
        });

        const features = (response?.Boundary || [])
          .filter((b) => hasRealGeometry(b.geometry))
          .map((b) => ({
            type: "Feature",
            geometry: b.geometry,
            properties: { code: b.code, name: b.name, parent_subcounty: b.parent }
          }));

        if (features.length > 0) {
          setTenantBoundaries({ type: "FeatureCollection", features });
        } else {
          // Empty result OR all rows placeholder → the tenant has no
          // usable geometry; the static fallback at least keeps the
          // Nairobi reference deployment working.
          setTenantBoundaries(keNairobiWardsFallback);
        }
      } catch (e) {
        console.error("Failed to fetch tenant boundaries:", e);
        setTenantBoundaries(keNairobiWardsFallback);
      }
    };
    fetchBoundaries();
  }, []);

  return tenantBoundaries;
};

export default useTenantBoundaries;
