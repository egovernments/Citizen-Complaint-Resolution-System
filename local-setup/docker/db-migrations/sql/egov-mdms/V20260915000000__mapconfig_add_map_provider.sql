-- Add the map-provider fields to RAINMAKER-PGR.MapConfig (#1994): mapProvider
-- ('leaflet' | 'google') and googleMapsApiKey, which let a tenant draw its maps
-- on Google Maps.
--
-- The schema has additionalProperties: false, so until a box's schema row
-- carries these properties mdms-v2 rejects any MapConfig that sets them. The
-- default-data-handler only seeds schemas that don't exist yet, so an existing
-- box never picks the change up on its own, and mdms-v2 can't update a schema
-- over the API (schema/v1/_update -> HTTP 501) — hence this migration.
--
-- Adds the two properties to every tenant's MapConfig schema that lacks them.
-- Idempotent: a schema that already has mapProvider is left alone, so re-runs
-- and fresh installs (seeded from schema/RAINMAKER-PGR.json, which carries
-- both) are no-ops. V20260715000000's embedded definition plus these two
-- properties equals that JSON file; keep the property text below identical to it.

BEGIN;

UPDATE eg_mdms_schema_definition
   SET definition = jsonb_set(
         definition,
         '{properties}',
         (definition -> 'properties') || $props${"mapProvider":{"type":"string","enum":["leaflet","google"],"description":"Which library draws the maps: leaflet (OpenStreetMap-style tiles, the default) or google (Google Maps; needs googleMapsApiKey). Boundaries and addresses are unaffected - only the map underneath changes."},"googleMapsApiKey":{"type":"string","description":"Google Maps JavaScript API key, used when mapProvider is google. It is sent to every browser that shows a map, so restrict it to the deployment's domain (HTTP referrers) in Google Cloud Console."}}$props$::jsonb
       ),
       lastmodifiedby = 'egov-mdms-migration',
       lastmodifiedtime = (extract(epoch from now()) * 1000)::bigint
 WHERE code = 'RAINMAKER-PGR.MapConfig'
   AND NOT (definition -> 'properties' ? 'mapProvider');

COMMIT;
