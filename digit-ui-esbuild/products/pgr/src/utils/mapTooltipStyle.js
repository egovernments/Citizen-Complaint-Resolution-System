// Glassmorphism styling for the PGR map location tooltips — the permanent
// Leaflet tooltip that shows the reverse-geocoded address on the create-location
// picker (GeoLocations.js, class `custom-leaflet-tooltip`) and the complaint
// details view (ComplaintLocationMap.js, class `pgr-loc-tooltip`).
//
// Before: the tooltip was a solid box sitting on top of the pin that covered the
// pin and the map behind it. This turns it into a translucent frosted-glass
// panel — the map stays visible (blurred) through it and it no longer dominates
// the view. Injected once (idempotent): Leaflet tooltip internals (the panel
// background and the ::before arrow) can't be styled inline, so a stylesheet is
// required. `!important` overrides Leaflet's default `.leaflet-tooltip` box.
//
// Colours are theme-aware: the text uses the app's --color-text-primary and the
// glass tint is a neutral frost that reads on the light CARTO basemap.
const STYLE_ID = "pgr-glass-tooltip-style";

export function injectGlassTooltipStyle() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = `
    .custom-leaflet-tooltip.leaflet-tooltip,
    .pgr-loc-tooltip.leaflet-tooltip {
      background: rgba(255, 255, 255, 0.5) !important;
      -webkit-backdrop-filter: blur(12px) saturate(150%);
      backdrop-filter: blur(12px) saturate(150%);
      border: 1px solid rgba(255, 255, 255, 0.6) !important;
      border-radius: 12px !important;
      box-shadow: 0 6px 22px rgba(16, 24, 40, 0.14) !important;
      color: var(--color-text-primary, #0B0C0C) !important;
      padding: 2px 6px !important;
    }
    /* Keep the inner content legible and inheriting the frosted panel colour */
    .custom-leaflet-tooltip.leaflet-tooltip > div,
    .pgr-loc-tooltip.leaflet-tooltip > div {
      color: var(--color-text-primary, #0B0C0C) !important;
    }
    /* Tint the direction arrow to the glass so it isn't a solid wedge */
    .custom-leaflet-tooltip.leaflet-tooltip-top::before,
    .pgr-loc-tooltip.leaflet-tooltip-top::before {
      border-top-color: rgba(255, 255, 255, 0.5) !important;
    }
    .custom-leaflet-tooltip.leaflet-tooltip-bottom::before,
    .pgr-loc-tooltip.leaflet-tooltip-bottom::before {
      border-bottom-color: rgba(255, 255, 255, 0.5) !important;
    }
    .custom-leaflet-tooltip.leaflet-tooltip-left::before,
    .pgr-loc-tooltip.leaflet-tooltip-left::before {
      border-left-color: rgba(255, 255, 255, 0.5) !important;
    }
    .custom-leaflet-tooltip.leaflet-tooltip-right::before,
    .pgr-loc-tooltip.leaflet-tooltip-right::before {
      border-right-color: rgba(255, 255, 255, 0.5) !important;
    }
  `;
  document.head.appendChild(el);
}
