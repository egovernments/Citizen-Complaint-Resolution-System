#!/bin/sh
set -e

echo "========================================="
echo "Running DIGIT database migrations"
echo "DB_URL: $DB_URL"
echo "========================================="

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
if [ -d "/flyway/sql/egov-user" ]; then
    run_migration "egov-user" "egov_user_schema" "filesystem:/flyway/sql/egov-user"
fi

if [ -d "/flyway/sql/egov-idgen" ]; then
    run_migration "egov-idgen" "egov_idgen_schema" "filesystem:/flyway/sql/egov-idgen"
fi

if [ -d "/flyway/sql/egov-localization" ]; then
    run_migration "egov-localization" "egov_localization_schema" "filesystem:/flyway/sql/egov-localization"
fi

if [ -d "/flyway/sql/egov-accesscontrol" ]; then
    run_migration "egov-accesscontrol" "accesscontrol_schema_version" "filesystem:/flyway/sql/egov-accesscontrol"
fi

if [ -d "/flyway/sql/egov-filestore" ]; then
    run_migration "egov-filestore" "egov_filestore_schema" "filesystem:/flyway/sql/egov-filestore"
fi

if [ -d "/flyway/sql/egov-data-uploader" ]; then
    run_migration "egov-data-uploader" "egov_data_uploader_schema_version" "filesystem:/flyway/sql/egov-data-uploader"
fi

# egov-mdms: DATA-ONLY cleanup of mdms-v2 rows (eg_mdms_data /
# eg_mdms_schema_definition). The mdms-v2 service manages those tables' DDL via
# its OWN flyway history (mdms_schema_version); this uses a separate history
# table so the two never touch each other. Runs before the services start, so
# the default-data-handler re-registers any schema this removes.
if [ -d "/flyway/sql/egov-mdms" ]; then
    run_migration "egov-mdms" "egov_mdms_schema_version" "filesystem:/flyway/sql/egov-mdms"
fi

echo ""
echo "========================================="
echo "All migrations completed successfully!"
echo "========================================="
