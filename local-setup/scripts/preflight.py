#!/usr/bin/env python3
"""Pre-flight gate for tenant deploy configs (host_vars/<tenant>.yml).

Rules-as-code, not rules-as-schema: every rule is a small function with a
`why` string citing the real incident it encodes. Checks run in deploy.sh on
the controller — the only place that can see the operator's actual host_vars
(tenant files are gitignored; CI only ever sees _example.yml and fixtures).
CI runs the same rules via --self-test (embedded cases) and against
committed fixtures, proving the rule logic without needing real configs.

Add a rule when an incident bites; don't add speculative ones. A false
positive here costs operator trust in the whole gate.

Usage:
  preflight.py inventory/host_vars/mytenant.yml      # gate one config
  preflight.py --fixtures tests/fixtures/host_vars/  # CI: *.yml in a dir
  preflight.py --self-test                           # rule unit tests
  SKIP_PREFLIGHT=1 ./deploy.sh mytenant              # escape hatch
"""

import argparse
import glob
import os
import re
import sys

try:
    import yaml
except ImportError:  # PyYAML ships with ansible — same machine, same env
    sys.exit("preflight: PyYAML not importable (it ships with ansible — is ansible installed?)")

# The combined dump's eg_enc_*_keys were sealed with this master password.
# It is already tracked in _example.yml and docker-compose.egov-digit.yaml;
# repeating it here adds no exposure.
DUMP_MASTER_PASSWORD = "asd@#$@$!132123"

FAIL = "FAIL"
WARN = "WARN"

RULES = []


def rule(rule_id, why):
    def deco(fn):
        RULES.append((rule_id, why, fn))
        return fn
    return deco


def get(cfg, path, default=None):
    cur = cfg
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return default
        cur = cur[part]
    return cur


# ── Rules (each cites its incident) ─────────────────────────────────────────

@rule(
    "fastpath-data-wipe-ack",
    "db_fast_path corrects the postgres volume mount path, which forces "
    "container recreation and WIPES data stored in an anonymous volume. "
    "Bomet/Nairobi production boxes are exactly in that state — flipping the "
    "flag there destroys live tenant data.",
)
def r_fastpath_ack(cfg):
    if get(cfg, "db_fast_path") is True and get(cfg, "db_fast_path_ack_data_wipe") is not True:
        yield (FAIL,
               "db_fast_path: true requires db_fast_path_ack_data_wipe: true — "
               "confirm the target has NO live data in an anonymous postgres volume.")


@rule(
    "fastpath-master-password",
    "The dump's eg_enc_symmetric/asymmetric keys were generated with a fixed "
    "MASTER_PASSWORD. A mismatching elasticsearch_master_password makes "
    "egov-enc-service throw AEADBadTagException on boot and every encrypted "
    "row becomes unreadable.",
)
def r_fastpath_master_password(cfg):
    if get(cfg, "db_fast_path") is True:
        got = get(cfg, "bootstrap_secrets.elasticsearch_master_password")
        if got != DUMP_MASTER_PASSWORD:
            yield (FAIL,
                   "db_fast_path: true requires bootstrap_secrets.elasticsearch_master_password "
                   "to equal the dump's master password (see _example.yml) — got "
                   + ("(unset)" if got is None else "a different value") + ".")


@rule(
    "keycloak-combo",
    "auth_provider: keycloak with enable_keycloak unset deploys a UI that "
    "redirects to a Keycloak that was never brought up — every login dead-ends. "
    "Found at validate-time ~30 minutes into a deploy instead of in 2 seconds.",
)
def r_keycloak(cfg):
    if get(cfg, "auth_provider") == "keycloak":
        if get(cfg, "enable_keycloak") is not True:
            yield (FAIL, "auth_provider: keycloak requires enable_keycloak: true.")
        if not get(cfg, "bootstrap_secrets.keycloak_admin_password"):
            yield (FAIL, "auth_provider: keycloak requires bootstrap_secrets.keycloak_admin_password.")


@rule(
    "digit-ui-v2-combo",
    "nginx_features.digit_ui_v2 renders /citizen/ location blocks pointing at "
    "a bundle that nothing builds unless enable_digit_ui_v2 is also on — "
    "users get 404s; historically also a playbook NPE (fixed in 317ec44d4) "
    "when the repo/branch vars were missing.",
)
def r_digit_ui_v2(cfg):
    if get(cfg, "nginx_features.digit_ui_v2") is True and get(cfg, "enable_digit_ui_v2") is not True:
        yield (FAIL, "nginx_features.digit_ui_v2: true requires enable_digit_ui_v2: true.")


@rule(
    "mcp-needs-registry",
    "digit-mcp images live on the Hetzner-VPC registry (10.0.0.4:5000) which "
    "is unreachable from public boxes — the pull fails ~20 minutes into the "
    "run. Fail in seconds instead. (Reachability itself is deliberately not "
    "probed here: static gate, no network.)",
)
def r_mcp_registry(cfg):
    if get(cfg, "enable_mcp") is True and not get(cfg, "docker_registry"):
        yield (FAIL, "enable_mcp: true requires docker_registry to be set to a registry the TARGET can reach.")


@rule(
    "mobile-config-consistency",
    "common-masters.MobileNumberValidation (the playbook's own preflight "
    "hard-fail, playbook-deploy.yml) only accepts countryCode + "
    "mobileNumberRegex — length and allowed starting digits are derived from "
    "the regex at runtime (filter_plugins/mobile.py, tests/global-setup.ts), "
    "not carried as separate fields. A regex that fails to compile breaks "
    "that derivation everywhere it's used, and citizens/tests mint numbers "
    "the server rejects with INVALID_MOBILE_FORMAT (PR #841 discussion).",
)
def r_mobile(cfg):
    mc = get(cfg, "core_mobile_configs")
    if not isinstance(mc, dict) or not mc:
        return
    regex = mc.get("mobileNumberRegex")
    if not regex:
        yield (WARN, "core_mobile_configs has no mobileNumberRegex — egov-user gets no rule to enforce.")
        return
    try:
        re.compile(str(regex))
    except re.error as e:
        yield (FAIL, f"mobileNumberRegex does not compile: {e}")
    if not mc.get("countryCode"):
        yield (WARN, "core_mobile_configs has no countryCode — UI mobile-prefix hints will be wrong.")


@rule(
    "boot-tenant-prefix",
    "boot_tenant must live under state_root (e.g. ke.bomet under ke), or equal "
    "state_root itself for cross-root bootstrap tenants (e.g. Maputo: "
    "boot_tenant pg, state_root pg, state_tenant_id mz — the MCP-bootstrapped "
    "root differs from the boot-time root by design). A pair that matches "
    "neither seeds city data under a root the services never query — "
    "everything 'succeeds' and nothing is visible.",
)
def r_boot_tenant(cfg):
    boot = get(cfg, "boot_tenant")
    root = get(cfg, "state_root") or get(cfg, "state_tenant_id")
    if boot and root and boot != root and not str(boot).startswith(str(root) + "."):
        yield (FAIL, f"boot_tenant '{boot}' is not under state_root '{root}'.")


@rule(
    "ci-tests-need-boot-tenant",
    "run_ci_tests drives the XLSX dataloader + Playwright against boot_tenant; "
    "it was once silently defaulted to ke.bomet and ran Kenya tests against "
    "the wrong deployment. The playbook now uses `| mandatory` — this gives "
    "the answer in 2 seconds instead of mid-run.",
)
def r_ci_tests(cfg):
    if get(cfg, "run_ci_tests") is True and not get(cfg, "boot_tenant"):
        yield (FAIL, "run_ci_tests: true requires boot_tenant.")


@rule(
    "digit-ui-mode-enum",
    "digit_ui_mode drives a three-way converge (static|hmr|container) — both "
    "static and hmr bind port 18080, so a typo'd mode skips the kill-the-other-"
    "runner step and the deploy fights itself over the port.",
)
def r_ui_mode(cfg):
    mode = get(cfg, "digit_ui_mode")
    if mode is not None and mode not in ("static", "hmr", "container"):
        yield (FAIL, f"digit_ui_mode '{mode}' is not one of: static, hmr, container.")


@rule(
    "configurator-build-path",
    "nginx_features.configurator serves /configurator/ from the rsynced "
    "configurator_build dist. Unset (or pointing at a missing path on this "
    "controller) ships an empty or stale UI.",
)
def r_configurator(cfg):
    if get(cfg, "nginx_features.configurator") is True:
        build = get(cfg, "configurator_build")
        if not build:
            yield (WARN, "nginx_features.configurator: true but configurator_build is unset — "
                         "the existing /var/www/configurator on the target (if any) is served as-is.")
        elif not os.path.isdir(os.path.expanduser(str(build))):
            yield (WARN, f"configurator_build '{build}' does not exist on this controller — rsync will fail.")


# ── Engine ──────────────────────────────────────────────────────────────────

def load_config(host_vars_path):
    """host_vars merged over inventory group_vars (all.yml, digit.yml) when
    they sit in the conventional ../../group_vars relative location."""
    merged = {}
    inv_dir = os.path.dirname(os.path.dirname(os.path.abspath(host_vars_path)))
    for name in ("all.yml", "digit.yml"):
        gv = os.path.join(inv_dir, "group_vars", name)
        if os.path.isfile(gv):
            with open(gv) as f:
                merged.update(yaml.safe_load(f) or {})
    with open(host_vars_path) as f:
        merged.update(yaml.safe_load(f) or {})
    return merged


def run_rules(cfg):
    findings = []
    for rule_id, why, fn in RULES:
        for severity, msg in fn(cfg) or []:
            findings.append((severity, rule_id, msg, why))
    return findings


def report(path, findings, strict):
    bad = False
    for severity, rule_id, msg, why in findings:
        effective = FAIL if (strict and severity == WARN) else severity
        print(f"[{effective}] {rule_id}: {msg}")
        print(f"       why: {why}")
        if effective == FAIL:
            bad = True
    if not findings:
        print(f"[ OK ] {path}: all {len(RULES)} rules pass")
    return bad


_SIZE_RE = re.compile(r"^(\d+(?:\.\d+)?)([kmg])b?$", re.IGNORECASE)
_UNITS = {"k": 1024, "m": 1048576, "g": 1073741824}


def _parse_size(val):
    """Return bytes for '100m'/'1G'/'512k', or None if unparseable."""
    if not isinstance(val, str):
        return None
    m = _SIZE_RE.match(val.strip())
    if not m:
        return None
    return float(m.group(1)) * _UNITS[m.group(2).lower()]


@rule(
    "docker-log-rotation",
    "docker_log_max_size / docker_log_total_size are fed straight into a Jinja "
    "size parser that builds daemon.json log-opts. A value without a unit "
    "('100'), a non-size ('abc') or an empty string raises an unhandled "
    "templating error mid-deploy; '0m' divides by zero. A max-size larger than "
    "the total silently allows more than the cap, because Docker always keeps "
    "at least one log file per container. docker_log_max_file is a file count, "
    "not a size — a unit on it ('10m') reaches daemon.json and dockerd refuses "
    "to start.",
)
def r_docker_log_rotation(cfg):
    raw_size = get(cfg, "docker_log_max_size")
    raw_total = get(cfg, "docker_log_total_size")

    for key, raw in (("docker_log_max_size", raw_size),
                     ("docker_log_total_size", raw_total)):
        if raw is None:
            continue  # unset is fine — group_vars supplies the default
        if _parse_size(raw) is None:
            yield (FAIL,
                   f"{key}: {raw!r} is not a valid Docker size. Use a number "
                   f"with a k/m/g unit, e.g. '100m' or '1g'.")
        elif _parse_size(raw) == 0:
            yield (FAIL,
                   f"{key}: {raw!r} is zero. Docker would reject it and the "
                   f"file-count derivation divides by it.")

    size = _parse_size(raw_size) if raw_size is not None else None
    total = _parse_size(raw_total) if raw_total is not None else None
    if size and total and size > total:
        yield (FAIL,
               f"docker_log_max_size ({raw_size}) exceeds docker_log_total_size "
               f"({raw_total}). Docker keeps at least one file per container, so "
               f"the effective cap would be {raw_size}, not {raw_total}.")

    # A falsy value (null, 0, '') is treated as unset: the playbook derives the
    # count with `default(..., true)`, which substitutes for those too. Anything
    # truthy is an explicit override and has to be a positive integer — it is a
    # file count, not a size, but it sits between two size-string vars in both
    # this rule and group_vars, so 'docker_log_max_file: 10m' is an easy slip.
    # Convert it defensively: an unguarded float() would kill preflight with a
    # traceback instead of the actionable message this tool exists to print.
    raw_count = get(cfg, "docker_log_max_file")
    if raw_count:
        try:
            count = int(str(raw_count).strip())
            if count < 1:
                raise ValueError(raw_count)
        except (TypeError, ValueError):
            yield (FAIL,
                   f"docker_log_max_file: {raw_count!r} is not a positive "
                   f"integer. It is a file count, not a size — Docker rejects "
                   f"anything else. Drop the unit, or unset it and let "
                   f"docker_log_total_size derive the count.")
        else:
            eff = size * count if (size and total) else None
            if eff is not None and eff > total:
                yield (WARN,
                       f"docker_log_max_file pins the count directly, so the "
                       f"cap is {raw_size} x {count} = {eff / 1048576:.0f} MB, "
                       f"above docker_log_total_size ({raw_total}).")


# ── Self-test: each rule gets a firing and a non-firing case ────────────────

SELF_TEST_CASES = [
    # ── docker log rotation ──
    ("log size without a unit fires", {"docker_log_max_size": "100"},
     {"docker-log-rotation"}),
    ("log size that is not a size fires", {"docker_log_max_size": "abc"},
     {"docker-log-rotation"}),
    ("empty log size fires", {"docker_log_max_size": ""},
     {"docker-log-rotation"}),
    ("zero log size fires", {"docker_log_max_size": "0m"},
     {"docker-log-rotation"}),
    ("log max-size above the total cap fires",
     {"docker_log_max_size": "2g", "docker_log_total_size": "1g"},
     {"docker-log-rotation"}),
    ("explicit max-file breaching the cap warns",
     {"docker_log_max_size": "500m", "docker_log_total_size": "1g",
      "docker_log_max_file": 10},
     {"docker-log-rotation"}),
    ("max-file written as a size string fires (would crash on float())",
     {"docker_log_max_size": "100m", "docker_log_total_size": "1g",
      "docker_log_max_file": "10m"},
     {"docker-log-rotation"}),
    ("max-file that is not a number fires",
     {"docker_log_max_size": "100m", "docker_log_total_size": "1g",
      "docker_log_max_file": "abc"},
     {"docker-log-rotation"}),
    ("zero max-file fires",
     {"docker_log_max_size": "100m", "docker_log_total_size": "1g",
      "docker_log_max_file": -1},
     {"docker-log-rotation"}),
    ("max-file left blank is clean — the playbook derives it",
     {"docker_log_max_size": "100m", "docker_log_total_size": "1g",
      "docker_log_max_file": None}, set()),
    ("max-file as a string integer is clean",
     {"docker_log_max_size": "100m", "docker_log_total_size": "1g",
      "docker_log_max_file": "10"}, set()),
    ("defaults are clean",
     {"docker_log_max_size": "100m", "docker_log_total_size": "1g"}, set()),
    ("uppercase units are clean",
     {"docker_log_max_size": "100M", "docker_log_total_size": "1G"}, set()),
    ("size equal to the total is clean",
     {"docker_log_max_size": "1g", "docker_log_total_size": "1g"}, set()),
    ("unset log vars are clean (group_vars supplies defaults)", {}, set()),
    # (description, cfg, expected rule ids that FAIL/WARN)
    ("fastpath without ack fires", {"db_fast_path": True,
      "bootstrap_secrets": {"elasticsearch_master_password": DUMP_MASTER_PASSWORD}},
     {"fastpath-data-wipe-ack"}),
    ("fastpath with ack + right password is clean", {"db_fast_path": True,
      "db_fast_path_ack_data_wipe": True,
      "bootstrap_secrets": {"elasticsearch_master_password": DUMP_MASTER_PASSWORD}},
     set()),
    ("fastpath wrong master password fires", {"db_fast_path": True,
      "db_fast_path_ack_data_wipe": True,
      "bootstrap_secrets": {"elasticsearch_master_password": "nope"}},
     {"fastpath-master-password"}),
    ("keycloak provider without stack fires twice", {"auth_provider": "keycloak"},
     {"keycloak-combo"}),
    ("keycloak fully wired is clean", {"auth_provider": "keycloak", "enable_keycloak": True,
      "bootstrap_secrets": {"keycloak_admin_password": "x"}},
     set()),
    ("ui-v2 nginx without enable fires", {"nginx_features": {"digit_ui_v2": True}},
     {"digit-ui-v2-combo"}),
    ("mcp without registry fires", {"enable_mcp": True, "docker_registry": ""},
     {"mcp-needs-registry"}),
    ("non-compiling mobileNumberRegex fires",
     {"core_mobile_configs": {"countryCode": "+254", "mobileNumberRegex": "^[17("}},
     {"mobile-config-consistency"}),
    ("missing countryCode warns", {"core_mobile_configs": {"mobileNumberRegex": "^[17][0-9]{8}$"}},
     {"mobile-config-consistency"}),
    ("kenya-shaped countryCode + mobileNumberRegex is clean",
     {"core_mobile_configs": {"countryCode": "+254", "mobileNumberRegex": "^0?[17][0-9]{8}$"}},
     set()),
    ("boot tenant outside state root fires",
     {"boot_tenant": "mz.maputo", "state_tenant_id": "ke"},
     {"boot-tenant-prefix"}),
    ("maputo-style cross-root bootstrap is clean (boot_tenant == state_root, "
     "differs from state_tenant_id)",
     {"boot_tenant": "pg", "state_root": "pg", "state_tenant_id": "mz"},
     set()),
    ("ci tests without boot tenant fires", {"run_ci_tests": True},
     {"ci-tests-need-boot-tenant"}),
    ("bad ui mode fires", {"digit_ui_mode": "docker"},
     {"digit-ui-mode-enum"}),
    ("configurator without build warns", {"nginx_features": {"configurator": True}},
     {"configurator-build-path"}),
    ("empty config is clean", {}, set()),
]


def self_test():
    failures = 0
    for desc, cfg, expected in SELF_TEST_CASES:
        fired = {rule_id for _, rule_id, _, _ in run_rules(cfg)}
        if fired != expected:
            print(f"[self-test FAIL] {desc}: expected {sorted(expected)}, fired {sorted(fired)}")
            failures += 1
        else:
            print(f"[self-test ok ] {desc}")
    print(f"self-test: {len(SELF_TEST_CASES) - failures}/{len(SELF_TEST_CASES)} cases pass")
    return failures == 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("config", nargs="*", help="host_vars YAML file(s) to gate")
    ap.add_argument("--fixtures", help="directory of *.yml fixture configs (CI mode)")
    ap.add_argument("--self-test", action="store_true", help="run embedded rule unit tests")
    ap.add_argument("--strict", action="store_true", help="treat WARN as FAIL")
    args = ap.parse_args()

    if args.self_test:
        sys.exit(0 if self_test() else 1)

    paths = list(args.config)
    if args.fixtures:
        paths += sorted(glob.glob(os.path.join(args.fixtures, "*.yml")))
    if not paths:
        ap.error("no config given (file args, --fixtures, or --self-test)")

    any_bad = False
    for path in paths:
        print(f"── preflight: {path}")
        cfg = load_config(path)
        # Fixture convention: files named invalid-*.yml MUST fire something;
        # valid-*.yml must be clean. Lets CI assert both directions.
        findings = run_rules(cfg)
        base = os.path.basename(path)
        if base.startswith("invalid-"):
            if not any(s == FAIL for s, *_ in findings):
                print(f"[FAIL] fixture {base} was expected to trip a rule and didn't")
                any_bad = True
            else:
                report(path, findings, args.strict)
                print(f"[ OK ] fixture {base} tripped rules as expected")
            continue
        any_bad |= report(path, findings, args.strict)

    sys.exit(1 if any_bad else 0)


if __name__ == "__main__":
    main()
