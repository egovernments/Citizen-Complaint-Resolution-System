-- Keycloak's role and database. Run by keycloak-db.sh only when Keycloak cannot
-- sign in yet. :kcuser and :kcdb are names; the password comes from the
-- environment (\getenv), never from psql's argv.
\getenv kcpw KC_PASSWORD
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'kcuser', :'kcpw')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'kcuser') \gexec
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'kcuser', :'kcpw') \gexec
-- PostgreSQL 16 (and RDS) let a non-superuser create a database owned by a
-- role only while a member of it.
SELECT format('GRANT %I TO CURRENT_USER', :'kcuser') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'kcdb', :'kcuser')
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'kcdb') \gexec
