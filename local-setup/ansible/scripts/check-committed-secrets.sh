#!/usr/bin/env bash
# Fail if a tracked file ships a real credential.
#
# This repo is PUBLIC. A secret committed here is disclosed the moment it lands,
# and rotating it later does not undo that — the audit found working postgres,
# MinIO, Keycloak and Google Maps credentials for named deployments sitting in
# tracked *.yml.example files and a checked-in globalConfigsPGR.js.
#
# Run locally:  local-setup/ansible/scripts/check-committed-secrets.sh
set -uo pipefail

# Fail CLOSED. A secrets scanner that reports "OK" because its own tooling is
# missing is worse than no scanner: it turns a broken check into a green tick.
# Every precondition below aborts rather than skipping.
command -v git >/dev/null 2>&1 || { echo "FAIL: git not found — cannot enumerate tracked files."; exit 1; }
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "FAIL: not a git repository."; exit 1; }
cd "$ROOT" || { echo "FAIL: cannot cd to $ROOT"; exit 1; }

fail=0
note() { printf '  %s\n' "$*"; }

# ---------------------------------------------------------------------------
# 1. bootstrap_secrets in tracked host_vars templates must be placeholders.
#
# EXCEPTION: the localhost-*/quickstart templates are local fixtures for the
# PUBLIC db_fast_path dump that ships with this repo. Their postgres and
# elasticsearch values are what that dump's roles and eg_enc_*_keys were built
# with — the dataset is public, so those are not secrets, and replacing them
# breaks the local stack (egov-enc-service throws AEADBadTagException at boot).
# ---------------------------------------------------------------------------
DUMP_FIXTURES='localhost-full.yml.example|localhost-slim.yml.example|quickstart.yml.example'
SECRET_KEYS='postgres_password|mcp_db_password|minio_root_user|minio_root_password|elasticsearch_master_password|egov_hrms_default_password|keycloak_admin_password|keycloak_db_password|token_exchange_system_password|novu_jwt_secret|novu_store_encryption_key|novu_secret_key|novu_mongo_password'

echo "==> bootstrap_secrets placeholders in tracked host_vars templates"
# Read the list up front so an empty/failed listing is an ERROR, not a silent
# pass over zero files.
HOST_VAR_FILES=()
while IFS= read -r line; do [[ -n "$line" ]] && HOST_VAR_FILES+=("$line"); done \
  < <(git ls-files 'local-setup/ansible/inventory/host_vars/*')
if [[ ${#HOST_VAR_FILES[@]} -eq 0 ]]; then
  echo "FAIL: no tracked host_vars files found — the path moved, or git ls-files failed."
  echo "      Refusing to report success on an empty scan."
  exit 1
fi
while IFS= read -r f; do
  [[ "$f" =~ $DUMP_FIXTURES ]] && { note "skip (public dump fixture): $f"; continue; }
  # A value is acceptable when it is CHANGE_ME, empty, or '' / "".
  bad=$(grep -nE "^[[:space:]]+($SECRET_KEYS):[[:space:]]*[\"']?[^\"'#[:space:]]" "$f" 2>/dev/null \
        | grep -vE ":[[:space:]]*[\"']?CHANGE_ME[\"']?[[:space:]]*(#.*)?$" || true)
  if [[ -n "$bad" ]]; then
    echo "FAIL: $f ships non-placeholder secret values:"
    sed 's/^/    /' <<<"$bad"
    fail=1
  fi
done < <(printf '%s\n' "${HOST_VAR_FILES[@]}")

# ---------------------------------------------------------------------------
# 2. No API keys / private keys anywhere in tracked files.
# ---------------------------------------------------------------------------
echo "==> API keys and private keys in tracked files"
patterns=(
  'AIza[0-9A-Za-z_-]{30,}'                 # Google API key
  '^[^#/*[:space:]]*-----BEGIN (RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY-----'
  'aws_secret_access_key\s*=\s*[A-Za-z0-9/+=]{30,}'
  'xox[baprs]-[0-9A-Za-z-]{10,}'           # Slack token
  'gh[pousr]_[0-9A-Za-z]{30,}'             # GitHub token
)
for p in "${patterns[@]}"; do
  hits=$(git grep -InE "$p" -- ':!*node_modules*' ':!*/test/fixtures/*' ':!*check-committed-secrets.sh' 2>/dev/null)
  rc=$?
  if [[ $rc -gt 1 ]]; then
    echo "FAIL: git grep errored (rc=$rc) scanning /$p/ — treating as unscanned."
    fail=1
    continue
  fi
  if [[ -n "$hits" ]]; then
    echo "FAIL: pattern /$p/ found in tracked files:"
    sed 's/^/    /' <<<"$hits"
    fail=1
  fi
done

if [[ $fail -eq 0 ]]; then
  echo "OK: no committed secrets found."
else
  echo
  echo "A tracked file ships a real credential. Replace it with CHANGE_ME (or an"
  echo "inventory variable), and ROTATE the exposed credential — it is public."
fi
exit $fail
