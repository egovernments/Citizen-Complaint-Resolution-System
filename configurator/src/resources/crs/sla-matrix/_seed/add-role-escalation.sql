-- Patch script: add the optional `roleEscalation` property to the
-- CRS.EscalationPolicy schema definition for already-registered tenants.
--
-- Run on the target MDMS postgres instance ONLY if the symptom is:
--   POST /mdms-v2/v2/_create/CRS.EscalationPolicy (or _update) with a
--   `roleEscalation` object in the data → HTTP 400 schema-validation
--   error (additionalProperties: false rejects the unknown property).
--
-- Root cause: the tenant's CRS.EscalationPolicy schema was registered
-- before `roleEscalation` was added to CRS.json. mdms-v2's schema/v1 API
-- has no _update endpoint, so the schema can't be re-uploaded; this patch
-- adds the property to the definition row in place to match the new
-- shape. Fresh registrations via register_schemas.py already include it.
-- CRS.RoleSupervisors is a NEW schema (not a patch) — it is registered
-- via the schema/v1 API at deploy time; no SQL needed for it.
--
-- Usage:
--   docker exec docker-postgres psql -U egov -d egov -f /tmp/add-role-escalation.sql
--
-- Safe to re-run; the WHERE clause skips rows that already carry the property.

UPDATE eg_mdms_schema_definition
SET definition = jsonb_set(definition, '{properties,roleEscalation}',
  '{"type":"object","description":"Opt-in role-level escalation (PRD primary journey). enabled gates everything; actingRoleByState maps each watched workflow state to the role that owes action; supervisorRoleByRole is the role ladder for R2 resolution; maxPerScan caps role-escalations per scan (default 10 when absent).","properties":{"enabled":{"type":"boolean"},"actingRoleByState":{"type":"object","additionalProperties":{"type":"string"}},"supervisorRoleByRole":{"type":"object","additionalProperties":{"type":"string"}},"maxPerScan":{"type":"integer","minimum":1,"maximum":100}},"additionalProperties":false}'::jsonb)
WHERE code = 'CRS.EscalationPolicy'
  AND definition->'properties'->'roleEscalation' IS NULL;

SELECT code, definition->'properties'->'roleEscalation' AS role_escalation
FROM eg_mdms_schema_definition
WHERE code = 'CRS.EscalationPolicy';
