#!/usr/bin/env bash
# Proof for db-history-normalize, against a REAL dump and the REAL pinned images.
#
#   ./test-integration.sh /path/to/dump.sql
#
# A) POSITIVE — dump + normalizer + every pinned migrator:
#      each reports "No migration necessary" (except services that legitimately
#      migrate from empty), and a row-count + content-checksum snapshot of every
#      table is byte-identical before/after.
# B) THE GUARD — on an OPERATOR-style dump (legacy history names):
#      B1 without the normalizer, data IS destroyed  -> the guard is NEEDED
#      B2 with it, the renames happen and data survives -> the guard WORKS
#
#      Flyway finds its logbook BY NAME. Our shipped dump files its logbooks under
#      the CURRENT names (item #10 re-baked it), so on our dump the normalizer has
#      nothing to rename — part A reports "renamed 0". The input this component
#      exists for is an OPERATOR's dump, still using the LEGACY names: Flyway does
#      not find the logbook, concludes it has never run, and replays from V1 —
#      whose first statement, for egov-localization and egov-enc-service, is
#      DROP TABLE IF EXISTS. 23k messages and the PII encryption keys, exit 0.
#
#      So B synthesises that dump by renaming our logbooks BACKWARDS. Testing this
#      against our own dump proves nothing (it is the safe input) — that is exactly
#      how this section silently rotted after the re-bake.
# C) CONVERGENCE — fast path (dump + migrators) vs slow path (EMPTY + migrators):
#      both must end at an IDENTICAL schema — same columns, indexes, and
#      materialized-view definitions. The dump is a shortcut for DATA and TIME; it
#      is never a source of schema truth. Anything the dump has that the migrations
#      cannot reproduce is drift, and it breaks from-empty builds silently while the
#      fast path keeps working by accident.
#      This caught a real one: eg_user.countrycode existed only in the dump because
#      the app was on egov-user:mobilevalidation-* while its migrator was pinned to
#      master-d69ce29, which predates the countrycode migration. Neither (A), (B),
#      nor the CI alignment check can see that class of bug — (A) only proves
#      existing data survives, and the alignment check only compares history-table
#      NAMES.
#
# Runs entirely in throwaway containers on their own network. Never touches a
# running stack.
set -euo pipefail

DUMP="${1:?usage: test-integration.sh /path/to/dump.sql}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAP="$HERE/../flyway-history-map.yml"
REPO="$(cd "$HERE/../../.." && pwd)"
PG_IMAGE="registry.preview.egov.theflywheel.in/postgres:16"
NET=normalize-it
WORK="$(mktemp -d)"
trap 'docker rm -f it-pos it-neg it-slow it-grd >/dev/null 2>&1 || true; docker network rm $NET >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

# Migrators built from the repo rather than pulled. Part C needs them: without
# them the slow path would lack pgr/novu/config tables that the dump HAS, and the
# comparison would report false drift.
BUILT_MIGRATORS=(
  "pgr-services|$REPO/backend/pgr-services/src/main/resources/db|pgr_services_schema|"
  "novu-bridge|$REPO/backend/novu-bridge/src/main/resources/db|novu_bridge_schema|"
  "digit-config-service|$REPO/backend/digit-config-service/src/main/resources/db|digit_config_service_schema|public"
)

MIGRATORS=(
  # audit-service was never covered here: its migrator used to live in the base
  # compose rather than the overlay, so it fell outside this list. Both now live
  # in docker-compose.migrations.yml.
  "audit-service|audit-service-db:v2.9.2-4a60f20|audit_service_schema"
  "boundary-service|boundary-service-db:v2.9.2-4a60f20|boundary_service_schema"
  # Lineage fix: the app is egov-user:mobilevalidation-*, so the migrator must be
  # from that lineage too. master-d69ce29 predates the countrycode migration and
  # left from-empty builds without eg_user.countrycode. See docker-compose.migrations.yml.
  "egov-user|egov-user-db:mobile-validation-user-otp-9883730|egov_user_schema"
  "mdms-backend|mdms-v2-db:v2.9.2-4a60f20|mdms_v2_schema"
  "egov-idgen|egov-idgen-db:v2.9.2-4a60f20|egov_idgen_schema"
  "egov-localization|egov-localization-db:v2.9.2-4a60f20|egov_localization_schema"
  "egov-enc-service|egov-enc-service-db:v2.9.2-4a60f20|egov_enc_service_schema"
  "egov-filestore|egov-filestore-db:v2.9.2-4a60f20|egov_filestore_schema"
  "egov-workflow-v2|egov-workflow-v2-db:v2.9.2-4a60f20|egov_workflow_v2_schema"
  "egov-hrms|egov-hrms-db:hrms-boundary-0a4e737|egov_hrms_schema"
  "egov-url-shortening|egov-url-shortening-db:v2.9.2-4a60f20|egov-url-shortening_schema"
  "egov-otp|egov-otp-db:v2.9.2-4a60f20|egov_otp_schema"
  # Phase 4 — the last self-migrating services. These three -db images are pinned
  # to the SAME tag as their app image in docker-compose.migrations.yml, not to
  # the K8s v2.9.2 release tag, so keep the two in sync.
  "egov-indexer|egov-indexer-db:maven-jdk21-9f83afb|egov_indexer_schema"
  "egov-accesscontrol|egov-accesscontrol-db:maven-jdk21-9f83afb|accesscontrol_schema_version"
  "egov-bndry-mgmnt|egov-bndry-mgmnt-db:bndry-mgmnt-3794b8c|egov-bndry-mgmnt_schema"
)

# Row count + content checksum for every DATA table in public.
#
# Flyway history tables are EXCLUDED. This assertion is about data survival, and a
# history table is bookkeeping: when a migrator legitimately applies a migration
# newer than the dump (egov-user's countrycode), its history GAINS a row — correct
# behaviour that would otherwise read as "pre-existing data changed". What each
# migrator did is already reported above, per service, so nothing is lost by
# leaving history out of this comparison.
#
# Identified by column signature, not by name — the name is precisely what we
# cannot trust here (same rule as normalize.py).
cat > "$WORK/snapshot.sql" <<'SQL'
SELECT c.relname,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', c.relname), false,true,'')))[1]::text::bigint,
       (xpath('/row/c/text()', query_to_xml(format('select coalesce(md5(string_agg(t::text, E''\n'' ORDER BY t::text)),''EMPTY'') as c from public.%I t', c.relname), false,true,'')))[1]::text
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid = c.oid AND a.attname = 'installed_rank'
  )
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

# Services the dump carries NEITHER history NOR tables for (`baseline_fresh: true`
# in flyway-history-map.yml). The normalizer correctly leaves them alone ("fresh
# install"), so they are not in REBUILT — but their migrator still legitimately
# applies from empty. Demanding a no-op from them would be wrong for the same
# reason it is wrong for REBUILT, just via a different path.
BASELINE_FRESH="egov-indexer audit-service"
echo "  baseline-fresh: ${BASELINE_FRESH:-<none>}"

# Services whose PINNED image carries migrations NEWER than the dump. They apply on
# top; that is the fast path working exactly as designed (dump = baseline, Flyway
# applies the delta), not a failure. egov-user is here because its migrator is now
# pinned to the mobilevalidation lineage, whose countrycode migration postdates the
# dump. Keep this list honest: an entry that stops applying means the dump has
# caught up and the entry should go.
NEWER_THAN_DUMP="egov-user"
echo "  newer-than-dump: ${NEWER_THAN_DUMP:-<none>}"

# Idempotency: a second run must change nothing and still exit 0.
normalize it-pos > "$WORK/second-run.log"
grep -q "renamed 0, rebuilt 0" "$WORK/second-run.log" || {
  echo "FAIL: normalizer is not idempotent"; cat "$WORK/second-run.log"; exit 1; }
echo "  idempotent: second run renamed 0, rebuilt 0"

fail=0
while read -r name rc verdict; do
  expect=noop
  case " $REBUILT $BASELINE_FRESH $NEWER_THAN_DUMP " in *" $name "*) expect=applied-or-failed ;; esac
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

# ── C) CONVERGENCE ────────────────────────────────────────────────────────────
# Both paths must arrive at the SAME schema. See the header for why this exists.
echo "=== C) CONVERGENCE: fast path (dump) vs slow path (empty) must match ==="

build_migrator() {  # $1 = name, $2 = context -> echoes the built tag
  docker build -q -t "it-$1-db:test" "$2" >/dev/null
  echo "it-$1-db:test"
}

run_built() {  # $1 = db container
  local m name ctx table schema img
  for m in "${BUILT_MIGRATORS[@]}"; do
    IFS='|' read -r name ctx table schema <<< "$m"
    img="$(build_migrator "$name" "$ctx")"
    docker run --rm --network $NET \
      -e DB_URL="jdbc:postgresql://$1:5432/egov" ${schema:+-e SCHEMA_NAME=$schema} \
      -e SCHEMA_TABLE="$table" -e FLYWAY_USER=egov -e FLYWAY_PASSWORD=egov123 \
      -e FLYWAY_LOCATIONS=filesystem:/flyway/sql -e FLYWAY_VALIDATE_ON_MIGRATE=false \
      "$img" > "$WORK/$1-$name.log" 2>&1 || {
        echo "    FAIL: $name migrator exited non-zero on $1"; tail -5 "$WORK/$1-$name.log"; exit 1; }
  done
}

# Snapshot the SHAPE of the schema (not the data): columns, indexes, and matview
# definitions. Data is expected to differ — the dump has rows, an empty build does not.
cat > "$WORK/shape.sql" <<'SQL'
SELECT 'col|'||table_name||'.'||column_name||'|'||data_type||'|'
       ||coalesce(character_maximum_length::text,'-')||'|'||is_nullable
FROM information_schema.columns WHERE table_schema='public'
UNION ALL
SELECT 'idx|'||indexname||'|'||md5(indexdef) FROM pg_indexes WHERE schemaname='public'
UNION ALL
SELECT 'mv|'||matviewname||'|'||md5(definition) FROM pg_matviews WHERE schemaname='public'
ORDER BY 1;
SQL
shape() { docker cp "$WORK/shape.sql" "$1:/tmp/shape.sql" >/dev/null
          docker exec "$1" psql -U egov -d egov -tA -f /tmp/shape.sql | sed 's/ *$//' | sort; }

# it-pos already has: dump + normalize + every PULLED migrator. Finish the fast
# path by running the in-repo built ones on it too.
run_built it-pos
shape it-pos > "$WORK/shape-fast.txt"

# Slow path: virgin DB, normalize (must be a no-op), then every migrator.
docker rm -f it-slow >/dev/null 2>&1 || true
docker run -d --name it-slow --network $NET \
  -e POSTGRES_USER=egov -e POSTGRES_PASSWORD=egov123 -e POSTGRES_DB=egov "$PG_IMAGE" >/dev/null
until docker exec it-slow pg_isready -U egov >/dev/null 2>&1; do sleep 2; done
# pg_isready answers from initdb's TEMPORARY server first; wait for the real one.
until docker logs it-slow 2>&1 | grep -q "PostgreSQL init process complete"; do sleep 1; done
normalize it-slow > "$WORK/slow-normalize.log"
grep -q "renamed 0, rebuilt 0" "$WORK/slow-normalize.log" || {
  echo "FAIL: normalizer touched an EMPTY database — it must be a pure no-op there"
  cat "$WORK/slow-normalize.log"; exit 1; }
echo "  normalizer on empty DB: no-op (as required)"
run_migrators it-slow > "$WORK/slow-migrators.txt"
while read -r name rc verdict; do
  [ "$rc" = "0" ] || { echo "    FAIL: $name exited $rc building from empty"; exit 1; }
done < "$WORK/slow-migrators.txt"
run_built it-slow
shape it-slow > "$WORK/shape-slow.txt"

echo "  fast path: $(grep -c '^col|' "$WORK/shape-fast.txt") columns, $(grep -c '^idx|' "$WORK/shape-fast.txt") indexes, $(grep -c '^mv|' "$WORK/shape-fast.txt") matviews"
echo "  slow path: $(grep -c '^col|' "$WORK/shape-slow.txt") columns, $(grep -c '^idx|' "$WORK/shape-slow.txt") indexes, $(grep -c '^mv|' "$WORK/shape-slow.txt") matviews"

if ! diff -u "$WORK/shape-fast.txt" "$WORK/shape-slow.txt" > "$WORK/shape.diff"; then
  echo "FAIL: the two paths do NOT converge to the same schema."
  echo "      '-' = in the dump but NOT reproducible from migrations (drift: from-empty"
  echo "            builds silently lack it while the fast path works by accident)."
  echo "      '+' = built from migrations but absent from the dump (the dump is stale;"
  echo "            usually fine — it applies on top — but check it is intentional)."
  grep -E '^[-+][^-+]' "$WORK/shape.diff" | head -30
  exit 1
fi
echo "  PASS: fast and slow paths converge to an identical schema"

echo

# ── B) THE GUARD ──────────────────────────────────────────────────────────────
# See the header. Both halves run against a SYNTHESISED operator dump, because our
# own dump is the safe input and proves nothing here.
echo "=== B) THE GUARD: against an OPERATOR-style dump (legacy history names) ==="

# canonical -> legacy pairs, straight from the map. Never hardcode them: the map is
# the single source of truth, and a hardcoded copy would drift out of sync silently.
alias_pairs() {
  docker run --rm -v "$MAP:/map.yml:ro" --entrypoint python3 db-history-normalize:test -c '
import yaml
for spec in (yaml.safe_load(open("/map.yml")) or {}).values():
    a = spec.get("aliases") or []
    if a:
        print(spec["canonical"], a[0])
'
}

# Turn our (canonical) dump back into the operator dump we protect against.
#
# The indexes MUST be renamed alongside the table. Flyway names a history table's
# constraint/index after the table (<table>_pk, <table>_s_idx), and Postgres's
# ALTER TABLE ... RENAME does NOT rename them. Renaming only the table produces a
# state that cannot occur naturally — table "x_version" whose PK is still "x_pk" —
# and Flyway then dies on "relation x_pk already exists" while trying to baseline,
# rather than replaying. The run FAILS instead of destroying data, and the test
# reads as "the guard isn't needed" for entirely the wrong reason.
#
# A genuine legacy dump has no such collision: Flyway created the table AS
# "x_version", so its PK is "x_version_pk".
legacy_ify() {  # $1 = db container
  local canon alias n=0
  while read -r canon alias; do
    [ -z "${canon:-}" ] && continue
    docker exec "$1" psql -U egov -d egov -q -v ON_ERROR_STOP=1 \
      -c "ALTER TABLE public.\"$canon\" RENAME TO \"$alias\";" \
      -c "ALTER INDEX IF EXISTS public.\"${canon}_pk\" RENAME TO \"${alias}_pk\";" \
      -c "ALTER INDEX IF EXISTS public.\"${canon}_s_idx\" RENAME TO \"${alias}_s_idx\";" \
      || { echo "FAIL: could not rename $canon -> $alias"; exit 1; }
    n=$((n + 1))
  done < <(alias_pairs)
  [ "$n" -gt 0 ] || { echo "FAIL: the map yielded no aliases — nothing to synthesise"; exit 1; }
  echo "  synthesised operator dump: $n history tables (+ their indexes) renamed to legacy names"
}

rows() {  # $1 = db, $2 = table -> row count, or "GONE" if the table no longer exists
  docker exec "$1" psql -U egov -d egov -tAc "SELECT count(*) FROM public.$2" 2>/dev/null || echo GONE
}

# The two services whose V1 starts with DROP TABLE IF EXISTS. If a replay happens,
# these die first — and eg_enc_* are the keys that decrypt every user's PII.
CANARIES="message eg_enc_symmetric_keys eg_enc_asymmetric_keys"

# ── B1) unguarded — the data MUST die ─────────────────────────────────────────
echo "--- B1) legacy dump + migrators, normalizer SKIPPED (must destroy data) ---"
start_db it-neg
legacy_ify it-neg
for t in $CANARIES; do printf "  before  %-24s %s\n" "$t" "$(rows it-neg "$t")"; done
run_migrators it-neg >/dev/null
destroyed=0
for t in $CANARIES; do
  after="$(rows it-neg "$t")"
  printf "  after   %-24s %s\n" "$t" "$after"
  case "$after" in 0|GONE) destroyed=$((destroyed + 1)) ;; esac
done
[ "$destroyed" = "3" ] || {
  echo "FAIL: the unguarded run did NOT destroy data as expected."
  echo "      Either the migration images changed, or legacy_ify no longer produces"
  echo "      the dangerous input. Do not ship until this is understood — this test"
  echo "      passing is the only evidence the guard is worth running."
  exit 1
}
echo "  PASS: unguarded run destroys data — the guard is NEEDED"

# ── B2) guarded — the renames happen and the data survives ────────────────────
# This is the case the whole component exists for, and the ONLY test that executes
# its rename path against a real database (part A's dump is already canonical, so
# it reports "renamed 0").
echo "--- B2) legacy dump + normalizer + migrators (must rename, must preserve) ---"
start_db it-grd
legacy_ify it-grd
snapshot it-grd > "$WORK/grd-before.txt"
normalize it-grd | tee "$WORK/grd-normalize.log"
renamed="$(sed -n 's/^ok: renamed \([0-9]*\).*/\1/p' "$WORK/grd-normalize.log")"
[ "${renamed:-0}" -ge 1 ] || {
  echo "FAIL: normalizer renamed NOTHING on a legacy dump. Its rename path did not"
  echo "      run, so this test proves nothing about the code it exists to cover."
  exit 1
}
echo "  normalizer renamed $renamed history table(s)"
fail=0
while read -r name rc verdict; do
  [ "$rc" = "0" ] || { echo "    FAIL: $name exited $rc after normalization"; fail=1; }
done < <(run_migrators it-grd)
[ "$fail" = "0" ] || { echo "FAIL: a migrator failed on a normalized legacy dump"; exit 1; }
for t in $CANARIES; do printf "  survived %-24s %s\n" "$t" "$(rows it-grd "$t")"; done
snapshot it-grd > "$WORK/grd-after.txt"
if ! join -t'|' -j1 <(sort -t'|' -k1,1 "$WORK/grd-before.txt") <(sort -t'|' -k1,1 "$WORK/grd-after.txt") \
     | awk -F'|' '$2!=$4 || $3!=$5 {print "    CHANGED: "$0; bad=1} END {exit bad?1:0}'; then
  echo "FAIL: the guarded run changed pre-existing data — the guard did not protect it"
  exit 1
fi
echo "  PASS: guarded run renames and preserves every row — the guard WORKS"

echo "ALL PASS: on an operator dump the guard is both NEEDED (B1) and WORKS (B2);"
echo "          our own dump is safe (A); and dump-built and empty-built schemas"
echo "          are identical (C)."
