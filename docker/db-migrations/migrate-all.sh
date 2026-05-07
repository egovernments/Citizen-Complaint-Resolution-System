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
# Each service has its own schema_version table to track migrations independently

# Core services - order matters for dependencies
if [ -d "/flyway/sql/egov-user" ]; then
    run_migration "egov-user" "egov_user_schema_version" "filesystem:/flyway/sql/egov-user"
fi

if [ -d "/flyway/sql/egov-idgen" ]; then
    run_migration "egov-idgen" "egov_idgen_schema_version" "filesystem:/flyway/sql/egov-idgen"
fi

if [ -d "/flyway/sql/egov-localization" ]; then
    run_migration "egov-localization" "egov_localization_schema_version" "filesystem:/flyway/sql/egov-localization"
fi

if [ -d "/flyway/sql/egov-accesscontrol" ]; then
    run_migration "egov-accesscontrol" "egov_accesscontrol_schema_version" "filesystem:/flyway/sql/egov-accesscontrol"
fi

if [ -d "/flyway/sql/egov-filestore" ]; then
    run_migration "egov-filestore" "egov_filestore_schema_version" "filesystem:/flyway/sql/egov-filestore"
fi

if [ -d "/flyway/sql/egov-data-uploader" ]; then
    run_migration "egov-data-uploader" "egov_data_uploader_schema_version" "filesystem:/flyway/sql/egov-data-uploader"
fi

echo ""
echo "========================================="
echo "All migrations completed successfully!"
echo "========================================="
