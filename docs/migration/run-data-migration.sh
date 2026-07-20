#!/usr/bin/env bash
# run-data-migration.sh — one-shot DATA migration for the 2-level -> N-level
# complaint hierarchy. Does, in order:
#   0. log in ONCE (token reused by every step — avoids repeated-login 400s)
#   1. install the ComplaintHierarchy MDMS schemas (install-schemas.cjs)
#   2. apply the x-ref-schema [] -> {} jsonb fix
#   3. migrate each tenant, SCOPED to its own types (no state-junk leakage)
#   4. verify row counts
#
# It deliberately does NOT deploy pgr-services / frontends or delete the old
# masters — that cutover is environment-specific, lockstep, and needs a human
# verify checkpoint (see docs/migration/complaint-type-2level-to-Nlevel.md §8).
#
# Usage (local):
#   BASE_URL=http://localhost:18000 \
#   TENANTS="ke ke.ige" \
#   PSQL="docker exec docker-postgres psql -U egov -d egov" \
#     bash docs/migration/run-data-migration.sh
#
# Auth: OAUTH_USER/OAUTH_PASS (default ADMIN/eGov@123) or TOKEN=<authToken>.
# On a server: point BASE_URL at the gateway and PSQL at your MDMS DB.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
: "${BASE_URL:?set BASE_URL (e.g. http://localhost:18000)}"
: "${TENANTS:?set TENANTS, space-separated (e.g. \"ke ke.ige\")}"
PSQL="${PSQL:-docker exec docker-postgres psql -U egov -d egov}"
export BASE_URL

# Capture the tenant list, then UNSET TENANTS so the per-tenant node calls below
# (which set TENANT/STATE_TENANT for SCOPED migration) are not overridden by
# migrate.cjs's own TENANTS handling, which takes precedence and runs union mode.
LIST="$TENANTS"; unset TENANTS
FIRST="$(echo "$LIST" | awk '{print $1}')"
STATE_ROOT="$(echo "$FIRST" | cut -d. -f1)"

echo "============================================================"
echo " DATA MIGRATION  base=$BASE_URL  tenants=[$LIST]  (scoped)"
echo "============================================================"

echo ""
echo "== 0/4  login once (reused by all steps) =="
if [ -z "${TOKEN:-}" ]; then
  TOKEN="$(curl -s "$BASE_URL/user/oauth/token" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    -u "${OAUTH_BASIC:-egov-user-client:}" \
    -d "username=${OAUTH_USER:-ADMIN}&password=${OAUTH_PASS:-eGov@123}&grant_type=password&scope=read&userType=EMPLOYEE&tenantId=${STATE_ROOT}" \
    | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)"
  [ -n "$TOKEN" ] || { echo "ERROR: login failed (state tenant=$STATE_ROOT). Set TOKEN or check OAUTH_*."; exit 2; }
fi
export TOKEN
echo "  token: ${TOKEN:0:12}..."

echo ""
echo "== 1/4  install ComplaintHierarchy schemas =="
TENANT="$FIRST" node "$HERE/install-schemas.cjs"

echo ""
echo "== 2/4  x-ref-schema jsonb fix (create may persist [] as {}) =="
$PSQL -c "UPDATE eg_mdms_schema_definition
     SET definition = jsonb_set(definition,'{x-ref-schema}','[]'::jsonb)
   WHERE code IN ('RAINMAKER-PGR.ComplaintHierarchy','RAINMAKER-PGR.ComplaintHierarchyDefinition')
     AND jsonb_typeof(definition->'x-ref-schema')='object';"

echo ""
echo "== 3/4  migrate each tenant (scoped to its own types) =="
for t in $LIST; do
  echo "------------------------------------------------------------"
  echo "  migrating: $t  (scoped)"
  echo "------------------------------------------------------------"
  TENANT="$t" STATE_TENANT="$t" node "$HERE/migrate.cjs"
done

echo ""
echo "== 4/4  verify =="
$PSQL -tAc "SELECT tenantid, count(*) FROM eg_mdms_data
            WHERE schemacode='RAINMAKER-PGR.ComplaintHierarchy'
            GROUP BY tenantid ORDER BY 1;"

echo ""
echo "============================================================"
echo " DATA MIGRATION COMPLETE."
echo " NEXT (manual, lockstep — see runbook §8):"
echo "   B) deploy pgr-services (validates ComplaintHierarchy)"
echo "   C) deploy digit-ui (esbuild)"
echo "   D) verify end-to-end (create -> assign -> resolve)"
echo "   E) only then retire ServiceDefs/ClassificationNode/ComplaintTypeDepartments"
echo "============================================================"
