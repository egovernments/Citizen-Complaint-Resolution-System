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

Run with --self-test to verify the comparison logic itself catches drift.
"""
import re
import sys
import pathlib

import yaml  # robust YAML parsing (handles block scalars / reformatting)

ROOT = pathlib.Path(__file__).resolve().parents[2]
KONG = ROOT / "local-setup/kong/kong.yml"
ENV = ROOT / "devops/deploy-as-code/charts/environments/env.yaml"

_ENTRY = re.compile(r'\["(/[^"]+)"\]\s*=\s*true')


def _find_value(node, key):
    """First value for `key` anywhere in a nested dict/list, else None."""
    if isinstance(node, dict):
        if key in node:
            return node[key]
        for v in node.values():
            r = _find_value(v, key)
            if r is not None:
                return r
    elif isinstance(node, list):
        for v in node:
            r = _find_value(v, key)
            if r is not None:
                return r
    return None


def _find_lua(node, marker):
    """First string value containing `marker` anywhere in the tree, else None."""
    if isinstance(node, str):
        return node if marker in node else None
    if isinstance(node, dict):
        for v in node.values():
            r = _find_lua(v, marker)
            if r:
                return r
    if isinstance(node, list):
        for v in node:
            r = _find_lua(v, marker)
            if r:
                return r
    return None


def kong_whitelist(text: str) -> set:
    lua = _find_lua(yaml.safe_load(text), "AUTH_OPTIONAL")
    if not lua:
        sys.exit("ERROR: AUTH_OPTIONAL pre-function not found in local-setup/kong/kong.yml")
    # Only the exact-match set keys are extracted, so nested Lua tables can't confuse it.
    return set(_ENTRY.findall(lua))


def env_whitelist(text: str) -> set:
    data = yaml.safe_load(text)
    paths = set()
    for key in ("egov-open-endpoints-whitelist", "egov-mixed-mode-endpoints-whitelist"):
        val = _find_value(data, key)
        if val is None:
            sys.exit(f"ERROR: {key} not found in env.yaml")
        paths |= {p.strip() for p in str(val).split(",") if p.strip()}
    return paths


def diff(kong: set, env: set):
    return sorted(kong - env), sorted(env - kong)


def report(kong: set, env: set) -> int:
    only_kong, only_env = diff(kong, env)
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


def self_test() -> int:
    base = {"/a", "/b", "/c"}
    assert diff(base, base) == ([], []), "identical sets must not diff"
    assert diff(base | {"/x"}, base) == (["/x"], []), "extra-in-kong not detected"
    assert diff(base, base | {"/y"}) == ([], ["/y"]), "extra-in-env not detected"
    print("self-test OK: drift is detected in both directions.")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    return report(kong_whitelist(KONG.read_text()), env_whitelist(ENV.read_text()))


if __name__ == "__main__":
    sys.exit(main())
