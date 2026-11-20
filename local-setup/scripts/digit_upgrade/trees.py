"""The three trees of an upgrade, restricted to the analysed configuration.

``base`` (the deployed version's render), ``live`` (the operator's /opt/digit,
or the backup of it) and ``target`` (the new version's render).  Analysis and
deployment both build them with ``prepare``, so a deployment can prove it is
installing exactly what was analysed: same inputs, same normalized hashes.
"""

from __future__ import annotations

import os
import secrets as stdlib_secrets
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import deploy_state

from .common import hash_tree, is_binary
from .redaction import Redactor, compare_secret_fields, fingerprint_fields, secret_fields, secret_values

TREES = ("base", "live", "target")


def analysed_paths(root: Path, excludes: Iterable[str] = ()) -> dict[str, Path]:
    """{relative path: path} for every analysed file or symlink below root."""
    return {
        rel: root / rel
        for rel in deploy_state.analysed_files(str(root), tuple(excludes))
    }


@dataclass
class Prepared:
    raw: dict[str, Path]
    normalized: dict[str, Path]
    hashes: dict[str, str]
    secrets: dict[str, Any]
    redactor: Redactor


def prepare(
    raw: dict[str, Path],
    destination: Path,
    *,
    known_secrets: Iterable[str],
    excludes: Iterable[str] = (),
) -> Prepared:
    """Normalize base/live/target into destination/<name> and compare their secrets.

    known_secrets are values that must never appear in output even outside a
    secret-named field (the tenant's host_vars secrets).  Every secret field
    value found in any of the three trees is added to them.
    """
    excludes = tuple(excludes)
    paths = {name: analysed_paths(raw[name], excludes) for name in TREES}
    texts = {name: _texts(files) for name, files in paths.items()}

    values = set(known_secrets)
    for tree in texts.values():
        for text, suffix in tree.values():
            values |= secret_values(secret_fields(text, suffix).values())
    redactor = Redactor(values)

    key = stdlib_secrets.token_bytes(32)
    fingerprints = {name: fingerprint_fields(texts[name], key) for name in TREES}
    findings = compare_secret_fields(fingerprints["base"], fingerprints["live"], fingerprints["target"])
    del key

    normalized = {}
    for name in TREES:
        normalized[name] = destination / name
        _normalize(paths[name], normalized[name], redactor)
    return Prepared(
        raw=raw,
        normalized=normalized,
        hashes={name: hash_tree(path) for name, path in normalized.items()},
        secrets=findings,
        redactor=redactor,
    )


def _texts(files: dict[str, Path]) -> dict[str, tuple[str, str]]:
    result = {}
    for rel, path in files.items():
        if path.is_symlink() or not path.is_file():
            continue
        data = path.read_bytes()
        if not is_binary(data):
            result[rel] = (data.decode("utf-8"), path.suffix.lower())
    return result


def _normalize(files: dict[str, Path], destination: Path, redactor: Redactor) -> None:
    destination.mkdir(parents=True)
    for rel, source in sorted(files.items()):
        target = destination / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        if source.is_symlink():
            os.symlink(os.readlink(source), target)
            continue
        data = source.read_bytes()
        if is_binary(data):
            shutil.copyfile(source, target)
        else:
            target.write_text(redactor.redact(data.decode("utf-8"), source.suffix.lower()), encoding="utf-8", newline="")
        # Git tracks only the executable bit; normalizing the rest keeps trees comparable.
        os.chmod(target, 0o755 if os.stat(source).st_mode & 0o111 else 0o644)


def leaks(root: Path, values: Iterable[str]) -> list[str]:
    """Files below root that contain any of the values (the output safety audit)."""
    needles = {v.encode() for v in values if v}
    # A multi-line value (a key in a YAML block) appears indented, line by line.
    needles |= {line.strip().encode() for v in values for line in v.splitlines() if len(line.strip()) >= 8}
    found = []
    for path in sorted(root.rglob("*")):
        if path.is_file() and not path.is_symlink():
            data = path.read_bytes()
            if any(needle in data for needle in needles):
                found.append(path.relative_to(root).as_posix())
    return found
