#!/bin/sh
set -e

echo "========================================="
echo "Running DIGIT database migrations"
echo "DB_URL: $DB_URL"
echo "MIGRATION_SERVICES: ${MIGRATION_SERVICES:-all}"
echo "========================================="

# Which steps to run. Space- or comma-separated; "all" (the default) keeps the
# historical behaviour for the standalone stacks that have no per-service
# migrators (docker-compose.db-migrations.yml, docker-compose.registry.yml),
# where this container IS the only migrator and therefore owns every history it
# writes.
#
# The ansible stack is the opposite case: docker-compose.migrations.yml gives
# every one of these services its own migrator, so those histories are written by
# the egovio/*-db images and do NOT match this repo's sql/ trees. Re-running the
# shared steps against them is not a harmless no-op -- it fails validation on a
# checksum mismatch, and with validation disabled it REPLAYS DDL out of order
# against a populated database. For egov-localization and egov-enc-service, whose
# V1 opens with DROP TABLE IF EXISTS, that is the silent data-loss mode
# ../../db/flyway-history-map.yml exists to prevent. That stack sets
# MIGRATION_SERVICES=egov-mdms.
MIGRATION_SERVICES="${MIGRATION_SERVICES:-all}"
_SELECTED=",$(echo "$MIGRATION_SERVICES" | tr ' ' ',' | tr -d '\t'),"

selected() {
    [ "$MIGRATION_SERVICES" = "all" ] && return 0
    case "$_SELECTED" in
        *",$1,"*) return 0 ;;
        *) echo "--- skipping $1 (not in MIGRATION_SERVICES) ---"; return 1 ;;
    esac
}

# Placeholder substitution is OFF. Flyway expands ${...} by default, and the
# egov-mdms data fixes embed JSON inside dollar-quoted strings -- `$def${"type":
# ...}` puts a `$` directly before a `{`, which Flyway reads as an unresolved
# placeholder and refuses to parse ("No value provided for placeholder"). That is
# why V20260715000000__mapconfig_recode_from_colour_key.sql has only ever been
# applied by hand with psql, which does no substitution. No migration here uses
# placeholders, so turning it off costs nothing and makes these scripts runnable
# by the migrator that is supposed to run them.
run_migration() {
    SERVICE=$1
    SCHEMA_TABLE=$2
    LOCATIONS=$3

    echo ""
    echo "--- Migrating: $SERVICE ---"
    echo "Schema table: $SCHEMA_TABLE"
    echo "Locations: $LOCATIONS"

    flyway \
      -url="$DB_URL" \
      -table="$SCHEMA_TABLE" \
      -user="$FLYWAY_USER" \
      -password="$FLYWAY_PASSWORD" \
      -locations="$LOCATIONS" \
      -baselineOnMigrate=true \
      -outOfOrder=true \
      -ignoreMigrationPatterns="*:missing" \
      -placeholderReplacement=false \
      migrate

    echo "--- $SERVICE migrations completed ---"
}

# Run migrations for each service
#
# Table names below MUST match the `canonical` name in
# ../../db/flyway-history-map.yml, not a legacy *_schema_version alias. This
# script and docker-compose.egov-digit.yaml's dedicated per-service migrators
# (docker-compose.migrations.yml) write history for the SAME services — a
# name mismatch here creates a second, unrecognized history table alongside
# the canonical one, which db-history-normalize then aborts on ("ambiguous:
# canonical AND legacy both exist") the next time the canonical migrator
# runs against this database. See db/flyway-history-map.yml's header comment:
# there is deliberately no "embedded migrator" escape hatch from that design,
# and this script is exactly that escape hatch if its names drift.

# Core services - order matters for dependencies
if selected egov-user && [ -d "/flyway/sql/egov-user" ]; then
    run_migration "egov-user" "egov_user_schema" "filesystem:/flyway/sql/egov-user"
fi

if selected egov-idgen && [ -d "/flyway/sql/egov-idgen" ]; then
    run_migration "egov-idgen" "egov_idgen_schema" "filesystem:/flyway/sql/egov-idgen"
fi

if selected egov-localization && [ -d "/flyway/sql/egov-localization" ]; then
    run_migration "egov-localization" "egov_localization_schema" "filesystem:/flyway/sql/egov-localization"
fi

if selected egov-accesscontrol && [ -d "/flyway/sql/egov-accesscontrol" ]; then
    run_migration "egov-accesscontrol" "accesscontrol_schema_version" "filesystem:/flyway/sql/egov-accesscontrol"
fi

if selected egov-filestore && [ -d "/flyway/sql/egov-filestore" ]; then
    run_migration "egov-filestore" "egov_filestore_schema" "filesystem:/flyway/sql/egov-filestore"
fi

if selected egov-data-uploader && [ -d "/flyway/sql/egov-data-uploader" ]; then
    run_migration "egov-data-uploader" "egov_data_uploader_schema_version" "filesystem:/flyway/sql/egov-data-uploader"
fi

# egov-mdms: DATA-ONLY cleanup of mdms-v2 rows (eg_mdms_data /
# eg_mdms_schema_definition). The mdms-v2 service manages those tables' DDL via
# its OWN flyway history (mdms_schema_version); this uses a separate history
# table so the two never touch each other. Runs before the services start, so
# the default-data-handler re-registers any schema this removes.
if selected egov-mdms && [ -d "/flyway/sql/egov-mdms" ]; then
    run_migration "egov-mdms" "egov_mdms_schema_version" "filesystem:/flyway/sql/egov-mdms"
fi

echo ""
echo "========================================="
echo "Migrations completed successfully (${MIGRATION_SERVICES})"
echo "========================================="
