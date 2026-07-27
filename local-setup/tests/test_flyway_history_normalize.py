#!/usr/bin/env python3
"""Decision-table tests for the Flyway history normalizer.

The normalizer's safety properties all live in the pure `decide()` function:
given what is in the database, what should we do? These tests pin every row of
the decision table, including the two that exist to prevent data loss.
"""
import os
import sys

import pytest
import yaml

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "db", "normalize")))

from normalize import ABORT, DROP, NOOP, RENAME, decide, load_map

MAP_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "db", "flyway-history-map.yml")
)

SPEC = {
    "canonical": "egov_user_schema",
    "aliases": ["egov_user_schema_version"],
    "data_tables": ["eg_user", "eg_role"],
}


def test_canonical_present_is_noop():
    d = decide("egov-user", SPEC, {"egov_user_schema", "eg_user"}, {"eg_user": 534})
    assert d.action == NOOP


def test_legacy_alias_is_renamed_to_canonical():
    d = decide("egov-user", SPEC, {"egov_user_schema_version", "eg_user"}, {"eg_user": 534})
    assert d.action == RENAME
    assert d.alias == "egov_user_schema_version"
    assert d.canonical == "egov_user_schema"


def test_both_canonical_and_alias_present_aborts_as_ambiguous():
    present = {"egov_user_schema", "egov_user_schema_version", "eg_user"}
    d = decide("egov-user", SPEC, present, {"eg_user": 534})
    assert d.action == ABORT
    assert "ambiguous" in d.reason.lower()


def test_two_aliases_present_aborts_as_ambiguous():
    spec = dict(SPEC, aliases=["egov_user_schema_version", "user_schema_version"])
    present = {"egov_user_schema_version", "user_schema_version", "eg_user"}
    d = decide("egov-user", spec, present, {"eg_user": 534})
    assert d.action == ABORT
    assert "ambiguous" in d.reason.lower()


def test_no_history_and_no_data_is_noop_fresh_install():
    d = decide("egov-user", SPEC, set(), {})
    assert d.action == NOOP


def test_no_history_but_empty_data_tables_are_dropped_for_rebuild():
    # The egov-otp / eg_token shape: table present, history absent, zero rows.
    d = decide("egov-user", SPEC, {"eg_user", "eg_role"}, {"eg_user": 0, "eg_role": 0})
    assert d.action == DROP
    assert set(d.tables) == {"eg_user", "eg_role"}


def test_no_history_but_populated_data_tables_abort():
    # THE important one: never drop rows we cannot prove are reproducible.
    d = decide("egov-user", SPEC, {"eg_user", "eg_role"}, {"eg_user": 534, "eg_role": 0})
    assert d.action == ABORT
    assert "eg_user" in d.reason


def test_no_service_opts_out_of_normalization():
    # Phase 4 removed the `embedded` escape hatch: every service with a schema now
    # has a migration init container, so every entry must be normalized. A stray
    # `embedded: true` would silently skip a service whose migrator DOES run —
    # exactly the replay-against-populated-tables case decide() exists to catch.
    m = load_map(MAP_PATH)
    opted_out = [svc for svc, spec in m.items() if spec.get("embedded")]
    assert not opted_out, f"`embedded` is no longer supported; found on: {opted_out}"


def test_bndry_mgmnt_empty_dump_tables_are_rebuilt_not_aborted():
    # The dump ships both bndry tables with NO history under any name. They are
    # empty, so the migrator may safely rebuild them. If they are ever populated,
    # the ABORT branch must win instead (covered by the eg_user test above).
    m = load_map(MAP_PATH)
    spec = m["egov-bndry-mgmnt"]
    present = {"eg_bm_generated_template", "eg_bm_processed_template"}
    d = decide("egov-bndry-mgmnt", spec, present, {})
    assert d.action == DROP

    d = decide("egov-bndry-mgmnt", spec, present, {"eg_bm_generated_template": 12})
    assert d.action == ABORT


# ── the shipped map itself ────────────────────────────────────────────────────

def test_shipped_map_parses_and_covers_every_migrator():
    m = load_map(MAP_PATH)
    # Every service with a -db migration init container in the compose overlay.
    for svc in [
        "boundary-service", "egov-user", "mdms-backend", "egov-idgen",
        "egov-localization", "egov-enc-service", "egov-filestore",
        "egov-workflow-v2", "egov-hrms", "egov-url-shortening", "egov-otp",
        "pgr-services", "novu-bridge", "digit-config-service", "audit-service",
        # Phase 4 — the last three to get init containers.
        "egov-indexer", "egov-accesscontrol", "egov-bndry-mgmnt",
    ]:
        assert svc in m, f"{svc} missing from the map"
        assert m[svc]["canonical"], f"{svc} has no canonical table"


def test_shipped_map_carries_the_verified_legacy_aliases():
    m = load_map(MAP_PATH)
    # These ten renames were verified to take the team dump to zero data change.
    assert m["boundary-service"]["aliases"] == ["boundary_schema_version"]
    assert m["egov-enc-service"]["aliases"] == ["enc_schema_version"]
    assert m["mdms-backend"]["aliases"] == ["mdms_schema_version"]
    assert m["egov-workflow-v2"]["aliases"] == ["workflow_schema_version"]
    assert m["egov-url-shortening"]["canonical"] == "egov-url-shortening_schema"


def test_shipped_map_has_no_duplicate_table_names_across_services():
    m = load_map(MAP_PATH)
    seen = {}
    for svc, spec in m.items():
        for name in [spec["canonical"]] + list(spec.get("aliases") or []):
            assert name not in seen, f"{name} claimed by both {seen[name]} and {svc}"
            seen[name] = svc
