-- Recovery script: fix CRS.* schemas whose `x-ref-schema` was registered as {}
-- instead of [], causing mdms-v2 _create to throw ClassCastException.
--
-- Run on the target MDMS postgres instance ONLY if the symptom is:
--   POST /mdms-v2/v2/_create/CRS.* → HTTP 400 ClassCastException
--   (org.json.JSONObject cannot be cast to org.json.JSONArray)
--   thrown at MdmsDataValidator.validateReference:140
--
-- Root cause: an earlier version of CRS.json registered x-ref-schema as {}.
-- schema/v1 has no _update endpoint, so the schema can't be re-uploaded.
-- This patch flips the bad rows to the correct shape ([]) in place.
--
-- Usage:
--   docker exec docker-postgres psql -U egov -d egov -f /tmp/fix-xref-schema.sql
--
-- Safe to re-run; the WHERE clause skips already-fixed rows.

UPDATE eg_mdms_schema_definition
SET definition = jsonb_set(definition, '{x-ref-schema}', '[]'::jsonb)
WHERE code LIKE 'CRS.%'
  AND definition->'x-ref-schema' = '{}'::jsonb;

SELECT code, jsonb_typeof(definition->'x-ref-schema') AS x_ref_type
FROM eg_mdms_schema_definition
WHERE code LIKE 'CRS.%';

-- 2026-06-09 follow-up: drop path enum on CRS.CategorySLA
--
-- Symptom: POST /mdms-v2/v2/_create/CRS.CategorySLA with path != "IGE"/"IGSAE"
-- → HTTP 400 schema-validation error (path must be one of [IGE, IGSAE]).
--
-- Root cause: the initial CRS.CategorySLA schema baked in a Mozambique-specific
-- path enum. The schema has been corrected upstream (CRS.json) but mdms-v2's
-- schema/v1 API has no _update endpoint, so we patch the definition row
-- in place to match the new generic shape.
--
-- Safe to re-run; the WHERE clause skips rows that no longer carry an enum.

UPDATE eg_mdms_schema_definition
SET definition = jsonb_set(definition, '{properties,path}',
  '{"type":"string","minLength":1,"description":"Tenant-defined routing path; opaque to the scheduler."}'::jsonb)
WHERE code = 'CRS.CategorySLA'
  AND definition->'properties'->'path'->'enum' IS NOT NULL;

SELECT code, definition->'properties'->'path' AS path_property
FROM eg_mdms_schema_definition
WHERE code = 'CRS.CategorySLA';
