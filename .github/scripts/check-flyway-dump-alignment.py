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
MIGRATIONS = ROOT / "local-setup/docker-compose.migrations.yml"
MAP = ROOT / "local-setup/db/flyway-history-map.yml"


def _load_history_map() -> dict:
    with open(MAP) as fh:
        return yaml.safe_load(fh) or {}


_HISTORY_MAP = _load_history_map()

# Services that legitimately create their history fresh: their data tables are not
# in the dump, so Flyway baselines from empty with no 42P07 risk. Declared in the
# map (`baseline_fresh: true`) so the map and this check cannot drift apart.
BASELINE_FRESH = {
    spec["canonical"] for spec in _HISTORY_MAP.values() if spec.get("baseline_fresh")
}

# Emptied in Phase 3: every core service now has a migration init container
# claiming its table, so nothing is pending-enable. db-history-normalize renames
# any legacy names in the dump before the migrators run, so a legacy alias in a
# dump is no longer a misalignment — it is expected and handled.
PENDING_ENABLE = set()

# Legacy names the normalizer will rename into canonical form at deploy time.
# A dump carrying these is fine, so they must not be reported as orphans.
NORMALIZED_ALIASES = {
    alias
    for spec in _HISTORY_MAP.values()
    for alias in (spec.get("aliases") or [])
}

_FALSE = {"false", "0", "no", "off"}

# CREATE TABLE public.<name> ( ... \n);  — non-greedy body up to the closing line.
# The name may be double-quoted and contain hyphens (e.g. K8s's
# "egov-url-shortening_schema"), so allow '-' inside the identifier.
_CREATE = re.compile(
    r'CREATE TABLE\s+(?:public\.)?"?([A-Za-z0-9_-]+)"?\s*\((.*?)\n\);',
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


def merged_services(*compose_texts: str) -> dict:
    """Per-service env from the base compose with each overlay merged in order."""
    services = {}
    for text in compose_texts:
        data = yaml.safe_load(text) or {}
        for name, spec in (data.get("services") or {}).items():
            services.setdefault(name, {}).update(_env(spec))
    return services


def claimed_tables(services: dict) -> set:
    """Tables claimed by (a) a per-service migration init container via SCHEMA_TABLE,
    or (b) a Flyway-enabled app via SPRING_FLYWAY_TABLE.

    A service is Flyway-relevant if it carries any SPRING_FLYWAY_* / FLYWAY_ENABLED
    key; enabled unless that flag is explicitly false (the image default is on).
    """
    claimed = set()
    for env in services.values():
        # (a) init-container migrator: SCHEMA_TABLE is the authoritative name.
        schema_table = env.get("SCHEMA_TABLE")
        if schema_table:
            claimed.add(schema_table.strip())
            continue
        # (b) app with embedded Flyway still enabled.
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
        "dump_not_claimed": sorted(dump - claimed - PENDING_ENABLE - NORMALIZED_ALIASES),
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
    # Synthetic names throughout: a real table name here would collide with the
    # shipped map's aliases and make these cases depend on the map's contents.
    dump = {"alpha_schema", "beta_schema", "gamma_schema_version"}

    global PENDING_ENABLE, BASELINE_FRESH, NORMALIZED_ALIASES
    saved_p, saved_b, saved_n = PENDING_ENABLE, BASELINE_FRESH, NORMALIZED_ALIASES
    NORMALIZED_ALIASES = set()

    # Aligned: enabled claims match the dump; the disabled one is acknowledged.
    PENDING_ENABLE, BASELINE_FRESH = {"gamma_schema_version"}, set()
    ok = analyze(dump, {"alpha_schema", "beta_schema"})
    assert not any(ok.values()), f"clean case should pass: {ok}"

    # Mismatch: enabled claims a table the dump lacks (the url-shortening bug shape).
    bad = analyze(dump, {"alpha_schema", "beta_schema", "typo_schema"})
    assert bad["claimed_not_in_dump"] == ["typo_schema"], bad

    # Orphan: dump ships a history table nobody enabled claims and it's not pending.
    PENDING_ENABLE = set()
    orphan = analyze(dump, {"alpha_schema", "beta_schema"})
    assert orphan["dump_not_claimed"] == ["gamma_schema_version"], orphan

    # ...but a LEGACY ALIAS the normalizer renames at deploy time is NOT an orphan.
    # db-history-normalize turns gamma_schema_version into gamma_schema before any
    # migrator runs, so a dump carrying the legacy name is handled, not misaligned.
    NORMALIZED_ALIASES = {"gamma_schema_version"}
    handled = analyze(dump, {"alpha_schema", "beta_schema"})
    assert handled["dump_not_claimed"] == [], handled
    NORMALIZED_ALIASES = set()

    # Stale allowlists self-report.
    PENDING_ENABLE = {"alpha_schema"}  # in dump AND claimed -> stale
    stale = analyze(dump, {"alpha_schema", "beta_schema"})
    assert "alpha_schema" in stale["stale_pending_enable"], stale
    PENDING_ENABLE, BASELINE_FRESH = {"gamma_schema_version"}, {"beta_schema"}
    stale2 = analyze(dump, {"alpha_schema", "beta_schema"})
    assert "beta_schema" in stale2["stale_baseline_fresh"], stale2

    NORMALIZED_ALIASES = saved_n

    # A service migrated to an init container claims its table via SCHEMA_TABLE,
    # not SPRING_FLYWAY_TABLE. That must still count as claimed.
    PENDING_ENABLE, BASELINE_FRESH = set(), set()
    migrated = claimed_tables({
        "pgr-services": {"SPRING_FLYWAY_ENABLED": "false"},
        "pgr-services-migration": {"SCHEMA_TABLE": "pgr_services_schema"},
    })
    assert migrated == {"pgr_services_schema"}, f"migrator SCHEMA_TABLE not claimed: {migrated}"

    PENDING_ENABLE, BASELINE_FRESH = saved_p, saved_b

    # The map must claim every canonical name the compose overlay declares, or the
    # normalizer would not know about a service the migrators do run.
    claimed_by_compose = claimed_tables(merged_services(
        COMPOSE.read_text(), FAST_PATH.read_text(), MIGRATIONS.read_text()))
    canonical_in_map = {spec["canonical"] for spec in _HISTORY_MAP.values()}
    unmapped = claimed_by_compose - canonical_in_map
    assert not unmapped, (
        f"compose declares SCHEMA_TABLE(s) absent from flyway-history-map.yml: "
        f"{sorted(unmapped)} — add them to the map or db-history-normalize will "
        f"not protect them"
    )

    print("self-test OK: alignment, mismatch, orphan, migrator-claim, stale-allowlist, "
          "and map-covers-compose all detected.")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    dump = dump_history_tables(DUMP.read_text())
    claimed = claimed_tables(merged_services(
        COMPOSE.read_text(), FAST_PATH.read_text(), MIGRATIONS.read_text()))
    return report(dump, claimed)


if __name__ == "__main__":
    sys.exit(main())
