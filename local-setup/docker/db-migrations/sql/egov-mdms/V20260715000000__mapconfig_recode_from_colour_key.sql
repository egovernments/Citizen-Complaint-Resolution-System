-- Retire the colour-keyed RAINMAKER-PGR.MapConfig master and register the
-- code-keyed one, re-keying its data.
--
-- Some boxes carry a hand-registered MapConfig schema whose x-unique is
-- ["wardHighlightColor"] with that colour as its ONLY property (it then spread
-- to every bootstrapped tenant, since tenant_bootstrap copies a source tenant's
-- schemas verbatim). Keying a record on its own ward colour means changing the
-- colour changes the record's identity: an update leaves the key contradicting
-- the data, and a create mints a second record -- and the UI reads
-- MapConfig[0], so which one wins becomes arbitrary.
--
-- The replacement master keys on a stable `code` and carries the full map
-- config. mdms-v2 schema CODES are immutable over the API (schema/v1/_create ->
-- DUPLICATE_SCHEMA_CODE, schema/v1/_update -> HTTP 501), so the schema can only
-- be corrected at the DB level. This migration does it directly rather than
-- deleting the row and hoping the default-data-handler re-registers it: it
-- rewrites the definition in place for every tenant that has the rogue shape,
-- and registers the schema for any tenant that has MapConfig data but no schema
-- row. A fresh install (no rogue schema, no data) is untouched -- the
-- default-data-handler seeds the same definition from
-- utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json.
--
-- The definition embedded below MUST stay identical to that JSON file. When you
-- change one, change the other.
--
-- Idempotent and guarded: it matches only the rogue colour-keyed shape and the
-- legacy code-less record, so re-runs and correct boxes are no-ops.

BEGIN;

-- 1. Preserve the operator's configured colour by re-keying the legacy record
--    (data with no `code`, hence keyed on the colour) to the stable DEFAULT key,
--    BEFORE touching the schema. Deleting it instead would silently revert a
--    deliberately-themed map (e.g. Bomet's #22394D) to the default orange.
--    Keep one record per tenant: deactivate extras first so the re-key can't
--    collide on the (tenantid, schemacode, uniqueidentifier) PK.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenantid
           ORDER BY lastmodifiedtime DESC NULLS LAST, createdtime DESC NULLS LAST
         ) AS rn
  FROM eg_mdms_data
  WHERE schemacode = 'RAINMAKER-PGR.MapConfig'
    AND isactive = true
    AND NOT (data ? 'code')
)
UPDATE eg_mdms_data d
   SET isactive = false
  FROM ranked r
 WHERE d.id = r.id
   AND r.rn > 1;

UPDATE eg_mdms_data d
   SET data = d.data || '{"code": "DEFAULT"}'::jsonb,
       uniqueidentifier = 'DEFAULT'
 WHERE d.schemacode = 'RAINMAKER-PGR.MapConfig'
   AND d.isactive = true
   AND NOT (d.data ? 'code')
   AND NOT EXISTS (
     SELECT 1 FROM eg_mdms_data x
      WHERE x.tenantid = d.tenantid
        AND x.schemacode = 'RAINMAKER-PGR.MapConfig'
        AND x.uniqueidentifier = 'DEFAULT'
   );

-- 2. Rewrite the rogue colour-keyed schema to the correct code-keyed definition,
--    in place, for every tenant that has it. Guarded to the colour-keyed shape
--    so a schema that is already correct is left alone.
UPDATE eg_mdms_schema_definition
   SET definition = $def${"type":"object","title":"PGR Map Config","$schema":"http://json-schema.org/draft-07/schema#","required":["code"],"x-unique":["code"],"properties":{"code":{"type":"string","description":"Record key. The map surfaces read a single config, so use \"DEFAULT\" unless you are deliberately keeping several variants."},"baseMapTheme":{"type":"string","enum":["voyager","light","dark","osm"],"description":"Named base-tile preset. Ignored when tileUrl is set. Defaults to voyager."},"tileUrl":{"type":"string","description":"Raw Leaflet tile-URL template ({s}/{z}/{x}/{y}). Overrides baseMapTheme, letting an operator point at any tile provider."},"tileAttribution":{"type":"string","description":"HTML attribution paired with a raw tileUrl. Named presets carry their own."},"wardHighlightColor":{"type":"string","pattern":"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$","description":"Hex colour for the ward overlay fill/outline. Defaults to #FFA74F."},"center":{"type":"object","properties":{"lat":{"type":"number","minimum":-90,"maximum":90,"description":"Latitude the map opens at."},"lng":{"type":"number","minimum":-180,"maximum":180,"description":"Longitude the map opens at."}},"required":["lat","lng"],"additionalProperties":false,"description":"Where the map opens when there is no GPS fix and no complaint location. Replaces the deploy-time globalConfigs MAP_CENTER."},"defaultZoom":{"type":"integer","minimum":0,"maximum":22,"description":"Zoom level the map opens at once a location is known. Defaults to 13 (neighbourhood level)."},"minZoom":{"type":"integer","minimum":0,"maximum":22,"description":"Furthest the citizen can zoom out."},"maxZoom":{"type":"integer","minimum":0,"maximum":22,"description":"Closest the citizen can zoom in."},"boundaryTenantId":{"type":"string","description":"Tenant whose boundary tree supplies the ward polygons. Replaces the deploy-time globalConfigs MAP_TENANT. No overlay is drawn when this resolves to nothing."},"geocodeCountryCodes":{"type":"string","description":"Comma-separated ISO country codes the address search is restricted to, e.g. \"ke\". Left unset, the search is worldwide."},"searchViewbox":{"type":"object","properties":{"minLon":{"type":"number","minimum":-180,"maximum":180,"description":"West edge."},"minLat":{"type":"number","minimum":-90,"maximum":90,"description":"South edge."},"maxLon":{"type":"number","minimum":-180,"maximum":180,"description":"East edge."},"maxLat":{"type":"number","minimum":-90,"maximum":90,"description":"North edge."}},"required":["minLon","minLat","maxLon","maxLat"],"additionalProperties":false,"description":"Bounding box the address search is confined to. Results outside it are discarded, so an incorrect box silently hides every valid address \u2014 leave unset unless the box genuinely covers the service area."}},"x-ref-schema":[],"additionalProperties":false}$def$::jsonb,
       description = $desc$Map tooling and starting map position for the tenant's PGR maps. Every field is optional; the UI resolves each one MDMS -> globalConfigs -> built-in default, so a partial record only overrides what it sets.$desc$
 WHERE code = 'RAINMAKER-PGR.MapConfig'
   AND definition -> 'x-unique' @> '["wardHighlightColor"]'::jsonb;

-- 3. Register the schema for any tenant that has a MapConfig data record but no
--    schema row (e.g. the schema was removed, or data was seeded without one).
--    Deterministic id (md5 of tenant+code) so re-runs don't create duplicates.
INSERT INTO eg_mdms_schema_definition
  (id, tenantid, code, description, definition, isactive,
   createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT DISTINCT ON (d.tenantid)
   md5(d.tenantid || ':RAINMAKER-PGR.MapConfig'),
   d.tenantid, 'RAINMAKER-PGR.MapConfig',
   $desc$Map tooling and starting map position for the tenant's PGR maps. Every field is optional; the UI resolves each one MDMS -> globalConfigs -> built-in default, so a partial record only overrides what it sets.$desc$,
   $def${"type":"object","title":"PGR Map Config","$schema":"http://json-schema.org/draft-07/schema#","required":["code"],"x-unique":["code"],"properties":{"code":{"type":"string","description":"Record key. The map surfaces read a single config, so use \"DEFAULT\" unless you are deliberately keeping several variants."},"baseMapTheme":{"type":"string","enum":["voyager","light","dark","osm"],"description":"Named base-tile preset. Ignored when tileUrl is set. Defaults to voyager."},"tileUrl":{"type":"string","description":"Raw Leaflet tile-URL template ({s}/{z}/{x}/{y}). Overrides baseMapTheme, letting an operator point at any tile provider."},"tileAttribution":{"type":"string","description":"HTML attribution paired with a raw tileUrl. Named presets carry their own."},"wardHighlightColor":{"type":"string","pattern":"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$","description":"Hex colour for the ward overlay fill/outline. Defaults to #FFA74F."},"center":{"type":"object","properties":{"lat":{"type":"number","minimum":-90,"maximum":90,"description":"Latitude the map opens at."},"lng":{"type":"number","minimum":-180,"maximum":180,"description":"Longitude the map opens at."}},"required":["lat","lng"],"additionalProperties":false,"description":"Where the map opens when there is no GPS fix and no complaint location. Replaces the deploy-time globalConfigs MAP_CENTER."},"defaultZoom":{"type":"integer","minimum":0,"maximum":22,"description":"Zoom level the map opens at once a location is known. Defaults to 13 (neighbourhood level)."},"minZoom":{"type":"integer","minimum":0,"maximum":22,"description":"Furthest the citizen can zoom out."},"maxZoom":{"type":"integer","minimum":0,"maximum":22,"description":"Closest the citizen can zoom in."},"boundaryTenantId":{"type":"string","description":"Tenant whose boundary tree supplies the ward polygons. Replaces the deploy-time globalConfigs MAP_TENANT. No overlay is drawn when this resolves to nothing."},"geocodeCountryCodes":{"type":"string","description":"Comma-separated ISO country codes the address search is restricted to, e.g. \"ke\". Left unset, the search is worldwide."},"searchViewbox":{"type":"object","properties":{"minLon":{"type":"number","minimum":-180,"maximum":180,"description":"West edge."},"minLat":{"type":"number","minimum":-90,"maximum":90,"description":"South edge."},"maxLon":{"type":"number","minimum":-180,"maximum":180,"description":"East edge."},"maxLat":{"type":"number","minimum":-90,"maximum":90,"description":"North edge."}},"required":["minLon","minLat","maxLon","maxLat"],"additionalProperties":false,"description":"Bounding box the address search is confined to. Results outside it are discarded, so an incorrect box silently hides every valid address \u2014 leave unset unless the box genuinely covers the service area."}},"x-ref-schema":[],"additionalProperties":false}$def$::jsonb,
   true, 'egov-mdms-migration', 'egov-mdms-migration',
   (extract(epoch from now()) * 1000)::bigint,
   (extract(epoch from now()) * 1000)::bigint
  FROM eg_mdms_data d
 WHERE d.schemacode = 'RAINMAKER-PGR.MapConfig'
   AND NOT EXISTS (
     SELECT 1 FROM eg_mdms_schema_definition s
      WHERE s.tenantid = d.tenantid AND s.code = 'RAINMAKER-PGR.MapConfig'
   );

COMMIT;
