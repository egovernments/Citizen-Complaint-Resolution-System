#!/usr/bin/env python3
"""Read-only DIGIT upgrade analyser.

The analyser renders deterministic deployment trees for two Git references,
compares the current render with an /opt/digit backup, and applies the detected
local changes to the target render with a real three-way Git merge.  It never
runs deploy.sh and never talks to Docker, OpenBao, or a database.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import hmac
import json
import os
import posixpath
import re
import secrets
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any, Iterable


LEGACY_COMMIT = "5f86a10264280735984c661df2de0d1bc9a708a8"
MDMS_TABLES = ("eg_mdms_data", "eg_mdms_schema_definition")
EXCLUDED_PATTERNS = (
    ".build",
    ".build/**",
    ".openbao",
    ".openbao/**",
    "**/node_modules",
    "**/node_modules/**",
    "**/.cache/**",
    "**/__pycache__/**",
    "**/test-results/**",
    "**/playwright-report/**",
    "ci-tests",
    "ci-tests/**",
    "e2e-tests",
    "e2e-tests/**",
    "test_onboarding_regressions.py",
    "digit-stack-up.*.progress",
    "**/*.log",
    "**/*.tmp",
    "otel/opentelemetry-javaagent.jar",
    "db/full-dump.sql",
)
SENSITIVE_KEY = re.compile(
    r"(?i)(password|passwd|secret|token|api[_-]?key|private[_-]?key|credential|unseal)"
)
RENDER_DESTINATION_PREFIXES = (
    "/.build",
    "/.env",
    "/.openbao",
    "/bootstrap-novu-whatsapp.sh",
    "/ci-tests",
    "/configurator-runtime",
    "/dataloader",
    "/docker",
    "/docker-compose.",
    "/e2e-tests",
    "/keycloak",
    "/jupyter",
    "/kong",
    "/matomo-",
    "/nginx",
    "/notification-seed",
    "/novu-mint-key.sh",
    "/scripts",
    "/test_onboarding_regressions.py",
)
SECRET_FIELD_ASSIGNMENT = re.compile(
    r"(?im)^\s*(?P<key>[A-Za-z0-9_.-]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIAL|UNSEAL)[A-Za-z0-9_.-]*)\s*[:=]\s*(?P<value>.*)$"
)
TEXT_SECRET_ASSIGNMENT = re.compile(
    r"(?im)^(?P<prefix>\s*(?:[A-Za-z0-9_.-]*"
    r"(?:PASSWORD|PASSWD|SECRET|TOKEN|API[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIAL|UNSEAL)"
    r"[A-Za-z0-9_.-]*)\s*[:=]\s*)(?P<value>.*)$"
)
JSON_SECRET = re.compile(
    r'(?i)("[^"\n]*(?:password|passwd|secret|token|api[_-]?key|private[_-]?key|credential|unseal)[^"\n]*"\s*:\s*)'
    r'("(?:\\.|[^"\\])*"|[^,}\n]+)'
)


class DryRunError(RuntimeError):
    """Expected validation or execution failure."""


def run(
    args: list[str],
    *,
    cwd: Path | None = None,
    check: bool = True,
    text: bool = True,
    stdout: Any = subprocess.PIPE,
) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            args,
            cwd=cwd,
            check=check,
            text=text,
            stdout=stdout,
            stderr=subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise DryRunError(f"required command not found: {args[0]}") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "").strip()
        raise DryRunError(f"command failed ({' '.join(args)}): {detail}") from exc


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def hash_tree(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*"), key=lambda p: p.as_posix()):
        rel = path.relative_to(root).as_posix()
        if path.is_symlink():
            digest.update(f"L\0{rel}\0{os.readlink(path)}\n".encode())
        elif path.is_file():
            digest.update(f"F\0{rel}\0".encode())
            digest.update(bytes.fromhex(sha256_file(path)))
    return digest.hexdigest()


def resolve_ref(repo: Path, ref: str) -> str:
    result = run(["git", "rev-parse", "--verify", f"{ref}^{{commit}}"], cwd=repo)
    commit = result.stdout.strip()
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise DryRunError(f"Git reference did not resolve to a commit: {ref}")
    return commit


def git_bytes(repo: Path, ref: str, path: str) -> bytes:
    result = run(
        ["git", "show", f"{ref}:{path}"], cwd=repo, text=False
    )
    return result.stdout


def export_ref(repo: Path, commit: str, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    archive = destination.parent / f"{commit}.tar"
    with archive.open("wb") as stream:
        run(
            ["git", "archive", "--format=tar", commit],
            cwd=repo,
            text=False,
            stdout=stream,
        )
    safe_extract_tar(archive, destination)
    archive.unlink()


def safe_extract_tar(archive: Path, destination: Path) -> None:
    root = destination.resolve()
    with tarfile.open(archive, "r:*") as bundle:
        safe_members = []
        for member in bundle.getmembers():
            name = PurePosixPath(member.name)
            if name.is_absolute() or ".." in name.parts:
                raise DryRunError(f"unsafe archive member: {member.name}")
            target = (destination / Path(*name.parts)).resolve()
            if target != root and root not in target.parents:
                raise DryRunError(f"archive member escapes destination: {member.name}")
            if member.issym() or member.islnk():
                link = PurePosixPath(member.linkname)
                # Symlink targets are relative to the containing directory;
                # hard-link targets are archive-root relative.  Allow ordinary
                # in-tree ../ links used by the monorepo, but never a target
                # that normalizes outside the archive root.
                combined = (
                    posixpath.join(str(name.parent), str(link))
                    if member.issym()
                    else str(link)
                )
                normalized = posixpath.normpath(combined)
                unsafe_link = (
                    link.is_absolute()
                    or normalized == ".."
                    or normalized.startswith("../")
                )
                if unsafe_link and excluded(member.name):
                    # Some historical refs contain developer-machine symlinks
                    # for node_modules.  These paths are never deployment
                    # inputs, so omit them instead of following or extracting
                    # an unsafe link.
                    continue
                if unsafe_link:
                    raise DryRunError(f"unsafe archive link: {member.name}")
            safe_members.append(member)
        # Python 3.12's data filter adds defense in depth.  The explicit
        # validation above keeps the same behavior on older Ansible hosts.
        if sys.version_info >= (3, 12):
            bundle.extractall(destination, members=safe_members, filter="data")
        else:
            bundle.extractall(destination, members=safe_members)


def copy_backup(source: Path, destination: Path) -> Path:
    if source.is_dir():
        # Directories are consumed read-only by normalize_tree; avoiding an
        # eager copy also avoids duplicating multi-gigabyte build caches that
        # are excluded from analysis anyway.
        return source.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    if source.is_file() and tarfile.is_tarfile(source):
        safe_extract_tar(source, destination)
    else:
        raise DryRunError("--backup must be a directory or tar archive")

    entries = [p for p in destination.iterdir()]
    if len(entries) == 1 and entries[0].is_dir():
        only = entries[0]
        # Accept archives containing digit/, opt/digit/, or one wrapper dir.
        if only.name == "opt" and (only / "digit").is_dir():
            return only / "digit"
        return only
    if (destination / "opt" / "digit").is_dir():
        return destination / "opt" / "digit"
    if (destination / "digit").is_dir():
        return destination / "digit"
    return destination


def excluded(relative: str) -> bool:
    path = PurePosixPath(relative)
    return any(path.match(pattern) for pattern in EXCLUDED_PATTERNS)


def is_binary_bytes(data: bytes) -> bool:
    if b"\0" in data[:8192]:
        return True


def secret_digest(key: bytes, value: bytes) -> str:
    """Return an in-memory-only comparison token for a secret value."""
    return hmac.new(key, value, hashlib.sha256).hexdigest()


def _record_secret_value(
    state: dict[str, dict[str, str | None]],
    values: set[bytes],
    relative: str,
    field: str,
    value: Any,
    hmac_key: bytes,
) -> None:
    if not isinstance(value, (str, int, float)):
        return
    raw = str(value).strip().strip("'\"").encode("utf-8")
    digest = secret_digest(hmac_key, raw) if is_secret_candidate(raw) else None
    state.setdefault(relative, {})[field] = digest
    if digest is not None:
        values.add(raw)


def _walk_secret_fields(
    value: Any,
    state: dict[str, dict[str, str | None]],
    values: set[bytes],
    relative: str,
    hmac_key: bytes,
    prefix: str = "$",
) -> None:
    if isinstance(value, dict):
        for child_key, child_value in value.items():
            field = f"{prefix}.{child_key}"
            if is_secret_key(str(child_key)):
                _record_secret_value(
                    state, values, relative, field, child_value, hmac_key
                )
            else:
                _walk_secret_fields(
                    child_value, state, values, relative, hmac_key, field
                )
    elif isinstance(value, list):
        for index, child_value in enumerate(value):
            _walk_secret_fields(
                child_value,
                state,
                values,
                relative,
                hmac_key,
                f"{prefix}[{index}]",
            )


def scan_tree_secrets(
    source: Path, hmac_key: bytes
) -> tuple[dict[str, dict[str, str | None]], set[bytes]]:
    """Fingerprint sensitive fields without returning or persisting their values."""
    state: dict[str, dict[str, str | None]] = {}
    values: set[bytes] = set()
    for path in sorted(source.rglob("*"), key=lambda item: item.as_posix()):
        rel = path.relative_to(source).as_posix()
        if (
            excluded(rel)
            or any(
                excluded(parent.as_posix()) for parent in PurePosixPath(rel).parents
            )
            or not path.is_file()
        ):
            continue
        data = path.read_bytes()
        if is_binary_bytes(data):
            continue
        text = data.decode("utf-8")

        parsed: Any = None
        try:
            if path.suffix.lower() == ".json":
                parsed = json.loads(text)
            elif path.suffix.lower() in {".yml", ".yaml"}:
                import yaml  # type: ignore

                parsed = yaml.safe_load(text)
        except Exception:
            # Deployment files may contain Jinja or other non-standard syntax;
            # line-oriented assignment detection below still handles them.
            parsed = None
        if parsed is not None:
            _walk_secret_fields(parsed, state, values, rel, hmac_key)

        if parsed is None:
            for index, match in enumerate(
                SECRET_FIELD_ASSIGNMENT.finditer(text), 1
            ):
                key = match.group("key")
                _record_secret_value(
                    state,
                    values,
                    rel,
                    f"line:{key}:{index}",
                    match.group("value"),
                    hmac_key,
                )
    return state, values


def compare_secret_states(
    current: dict[str, dict[str, str | None]],
    backup: dict[str, dict[str, str | None]],
    target: dict[str, dict[str, str | None]],
) -> dict[str, Any]:
    """Compare secret metadata while returning no secret-derived material."""
    findings: list[dict[str, str]] = []
    locations = {
        (path, field)
        for tree in (current, backup, target)
        for path, fields in tree.items()
        for field in fields
    }
    for path, field in sorted(locations):
        old = current.get(path, {}).get(field, "missing")
        local = backup.get(path, {}).get(field, "missing")
        new = target.get(path, {}).get(field, "missing")
        finding: dict[str, str] | None = None
        if old == "missing" and local != "missing":
            if new != "missing" and local == new:
                continue
            finding = {
                "path": path,
                "field": field,
                "change": "unverifiable",
                "severity": "warning",
            }
        elif old != "missing" and local == "missing":
            finding = {
                "path": path,
                "field": field,
                "change": "removed",
                "severity": "blocker",
            }
        elif old is None or local is None:
            if old != local:
                finding = {
                    "path": path,
                    "field": field,
                    "change": "unverifiable",
                    "severity": "warning",
                }
        elif old != local:
            finding = {
                "path": path,
                "field": field,
                "change": "changed",
                "severity": "blocker",
            }
        if finding is not None:
            findings.append(finding)
    return {
        "blocked": any(item["severity"] == "blocker" for item in findings),
        "findings": findings,
        "warning_count": sum(
            item["severity"] == "warning" for item in findings
        ),
        "blocker_count": sum(
            item["severity"] == "blocker" for item in findings
        ),
    }
    try:
        data.decode("utf-8")
        return False
    except UnicodeDecodeError:
        return True


def redact_text(text: str, exact_values: Iterable[bytes] = ()) -> str:
    text = TEXT_SECRET_ASSIGNMENT.sub(
        lambda match: match.group("prefix") + "<REDACTED>", text
    )
    text = JSON_SECRET.sub(lambda match: match.group(1) + '"<REDACTED>"', text)
    for raw in sorted(exact_values, key=len, reverse=True):
        try:
            value = raw.decode("utf-8")
        except UnicodeDecodeError:
            continue
        text = text.replace(value, "<REDACTED>")
    return text


def normalize_tree(
    source: Path, destination: Path, exact_secret_values: Iterable[bytes] = ()
) -> dict[str, dict[str, Any]]:
    """Copy a tree while excluding noise, redacting secrets, and recording metadata."""
    metadata: dict[str, dict[str, Any]] = {}
    destination.mkdir(parents=True, exist_ok=True)
    for path in sorted(source.rglob("*"), key=lambda p: p.as_posix()):
        rel = path.relative_to(source).as_posix()
        if excluded(rel) or any(excluded(parent.as_posix()) for parent in PurePosixPath(rel).parents):
            continue
        target = destination / Path(*PurePosixPath(rel).parts)
        info = path.lstat()
        entry: dict[str, Any] = {
            "type": "directory" if path.is_dir() else "file",
            "mode": stat.S_IMODE(info.st_mode),
        }
        if hasattr(info, "st_uid"):
            entry["uid"] = info.st_uid
            entry["gid"] = info.st_gid
        if path.is_symlink():
            entry["type"] = "symlink"
            entry["target"] = os.readlink(path)
            target.parent.mkdir(parents=True, exist_ok=True)
            os.symlink(entry["target"], target)
        elif path.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        elif path.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            data = path.read_bytes()
            if is_binary_bytes(data):
                target.write_bytes(data)
                entry["binary"] = True
            else:
                clean = redact_text(data.decode("utf-8"), exact_secret_values)
                target.write_text(clean, encoding="utf-8", newline="")
                entry["binary"] = False
            try:
                os.chmod(target, stat.S_IMODE(info.st_mode))
            except OSError:
                pass
        metadata[rel] = entry
    return metadata


def replace_tree(source: Path, destination: Path) -> None:
    for child in destination.iterdir():
        if child.name == ".git":
            continue
        if child.is_dir() and not child.is_symlink():
            shutil.rmtree(child)
        else:
            child.unlink()
    shutil.copytree(source, destination, dirs_exist_ok=True, symlinks=True)


def git(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    return run(
        [
            "git",
            "-c",
            "user.name=DIGIT Dry Run",
            "-c",
            "user.email=digit-dry-run.invalid",
            *args,
        ],
        cwd=repo,
        check=check,
    )


def stage_all(repo: Path) -> None:
    git(repo, "add", "-A")
    # Force tracked files through Git's content filter.  This avoids a Windows
    # racy-stat edge case where same-sized rewrites inside one filesystem clock
    # tick can otherwise be mistaken for unchanged files.
    git(repo, "add", "--renormalize", ".")


def parse_name_status(raw: str) -> list[tuple[str, str]]:
    result: list[tuple[str, str]] = []
    for line in raw.splitlines():
        if not line:
            continue
        status_code, _, path = line.partition("\t")
        # Rename/copy output has old and new paths; keep the destination.
        if "\t" in path:
            path = path.split("\t")[-1]
        result.append((status_code, path))
    return result


def three_way_merge(
    base: Path,
    local: Path,
    target: Path,
    workspace: Path,
    output: Path,
) -> dict[str, Any]:
    merge_repo = workspace / "merge-repo"
    merge_repo.mkdir()
    git(merge_repo, "init", "-q")
    replace_tree(base, merge_repo)
    stage_all(merge_repo)
    git(merge_repo, "commit", "-q", "--allow-empty", "-m", "base")
    base_sha = git(merge_repo, "rev-parse", "HEAD").stdout.strip()

    git(merge_repo, "checkout", "-q", "-b", "local")
    replace_tree(local, merge_repo)
    stage_all(merge_repo)
    git(merge_repo, "commit", "-q", "--allow-empty", "-m", "local")
    local_sha = git(merge_repo, "rev-parse", "HEAD").stdout.strip()

    changes = parse_name_status(
        git(merge_repo, "diff", "--name-status", "-M", base_sha, local_sha).stdout
    )
    patch = git(merge_repo, "diff", "--binary", base_sha, local_sha).stdout
    (output / "local-changes.patch").write_text(patch, encoding="utf-8")

    deletions = [path for status_code, path in changes if status_code.startswith("D")]
    (output / "deletions.json").write_text(
        json.dumps(deletions, indent=2) + "\n", encoding="utf-8"
    )

    local_files = output / "local-files"
    local_files.mkdir()
    for status_code, rel in changes:
        source = local / Path(*PurePosixPath(rel).parts)
        if not source.is_file() and not source.is_symlink():
            continue
        if status_code.startswith("A") or (source.is_file() and is_binary_bytes(source.read_bytes())):
            destination = local_files / Path(*PurePosixPath(rel).parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            if source.is_symlink():
                os.symlink(os.readlink(source), destination)
            else:
                shutil.copy2(source, destination)

    git(merge_repo, "checkout", "-q", "-b", "target", base_sha)
    replace_tree(target, merge_repo)
    stage_all(merge_repo)
    git(merge_repo, "commit", "-q", "--allow-empty", "-m", "target")

    merge_result = git(
        merge_repo,
        "-c",
        "merge.renormalize=true",
        "merge",
        "--no-commit",
        "--no-ff",
        "local",
        check=False,
    )
    conflicts = [
        line
        for line in git(
            merge_repo, "diff", "--name-only", "--diff-filter=U", check=False
        ).stdout.splitlines()
        if line
    ]

    conflict_dir = output / "conflicts"
    conflict_dir.mkdir()
    details: list[dict[str, Any]] = []
    for rel in conflicts:
        merged = merge_repo / Path(*PurePosixPath(rel).parts)
        item = {"path": rel, "kind": "content"}
        if merged.is_file() and not is_binary_bytes(merged.read_bytes()):
            destination = conflict_dir / Path(*PurePosixPath(rel).parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(merged, destination)
        else:
            item["kind"] = "binary-or-file-level"
        details.append(item)

    (conflict_dir / "conflicts.json").write_text(
        json.dumps(details, indent=2) + "\n", encoding="utf-8"
    )

    candidate = output / "merged-candidate"
    candidate.mkdir()
    for child in merge_repo.iterdir():
        if child.name == ".git":
            continue
        destination = candidate / child.name
        if child.is_dir() and not child.is_symlink():
            shutil.copytree(child, destination, symlinks=True)
        elif child.is_symlink():
            os.symlink(os.readlink(child), destination)
        else:
            shutil.copy2(child, destination)

    # Candidate files at conflicted paths must remain the official target
    # version; conflict-marker copies live only under conflicts/.
    for rel in conflicts:
        candidate_path = candidate / Path(*PurePosixPath(rel).parts)
        target_path = target / Path(*PurePosixPath(rel).parts)
        if candidate_path.exists() or candidate_path.is_symlink():
            if candidate_path.is_dir() and not candidate_path.is_symlink():
                shutil.rmtree(candidate_path)
            else:
                candidate_path.unlink()
        if target_path.exists() or target_path.is_symlink():
            candidate_path.parent.mkdir(parents=True, exist_ok=True)
            if target_path.is_symlink():
                os.symlink(os.readlink(target_path), candidate_path)
            elif target_path.is_dir():
                shutil.copytree(target_path, candidate_path, symlinks=True)
            else:
                shutil.copy2(target_path, candidate_path)

    return {
        "local_changes": [{"status": status_code, "path": path} for status_code, path in changes],
        "conflicts": details,
        "merge_stderr": (merge_result.stderr or "").strip(),
    }


def pg_unescape(value: str) -> str | None:
    if value == r"\N":
        return None
    replacements = {"t": "\t", "n": "\n", "r": "\r", "b": "\b", "f": "\f"}
    result: list[str] = []
    index = 0
    while index < len(value):
        if value[index] != "\\" or index + 1 >= len(value):
            result.append(value[index])
            index += 1
            continue
        following = value[index + 1]
        result.append(replacements.get(following, following))
        index += 2
    return "".join(result)


def canonical_json(value: str | None) -> Any:
    if value is None:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value


def extract_mdms_records(dump: str) -> dict[str, dict[str, str]]:
    records: dict[str, dict[str, str]] = {}
    copy_re = re.compile(r"^COPY public\.(?P<table>[a-zA-Z0-9_]+) \((?P<columns>.*)\) FROM stdin;$")
    lines = iter(dump.splitlines())
    for line in lines:
        match = copy_re.match(line)
        if not match or match.group("table") not in MDMS_TABLES:
            continue
        table = match.group("table")
        columns = [column.strip().strip('"') for column in match.group("columns").split(",")]
        for row in lines:
            if row == r"\.":
                break
            values = [pg_unescape(value) for value in row.split("\t")]
            if len(values) != len(columns):
                raise DryRunError(f"cannot parse {table} row: expected {len(columns)} columns")
            item = dict(zip(columns, values))
            if table == "eg_mdms_data":
                key = "|".join(
                    str(item.get(name) or "")
                    for name in ("tenantid", "schemacode", "uniqueidentifier")
                )
                payload = {
                    "data": canonical_json(item.get("data")),
                    "isactive": item.get("isactive"),
                }
            else:
                key = "|".join(str(item.get(name) or "") for name in ("tenantid", "code"))
                payload = {
                    "description": item.get("description"),
                    "definition": canonical_json(item.get("definition")),
                    "isactive": item.get("isactive"),
                }
            canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
            records.setdefault(table, {})[key] = hashlib.sha256(canonical.encode()).hexdigest()
    missing = [table for table in MDMS_TABLES if table not in records]
    if missing:
        raise DryRunError(f"DB dump is missing MDMS COPY sections: {', '.join(missing)}")
    return records


def compare_mdms(current_dump: str, target_dump: str) -> dict[str, Any]:
    current = extract_mdms_records(current_dump)
    target = extract_mdms_records(target_dump)
    changes: list[dict[str, str]] = []
    for table in MDMS_TABLES:
        current_rows = current[table]
        target_rows = target[table]
        for key in sorted(current_rows.keys() | target_rows.keys()):
            if key not in current_rows:
                changes.append({"table": table, "key": key, "change": "added"})
            elif key not in target_rows:
                changes.append({"table": table, "key": key, "change": "removed"})
            elif current_rows[key] != target_rows[key]:
                changes.append({"table": table, "key": key, "change": "modified"})
    return {
        "changed": bool(changes),
        "changes": changes,
        "current_counts": {table: len(current[table]) for table in MDMS_TABLES},
        "target_counts": {table: len(target[table]) for table in MDMS_TABLES},
    }


def profile_for(commit: str, current_commit: str, target_commit: str) -> str:
    if commit == LEGACY_COMMIT:
        return "v2.12-beta"
    if commit == target_commit:
        return "master"
    if commit == current_commit:
        raise DryRunError(
            "current ref is not the supported v2.12-beta commit; add a renderer profile first"
        )
    raise DryRunError(f"unsupported renderer commit: {commit}")


def render_contract_files(playbook: Path) -> list[Path]:
    """Return the deploy playbook and every statically included task file."""
    pending = [playbook]
    result: list[Path] = []
    include_re = re.compile(
        r"(?:ansible\.builtin\.)?(?:include_tasks|import_tasks):\s*(?P<path>.+)$"
    )
    while pending:
        current = pending.pop()
        if current in result:
            continue
        if not current.is_file():
            raise DryRunError(f"included Ansible task file is missing: {current}")
        result.append(current)
        for line in current.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            match = include_re.search(stripped)
            if not match:
                continue
            raw = match.group("path").split("#", 1)[0].strip().strip("'\"")
            raw = raw.replace("{{ playbook_dir }}", str(playbook.parent))
            if "{{" in raw or "}}" in raw:
                raise DryRunError(
                    f"cannot validate dynamic Ansible task include: {raw}"
                )
            included = Path(raw)
            if not included.is_absolute():
                included = current.parent / included
            pending.append(included.resolve())
    return result


def validate_render_contract(exported: Path) -> None:
    """Fail when deployment logic references an unknown DIGIT destination."""
    playbook = exported / "local-setup" / "ansible" / "playbook-deploy.yml"
    if not playbook.is_file():
        raise DryRunError(f"deployment playbook is missing: {playbook}")
    unknown: set[str] = set()
    pattern = re.compile(r"\{\{\s*digit_dir\s*\}\}(?P<suffix>/[^\"'\s]*)?")
    for contract_file in render_contract_files(playbook):
        for line in contract_file.read_text(encoding="utf-8").splitlines():
            stripped = line.lstrip()
            if not stripped or stripped.startswith("#"):
                continue
            for match in pattern.finditer(line):
                suffix = match.group("suffix") or ""
                dynamic_config_destination = (
                    suffix == "/{{" and "{{ item.key }}" in line
                )
                if (
                    suffix
                    and suffix != "/"
                    and not dynamic_config_destination
                    and not suffix.startswith(RENDER_DESTINATION_PREFIXES)
                ):
                    relative = contract_file.relative_to(exported).as_posix()
                    unknown.add(f"{relative}: {suffix}")
    if unknown:
        raise DryRunError(
            "deployment playbook contains unsupported /opt/digit destinations: "
            + ", ".join(sorted(unknown))
        )


def render_ref(
    tool_repo: Path,
    exported: Path,
    destination: Path,
    tenant: str,
    tenant_vars: Path,
    profile: str,
) -> None:
    playbook = tool_repo / "local-setup" / "ansible" / "playbook-render.yml"
    extra_vars = destination.parent / f"render-{profile}-vars.json"
    extra_vars.write_text(
        json.dumps(
            {
                "source_root": str(exported),
                "render_dir": str(destination),
                "digit_dir": str(destination),
                "tenant_vars_file": str(tenant_vars),
                "render_profile": profile,
            }
        ),
        encoding="utf-8",
    )
    command = [
        "ansible-playbook",
        "-i",
        f"{tenant},",
        "--limit",
        tenant,
        "-c",
        "local",
        str(playbook),
        "-e",
        f"@{extra_vars}",
    ]
    result = run(command, cwd=tool_repo, check=False)
    if result.returncode:
        raise DryRunError(f"render failed for {profile}: {(result.stderr or result.stdout).strip()}")


def validate_tenant_yaml(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise DryRunError(f"tenant YAML not found: {path}")
    try:
        import yaml  # type: ignore
    except ImportError as exc:
        raise DryRunError("PyYAML is required (it is installed with Ansible)") from exc
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise DryRunError(f"invalid tenant YAML: {exc}") from exc
    if not isinstance(value, dict):
        raise DryRunError("tenant YAML must contain a mapping at its root")
    return value


def sensitive_values(value: Any, key: str = "") -> set[bytes]:
    """Collect non-trivial secret values so output can be checked for leaks."""
    found: set[bytes] = set()
    if isinstance(value, dict):
        for child_key, child_value in value.items():
            found.update(sensitive_values(child_value, str(child_key)))
    elif isinstance(value, list):
        for child_value in value:
            found.update(sensitive_values(child_value, key))
    elif is_secret_key(key) and isinstance(value, (str, int, float)):
        raw = str(value).encode("utf-8")
        if is_secret_candidate(raw):
            found.add(raw)
    return found


def is_secret_key(key: str) -> bool:
    normalized = key.lower().replace("-", "_")
    non_value_suffixes = (
        "_enabled",
        "_file",
        "_host",
        "_id",
        "_name",
        "_path",
        "_type",
        "_url",
    )
    return bool(SENSITIVE_KEY.search(normalized)) and not normalized.endswith(
        non_value_suffixes
    )


def is_secret_candidate(raw: bytes) -> bool:
    normalized = raw.strip().lower()
    return (
        len(normalized) >= 6
        and normalized not in {b"<redacted>", b"true", b"false", b"null", b"none"}
        and not normalized.startswith(b"${")
    )


def find_secret_leaks(root: Path, values: set[bytes]) -> list[str]:
    leaks: list[str] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        data = path.read_bytes()
        if any(secret in data for secret in values):
            leaks.append(path.relative_to(root).as_posix())
    return leaks


def write_report(output: Path, report: dict[str, Any]) -> None:
    (output / "report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    mdms = report["mdms"]
    secret_findings = report["secrets"]
    conflicts = report["merge"]["conflicts"]
    changes = report["merge"]["local_changes"]
    lines = [
        "# DIGIT upgrade dry-run report",
        "",
        f"**Status:** {report['status']}",
        "",
        f"- Current: `{report['current_ref']}` → `{report['current_commit']}`",
        f"- Target: `{report['target_ref']}` → `{report['target_commit']}`",
        f"- Local filesystem changes: **{len(changes)}**",
        f"- Configuration conflicts: **{len(conflicts)}**",
        f"- MDMS changes: **{len(mdms['changes'])}**",
        f"- Secret blockers: **{secret_findings['blocker_count']}**",
        f"- Secret warnings: **{secret_findings['warning_count']}**",
        "",
    ]
    if conflicts:
        lines.extend(["## Configuration conflicts", ""])
        lines.extend(f"- `{item['path']}` ({item['kind']})" for item in conflicts)
        lines.append("")
    if secret_findings["findings"]:
        lines.extend(["## Secret findings", ""])
        lines.extend(
            f"- `{item['path']}` `{item['field']}`: {item['change']} "
            f"({item['severity']})"
            for item in secret_findings["findings"]
        )
        lines.extend(
            [
                "",
                "Values and comparison fingerprints are intentionally omitted.",
                "",
            ]
        )
    if mdms["changes"]:
        added = sum(item["change"] == "added" for item in mdms["changes"])
        removed = sum(item["change"] == "removed" for item in mdms["changes"])
        modified = sum(item["change"] == "modified" for item in mdms["changes"])
        lines.extend(
            [
                "## MDMS blocker",
                "",
                f"The repository baselines contain {added} added, {removed} removed, "
                f"and {modified} modified MDMS identifiers.",
                "",
                "First 50 affected identifiers:",
                "",
            ]
        )
        lines.extend(
            f"- `{item['table']}` `{item['key']}`: {item['change']}"
            for item in mdms["changes"][:50]
        )
        if len(mdms["changes"]) > 50:
            lines.append(
                f"- ... {len(mdms['changes']) - 50} more; see `mdms-report.json`."
            )
        lines.append("")
    lines.extend(
        [
            "## Safety",
            "",
            "No deployment, Docker, OpenBao, or database command was executed.",
            "Secrets were redacted and `.openbao` was excluded.",
            "",
        ]
    )
    (output / "report.md").write_text("\n".join(lines), encoding="utf-8")


def create_output(parent: Path) -> Path:
    parent.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    candidate = parent / f"digit-dry-run-{stamp}"
    counter = 1
    while candidate.exists():
        candidate = parent / f"digit-dry-run-{stamp}-{counter}"
        counter += 1
    candidate.mkdir(mode=0o700)
    return candidate


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--current-ref", default="v2.12-beta")
    parser.add_argument("--target-ref", default="master")
    parser.add_argument("--tenant", required=True)
    parser.add_argument("--tenant-vars", required=True, type=Path)
    parser.add_argument("--backup", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        repo = args.repo.resolve()
        if not (repo / ".git").exists():
            raise DryRunError(f"not a Git checkout: {repo}")
        tenant_values = validate_tenant_yaml(args.tenant_vars)
        current_commit = resolve_ref(repo, args.current_ref)
        target_commit = resolve_ref(repo, args.target_ref)
        current_profile = profile_for(current_commit, current_commit, target_commit)
        target_profile = profile_for(target_commit, current_commit, target_commit)
        output = create_output(args.output.resolve())

        with tempfile.TemporaryDirectory(
            prefix=".digit-upgrade-dry-run-", dir=args.output.resolve()
        ) as temp_name:
            temp = Path(temp_name)
            current_source = temp / "current-source"
            target_source = temp / "target-source"
            export_ref(repo, current_commit, current_source)
            export_ref(repo, target_commit, target_source)
            validate_render_contract(current_source)
            validate_render_contract(target_source)

            rendered_current_raw = temp / "rendered-current-raw"
            rendered_target_raw = temp / "rendered-target-raw"
            render_ref(repo, current_source, rendered_current_raw, args.tenant, args.tenant_vars.resolve(), current_profile)
            render_ref(repo, target_source, rendered_target_raw, args.tenant, args.tenant_vars.resolve(), target_profile)

            backup_extract = temp / "backup-extract"
            backup_root = copy_backup(args.backup.resolve(), backup_extract)
            hmac_key = secrets.token_bytes(32)
            current_secret_state, current_secret_values = scan_tree_secrets(
                rendered_current_raw, hmac_key
            )
            backup_secret_state, backup_secret_values = scan_tree_secrets(
                backup_root, hmac_key
            )
            target_secret_state, target_secret_values = scan_tree_secrets(
                rendered_target_raw, hmac_key
            )
            secret_findings = compare_secret_states(
                current_secret_state, backup_secret_state, target_secret_state
            )
            (output / "secret-findings.json").write_text(
                json.dumps(secret_findings, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )

            secrets_to_check = sensitive_values(tenant_values)
            secrets_to_check.update(current_secret_values)
            secrets_to_check.update(backup_secret_values)
            secrets_to_check.update(target_secret_values)
            current_tree = temp / "A-current"
            backup_tree = temp / "B-backup"
            target_tree = temp / "C-target"
            current_meta = normalize_tree(
                rendered_current_raw, current_tree, secrets_to_check
            )
            backup_meta = normalize_tree(backup_root, backup_tree, secrets_to_check)
            target_meta = normalize_tree(rendered_target_raw, target_tree, secrets_to_check)

            (output / "metadata.json").write_text(
                json.dumps(
                    {"current": current_meta, "backup": backup_meta, "target": target_meta},
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
            merge = three_way_merge(current_tree, backup_tree, target_tree, temp, output)

            current_dump_bytes = git_bytes(repo, current_commit, "local-setup/db/full-dump.sql")
            target_dump_bytes = git_bytes(repo, target_commit, "local-setup/db/full-dump.sql")
            mdms = compare_mdms(current_dump_bytes.decode("utf-8"), target_dump_bytes.decode("utf-8"))
            (output / "mdms-report.json").write_text(
                json.dumps(mdms, indent=2, sort_keys=True) + "\n", encoding="utf-8"
            )

            blocked = bool(
                merge["conflicts"]
                or mdms["changed"]
                or secret_findings["blocked"]
            )
            manifest = {
                "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                "current_ref": args.current_ref,
                "current_commit": current_commit,
                "target_ref": args.target_ref,
                "target_commit": target_commit,
                "tenant": args.tenant,
                "tenant_vars_sha256": sha256_file(args.tenant_vars.resolve()),
                "backup_sha256": sha256_file(args.backup.resolve()) if args.backup.is_file() else hash_tree(args.backup.resolve()),
                "current_mdms_dump_sha256": hashlib.sha256(
                    current_dump_bytes
                ).hexdigest(),
                "target_mdms_dump_sha256": hashlib.sha256(
                    target_dump_bytes
                ).hexdigest(),
                "normalized_trees": {
                    "current": hash_tree(current_tree),
                    "backup": hash_tree(backup_tree),
                    "target": hash_tree(target_tree),
                },
                "excluded_patterns": list(EXCLUDED_PATTERNS),
                "deploy_ready": not blocked,
            }
            (output / "run-manifest.json").write_text(
                json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
            )
            report = {
                "status": "BLOCKED" if blocked else "READY",
                "current_ref": args.current_ref,
                "current_commit": current_commit,
                "target_ref": args.target_ref,
                "target_commit": target_commit,
                "merge": merge,
                "mdms": mdms,
                "secrets": secret_findings,
                "output": str(output),
            }
            write_report(output, report)

            leaks = find_secret_leaks(output, secrets_to_check)
            if leaks:
                # Fail closed and do not leave an unsafe partial artifact set.
                shutil.rmtree(output)
                raise DryRunError(
                    f"secret safety audit failed for {len(leaks)} output file(s); "
                    f"affected artifact paths: {', '.join(leaks)}; "
                    "the timestamped output was removed"
                )

        print(f"dry-run status: {report['status']}")
        print(f"report: {output / 'report.md'}")
        return 2 if blocked else 0
    except DryRunError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # defensive: operational CLI must fail closed
        print(f"ERROR: unexpected failure: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
