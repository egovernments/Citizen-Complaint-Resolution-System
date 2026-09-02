import L from "leaflet";

// Branded pin shared by every PGR map: theme-primary teardrop with a white
// ring, drawn as an inline SVG divIcon so it needs no asset host and follows
// per-tenant theming (--color-primary-1).
export const brandPin = L.divIcon({
  className: "pgr-map-pin",
  html: `<svg width="36" height="46" viewBox="0 0 36 46" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="18" cy="43" rx="7" ry="2.4" fill="rgba(11,12,12,0.25)"/>
    <path d="M18 1C9.7 1 3 7.7 3 16c0 10.4 12.1 23.2 14.1 25.2a1.3 1.3 0 0 0 1.8 0C20.9 39.2 33 26.4 33 16 33 7.7 26.3 1 18 1Z"
          fill="var(--color-primary-1, var(--color-primary-main, #c84c0e))" stroke="#fff" stroke-width="2"/>
    <circle cx="18" cy="16" r="5.5" fill="#fff"/>
  </svg>`,
  iconSize: [36, 46],
  iconAnchor: [18, 44],
  tooltipAnchor: [0, -40],
});
