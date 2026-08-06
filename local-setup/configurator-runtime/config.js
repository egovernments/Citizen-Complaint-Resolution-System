// Runtime deployment config for the configurator SPA — CHECKED-IN PLACEHOLDER.
//
// This file exists so `docker compose up -d` works on a fresh checkout. It is
// the SOURCE of the bind mount declared for the `configurator` service in
// docker-compose.egov-digit.yaml. Docker auto-creates a missing bind-mount
// source as a DIRECTORY, which would shadow the image's own config.js and
// leave a root-owned directory in the working tree — so this must stay tracked.
//
// It deliberately configures NOTHING: every field is blank, so the SPA falls
// through to its build-time values and then its in-code defaults, i.e. exactly
// the behaviour before runtime config existed.
//
// The ansible deploy OVERWRITES this per tenant (templates/configurator-config.js.j2).
// Do not put deployment values here — they would be committed.
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
