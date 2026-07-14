#!/usr/bin/env bash
#
# Bootstrap the offline Overture boundary DB for turbopass.
#
# Runs the full pipeline into ../overture-data/boundaries.sqlite:
#   1. scrape.py            — pull division geometries from Overture Maps (S3)
#   2. apply_admin_levels.py — assign synthetic admin_levels to sub-divisions
#   3. build_hierarchy.py   — spatial-join centroids to compute parent_id
#
# Defaults to the P0 set (India, Kenya, Mozambique). Retarget without editing
# any file:
#   COUNTRIES="IN,KE,MZ,ZA" ./bootstrap.sh
#
# Works two ways:
#   - On a host: creates ./venv and installs requirements.txt automatically.
#   - In the docker image (deps preinstalled): set TURBOPASS_SKIP_VENV=1.
#
set -euo pipefail
cd "$(dirname "$0")"

export COUNTRIES="${COUNTRIES:-IN,KE,MZ}"
export OVERTURE_RELEASE="${OVERTURE_RELEASE:-2026-06-17.0}"

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

echo "==> [1/3] Downloading Overture boundaries for: ${COUNTRIES}"
"$PY" scrape.py

echo "==> [2/3] Applying synthetic admin levels..."
"$PY" apply_admin_levels.py

echo "==> [3/3] Building spatial hierarchy (this can take a few minutes)..."
"$PY" build_hierarchy.py

echo ""
echo "==> Done. Boundary DB ready at ${OVERTURE_DB_PATH:-../overture-data/boundaries.sqlite}"
echo "    Start the service:  docker compose up -d search-api"
echo "    or locally:         cd ../search-api && npm install && npm run start:dev"
