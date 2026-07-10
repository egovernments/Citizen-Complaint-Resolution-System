#!/usr/bin/env python3
"""CI guard: every Flyway history table baked into the compose dump must line up
with the Flyway-enabled service that owns it (deployment-parity item #10).

The compose stack boots from a prebuilt dump (local-setup/db/full-dump.sql) and
then lets each service's Flyway apply anything newer on top. Flyway decides "what
have I already applied?" by reading a per-service history table named by
SPRING_FLYWAY_TABLE. If the name a service looks for does NOT match the history
table the dump actually shipped, Flyway sees an empty history, re-runs its
migrations from scratch, and hits `relation already exists` (42P07) on the first
CREATE — the service crashes on boot. (This bit egov-url-shortening; the fix was a
one-line SPRING_FLYWAY_TABLE override.)

This asserts the two sides stay aligned so the mismatch is caught in a PR instead
of at boot:

  A. Every ENABLED service's SPRING_FLYWAY_TABLE is either present in the dump
     (aligned) or an acknowledged baseline-fresh service (BASELINE_FRESH) whose
     data tables are NOT in the dump, so it migrates from empty.

  B. Every Flyway history table IN the dump is claimed by an ENABLED service
     (via SPRING_FLYWAY_TABLE) or an acknowledged not-yet-enabled service
     (PENDING_ENABLE) — the item #10 backlog of services whose Flyway is still
     off. Enabling one MUST set its SPRING_FLYWAY_TABLE to the dump's name; drop
     it from PENDING_ENABLE at the same time and this check starts enforcing it.

The two allowlists are transitional and self-policed: a stale entry (one that no
longer describes reality) is itself an error, so they can't rot.

Sources of truth:
  - Dump:    local-setup/db/full-dump.sql              -> Flyway history tables
  - Compose: local-setup/docker-compose.egov-digit.yaml (+ fast-path.yml overlay)
                                                        -> per-service Flyway env

Run with --self-test to verify the comparison logic itself.
"""
import re
import sys
import pathlib

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[2]
DUMP = ROOT / "local-setup/db/full-dump.sql"
COMPOSE = ROOT / "local-setup/docker-compose.egov-digit.yaml"
FAST_PATH = ROOT / "local-setup/docker-compose.fast-path.yml"

# ── Transitional allowlists (drive these to empty as item #10 lands) ──────────
# Enabled services that legitimately create their history fresh: they claim a
# table absent from the dump AND their data tables are not in the dump, so Flyway
# baselines from empty with no 42P07 risk. Remove an entry only if that service's
# schema gets baked into the dump (then it must align instead).
BASELINE_FRESH = {
    "egov_indexer_schema",         # egov-indexer      — no eg_indexer* in dump
    "digit_config_service_schema", # digit-config-svc  — no config tables in dump
    "novu_bridge_schema",          # novu-bridge       — no novu tables in dump
}

# History tables the dump ships whose owning service currently has Flyway OFF
# (item #10 decision #2 backlog). When you enable one, set its SPRING_FLYWAY_TABLE
# to exactly this name and delete the entry here — the check then enforces it.
PENDING_ENABLE = {
    "egov_idgen_schema_version",        # egov-idgen        — SPRING_FLYWAY_ENABLED:false
    "egov_localization_schema_version", # egov-localization — SPRING_FLYWAY_ENABLED:false
    "egov_user_schema_version",         # egov-user         — FLYWAY_ENABLED:false
}

_FALSE = {"false", "0", "no", "off"}

# CREATE TABLE public.<name> ( ... \n);  — non-greedy body up to the closing line.
_CREATE = re.compile(
    r'CREATE TABLE\s+(?:public\.)?"?([A-Za-z0-9_]+)"?\s*\((.*?)\n\);',
    re.DOTALL,
)


def dump_history_tables(sql: str) -> set:
    """Flyway history tables, identified by column signature (name-independent)."""
    tables = set()
    for name, body in _CREATE.findall(sql):
        if "installed_rank" in body and "checksum" in body and "installed_on" in body:
            tables.add(name)
    if not tables:
        sys.exit(f"ERROR: no Flyway history tables found in {DUMP} — parser broken?")
    return tables


def _env(spec) -> dict:
    """A service's environment as a str->str dict (handles dict or list form)."""
    if not isinstance(spec, dict):
        return {}
    env = spec.get("environment")
    if isinstance(env, dict):
        return {str(k): ("" if v is None else str(v)) for k, v in env.items()}
    if isinstance(env, list):
        out = {}
        for item in env:
            s = str(item)
            if "=" in s:
                k, v = s.split("=", 1)
            elif ":" in s:
                k, v = s.split(":", 1)
            else:
                continue
            out[k.strip()] = v.strip()
        return out
    return {}


def merged_services(compose_text: str, fast_path_text: str) -> dict:
    """Per-service env from the base compose with the fast-path env overlaid."""
    base = yaml.safe_load(compose_text) or {}
    over = yaml.safe_load(fast_path_text) or {}
    services = {n: _env(s) for n, s in (base.get("services") or {}).items()}
    for name, spec in (over.get("services") or {}).items():
        services.setdefault(name, {}).update(_env(spec))
    return services


def claimed_tables(services: dict) -> set:
    """SPRING_FLYWAY_TABLE of every Flyway-enabled service that pins one.

    A service is Flyway-relevant if it carries any SPRING_FLYWAY_* / FLYWAY_ENABLED
    key; enabled unless that flag is explicitly false (the image default is on).
    """
    claimed = set()
    for env in services.values():
        relevant = any(k.startswith("SPRING_FLYWAY") for k in env) or "FLYWAY_ENABLED" in env
        if not relevant:
            continue
        flag = env.get("SPRING_FLYWAY_ENABLED", env.get("FLYWAY_ENABLED", "")).strip().strip("'\"").lower()
        if flag in _FALSE:
            continue
        table = env.get("SPRING_FLYWAY_TABLE")
        if table:
            claimed.add(table.strip())
    return claimed


def analyze(dump: set, claimed: set):
    """Return the four error buckets (empty == aligned)."""
    return {
        # Enabled service points at a table absent from the dump and not a known
        # baseline-fresh service -> 42P07 risk if its data is in the dump.
        "claimed_not_in_dump": sorted(claimed - dump - BASELINE_FRESH),
        # Dump ships a history table no enabled service reconciles and it isn't a
        # known pending-enable -> orphaned history / latent 42P07 when enabled.
        "dump_not_claimed": sorted(dump - claimed - PENDING_ENABLE),
        # Allowlist hygiene: entries that no longer describe reality.
        "stale_baseline_fresh": sorted((BASELINE_FRESH & dump) | (BASELINE_FRESH - claimed)),
        "stale_pending_enable": sorted((PENDING_ENABLE & claimed) | (PENDING_ENABLE - dump)),
    }


_MESSAGES = {
    "claimed_not_in_dump": (
        "Enabled service(s) set SPRING_FLYWAY_TABLE to a name NOT in the dump. If that "
        "service's data tables ARE in the dump this 42P07s on boot. Align the name to the "
        "dump, or add it to BASELINE_FRESH if it truly migrates from empty:"
    ),
    "dump_not_claimed": (
        "The dump ships Flyway history table(s) that no enabled service reconciles. Enable "
        "the owning service and set its SPRING_FLYWAY_TABLE to this exact name, or add it to "
        "PENDING_ENABLE if it is intentionally still disabled:"
    ),
    "stale_baseline_fresh": (
        "BASELINE_FRESH is stale — these entries are now in the dump and/or not claimed by "
        "any enabled service. Remove them and align the service to the dump instead:"
    ),
    "stale_pending_enable": (
        "PENDING_ENABLE is stale — these entries are now claimed by an enabled service and/or "
        "absent from the dump. Remove them so the check enforces alignment:"
    ),
}


def report(dump: set, claimed: set) -> int:
    buckets = analyze(dump, claimed)
    if any(buckets.values()):
        print("Flyway ↔ dump history-table MISALIGNMENT:\n")
        for key, items in buckets.items():
            if items:
                print(_MESSAGES[key])
                for t in items:
                    print(f"    {t}")
                print()
        return 1
    aligned = sorted(dump & claimed)
    print(
        f"OK: Flyway history tables aligned with the dump "
        f"({len(aligned)} aligned, {len(BASELINE_FRESH)} baseline-fresh, "
        f"{len(PENDING_ENABLE)} pending-enable)."
    )
    return 0


def self_test() -> int:
    dump = {"pgr_services_schema", "hrms_schema_version", "egov_idgen_schema_version"}

    # Aligned: enabled claims match the dump; the disabled one is acknowledged.
    global PENDING_ENABLE, BASELINE_FRESH
    saved_p, saved_b = PENDING_ENABLE, BASELINE_FRESH
    PENDING_ENABLE, BASELINE_FRESH = {"egov_idgen_schema_version"}, set()
    ok = analyze(dump, {"pgr_services_schema", "hrms_schema_version"})
    assert not any(ok.values()), f"clean case should pass: {ok}"

    # Mismatch: enabled claims a table the dump lacks (the url-shortening bug shape).
    bad = analyze(dump, {"pgr_services_schema", "hrms_schema_version", "typo_schema"})
    assert bad["claimed_not_in_dump"] == ["typo_schema"], bad

    # Orphan: dump ships a history table nobody enabled claims and it's not pending.
    PENDING_ENABLE = set()
    orphan = analyze(dump, {"pgr_services_schema", "hrms_schema_version"})
    assert orphan["dump_not_claimed"] == ["egov_idgen_schema_version"], orphan

    # Stale allowlists self-report.
    PENDING_ENABLE = {"pgr_services_schema"}  # in dump AND claimed -> stale
    stale = analyze(dump, {"pgr_services_schema", "hrms_schema_version"})
    assert "pgr_services_schema" in stale["stale_pending_enable"], stale
    PENDING_ENABLE, BASELINE_FRESH = {"egov_idgen_schema_version"}, {"hrms_schema_version"}
    stale2 = analyze(dump, {"pgr_services_schema", "hrms_schema_version"})
    assert "hrms_schema_version" in stale2["stale_baseline_fresh"], stale2

    PENDING_ENABLE, BASELINE_FRESH = saved_p, saved_b
    print("self-test OK: alignment, mismatch, orphan, and stale-allowlist all detected.")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    dump = dump_history_tables(DUMP.read_text())
    claimed = claimed_tables(merged_services(COMPOSE.read_text(), FAST_PATH.read_text()))
    return report(dump, claimed)


if __name__ == "__main__":
    sys.exit(main())
