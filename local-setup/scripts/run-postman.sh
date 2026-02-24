#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POSTMAN_DIR="$ROOT_DIR/postman"

COMPLAINTS_COLLECTION="$POSTMAN_DIR/complaints-demo.postman_collection.json"
CORE_COLLECTION="$POSTMAN_DIR/digit-core-validation.postman_collection.json"

NEWMAN_CMD="${NEWMAN_CMD:-newman}"
NEWMAN_OPTS="${NEWMAN_OPTS:-}"

if ! command -v "$NEWMAN_CMD" >/dev/null 2>&1; then
  echo "Error: newman not found. Install it with: npm i -g newman"
  exit 1
fi

TARGET="${1:-all}"

run_complaints() {
  local -a vars=()
  [ -n "${URL:-}" ] && vars+=(--env-var "url=${URL}")
  [ -n "${USERNAME:-}" ] && vars+=(--env-var "username=${USERNAME}")
  [ -n "${PASSWORD:-}" ] && vars+=(--env-var "password=${PASSWORD}")
  [ -n "${CITY_TENANT:-}" ] && vars+=(--env-var "cityTenant=${CITY_TENANT}")
  [ -n "${STATE_TENANT:-}" ] && vars+=(--env-var "stateTenant=${STATE_TENANT}")
  [ -n "${USER_TYPE:-}" ] && vars+=(--env-var "userType=${USER_TYPE}")
  [ -n "${AUTHORIZATION:-}" ] && vars+=(--env-var "authorization=${AUTHORIZATION}")

  echo "==> Running complaints demo collection"
  "$NEWMAN_CMD" run "$COMPLAINTS_COLLECTION" ${NEWMAN_OPTS} "${vars[@]}"
}

run_core() {
  local -a vars=()
  [ -n "${BASE_URL:-}" ] && vars+=(--env-var "baseUrl=${BASE_URL}")

  echo "==> Running digit core validation collection"
  "$NEWMAN_CMD" run "$CORE_COLLECTION" ${NEWMAN_OPTS} "${vars[@]}"
}

case "$TARGET" in
  all)
    run_core
    run_complaints
    ;;
  core)
    run_core
    ;;
  complaints)
    run_complaints
    ;;
  *)
    echo "Usage: $0 [all|core|complaints]"
    exit 1
    ;;
esac
