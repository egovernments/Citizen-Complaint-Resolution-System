import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "maplibre-gl/dist/maplibre-gl.css";
import "@maplibre/maplibre-gl-leaflet";

// Apple-inspired palette applied over the base vector style at runtime:
// warm cream land, soft blue water, whisper-green parks. Keyed by layer-id
// substring so it survives style revisions; every set is individually
// guarded — an id that disappears upstream just skips its tint.
const TINTS = [
  { match: /^background$/, prop: "background-color", value: "#F7F4EC" },
  { match: /^water$/, prop: "fill-color", value: "#A9C9E8" },
  { match: /^park$/, prop: "fill-color", value: "#DDEAD5" },
  { match: /^landuse_residential$/, prop: "fill-color", value: "#F1EDE3" },
  { match: /^landcover_(wood|grass)$/, prop: "fill-color", value: "#DCE8D2" },
];

/**
 * Vector basemap rendered by MapLibre GL inside a Leaflet pane
 * (@maplibre/maplibre-gl-leaflet), so every existing Leaflet element —
 * markers, ward GeoJSON, tooltips, controls — keeps working unchanged.
 * Crisp labels at every zoom and smooth scaling are what raster tiles
 * structurally cannot do; this layer is why the map stops looking dated.
 */
const VectorBaseLayer = ({ styleUrl, attribution }) => {
  const map = useMap();

  useEffect(() => {
    if (!styleUrl) return undefined;
    const gl = L.maplibreGL({ style: styleUrl, attribution: attribution || "" });
    gl.addTo(map);

    const ml = gl.getMaplibreMap && gl.getMaplibreMap();
    const applyTints = () => {
      if (!ml) return;
      const layers = (ml.getStyle() && ml.getStyle().layers) || [];
      for (const tint of TINTS) {
        for (const layer of layers) {
          if (!tint.match.test(layer.id)) continue;
          try {
            ml.setPaintProperty(layer.id, tint.prop, tint.value);
          } catch (e) {
            /* layer exists but property shape changed upstream — skip the tint */
          }
        }
      }
    };
    if (ml) {
      ml.on("style.load", applyTints);
      if (ml.isStyleLoaded && ml.isStyleLoaded()) applyTints();
    }

    return () => {
      if (ml) ml.off("style.load", applyTints);
      map.removeLayer(gl);
    };
  }, [map, styleUrl, attribution]);

  return null;
};

export default VectorBaseLayer;
