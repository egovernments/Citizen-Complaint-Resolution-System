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

// /boundary-service/boundary/_search binds its criteria from QUERY params
// only (tenantId + codes are mandatory) and rows carry just code+geometry,
// so geometry has to be fetched per-code in chunks small enough to keep
// the query string sane.
const GEOMETRY_CHUNK_SIZE = 40;

// Resolves the ward-boundary FeatureCollection the complaint maps render
// and resolve pins against. Two-step fetch (mirrors what the
// configurator's boundary.ts does):
//   1. boundary-relationships/_search (query params: tenantId,
//      hierarchyType, includeChildren) → the hierarchy tree. Nodes carry
//      code/boundaryType/children — no name, no geometry.
//   2. boundary/_search (query params: tenantId, codes csv, limit) per
//      chunk of LEAF codes → geometry, joined back by code.
// Falls back to the bundled static Nairobi wards when MAP_TENANT is
// absent, any fetch fails, or every leaf is geometry-less / placeholder.
//
// Returns null while the fetch is in flight — consumers already treat
// null as "use the static fallback for point-in-polygon" and gate the
// <GeoJSON> layer on features.length, so the swap-in re-render keying
// stays exactly as before.
const useTenantBoundaries = () => {
  const [tenantBoundaries, setTenantBoundaries] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const MAP_TENANT = window?.globalConfigs?.getConfig?.("MAP_TENANT") || process.env.REACT_APP_MAP_TENANT;
    if (!MAP_TENANT) {
      console.log("No MAP_TENANT configured, falling back to static Nairobi wards.");
      setTenantBoundaries(keNairobiWardsFallback);
      return undefined;
    }
    const HIERARCHY_TYPE = window?.globalConfigs?.getConfig?.("HIERARCHY_TYPE") || "ADMIN";

    const fetchBoundaries = async () => {
      try {
        // Step 1: full hierarchy tree (codes + parentage only).
        const relResponse = await Digit.CustomService.getResponse({
          url: "/boundary-service/boundary-relationships/_search",
          params: { tenantId: MAP_TENANT, hierarchyType: HIERARCHY_TYPE, includeChildren: true },
          body: {},
          method: "POST",
        });

        // Flatten to {code, boundaryType, parent, depth}, deduping by
        // code (the relationships endpoint can repeat children under
        // their parent in the payload).
        const nodes = [];
        const seen = new Set();
        const walk = (node, parentCode, depth) => {
          if (!node || !node.code) return;
          if (!seen.has(node.code)) {
            seen.add(node.code);
            nodes.push({ code: node.code, boundaryType: node.boundaryType, parent: parentCode, depth });
          }
          (node.children || []).forEach((child) => walk(child, node.code, depth + 1));
        };
        (relResponse?.TenantBoundary || []).forEach((tb) => {
          const roots = Array.isArray(tb?.boundary) ? tb.boundary : tb?.boundary ? [tb.boundary] : [];
          roots.forEach((root) => walk(root, undefined, 0));
        });

        // Leaf level = the deepest depth present in the tree (Ward in a
        // County > Sub-County > Ward hierarchy). Only leaves carry the
        // polygons the map needs.
        const maxDepth = nodes.reduce((max, n) => (n.depth > max ? n.depth : max), -1);
        const leaves = nodes.filter((n) => n.depth === maxDepth);

        // Step 2: geometry per leaf code, chunked.
        const geometryByCode = {};
        for (let i = 0; i < leaves.length; i += GEOMETRY_CHUNK_SIZE) {
          const chunk = leaves.slice(i, i + GEOMETRY_CHUNK_SIZE);
          const entResponse = await Digit.CustomService.getResponse({
            url: "/boundary-service/boundary/_search",
            params: { tenantId: MAP_TENANT, codes: chunk.map((n) => n.code).join(","), limit: 100 },
            body: {},
            method: "POST",
          });
          for (const row of entResponse?.Boundary || []) {
            if (row?.code) geometryByCode[row.code] = row.geometry;
          }
        }

        // Relationships carry no name field; code doubles as the label
        // (consumers tooltip on `name`, localization happens at render
        // via t() where applicable).
        const features = leaves
          .filter((n) => hasRealGeometry(geometryByCode[n.code]))
          .map((n) => ({
            type: "Feature",
            geometry: geometryByCode[n.code],
            properties: { code: n.code, name: n.code, parent_subcounty: n.parent },
          }));

        if (cancelled) return;
        if (features.length > 0) {
          setTenantBoundaries({ type: "FeatureCollection", features });
        } else {
          // Empty tree OR all leaves placeholder → the tenant has no
          // usable geometry; the static fallback at least keeps the
          // Nairobi reference deployment working.
          setTenantBoundaries(keNairobiWardsFallback);
        }
      } catch (e) {
        console.error("Failed to fetch tenant boundaries:", e);
        if (!cancelled) setTenantBoundaries(keNairobiWardsFallback);
      }
    };
    fetchBoundaries();
    return () => {
      cancelled = true;
    };
  }, []);

  return tenantBoundaries;
};

export default useTenantBoundaries;
