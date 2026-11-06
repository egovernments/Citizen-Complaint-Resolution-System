"""Primitives shared by analysis, resume and deployment."""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path, PurePosixPath
from typing import Any, Iterable

from .redaction import REDACTED, is_secret_key

SHA = re.compile(r"[0-9a-f]{40}")


class UpgradeError(RuntimeError):
    """Invalid input or a failed step.  Exit 1."""


class NeedsOperator(UpgradeError):
    """The run stopped on purpose until an operator decides something.  Exit 2."""


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def stamp() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d-%H%M%S")


def run(
    args: list[str],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    check: bool = True,
    secrets: Iterable[str] = (),
) -> subprocess.CompletedProcess[str]:
    """Run a command with captured text output.

    On failure the error carries stdout and stderr, with every value in
    ``secrets`` (and every ``KEY=value`` argument whose key looks secret)
    replaced, so diagnostics never print a password.
    """
    try:
        result = subprocess.run(
            args, cwd=cwd, env=env, text=True, capture_output=True, check=False
        )
    except FileNotFoundError as exc:
        raise UpgradeError(f"required command not found: {args[0]}") from exc
    if check and result.returncode:
        detail = "\n".join(part.strip() for part in (result.stdout, result.stderr) if part and part.strip())
        raise UpgradeError(f"command failed ({describe(args, secrets)}): {scrub(detail, args, secrets)}")
    return result


def run_streaming(
    args: list[str],
    *,
    stdout: Path | None = None,
    stdin: Path | None = None,
    cwd: Path | None = None,
    secrets: Iterable[str] = (),
) -> None:
    """Run a command whose stdout goes to, or stdin comes from, a file (binary)."""
    out = stdout.open("wb") if stdout else subprocess.DEVNULL
    inp = stdin.open("rb") if stdin else subprocess.DEVNULL
    try:
        result = subprocess.run(args, cwd=cwd, stdin=inp, stdout=out, stderr=subprocess.PIPE, check=False)
    except FileNotFoundError as exc:
        raise UpgradeError(f"required command not found: {args[0]}") from exc
    finally:
        for stream in (out, inp):
            if stream is not subprocess.DEVNULL:
                stream.close()
    if result.returncode:
        detail = result.stderr.decode(errors="replace").strip()
        raise UpgradeError(f"command failed ({describe(args, secrets)}): {scrub(detail, args, secrets)}")


def describe(args: Iterable[str], secrets: Iterable[str] = ()) -> str:
    rendered = []
    for arg in args:
        key, separator, _ = arg.partition("=")
        rendered.append(f"{key}={REDACTED}" if separator and is_secret_key(key) else arg)
    return scrub(" ".join(rendered), (), secrets)


def scrub(text: str, args: Iterable[str] = (), secrets: Iterable[str] = ()) -> str:
    values = [value for value in secrets if value]
    for arg in args:
        key, separator, value = arg.partition("=")
        if separator and value and is_secret_key(key):
            values.append(value)
    for value in sorted(values, key=len, reverse=True):
        text = text.replace(value, REDACTED)
    return text


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def hash_tree(root: Path) -> str:
    """One digest over every file and symlink below root, by relative path."""
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*"), key=lambda p: p.as_posix()):
        rel = path.relative_to(root).as_posix()
        if path.is_symlink():
            digest.update(f"L\0{rel}\0{os.readlink(path)}\n".encode())
        elif path.is_file():
            digest.update(f"F\0{rel}\0".encode())
            digest.update(bytes.fromhex(sha256_file(path)))
    return digest.hexdigest()


def safe_relative(raw: str) -> Path:
    """A relative path from metadata, refused if it could escape its root."""
    posix = PurePosixPath(raw)
    if not raw or posix.is_absolute() or ".." in posix.parts or posix.as_posix() != raw:
        raise UpgradeError(f"unsafe relative path in upgrade metadata: {raw!r}")
    return Path(*posix.parts)


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def read_json(path: Path, kind: type = dict) -> Any:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise UpgradeError(f"cannot read {path}: {exc}") from exc
    if not isinstance(value, kind):
        raise UpgradeError(f"{path} does not contain a JSON {kind.__name__}")
    return value


def write_json(path: Path, value: Any, mode: int = 0o600) -> None:
    """Write JSON atomically (temp file + rename) with restrictive permissions."""
    temporary = path.with_name(f".{path.name}.tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, sort_keys=True)
        stream.write("\n")
    os.replace(temporary, path)


def is_binary(data: bytes) -> bool:
    if b"\0" in data[:8192]:
        return True
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        return True
    return False
