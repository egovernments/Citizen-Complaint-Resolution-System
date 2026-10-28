#!/bin/sh
# Keycloak's role and database (helm-identity.md "Before enabling" step 1).
#
# The password never reaches an argv: psql reads it with \getenv from
# KC_PASSWORD, and the sign-in check uses PGPASSWORD. And the plaintext
# CREATE/ALTER ROLE runs only when Keycloak cannot already sign in with
# identity-secrets' keycloak-db-password, i.e. on the first run or after drift,
# so a server logging DDL (RDS log_statement=ddl, exported to CloudWatch) does
# not get the password on every upgrade.
set -eu

if PGUSER="$KC_USER" PGPASSWORD="$KC_PASSWORD" PGDATABASE="$KC_DB" psql -Atqc 'select 1' >/dev/null 2>&1; then
  echo "keycloak role and database present; Keycloak signs in with keycloak-db-password"
  exit 0
fi

psql -v ON_ERROR_STOP=1 -q -v kcuser="$KC_USER" -v kcdb="$KC_DB" -f /scripts/keycloak-db.sql
PGUSER="$KC_USER" PGPASSWORD="$KC_PASSWORD" PGDATABASE="$KC_DB" psql -Atqc 'select 1' >/dev/null
echo "keycloak role and database created or repaired; Keycloak signs in"
