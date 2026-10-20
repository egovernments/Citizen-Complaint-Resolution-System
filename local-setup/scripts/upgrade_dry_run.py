#!/usr/bin/env python3
"""DIGIT upgrade analyser, conflict resolver, and guarded deploy entrypoint.

The analyser renders deterministic deployment trees for two Git references,
compares the base render with an /opt/digit backup, and applies the detected
local changes to the target render with a real Git rebase.  Analysis and
resume are read-only.  Deployment is available only through the separate,
explicit ``--deploy-run`` mode after every conflict has been resolved.
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


SOURCE_CODE_SUFFIXES = {
    ".go",
    ".java",
    ".js",
    ".php",
    ".py",
    ".rb",
    ".rs",
    ".ts",
    ".tsx",
}
EXCLUDED_PATTERNS = (
    ".git",
    ".git/**",
    ".build",
    ".build/**",
    ".openbao",
    ".openbao/**",
    "configurator",
    "configurator/**",
    "digit-mcp",
    "digit-mcp/**",
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
REDACTED = "<REDACTED>"
RENDER_DESTINATION_PREFIXES = (
    "/.build",
    "/.env",
    "/.openbao",
    "/bootstrap-novu-whatsapp.sh",
    "/ci-tests",
    "/configure-identity-keycloak.sh",
    "/configurator-runtime",
    "/core-sms-handoff.sh",
    "/dataloader",
    "/docker",
    "/docker-compose.",
    "/e2e-tests",
    "/identity",
    "/identity-keycloak-realm.json",
    "/keycloak",
    "/jupyter",
    "/kong",
    "/matomo-",
    "/nginx",
    "/notification-seed",
    "/novu-mint-key.sh",
    "/novu-worker-providers",
    "/opensre",
    "/repair-tenant-masters.py",
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
JSON_STRING = re.compile(r'"(?:\\.|[^"\\])*"')


class DryRunError(RuntimeError):
    """Expected validation or execution failure."""


class ResolutionPending(DryRunError):
    """The persistent workspace still needs an operator action."""


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


def excluded(relative: str, extra_patterns: Iterable[str] = ()) -> bool:
    path = PurePosixPath(relative)
    return any(
        path.match(pattern) for pattern in (*EXCLUDED_PATTERNS, *extra_patterns)
    )


def is_binary_bytes(data: bytes) -> bool:
    if b"\0" in data[:8192]:
        return True
    try:
        data.decode("utf-8")
        return False
    except UnicodeDecodeError:
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
    source: Path, hmac_key: bytes, extra_excludes: Iterable[str] = ()
) -> tuple[dict[str, dict[str, str | None]], set[bytes]]:
    """Fingerprint sensitive fields without returning or persisting their values."""
    state: dict[str, dict[str, str | None]] = {}
    values: set[bytes] = set()
    for path in sorted(source.rglob("*"), key=lambda item: item.as_posix()):
        rel = path.relative_to(source).as_posix()
        if (
            excluded(rel, extra_excludes)
            or any(
                excluded(parent.as_posix(), extra_excludes)
                for parent in PurePosixPath(rel).parents
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
                if not is_secret_key(key):
                    continue
                raw_value = match.group("value").strip()
                if path.suffix.lower() in SOURCE_CODE_SUFFIXES:
                    literal = re.fullmatch(r"(['\"])(.*)\1[,;]?", raw_value)
                    if literal is None:
                        continue
                    raw_value = literal.group(2)
                _record_secret_value(
                    state,
                    values,
                    rel,
                    f"line:{key}:{index}",
                    raw_value,
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
        if local == old or local == new:
            continue
        if old == new:
            findings.append(
                {
                    "path": path,
                    "field": field,
                    "change": "local-only",
                    "severity": "warning",
                }
            )
            continue
        findings.append(
            {
                "path": path,
                "field": field,
                "change": (
                    "unverifiable" if None in (old, local, new) else "conflict"
                ),
                "severity": "blocker",
            }
        )
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


def redact_text(
    text: str,
    exact_values: Iterable[bytes] = (),
    *,
    redact_assignments: bool = True,
) -> str:
    if redact_assignments:
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


def redact_json_text(text: str, exact_values: Iterable[bytes] = ()) -> str:
    """Redact valid JSON without replacing raw bytes outside string tokens."""
    json.loads(text)
    clean = JSON_SECRET.sub(lambda match: match.group(1) + '"<REDACTED>"', text)
    encoded_values: list[str] = []
    for raw in sorted(exact_values, key=len, reverse=True):
        try:
            value = raw.decode("utf-8")
        except UnicodeDecodeError:
            continue
        # Remove only the surrounding JSON quotes. The encoded content keeps
        # escapes intact, so replacing it cannot break the JSON token.
        encoded_values.append(json.dumps(value, ensure_ascii=False)[1:-1])

    def redact_string(match: re.Match[str]) -> str:
        token = match.group(0)
        body = token[1:-1]
        for value in encoded_values:
            if value:
                body = body.replace(value, REDACTED)
        return '"' + body + '"'

    clean = JSON_STRING.sub(redact_string, clean)
    json.loads(clean)
    return clean


def normalize_tree(
    source: Path,
    destination: Path,
    exact_secret_values: Iterable[bytes] = (),
    extra_excludes: Iterable[str] = (),
) -> dict[str, dict[str, Any]]:
    """Copy a tree while excluding noise, redacting secrets, and recording metadata."""
    metadata: dict[str, dict[str, Any]] = {}
    destination.mkdir(parents=True, exist_ok=True)
    for path in sorted(source.rglob("*"), key=lambda p: p.as_posix()):
        rel = path.relative_to(source).as_posix()
        if excluded(rel, extra_excludes) or any(
            excluded(parent.as_posix(), extra_excludes)
            for parent in PurePosixPath(rel).parents
        ):
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
                text = data.decode("utf-8")
                if path.suffix.lower() == ".json":
                    try:
                        clean = redact_json_text(text, exact_secret_values)
                    except json.JSONDecodeError:
                        clean = redact_text(text, exact_secret_values)
                else:
                    clean = redact_text(
                        text,
                        exact_secret_values,
                        redact_assignments=path.suffix.lower()
                        not in SOURCE_CODE_SUFFIXES,
                    )
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


def copy_candidate(repository: Path, candidate: Path) -> None:
    """Copy a rebased worktree without its Git metadata."""
    candidate.mkdir()
    for child in repository.iterdir():
        if child.name == ".git":
            continue
        destination = candidate / child.name
        if child.is_dir() and not child.is_symlink():
            shutil.copytree(child, destination, symlinks=True)
        elif child.is_symlink():
            os.symlink(os.readlink(child), destination)
        else:
            shutil.copy2(child, destination)


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


def rebase_local_changes(
    base: Path,
    local: Path,
    target: Path,
    workspace: Path,
    output: Path,
) -> dict[str, Any]:
    rebase_repo = workspace / "rebase-repo"
    rebase_repo.mkdir()
    git(rebase_repo, "init", "-q")
    replace_tree(base, rebase_repo)
    stage_all(rebase_repo)
    git(rebase_repo, "commit", "-q", "--allow-empty", "-m", "base")
    base_sha = git(rebase_repo, "rev-parse", "HEAD").stdout.strip()

    git(rebase_repo, "checkout", "-q", "-b", "local")
    replace_tree(local, rebase_repo)
    stage_all(rebase_repo)
    git(rebase_repo, "commit", "-q", "--allow-empty", "-m", "local changes")
    local_sha = git(rebase_repo, "rev-parse", "HEAD").stdout.strip()

    # Represent a rename as one deletion plus one addition.  The deployment
    # overlay can then apply both sides explicitly instead of leaving the old
    # path behind when a candidate is materialized onto /opt/digit.
    changes = parse_name_status(
        git(
            rebase_repo,
            "diff",
            "--name-status",
            "--no-renames",
            base_sha,
            local_sha,
        ).stdout
    )
    patch = git(rebase_repo, "diff", "--binary", base_sha, local_sha).stdout
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
        if status_code.startswith("A") or (
            source.is_file() and is_binary_bytes(source.read_bytes())
        ):
            destination = local_files / Path(*PurePosixPath(rel).parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            if source.is_symlink():
                os.symlink(os.readlink(source), destination)
            else:
                shutil.copy2(source, destination)

    git(rebase_repo, "checkout", "-q", "-b", "target", base_sha)
    replace_tree(target, rebase_repo)
    stage_all(rebase_repo)
    git(rebase_repo, "commit", "-q", "--allow-empty", "-m", "target")
    target_sha = git(rebase_repo, "rev-parse", "HEAD").stdout.strip()

    git(rebase_repo, "checkout", "-q", "local")
    rebase_result = git(
        rebase_repo,
        "-c",
        "merge.renormalize=true",
        "rebase",
        "--reapply-cherry-picks",
        "--empty=keep",
        "target",
        check=False,
    )
    conflicts = [
        line
        for line in git(
            rebase_repo, "diff", "--name-only", "--diff-filter=U", check=False
        ).stdout.splitlines()
        if line
    ]

    conflict_dir = output / "conflicts"
    conflict_dir.mkdir()
    details: list[dict[str, Any]] = []
    for rel in conflicts:
        merged = rebase_repo / Path(*PurePosixPath(rel).parts)
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

    rebased_sha: str | None = None
    deployment_changes: list[dict[str, str]] | None = None
    resolution_workspace: str | None = None
    if not conflicts and rebase_result.returncode == 0:
        rebased_sha = git(rebase_repo, "rev-parse", "HEAD").stdout.strip()
        deployment_changes = [
            {"status": status_code, "path": path}
            for status_code, path in parse_name_status(
                git(
                    rebase_repo,
                    "diff",
                    "--name-status",
                    "--no-renames",
                    target_sha,
                    rebased_sha,
                ).stdout
            )
        ]
        candidate = output / "candidate"
        copy_candidate(rebase_repo, candidate)
    elif conflicts:
        # Git may map a local path onto its renamed target path while applying
        # the commit. Record the paths Git actually populated in the index so
        # resume can allow those legitimate translations without allowing
        # arbitrary additional edits.
        allowed_resolution_paths = sorted(
            set(conflicts)
            | {
                line
                for line in git(
                    rebase_repo, "diff", "--cached", "--name-only", check=False
                ).stdout.splitlines()
                if line
            }
        )
        resolution_root = output / "resolution-workspace"
        resolution_root.mkdir(mode=0o700)
        resolution_repo = resolution_root / "repository"
        shutil.move(str(rebase_repo), resolution_repo)
        state = {
            "version": 2,
            "status": "conflicts",
            "conflicts": details,
            "allowed_resolution_paths": allowed_resolution_paths,
            "local_changes": [
                {"status": status_code, "path": path}
                for status_code, path in changes
            ],
            "base_commit": base_sha,
            "local_commit": local_sha,
            "target_commit": target_sha,
        }
        (resolution_root / "state.json").write_text(
            json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        (resolution_root / "README.md").write_text(
            "# DIGIT conflict resolution workspace\n\n"
            "This repository contains sanitized configuration only. Live "
            "`/opt/digit` was not modified.\n\n"
            "1. Run `git status` in `repository/`.\n"
            "2. Resolve every unmerged path.\n"
            "3. Stage each resolution with `git add` or `git rm`.\n"
            "4. Run the analyser with `--resume-workspace` pointing to this "
            "directory. Do not run `git rebase --continue` yourself.\n",
            encoding="utf-8",
        )
        resolution_workspace = str(resolution_root)
    elif not conflicts:
        raise DryRunError(
            "rebase failed without reporting conflicted paths: "
            + (rebase_result.stderr or rebase_result.stdout).strip()
        )

    return {
        "local_changes": [
            {"status": status_code, "path": path}
            for status_code, path in changes
        ],
        "conflicts": details,
        "base_commit": base_sha,
        "local_commit": local_sha,
        "target_commit": target_sha,
        "rebased_commit": rebased_sha,
        "deployment_changes": deployment_changes,
        "rebase_stderr": (rebase_result.stderr or "").strip(),
        "resolution_workspace": resolution_workspace,
    }


def read_json_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DryRunError(f"cannot read workspace metadata {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise DryRunError(f"workspace metadata is not an object: {path}")
    return value


def resume_resolution_workspace(
    workspace: Path,
    *,
    acknowledge_secret_review: bool = False,
) -> dict[str, Any]:
    """Validate operator resolutions, continue the rebase, and emit a candidate."""
    workspace = workspace.resolve()
    state_path = workspace / "state.json"
    repository = workspace / "repository"
    output = workspace.parent
    if not state_path.is_file() or not (repository / ".git").exists():
        raise DryRunError(
            f"not a DIGIT resolution workspace: {workspace}"
        )
    state = read_json_object(state_path)
    candidate = output / "candidate"
    if state.get("status") == "completed":
        if not candidate.is_dir():
            raise DryRunError("workspace says completed but candidate is missing")
        return {
            "candidate": str(candidate),
            "rebased_commit": state.get("rebased_commit"),
            "already_completed": True,
        }

    unresolved = [
        line
        for line in git(
            repository, "diff", "--name-only", "--diff-filter=U", check=False
        ).stdout.splitlines()
        if line
    ]
    if unresolved:
        raise ResolutionPending(
            "unresolved conflicts remain: " + ", ".join(unresolved)
        )

    status_lines = [
        line
        for line in git(repository, "status", "--porcelain=v1").stdout.splitlines()
        if line
    ]
    unstaged = [
        line[3:]
        for line in status_lines
        if line.startswith("??") or (len(line) > 1 and line[1] != " ")
    ]
    if unstaged:
        raise ResolutionPending(
            "resolved files must be staged with git add/git rm: "
            + ", ".join(unstaged)
        )

    original_conflicts = [item["path"] for item in state.get("conflicts", [])]
    marker_paths: list[str] = []
    for relative in original_conflicts:
        path = repository / Path(*PurePosixPath(relative).parts)
        if not path.is_file() or is_binary_bytes(path.read_bytes()):
            continue
        text_value = path.read_text(encoding="utf-8")
        if re.search(r"(?m)^(<<<<<<< |=======\s*$|>>>>>>> )", text_value):
            marker_paths.append(relative)
    if marker_paths:
        raise ResolutionPending(
            "conflict markers remain in: " + ", ".join(marker_paths)
        )

    allowed_paths = set(state.get("allowed_resolution_paths", []))
    if not allowed_paths:
        # Backward compatibility for workspaces created before target-side
        # rename translations were recorded explicitly.
        allowed_paths = {item["path"] for item in state.get("local_changes", [])}
    staged_paths = {
        line
        for line in git(repository, "diff", "--cached", "--name-only").stdout.splitlines()
        if line
    }
    unexpected = sorted(staged_paths - allowed_paths)
    if unexpected:
        raise ResolutionPending(
            "workspace contains changes outside the detected local-change set: "
            + ", ".join(unexpected)
        )

    report_path = output / "report.json"
    manifest_path = output / "run-manifest.json"
    report = read_json_object(report_path)
    manifest = read_json_object(manifest_path)
    blocker_count = int(report.get("secrets", {}).get("blocker_count", 0))
    if blocker_count and not acknowledge_secret_review:
        raise ResolutionPending(
            f"{blocker_count} secret finding(s) still require review; rerun with "
            "--acknowledge-secret-review only after confirming runtime secrets "
            "will be restored through the deployment secret mechanism"
        )

    _, unsafe_values = scan_tree_secrets(repository, secrets.token_bytes(32))
    if unsafe_values:
        raise ResolutionPending(
            f"resolution workspace contains {len(unsafe_values)} unredacted "
            "secret-like value(s); replace them with <REDACTED> before resuming"
        )

    rebase_active = git(
        repository, "rev-parse", "--verify", "REBASE_HEAD", check=False
    ).returncode == 0
    if rebase_active:
        rebase_head = git(
            repository, "rev-parse", "--verify", "REBASE_HEAD"
        ).stdout.strip()
        committed = git(
            repository,
            "commit",
            "-q",
            "-C",
            rebase_head,
            check=False,
        )
        if committed.returncode != 0:
            raise DryRunError(
                "could not commit staged conflict resolutions: "
                + (committed.stderr or committed.stdout).strip()
            )
        continued = git(
            repository,
            "rebase",
            "--continue",
            check=False,
        )
        if continued.returncode != 0:
            remaining = [
                line
                for line in git(
                    repository,
                    "diff",
                    "--name-only",
                    "--diff-filter=U",
                    check=False,
                ).stdout.splitlines()
                if line
            ]
            if remaining:
                raise ResolutionPending(
                    "rebase exposed additional conflicts: " + ", ".join(remaining)
                )
            raise DryRunError(
                "git rebase --continue failed: "
                + (continued.stderr or continued.stdout).strip()
            )
    elif status_lines:
        raise DryRunError(
            "workspace has staged changes but Git no longer has an active rebase"
        )

    final_status = git(repository, "status", "--porcelain=v1").stdout.strip()
    if final_status:
        raise DryRunError("rebased workspace is not clean after resume")
    rebased_commit = git(repository, "rev-parse", "HEAD").stdout.strip()
    if rebased_commit == state.get("target_commit"):
        raise DryRunError("resume did not create the rebased local-change commit")

    if candidate.exists():
        raise DryRunError(f"candidate already exists: {candidate}")
    copy_candidate(repository, candidate)

    original_details = report["rebase"].get("conflicts", [])
    report["status"] = "READY"
    report["rebase"]["original_conflicts"] = original_details
    report["rebase"]["conflicts"] = []
    report["rebase"]["rebased_commit"] = rebased_commit
    report["rebase"]["deployment_changes"] = [
        {"status": status_code, "path": path}
        for status_code, path in parse_name_status(
            git(
                repository,
                "diff",
                "--name-status",
                "--no-renames",
                state["target_commit"],
                rebased_commit,
            ).stdout
        )
    ]
    report["resolution"] = {
        "workspace": str(workspace),
        "resolved_conflicts": original_conflicts,
        "secret_review_acknowledged": bool(blocker_count),
    }
    manifest["candidate_created"] = True
    manifest["resolution_workspace"] = str(workspace)
    manifest["resolved_conflicts"] = original_conflicts
    manifest["secret_review_acknowledged"] = bool(blocker_count)
    manifest["deployment_performed"] = False
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    write_report(output, report)

    state["status"] = "completed"
    state["rebased_commit"] = rebased_commit
    state["completed_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    state_path.write_text(
        json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return {
        "candidate": str(candidate),
        "rebased_commit": rebased_commit,
        "already_completed": False,
    }


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
                dynamic_config_destination = suffix == "/{{" and (
                    "{{ item.key }}" in line
                    or 'path: "{{ digit_dir }}/{{ item }}"' in line
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
        details = "\n".join(
            part.strip() for part in (result.stdout, result.stderr) if part and part.strip()
        )
        raise DryRunError(f"render failed for {profile}: {details}")


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


def parse_base_overrides(raw_overrides: Iterable[str]) -> dict[str, Any]:
    try:
        import yaml  # type: ignore
    except ImportError as exc:
        raise DryRunError("PyYAML is required (it is installed with Ansible)") from exc
    result: dict[str, Any] = {}
    for raw in raw_overrides:
        key, separator, raw_value = raw.partition("=")
        if not separator or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise DryRunError(
                f"invalid --base-override {raw!r}; expected TOP_LEVEL_KEY=YAML_VALUE"
            )
        if key in result:
            raise DryRunError(f"duplicate --base-override key: {key}")
        try:
            result[key] = yaml.safe_load(raw_value)
        except Exception as exc:
            raise DryRunError(f"invalid YAML value in --base-override {raw!r}: {exc}") from exc
    return result


def write_base_tenant_yaml(
    source: Path, destination: Path, overrides: dict[str, Any]
) -> dict[str, Any]:
    values = validate_tenant_yaml(source)
    rendered = dict(values)
    rendered.update(overrides)
    try:
        import yaml  # type: ignore
    except ImportError as exc:
        raise DryRunError("PyYAML is required (it is installed with Ansible)") from exc
    destination.write_text(
        yaml.safe_dump(rendered, sort_keys=False), encoding="utf-8"
    )
    os.chmod(destination, 0o600)
    return rendered


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


def redact_sensitive_structure(value: Any, key: str = "") -> Any:
    if is_secret_key(key) and not isinstance(value, (dict, list)):
        return "<REDACTED>"
    if isinstance(value, dict):
        return {
            child_key: redact_sensitive_structure(child_value, str(child_key))
            for child_key, child_value in value.items()
        }
    if isinstance(value, list):
        return [redact_sensitive_structure(child, key) for child in value]
    return value


def find_secret_leaks(root: Path, values: set[bytes]) -> list[str]:
    leaks: list[str] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        data = path.read_bytes()
        if any(secret in data for secret in values):
            leaks.append(path.relative_to(root).as_posix())
    return leaks


def describe_secret_leak_origins(
    root: Path,
    leaks: list[str],
    values: set[bytes],
    hmac_key: bytes,
    states: dict[str, dict[str, dict[str, str | None]]],
) -> list[str]:
    """Describe a leak using safe field locations, never values or digests."""
    origins: dict[str, list[str]] = {}
    for tree_name, tree in states.items():
        for source_path, fields in tree.items():
            for field, digest in fields.items():
                if digest is not None:
                    origins.setdefault(digest, []).append(
                        f"{tree_name}:{source_path}:{field}"
                    )
    details: list[str] = []
    for relative in leaks:
        data = (root / Path(*PurePosixPath(relative).parts)).read_bytes()
        matched: set[str] = set()
        for value in values:
            if value not in data:
                continue
            digest = secret_digest(hmac_key, value)
            matched.update(origins.get(digest, ["tenant-input:unknown-field"]))
        details.append(f"{relative} <- {', '.join(sorted(matched))}")
    return details


def write_report(output: Path, report: dict[str, Any]) -> None:
    (output / "report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    secret_findings = report["secrets"]
    conflicts = report["rebase"]["conflicts"]
    changes = report["rebase"]["local_changes"]
    lines = [
        "# DIGIT upgrade dry-run report",
        "",
        f"**Status:** {report['status']}",
        "",
        f"- Base: `{report['base_ref']}` → `{report['base_commit']}`",
        f"- Target: `{report['target_ref']}` → `{report['target_commit']}`",
        f"- Local filesystem changes: **{len(changes)}**",
        f"- Rebase conflicts: **{len(conflicts)}**",
        f"- Secret blockers: **{secret_findings['blocker_count']}**",
        f"- Secret warnings: **{secret_findings['warning_count']}**",
        "",
    ]
    if conflicts:
        lines.extend(["## Configuration conflicts", ""])
        lines.extend(f"- `{item['path']}` ({item['kind']})" for item in conflicts)
        lines.append("")
    if report.get("resolution"):
        resolution = report["resolution"]
        lines.extend(
            [
                "## Resolution",
                "",
                f"- Workspace: `{resolution['workspace']}`",
                "- Resolved conflicts: "
                f"**{len(resolution['resolved_conflicts'])}**",
                "- Secret review acknowledged: "
                f"**{resolution['secret_review_acknowledged']}**",
                "",
            ]
        )
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
    parser.add_argument("--repo", type=Path)
    parser.add_argument("--base-ref", default="v2.12-beta")
    parser.add_argument("--target-ref", default="master")
    parser.add_argument("--tenant")
    parser.add_argument("--tenant-vars", type=Path)
    parser.add_argument("--backup", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--resume-workspace",
        type=Path,
        help="resume a previously created persistent conflict workspace",
    )
    parser.add_argument(
        "--deploy-run",
        type=Path,
        help="explicitly deploy a completed run directory on the Linux deployment server",
    )
    parser.add_argument(
        "--backup-dir",
        type=Path,
        default=Path("/var/backups/digit-upgrade"),
        help="root-owned destination for database, /opt/digit, and volume backups",
    )
    parser.add_argument(
        "--mdms-resolution",
        type=Path,
        help="JSON choices for conflicts emitted by a previous deploy preflight",
    )
    parser.add_argument(
        "--confirm-deploy",
        action="store_true",
        help="required acknowledgement that deployment enters a maintenance window",
    )
    parser.add_argument(
        "--acknowledge-secret-review",
        action="store_true",
        help="confirm reviewed secret findings remain redacted and will be restored securely",
    )
    parser.add_argument(
        "--base-override",
        action="append",
        default=[],
        metavar="KEY=YAML_VALUE",
        help="top-level tenant variable override used only while rendering the base",
    )
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        metavar="GLOB",
        help="additional PurePath.match glob excluded from all compared trees",
    )
    args = parser.parse_args(argv)
    if args.resume_workspace and args.deploy_run:
        parser.error("--resume-workspace and --deploy-run are mutually exclusive")
    if args.resume_workspace:
        if args.confirm_deploy or args.mdms_resolution:
            parser.error("deployment options are invalid with --resume-workspace")
        return args
    if args.deploy_run:
        missing = [
            option
            for option, value in (
                ("--repo", args.repo),
                ("--tenant", args.tenant),
                ("--tenant-vars", args.tenant_vars),
                ("--backup", args.backup),
            )
            if value is None
        ]
        if missing:
            parser.error("the following deploy arguments are required: " + ", ".join(missing))
        if not args.confirm_deploy:
            parser.error("--deploy-run requires --confirm-deploy")
        if args.base_override or args.exclude:
            parser.error("analysis-only options cannot be used with --deploy-run")
        return args
    missing = [
        option
        for option, value in (
            ("--repo", args.repo),
            ("--tenant", args.tenant),
            ("--tenant-vars", args.tenant_vars),
            ("--backup", args.backup),
            ("--output", args.output),
        )
        if value is None
    ]
    if missing:
        parser.error("the following arguments are required: " + ", ".join(missing))
    if args.acknowledge_secret_review:
        parser.error("--acknowledge-secret-review is valid only with --resume-workspace")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.resume_workspace:
            result = resume_resolution_workspace(
                args.resume_workspace,
                acknowledge_secret_review=args.acknowledge_secret_review,
            )
            print("resolution status: READY")
            print(f"candidate: {result['candidate']}")
            return 0
        if args.deploy_run:
            from upgrade_deploy import MdmsConflict, deploy_run

            try:
                result = deploy_run(
                    args.deploy_run,
                    args.repo,
                    args.tenant,
                    args.tenant_vars,
                    args.backup,
                    args.backup_dir,
                    args.mdms_resolution,
                )
            except MdmsConflict as exc:
                print(f"ERROR: {exc}", file=sys.stderr)
                return 2
            print("deployment status: DEPLOYED")
            print(f"backup: {result['backup']}")
            print(f"report: {args.deploy_run.resolve() / 'deployment-report.json'}")
            return 0
        repo = args.repo.resolve()
        if not (repo / ".git").exists():
            raise DryRunError(f"not a Git checkout: {repo}")
        tenant_vars = args.tenant_vars.resolve()
        tenant_values = validate_tenant_yaml(tenant_vars)
        base_overrides = parse_base_overrides(args.base_override)
        base_commit = resolve_ref(repo, args.base_ref)
        target_commit = resolve_ref(repo, args.target_ref)
        extra_excludes = tuple(args.exclude)
        output = create_output(args.output.resolve())

        with tempfile.TemporaryDirectory(
            prefix=".digit-upgrade-dry-run-", dir=args.output.resolve()
        ) as temp_name:
            temp = Path(temp_name)
            base_source = temp / "base-source"
            target_source = temp / "target-source"
            export_ref(repo, base_commit, base_source)
            export_ref(repo, target_commit, target_source)
            validate_render_contract(base_source)
            validate_render_contract(target_source)

            base_tenant_vars = temp / "base-tenant-vars.yml"
            base_tenant_values = write_base_tenant_yaml(
                tenant_vars, base_tenant_vars, base_overrides
            )
            rendered_base_raw = temp / "rendered-base-raw"
            rendered_target_raw = temp / "rendered-target-raw"
            render_ref(
                repo,
                base_source,
                rendered_base_raw,
                args.tenant,
                base_tenant_vars,
                "base",
            )
            render_ref(
                repo,
                target_source,
                rendered_target_raw,
                args.tenant,
                tenant_vars,
                "target",
            )

            backup_extract = temp / "backup-extract"
            backup_root = copy_backup(args.backup.resolve(), backup_extract)
            hmac_key = secrets.token_bytes(32)
            base_secret_state, base_secret_values = scan_tree_secrets(
                rendered_base_raw, hmac_key, extra_excludes
            )
            backup_secret_state, backup_secret_values = scan_tree_secrets(
                backup_root, hmac_key, extra_excludes
            )
            target_secret_state, target_secret_values = scan_tree_secrets(
                rendered_target_raw, hmac_key, extra_excludes
            )
            secret_findings = compare_secret_states(
                base_secret_state, backup_secret_state, target_secret_state
            )
            (output / "secret-findings.json").write_text(
                json.dumps(secret_findings, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )

            secrets_to_check = sensitive_values(tenant_values)
            secrets_to_check.update(sensitive_values(base_tenant_values))
            secrets_to_check.update(base_secret_values)
            secrets_to_check.update(backup_secret_values)
            secrets_to_check.update(target_secret_values)
            base_tree = temp / "A-base"
            backup_tree = temp / "B-backup"
            target_tree = temp / "C-target"
            base_meta = normalize_tree(
                rendered_base_raw,
                base_tree,
                secrets_to_check,
                extra_excludes,
            )
            backup_meta = normalize_tree(
                backup_root,
                backup_tree,
                secrets_to_check,
                extra_excludes,
            )
            target_meta = normalize_tree(
                rendered_target_raw,
                target_tree,
                secrets_to_check,
                extra_excludes,
            )

            (output / "metadata.json").write_text(
                json.dumps(
                    {"base": base_meta, "backup": backup_meta, "target": target_meta},
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
            rebase = rebase_local_changes(
                base_tree, backup_tree, target_tree, temp, output
            )

            blocked = bool(
                rebase["conflicts"] or secret_findings["blocked"]
            )
            candidate = output / "candidate"
            if blocked and candidate.exists():
                shutil.rmtree(candidate)
            manifest = {
                "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                "base_ref": args.base_ref,
                "base_commit": base_commit,
                "base_overrides": redact_sensitive_structure(base_overrides),
                "target_ref": args.target_ref,
                "target_commit": target_commit,
                "tenant": args.tenant,
                "tenant_vars_sha256": sha256_file(tenant_vars),
                "backup_sha256": (
                    sha256_file(args.backup.resolve())
                    if args.backup.is_file()
                    else hash_tree(args.backup.resolve())
                ),
                "normalized_trees": {
                    "base": hash_tree(base_tree),
                    "backup": hash_tree(backup_tree),
                    "target": hash_tree(target_tree),
                },
                "excluded_patterns": [*EXCLUDED_PATTERNS, *extra_excludes],
                "candidate_created": not blocked,
                "deployment_performed": False,
                "resolution_workspace": rebase["resolution_workspace"],
            }
            (output / "run-manifest.json").write_text(
                json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
            )
            report = {
                "status": "BLOCKED" if blocked else "READY",
                "base_ref": args.base_ref,
                "base_commit": base_commit,
                "target_ref": args.target_ref,
                "target_commit": target_commit,
                "rebase": rebase,
                "secrets": secret_findings,
                "output": str(output),
            }
            write_report(output, report)

            leaks = find_secret_leaks(output, secrets_to_check)
            if leaks:
                leak_details = describe_secret_leak_origins(
                    output,
                    leaks,
                    secrets_to_check,
                    hmac_key,
                    {
                        "base": base_secret_state,
                        "backup": backup_secret_state,
                        "target": target_secret_state,
                    },
                )
                # Fail closed and do not leave an unsafe partial artifact set.
                shutil.rmtree(output)
                raise DryRunError(
                    f"secret safety audit failed for {len(leaks)} output file(s); "
                    f"safe origins: {'; '.join(leak_details)}; "
                    "the timestamped output was removed"
                )

        print(f"dry-run status: {report['status']}")
        print(f"report: {output / 'report.md'}")
        if blocked:
            if rebase["resolution_workspace"]:
                print(
                    "resolution workspace: "
                    f"{rebase['resolution_workspace']}"
                )
                print(
                    "resume after resolving and staging every conflict: "
                    "python3 local-setup/scripts/upgrade_dry_run.py "
                    f"--resume-workspace {rebase['resolution_workspace']}"
                )
            conflict_paths = [item["path"] for item in rebase["conflicts"]]
            if conflict_paths:
                print(
                    "ERROR: local changes conflict with target in "
                    f"{len(conflict_paths)} file(s): {', '.join(conflict_paths)}",
                    file=sys.stderr,
                )
            if secret_findings["blocker_count"]:
                print(
                    "ERROR: local secret changes require manual review; see "
                    f"{output / 'secret-findings.json'}",
                    file=sys.stderr,
                )
        return 2 if blocked else 0
    except ResolutionPending as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    except DryRunError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # defensive: operational CLI must fail closed
        print(f"ERROR: unexpected failure: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
