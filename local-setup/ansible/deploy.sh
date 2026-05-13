#!/bin/bash
# Single entrypoint for DIGIT production deploys.
#
#   ./deploy.sh nairobi              # full deploy
#   ./deploy.sh bomet --tags=nginx   # subset
#   ./deploy.sh nairobi --check      # dry-run + diff
#
# Tenants are defined in inventory/host_vars/<name>.yml. To add a new
# tenant: create a new host_vars file, list it under `digit:` in
# inventory/hosts.yml, seed its secrets in OpenBao, and run this script.
#
# This script intentionally has no per-tenant logic. The HMR-pre-check
# that used to live in deploy-nairobi.sh is now a pre_task inside the
# playbook itself, so it's tenant-agnostic.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

host="${1:-}"
if [[ -z "$host" ]]; then
  echo "usage: $0 <tenant>  [extra ansible-playbook args...]"
  echo ""
  echo "Available tenants:"
  ls inventory/host_vars/*.yml 2>/dev/null | xargs -n1 basename | sed 's/\.yml$//' | sed 's/^/  /'
  exit 1
fi

if [[ ! -f "inventory/host_vars/${host}.yml" ]]; then
  echo "ERROR: no host_vars for '${host}'."
  echo "Expected: inventory/host_vars/${host}.yml"
  exit 1
fi

shift
ansible-playbook \
  -i inventory/hosts.yml \
  --limit "$host" \
  playbook-deploy.yml \
  "$@"
