-- First-boot init: ensure the `keycloak` database exists so the keycloak
-- container has somewhere to land. Postgres runs this exactly once when
-- PGDATA is empty (the /docker-entrypoint-initdb.d/ contract).
--
-- Idempotent guard: SELECT … \gexec only fires the CREATE when the row
-- is missing. If a sibling deploy already created it, this no-ops.
-- Inert when `enable_keycloak: false` — nothing else references the DB.
SELECT 'CREATE DATABASE keycloak'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'keycloak')\gexec
