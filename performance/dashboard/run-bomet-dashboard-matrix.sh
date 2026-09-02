#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUN_PREFIX="issue1109-bomet-$(date -u +%Y%m%d-%H%M%S)"
TIERS='20k,50k'
VUS='2,10,50,75,100,120,125,150'
RUNNER_ARGS=(--suite benchmark --warmups 2 --samples 20 --vus 1)

die() { echo "dashboard matrix runner: $*" >&2; exit 2; }

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --run-prefix) [[ "$#" -ge 2 ]] || die '--run-prefix requires a value'; RUN_PREFIX="$2"; shift 2 ;;
    --tiers) [[ "$#" -ge 2 ]] || die '--tiers requires a comma-separated list'; TIERS="$2"; shift 2 ;;
    --vus) [[ "$#" -ge 2 ]] || die '--vus requires a comma-separated list'; VUS="$2"; shift 2 ;;
    --) shift; RUNNER_ARGS=("$@"); break ;;
    *) die "unknown option: $1" ;;
  esac
done

[[ "${RUN_PREFIX}" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{2,30}$ ]] || \
  die '--run-prefix must be 3-30 safe characters so tier suffixes fit'

IFS=',' read -r -a TIER_LIST <<< "${TIERS}"
for tier in "${TIER_LIST[@]}"; do
  case "${tier}" in 3k|20k|50k|100k) ;; *) die "invalid tier: ${tier}" ;; esac
done

for tier in "${TIER_LIST[@]}"; do
  run_id="${RUN_PREFIX}-${tier}"
  echo "Starting Bomet dashboard matrix tier ${tier} (${VUS} VUs)"
  "${SCRIPT_DIR}/run-bomet-snapshot.sh" \
    --run-id "${run_id}" \
    --tier "${tier}" \
    --load-vus "${VUS}" \
    "${RUNNER_ARGS[@]}"
done
