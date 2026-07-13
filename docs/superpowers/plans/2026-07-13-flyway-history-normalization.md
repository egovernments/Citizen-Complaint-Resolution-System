# Flyway History Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a DIGIT deploy over an operator-supplied Postgres dump either leave existing data untouched or fail loudly — never silently destroy it.

**Architecture:** A one-shot `db-history-normalize` init container runs after `postgres-db` is healthy and before every Flyway migrator. It reads a shared map of canonical (K8s) Flyway history-table names plus their legacy compose aliases, introspects the database, and renames legacy history tables into place so the migrators see their history and no-op. Anything it cannot prove safe aborts the deploy. Compose enforces the ordering via `depends_on`, so Ansible and a bare `docker compose up` are both covered with no playbook change.

**Tech Stack:** Docker Compose, Python 3 (stdlib + PyYAML), `psql`, Flyway (inside the pinned `egovio/*-db` images), pytest.

**Spec:** `docs/superpowers/specs/2026-07-13-ansible-flyway-history-normalization-design.md`

## Global Constraints

- Base branch: `feat/flyway-history-normalize` (stacked on `feat/item10-db-migration-parity` / PR #1142).
- All paths below are relative to the repo root. Compose paths inside `docker-compose.migrations.yml` are relative to `local-setup/`.
- The normalizer **must exit non-zero** on any condition it cannot prove safe. No path may silently succeed while modifying data.
- The normalizer **must be idempotent** — compose re-runs it on every `up`.
- `postgres:16` ships `psql` but **not** `python3` (verified). The Dockerfile must install `python3` + `python3-yaml`.
- Base image is referenced through the VPC registry used by the rest of the stack: `registry.preview.egov.theflywheel.in/postgres:16`, exposed as a build ARG.
- **`psql` writes errors as `psql:<file>:<line>: ERROR: ...`, not `ERROR` at line start.** Any grep for failures must not anchor with `^ERROR` — an anchored grep silently reports success on a failed run. Prefer `-v ON_ERROR_STOP=1` and check the exit code.
- The canonical name for `egov-url-shortening` is **hyphenated**: `egov-url-shortening_schema`. It must be double-quoted in SQL.
- Never modify `local-setup/db/full-dump.sql` in this work.
- No change to `local-setup/ansible/playbook-deploy.yml`.

## File Structure

| File | Responsibility |
|---|---|
| `local-setup/db/flyway-history-map.yml` | **new** — single source of truth: per service, canonical history table, legacy aliases, owned data tables, and flags (`embedded`, `baseline_fresh`) |
| `local-setup/db/normalize/normalize.py` | **new** — pure decision layer (`decide()`) + DB introspection + action execution + CLI |
| `local-setup/db/normalize/Dockerfile` | **new** — `postgres:16` + `python3-yaml`, entrypoint `normalize.py` |
| `local-setup/db/normalize/test-integration.sh` | **new** — the real proof + the negative test, against a real dump |
| `local-setup/tests/test_flyway_history_normalize.py` | **new** — decision-table unit tests |
| `local-setup/docker-compose.migrations.yml` | **modify** — add `db-history-normalize`; gate all 14 migrators on it |
| `.github/scripts/check-flyway-dump-alignment.py` | **modify** — read the shared map instead of hardcoded name sets |
| `.github/workflows/flyway-dump-alignment.yml` | **modify** — add the map to trigger paths; run the new unit tests |

### Map schema

```yaml
<service-name>:
  canonical:     <str>   # the table Flyway looks for (SCHEMA_TABLE in the compose overlay)
  aliases:       [<str>] # legacy compose names that mean the same history
  data_tables:   [<str>] # real tables this service's migrations CREATE (not materialized views)
  embedded:      <bool>  # optional. true = no migration init container; normalizer skips entirely
  baseline_fresh: <bool> # optional. true = legitimately absent from the dump; CI must not flag it
```

**Note on scope (refinement of the spec):** the spec listed 13 services. The CI check's existing `BASELINE_FRESH` set also covers `egov-indexer`, `novu-bridge` and `digit-config-service`. For the map to *replace* those hardcoded sets (spec deliverable 4), it must be able to express them — hence the `baseline_fresh` flag and three extra entries. Their `data_tables` are derived from their own migration SQL, same as everything else.

---

### Task 1: The map and the decision layer

The decision layer is a pure function — no database, no Docker. It is where every safety property lives, so it gets tested first and hardest.

**Files:**
- Create: `local-setup/db/flyway-history-map.yml`
- Create: `local-setup/db/normalize/normalize.py`
- Test: `local-setup/tests/test_flyway_history_normalize.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `load_map(path: str) -> dict[str, dict]`
  - `Decision` — `NamedTuple(action: str, service: str, canonical: str, alias: str | None, tables: tuple[str, ...], reason: str)`
  - `decide(service: str, spec: dict, present: set[str], row_counts: dict[str, int]) -> Decision`
  - Action constants: `NOOP`, `RENAME`, `DROP`, `ABORT`, `SKIP` (module-level strings).

- [ ] **Step 1: Write the failing tests**

Create `local-setup/tests/test_flyway_history_normalize.py`:

```python
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

from normalize import ABORT, DROP, NOOP, RENAME, SKIP, decide, load_map

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


def test_embedded_services_are_skipped_entirely():
    spec = {"canonical": "accesscontrol_schema_version", "embedded": True}
    d = decide("egov-accesscontrol", spec, {"accesscontrol_schema_version"}, {})
    assert d.action == SKIP


def test_embedded_service_is_skipped_even_when_it_looks_wrong():
    # No migrator exists for it, so nothing can replay against it. Hands off.
    spec = {"canonical": "accesscontrol_schema_version", "embedded": True}
    d = decide("egov-accesscontrol", spec, set(), {})
    assert d.action == SKIP


# ── the shipped map itself ────────────────────────────────────────────────────

def test_shipped_map_parses_and_covers_every_migrator():
    m = load_map(MAP_PATH)
    # Every service with a -db migration init container in the compose overlay.
    for svc in [
        "boundary-service", "egov-user", "mdms-backend", "egov-idgen",
        "egov-localization", "egov-enc-service", "egov-filestore",
        "egov-workflow-v2", "egov-hrms", "egov-url-shortening", "egov-otp",
        "pgr-services", "novu-bridge", "digit-config-service",
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd local-setup && python3 -m pytest tests/test_flyway_history_normalize.py -v
```

Expected: collection error — `ModuleNotFoundError: No module named 'normalize'`.

- [ ] **Step 3: Write the map**

Create `local-setup/db/flyway-history-map.yml`:

```yaml
# Source of truth for Flyway history-table names (deployment-parity item #10).
#
# The compose stack boots from a dump, then each service's -db migration init
# container runs Flyway on top. Flyway finds "what have I already applied?" by
# reading the history table named by SCHEMA_TABLE. If that name does not match
# what the dump actually shipped, Flyway sees an EMPTY history, replays every
# migration from V1 against a populated database, and — for services whose V1
# starts with DROP TABLE IF EXISTS (egov-localization, egov-enc-service) —
# silently destroys the data and exits 0.
#
# db-history-normalize reads this file before any migrator runs and renames
# legacy history tables to their canonical names.
#
#   canonical      the table Flyway looks for (== SCHEMA_TABLE in
#                  docker-compose.migrations.yml). Keep the two in sync.
#   aliases        legacy compose names for the same history.
#   data_tables    real tables this service's migrations CREATE. Derived from the
#                  CREATE TABLE statements in its own migration SQL — NOT guessed.
#                  Materialized views are excluded: they can always be rebuilt.
#   embedded       true = no migration init container. The normalizer skips these
#                  entirely; nothing would replay against them.
#   baseline_fresh true = legitimately absent from the dump (migrates from empty).
#                  Consumed by .github/scripts/check-flyway-dump-alignment.py.

boundary-service:
  canonical: boundary_service_schema
  aliases: [boundary_schema_version]
  data_tables: [boundary, boundary_hierarchy, boundary_relationship]

egov-user:
  canonical: egov_user_schema
  aliases: [egov_user_schema_version]
  data_tables:
    - eg_address
    - eg_role
    - eg_user
    - eg_user_address
    - eg_user_audit_table
    - eg_user_login_failed_attempts
    - eg_userrole
    - eg_userrole_v1

mdms-backend:
  canonical: mdms_v2_schema
  aliases: [mdms_schema_version]
  data_tables: [eg_mdms_data, eg_mdms_schema_definition]

egov-idgen:
  canonical: egov_idgen_schema
  aliases: [egov_idgen_schema_version]
  data_tables: [id_generator]

egov-localization:
  canonical: egov_localization_schema
  aliases: [egov_localization_schema_version]
  data_tables: [message]

egov-enc-service:
  canonical: egov_enc_service_schema
  aliases: [enc_schema_version]
  data_tables: [eg_enc_asymmetric_keys, eg_enc_symmetric_keys]

egov-filestore:
  canonical: egov_filestore_schema
  aliases: [filestore_schema_version]
  data_tables: [eg_filestoremap]

egov-workflow-v2:
  canonical: egov_workflow_v2_schema
  aliases: [workflow_schema_version]
  data_tables:
    - eg_wf_action_v2
    - eg_wf_assignee_v2
    - eg_wf_businessservice_v2
    - eg_wf_document_v2
    - eg_wf_processinstance_v2
    - eg_wf_state_v2

egov-hrms:
  canonical: egov_hrms_schema
  aliases: [hrms_schema_version]
  data_tables:
    - eg_hrms_assignment
    - eg_hrms_deactivationdetails
    - eg_hrms_departmentaltests
    - eg_hrms_educationaldetails
    - eg_hrms_empdocuments
    - eg_hrms_employee
    - eg_hrms_jurisdiction
    - eg_hrms_reactivationdetails
    - eg_hrms_servicehistory

egov-url-shortening:
  canonical: "egov-url-shortening_schema"   # hyphenated, as in the K8s chart
  aliases: [egov_url_shortening_schema_version]
  data_tables: [eg_url_shortener]

egov-otp:
  canonical: egov_otp_schema
  aliases: []              # no legacy otp history exists in any known dump
  data_tables: [eg_token]

pgr-services:
  canonical: pgr_services_schema
  aliases: []              # already canonical in the dump
  data_tables:
    - complaint_open_state_daily
    - eg_pgr_address_v2
    - eg_pgr_document_v2
    - eg_pgr_service_v2

novu-bridge:
  canonical: novu_bridge_schema
  aliases: []
  data_tables: [nb_dispatch_log]
  baseline_fresh: true

digit-config-service:
  canonical: digit_config_service_schema
  aliases: []
  data_tables: [eg_config_data]
  baseline_fresh: true

egov-indexer:
  canonical: egov_indexer_schema
  aliases: []
  data_tables: []
  embedded: true           # embedded Flyway; no migration init container
  baseline_fresh: true

egov-accesscontrol:
  canonical: accesscontrol_schema_version
  aliases: []
  data_tables: []
  embedded: true           # K8s chart declares no schemaTable; stays embedded
```

- [ ] **Step 4: Write the decision layer**

Create `local-setup/db/normalize/normalize.py` (decision layer only — the DB layer lands in Task 2):

```python
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
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd local-setup && python3 -m pytest tests/test_flyway_history_normalize.py -v
```

Expected: **13 passed.**

- [ ] **Step 6: Commit**

```bash
git add local-setup/db/flyway-history-map.yml \
        local-setup/db/normalize/normalize.py \
        local-setup/tests/test_flyway_history_normalize.py
git commit -m "feat(db): Flyway history map + pure decision layer for normalization

Refs #1142"
```

---

### Task 2: Database layer, CLI and image

Turns the decision into SQL. The `DROP` path is the only destructive operation in the system, so it is guarded by an `ACCESS EXCLUSIVE` lock plus a row re-check inside the same transaction.

**Files:**
- Modify: `local-setup/db/normalize/normalize.py` (append to Task 1's module)
- Create: `local-setup/db/normalize/Dockerfile`

**Interfaces:**
- Consumes: `decide()`, `load_map()`, `Decision`, action constants from Task 1.
- Produces:
  - `psql(sql: str, *, capture: bool = True) -> str` — runs SQL via `psql -v ON_ERROR_STOP=1`, raises `CalledProcessError` on failure.
  - `list_tables() -> set[str]`
  - `history_tables() -> set[str]` — tables identified as Flyway history by column signature (`installed_rank` + `checksum` + `installed_on`), name-independent.
  - `count_rows(tables: Iterable[str]) -> dict[str, int]`
  - `apply(d: Decision) -> None` — executes RENAME / DROP; no-ops otherwise.
  - `main() -> int` — exit 0 to proceed, 1 to abort.

- [ ] **Step 1: Append the DB layer and CLI to `normalize.py`**

Append to `local-setup/db/normalize/normalize.py`:

```python
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


def psql(sql: str, *, capture: bool = True) -> str:
    """Run SQL. ON_ERROR_STOP=1 so a failure is a non-zero exit, not a warning.

    (psql prints errors as `psql:<file>:<line>: ERROR: ...` — never grep for a
    line-anchored ^ERROR to detect failure; check the exit code.)
    """
    proc = subprocess.run(
        ["psql", "-v", "ON_ERROR_STOP=1", "-qtA", "-c", sql],
        capture_output=capture, text=True,
    )
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
        print(f"  renamed  {d.alias} -> {d.canonical}")

    elif d.action == DROP:
        # The only destructive operation here. Take an ACCESS EXCLUSIVE lock, then
        # re-count INSIDE the transaction: a table that gained a row between the
        # decision and now raises and rolls back rather than losing data.
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
        print(f"  rebuilt  dropped empty {', '.join(d.tables)} (migrator will recreate)")


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
```

- [ ] **Step 2: Verify the unit tests still pass after the append**

```bash
cd local-setup && python3 -m pytest tests/test_flyway_history_normalize.py -v
```

Expected: **13 passed.** (The DB layer imports cleanly; `decide()` is unchanged.)

- [ ] **Step 3: Write the Dockerfile**

Create `local-setup/db/normalize/Dockerfile`:

```dockerfile
# db-history-normalize — see docs/superpowers/specs/2026-07-13-ansible-flyway-history-normalization-design.md
#
# postgres:16 gives us psql; it does NOT ship python3, so install it.
ARG POSTGRES_IMAGE=registry.preview.egov.theflywheel.in/postgres:16
FROM ${POSTGRES_IMAGE}

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-yaml \
 && rm -rf /var/lib/apt/lists/*

COPY normalize.py /usr/local/bin/normalize.py

ENTRYPOINT ["python3", "/usr/local/bin/normalize.py"]
```

- [ ] **Step 4: Build the image and smoke-test it against an empty database**

```bash
cd local-setup/db/normalize
docker build -t db-history-normalize:test .

docker network create norm-smoke 2>/dev/null || true
docker run -d --name norm-pg --network norm-smoke \
  -e POSTGRES_USER=egov -e POSTGRES_PASSWORD=egov123 -e POSTGRES_DB=egov \
  registry.preview.egov.theflywheel.in/postgres:16
until docker exec norm-pg pg_isready -U egov >/dev/null 2>&1; do sleep 2; done

docker run --rm --network norm-smoke \
  -e PGHOST=norm-pg -e PGUSER=egov -e PGPASSWORD=egov123 -e PGDATABASE=egov \
  -v "$PWD/../flyway-history-map.yml:/map.yml:ro" \
  db-history-normalize:test
echo "exit=$?"

docker rm -f norm-pg >/dev/null && docker network rm norm-smoke >/dev/null
```

Expected: exit **0**, and a fresh-install tally — every service takes the no-op branch:

```
db-history-normalize: normalizing Flyway history
ok: renamed 0, rebuilt 0, already-aligned 14, skipped 2
```

- [ ] **Step 5: Commit**

```bash
git add local-setup/db/normalize/normalize.py local-setup/db/normalize/Dockerfile
git commit -m "feat(db): db-history-normalize DB layer, CLI and image

Guards the only destructive path (DROP of empty orphan tables) with an
ACCESS EXCLUSIVE lock plus a row re-check inside the same transaction.

Refs #1142"
```

---

### Task 3: Wire the normalizer into compose

Every migrator becomes unable to start before the normalizer has succeeded. This is what makes the guard unbypassable — including for a bare `docker compose up`.

**Files:**
- Modify: `local-setup/docker-compose.migrations.yml`

**Interfaces:**
- Consumes: the `db-history-normalize:test` image built in Task 2 (built here by compose from `./db/normalize`).
- Produces: a `db-history-normalize` compose service that all 14 migrators gate on.

- [ ] **Step 1: Add the normalizer service**

In `local-setup/docker-compose.migrations.yml`, insert immediately after the `services:` key, before `pgr-services-migration`:

```yaml
  # ── Guard · runs before EVERY migrator ──────────────────────────────────────
  # An operator-supplied dump carries the LEGACY compose history-table names
  # (*_schema_version). The -db migrator images look for the K8s <service>_schema
  # names. On a mismatch Flyway sees an empty history, replays from V1 against a
  # populated database, and egov-localization + egov-enc-service DROP+recreate
  # their tables and exit 0 — silent, unrecoverable data loss (the encryption keys
  # that decrypt all user PII). This renames them into place first, and aborts the
  # deploy on anything it cannot prove safe.
  #   docs/superpowers/specs/2026-07-13-ansible-flyway-history-normalization-design.md
  db-history-normalize:
    build:
      context: ./db/normalize
    container_name: db-history-normalize
    depends_on:
      postgres-db:
        condition: service_healthy
    environment:
      PGHOST: postgres-db
      PGPORT: "5432"
      PGUSER: egov
      PGPASSWORD: ${POSTGRES_PASSWORD:-egov123}
      PGDATABASE: egov
      MAP_PATH: /map.yml
    volumes:
      - ./db/flyway-history-map.yml:/map.yml:ro
    restart: "no"
    networks:
      - egov-network
```

- [ ] **Step 2: Gate every migrator on it**

For **each** of the 14 migration services in this file — `pgr-services-migration`, `novu-bridge-migration`, `digit-config-service-migration`, `boundary-service-migration`, `egov-user-migration`, `mdms-backend-migration`, `egov-idgen-migration`, `egov-localization-migration`, `egov-enc-service-migration`, `egov-filestore-migration`, `egov-workflow-v2-migration`, `egov-hrms-migration`, `egov-url-shortening-migration`, `egov-otp-migration` — add `db-history-normalize` to its existing `depends_on`.

The eleven Phase-3 core migrators currently use the inline form. Change each from:

```yaml
    depends_on: { postgres-db: { condition: service_healthy } }
```

to:

```yaml
    depends_on:
      postgres-db: { condition: service_healthy }
      db-history-normalize: { condition: service_completed_successfully }
```

`pgr-services-migration` uses the block form with cross-service gates. Add one key to its existing `depends_on`, leaving the other conditions untouched:

```yaml
    depends_on:
      postgres-db:
        condition: service_healthy
      db-history-normalize:
        condition: service_completed_successfully
      boundary-service:
        condition: service_healthy
      egov-user:
        condition: service_healthy
      mdms-backend:
        condition: service_healthy
      egov-workflow-v2:
        condition: service_healthy
```

`novu-bridge-migration` and `digit-config-service-migration` likewise gain the one key alongside their existing `postgres-db` gate. Note both carry `profiles: ["notifications"]`; `db-history-normalize` has **no** profile, so it is always active and satisfies them in every profile combination.

- [ ] **Step 3: Verify compose resolves the graph**

```bash
cd local-setup
docker compose -f docker-compose.egov-digit.yaml \
               -f docker-compose.fast-path.yml \
               -f docker-compose.migrations.yml config >/dev/null && echo "compose config OK"

# Every migrator must now depend on the normalizer: expect 14.
docker compose -f docker-compose.egov-digit.yaml \
               -f docker-compose.fast-path.yml \
               -f docker-compose.migrations.yml config \
  | python3 -c "
import sys, yaml
c = yaml.safe_load(sys.stdin)
gated = [n for n, s in c['services'].items()
         if n.endswith('-migration') and 'db-history-normalize' in (s.get('depends_on') or {})]
migrators = [n for n in c['services'] if n.endswith('-migration')]
print(f'{len(gated)}/{len(migrators)} migrators gated on db-history-normalize')
missing = sorted(set(migrators) - set(gated))
assert not missing, f'UNGATED: {missing}'
print('OK')
"
```

Expected: `compose config OK`, then `14/14 migrators gated on db-history-normalize` and `OK`.

- [ ] **Step 4: Commit**

```bash
git add local-setup/docker-compose.migrations.yml
git commit -m "feat(compose): gate every Flyway migrator on db-history-normalize

Ansible inherits the guard — it already runs these compose files — and a bare
\`docker compose up\` is covered too.

Refs #1142"
```

---

### Task 4: The proof — integration and negative tests

This is the task that decides whether the whole thing actually works. It runs against a real dump with the real pinned migrator images.

**Files:**
- Create: `local-setup/db/normalize/test-integration.sh`

**Interfaces:**
- Consumes: the built normalizer image, `local-setup/db/flyway-history-map.yml`, the eleven pinned `egovio/*-db` images.
- Produces: an executable proof, runnable on any box with Docker. Exit 0 = both the positive and negative tests held.

- [ ] **Step 1: Write the test script**

Create `local-setup/db/normalize/test-integration.sh`:

```bash
#!/usr/bin/env bash
# Proof for db-history-normalize, against a REAL dump and the REAL pinned images.
#
#   ./test-integration.sh /path/to/dump.sql
#
# A) POSITIVE — dump + normalizer + all 11 migrators:
#      every migrator reports "No migration necessary", and a row-count +
#      content-checksum snapshot of every table is byte-identical before/after.
# B) NEGATIVE — dump + all 11 migrators, normalizer SKIPPED:
#      data IS destroyed. If this ever stops failing, the guard has been silently
#      disabled and the positive test alone would not tell us.
set -euo pipefail

DUMP="${1:?usage: test-integration.sh /path/to/dump.sql}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAP="$HERE/../flyway-history-map.yml"
PG_IMAGE="registry.preview.egov.theflywheel.in/postgres:16"
NET=normalize-it
WORK="$(mktemp -d)"
trap 'docker rm -f it-pos it-neg >/dev/null 2>&1 || true; docker network rm $NET >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

MIGRATORS=(
  "boundary-service|boundary-service-db:v2.9.2-4a60f20|boundary_service_schema"
  "egov-user|egov-user-db:master-d69ce29|egov_user_schema"
  "mdms-backend|mdms-v2-db:v2.9.2-4a60f20|mdms_v2_schema"
  "egov-idgen|egov-idgen-db:v2.9.2-4a60f20|egov_idgen_schema"
  "egov-localization|egov-localization-db:v2.9.2-4a60f20|egov_localization_schema"
  "egov-enc-service|egov-enc-service-db:v2.9.2-4a60f20|egov_enc_service_schema"
  "egov-filestore|egov-filestore-db:v2.9.2-4a60f20|egov_filestore_schema"
  "egov-workflow-v2|egov-workflow-v2-db:v2.9.2-4a60f20|egov_workflow_v2_schema"
  "egov-hrms|egov-hrms-db:hrms-boundary-0a4e737|egov_hrms_schema"
  "egov-url-shortening|egov-url-shortening-db:v2.9.2-4a60f20|egov-url-shortening_schema"
  "egov-otp|egov-otp-db:v2.9.2-4a60f20|egov_otp_schema"
)

# Row count + content checksum for every table in public.
cat > "$WORK/snapshot.sql" <<'SQL'
SELECT c.relname,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', c.relname), false,true,'')))[1]::text::bigint,
       (xpath('/row/c/text()', query_to_xml(format('select coalesce(md5(string_agg(t::text, E''\n'' ORDER BY t::text)),''EMPTY'') as c from public.%I t', c.relname), false,true,'')))[1]::text
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY 1;
SQL

start_db() {  # $1 = container name
  docker rm -f "$1" >/dev/null 2>&1 || true
  docker run -d --name "$1" --network $NET \
    -e POSTGRES_USER=egov -e POSTGRES_PASSWORD=egov123 -e POSTGRES_DB=egov \
    "$PG_IMAGE" >/dev/null
  until docker exec "$1" pg_isready -U egov >/dev/null 2>&1; do sleep 2; done
  docker cp "$DUMP" "$1:/tmp/dump.sql" >/dev/null
  docker cp "$WORK/snapshot.sql" "$1:/tmp/snapshot.sql" >/dev/null
  # ON_ERROR_STOP: psql errors read "psql:file:line: ERROR:", so never grep ^ERROR.
  docker exec "$1" psql -U egov -d egov -q -v ON_ERROR_STOP=1 -f /tmp/dump.sql >/dev/null
}
snapshot() { docker exec "$1" psql -U egov -d egov -tA -F'|' -f /tmp/snapshot.sql; }

run_migrators() {  # $1 = db container; echoes "<name> <exit> <verdict>" per line
  for m in "${MIGRATORS[@]}"; do
    IFS='|' read -r name image table <<< "$m"
    local log rc
    log="$WORK/$1-$name.log"
    docker run --rm --network $NET \
      -e DB_URL="jdbc:postgresql://$1:5432/egov" -e SCHEMA_NAME=public -e SCHEMA_TABLE="$table" \
      -e FLYWAY_USER=egov -e FLYWAY_PASSWORD=egov123 \
      -e FLYWAY_LOCATIONS=filesystem:/flyway/sql -e FLYWAY_VALIDATE_ON_MIGRATE=false \
      "egovio/$image" > "$log" 2>&1 && rc=0 || rc=$?
    if grep -q "No migration necessary" "$log"; then echo "$name $rc noop"
    else echo "$name $rc applied-or-failed"; fi
  done
}

docker network create $NET >/dev/null 2>&1 || true
docker build -q -t db-history-normalize:test "$HERE" >/dev/null

# ── A) POSITIVE ───────────────────────────────────────────────────────────────
echo "=== A) POSITIVE: dump -> normalize -> migrators ==="
start_db it-pos
snapshot it-pos > "$WORK/pos-before.txt"

docker run --rm --network $NET \
  -e PGHOST=it-pos -e PGUSER=egov -e PGPASSWORD=egov123 -e PGDATABASE=egov \
  -v "$MAP:/map.yml:ro" db-history-normalize:test

# Idempotency: a second run must change nothing and still exit 0.
docker run --rm --network $NET \
  -e PGHOST=it-pos -e PGUSER=egov -e PGPASSWORD=egov123 -e PGDATABASE=egov \
  -v "$MAP:/map.yml:ro" db-history-normalize:test > "$WORK/second-run.log"
grep -q "renamed 0" "$WORK/second-run.log" || { echo "FAIL: normalizer is not idempotent"; cat "$WORK/second-run.log"; exit 1; }
echo "  idempotent: second run renamed 0"

fail=0
while read -r name rc verdict; do
  printf "  %-22s exit=%s %s\n" "$name" "$rc" "$verdict"
  [ "$rc" = "0" ] && [ "$verdict" = "noop" ] || { echo "  FAIL: $name did not cleanly no-op"; fail=1; }
done < <(run_migrators it-pos)
[ "$fail" = "0" ] || { echo "FAIL: not every migrator no-opped"; exit 1; }

snapshot it-pos > "$WORK/pos-after.txt"
# Ignore history tables the migrators legitimately create (e.g. egov_otp_schema);
# assert every table that EXISTED BEFORE is byte-identical.
if ! join -t'|' -j1 <(sort -t'|' -k1,1 "$WORK/pos-before.txt") <(sort -t'|' -k1,1 "$WORK/pos-after.txt") \
     | awk -F'|' '$2!=$4 || $3!=$5 {print; bad=1} END {exit bad?1:0}'; then
  echo "FAIL: pre-existing data changed"; exit 1
fi
echo "  PASS: every pre-existing table byte-identical (rows + checksum)"

# ── B) NEGATIVE ───────────────────────────────────────────────────────────────
echo "=== B) NEGATIVE: dump -> migrators, normalizer SKIPPED (must destroy data) ==="
start_db it-neg
snapshot it-neg > "$WORK/neg-before.txt"
run_migrators it-neg >/dev/null
snapshot it-neg > "$WORK/neg-after.txt"

destroyed=0
for t in message eg_enc_symmetric_keys eg_enc_asymmetric_keys; do
  before=$(awk -F'|' -v t="$t" '$1==t {print $2}' "$WORK/neg-before.txt")
  after=$(awk -F'|' -v t="$t" '$1==t {print $2}' "$WORK/neg-after.txt")
  printf "  %-24s %s -> %s\n" "$t" "${before:-?}" "${after:-?}"
  [ -n "$before" ] && [ "$before" -gt 0 ] && [ "$after" = "0" ] && destroyed=$((destroyed+1))
done
[ "$destroyed" = "3" ] || {
  echo "FAIL: the unguarded run did NOT destroy data as expected."
  echo "      Either the migration images changed, or the guard is being applied"
  echo "      when it should not be. Do not ship until this is understood."
  exit 1
}
echo "  PASS: unguarded run destroys data — the guard is doing real work"

echo
echo "ALL PASS: normalizer makes the dump safe; without it the data is destroyed."
```

- [ ] **Step 2: Make it executable and run it against the team dump**

```bash
chmod +x local-setup/db/normalize/test-integration.sh
./local-setup/db/normalize/test-integration.sh /home/ubuntu/egov_backup_20260709_082159.sql
```

Expected (measured on this dump — 57 tables, 97,250 rows):

```
=== A) POSITIVE: dump -> normalize -> migrators ===
db-history-normalize: normalizing Flyway history
  renamed  boundary_schema_version -> boundary_service_schema
  ... (10 renames)
  rebuilt  dropped empty eg_token (migrator will recreate)
ok: renamed 10, rebuilt 1, already-aligned 3, skipped 2
  idempotent: second run renamed 0
  boundary-service       exit=0 noop
  ... (all 11)
  PASS: every pre-existing table byte-identical (rows + checksum)
=== B) NEGATIVE: dump -> migrators, normalizer SKIPPED (must destroy data) ===
  message                  70835 -> 0
  eg_enc_symmetric_keys    27 -> 0
  eg_enc_asymmetric_keys   27 -> 0
  PASS: unguarded run destroys data — the guard is doing real work
ALL PASS
```

Note `egov-otp` now reaches `exit=0 noop`: the normalizer drops the empty orphan `eg_token`, so its migrator builds the table cleanly instead of hitting 42P07.

- [ ] **Step 3: Commit**

```bash
git add local-setup/db/normalize/test-integration.sh
git commit -m "test(db): integration proof + negative test for db-history-normalize

Positive: the team dump survives a full migrator run byte-identical.
Negative: without the normalizer the same dump loses 73% of its rows —
if that test ever stops failing, the guard has been silently disabled.

Refs #1142"
```

---

### Task 5: Point the CI check at the shared map

The CI check currently hardcodes two name sets that must be kept in step with the map by hand. Wire it to the map so they cannot drift.

**Files:**
- Modify: `.github/scripts/check-flyway-dump-alignment.py`
- Modify: `.github/workflows/flyway-dump-alignment.yml`

**Interfaces:**
- Consumes: `local-setup/db/flyway-history-map.yml`.
- Produces: no new interface; the script keeps its `--self-test` flag and its exit-code contract (0 aligned, 1 misaligned).

- [ ] **Step 1: Replace the hardcoded sets with map-derived ones**

In `.github/scripts/check-flyway-dump-alignment.py`, replace the `BASELINE_FRESH` and `PENDING_ENABLE` literal sets (and their comment block) with:

```python
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
```

Then, in `analyze()`, exclude the aliases from the orphan bucket — a dump carrying a legacy name is now a *handled* case, not a misalignment:

```python
        "dump_not_claimed": sorted(dump - claimed - PENDING_ENABLE - NORMALIZED_ALIASES),
```

- [ ] **Step 2: Add a self-test for the map wiring**

In the `self_test()` function of the same file, add before the final restore of the saved allowlists:

```python
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
```

- [ ] **Step 3: Run the check and its self-test**

```bash
pip install pyyaml
python3 .github/scripts/check-flyway-dump-alignment.py --self-test
python3 .github/scripts/check-flyway-dump-alignment.py
```

Expected: the self-test prints its OK line and the map assertion passes; the check prints `OK: Flyway history tables aligned with the dump (...)`.

Then prove the new guard bites — add a fake migrator to the overlay with an unmapped `SCHEMA_TABLE` and confirm the self-test fails:

```bash
python3 - <<'PY'
import pathlib
p = pathlib.Path("local-setup/docker-compose.migrations.yml")
p.write_text(p.read_text() + """
  bogus-migration:
    image: busybox
    environment:
      SCHEMA_TABLE: bogus_schema
""")
PY
python3 .github/scripts/check-flyway-dump-alignment.py --self-test; echo "exit=$?"
git checkout local-setup/docker-compose.migrations.yml
```

Expected: `AssertionError: compose declares SCHEMA_TABLE(s) absent from flyway-history-map.yml: ['bogus_schema']` and `exit=1`.

- [ ] **Step 4: Add the map and the unit tests to CI**

In `.github/workflows/flyway-dump-alignment.yml`, add `local-setup/db/flyway-history-map.yml` and `local-setup/db/normalize/normalize.py` to **both** the `pull_request` and `push` `paths:` lists, and add a step after the existing self-test step:

```yaml
      - name: Normalizer decision-table unit tests
        run: |
          pip install pytest
          python3 -m pytest local-setup/tests/test_flyway_history_normalize.py -v
```

- [ ] **Step 5: Commit**

```bash
git add .github/scripts/check-flyway-dump-alignment.py .github/workflows/flyway-dump-alignment.yml
git commit -m "ci(flyway): drive the alignment check from the shared history map

The check no longer hardcodes name sets that must be hand-synced with the
normalizer. A migrator whose SCHEMA_TABLE is missing from the map now fails CI.

Refs #1142"
```

---

### Task 6: Document the flow and open the PR

**Files:**
- Modify: `docs/db-migration-flow.md`

- [ ] **Step 1: Document the guard**

Append a section to `docs/db-migration-flow.md`:

```markdown
## Deploying over a dump you did not build

The stack boots from whatever dump sits at `local-setup/db/full-dump.sql`. A dump
handed over by a service team, or lifted from a running environment, carries the
**legacy compose** Flyway history-table names (`*_schema_version`) — but the `-db`
migrator images look for the **K8s** names (`<service>_schema`).

On a mismatch Flyway sees an empty history and replays every migration from V1
against a populated database. Nine migrators crash with 42P07. Two do not:
`egov-localization` and `egov-enc-service` open their V1 with `DROP TABLE IF
EXISTS`, so they drop, recreate empty, and **exit 0**. Measured on a real team
dump: 97,250 rows → 26,377, including the encryption keys that decrypt all user
PII. That loss is unrecoverable.

`db-history-normalize` runs before every migrator and prevents this. It reads
`local-setup/db/flyway-history-map.yml`, renames legacy history tables to their
canonical names, rebuilds empty orphan tables, and **aborts the deploy** on
anything it cannot prove safe. It is idempotent, and it is gated in compose — so
Ansible and a bare `docker compose up` are both covered.

**Adding a service:** add it to `flyway-history-map.yml` (canonical name matching
its `SCHEMA_TABLE`, any legacy aliases, and the tables its migrations create). CI
fails if a migrator's `SCHEMA_TABLE` has no map entry.

**Testing a dump before you trust it:**

```bash
./local-setup/db/normalize/test-integration.sh /path/to/dump.sql
```
```

- [ ] **Step 2: Run everything once more, end to end**

```bash
cd local-setup && python3 -m pytest tests/test_flyway_history_normalize.py -v && cd ..
python3 .github/scripts/check-flyway-dump-alignment.py --self-test
python3 .github/scripts/check-flyway-dump-alignment.py
./local-setup/db/normalize/test-integration.sh /home/ubuntu/egov_backup_20260709_082159.sql
```

Expected: 13 unit tests pass, both CI checks pass, and the integration script ends `ALL PASS`.

- [ ] **Step 3: Commit and open the PR**

```bash
git add docs/db-migration-flow.md
git commit -m "docs: how migrations flow over an operator-supplied dump

Refs #1142"
git push -u origin feat/flyway-history-normalize
gh pr create --base feat/item10-db-migration-parity \
  --title "fix(db): never let a migrator replay from V1 over a populated dump (#1142 follow-up)" \
  --body "$(cat <<'EOF'
## Problem

#1142 re-baked the repo's own dump to the K8s `<service>_schema` history names, and
assumed every service team would rename theirs at source. They have not, and nothing
in the deploy checks.

Measured against a team-supplied dump (57 tables, 97,250 rows): the migrators find no
history under the names they expect, replay from V1 against populated tables, and

**97,250 rows → 26,377. 73% of the data destroyed.**

| Table | Before | After |
|---|---|---|
| `message` | 70,835 | **0** |
| `eg_enc_symmetric_keys` | 27 | **0** |
| `eg_enc_asymmetric_keys` | 27 | **0** |

Nine migrators crash with 42P07 — that crash is the only reason their data survived.
The two that do *not* crash are the ones that do the damage: `egov-localization` and
`egov-enc-service` open their V1 migration with `DROP TABLE IF EXISTS`, so they drop,
recreate empty, and **exit 0**. A green deploy that ate the data.

The encryption keys are unrecoverable: `eg_user.name` and `mobilenumber` are ciphertext
and those keys were the only thing that could decrypt them.

## Fix

A `db-history-normalize` init container, gated ahead of every migrator in compose (so
Ansible and bare `docker compose up` are both covered — no playbook change). It renames
legacy history tables to canonical names from a shared map, rebuilds empty orphan tables,
and aborts the deploy on anything it cannot prove safe.

Verified: with it, the same dump comes through a full migrator run **byte-identical** —
every migrator reports `No migration necessary`.

## Tests

- Integration proof: real dump + the real pinned `egovio/*-db` images → zero data change.
- Negative test: skip the normalizer → assert the data IS destroyed. If it ever stops
  failing, the guard has been silently disabled.
- Decision-table unit tests, idempotency, fresh-install.
- CI: a migrator whose `SCHEMA_TABLE` is missing from the map now fails the build.

Spec: `docs/superpowers/specs/2026-07-13-ansible-flyway-history-normalization-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `flyway-history-map.yml` (canonical + aliases + data_tables) | 1 |
| Six-row decision table | 1 (pure `decide()`) |
| Skip `embedded: true` entries | 1 |
| Warn-not-error on unknown history tables | 2 (`main()`) |
| `normalize.py` + Dockerfile (`postgres:16` + `python3-yaml`) | 2 |
| DROP guarded by row re-check in the same transaction | 2 (`apply()`, `LOCK ... ACCESS EXCLUSIVE` + `RAISE EXCEPTION`) |
| Abort exits non-zero, modifies nothing | 2 (decide-all-then-apply; aborts checked before any `apply()`) |
| Idempotency | 2 (no-op branch), asserted in 4 |
| Compose: normalizer gated on `postgres-db` healthy | 3 |
| Compose: all migrators gated on normalizer | 3 (asserted 14/14) |
| No `playbook-deploy.yml` change | — (none in any task) |
| CI check reads the shared map | 5 |
| Integration proof (byte-identical) | 4 |
| Negative test (data IS destroyed) | 4 |
| Decision-table unit tests | 1 |
| Fresh-install | 2 (Step 4 smoke test on an empty DB) |
| Known limitation (schema drift) out of scope | — (documented, no task) |

No gaps.

**Deviation from the spec, called out:** the spec's map listed 13 services. To let the map *replace* the CI check's hardcoded `BASELINE_FRESH` (spec deliverable 4), it must also express `egov-indexer`, `novu-bridge` and `digit-config-service` — hence the `baseline_fresh` flag and 16 entries. Their `data_tables` are derived from their own migration SQL, same standard as the rest.

**Type consistency:** `decide()` / `load_map()` / `Decision` / `NOOP|RENAME|DROP|ABORT|SKIP` are defined in Task 1 and used with identical names and signatures in Tasks 1, 2 and the tests. `psql()`, `list_tables()`, `history_tables()`, `count_rows()`, `apply()`, `main()` are defined and used only in Task 2. The map keys (`canonical`, `aliases`, `data_tables`, `embedded`, `baseline_fresh`) are read identically in `normalize.py` (Tasks 1–2) and `check-flyway-dump-alignment.py` (Task 5).

**Placeholder scan:** no TBD/TODO; every code step carries complete code; every command carries expected output.
