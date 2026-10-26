-- Keycloak's role and database (helm-identity.md "Before enabling" step 1).
-- Run with psql -v kcuser=... -v kcpw=... -v kcdb=...; every statement is a
-- no-op when its object exists. The password is (re)set to identity-secrets'
-- keycloak-db-password, which this Job never rotates once generated.
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'kcuser', :'kcpw')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'kcuser') \gexec
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'kcuser', :'kcpw') \gexec
-- PostgreSQL 16 (and RDS) let a non-superuser create a database owned by a
-- role only while a member of it.
SELECT format('GRANT %I TO CURRENT_USER', :'kcuser') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'kcdb', :'kcuser')
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'kcdb') \gexec
