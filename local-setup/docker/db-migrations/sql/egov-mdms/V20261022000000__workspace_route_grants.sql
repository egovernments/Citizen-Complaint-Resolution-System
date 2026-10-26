-- Grant ACCOUNT_ADMIN the configurator's workspace routes on roots that predate them.
--
-- The Configurator calls /pgr-services/v2/onboarding/workspaces/_search,
-- _update and _rename. egov-accesscontrol authorizes them from the root's own
-- ACCESSCONTROL-ACTIONS-TEST and ACCESSCONTROL-ROLEACTIONS rows. A root seeded
-- before v2.20 has none, so ACCOUNT_ADMIN gets AccessDeniedException. New roots
-- get them elsewhere: full-dump.sql for pg, and the MCP root bootstrap's access
-- floor when MCP is on. This covers an existing root on its next deploy, MCP or not.
--
-- The rows are platform-baseline-v1.json's (ids 900000, 900001, 901000), at every
-- tenant that defines the ACCOUNT_ADMIN role. Idempotent and guarded:
--   * an action is added only when the root has no action with that url and none
--     with that id (an unrelated action may already hold the id);
--   * ACCOUNT_ADMIN is granted the root's action for each workspace url, whatever
--     its id (a hand-applied fix may have used a fresh one), unless it already has it.
-- A root already holding the rows, and a re-run, are no-ops.

BEGIN;

WITH routes (id, url) AS (VALUES
       (900000, '/pgr-services/v2/onboarding/workspaces/_search'),
       (900001, '/pgr-services/v2/onboarding/workspaces/_update'),
       (901000, '/pgr-services/v2/onboarding/workspaces/_rename')),
     roots AS (
       SELECT DISTINCT tenantid FROM eg_mdms_data
        WHERE schemacode = 'ACCESSCONTROL-ROLES.roles' AND data ->> 'code' = 'ACCOUNT_ADMIN' AND isactive),
     now_ms (t) AS (SELECT (extract(epoch from now()) * 1000)::bigint)
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'wsr-' || md5(r.tenantid || ':action:' || w.id), r.tenantid, w.id::text, 'ACCESSCONTROL-ACTIONS-TEST.actions-test',
       jsonb_build_object('id', w.id, 'url', w.url, 'name', 'platform-' || w.id, 'displayName', w.url,
                          'orderNumber', 0, 'enabled', true, 'serviceCode', 'PLATFORM', 'path', ''),
       true, 'egov-mdms-migration', 'egov-mdms-migration', now_ms.t, now_ms.t
  FROM roots r CROSS JOIN routes w CROSS JOIN now_ms
 WHERE NOT EXISTS (
         SELECT 1 FROM eg_mdms_data held
          WHERE held.tenantid = r.tenantid AND held.schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test'
            AND (held.data ->> 'url' = w.url OR held.data ->> 'id' = w.id::text))
ON CONFLICT DO NOTHING;

WITH routes (url) AS (VALUES
       ('/pgr-services/v2/onboarding/workspaces/_search'),
       ('/pgr-services/v2/onboarding/workspaces/_update'),
       ('/pgr-services/v2/onboarding/workspaces/_rename')),
     roots AS (
       SELECT DISTINCT tenantid FROM eg_mdms_data
        WHERE schemacode = 'ACCESSCONTROL-ROLES.roles' AND data ->> 'code' = 'ACCOUNT_ADMIN' AND isactive),
     now_ms (t) AS (SELECT (extract(epoch from now()) * 1000)::bigint)
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'wsr-' || md5(a.tenantid || ':roleaction:' || (a.data ->> 'id')), a.tenantid, 'ACCOUNT_ADMIN.' || (a.data ->> 'id'),
       'ACCESSCONTROL-ROLEACTIONS.roleactions',
       jsonb_build_object('rolecode', 'ACCOUNT_ADMIN', 'actionid', (a.data ->> 'id')::bigint, 'actioncode', '',
                          'tenantId', a.tenantid, 'id', (a.data ->> 'id')::bigint),
       true, 'egov-mdms-migration', 'egov-mdms-migration', now_ms.t, now_ms.t
  FROM eg_mdms_data a JOIN roots r ON r.tenantid = a.tenantid CROSS JOIN now_ms
 WHERE a.schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND a.isactive
   AND a.data ->> 'url' IN (SELECT url FROM routes)
   AND a.data ->> 'id' ~ '^[0-9]+$'
   AND NOT EXISTS (
         SELECT 1 FROM eg_mdms_data held
          WHERE held.tenantid = a.tenantid AND held.schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions'
            AND held.data ->> 'rolecode' = 'ACCOUNT_ADMIN' AND held.data ->> 'actionid' = a.data ->> 'id')
ON CONFLICT DO NOTHING;

COMMIT;
