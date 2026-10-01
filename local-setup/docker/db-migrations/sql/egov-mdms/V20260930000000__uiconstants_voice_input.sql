-- Add the optional VOICE_INPUT flag to RAINMAKER-PGR.UIConstants.
--
-- File a Complaint's voice input reads RAINMAKER-PGR.UIConstants.VOICE_INPUT:
-- unset or true offers the mic, false hides it for the tenant. The schema is
-- additionalProperties:false, so on a tenant whose schema predates the flag,
-- saving VOICE_INPUT (the Configurator's toggle) fails validation with a 400.
--
-- mdms-v2 can't update a schema over the API (schema/v1/_update -> HTTP 501),
-- so the property is added at the DB level, for every tenant's UIConstants
-- schema. No data rows change: the field is optional, and a record without it
-- keeps voice on.
--
-- The property embedded below MUST stay identical to VOICE_INPUT in
-- utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json.
-- When you change one, change the other.
--
-- Idempotent and guarded: a definition that already has VOICE_INPUT is left
-- alone, so a fresh box and a re-run are both no-ops.

BEGIN;

UPDATE eg_mdms_schema_definition
   SET definition = jsonb_set(
         definition,
         '{properties,VOICE_INPUT}',
         $prop${"type": "boolean", "description": "Whether File a Complaint offers voice input (the mic on the description). Unset or true offers it wherever the browser supports speech recognition; false hides it."}$prop$::jsonb,
         true
       ),
       lastmodifiedby = 'egov-mdms-migration',
       lastmodifiedtime = (extract(epoch from now()) * 1000)::bigint
 WHERE code = 'RAINMAKER-PGR.UIConstants'
   AND jsonb_typeof(definition -> 'properties') = 'object'
   AND NOT (definition -> 'properties' ? 'VOICE_INPUT');

COMMIT;
