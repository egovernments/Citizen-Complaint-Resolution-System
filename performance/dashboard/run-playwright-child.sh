#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TEST_DIR="${REPO_DIR}/tests/integration-tests"
PROJECT_ARGS=()

[[ -x "${TEST_DIR}/node_modules/.bin/playwright" ]] || {
  echo "dashboard runner: dependencies missing; run 'npm ci' in ${TEST_DIR}" >&2
  exit 2
}

case "${DASHBOARD_SUITE:-all}" in
  all) ;;
  functional) PROJECT_ARGS+=(--project=dashboard-functional) ;;
  benchmark) PROJECT_ARGS+=(--project=dashboard-benchmark) ;;
  *) echo "invalid DASHBOARD_SUITE: ${DASHBOARD_SUITE:-}" >&2; exit 2 ;;
esac

if [[ "${DASHBOARD_HEADED:-0}" == '1' ]]; then
  PROJECT_ARGS+=(--headed)
fi

set +e
(
  cd "${TEST_DIR}"
  ./node_modules/.bin/playwright test --config playwright.dashboard.config.ts "${PROJECT_ARGS[@]}"
)
test_exit=$?
set -e

node "${SCRIPT_DIR}/summarize-results.mjs" "${DASHBOARD_RESULTS_DIR}" || {
  echo 'dashboard runner: result summarization failed' >&2
  [[ "${test_exit}" -ne 0 ]] || test_exit=1
}
exit "${test_exit}"
