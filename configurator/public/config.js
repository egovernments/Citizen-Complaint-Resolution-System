// Runtime deployment config for the configurator SPA — NEUTRAL DEFAULT.
//
// This copy ships inside the image and in `npm run dev`, and intentionally sets
// nothing: every field falls through to the build-time VITE_* value and then to
// the in-code default, so an unconfigured deployment behaves exactly as it did
// before this file existed.
//
// A real deployment OVERWRITES this file next to the bundle. The ansible deploy
// renders it from host_vars (see local-setup/ansible/templates/
// configurator-config.js.j2) into /var/www/configurator/config.js.
//
// Fields (all optional; blank/absent = fall through):
//   STATE_TENANT_ID        root tenant, e.g. "mz". Pre-fills the login form's
//                          tenant field — the field's VALUE, not a placeholder.
//                          Blank => 'pg' (the tenant the seed dump creates).
//   OVERPASS_URL           Overpass endpoint for the Phase-2 polygon fetch,
//                          e.g. "/overpass/api/interpreter" when self-hosted.
//                          Blank => public overpass-api.de (rate-limited).
//   TURBOPASS_URL          Turbopass suggestions base. Blank => "/turbopass".
//   BOUNDARY_SEARCH_LIMIT  boundary-service page cap. Must be a positive
//                          number — blank, non-numeric or <= 0 => 300.
window.__CONFIGURATOR_CONFIG__ = {
  STATE_TENANT_ID: '',
  OVERPASS_URL: '',
  TURBOPASS_URL: '',
  BOUNDARY_SEARCH_LIMIT: '',
};
