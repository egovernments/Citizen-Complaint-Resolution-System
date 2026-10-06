#!/usr/bin/env python3
"""Validate analytics capability grants across code and repository seed sources.

This is deliberately a repository-level check rather than a pgr-services unit test:
the inputs live in four different top-level projects and are not part of the service
Docker build context.
"""

import json
import pathlib
import re
import sys


ROOT = pathlib.Path(__file__).resolve().parents[2]
CAPABILITIES = ROOT / "backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsCapabilities.java"
DEFAULT_ACTIONS = ROOT / (
    "utilities/default-data-handler/src/main/resources/mdmsData/"
    "ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json"
)
DEFAULT_ROLEACTIONS = ROOT / (
    "utilities/default-data-handler/src/main/resources/mdmsData/"
    "ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json"
)
NAIROBI_ACTIONS = ROOT / "ansible/nairobi-mdms/mdms/ACCESSCONTROL-ACTIONS-TEST/actions-test.json"
FULL_DUMP = ROOT / "local-setup/db/full-dump.sql"

CAPABILITY_IDS = set(range(2640, 2649))
DASHBOARD_ACTION_ID = 4557


class ParityError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise ParityError(message)


def read_json(path):
    with path.open(encoding="utf-8") as source:
        return json.load(source)


def code_capabilities():
    source = CAPABILITIES.read_text(encoding="utf-8")
    base_match = re.search(r'private static final String BASE\s*=\s*"([^"]+)";', source)
    require(base_match, f"could not find BASE in {CAPABILITIES.relative_to(ROOT)}")

    base = base_match.group(1)
    constants = {
        name: base + suffix
        for name, suffix in re.findall(
            r'public static final String ([A-Z][A-Z0-9_]*)\s*=\s*BASE\s*\+\s*"([^"]+)";',
            source,
        )
    }
    all_match = re.search(
        r'public static final List<String> ALL\s*=\s*List\.of\((.*?)\);',
        source,
        re.DOTALL,
    )
    require(all_match, f"could not find AnalyticsCapabilities.ALL in {CAPABILITIES.relative_to(ROOT)}")
    names = re.findall(r'\b[A-Z][A-Z0-9_]*\b', all_match.group(1))
    missing = [name for name in names if name not in constants]
    require(not missing, f"unresolved capability constants in AnalyticsCapabilities.ALL: {missing}")
    return [constants[name] for name in names]


def capability_actions(rows):
    return {
        row.get("id"): row
        for row in rows
        if isinstance(row, dict) and row.get("id") in CAPABILITY_IDS
    }


def full_dump_actions(action_ids):
    actions = {}
    with FULL_DUMP.open(encoding="utf-8") as dump:
        for line in dump:
            columns = line.rstrip("\n").split("\t")
            if len(columns) < 5 or columns[3] != "ACCESSCONTROL-ACTIONS-TEST.actions-test":
                continue
            action = json.loads(columns[4])
            if action.get("id") in action_ids:
                actions[action["id"]] = action
    return actions


def check_scope_ref_absent():
    for seed in (DEFAULT_ACTIONS, DEFAULT_ROLEACTIONS, NAIROBI_ACTIONS, FULL_DUMP):
        require("scopeRef" not in seed.read_text(encoding="utf-8"), f"{seed.name} mentions scopeRef")


def check():
    expected_urls = code_capabilities()
    default_rows = read_json(DEFAULT_ACTIONS)
    role_rows = read_json(DEFAULT_ROLEACTIONS)
    nairobi_rows = read_json(NAIROBI_ACTIONS)
    defaults = capability_actions(default_rows)

    require(len(defaults) == len(expected_urls), "expected one default action per capability, ids 2640-2648")
    require(set(defaults) == CAPABILITY_IDS, f"default capability ids differ: {sorted(defaults)}")
    actual_urls = [defaults[action_id].get("url") for action_id in sorted(defaults)]
    require(actual_urls == expected_urls, "default capability URLs differ from AnalyticsCapabilities.ALL")
    for action_id, action in defaults.items():
        require(action.get("method") == "POST", f"action {action_id} is not POST")
        require(action.get("enabled", True) is False, f"action {action_id} must remain disabled")
        require("resource" not in action, f"action {action_id} has a resource block")
        require("condition" not in action, f"action {action_id} has a condition")

    check_scope_ref_absent()

    search_defaults = [row for row in default_rows if row.get("id") == 2008]
    require(len(search_defaults) == 1, "expected exactly one default action 2008")
    search = search_defaults[0]
    require(search.get("url") == "/pgr-services/v2/request/_search", "action 2008 URL changed")
    require(
        isinstance(search.get("resource", {}).get("complaint", {}).get("scope"), dict),
        "action 2008 has no complaint scope policy",
    )

    nairobi_search = [row for row in nairobi_rows if row.get("data", {}).get("id") == 2008]
    require(nairobi_search, "Nairobi masters must seed action 2008")
    for row in nairobi_search:
        action = row["data"]
        tenant = row.get("tenantId", "<unknown tenant>")
        require(action.get("method") == search.get("method"), f"{tenant} action 2008 method differs")
        require(action.get("resource") == search.get("resource"), f"{tenant} action 2008 policy differs")

    tenants = {row.get("tenantId") for row in nairobi_search}
    for tenant in tenants:
        seeded = {
            row["data"].get("id"): row["data"]
            for row in nairobi_rows
            if row.get("tenantId") == tenant and row.get("data", {}).get("id") in CAPABILITY_IDS
        }
        require(set(seeded) == set(defaults), f"{tenant} does not carry every capability action")
        for action_id, expected in defaults.items():
            actual = seeded[action_id]
            require(actual.get("url") == expected.get("url"), f"{tenant} action {action_id} URL differs")
            require(actual.get("method") == expected.get("method"), f"{tenant} action {action_id} method differs")

    dump = full_dump_actions(CAPABILITY_IDS)
    require(set(dump) == set(defaults), "full dump capability ids differ from default data")
    for action_id, expected in defaults.items():
        actual = dump[action_id]
        require(actual.get("url") == expected.get("url"), f"full dump action {action_id} URL differs")
        require(actual.get("method") == expected.get("method"), f"full dump action {action_id} method differs")

    dashboard_rows = [
        row["data"]
        for row in nairobi_rows
        if row.get("data", {}).get("id") == DASHBOARD_ACTION_ID
    ]
    require(len(dashboard_rows) == 1, "expected exactly one Nairobi Dashboard action 4557")
    dump_dashboard = full_dump_actions({DASHBOARD_ACTION_ID})
    require(set(dump_dashboard) == {DASHBOARD_ACTION_ID}, "full dump action 4557 is missing")
    require(
        dump_dashboard[DASHBOARD_ACTION_ID] == dashboard_rows[0],
        "full dump action 4557 differs from the Nairobi Dashboard action",
    )

    mapped_roles = {row.get("rolecode") for row in role_rows if row.get("actionid") == 2641}
    require("SUPERVISOR" in mapped_roles, "base query action must reach SUPERVISOR")
    require("GRO" in mapped_roles, "base query action must reach GRO")
    require("DGRO" not in mapped_roles, "default data must not grant the base query action to DGRO")


def main():
    try:
        check()
    except (OSError, json.JSONDecodeError, ParityError) as error:
        print(f"Analytics seed parity FAILED: {error}", file=sys.stderr)
        return 1
    print("OK: analytics capabilities match default data, Nairobi masters, and the local full dump.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
