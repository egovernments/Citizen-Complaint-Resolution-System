"""MDMS and config-service rows: snapshots, predicted changes, operator choices.

The target's MDMS data migrations, and every deploy-time SQL file that writes
MDMS (DEPLOY_SQL), are run first on a clone of the production database.  A
change they make to an EXISTING row is a conflict the operator resolves
(``backup`` keeps production's row, ``target`` takes the new one) before the
real deployment; additions are expected.

After the deployment, rows resolved to ``backup`` must hold.  Any other change
the clone did not predict (an application rewriting rows at startup, say) is
reported in detail, not rolled back: it is what this release does on every
deploy, and rolling back for it would turn every such release into an outage.
"""

from __future__ import annotations

from typing import Any

from .common import UpgradeError, canonical_json, sha256_text
from .redaction import redact_structure

TABLES: dict[str, tuple[str, ...]] = {
    "eg_mdms_data": ("tenantid", "schemacode", "uniqueidentifier"),
    "eg_mdms_schema_definition": ("tenantid", "code"),
    "eg_config_data": ("tenantid", "schemacode", "uniqueidentifier"),
}
AUDIT_COLUMNS = {"createdby", "lastmodifiedby", "createdtime", "lastmodifiedtime"}
# Deploy-time SQL (relative to the repository) that writes MDMS rows outside a
# migration.  test_render_contract.py fails when the playbook runs any other.
DEPLOY_SQL = ("local-setup/db/revoke-role-grants.sql",)
BACKUP, TARGET = "backup", "target"

Snapshot = dict[str, dict[str, dict[str, Any]]]


def snapshot_sql(table: str) -> str:
    order = ",".join(TABLES[table])
    # Unaligned tuples-only psql keeps PostgreSQL's JSON text intact; COPY
    # would add a second escaping layer json.loads cannot read.
    return f"SELECT to_jsonb(t)::text FROM public.{table} t ORDER BY {order}"


def key_of(table: str, row: dict[str, Any]) -> str:
    try:
        return "|".join(str(row[column]) for column in TABLES[table])
    except KeyError as exc:
        raise UpgradeError(f"{table} row is missing key column {exc.args[0]}") from exc


def index(raw: dict[str, list[dict[str, Any]]]) -> Snapshot:
    """{table: {key: row}} from {table: [row]}; tables absent from raw stay absent."""
    result: Snapshot = {}
    for table, rows in raw.items():
        keyed: dict[str, dict[str, Any]] = {}
        for row in rows:
            key = key_of(table, row)
            if key in keyed:
                raise UpgradeError(f"duplicate key in {table}: {key}")
            keyed[key] = row
        result[table] = keyed
    return result


def business(row: dict[str, Any] | None) -> str | None:
    """The row without audit columns, canonically; what decides whether it changed."""
    return None if row is None else canonical_json({k: v for k, v in row.items() if k not in AUDIT_COLUMNS})


def summary(snapshot: Snapshot) -> dict[str, Any]:
    tables = {}
    for table, rows in sorted(snapshot.items()):
        hashes = {key: sha256_text(business(row)) for key, row in sorted(rows.items())}
        tables[table] = {"count": len(rows), "sha256": sha256_text(canonical_json(hashes))}
    return tables


def changes(before: Snapshot, after: Snapshot) -> dict[str, list[dict[str, Any]]]:
    """Modifications and deletions of existing rows, and additions, before → after."""
    modified, added = [], []
    for table in sorted(set(before) | set(after)):
        old_rows, new_rows = before.get(table, {}), after.get(table, {})
        for key in sorted(set(old_rows) | set(new_rows)):
            old, new = old_rows.get(key), new_rows.get(key)
            if old is None:
                added.append({"table": table, "key": key, "target": new})
            elif business(old) != business(new):
                modified.append({
                    "table": table, "key": key, "kind": "delete" if new is None else "modify",
                    "backup": old, "target": new,
                })
    return {"modified": modified, "added": added}


def choice_id(change: dict[str, Any]) -> str:
    return f"{change['table']}:{change['key']}"


def conflict_report(conflicts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Conflicts for the operator, with secret-named fields redacted."""
    return [
        {
            "id": choice_id(c), "kind": c["kind"],
            "backup": redact_structure(c["backup"]), "target": redact_structure(c["target"]),
        }
        for c in conflicts
    ]


def resolve(conflicts: list[dict[str, Any]], choices: dict[str, str]) -> list[dict[str, Any]]:
    """Validate the operator's choices; return the production rows to keep."""
    required = {choice_id(c) for c in conflicts}
    if set(choices) != required:
        raise UpgradeError(
            "the MDMS resolution does not match the conflicts: missing "
            f"{sorted(required - set(choices))}, unexpected {sorted(set(choices) - required)}"
        )
    invalid = sorted(k for k, v in choices.items() if v not in (BACKUP, TARGET))
    if invalid:
        raise UpgradeError(f"MDMS resolutions must be '{BACKUP}' or '{TARGET}': {invalid}")
    return [
        {"table": c["table"], "key": c["key"], "row": c["backup"]}
        for c in conflicts if choices[choice_id(c)] == BACKUP
    ]


def restore_sql(keep: list[dict[str, Any]]) -> str:
    """One transaction that puts every kept production row back."""
    statements = ["BEGIN;"]
    for item in keep:
        table, row = item["table"], item["row"]
        keys = TABLES[table]
        literal = canonical_json(row).replace("'", "''")
        updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in row if c not in keys)
        statements.append(
            f"INSERT INTO public.{table} SELECT * FROM jsonb_populate_record(NULL::public.{table}, "
            f"'{literal}'::jsonb) ON CONFLICT ({', '.join(keys)}) DO UPDATE SET {updates};"
        )
    statements.append("COMMIT;")
    return "\n".join(statements) + "\n"


def verify(after: Snapshot, predicted: Snapshot, keep: list[dict[str, Any]]) -> dict[str, Any]:
    """Post-deploy check: kept rows must hold; report what the clone did not predict."""
    broken = [
        f"{item['table']}:{item['key']}"
        for item in keep
        if business(after.get(item["table"], {}).get(item["key"])) != business(item["row"])
    ]
    unpredicted = changes(predicted, after)
    return {
        "kept_rows_broken": broken,
        "unpredicted_modified": [
            {"id": choice_id(c), "kind": c["kind"]} for c in unpredicted["modified"]
        ],
        "unpredicted_added": [choice_id(c) for c in unpredicted["added"]],
    }
