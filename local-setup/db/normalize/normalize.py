#!/usr/bin/env python3
"""Normalize Flyway history-table names before any migrator runs.

See docs/superpowers/specs/2026-07-13-ansible-flyway-history-normalization-design.md

The database is the input; the decision table below is the entire logic. Keep
`decide()` pure — every safety property is tested there, without a database.
"""
from typing import Dict, NamedTuple, Optional, Set, Tuple

import yaml

NOOP = "noop"
RENAME = "rename"
DROP = "drop"
ABORT = "abort"
SKIP = "skip"


class Decision(NamedTuple):
    action: str
    service: str
    canonical: str
    alias: Optional[str] = None
    tables: Tuple[str, ...] = ()
    reason: str = ""


def load_map(path: str) -> Dict[str, dict]:
    with open(path) as fh:
        data = yaml.safe_load(fh) or {}
    if not data:
        raise SystemExit(f"FATAL: {path} is empty or unparseable")
    return data


def decide(
    service: str,
    spec: dict,
    present: Set[str],
    row_counts: Dict[str, int],
) -> Decision:
    """Pure. What should we do about `service`, given what is in the database?

    present     — every table name in the public schema
    row_counts  — rows per data table, for the data tables that are present
    """
    canonical = spec["canonical"]

    # No migration init container exists for embedded services, so nothing would
    # replay against their history. Hands off, whatever it looks like.
    if spec.get("embedded"):
        return Decision(SKIP, service, canonical, reason="embedded Flyway")

    canonical_present = canonical in present
    found = [a for a in (spec.get("aliases") or []) if a in present]

    if canonical_present and found:
        return Decision(
            ABORT, service, canonical,
            reason=(f"ambiguous: canonical {canonical!r} AND legacy "
                    f"{', '.join(repr(a) for a in found)} both exist. "
                    f"Cannot tell which history is authoritative."),
        )
    if len(found) > 1:
        return Decision(
            ABORT, service, canonical,
            reason=(f"ambiguous: multiple legacy history tables exist "
                    f"({', '.join(repr(a) for a in found)})."),
        )
    if canonical_present:
        return Decision(NOOP, service, canonical, reason="already canonical")
    if found:
        return Decision(RENAME, service, canonical, alias=found[0])

    # No history table at all, under any name.
    data_present = tuple(t for t in (spec.get("data_tables") or []) if t in present)
    if not data_present:
        return Decision(NOOP, service, canonical, reason="fresh install")

    populated = {t: row_counts.get(t, 0) for t in data_present if row_counts.get(t, 0) > 0}
    if populated:
        detail = ", ".join(f"{t} has {n:,} rows" for t, n in sorted(populated.items()))
        return Decision(
            ABORT, service, canonical, tables=data_present,
            reason=(f"{detail}, but no Flyway history table exists. Cannot prove "
                    f"which migrations are applied; replaying from V1 would DROP "
                    f"these tables."),
        )

    return Decision(
        DROP, service, canonical, tables=data_present,
        reason="tables exist but are empty and have no history; migrator will rebuild",
    )
