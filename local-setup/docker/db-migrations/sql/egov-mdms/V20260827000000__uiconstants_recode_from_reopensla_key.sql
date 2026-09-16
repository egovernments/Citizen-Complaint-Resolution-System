-- Re-key RAINMAKER-PGR.UIConstants on a stable `code` so REOPENSLA becomes editable.
--
-- The master shipped with x-unique ["REOPENSLA"] while REOPENSLA was its ONLY
-- property, i.e. the record's single value doubled as its primary key. mdms-v2
-- refuses to update any field listed in x-unique, so every attempt to change the
-- reopen window -- from the configurator, the workbench or curl -- came back
--
--     400 UNIQUE_KEY_UPDATE_ERR "Updating fields defined as unique is not allowed."
--
-- The window was therefore frozen at whatever value the tenant was first seeded
-- with, which is exactly what egovernments/CCRS#1252 asks to be configurable.
-- Same defect, same fix as RAINMAKER-PGR.MapConfig in
-- V20260715000000__mapconfig_recode_from_colour_key.sql: give the record a key of
-- its own and demote the value to an ordinary property.
--
-- mdms-v2 schema CODES are immutable over the API (schema/v1/_create ->
-- DUPLICATE_SCHEMA_CODE, schema/v1/_update -> HTTP 501), so the schema can only
-- be corrected at the DB level. Schema and data must move together: the schema is
-- additionalProperties:false and now requires `code`, so a record without it
-- would fail validation on the operator's next save.
--
-- The definition embedded below MUST stay identical to
-- utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json.
-- When you change one, change the other.
--
-- Idempotent and guarded: it matches only the REOPENSLA-keyed schema shape and
-- code-less records, so a fresh box (seeded from the corrected full-dump.sql) and
-- a re-run are both no-ops.

BEGIN;

-- 1. Keep one record per tenant. Extras are deactivated first so the re-key
--    below cannot collide on (tenantid, schemacode, uniqueidentifier). Both
--    readers take the first row anyway -- MDMSUtils.doFetchReopenWindowMillis
--    reads rows.get(0), useReopenWindow reads data[0] -- so a tenant carrying
--    several active records already has an arbitrary winner.
--
--    Ranks EVERY active record, not just the code-less ones, and prefers a
--    code-bearing row. A tenant that already carries a DEFAULT record AND a
--    stale value-keyed one is the case that matters: ranking only the code-less
--    rows leaves the stale one at rn=1, and step 2 then skips it (a DEFAULT
--    record already exists, so the re-key would violate the PK). The tenant ends
--    up with two active records, one of them invalid against the schema this
--    migration installs -- which 400s on the operator's next save.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenantid
           ORDER BY (data ? 'code') DESC,
                    lastmodifiedtime DESC NULLS LAST,
                    createdtime DESC NULLS LAST
         ) AS rn
  FROM eg_mdms_data
  WHERE schemacode = 'RAINMAKER-PGR.UIConstants'
    AND isactive = true
)
UPDATE eg_mdms_data d
   SET isactive = false
  FROM ranked r
 WHERE d.id = r.id
   AND r.rn > 1;

-- 2. Re-key the surviving record onto DEFAULT, preserving its configured window.
--    The old uniqueidentifier was derived from the value (a bare "432000000" on
--    boxes seeded by the configurator/default-data-handler, a hash of it on
--    dump-seeded boxes), which is precisely what made it unchangeable.
UPDATE eg_mdms_data d
   SET data = d.data || '{"code": "DEFAULT"}'::jsonb,
       uniqueidentifier = 'DEFAULT'
 WHERE d.schemacode = 'RAINMAKER-PGR.UIConstants'
   AND d.isactive = true
   AND NOT (d.data ? 'code')
   AND NOT EXISTS (
     SELECT 1 FROM eg_mdms_data x
      WHERE x.tenantid = d.tenantid
        AND x.schemacode = 'RAINMAKER-PGR.UIConstants'
        AND x.uniqueidentifier = 'DEFAULT'
   );

-- 3. Rewrite the REOPENSLA-keyed schema to the code-keyed definition, in place,
--    for every tenant that has it (tenant_bootstrap copies a source tenant's
--    schemas verbatim, so the broken shape spread to every bootstrapped tenant).
--    Guarded on the rogue x-unique so a corrected schema is left alone.
UPDATE eg_mdms_schema_definition
   SET definition = $def${"type": "object", "title": "PGR UI Constants", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["code", "REOPENSLA"], "x-unique": ["code"], "properties": {"code": {"type": "string", "description": "Record key. The UI surfaces read a single constants record, so use DEFAULT unless you are deliberately keeping several variants."}, "REOPENSLA": {"type": "number", "description": "Milliseconds a resolved or rejected complaint stays reopenable. Shipped default 259200000 (72 hours)."}}, "x-ref-schema": [], "additionalProperties": false}$def$::jsonb,
       description = $desc$PGR UI-facing constants for the tenant. One record per tenant, keyed on code (use DEFAULT); every constant is a property of that single record, not a record of its own.$desc$
 WHERE code = 'RAINMAKER-PGR.UIConstants'
   AND definition -> 'x-unique' @> '["REOPENSLA"]'::jsonb;

-- 4. Register the schema for any tenant that has UIConstants data but no schema
--    row. Deterministic id (md5 of tenant+code) so re-runs don't duplicate.
INSERT INTO eg_mdms_schema_definition
  (id, tenantid, code, description, definition, isactive,
   createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT DISTINCT ON (d.tenantid)
   md5(d.tenantid || ':RAINMAKER-PGR.UIConstants'),
   d.tenantid, 'RAINMAKER-PGR.UIConstants',
   $desc$PGR UI-facing constants for the tenant. One record per tenant, keyed on code (use DEFAULT); every constant is a property of that single record, not a record of its own.$desc$,
   $def${"type": "object", "title": "PGR UI Constants", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["code", "REOPENSLA"], "x-unique": ["code"], "properties": {"code": {"type": "string", "description": "Record key. The UI surfaces read a single constants record, so use DEFAULT unless you are deliberately keeping several variants."}, "REOPENSLA": {"type": "number", "description": "Milliseconds a resolved or rejected complaint stays reopenable. Shipped default 259200000 (72 hours)."}}, "x-ref-schema": [], "additionalProperties": false}$def$::jsonb,
   true, 'egov-mdms-migration', 'egov-mdms-migration',
   (extract(epoch from now()) * 1000)::bigint,
   (extract(epoch from now()) * 1000)::bigint
  FROM eg_mdms_data d
 WHERE d.schemacode = 'RAINMAKER-PGR.UIConstants'
   AND NOT EXISTS (
     SELECT 1 FROM eg_mdms_schema_definition s
      WHERE s.tenantid = d.tenantid AND s.code = 'RAINMAKER-PGR.UIConstants'
   );

-- 5. Move tenants still on the pre-#1252 seed to the shipped 72h default.
--    Deliberately narrow: only the exact 432000000 (5 days) this repo used to
--    seed. That value cannot represent an operator's choice, because until this
--    migration the field could not be edited at all -- every 432000000 in the
--    wild is a leftover seed, not a decision. Any other value is left untouched.
UPDATE eg_mdms_data
   SET data = data || '{"REOPENSLA": 259200000}'::jsonb,
       lastmodifiedby = 'egov-mdms-migration',
       lastmodifiedtime = (extract(epoch from now()) * 1000)::bigint
 WHERE schemacode = 'RAINMAKER-PGR.UIConstants'
   AND isactive = true
   AND (data ->> 'REOPENSLA') = '432000000';

COMMIT;
