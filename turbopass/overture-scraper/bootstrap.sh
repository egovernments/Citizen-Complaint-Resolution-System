#!/usr/bin/env bash
#
# Build the offline Overture boundary DB that turbopass search-api serves.
#
#   1. scrape.py             — pull division areas from Overture Maps (S3)
#   2. apply_admin_levels.py — synthetic admin_levels for sub-divisions
#   3. build_hierarchy.py    — drop maritime duplicates, compute parent_id,
#                              simplify geometry, index
#   4. official.py           — add OCHA COD-AB and geoBoundaries, keep the
#                              levels that nest, mark each country's best set
#   5. verify_db.py          — fail unless every requested country landed
#
# Environment: COUNTRIES (default IN,KE,MZ), OVERTURE_RELEASE (default: the
# newest release in the bucket), OVERTURE_DB_PATH, SIMPLIFY_TOLERANCE,
# OFFICIAL_SOURCES (default cod,geoboundaries; none skips step 4) and the
# official.py knobs listed in its docstring. Any step failing stops the run
# with a non-zero exit — never "ready" over an empty DB.
#
# On a host this creates ./venv from requirements.txt; the docker image has the
# deps baked in and sets TURBOPASS_SKIP_VENV=1.
#
set -euo pipefail
cd "$(dirname "$0")"

export COUNTRIES="${COUNTRIES:-IN,KE,MZ}"
export PYTHONUNBUFFERED=1

PY=python3

# On a host without the geospatial deps importable, spin up an isolated venv.
if [ -z "${TURBOPASS_SKIP_VENV:-}" ] && ! "$PY" -c "import duckdb, geopandas, pycountry" >/dev/null 2>&1; then
  echo "==> Creating Python venv (./venv) and installing requirements..."
  "$PY" -m venv venv
  # shellcheck disable=SC1091
  source venv/bin/activate
  pip install --quiet --upgrade pip
  pip install --quiet -r requirements.txt
  PY=python
fi

# Build into a scratch file next to the served DB and swap it in only once it
# verifies: search-api keeps its open handle on the old file meanwhile, and a
# failed or interrupted run leaves the served DB untouched. The rename is
# atomic because both paths share a directory (and so a filesystem).
TARGET="${OVERTURE_DB_PATH:-../overture-data/boundaries.sqlite}"
BUILD="${TARGET}.building"
rm -f "$BUILD" "$BUILD-journal"
trap 'rm -f "$BUILD" "$BUILD-journal"' EXIT
export OVERTURE_DB_PATH="$BUILD"

echo "==> [1/5] Downloading Overture boundaries for: ${COUNTRIES}"
"$PY" scrape.py

echo "==> [2/5] Applying synthetic admin levels"
"$PY" apply_admin_levels.py

echo "==> [3/5] Building hierarchy (a few minutes for India)"
"$PY" build_hierarchy.py

echo "==> [4/5] Adding official boundary sets (${OFFICIAL_SOURCES:-cod,geoboundaries})"
"$PY" official.py

echo "==> [5/5] Verifying"
"$PY" verify_db.py

mv -f "$BUILD" "$TARGET"
echo "==> Boundary DB ready at ${TARGET}. Restart search-api to serve it."
