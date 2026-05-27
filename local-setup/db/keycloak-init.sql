-- Create the `keycloak` database used by the Keycloak service. Only runs
-- on Postgres' first-boot init phase (mounted at
-- /docker-entrypoint-initdb.d/). Idempotent: skipped if the DB already
-- exists. Keycloak itself doesn't auto-create its DB, so without this
-- the keycloak container would loop on a connect error.
SELECT 'CREATE DATABASE keycloak'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'keycloak')\gexec
