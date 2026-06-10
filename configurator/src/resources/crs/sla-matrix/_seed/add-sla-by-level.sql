-- Patch script: add the optional `slaHoursByLevel` property to the
-- CRS.CategorySLA schema definition for already-registered tenants.
--
-- Run on the target MDMS postgres instance ONLY if the symptom is:
--   POST /mdms-v2/v2/_create/CRS.CategorySLA (or _update) with a
--   `slaHoursByLevel` array in the data → HTTP 400 schema-validation
--   error (additionalProperties: false rejects the unknown property).
--
-- Root cause: the tenant's CRS.CategorySLA schema was registered before
-- `slaHoursByLevel` was added to CRS.json. mdms-v2's schema/v1 API has
-- no _update endpoint, so the schema can't be re-uploaded; this patch
-- adds the property to the definition row in place to match the new
-- shape. Fresh registrations via register_schemas.py already include it.
--
-- Usage:
--   docker exec docker-postgres psql -U egov -d egov -f /tmp/add-sla-by-level.sql
--
-- Safe to re-run; the WHERE clause skips rows that already carry the property.

UPDATE eg_mdms_schema_definition
SET definition = jsonb_set(definition, '{properties,slaHoursByLevel}',
  '{"type":"array","description":"Optional per-escalation-level SLA hours; index = escalation level ([L0, L1, L2, ...]). Each cell is a number (hours) or null (fall through to the next SLA source). NOTE: items is deliberately {} because the egov-mdms-v2 validator throws ClassCastException on JSON-Schema oneOf unions mixing number/null; cell shape and bounds (0 <= n <= 8760) are enforced application-side, same precedent as slaHoursByState additionalProperties: true.","items":{}}'::jsonb)
WHERE code = 'CRS.CategorySLA'
  AND definition->'properties'->'slaHoursByLevel' IS NULL;

SELECT code, definition->'properties'->'slaHoursByLevel' AS sla_hours_by_level
FROM eg_mdms_schema_definition
WHERE code = 'CRS.CategorySLA';
