#!/usr/bin/env bash
# fix-citymodule-pilot.sh — run ON THE BOX (cms-ansible-pilot).
#
# Idempotent repair of tenant.citymodule for an existing environment:
#   1. Schema: registers it if absent; adds the bannerImage property if
#      missing (direct SQL — MDMS has NO schema-update API), restarts MDMS
#      only when something changed.
#   2. Data: re-creates any missing rows (Workbench / PGR / HRMS) via the
#      API. Existing rows are NEVER touched or overwritten.
#   3. Verifies schema + rows via the APIs the UI actually uses.
#
# Usage:  bash fix-citymodule-pilot.sh [TENANT]        (default: mz)
#   env:  HOST=http://127.0.0.1  ADMIN_USER=ADMIN  ADMIN_PASS=eGov@123

set -uo pipefail
TENANT="${1:-mz}"
HOST="${HOST:-http://127.0.0.1}"
ADMIN_USER="${ADMIN_USER:-ADMIN}"
ADMIN_PASS="${ADMIN_PASS:-eGov@123}"
CHANGED=0

# ── locate postgres ──────────────────────────────────────────────────────
PG=$(sudo docker ps --format '{{.Names}}' | grep -m1 -i postgres)
[ -n "$PG" ] || { echo "✗ no postgres container found"; exit 1; }
DBU=$(sudo docker exec "$PG" printenv POSTGRES_USER 2>/dev/null || echo egov)
DBN=$(sudo docker exec "$PG" printenv POSTGRES_DB 2>/dev/null || echo egov)
SQL() { sudo docker exec "$PG" psql -U "$DBU" -d "$DBN" -Atc "$1"; }
echo "── postgres: $PG (db=$DBN user=$DBU) · tenant=$TENANT · host=$HOST"

# ── auth ─────────────────────────────────────────────────────────────────
TOKEN=$(curl -s -X POST "$HOST/user/oauth/token" \
  -H 'Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "username=$ADMIN_USER" --data-urlencode "password=$ADMIN_PASS" \
  --data-urlencode "tenantId=$TENANT" --data-urlencode 'userType=EMPLOYEE' \
  --data-urlencode 'scope=read' --data-urlencode 'grant_type=password' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))')
[ -n "$TOKEN" ] || { echo "✗ auth failed for $ADMIN_USER@$TENANT"; exit 1; }
echo "✓ authenticated"

# ── 1. schema ────────────────────────────────────────────────────────────
REGISTERED=$(SQL "SELECT count(*) FROM eg_mdms_schema_definition WHERE tenantid='$TENANT' AND code='tenant.citymodule';")
if [ "$REGISTERED" = "0" ]; then
  echo "· schema not registered — creating via API (full definition incl. bannerImage)"
  curl -s -X POST "$HOST/mdms-v2/schema/v1/_create" -H 'Content-Type: application/json' -d @- <<EOF >/dev/null
{"RequestInfo":{"authToken":"$TOKEN"},"SchemaDefinition":{"tenantId":"$TENANT","code":"tenant.citymodule","description":"tenant.citymodule","isActive":true,"definition":{"type":"object","title":"Generated schema for Root","\$schema":"http://json-schema.org/draft-07/schema#","required":["module","code","active","order","tenants"],"x-unique":["code"],"properties":{"code":{"type":"string"},"order":{"type":"number"},"active":{"type":"boolean"},"module":{"type":"string"},"bannerImage":{"type":"string"},"tenants":{"type":"array","items":{"type":"object","required":["code"],"properties":{"code":{"type":"string"}},"additionalProperties":false}}},"additionalProperties":false}}}
EOF
  CHANGED=1; sleep 6
  # async persister: verify it actually landed (known silent-drop on this box)
  if [ "$(SQL "SELECT count(*) FROM eg_mdms_schema_definition WHERE tenantid='$TENANT' AND code='tenant.citymodule';")" = "0" ]; then
    echo "⚠ API create silently dropped — inserting directly into the DB"
    SQL "INSERT INTO eg_mdms_schema_definition (id,tenantid,code,description,definition,isactive,createdby,lastmodifiedby,createdtime,lastmodifiedtime) VALUES (gen_random_uuid()::text,'$TENANT','tenant.citymodule','tenant.citymodule','{\"type\":\"object\",\"title\":\"Generated schema for Root\",\"\$schema\":\"http://json-schema.org/draft-07/schema#\",\"required\":[\"module\",\"code\",\"active\",\"order\",\"tenants\"],\"x-unique\":[\"code\"],\"properties\":{\"code\":{\"type\":\"string\"},\"order\":{\"type\":\"number\"},\"active\":{\"type\":\"boolean\"},\"module\":{\"type\":\"string\"},\"bannerImage\":{\"type\":\"string\"},\"tenants\":{\"type\":\"array\",\"items\":{\"type\":\"object\",\"required\":[\"code\"],\"properties\":{\"code\":{\"type\":\"string\"}},\"additionalProperties\":false}}},\"additionalProperties\":false}'::jsonb,true,'migration','migration',(extract(epoch from now())*1000)::bigint,(extract(epoch from now())*1000)::bigint) ON CONFLICT DO NOTHING;"
  fi
  echo "✓ schema registered"
else
  HASBANNER=$(SQL "SELECT definition->'properties' ? 'bannerImage' FROM eg_mdms_schema_definition WHERE tenantid='$TENANT' AND code='tenant.citymodule';")
  if [ "$HASBANNER" = "t" ]; then
    echo "✓ schema already has bannerImage — untouched"
  else
    echo "· adding bannerImage to the registered schema (SQL — no update API exists)"
    SQL "UPDATE eg_mdms_schema_definition SET definition = jsonb_set(definition, '{properties,bannerImage}', '{\"type\":\"string\"}'), lastmodifiedtime=(extract(epoch from now())*1000)::bigint WHERE tenantid='$TENANT' AND code='tenant.citymodule';"
    CHANGED=1
    echo "✓ bannerImage added"
  fi
fi

if [ "$CHANGED" = "1" ]; then
  echo "· restarting egov-mdms-service (schema definitions are cached)"
  sudo docker restart egov-mdms-service >/dev/null
  sleep 10
fi

# ── 2. data rows (create missing only — never overwrites) ───────────────
for M in Workbench:1 PGR:2 HRMS:3; do
  CODE="${M%%:*}"; ORDER="${M##*:}"
  EXISTS=$(curl -s -X POST "$HOST/mdms-v2/v2/_search" -H 'Content-Type: application/json' \
    -d "{\"RequestInfo\":{\"authToken\":\"$TOKEN\"},\"MdmsCriteria\":{\"tenantId\":\"$TENANT\",\"schemaCode\":\"tenant.citymodule\",\"uniqueIdentifiers\":[\"$CODE\"]}}" \
    | python3 -c 'import sys,json;print(sum(1 for m in json.load(sys.stdin).get("mdms") or [] if m.get("isActive")))')
  if [ "$EXISTS" != "0" ]; then
    echo "✓ row $CODE exists — untouched"
    continue
  fi
  echo "· creating row $CODE"
  curl -s -X POST "$HOST/mdms-v2/v2/_create/tenant.citymodule" -H 'Content-Type: application/json' -d @- <<EOF >/dev/null
{"RequestInfo":{"authToken":"$TOKEN"},"Mdms":{"tenantId":"$TENANT","schemaCode":"tenant.citymodule","uniqueIdentifier":"$CODE","data":{"code":"$CODE","order":$ORDER,"active":true,"module":"$CODE","tenants":[{"code":"$TENANT"}]},"isActive":true}}
EOF
done

# ── 3. verify ────────────────────────────────────────────────────────────
sleep 5
echo "── verify"
curl -s -X POST "$HOST/mdms-v2/schema/v1/_search" -H 'Content-Type: application/json' \
  -d "{\"RequestInfo\":{\"authToken\":\"$TOKEN\"},\"SchemaDefCriteria\":{\"tenantId\":\"$TENANT\",\"codes\":[\"tenant.citymodule\"],\"limit\":5}}" \
  | python3 -c 'import sys,json;defs=json.load(sys.stdin).get("SchemaDefinitions") or [];p=sorted((defs[0]["definition"].get("properties") or {}).keys()) if defs else [];print("schema props:",p);import sys as s;s.exit(0 if "bannerImage" in p else 1)' \
  && echo "✓ schema OK (bannerImage present)" || echo "✗ schema still missing bannerImage"
curl -s -X POST "$HOST/egov-mdms-service/v1/_search" -H 'Content-Type: application/json' \
  -d "{\"RequestInfo\":{\"apiId\":\"x\"},\"MdmsCriteria\":{\"tenantId\":\"$TENANT\",\"moduleDetails\":[{\"moduleName\":\"tenant\",\"masterDetails\":[{\"name\":\"citymodule\"}]}]}}" \
  | python3 -c 'import sys,json;m=(json.load(sys.stdin).get("MdmsRes") or {}).get("tenant",{}).get("citymodule") or [];print("rows v1-visible:",[r.get("code") for r in m])'
echo "── DONE. Hard-refresh the configurator (Ctrl+Shift+R) before checking the form."
