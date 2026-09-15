#!/usr/bin/env bash
#
# Build the offline Overture boundary DB that turbopass search-api serves.
#
#   1. scrape.py             — pull division areas from Overture Maps (S3)
#   2. apply_admin_levels.py — synthetic admin_levels for sub-divisions
#   3. build_hierarchy.py    — drop maritime duplicates, compute parent_id,
#                              simplify geometry, index
#   4. verify_db.py          — fail unless every requested country landed
#
# Environment: COUNTRIES (default IN,KE,MZ), OVERTURE_RELEASE (default: the
# newest release in the bucket), OVERTURE_DB_PATH, SIMPLIFY_TOLERANCE. Any step
# failing stops the run with a non-zero exit — never "ready" over an empty DB.
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
if [ -z "${TURBOPASS_SKIP_VENV:-}" ] && ! "$PY" -c "import duckdb, geopandas" >/dev/null 2>&1; then
  echo "==> Creating Python venv (./venv) and installing requirements..."
  "$PY" -m venv venv
  # shellcheck disable=SC1091
  source venv/bin/activate
  pip install --quiet --upgrade pip
  pip install --quiet -r requirements.txt
  PY=python
fi

echo "==> [1/4] Downloading Overture boundaries for: ${COUNTRIES}"
"$PY" scrape.py

echo "==> [2/4] Applying synthetic admin levels"
"$PY" apply_admin_levels.py

echo "==> [3/4] Building hierarchy (a few minutes for India)"
"$PY" build_hierarchy.py

echo "==> [4/4] Verifying"
"$PY" verify_db.py

echo "==> Boundary DB ready at ${OVERTURE_DB_PATH:-../overture-data/boundaries.sqlite}"
