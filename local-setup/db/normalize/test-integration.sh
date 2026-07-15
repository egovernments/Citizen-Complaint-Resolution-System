#!/usr/bin/env bash
# Proof for db-history-normalize, against a REAL dump and the REAL pinned images.
#
#   ./test-integration.sh /path/to/dump.sql
#
# A) POSITIVE — dump + normalizer + all 11 migrators:
#      every migrator reports "No migration necessary", and a row-count +
#      content-checksum snapshot of every table is byte-identical before/after.
# B) NEGATIVE — dump + all 11 migrators, normalizer SKIPPED:
#      data IS destroyed. If this ever stops failing, the guard has been silently
#      disabled and the positive test alone would not tell us.
#
# Runs entirely in throwaway containers on their own network. Never touches a
# running stack.
set -euo pipefail

DUMP="${1:?usage: test-integration.sh /path/to/dump.sql}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAP="$HERE/../flyway-history-map.yml"
PG_IMAGE="registry.preview.egov.theflywheel.in/postgres:16"
NET=normalize-it
WORK="$(mktemp -d)"
trap 'docker rm -f it-pos it-neg >/dev/null 2>&1 || true; docker network rm $NET >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

MIGRATORS=(
  "boundary-service|boundary-service-db:v2.9.2-4a60f20|boundary_service_schema"
  "egov-user|egov-user-db:master-d69ce29|egov_user_schema"
  "mdms-backend|mdms-v2-db:v2.9.2-4a60f20|mdms_v2_schema"
  "egov-idgen|egov-idgen-db:v2.9.2-4a60f20|egov_idgen_schema"
  "egov-localization|egov-localization-db:v2.9.2-4a60f20|egov_localization_schema"
  "egov-enc-service|egov-enc-service-db:v2.9.2-4a60f20|egov_enc_service_schema"
  "egov-filestore|egov-filestore-db:v2.9.2-4a60f20|egov_filestore_schema"
  "egov-workflow-v2|egov-workflow-v2-db:v2.9.2-4a60f20|egov_workflow_v2_schema"
  "egov-hrms|egov-hrms-db:hrms-boundary-0a4e737|egov_hrms_schema"
  "egov-url-shortening|egov-url-shortening-db:v2.9.2-4a60f20|egov-url-shortening_schema"
  "egov-otp|egov-otp-db:v2.9.2-4a60f20|egov_otp_schema"
)

# Row count + content checksum for every table in public.
cat > "$WORK/snapshot.sql" <<'SQL'
SELECT c.relname,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', c.relname), false,true,'')))[1]::text::bigint,
       (xpath('/row/c/text()', query_to_xml(format('select coalesce(md5(string_agg(t::text, E''\n'' ORDER BY t::text)),''EMPTY'') as c from public.%I t', c.relname), false,true,'')))[1]::text
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY 1;
SQL

start_db() {  # $1 = container name
  docker rm -f "$1" >/dev/null 2>&1 || true
  docker run -d --name "$1" --network $NET \
    -e POSTGRES_USER=egov -e POSTGRES_PASSWORD=egov123 -e POSTGRES_DB=egov \
    "$PG_IMAGE" >/dev/null
  until docker exec "$1" pg_isready -U egov >/dev/null 2>&1; do sleep 2; done
  docker cp "$DUMP" "$1:/tmp/dump.sql" >/dev/null
  docker cp "$WORK/snapshot.sql" "$1:/tmp/snapshot.sql" >/dev/null
  # ON_ERROR_STOP: psql errors read "psql:file:line: ERROR:", so never grep ^ERROR.
  docker exec "$1" psql -U egov -d egov -q -v ON_ERROR_STOP=1 -f /tmp/dump.sql >/dev/null
}
snapshot() { docker exec "$1" psql -U egov -d egov -tA -F'|' -f /tmp/snapshot.sql; }

run_migrators() {  # $1 = db container; echoes "<name> <exit> <verdict>" per line
  local m name image table log rc
  for m in "${MIGRATORS[@]}"; do
    IFS='|' read -r name image table <<< "$m"
    log="$WORK/$1-$name.log"
    docker run --rm --network $NET \
      -e DB_URL="jdbc:postgresql://$1:5432/egov" -e SCHEMA_NAME=public -e SCHEMA_TABLE="$table" \
      -e FLYWAY_USER=egov -e FLYWAY_PASSWORD=egov123 \
      -e FLYWAY_LOCATIONS=filesystem:/flyway/sql -e FLYWAY_VALIDATE_ON_MIGRATE=false \
      "egovio/$image" > "$log" 2>&1 && rc=0 || rc=$?
    if grep -q "No migration necessary" "$log"; then echo "$name $rc noop"
    else echo "$name $rc applied-or-failed"; fi
  done
}

normalize() {  # $1 = db container
  docker run --rm --network $NET \
    -e PGHOST="$1" -e PGUSER=egov -e PGPASSWORD=egov123 -e PGDATABASE=egov \
    -v "$MAP:/map.yml:ro" db-history-normalize:test
}

docker network create $NET >/dev/null 2>&1 || true
docker build -q -t db-history-normalize:test "$HERE" >/dev/null

# ── A) POSITIVE ───────────────────────────────────────────────────────────────
echo "=== A) POSITIVE: dump -> normalize -> migrators ==="
start_db it-pos
snapshot it-pos > "$WORK/pos-before.txt"

normalize it-pos | tee "$WORK/first-run.log"

# Services whose empty orphan tables the normalizer dropped. Their migrators MUST
# apply their migrations (we just removed the tables) — demanding a no-op from
# them would be wrong. Every other service must no-op.
REBUILT="$(sed -n 's/^  rebuilt  \([a-z0-9-]*\):.*/\1/p' "$WORK/first-run.log" | tr '\n' ' ')"
echo "  rebuild path: ${REBUILT:-<none>}"

# Idempotency: a second run must change nothing and still exit 0.
normalize it-pos > "$WORK/second-run.log"
grep -q "renamed 0, rebuilt 0" "$WORK/second-run.log" || {
  echo "FAIL: normalizer is not idempotent"; cat "$WORK/second-run.log"; exit 1; }
echo "  idempotent: second run renamed 0, rebuilt 0"

fail=0
while read -r name rc verdict; do
  expect=noop
  case " $REBUILT " in *" $name "*) expect=applied-or-failed ;; esac
  printf "  %-22s exit=%s %-18s (expect %s)\n" "$name" "$rc" "$verdict" "$expect"
  if [ "$rc" != "0" ]; then
    echo "    FAIL: $name exited $rc"; fail=1
  elif [ "$verdict" != "$expect" ]; then
    echo "    FAIL: $name expected $expect, got $verdict"; fail=1
  fi
done < <(run_migrators it-pos)
[ "$fail" = "0" ] || { echo "FAIL: migrators did not behave as expected"; exit 1; }

snapshot it-pos > "$WORK/pos-after.txt"
# Assert every table that EXISTED BEFORE is byte-identical. (Tables the migrators
# legitimately create, e.g. a fresh egov_otp_schema, are simply not in `before`.)
if ! join -t'|' -j1 <(sort -t'|' -k1,1 "$WORK/pos-before.txt") <(sort -t'|' -k1,1 "$WORK/pos-after.txt") \
     | awk -F'|' '$2!=$4 || $3!=$5 {print "    CHANGED: "$0; bad=1} END {exit bad?1:0}'; then
  echo "FAIL: pre-existing data changed"; exit 1
fi
echo "  PASS: every pre-existing table byte-identical (rows + checksum)"

# ── B) NEGATIVE ───────────────────────────────────────────────────────────────
echo "=== B) NEGATIVE: dump -> migrators, normalizer SKIPPED (must destroy data) ==="
start_db it-neg
snapshot it-neg > "$WORK/neg-before.txt"
run_migrators it-neg >/dev/null
snapshot it-neg > "$WORK/neg-after.txt"

destroyed=0
for t in message eg_enc_symmetric_keys eg_enc_asymmetric_keys; do
  before=$(awk -F'|' -v t="$t" '$1==t {print $2}' "$WORK/neg-before.txt")
  after=$(awk -F'|' -v t="$t" '$1==t {print $2}' "$WORK/neg-after.txt")
  printf "  %-24s %s -> %s\n" "$t" "${before:-?}" "${after:-?}"
  if [ -n "$before" ] && [ "$before" -gt 0 ] && [ "$after" = "0" ]; then
    destroyed=$((destroyed + 1))
  fi
done
[ "$destroyed" = "3" ] || {
  echo "FAIL: the unguarded run did NOT destroy data as expected."
  echo "      Either the migration images changed, or the guard is being applied"
  echo "      when it should not be. Do not ship until this is understood."
  exit 1
}
echo "  PASS: unguarded run destroys data — the guard is doing real work"

echo
echo "ALL PASS: normalizer makes the dump safe; without it the data is destroyed."
