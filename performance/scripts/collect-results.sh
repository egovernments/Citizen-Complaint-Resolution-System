#!/usr/bin/env bash
# Collect all test results into a summary markdown table
# Reads summary.json from each result directory

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
RESULTS_DIR="${ROOT_DIR}/results"
SUMMARY_FILE="${RESULTS_DIR}/SUMMARY.md"

if [ ! -d "$RESULTS_DIR" ] || [ -z "$(ls -A "$RESULTS_DIR" 2>/dev/null)" ]; then
  echo "No results found in ${RESULTS_DIR}"
  exit 1
fi

cat > "$SUMMARY_FILE" <<'HEADER'
# Load Test Results Summary

| Timestamp | Machine | CPUs | Scenario | p50 (ms) | p95 (ms) | p99 (ms) | Error% | Tx/min | Success% | Pass |
|-----------|---------|------|----------|----------|----------|----------|--------|--------|----------|------|
HEADER

for dir in "$RESULTS_DIR"/*/; do
  [ -f "${dir}summary.json" ] || continue

  dirname="$(basename "$dir")"
  # Parse dirname: YYYYMMDD-HHMMSS_env_profile_scenario (underscore-separated after timestamp)
  timestamp="$(echo "$dirname" | cut -d_ -f1)"
  env="$(echo "$dirname" | cut -d_ -f2)"
  profile="$(echo "$dirname" | cut -d_ -f3)"
  scenario="$(echo "$dirname" | cut -d_ -f4)"

  # Extract metrics from k6 summary JSON using python (available on most systems)
  read -r p50 p95 p99 error_rate tx_rate success_rate <<< "$(python3 -c "
import json, sys
with open('${dir}summary.json') as f:
    data = json.load(f)

metrics = data.get('metrics', {})

# Transaction duration
td = metrics.get('transaction_duration', {}).get('values', {})
p50 = td.get('p(50)', 0)
p95 = td.get('p(95)', 0)
p99 = td.get('p(99)', 0)

# Error rate
hrf = metrics.get('http_req_failed', {}).get('values', {})
error_rate = hrf.get('rate', 0) * 100

# Throughput (transactions per minute)
ts = metrics.get('transaction_success', {}).get('values', {})
success_rate = ts.get('rate', 0) * 100

# Calculate tx/min from http_reqs count and duration
reqs = metrics.get('http_reqs', {}).get('values', {})
count = reqs.get('count', 0)
# Each transaction has ~6 HTTP requests
tx_count = count / 6
# Assume 8 min measurement window (rough)
tx_min = tx_count / 8

print(f'{p50:.0f} {p95:.0f} {p99:.0f} {error_rate:.1f} {tx_min:.1f} {success_rate:.1f}')
" 2>/dev/null || echo "- - - - - -")"

  # Determine pass/fail
  pass="PASS"
  if python3 -c "
p95=${p95:-0}; p99=${p99:-0}; err=${error_rate:-100}; succ=${success_rate:-0}
if p95 > 10000 or p99 > 20000 or err > 1 or succ < 95: exit(1)
" 2>/dev/null; then
    pass="PASS"
  else
    pass="FAIL"
  fi

  echo "| ${timestamp} | ${env} | ${profile#cpu-} | ${scenario} | ${p50} | ${p95} | ${p99} | ${error_rate}% | ${tx_rate} | ${success_rate}% | ${pass} |" >> "$SUMMARY_FILE"
done

echo "Summary written to: ${SUMMARY_FILE}"
cat "$SUMMARY_FILE"
