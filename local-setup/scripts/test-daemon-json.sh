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

render() {  # size total registries_json -> daemon.json on stdout
  cat > "$WORK/render.yml" <<'PLAYBOOK'
- hosts: localhost
  gather_facts: false
  vars:
    _u: {k: 1024, m: 1048576, g: 1073741824}
    _sz: "{{ (docker_log_max_size | regex_search('^([0-9.]+)', '\\1') | first | float)
             * _u[(docker_log_max_size | regex_search('([kmgKMG])[bB]?$', '\\1') | first | lower)] }}"
    _tt: "{{ (docker_log_total_size | regex_search('^([0-9.]+)', '\\1') | first | float)
             * _u[(docker_log_total_size | regex_search('([kmgKMG])[bB]?$', '\\1') | first | lower)] }}"
    _cnt: "{{ docker_log_max_file | default([1, ((_tt | float) / (_sz | float)) | int] | max) }}"
  tasks:
    - copy:
        dest: "{{ out }}"
        content: >-
          {{ ({'log-driver': 'json-file',
               'log-opts': {'max-size': docker_log_max_size,
                            'max-file': _cnt | string}}
              | combine({'insecure-registries': insecure_registries}
                        if (insecure_registries | length > 0) else {})) | to_nice_json }}
PLAYBOOK
  ansible-playbook -i localhost, -c local "$WORK/render.yml" \
    -e "docker_log_max_size=$1" -e "docker_log_total_size=$2" \
    -e "{\"insecure_registries\": $3}" -e "out=$WORK/daemon.json" \
    >"$WORK/ansible.log" 2>&1 || { sed -n "1,40p" "$WORK/ansible.log" >&2; return 1; }
  cat "$WORK/daemon.json"
}

check() {  # label size total registries
  local label="$1" size="$2" total="$3" regs="$4"
  local json ok=1 detail=""

  if ! json="$(render "$size" "$total" "$regs")"; then
    echo "FAIL  $label — render failed"; fail=$((fail+1)); return
  fi

  # 1. valid JSON, and max-file must be a string
  if ! detail="$(python3 - "$json" <<'PY'
import json, sys
d = json.loads(sys.argv[1])
mf = d["log-opts"]["max-file"]
assert isinstance(mf, str), f"max-file is {type(mf).__name__}, Docker requires a string"
print(f'max-size={d["log-opts"]["max-size"]} max-file={mf} registries={len(d.get("insecure-registries", []))}')
PY
  )"; then ok=0; detail="invalid JSON or bad max-file type"; fi

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
check "defaults (100m/1g) + insecure registry" 100m 1g '["10.0.0.4:5000"]'
check "TLS registry — insecure-registries omitted" 100m 1g '[]'
check "small slice (50m/1g) -> 20 files"          50m  1g '[]'
check "large slice (250m/1g) -> 4 files"          250m 1g '[]'
check "slice equals cap (1g/1g) -> 1 file"        1g   1g '[]'
check "uppercase units (100M/1G)"                 100M 1G '[]'
check "non-integer division (300m/1g) -> 3 files" 300m 1g '[]'
check "sub-megabyte slice (512k/1g)"              512k 1g '[]'
check "smaller cap (10m/500m)"                    10m  500m '[]'

echo
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
