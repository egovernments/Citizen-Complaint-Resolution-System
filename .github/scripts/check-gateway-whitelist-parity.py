#!/usr/bin/env python3
"""CI guard: the compose Kong gateway's auth-optional whitelist must EXACTLY match
the K8s Spring gateway's open + mixed-mode whitelists (deployment-parity item #5,
Phase 3).

Both stacks classify a request as auth-optional (anonymous, and not action-RBAC'd)
by EXACT path membership. If the two lists drift, an endpoint could be anonymous on
one stack and protected on the other — a security-critical inconsistency. This
asserts the two lists are identical sets, so neither can drift unnoticed.

Sources of truth:
  - Kong:  local-setup/kong/kong.yml            -> the AUTH_OPTIONAL Lua set
  - K8s:   devops/deploy-as-code/charts/environments/env.yaml
             -> egov-open-endpoints-whitelist + egov-mixed-mode-endpoints-whitelist
"""
import re
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
KONG = ROOT / "local-setup/kong/kong.yml"
ENV = ROOT / "devops/deploy-as-code/charts/environments/env.yaml"


def kong_whitelist(text: str) -> set:
    block = re.search(r"local AUTH_OPTIONAL = \{(.*?)\n\s*\}", text, re.S)
    if not block:
        sys.exit("ERROR: AUTH_OPTIONAL set not found in local-setup/kong/kong.yml")
    return set(re.findall(r'\["(/[^"]+)"\]\s*=\s*true', block.group(1)))


def env_whitelist(text: str) -> set:
    paths = set()
    for key in ("egov-open-endpoints-whitelist", "egov-mixed-mode-endpoints-whitelist"):
        m = re.search(re.escape(key) + r'\s*:\s*"([^"]*)"', text)
        if not m:
            sys.exit(f"ERROR: {key} not found in env.yaml")
        paths |= {p.strip() for p in m.group(1).split(",") if p.strip()}
    return paths


def main() -> int:
    kong = kong_whitelist(KONG.read_text())
    env = env_whitelist(ENV.read_text())
    only_kong = sorted(kong - env)
    only_env = sorted(env - kong)
    if only_kong or only_env:
        print("Gateway auth-optional whitelist MISMATCH (Kong vs Spring gateway):\n")
        for p in only_kong:
            print(f"  + only in Kong (local-setup/kong/kong.yml):        {p}")
        for p in only_env:
            print(f"  - only in K8s  (env.yaml open+mixed whitelists):   {p}")
        print(
            "\nThe compose and K8s gateways classify by EXACT path membership, so these "
            "lists must be identical. Add/remove the path(s) in BOTH files."
        )
        return 1
    print(f"OK: gateway auth-optional whitelists match ({len(kong)} entries).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
