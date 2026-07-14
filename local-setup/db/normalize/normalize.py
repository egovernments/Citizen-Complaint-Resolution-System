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


# ── database layer ────────────────────────────────────────────────────────────
import os
import subprocess
import sys
from typing import Iterable, List

MAP_PATH = os.environ.get("MAP_PATH", "/map.yml")

# Flyway history tables are identified by their column signature, not their name —
# that is the whole point, since the name is what we cannot trust.
_HISTORY_SIG = """
SELECT c.relname
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND EXISTS (SELECT 1 FROM information_schema.columns col
              WHERE col.table_schema = 'public' AND col.table_name = c.relname
                AND col.column_name = 'installed_rank')
  AND EXISTS (SELECT 1 FROM information_schema.columns col
              WHERE col.table_schema = 'public' AND col.table_name = c.relname
                AND col.column_name = 'checksum')
  AND EXISTS (SELECT 1 FROM information_schema.columns col
              WHERE col.table_schema = 'public' AND col.table_name = c.relname
                AND col.column_name = 'installed_on');
"""


# Fail LOUDLY instead of hanging the whole deploy. Every migrator and app gates on
# db-history-normalize completing, so a psql that blocks forever — most likely the
# DROP branch's `LOCK TABLE ... ACCESS EXCLUSIVE` waiting on another session's lock —
# would silently deadlock the entire stack. lock_timeout aborts a LOCK that can't be
# acquired; statement_timeout caps any single statement; the subprocess timeout is a
# hard backstop that turns a hung psql into a diagnosable non-zero exit.
LOCK_TIMEOUT = "30s"        # abort a blocked LOCK TABLE
STATEMENT_TIMEOUT = "300s"  # cap any single statement server-side
SUBPROCESS_TIMEOUT = 600    # hard client-side backstop on the psql process (seconds)


def psql(sql: str, *, capture: bool = True) -> str:
    """Run SQL. ON_ERROR_STOP=1 so a failure is a non-zero exit, not a warning.

    (psql prints errors as `psql:<file>:<line>: ERROR: ...` — never grep for a
    line-anchored ^ERROR to detect failure; check the exit code.)

    Runs with lock_timeout/statement_timeout (via PGOPTIONS) and a subprocess
    timeout so a blocked lock or a wedged connection fails fast instead of
    hanging every downstream migrator forever.
    """
    env = {**os.environ, "PGOPTIONS": f"-c lock_timeout={LOCK_TIMEOUT} -c statement_timeout={STATEMENT_TIMEOUT}"}
    try:
        proc = subprocess.run(
            ["psql", "-v", "ON_ERROR_STOP=1", "-qtA", "-c", sql],
            capture_output=capture, text=True, env=env, timeout=SUBPROCESS_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        sys.stderr.write(
            f"psql exceeded {SUBPROCESS_TIMEOUT}s (likely a blocked lock) — aborting "
            "rather than hanging the deploy.\n"
        )
        raise
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr or "")
        raise subprocess.CalledProcessError(proc.returncode, "psql", proc.stdout, proc.stderr)
    return (proc.stdout or "").strip()


def list_tables() -> Set[str]:
    out = psql("SELECT tablename FROM pg_tables WHERE schemaname = 'public';")
    return {line.strip() for line in out.splitlines() if line.strip()}


def history_tables() -> Set[str]:
    out = psql(_HISTORY_SIG)
    return {line.strip() for line in out.splitlines() if line.strip()}


def count_rows(tables: Iterable[str]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for t in tables:
        counts[t] = int(psql(f'SELECT count(*) FROM public."{t}";') or 0)
    return counts


def apply(d: Decision) -> None:
    if d.action == RENAME:
        psql(f'ALTER TABLE public."{d.alias}" RENAME TO "{d.canonical}";')
        print(f"  renamed  {d.service}: {d.alias} -> {d.canonical}")

    elif d.action == DROP:
        # The only destructive operation here. Take an ACCESS EXCLUSIVE lock, then
        # re-count INSIDE the transaction: a table that gained a row between the
        # decision and now raises and rolls back rather than losing data.
        #
        # NB: '%' is plpgsql's RAISE placeholder. Python f-strings do not treat '%'
        # specially, so write exactly one — '%%' would emit a literal '%%' and
        # plpgsql would try to substitute twice against a single argument.
        guards = "\n".join(
            f'  LOCK TABLE public."{t}" IN ACCESS EXCLUSIVE MODE;\n'
            f'  SELECT count(*) INTO n FROM public."{t}";\n'
            f"  IF n > 0 THEN RAISE EXCEPTION "
            f"'{t} gained % rows since the check; refusing to drop', n; END IF;"
            for t in d.tables
        )
        drops = "\n".join(f'DROP TABLE public."{t}" CASCADE;' for t in d.tables)
        psql(f"""
BEGIN;
DO $$
DECLARE n bigint;
BEGIN
{guards}
END $$;
{drops}
COMMIT;
""")
        # NOTE: a rebuilt service's migrator will APPLY its migrations (it has to —
        # we just dropped its tables). It will NOT report "No migration necessary".
        # That is correct, and the integration test asserts it per path.
        print(f"  rebuilt  {d.service}: dropped empty {', '.join(d.tables)} (migrator will recreate)")


def main() -> int:
    services = load_map(MAP_PATH)
    present = list_tables()

    # Decide everything first, so an abort happens BEFORE anything is modified.
    decisions: List[Decision] = []
    for service, spec in services.items():
        data_tables = [t for t in (spec.get("data_tables") or []) if t in present]
        counts = count_rows(data_tables) if data_tables else {}
        decisions.append(decide(service, spec, present, counts))

    aborts = [d for d in decisions if d.action == ABORT]
    if aborts:
        print("\ndb-history-normalize: ABORT\n", file=sys.stderr)
        for d in aborts:
            print(f"  {d.service}: {d.reason}\n", file=sys.stderr)
        print("Refusing to start migrators. No data was modified.", file=sys.stderr)
        return 1

    print("db-history-normalize: normalizing Flyway history")
    for d in decisions:
        apply(d)

    # A history table we do not recognise is harmless: no migrator exists for it,
    # so nothing would replay against it. Say so, but do not fail.
    known = set()
    for spec in services.values():
        known.add(spec["canonical"])
        known.update(spec.get("aliases") or [])
    for orphan in sorted(history_tables() - known):
        print(f"  warning  unrecognised history table {orphan!r} — no migrator owns it, skipping")

    tally = {a: sum(1 for d in decisions if d.action == a) for a in (NOOP, RENAME, DROP, SKIP)}
    print(
        f"ok: renamed {tally[RENAME]}, rebuilt {tally[DROP]}, "
        f"already-aligned {tally[NOOP]}, skipped {tally[SKIP]}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
