#!/usr/bin/env bash
# prepare-extract.sh — build a boundary-filtered OSM extract for self-hosted
# Overpass (the configurator Phase 2 boundary fetch). Downloads Geofabrik
# country extracts, filters each to admin boundaries (tiny → fast Overpass
# import + area-gen), merges them, and writes a single .osm.bz2 that the
# enable_overpass deploy feeds to the wiktorn/overpass-api container.
#
# osmium runs in a throwaway container (no host install needed). Output goes to
# the dir the playbook mounts as the Overpass /data volume.
#
# Usage:
#   ./prepare-extract.sh <out-dir> <region-url> [<region-url> ...]
# Example (Kenya + Mozambique + India):
#   ./prepare-extract.sh /opt/overpass/data \
#     https://download.geofabrik.de/africa/kenya-latest.osm.pbf \
#     https://download.geofabrik.de/africa/mozambique-latest.osm.pbf \
#     https://download.geofabrik.de/asia/india-latest.osm.pbf
#
# Result: <out-dir>/boundaries.osm.bz2  (== overpass_planet_file default)
set -euo pipefail

OUT_DIR="${1:?usage: prepare-extract.sh <out-dir> <region-url>...}"; shift
[ "$#" -ge 1 ] || { echo "need at least one geofabrik region URL" >&2; exit 2; }
mkdir -p "$OUT_DIR"
OSMIUM="docker run --rm -v ${OUT_DIR}:/data ubuntu:22.04 bash -c"
RUN_OSMIUM() { docker run --rm -v "${OUT_DIR}:/data" ubuntu:22.04 bash -c "apt-get update -qq >/dev/null && apt-get install -y -qq osmium-tool >/dev/null && $1"; }

FILTERED=()
for url in "$@"; do
  name="$(basename "$url" .osm.pbf)"
  echo ">> $name: downloading"; curl -fSL -o "${OUT_DIR}/${name}.osm.pbf" "$url"
  echo ">> $name: filtering to admin boundaries"
  RUN_OSMIUM "osmium tags-filter -o /data/${name}-boundaries.osm.bz2 --overwrite /data/${name}.osm.pbf boundary=administrative"
  rm -f "${OUT_DIR}/${name}.osm.pbf"
  FILTERED+=("/data/${name}-boundaries.osm.bz2")
done

echo ">> merging ${#FILTERED[@]} region(s) → boundaries.osm.bz2"
RUN_OSMIUM "osmium merge --overwrite -o /data/boundaries.osm.bz2 ${FILTERED[*]}"
echo "done: ${OUT_DIR}/boundaries.osm.bz2 ($(du -h "${OUT_DIR}/boundaries.osm.bz2" | cut -f1))"
echo "Set overpass_planet_file: ${OUT_DIR}/boundaries.osm.bz2 and enable_overpass: true, then deploy."
