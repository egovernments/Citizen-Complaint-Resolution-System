-- Deactivates role-action grants a release revoked, on every tenant in this DIGIT
-- database (#2239). Run on every deploy by ansible/tasks/revoke-role-grants.yml; on
-- another kind of deployment, run it once with psql against the DIGIT database
-- and restart egov-accesscontrol.
--
-- CSR -> action 605, /user/users/_createnovalidate: that endpoint creates a user with
-- whatever roles the caller sends, and every new employee now gets CSR, so the grant
-- would let any of them create a SUPERUSER. The seeds no longer grant it, but seed rows
-- are only ever created, so a database installed from an older dump keeps it.
--
-- Why SQL and not mdms-v2 _update: rows the dump seeded store a hashed
-- uniqueIdentifier, and mdms-v2 refuses to update them (UNIQUE_KEY_UPDATE_ERR).
-- Onboarded workspaces are also handled by pgr-services' BaselineUpgrader.
--
-- Only ever deactivates, only the pairs listed below; idempotent. Prints one
-- "REVOKED <role>-><action> at <tenant>" line per row it changed.
-- egov-accesscontrol caches role-actions (cache.expiry.role.action.minutes, 15 by
-- default): restart it after a change.
WITH revoked AS (
  UPDATE eg_mdms_data
     SET isactive = false,
         lastmodifiedby = 'revoke-role-grants',
         lastmodifiedtime = (extract(epoch FROM now()) * 1000)::bigint
   WHERE schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions'
     AND isactive
     AND (data->>'rolecode', data->>'actionid') IN (('CSR', '605'))
  RETURNING tenantid, data->>'rolecode' AS rolecode, data->>'actionid' AS actionid
)
SELECT 'REVOKED ' || rolecode || '->' || actionid || ' at ' || tenantid FROM revoked ORDER BY tenantid;
