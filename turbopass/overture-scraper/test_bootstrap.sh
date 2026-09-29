#!/usr/bin/env bash
# Offline check that bootstrap.sh never touches the served DB until the new one
# verifies. Runs the real bootstrap.sh against stub pipeline steps.
#
#   bash test_bootstrap.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cp "$here/bootstrap.sh" "$work/"
# Every step appends to the DB it is pointed at; verify fails on request.
for step in scrape apply_admin_levels build_hierarchy official; do
  printf 'import os\nopen(os.environ["OVERTURE_DB_PATH"], "a").write("%s\\n")\n' "$step" > "$work/$step.py"
done
printf 'import os, sys\nsys.exit(1 if os.environ.get("FAIL_VERIFY") else 0)\n' > "$work/verify_db.py"

served="$work/data/boundaries.sqlite"
mkdir -p "$work/data"
echo "old" > "$served"

fail() { echo "FAIL: $*"; exit 1; }

# A run that fails verification leaves the served DB and no scratch file.
if FAIL_VERIFY=1 TURBOPASS_SKIP_VENV=1 OVERTURE_DB_PATH="$served" bash "$work/bootstrap.sh" >/dev/null 2>&1; then
  fail "bootstrap.sh exited 0 although verify failed"
fi
[ "$(cat "$served")" = "old" ] || fail "a failed run changed the served DB"
[ ! -e "$served.building" ] || fail "a failed run left $served.building behind"

# A run that verifies replaces the served DB in one rename.
TURBOPASS_SKIP_VENV=1 OVERTURE_DB_PATH="$served" bash "$work/bootstrap.sh" >/dev/null
[ "$(head -1 "$served")" = "scrape" ] || fail "a successful run didn't replace the served DB"
[ ! -e "$served.building" ] || fail "a successful run left $served.building behind"

echo "OK: bootstrap.sh swaps the DB in only after it verifies"
