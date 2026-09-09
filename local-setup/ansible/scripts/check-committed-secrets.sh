#!/usr/bin/env bash
# Fail if a tracked file ships a real credential. This repo is PUBLIC: a secret
# committed here is disclosed the moment it lands, and rotating later does not
# undo it. Defence in depth — rotation is the real remedy, this stops regressions.
#
# Run locally:  local-setup/ansible/scripts/check-committed-secrets.sh
set -uo pipefail

# Fail CLOSED: a scanner that reports OK because its own tooling is missing is
# worse than none.
command -v git >/dev/null 2>&1 || { echo "FAIL: git not found."; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "FAIL: python3 not found."; exit 1; }
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "FAIL: not a git repository."; exit 1; }
cd "$ROOT" || { echo "FAIL: cannot cd to $ROOT"; exit 1; }
fail=0

# ---------------------------------------------------------------------------
# 1. Secret-named keys in tracked inventory files must be placeholders.
#    A YAML walk (not a line grep) so quoting, flow-style {a: b}, and
#    continuation-line scalars cannot smuggle a value past the check.
# ---------------------------------------------------------------------------
echo "==> secret values in tracked inventory / env-example files"
python3 - <<'PY' || fail=1
import subprocess, sys, glob, os
try:
    import yaml
except ImportError:
    print("FAIL: PyYAML not available — cannot parse inventory safely."); sys.exit(1)

# Scan ALL inventory + group_vars + hosts + env-example files, not just host_vars
# (group_vars/all.yml, hosts.yml.example etc. share the same var namespace).
patterns = [
    "local-setup/ansible/inventory/host_vars/*",
    "local-setup/ansible/inventory/group_vars/*",
    "local-setup/ansible/inventory/hosts.yml*",
]
tracked = set(subprocess.run(["git","ls-files"],capture_output=True,text=True).stdout.split("\n"))
files = sorted({f for pat in patterns for f in glob.glob(pat)
                if f in tracked and f.rsplit(".",1)[-1] in ("yml","yaml","example")})
if not files:
    print("FAIL: no tracked inventory files matched — path moved or ls-files failed."); sys.exit(1)

SECRET_KEYS = {
  "postgres_password","mcp_db_password","minio_root_user","minio_root_password",
  "elasticsearch_master_password","elasticsearch_password","egov_hrms_default_password",
  "keycloak_admin_password","keycloak_db_password","keycloak_google_client_secret",
  "token_exchange_system_password","bootstrap_password","grafana_admin_password",
  "novu_jwt_secret","novu_store_encryption_key","novu_secret_key","novu_mongo_password",
}
PLACEHOLDERS = {"", "CHANGE_ME", None}
import re as _re
# a value that is obviously a "change me" instruction, not a real secret
_PLACEHOLDER_RE = _re.compile(r"^(change[_-]?me|replace[_-]?me|change-me-strong|REPLACE_ME[A-Z_]*)", _re.I)
# Dump-fixture files use a PUBLIC dataset; only these exact (key,value) pairs are
# permitted there, and ONLY there. Any other value — or any of these in a real
# tenant file — fails. Key+value scoped so a real secret can't hide in a fixture.
FIXTURES = {"localhost-full.yml.example","localhost-slim.yml.example","quickstart.yml.example"}
FIXTURE_OK = {
  ("elasticsearch_master_password","asd@#$@$!132123"),
  ("postgres_password","egov123"), ("mcp_db_password","egov123"),
  ("minio_root_user","minioadmin"), ("minio_root_password","minioadmin"),
  ("egov_hrms_default_password","eGov@123"), ("keycloak_admin_password","eGov@123"),
  ("keycloak_db_password","eGov@123"), ("token_exchange_system_password","eGov@123"),
}

def walk(node, hits):
    if isinstance(node, dict):
        for k,v in node.items():
            if isinstance(k,str) and k in SECRET_KEYS and not isinstance(v,(dict,list)):
                hits.append((k, v))
            walk(v, hits)
    elif isinstance(node, list):
        for v in node: walk(v, hits)

bad = 0
for f in files:
    base = os.path.basename(f)
    try:
        docs = list(yaml.safe_load_all(open(f)))
    except Exception as e:
        print(f"FAIL: {f}: cannot parse YAML ({e})"); bad += 1; continue
    hits = []
    for d in docs: walk(d, hits)
    for k, v in hits:
        val = v if v is None else str(v)
        if val in PLACEHOLDERS or _PLACEHOLDER_RE.match(val or ""): continue
        if base in FIXTURES and (k, val) in FIXTURE_OK: continue
        print(f"FAIL: {f}: `{k}` ships a non-placeholder value "
              f"({'<fixture value not on allowlist>' if base in FIXTURES else 'real secret in tracked file'})")
        bad += 1
if bad: sys.exit(1)
print("  OK: every secret-named key is a placeholder (or an allowlisted fixture value).")
PY

# ---------------------------------------------------------------------------
# 2. API keys / private keys anywhere in tracked files.
#    PEM regex allows LEADING WHITESPACE (keys live indented inside YAML block
#    scalars — the exact case that let a live RSA deploy key through before) and
#    matches PKCS#8 `BEGIN PRIVATE KEY` too.
# ---------------------------------------------------------------------------
echo "==> API keys and private keys in tracked files"
patterns=(
  'AIza[0-9A-Za-z_-]{30,}'                                   # Google API key
  '-----BEGIN ([A-Z0-9]+ )?PRIVATE KEY-----'                # any PEM private key, indented or not
  'aws_secret_access_key[[:space:]]*=[[:space:]]*[A-Za-z0-9/+=]{30,}'
  'xox[baprs]-[0-9A-Za-z-]{10,}'                             # Slack token
  'gh[pousr]_[0-9A-Za-z]{30,}'                               # GitHub token
)
for p in "${patterns[@]}"; do
  # scope-out this script, node_modules, and the vendored Bitnami/kafka charts
  # whose NOTES/values only DOCUMENT PEM markers (verified: no key bodies).
  hits=$(git grep -InE -e "$p" -- ':!*node_modules*' ':!*check-committed-secrets.sh' \
         ':!*backbone-services/matomo/values.yaml' ':!*kafka-kraft/templates/NOTES.txt' 2>/dev/null)
  rc=$?
  if [[ $rc -gt 1 ]]; then echo "FAIL: git grep errored (rc=$rc) on /$p/"; fail=1; continue; fi
  if [[ -n "$hits" ]]; then echo "FAIL: pattern /$p/ found:"; sed 's/^/    /' <<<"$hits"; fail=1; fi
done

if [[ $fail -eq 0 ]]; then echo "OK: no committed secrets found."
else echo; echo "A tracked file ships a real credential. Placeholder it, and ROTATE the exposed value — it is public."; fi
exit $fail
