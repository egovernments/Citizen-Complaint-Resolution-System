-- Retire the colour-keyed RAINMAKER-PGR.MapConfig master and re-key its data.
--
-- Some boxes carry a hand-registered MapConfig schema whose x-unique is
-- ["wardHighlightColor"] with that colour as its ONLY property (it then spread
-- to every bootstrapped tenant, since tenant_bootstrap copies a source tenant's
-- schemas verbatim). Keying a record on its own ward colour means changing the
-- colour changes the record's identity: an update leaves the key contradicting
-- the data, and a create mints a second record — and the UI reads MapConfig[0],
-- so which one wins becomes arbitrary.
--
-- The replacement master (utilities/default-data-handler/.../schema/RAINMAKER-PGR.json)
-- keys on a stable `code` and carries the full map config. But mdms-v2 schema
-- CODES are immutable — schema/v1/_create on an existing code returns
-- DUPLICATE_SCHEMA_CODE and schema/v1/_update returns HTTP 501 — so the rogue
-- schema can only be removed at the DB level, which is what this does. The
-- default-data-handler then re-registers the correct definition at startup;
-- keeping the definition itself in one place (DDH's JSON) rather than
-- duplicating it here.
--
-- Idempotent and safe on a fresh install: the guards match only the rogue
-- colour-keyed shape and the legacy code-less record, so a box that already has
-- the correct schema (or no MapConfig at all) is untouched and this is a no-op.

BEGIN;

-- 1. Preserve the operator's configured colour by re-keying the legacy record
--    (data with no `code`, hence keyed on the colour) to the stable DEFAULT key,
--    BEFORE dropping the schema. Deleting it instead would silently revert a
--    deliberately-themed map (e.g. Bomet's #22394D) to the default orange.
--
--    Keep one record per tenant: deactivate any extra legacy rows first so the
--    re-key can't collide on the (tenantid, schemacode, uniqueidentifier) PK and
--    so MapConfig[0] stays deterministic.
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
   -- Never clobber an existing DEFAULT-keyed record for the same tenant.
   AND NOT EXISTS (
     SELECT 1 FROM eg_mdms_data x
      WHERE x.tenantid = d.tenantid
        AND x.schemacode = 'RAINMAKER-PGR.MapConfig'
        AND x.uniqueidentifier = 'DEFAULT'
   );

-- 2. Drop the rogue schema so the default-data-handler can register the correct
--    (code-keyed) definition. Guarded to the colour-keyed shape: a schema whose
--    x-unique is already ["code"] is left alone, making re-runs and fresh
--    installs no-ops.
DELETE FROM eg_mdms_schema_definition
 WHERE code = 'RAINMAKER-PGR.MapConfig'
   AND definition -> 'x-unique' @> '["wardHighlightColor"]'::jsonb;

COMMIT;
