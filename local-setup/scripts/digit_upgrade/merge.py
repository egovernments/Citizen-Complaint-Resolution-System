"""Three-way merge of the operator's local changes onto the target render.

A Git repository holds the normalized trees as three commits: ``base``, and
on top of it ``live`` and ``target`` (branches of those names).  Merging
target into a copy of live (branch ``merged``) applies exactly the operator's
local changes to the new version.  Conflicts stop in a persistent workspace the operator resolves
with ordinary Git, using diff3 markers that also show the base version.
"""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from .common import NeedsOperator, UpgradeError, is_binary, run
from .redaction import REDACTED, is_secret_value, secret_fields

IDENTITY = ["-c", "user.name=DIGIT upgrade", "-c", "user.email=digit-upgrade@invalid", "-c", "core.hooksPath=/dev/null"]
# The operator's own Git configuration (excludes files, attributes, hooks) must
# not change what the workspace records.
ISOLATED = {"GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1"}
MARKER_LINES = ("<<<<<<< ", "||||||| ", "=======", ">>>>>>> ")


def git(repo: Path, *args: str, check: bool = True):
    return run(["git", *IDENTITY, "-c", "core.autocrlf=false", *args], cwd=repo, check=check,
               env={**os.environ, **ISOLATED})


def lines(output: str) -> list[str]:
    return [line for line in output.splitlines() if line]


@dataclass
class MergeResult:
    local_changes: list[dict[str, str]]
    conflicts: list[str]
    deployment_changes: list[dict[str, str]] | None = None
    stage0: dict[str, str] = field(default_factory=dict)


def name_status(repo: Path, old: str, new: str) -> list[dict[str, str]]:
    """Changes old → new; a rename is a deletion plus an addition."""
    changes = []
    for line in lines(git(repo, "diff", "--name-status", "--no-renames", old, new).stdout):
        status, _, path = line.partition("\t")
        changes.append({"status": status[0], "path": path})
    return changes


def _commit_tree(repo: Path, tree: Path, message: str) -> None:
    for child in repo.iterdir():
        if child.name != ".git":
            shutil.rmtree(child) if child.is_dir() and not child.is_symlink() else child.unlink()
    shutil.copytree(tree, repo, dirs_exist_ok=True, symlinks=True)
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "--allow-empty", "-m", message)


def merge(normalized: dict[str, Path], repo: Path) -> MergeResult:
    """Merge local changes (base→live) with the target (base→target) in repo."""
    repo.mkdir(mode=0o700)
    git(repo, "init", "-q", "-b", "base")
    git(repo, "config", "merge.conflictStyle", "diff3")
    _commit_tree(repo, normalized["base"], "base: deployed version, rendered")
    git(repo, "checkout", "-q", "-b", "target")
    _commit_tree(repo, normalized["target"], "target: new version, rendered")
    git(repo, "checkout", "-q", "-b", "live", "base")
    _commit_tree(repo, normalized["live"], "live: /opt/digit as backed up")
    # The merge gets its own branch so `live` keeps naming the analysed backup.
    git(repo, "checkout", "-q", "-b", "merged")

    local = name_status(repo, "base", "live")
    merged = git(repo, "merge", "--no-ff", "-m", "local changes on the target version", "target", check=False)
    conflicts = lines(git(repo, "diff", "--name-only", "--diff-filter=U").stdout)
    if merged.returncode and not conflicts:
        raise UpgradeError(f"git merge failed without conflicts: {(merged.stderr or merged.stdout).strip()}")
    if conflicts:
        return MergeResult(local_changes=local, conflicts=conflicts, stage0=_stage0(repo))
    return MergeResult(local_changes=local, conflicts=[], deployment_changes=name_status(repo, "target", "HEAD"))


def _stage0(repo: Path) -> dict[str, str]:
    """{path: "mode blob"} for every path the merge resolved on its own."""
    result = {}
    for line in lines(git(repo, "ls-files", "-s").stdout):
        meta, _, path = line.partition("\t")
        mode, blob, stage = meta.split()
        if stage == "0":
            result[path] = f"{mode} {blob}"
    return result


def conclude(repo: Path, conflicts: list[str], stage0: dict[str, str]) -> list[dict[str, str]]:
    """Validate the operator's resolution and commit the merge.

    Raises NeedsOperator, with what is left to do, until every conflicted path
    is resolved and staged, no other path was touched, and no resolved file
    holds a conflict marker or a typed-in secret.
    """
    unresolved = lines(git(repo, "diff", "--name-only", "--diff-filter=U").stdout)
    if unresolved:
        raise NeedsOperator("unresolved conflicts remain: " + ", ".join(unresolved))
    unstaged = lines(git(repo, "diff", "--name-only").stdout) + lines(
        git(repo, "ls-files", "--others", "--exclude-standard").stdout
    )
    if unstaged:
        raise NeedsOperator("stage every resolution with git add / git rm: " + ", ".join(sorted(set(unstaged))))

    now = _stage0(repo)
    touched = sorted(
        path for path in set(now) | set(stage0)
        if path not in conflicts and now.get(path) != stage0.get(path)
    )
    if touched:
        raise NeedsOperator(
            "only conflicted files may be changed while resolving; also changed: " + ", ".join(touched)
        )

    problems = []
    for path in conflicts:
        file = repo / path
        if not file.is_file() or file.is_symlink():
            continue
        data = file.read_bytes()
        if is_binary(data):
            continue
        text = data.decode("utf-8")
        if any(line.startswith(MARKER_LINES) for line in text.splitlines()):
            problems.append(f"{path}: conflict marker")
        typed = [
            name for name, value in secret_fields(text, file.suffix.lower()).items()
            if value != REDACTED and is_secret_value(value)
        ]
        if typed:
            problems.append(f"{path}: secret value typed in ({', '.join(typed)}); use {REDACTED}")
    if problems:
        raise NeedsOperator("resolved files need attention: " + "; ".join(problems))

    if git(repo, "rev-parse", "-q", "--verify", "MERGE_HEAD", check=False).returncode:
        raise UpgradeError("the workspace is no longer in the middle of the merge; was it committed by hand?")
    git(repo, "commit", "-q", "--no-edit")
    return name_status(repo, "target", "HEAD")


def export_worktree(repo: Path, destination: Path) -> None:
    """Copy the committed tree, without .git, to destination."""
    shutil.copytree(repo, destination, symlinks=True, ignore=shutil.ignore_patterns(".git"))
