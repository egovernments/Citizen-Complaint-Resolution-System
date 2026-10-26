#!/usr/bin/env python3
"""Guarded deployment support for upgrade_dry_run.py.

This module is intentionally Linux-only and is invoked only by the explicit
``--deploy-run`` mode.  Analysis and conflict-resume never import Docker or
database state.  The deployment flow stops application writers, creates both
logical and cold backups, evaluates MDMS migrations in an isolated database,
and restores the previous stack on any failed postcondition.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Iterable


MDMS_TABLES: dict[str, tuple[str, ...]] = {
    "eg_mdms_data": ("tenantid", "schemacode", "uniqueidentifier"),
    "eg_mdms_schema_definition": ("tenantid", "code"),
    "eg_config_data": ("tenantid", "schemacode", "uniqueidentifier"),
}
AUDIT_COLUMNS = {"createdby", "lastmodifiedby", "createdtime", "lastmodifiedtime"}
RUNTIME_MANAGED = {".env", ".openbao"}
CONFIG_ROOTS = ("configs", "kong", "nginx", "seeds", "notification-seed")
REDACTED = "<REDACTED>"
ASSIGNMENT = re.compile(r"^(?P<prefix>\s*(?:-\s*)?(?P<key>[A-Za-z0-9_.-]+)\s*[:=]\s*)(?P<value>.*)$")
SENSITIVE_KEY = re.compile(r"(?i)(password|passwd|secret|token|api[_-]?key|private[_-]?key|credential|unseal)")


class DeployError(RuntimeError):
    """Deployment validation or execution failed."""


class MdmsConflict(DeployError):
    """MDMS migration conflicts need operator resolution."""


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def hash_tree(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*"), key=lambda item: item.as_posix()):
        rel = path.relative_to(root).as_posix()
        if path.is_symlink():
            digest.update(f"L\0{rel}\0{os.readlink(path)}\n".encode())
        elif path.is_file():
            digest.update(f"F\0{rel}\0".encode())
            digest.update(bytes.fromhex(sha256_file(path)))
    return digest.hexdigest()


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sanitize_structure(value: Any, key: str = "") -> Any:
    if key and SENSITIVE_KEY.search(key):
        return REDACTED
    if isinstance(value, dict):
        return {str(k): sanitize_structure(v, str(k)) for k, v in value.items()}
    if isinstance(value, list):
        return [sanitize_structure(item) for item in value]
    return value


def sanitized_command(args: Iterable[str], detail: str = "") -> tuple[str, str]:
    """Render diagnostics without leaking password/token environment values."""
    rendered: list[str] = []
    secret_values: list[str] = []
    for arg in args:
        key, separator, value = arg.partition("=")
        if separator and SENSITIVE_KEY.search(key):
            rendered.append(f"{key}={REDACTED}")
            if value:
                secret_values.append(value)
        else:
            rendered.append(arg)
    for value in secret_values:
        detail = detail.replace(value, REDACTED)
    return " ".join(rendered), detail


def record_key(table: str, row: dict[str, Any]) -> str:
    try:
        values = [str(row[column]) for column in MDMS_TABLES[table]]
    except KeyError as exc:
        raise DeployError(f"snapshot row for {table} is missing {exc.args[0]}") from exc
    return "|".join(values)


def business_row(row: dict[str, Any]) -> dict[str, Any]:
    """Return the stable business state used for clone-vs-production checks."""
    return {key: value for key, value in row.items() if key not in AUDIT_COLUMNS}


def load_snapshot(path: Path) -> dict[str, dict[str, dict[str, Any]]]:
    result: dict[str, dict[str, dict[str, Any]]] = {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    for table in MDMS_TABLES:
        rows = raw.get(table, [])
        if not isinstance(rows, list):
            raise DeployError(f"snapshot table {table} is not a list")
        keyed: dict[str, dict[str, Any]] = {}
        for row in rows:
            if not isinstance(row, dict):
                raise DeployError(f"snapshot table {table} contains a non-object row")
            key = record_key(table, row)
            if key in keyed:
                raise DeployError(f"duplicate snapshot key in {table}: {key}")
            keyed[key] = row
        result[table] = keyed
    return result


def snapshot_summary(snapshot: dict[str, dict[str, dict[str, Any]]]) -> dict[str, Any]:
    tables: dict[str, Any] = {}
    for table in sorted(snapshot):
        rows = snapshot[table]
        per_schema: dict[str, int] = {}
        row_hashes: dict[str, str] = {}
        for key, row in sorted(rows.items()):
            bucket = str(row.get("tenantid", ""))
            schema = row.get("schemacode") or row.get("code") or ""
            bucket = f"{bucket}|{schema}"
            per_schema[bucket] = per_schema.get(bucket, 0) + 1
            row_hashes[key] = sha256_bytes(canonical_json(business_row(row)).encode("utf-8"))
        aggregate = sha256_bytes(canonical_json(row_hashes).encode("utf-8"))
        tables[table] = {
            "count": len(rows),
            "sha256": aggregate,
            "counts_by_tenant_schema": dict(sorted(per_schema.items())),
            "row_hashes": row_hashes,
        }
    return tables


def mdms_delta(
    before: dict[str, dict[str, dict[str, Any]]],
    target: dict[str, dict[str, dict[str, Any]]],
) -> dict[str, list[dict[str, Any]]]:
    """Return deterministic additions plus existing-row conflicts.

    Every target update/delete of an existing row is a conflict.  Additions are
    expected versioned migration output and are still included in the final
    aggregate hash.
    """
    conflicts: list[dict[str, Any]] = []
    additions: list[dict[str, Any]] = []
    for table in sorted(MDMS_TABLES):
        old_rows = before[table]
        new_rows = target[table]
        for key in sorted(set(old_rows) | set(new_rows)):
            old = old_rows.get(key)
            new = new_rows.get(key)
            if old is None:
                additions.append({"table": table, "key": key, "target": new})
            elif new is None:
                conflicts.append(
                    {"table": table, "key": key, "kind": "delete", "backup": old, "target": None}
                )
            elif canonical_json(business_row(old)) != canonical_json(business_row(new)):
                conflicts.append(
                    {"table": table, "key": key, "kind": "modify", "backup": old, "target": new}
                )
    return {"conflicts": conflicts, "additions": additions}


def apply_resolutions(
    expected: dict[str, dict[str, dict[str, Any]]],
    conflicts: list[dict[str, Any]],
    choices: dict[str, str],
) -> tuple[dict[str, dict[str, dict[str, Any]]], list[dict[str, Any]]]:
    restore_rows: list[dict[str, Any]] = []
    required = {f"{item['table']}:{item['key']}" for item in conflicts}
    if set(choices) != required:
        missing = sorted(required - set(choices))
        extra = sorted(set(choices) - required)
        raise MdmsConflict(f"MDMS resolution keys do not match conflicts; missing={missing}, extra={extra}")
    for item in conflicts:
        resolution_key = f"{item['table']}:{item['key']}"
        choice = choices[resolution_key]
        if choice not in {"backup", "target"}:
            raise MdmsConflict(f"invalid MDMS choice for {resolution_key}: {choice}")
        if choice == "backup":
            expected[item["table"]][item["key"]] = item["backup"]
            restore_rows.append({"table": item["table"], "row": item["backup"]})
    return expected, restore_rows


def _live_assignment_values(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in text.splitlines():
        match = ASSIGNMENT.match(line)
        if match:
            values[match.group("key").lower()] = match.group("value")
    return values


def materialize_redactions(candidate: str, live: str, path: str) -> str:
    if REDACTED in candidate:
        # A manually resolved conflict may intentionally select the complete
        # backup file.  When the candidate is exactly the live file with only
        # one or more redacted spans, restoring the complete live file is both
        # lossless and unambiguous (including multiline private keys).
        parts = candidate.split(REDACTED)
        template_parts = ["\\A", re.escape(parts[0])]
        offset = len(parts[0])
        for part in parts[1:]:
            line_start = candidate.rfind("\n", 0, offset) + 1
            line_end = candidate.find("\n", offset + len(REDACTED))
            if line_end < 0:
                line_end = len(candidate)
            marker_is_whole_line = candidate[line_start:line_end].strip() == REDACTED
            template_parts.append("(?s:.*?)" if marker_is_whole_line else "[^\\r\\n]*?")
            template_parts.append(re.escape(part))
            offset += len(REDACTED) + len(part)
        template_parts.append("\\Z")
        template = "".join(template_parts)
        if re.fullmatch(template, live):
            return live

    if REDACTED in candidate and path.lower().endswith(".json"):
        try:
            candidate_json = json.loads(candidate)
            live_json = json.loads(live)

            def restore(current: Any, existing: Any) -> Any:
                if current == REDACTED:
                    if existing is None:
                        raise DeployError(
                            f"cannot materialize redacted JSON field in {path}"
                        )
                    return existing
                if isinstance(current, dict):
                    if not isinstance(existing, dict):
                        existing = {}
                    return {
                        key: restore(value, existing.get(key))
                        for key, value in current.items()
                    }
                if isinstance(current, list):
                    if not isinstance(existing, list) or len(existing) != len(current):
                        existing = [None] * len(current)
                    return [
                        restore(value, existing[index])
                        for index, value in enumerate(current)
                    ]
                return current

            materialized = restore(candidate_json, live_json)
            return json.dumps(materialized, indent=2, sort_keys=True) + "\n"
        except json.JSONDecodeError:
            pass
    live_values = _live_assignment_values(live)
    live_lines = live.splitlines()
    output: list[str] = []
    for line_index, line in enumerate(candidate.splitlines(keepends=True)):
        if REDACTED not in line:
            output.append(line)
            continue
        candidate_line = line.rstrip("\r\n")
        ending = line[len(candidate_line):]
        match = ASSIGNMENT.match(candidate_line)
        if (
            match
            and match.group("value") == REDACTED
            and match.group("key").lower() in live_values
        ):
            output.append(match.group("prefix") + live_values[match.group("key").lower()] + ending)
            continue

        # A shell command can carry more than one secret on the same line
        # (for example an object-store user and password). Restore the whole
        # line only when every unchanged span around the markers identifies
        # exactly one source line.
        if candidate_line.count(REDACTED) > 1:
            spans = candidate_line.split(REDACTED)
            line_pattern = "\\A" + ".*?".join(
                re.escape(span) for span in spans
            ) + "\\Z"
            multi_matches = [
                live_line
                for live_line in live_lines
                if re.fullmatch(line_pattern, live_line)
            ]
            if len(multi_matches) == 1:
                output.append(multi_matches[0] + ending)
                continue

        # Redaction also finds assignments embedded in shell commands, such as
        # `docker run -e POSTGRES_PASSWORD=...`.  They are not top-level
        # assignments, so restore the live value only when the unchanged text
        # around the marker identifies exactly one live line.  Ambiguous or
        # missing matches remain a hard failure.
        prefix, marker, suffix = candidate_line.partition(REDACTED)
        matching_lines = [
            live_line
            for live_line in live_lines
            if marker and live_line.startswith(prefix) and live_line.endswith(suffix)
        ]
        if len(matching_lines) == 1:
            output.append(matching_lines[0] + ending)
            continue

        # Identical placeholder/default lines can occur more than once.  The
        # same-position line is safe only when its surrounding text still
        # matches exactly.
        if len(candidate.splitlines()) == len(live_lines) and line_index < len(live_lines):
            live_line = live_lines[line_index]
            if marker and live_line.startswith(prefix) and live_line.endswith(suffix):
                output.append(live_line + ending)
                continue

        # A target-side edit can change the rest of an inline JSON command
        # while leaving its sensitive field intact.  Restore that one field
        # only when the field name and its live value are unique.
        key_matches = re.findall(
            r'(?i)([A-Za-z0-9_.-]*(?:password|passwd|secret|token|api[_-]?key|private[_-]?key|credential|unseal)[A-Za-z0-9_.-]*)',
            prefix,
        )
        if key_matches:
            key = key_matches[-1]
            value_pattern = re.compile(
                r'(?i)(?:\\?")'
                + re.escape(key)
                + r'(?:\\?")\s*:\s*(?:\\?")(?P<value>.*?)(?=\\?")'
            )
            values = {found.group("value") for found in value_pattern.finditer(live)}
            if len(values) == 1:
                output.append(prefix + values.pop() + suffix + ending)
                continue

        raise DeployError(
            f"cannot materialize redacted field in {path}:{line_index + 1}; "
            "no unique matching live value"
        )
    result = "".join(output)
    if REDACTED in result:
        raise DeployError(f"unresolved redaction marker remains in {path}")
    return result


def safe_relative(raw: str) -> Path:
    posix = PurePosixPath(raw)
    if posix.is_absolute() or ".." in posix.parts or not posix.parts:
        raise DeployError(f"unsafe relative path in upgrade metadata: {raw}")
    return Path(*posix.parts)


def effective_deployment_changes(
    run_dir: Path, report: dict[str, Any], candidate: Path
) -> list[dict[str, str]]:
    rebase = report.get("rebase", {})
    recorded = rebase.get("deployment_changes")
    if isinstance(recorded, list):
        return recorded

    original = rebase.get("local_changes", [])
    if all(
        str(item.get("status", "")).startswith("D")
        or (candidate / safe_relative(str(item.get("path", "")))).is_file()
        for item in original
    ):
        return original

    # These are commits in the sanitized synthetic rebase repository, not the
    # source checkout SHA recorded at report.target_commit.
    target = str(rebase.get("target_commit", ""))
    rebased = str(rebase.get("rebased_commit", ""))
    if not re.fullmatch(r"[0-9a-f]{40}", target) or not re.fullmatch(
        r"[0-9a-f]{40}", rebased
    ):
        raise DeployError("run is missing valid target/rebased commits for translated paths")
    repository = run_dir / "resolution-workspace" / "repository"
    if not (repository / ".git").exists():
        raise DeployError("candidate paths changed during rebase but resolution repository is missing")
    result = subprocess.run(
        [
            "git",
            "diff",
            "--name-status",
            "--no-renames",
            target,
            rebased,
        ],
        cwd=repository,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        raise DeployError("cannot derive translated candidate paths from resolution repository")
    changes: list[dict[str, str]] = []
    for line in result.stdout.splitlines():
        status, separator, path = line.partition("\t")
        if not separator or status[:1] not in {"A", "M", "D", "T"}:
            raise DeployError("invalid translated candidate path metadata")
        safe_relative(path)
        changes.append({"status": status, "path": path})
    return changes


def _tree_entry(path: Path) -> tuple[str, str] | None:
    """Return a comparable (kind, value) for one path, or None if absent."""
    if path.is_symlink():
        return ("symlink", os.readlink(path))
    if path.is_file():
        return ("file", sha256_file(path))
    if path.exists():
        return ("other", "")
    return None


def live_drift(
    report: dict[str, Any], live_digit: Path, source_backup: Path
) -> list[str]:
    """Return local-change paths whose live state differs from the analysed backup.

    Analysis captured the operator's local changes from the backup.  If live
    /opt/digit has moved on since then (a rotated secret, a further hand edit,
    a deleted file reappearing), deploying the analysed candidate would
    silently replace that newer state, so every such path is reported.
    """
    drifted: list[str] = []
    for change in report.get("rebase", {}).get("local_changes", []):
        rel_raw = str(change.get("path", ""))
        rel = safe_relative(rel_raw)
        if rel.parts[0] in RUNTIME_MANAGED:
            continue
        if _tree_entry(live_digit / rel) != _tree_entry(source_backup / rel):
            drifted.append(rel.as_posix())
    return sorted(drifted)


def materialize_overlay(
    run_dir: Path, live_digit: Path, source_backup: Path, target_source: Path
) -> tuple[Path, list[str], dict[str, str]]:
    report = json.loads((run_dir / "report.json").read_text(encoding="utf-8"))
    candidate = run_dir / "candidate"
    if report.get("status") != "READY" or not candidate.is_dir():
        raise DeployError("run is not READY or candidate is missing")
    overlay = run_dir / "deployment-overlay"
    if overlay.exists():
        shutil.rmtree(overlay)
    overlay.mkdir(mode=0o700)
    deleted: list[str] = []
    hashes: dict[str, str] = {}
    for change in effective_deployment_changes(run_dir, report, candidate):
        rel_raw = str(change["path"])
        rel = safe_relative(rel_raw)
        if rel.parts[0] in RUNTIME_MANAGED:
            continue
        if str(change["status"]).startswith("D"):
            deleted.append(rel.as_posix())
            continue
        source = candidate / rel
        if source.is_symlink():
            raise DeployError(f"candidate local-change path must not be a symlink: {rel_raw}")
        if not source.is_file():
            raise DeployError(f"candidate local-change file is missing: {rel_raw}")
        destination = overlay / rel
        destination.parent.mkdir(parents=True, exist_ok=True)
        raw = source.read_bytes()
        if b"\x00" in raw[:8192]:
            shutil.copy2(source, destination)
        else:
            candidate_text = raw.decode("utf-8")
            live_path = live_digit / rel
            live_text = live_path.read_text(encoding="utf-8") if live_path.is_file() else ""
            backup_path = source_backup / rel
            backup_text = (
                backup_path.read_text(encoding="utf-8") if backup_path.is_file() else ""
            )
            target_path = target_source / rel
            target_text = (
                target_path.read_text(encoding="utf-8") if target_path.is_file() else ""
            )
            failures: list[DeployError] = []
            # Live is preferred: deploy_run has already verified that every
            # local-change path in live still matches the analysed backup, so
            # live is the current deployment state.  The backup covers
            # candidate paths that do not exist in live (target-side renames),
            # and the target source is the last resort for secret lines that
            # come only from the target version.
            for restoration_source in (live_text, backup_text, target_text):
                try:
                    materialized = materialize_redactions(
                        candidate_text, restoration_source, rel_raw
                    )
                    break
                except DeployError as exc:
                    failures.append(exc)
            else:
                raise failures[-1]
            destination.write_text(materialized, encoding="utf-8", newline="")
            shutil.copymode(source, destination)
        hashes[rel.as_posix()] = sha256_file(destination)
    return overlay, sorted(deleted), dict(sorted(hashes.items()))


def configuration_hashes(root: Path, extra_paths: Iterable[str] = ()) -> dict[str, str]:
    wanted: set[Path] = set()
    for config_root in CONFIG_ROOTS:
        base = root / config_root
        if base.is_dir():
            wanted.update(path for path in base.rglob("*") if path.is_file())
    for raw in extra_paths:
        path = root / safe_relative(raw)
        if path.is_file():
            wanted.add(path)
    return {
        path.relative_to(root).as_posix(): sha256_file(path)
        for path in sorted(wanted, key=lambda item: item.as_posix())
    }


@dataclass
class CommandRunner:
    def run(
        self,
        args: list[str],
        *,
        cwd: Path | None = None,
        env: dict[str, str] | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            args, cwd=cwd, env=env, text=True, capture_output=True, check=False
        )
        if check and result.returncode:
            detail = "\n".join(
                part.strip()
                for part in (result.stdout, result.stderr)
                if part and part.strip()
            )
            command, detail = sanitized_command(args, detail)
            raise DeployError(f"command failed ({command}): {detail}")
        return result

    def stdout_to_file(self, args: list[str], destination: Path) -> None:
        with destination.open("wb") as output:
            result = subprocess.run(args, stdout=output, stderr=subprocess.PIPE, check=False)
        if result.returncode:
            command, detail = sanitized_command(
                args, result.stderr.decode(errors="replace").strip()
            )
            raise DeployError(
                f"command failed ({command}): {detail}"
            )

    def stdin_from_file(self, args: list[str], source: Path) -> None:
        with source.open("rb") as input_stream:
            result = subprocess.run(
                args, stdin=input_stream, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False
            )
        if result.returncode:
            command, detail = sanitized_command(
                args, result.stderr.decode(errors="replace").strip()
            )
            raise DeployError(
                f"command failed ({command}): {detail}"
            )


class UpgradeDeployment:
    def __init__(
        self,
        run_dir: Path,
        repo: Path,
        tenant: str,
        tenant_vars: Path,
        source_backup: Path,
        backup_parent: Path,
        resolution: Path | None,
        runner: CommandRunner | None = None,
        digit_dir: Path = Path("/opt/digit"),
        controller_repo: Path | None = None,
    ) -> None:
        self.run_dir = run_dir.resolve()
        self.repo = repo.resolve()
        self.tenant = tenant
        self.tenant_vars = tenant_vars.resolve()
        self.source_backup = source_backup.resolve()
        self.backup_parent = backup_parent.resolve()
        self.resolution = resolution.resolve() if resolution else None
        self.runner = runner or CommandRunner()
        self.digit_dir = digit_dir
        self.controller_repo = (
            controller_repo.resolve()
            if controller_repo is not None
            else Path(__file__).resolve().parents[2]
        )
        self.backup_dir: Path | None = None
        self.previous_services: list[str] = []
        self.compose_files: list[str] = []
        self.volume_map: list[dict[str, str]] = []
        self.previous_containers: dict[str, str] = {}
        self.docker_volume_root: Path | None = None
        self.project = ""
        self.estimated_backup_bytes = 0

    def validate(self) -> dict[str, Any]:
        if os.name != "posix":
            raise DeployError("deployment mode must run on the Linux deployment server")
        if os.geteuid() != 0:
            raise DeployError("deployment mode must run as root")
        manifest = json.loads((self.run_dir / "run-manifest.json").read_text(encoding="utf-8"))
        if not manifest.get("candidate_created"):
            raise DeployError("run manifest does not contain a completed candidate")
        if manifest.get("deployment_performed"):
            raise DeployError("this run has already been deployed")
        if sha256_file(self.tenant_vars) != manifest.get("tenant_vars_sha256"):
            raise DeployError("tenant-vars hash no longer matches the analysis run")
        if not self.source_backup.is_dir():
            raise DeployError("source backup must be the directory used during analysis")
        if hash_tree(self.source_backup) != manifest.get("backup_sha256"):
            raise DeployError("source backup hash no longer matches the analysis run")
        inventory_vars = (
            self.controller_repo
            / "local-setup/ansible/inventory/host_vars"
            / f"{self.tenant}.yml"
        )
        if not inventory_vars.is_file() or sha256_file(inventory_vars) != sha256_file(self.tenant_vars):
            raise DeployError(
                f"deploy.sh will read {inventory_vars}; it must exist and exactly match --tenant-vars"
            )
        head = self.runner.run(["git", "rev-parse", "HEAD"], cwd=self.repo).stdout.strip()
        if head != manifest.get("target_commit"):
            raise DeployError(
                f"checkout HEAD {head} does not match analysed target {manifest.get('target_commit')}"
            )
        status = self.runner.run(["git", "status", "--porcelain"], cwd=self.repo).stdout.strip()
        if status:
            raise DeployError("target checkout must be clean before deployment")
        if not self.digit_dir.is_dir():
            raise DeployError(f"live DIGIT directory is missing: {self.digit_dir}")
        if not self.backup_parent.is_absolute() or self.backup_parent == Path("/"):
            raise DeployError("backup directory must be an absolute non-root path")
        if self.backup_parent == self.digit_dir or self.digit_dir in self.backup_parent.parents:
            raise DeployError("backup directory must not be inside live /opt/digit")
        return manifest

    def _project_metadata(self) -> None:
        project = self.runner.run(
            ["docker", "inspect", "docker-postgres", "--format", "{{ index .Config.Labels \"com.docker.compose.project\" }}"]
        ).stdout.strip()
        if not project:
            raise DeployError("cannot determine the current Compose project")
        self.project = project
        docker_root = Path(
            self.runner.run(
                ["docker", "info", "--format", "{{.DockerRootDir}}"]
            ).stdout.strip()
        ).resolve()
        if not docker_root.is_absolute() or docker_root == Path("/"):
            raise DeployError(f"unsafe Docker data root: {docker_root}")
        self.docker_volume_root = docker_root / "volumes"
        ids = self.runner.run(
            ["docker", "ps", "-aq", "--filter", f"label=com.docker.compose.project={project}"]
        ).stdout.split()
        services: set[str] = set()
        volumes: dict[str, dict[str, str]] = {}
        config_files = ""
        for container_id in ids:
            raw = self.runner.run(["docker", "inspect", container_id]).stdout
            info = json.loads(raw)[0]
            labels = info.get("Config", {}).get("Labels", {}) or {}
            service = labels.get("com.docker.compose.service")
            running = bool(info.get("State", {}).get("Running"))
            if service and running:
                services.add(service)
                self.previous_containers[service] = container_id
            config_files = config_files or labels.get("com.docker.compose.project.config_files", "")
            # A stopped one-shot Compose container may still be listed here
            # while Docker is asynchronously removing its anonymous volume.
            # Only running services are part of the stack being protected and
            # restarted, so only their volumes belong in this backup set.
            if running:
                for mount in info.get("Mounts", []):
                    if mount.get("Type") == "volume":
                        name = mount["Name"]
                        volumes[name] = {
                            "name": name,
                            "service": service or "unknown",
                            "destination": mount["Destination"],
                        }
        self.previous_services = sorted(services)
        self.compose_files = [item for item in config_files.split(",") if item]
        self.volume_map = [volumes[key] for key in sorted(volumes)]
        if not self.previous_services or not self.volume_map or not self.compose_files:
            raise DeployError("current Compose service/volume metadata is incomplete")
        size_paths = [self.digit_dir]
        for item in self.volume_map:
            inspect = json.loads(
                self.runner.run(["docker", "volume", "inspect", item["name"]]).stdout
            )[0]
            size_paths.append(Path(inspect["Mountpoint"]))
        for path in size_paths:
            result = self.runner.run(["du", "-sb", str(path)])
            self.estimated_backup_bytes += int(result.stdout.split()[0])
        free = shutil.disk_usage(self.backup_parent).free
        required = self.estimated_backup_bytes * 2 + 1024**3
        if free < required:
            raise DeployError(
                f"insufficient backup space: need at least {required} bytes, have {free}"
            )

    def _validate_candidate_compose(self, overlay: Path) -> None:
        """Reject an internally inconsistent candidate before production stops."""
        candidate = self.run_dir / "candidate"
        names = (
            "docker-compose.egov-digit.yaml",
            "docker-compose.migrations.yml",
            "docker-compose.monitoring.yml",
            "docker-compose.matomo.yml",
            "docker-compose.opensre.yml",
        )
        missing = [name for name in names if not (candidate / name).is_file()]
        if missing:
            raise DeployError(
                "candidate is missing deployment Compose file(s): "
                + ", ".join(missing)
            )
        safety_overlay = (
            self.controller_repo / "local-setup/docker-compose.upgrade-safe.yml"
        )
        if not safety_overlay.is_file():
            raise DeployError(f"controller safety overlay is missing: {safety_overlay}")
        live_env = self.digit_dir / ".env"
        if not live_env.is_file():
            raise DeployError(f"live Compose environment is missing: {live_env}")
        args = [
            "docker", "compose",
            "--env-file", str(live_env),
            "--project-directory", str(candidate),
        ]
        for name in names:
            materialized = overlay / name
            args.extend(["-f", str(materialized if materialized.is_file() else candidate / name)])
        args.extend(["-f", str(safety_overlay)])
        # Validate every profiled service, not only the services enabled for
        # this tenant. This catches cross-file contracts such as an overlay
        # service referring to a network removed by a whole-file conflict
        # resolution. No container is created and live /opt/digit is untouched.
        args.extend(["--profile", "*", "config", "--quiet"])
        self.runner.run(args, cwd=candidate)

    def _stop_writers(self) -> None:
        for service in self.previous_services:
            if service != "postgres-db":
                self.runner.run(["docker", "stop", self._container_for_service(service)], check=False)

    def _container_for_service(self, service: str) -> str:
        result = self.runner.run(
            [
                "docker", "ps", "-aq",
                "--filter", f"label=com.docker.compose.project={self.project}",
                "--filter", f"label=com.docker.compose.service={service}",
            ],
            check=False,
        ).stdout.split()
        return result[0] if result else service

    def _snapshot_tables(self, destination: Path, container: str = "docker-postgres") -> dict[str, Any]:
        output: dict[str, list[dict[str, Any]]] = {}
        for table, keys in MDMS_TABLES.items():
            order = ",".join(keys)
            # psql's unaligned tuples-only output preserves the JSON text as
            # emitted by PostgreSQL. COPY text adds a second escaping layer
            # (notably for backslashes/newlines inside JSON strings), which is
            # not directly parseable by json.loads.
            sql = f"SELECT to_jsonb(t)::text FROM public.{table} t ORDER BY {order}"
            result = self.runner.run(
                ["docker", "exec", "-u", "postgres", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "egov", "-d", "egov", "-Atc", sql]
            )
            output[table] = [json.loads(line) for line in result.stdout.splitlines() if line]
        destination.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        loaded = load_snapshot(destination)
        return snapshot_summary(loaded)

    def _archive_volumes(self, volume_dir: Path) -> None:
        volume_dir.mkdir(parents=True)
        for item in self.volume_map:
            mountpoint = self._volume_mountpoint(item["name"])
            archive = volume_dir / f"{item['name']}.tar.zst"
            self.runner.run(["tar", "--zstd", "-cpf", str(archive), "-C", str(mountpoint), "."])

    def _volume_mountpoint(self, name: str) -> Path:
        if self.docker_volume_root is None:
            raise DeployError("Docker volume root is unavailable")
        inspect = json.loads(
            self.runner.run(["docker", "volume", "inspect", name]).stdout
        )[0]
        mountpoint = Path(inspect["Mountpoint"]).resolve()
        if (
            mountpoint.name != "_data"
            or mountpoint.parent.parent != self.docker_volume_root
        ):
            raise DeployError(f"refusing unsafe Docker volume mountpoint: {mountpoint}")
        return mountpoint

    def backup(self, overlay_hashes: dict[str, str]) -> dict[str, Any]:
        stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d-%H%M%S")
        self.backup_dir = self.backup_parent / f"digit-upgrade-{stamp}"
        self.backup_dir.mkdir(parents=True, mode=0o700)
        self._project_metadata()
        self._stop_writers()
        database = self.backup_dir / "egov.dump"
        globals_dump = self.backup_dir / "globals.sql"
        self.runner.stdout_to_file(
            ["docker", "exec", "-u", "postgres", "docker-postgres", "pg_dump", "-U", "egov", "-d", "egov", "-Fc", "--no-owner"],
            database,
        )
        self.runner.stdout_to_file(
            ["docker", "exec", "-u", "postgres", "docker-postgres", "pg_dumpall", "-U", "egov", "--globals-only"],
            globals_dump,
        )
        os.chmod(database, 0o600)
        os.chmod(globals_dump, 0o600)
        self.runner.stdin_from_file(
            ["docker", "exec", "-i", "docker-postgres", "pg_restore", "--list"],
            database,
        )
        pre_snapshot = self.backup_dir / "mdms-before.json"
        mdms = self._snapshot_tables(pre_snapshot)
        config = configuration_hashes(self.digit_dir, overlay_hashes)
        (self.backup_dir / "config-hashes-before.json").write_text(
            json.dumps(config, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        self.runner.run(["docker", "stop", "docker-postgres"])
        config_roots = [name for name in CONFIG_ROOTS if (self.digit_dir / name).exists()]
        mdms_config_archive = self.backup_dir / "mdms-config.tar.zst"
        self.runner.run(
            ["tar", "--zstd", "-cpf", str(mdms_config_archive), "-C", str(self.digit_dir), *config_roots]
        )
        self.runner.run(["tar", "--zstd", "-cpf", str(self.backup_dir / "opt-digit.tar.zst"), "-C", "/opt", "digit"])
        self._archive_volumes(self.backup_dir / "volumes")
        metadata = {
            "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "database_sha256": sha256_file(database),
            "globals_sha256": sha256_file(globals_dump),
            "mdms_config_archive_sha256": sha256_file(mdms_config_archive),
            "mdms": mdms,
            "config_hashes": config,
            "compose_files": self.compose_files,
            "running_services": self.previous_services,
            "volumes": self.volume_map,
            "estimated_source_bytes": self.estimated_backup_bytes,
        }
        (self.backup_dir / "backup-manifest.json").write_text(
            json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        return metadata

    def _clone_expected(self) -> tuple[dict[str, Any], dict[str, Any]]:
        assert self.backup_dir is not None
        suffix = secrets.token_hex(4)
        network = f"digit-upgrade-{suffix}"
        container = f"digit-upgrade-postgres-{suffix}"
        password = secrets.token_urlsafe(24)
        image = f"digit-upgrade-mdms:{suffix}"
        self.runner.run(["docker", "network", "create", network])
        try:
            self.runner.run([
                "docker", "run", "-d", "--name", container, "--network", network,
                "-e", "POSTGRES_USER=egov", "-e", f"POSTGRES_PASSWORD={password}",
                "-e", "POSTGRES_DB=egov", "egovio/postgres:16",
            ])
            for _ in range(60):
                ready = self.runner.run(
                    ["docker", "exec", container, "pg_isready", "-U", "egov", "-d", "egov"], check=False
                )
                if ready.returncode == 0:
                    break
                import time
                time.sleep(2)
            else:
                raise DeployError("isolated PostgreSQL clone did not become ready")
            self.runner.stdin_from_file(
                ["docker", "exec", "-i", container, "pg_restore", "-U", "egov", "-d", "egov", "--no-owner", "--exit-on-error"],
                self.backup_dir / "egov.dump",
            )
            self.runner.run([
                "docker", "build", "-t", image,
                str(self.repo / "local-setup/docker/db-migrations"),
            ])
            self.runner.run([
                "docker", "run", "--rm", "--network", network,
                "-e", f"DB_URL=jdbc:postgresql://{container}:5432/egov",
                "-e", "FLYWAY_USER=egov", "-e", f"FLYWAY_PASSWORD={password}",
                "-e", "MIGRATION_SERVICES=egov-mdms", image,
            ])
            clone_path = self.backup_dir / "mdms-target-clone.json"
            summary = self._snapshot_tables(clone_path, container)
            return load_snapshot(clone_path), summary
        finally:
            self.runner.run(["docker", "rm", "-f", container], check=False)
            self.runner.run(["docker", "network", "rm", network], check=False)
            self.runner.run(["docker", "image", "rm", image], check=False)

    def _load_choices(self, conflicts: list[dict[str, Any]]) -> dict[str, str]:
        assert self.backup_dir is not None
        safe_conflicts = []
        template: dict[str, str] = {}
        for item in conflicts:
            key = f"{item['table']}:{item['key']}"
            template[key] = "CHOOSE_backup_OR_target"
            safe_conflicts.append({
                "table": item["table"], "key": item["key"], "kind": item["kind"],
                "backup_sha256": sha256_bytes(canonical_json(item["backup"]).encode()),
                "target_sha256": sha256_bytes(canonical_json(item["target"]).encode()) if item["target"] is not None else None,
                "backup": sanitize_structure(item["backup"]),
                "target": sanitize_structure(item["target"]),
            })
        (self.run_dir / "mdms-conflicts.json").write_text(
            json.dumps(safe_conflicts, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        template_path = self.run_dir / "mdms-resolution.json"
        if not template_path.exists():
            template_path.write_text(json.dumps(template, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        if not conflicts:
            return {}
        if self.resolution is None:
            raise MdmsConflict(
                f"{len(conflicts)} MDMS conflict(s) require resolution; edit {template_path} and rerun with --mdms-resolution"
            )
        raw = json.loads(self.resolution.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise MdmsConflict("MDMS resolution must be a JSON object")
        return {str(key): str(value) for key, value in raw.items()}

    def _apply_backup_rows(self, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        statements = ["BEGIN;"]
        for item in rows:
            table = item["table"]
            row_json = canonical_json(item["row"]).replace("'", "''")
            columns = list(item["row"].keys())
            keys = MDMS_TABLES[table]
            assignments = ", ".join(f"{column}=EXCLUDED.{column}" for column in columns if column not in keys)
            statements.append(
                f"INSERT INTO public.{table} SELECT * FROM jsonb_populate_record(NULL::public.{table}, '{row_json}'::jsonb) "
                f"ON CONFLICT ({','.join(keys)}) DO UPDATE SET {assignments};"
            )
        statements.append("COMMIT;")
        sql_path = self.run_dir / ".mdms-resolution.sql"
        sql_path.write_text("\n".join(statements) + "\n", encoding="utf-8")
        try:
            self.runner.stdin_from_file(
                ["docker", "exec", "-i", "-u", "postgres", "docker-postgres", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "egov", "-d", "egov"],
                sql_path,
            )
        finally:
            sql_path.unlink(missing_ok=True)

    def _compose_up_previous(self) -> None:
        existing = []
        for service in self.previous_services:
            container = self.previous_containers.get(service)
            if not container:
                existing = []
                break
            inspected = self.runner.run(
                ["docker", "inspect", container], check=False
            )
            if inspected.returncode:
                existing = []
                break
            existing.append(container)
        if len(existing) == len(self.previous_services):
            self.runner.run(["docker", "start", *existing], check=False)
            return

        args = ["docker", "compose", "-p", self.project]
        for compose_file in self.compose_files:
            args.extend(["-f", compose_file])
        # Recreate only the long-lived services.  Their normal dependencies
        # include migration and seed one-shots, which must never run while
        # recovering a pre-deployment failure or rollback.
        args.extend(
            ["up", "-d", "--no-deps", "--pull", "never", *self.previous_services]
        )
        self.runner.run(args, cwd=self.digit_dir)

    def rollback(self, reason: str) -> None:
        if self.backup_dir is None:
            raise DeployError(f"rollback unavailable before backup: {reason}")
        current_ids = self.runner.run(
            ["docker", "ps", "-q", "--filter", f"label=com.docker.compose.project={self.project}"],
            check=False,
        ).stdout.split()
        if current_ids:
            self.runner.run(["docker", "stop", *current_ids], check=False)
        failed = Path(f"/opt/digit.failed-{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}")
        if self.digit_dir.exists():
            self.digit_dir.rename(failed)
        self.runner.run(["tar", "--zstd", "-xpf", str(self.backup_dir / "opt-digit.tar.zst"), "-C", "/opt"])
        for item in self.volume_map:
            mountpoint = self._volume_mountpoint(item["name"])
            for child in mountpoint.iterdir():
                if child.is_dir() and not child.is_symlink():
                    shutil.rmtree(child)
                else:
                    child.unlink()
            self.runner.run(["tar", "--zstd", "-xpf", str(self.backup_dir / "volumes" / f"{item['name']}.tar.zst"), "-C", str(mountpoint)])
        self._compose_up_previous()
        rollback_snapshot = self.backup_dir / "mdms-after-rollback.json"
        self._snapshot_tables(rollback_snapshot)
        before = load_snapshot(self.backup_dir / "mdms-before.json")
        after = load_snapshot(rollback_snapshot)
        if snapshot_summary(before) != snapshot_summary(after):
            raise DeployError(f"rollback completed but MDMS verification failed; original reason: {reason}")
        backup_manifest = json.loads(
            (self.backup_dir / "backup-manifest.json").read_text(encoding="utf-8")
        )
        restored_config = configuration_hashes(
            self.digit_dir, backup_manifest.get("config_hashes", {}).keys()
        )
        if restored_config != backup_manifest.get("config_hashes"):
            raise DeployError(f"rollback completed but configuration verification failed; original reason: {reason}")
        (self.backup_dir / "rollback-report.json").write_text(
            json.dumps({"status": "ROLLED_BACK", "reason": reason, "failed_tree": str(failed)}, indent=2) + "\n",
            encoding="utf-8",
        )

    def _check_live_drift(self) -> None:
        report = json.loads((self.run_dir / "report.json").read_text(encoding="utf-8"))
        drifted = live_drift(report, self.digit_dir, self.source_backup)
        if drifted:
            shown = ", ".join(drifted[:20])
            more = f" (and {len(drifted) - 20} more)" if len(drifted) > 20 else ""
            raise DeployError(
                f"live {self.digit_dir} changed since analysis in {len(drifted)} "
                f"locally changed path(s): {shown}{more}. Take a fresh backup of "
                f"{self.digit_dir} and re-run the analysis so these changes are "
                "carried into the candidate; production was not changed"
            )

    def execute(self) -> dict[str, Any]:
        manifest = self.validate()
        self._check_live_drift()
        overlay, deleted, overlay_hashes = materialize_overlay(
            self.run_dir,
            self.digit_dir,
            self.source_backup,
            self.repo / "local-setup",
        )
        self._validate_candidate_compose(overlay)
        self.backup_parent.mkdir(parents=True, exist_ok=True)
        lock_path = self.backup_parent / ".digit-upgrade.lock"
        with lock_path.open("w", encoding="utf-8") as lock:
            import fcntl

            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise DeployError("another DIGIT upgrade is already running") from exc
            try:
                backup_manifest = self.backup(overlay_hashes)
            except Exception:
                if self.compose_files and self.previous_services:
                    self._compose_up_previous()
                raise
            deployment_started = False
            try:
                before = load_snapshot(self.backup_dir / "mdms-before.json")  # type: ignore[operator]
                expected, clone_summary = self._clone_expected()
                delta = mdms_delta(before, expected)
                choices = self._load_choices(delta["conflicts"])
                expected, restore_rows = apply_resolutions(expected, delta["conflicts"], choices)
                expected_summary = snapshot_summary(expected)
                (self.run_dir / "mdms-expected.json").write_text(
                    json.dumps(expected_summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
                )
                # The previous stack is still stopped. deploy.sh performs the
                # normal render, OpenBao restoration, migrations, startup and
                # health checks with all reseeding paths disabled.
                extra_vars = {
                    "upgrade_safe_mode": True,
                    "upgrade_overlay_dir": str(overlay),
                    "upgrade_deleted_paths": deleted,
                    "force_clean": False,
                    "run_ci_tests": False,
                    "seed_notifications": False,
                }
                # From this point a failed deploy.sh may have changed files,
                # containers, or volumes even when the command itself exits
                # non-zero, so every subsequent failure requires full rollback.
                deployment_started = True
                self.runner.run(
                    ["bash", "deploy.sh", self.tenant, "-e", json.dumps(extra_vars, separators=(",", ":"))],
                    cwd=self.controller_repo / "local-setup/ansible",
                )
                self._apply_backup_rows(restore_rows)
                post_path = self.run_dir / "mdms-after.json"
                post_summary = self._snapshot_tables(post_path)
                if post_summary != expected_summary:
                    raise DeployError("post-deploy MDMS rows/counts/checksums differ from the resolved expected state")
                for rel, expected_hash in overlay_hashes.items():
                    path = self.digit_dir / safe_relative(rel)
                    if not path.is_file() or sha256_file(path) != expected_hash:
                        raise DeployError(f"protected local configuration changed or disappeared: {rel}")
                for rel in deleted:
                    if (self.digit_dir / safe_relative(rel)).exists():
                        raise DeployError(f"resolved local deletion was recreated: {rel}")
                config_after = configuration_hashes(self.digit_dir, overlay_hashes)
                result = {
                    "status": "DEPLOYED",
                    "deployed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                    "backup": str(self.backup_dir),
                    "target_commit": manifest["target_commit"],
                    "mdms_before": backup_manifest["mdms"],
                    "mdms_clone": clone_summary,
                    "mdms_after": post_summary,
                    "mdms_conflicts_resolved": len(delta["conflicts"]),
                    "protected_config_hashes": overlay_hashes,
                    "configuration_hashes_after": config_after,
                }
                (self.run_dir / "deployment-report.json").write_text(
                    json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8"
                )
                manifest["deployment_performed"] = True
                manifest["deployment_report"] = str(self.run_dir / "deployment-report.json")
                (self.run_dir / "run-manifest.json").write_text(
                    json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
                )
                return result
            except MdmsConflict:
                self._compose_up_previous()
                raise
            except Exception as exc:
                if deployment_started:
                    self.rollback(str(exc))
                    raise DeployError(
                        f"deployment failed and the previous stack was restored: {exc}"
                    ) from exc
                self._compose_up_previous()
                raise DeployError(
                    f"deployment preflight failed; production was not changed and the previous stack was restarted: {exc}"
                ) from exc


def deploy_run(
    run_dir: Path,
    repo: Path,
    tenant: str,
    tenant_vars: Path,
    source_backup: Path,
    backup_parent: Path,
    resolution: Path | None,
) -> dict[str, Any]:
    return UpgradeDeployment(
        run_dir, repo, tenant, tenant_vars, source_backup, backup_parent, resolution
    ).execute()
