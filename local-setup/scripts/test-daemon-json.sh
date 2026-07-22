#!/usr/bin/env bash
# Render the daemon.json that the deploy would write, across a matrix of
# variable combinations, and check each one three ways:
#
#   1. it parses as JSON
#   2. `dockerd --validate` accepts it (catches type errors the JSON parser
#      cannot — e.g. max-file as an integer, which Docker rejects but JSON
#      considers perfectly valid)
#   3. the 1GB-per-container invariant actually holds: max-size * max-file
#      must not exceed docker_log_total_size
#
# Check 3 is the one that matters. dockerd will happily accept a config that
# allows 10GB per container; only arithmetic catches that.
#
# Usage: local-setup/scripts/test-daemon-json.sh
# Requires: ansible-playbook, python3. dockerd is optional — checks 1 and 3
# still run without it, and the script says so rather than silently skipping.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pass=0; fail=0
have_dockerd=0
if command -v dockerd >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  have_dockerd=1
else
  echo "NOTE: dockerd --validate unavailable (missing binary or passwordless sudo)."
  echo "      JSON-parse and cap-invariant checks still run; daemon acceptance does not."
  echo
fi

# The var block below mirrors playbook-deploy.yml's daemon.json tasks. Keep the
# two in step — a divergence here means the matrix stops testing the deploy.
# EXISTING (optional) is the daemon.json already on the host, so the merge path
# is exercised too, not just a first-ever write.
render() {  # size total registries_json [max_file_extra_var] -> daemon.json on stdout
  cat > "$WORK/render.yml" <<'PLAYBOOK'
- hosts: localhost
  gather_facts: false
  vars:
    _u: {k: 1024, m: 1048576, g: 1073741824}
    _sz: "{{ (docker_log_max_size | regex_search('^([0-9.]+)', '\\1') | first | float)
             * _u[(docker_log_max_size | regex_search('([kmgKMG])[bB]?$', '\\1') | first | lower)] }}"
    _tt: "{{ (docker_log_total_size | regex_search('^([0-9.]+)', '\\1') | first | float)
             * _u[(docker_log_total_size | regex_search('([kmgKMG])[bB]?$', '\\1') | first | lower)] }}"
    _cnt: "{{ docker_log_max_file
              | default([1, ((_tt | float) / (_sz | float)) | int] | max, true) }}"
    _existing: >-
      {{ (lookup('file', existing) | from_json) if existing else {} }}
    _ours: >-
      {{ {'log-driver': 'json-file',
          'log-opts': {'max-size': docker_log_max_size,
                       'max-file': _cnt | string},
          'insecure-registries': insecure_registries | default([])} }}
  tasks:
    - copy:
        dest: "{{ out }}"
        content: "{{ _existing | combine(_ours, recursive=True) | to_nice_json }}\n"
PLAYBOOK
  local extra=()
  if [ -n "${4:-}" ]; then extra=(-e "$4"); fi
  ansible-playbook -i localhost, -c local "$WORK/render.yml" \
    -e "docker_log_max_size=$1" -e "docker_log_total_size=$2" \
    -e "{\"insecure_registries\": $3}" -e "out=$WORK/daemon.json" \
    -e "existing=${EXISTING:-}" "${extra[@]}" \
    >"$WORK/ansible.log" 2>&1 || { sed -n "1,40p" "$WORK/ansible.log" >&2; return 1; }
  cat "$WORK/daemon.json"
}

check() {  # label size total registries expected_max_file [extra_vars_json]
  # Not named `extra`: render() has a local array by that name, and shellcheck
  # tracks the name globally — it would read this scalar as SC2178/SC2128.
  local label="$1" size="$2" total="$3" regs="$4" want="$5" extra_vars="${6:-}"
  local json ok=1 detail=""

  if ! json="$(render "$size" "$total" "$regs" "$extra_vars")"; then
    echo "FAIL  $label — render failed"; fail=$((fail+1)); return
  fi

  # 1. valid JSON, max-file a string, and the count is the one we expect.
  #    Asserting the count matters: a case whose extra vars silently fail to
  #    apply otherwise renders the default and passes, testing nothing.
  if ! detail="$(python3 - "$json" "$want" <<'PY'
import json, sys
d = json.loads(sys.argv[1])
mf = d["log-opts"]["max-file"]
assert isinstance(mf, str), f"max-file is {type(mf).__name__}, Docker requires a string"
assert mf == sys.argv[2], f"max-file is {mf}, expected {sys.argv[2]}"
print(f'max-size={d["log-opts"]["max-size"]} max-file={mf} registries={len(d.get("insecure-registries", []))}')
PY
  )"; then ok=0; detail="invalid JSON, bad max-file type, or wrong count"; fi

  # 2. dockerd accepts it
  if [ "$ok" = 1 ] && [ "$have_dockerd" = 1 ]; then
    printf '%s' "$json" > "$WORK/candidate.json"
    if ! sudo -n dockerd --validate --config-file="$WORK/candidate.json" >/dev/null 2>&1; then
      ok=0; detail="dockerd rejected the config"
    fi
  fi

  # 3. the cap invariant holds
  if [ "$ok" = 1 ]; then
    if ! python3 - "$json" "$total" <<'PY'
import json, re, sys
U = {"k": 1024, "m": 1048576, "g": 1073741824}
def b(v):
    m = re.match(r"^(\d+(?:\.\d+)?)([kmg])b?$", v.strip(), re.I)
    return float(m.group(1)) * U[m.group(2).lower()]
d = json.loads(sys.argv[1])
eff = b(d["log-opts"]["max-size"]) * int(d["log-opts"]["max-file"])
cap = b(sys.argv[2])
if eff > cap:
    print(f"effective {eff/1048576:.0f}MB exceeds cap {cap/1048576:.0f}MB", file=sys.stderr)
    sys.exit(1)
PY
    then ok=0; detail="cap invariant breached"; fi
  fi

  if [ "$ok" = 1 ]; then
    echo "ok    $label — $detail"; pass=$((pass+1))
  else
    echo "FAIL  $label — $detail"; fail=$((fail+1))
  fi
}

echo "=== daemon.json render matrix ==="
check "defaults (100m/1g) + insecure registry" 100m 1g '["10.0.0.4:5000"]' 10
check "TLS registry — insecure-registries empty"  100m 1g '[]'   10
check "small slice (50m/1g) -> 20 files"          50m  1g '[]'   20
check "large slice (250m/1g) -> 4 files"          250m 1g '[]'   4
check "slice equals cap (1g/1g) -> 1 file"        1g   1g '[]'   1
check "uppercase units (100M/1G)"                 100M 1G '[]'   10
check "non-integer division (300m/1g) -> 3 files" 300m 1g '[]'   3
check "sub-megabyte slice (512k/1g)"              512k 1g '[]'   2048
check "smaller cap (10m/500m)"                    10m  500m '[]' 50

# The escape hatch, uncommented and left blank -> YAML null. Without
# `default(..., true)` this renders "max-file": "None", which dockerd refuses.
check "blank max-file falls back to the derivation" 100m 1g '[]' 10 \
  '{"docker_log_max_file": null}'
check "explicit max-file overrides the derivation"  100m 1g '[]' 5 \
  '{"docker_log_max_file": 5}'

# ── Merging into an existing daemon.json ────────────────────────────────────
# Everything above renders onto an empty host. These start from a file already
# on disk, which is where the merge can go wrong in ways a fresh write cannot.

merge_check() {  # label existing_json assertion_py [registries_json]
  local label="$1"
  printf '%s' "$2" > "$WORK/existing.json"
  local json
  if ! json="$(EXISTING="$WORK/existing.json" render 100m 1g "${4:-[]}")"; then
    echo "FAIL  $label — render failed"; fail=$((fail+1)); return
  fi
  if printf '%s' "$3" | python3 - "$json"; then
    echo "ok    $label"; pass=$((pass+1))
  else
    echo "FAIL  $label"; fail=$((fail+1))
  fi
}

# combine() only adds and overwrites; it never drops a key the overlay omits.
# So insecure-registries has to be written unconditionally — omitting it when
# the list is empty would strand the old value on a host migrating to TLS.
merge_check "migrating to a TLS registry clears insecure-registries" \
  '{"insecure-registries": ["10.0.0.4:5000"]}' '
import json, sys
d = json.loads(sys.argv[1])
assert d.get("insecure-registries") == [], d.get("insecure-registries")
'

# The clobber this PR would otherwise have introduced by making the write
# unconditional: operator keys the deploy knows nothing about must survive.
merge_check "operator-set daemon keys survive the merge" \
  '{"storage-driver": "overlay2", "data-root": "/mnt/docker", "live-restore": true,
    "registry-mirrors": ["https://mirror.example"], "log-opts": {"max-size": "5m"}}' '
import json, sys
d = json.loads(sys.argv[1])
assert d["storage-driver"] == "overlay2"
assert d["data-root"] == "/mnt/docker"
assert d["live-restore"] is True
assert d["registry-mirrors"] == ["https://mirror.example"]
assert d["log-opts"]["max-size"] == "100m", d["log-opts"]   # ours wins
assert d["log-opts"]["max-file"] == "10"
'

echo
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
