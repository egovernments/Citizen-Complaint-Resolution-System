#!/usr/bin/env python3
"""Deployment state for a DIGIT directory: hand-edit detection and local overrides.

playbook-deploy.yml runs this on the deployment target, as root, through
``ansible.builtin.script`` (which copies only this file: standard library only,
no sibling imports).  State lives in ``<digit_dir>/.digit-deploy-state/``.

Commands, in deploy order:

``check DIR``
    Before anything is written.  Exit 3 when an analysed file differs from what
    the last successful deploy left (a hand edit since then).
``begin DIR``
    Marks the recorded state as belonging to an in-progress deploy, so a deploy
    that dies half-way is reported as such rather than as hand edits.  With
    local overrides stored, also snapshots the analysed files and .env, so a
    conflicting re-apply can put the box back exactly as it was.
``adopt DIR INCOMING DELETED_JSON``
    Guarded upgrade only, right after the render.  Makes the operator's resolved
    local changes the box's local overrides: remembers what the render wrote for
    each path, stores the override, and applies it.
``reapply DIR [--discard]``
    Normal deploys, at the same point.  Re-applies every stored override whose
    rendered file is unchanged since it was adopted.  When this version renders
    one of them differently, that needs a rebase through the upgrade workflow:
    the analysed files are restored from the ``begin`` snapshot and exit is 3.
    ``--discard`` drops the overrides instead.
``record DIR [COMMIT]``
    After a successful deploy: the baseline the next ``check`` compares against.
    Without COMMIT (a run limited by --tags renders nothing), the previously
    recorded deployed commit is kept.

The analysed set below is shared with the upgrade tooling (digit_upgrade), so
what a normal deploy protects is exactly what an upgrade carries forward.
"""

import datetime
import fnmatch
import hashlib
import json
import os
import shutil
import sys

STATE_DIR = ".digit-deploy-state"
MANIFEST = "manifest.json"
OVERRIDES = "overrides.json"
OVERRIDE_FILES = "overrides"
PRE_DEPLOY = "pre-deploy"
VERSION = 2
EXIT_ATTENTION = 3

# Configuration a deploy renders deterministically from the repository and the
# tenant's host_vars (the `render`-tagged tasks of playbook-deploy.yml).  No
# container writes into these: every bind mount of them is read-only except
# opensre/logs, excluded below.
ANALYSED_ROOTS = (
    "configs",
    "configurator-runtime",
    "dataloader",
    "db",
    "docker",
    "gatus",
    "kong",
    "nginx",
    "novu-worker-providers",
    "opensre",
    "otel",
    "postman",
    "scripts",
    "seeds",
)
ANALYSED_TOP_LEVEL = (
    "docker-compose.*.yml",
    "docker-compose.*.yaml",
    "identity-keycloak-realm.json",
)
# Inside the analysed set, but written at runtime, downloaded, or transient.
NOT_ANALYSED = (
    "db/full-dump.sql",
    "docker-compose.upgrade-safe.yml",
    "kong/.kong.yml.pinned",
    "nginx/globalConfigs.js",
    "opensre/logs/*",
    "otel/opentelemetry-javaagent.jar",
    "otel/targets/*",
    "*/__pycache__/*",
    "*/node_modules/*",
    "*.log",
    "*.pyc",
    "*.tmp",
    "*/.gitkeep",
)


def is_analysed(rel, extra_excludes=()):
    """True when the POSIX relative path is part of the analysed configuration."""
    if any(fnmatch.fnmatchcase(rel, pattern) for pattern in NOT_ANALYSED + tuple(extra_excludes)):
        return False
    top = rel.split("/", 1)[0]
    if "/" in rel:
        return top in ANALYSED_ROOTS
    return any(fnmatch.fnmatchcase(rel, pattern) for pattern in ANALYSED_TOP_LEVEL)


def fingerprint(path):
    """Comparable identity of one path: sha256, ``symlink:<target>``, or None if absent."""
    if os.path.islink(path):
        return "symlink:" + os.readlink(path)
    if not os.path.isfile(path):
        return None
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def analysed_files(digit_dir, extra_excludes=()):
    """Return {relative path: fingerprint} for every analysed file below digit_dir."""
    result = {}
    for current, dirs, files in os.walk(digit_dir):
        rel_dir = os.path.relpath(current, digit_dir).replace(os.sep, "/")
        if rel_dir == ".":
            rel_dir = ""
            dirs[:] = [d for d in dirs if d in ANALYSED_ROOTS]
        dirs.sort()
        # Symlinked directories are recorded as links, never followed.
        for name in sorted(files) + sorted(d for d in dirs if os.path.islink(os.path.join(current, d))):
            rel = f"{rel_dir}/{name}" if rel_dir else name
            if is_analysed(rel, extra_excludes):
                result[rel] = fingerprint(os.path.join(current, name))
    return result


def _now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _state(digit_dir, *parts):
    return os.path.join(digit_dir, STATE_DIR, *parts)


def _load(path, kind):
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as stream:
        value = json.load(stream)
    if not isinstance(value, dict):
        raise ValueError(f"{kind} is malformed: {path}")
    return value


def _write_json(path, value):
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, sort_keys=True)
        stream.write("\n")
    os.replace(temporary, path)


def _load_manifest(digit_dir):
    manifest = _load(_state(digit_dir, MANIFEST), "deployment manifest")
    if manifest is not None and not isinstance(manifest.get("files"), dict):
        raise ValueError("deployment manifest is malformed: " + _state(digit_dir, MANIFEST))
    return manifest


def _load_overrides(digit_dir):
    overrides = _load(_state(digit_dir, OVERRIDES), "override index") or {}
    for rel, entry in overrides.items():
        _safe_rel(rel)
        if not isinstance(entry, dict) or "rendered" not in entry or "carried" not in entry:
            raise ValueError("override index is malformed at " + rel)
    return overrides


def _safe_rel(rel):
    parts = rel.split("/")
    if not rel or rel.startswith("/") or ".." in parts or "" in parts:
        raise ValueError("unsafe relative path: " + rel)
    return rel


def _write_in_place(source, destination):
    """Copy content and mode, keeping an existing destination's inode.

    Several analysed files are single-file bind mounts (kong.yml, nginx
    *.conf); a container keeps reading the old inode if the file is replaced.
    """
    if os.path.islink(destination) or os.path.isdir(destination):
        raise ValueError("override destination is not a regular file: " + destination)
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    shutil.copyfile(source, destination)
    shutil.copymode(source, destination)


def check(digit_dir):
    """Return (exit code, result) for the pre-deployment hand-edit check."""
    if not os.path.isdir(digit_dir):
        return 0, {"status": "NO_DEPLOYMENT"}
    manifest = _load_manifest(digit_dir)
    # A record from another version covers a different analysed set, so
    # comparing against it would report files it never covered as hand edits.
    if manifest is None or manifest.get("version") != VERSION:
        return 0, {"status": "NO_BASELINE"}
    if manifest.get("status") != "complete":
        return 0, {"status": "INCOMPLETE_PREVIOUS", "started_at": manifest.get("started_at")}
    recorded, current = manifest["files"], analysed_files(digit_dir)
    changes = {
        "modified": sorted(p for p in recorded if p in current and current[p] != recorded[p]),
        "added": sorted(p for p in current if p not in recorded),
        "removed": sorted(p for p in recorded if p not in current),
    }
    status = "DRIFT" if any(changes.values()) else "CLEAN"
    result = {"status": status, "recorded_at": manifest.get("recorded_at")}
    if status == "DRIFT":
        result.update(changes)
        return EXIT_ATTENTION, result
    return 0, result


def begin(digit_dir):
    manifest = _load_manifest(digit_dir) if os.path.isdir(digit_dir) else None
    if manifest is None:
        return {"status": "NO_BASELINE"}
    snapshot = _state(digit_dir, PRE_DEPLOY)
    shutil.rmtree(snapshot, ignore_errors=True)
    if _load_overrides(digit_dir):
        for rel in list(analysed_files(digit_dir)) + [".env"]:
            source = os.path.join(digit_dir, rel)
            if os.path.isfile(source) and not os.path.islink(source):
                stored = os.path.join(snapshot, rel)
                os.makedirs(os.path.dirname(stored), mode=0o700, exist_ok=True)
                shutil.copy2(source, stored)
    manifest["status"] = "in-progress"
    manifest["started_at"] = _now()
    _write_json(_state(digit_dir, MANIFEST), manifest)
    return {"status": "IN_PROGRESS"}


def _restore_snapshot(digit_dir):
    """Put the analysed files and .env back as ``begin`` found them."""
    snapshot = _state(digit_dir, PRE_DEPLOY)
    saved = set()
    for current, dirs, files in os.walk(snapshot):
        for name in files:
            saved.add(os.path.relpath(os.path.join(current, name), snapshot).replace(os.sep, "/"))
    for rel in analysed_files(digit_dir):
        if rel not in saved:
            os.unlink(os.path.join(digit_dir, rel))
    for rel in sorted(saved):
        _write_in_place(os.path.join(snapshot, rel), os.path.join(digit_dir, rel))
    manifest = _load_manifest(digit_dir)
    manifest["status"] = "complete"
    manifest.pop("started_at", None)
    _write_json(_state(digit_dir, MANIFEST), manifest)


def adopt(digit_dir, incoming, deleted):
    """Replace the box's local overrides with an upgrade's resolved changes, and apply them."""
    entries = {}
    for current, dirs, files in os.walk(incoming):
        dirs.sort()
        for name in sorted(files):
            path = os.path.join(current, name)
            if os.path.islink(path):
                raise ValueError("override must not be a symlink: " + path)
            entries[os.path.relpath(path, incoming).replace(os.sep, "/")] = path
    for rel in deleted:
        if rel in entries:
            raise ValueError("path is both overridden and deleted: " + rel)
        entries[rel] = None

    staged = _state(digit_dir, OVERRIDE_FILES + ".new")
    shutil.rmtree(staged, ignore_errors=True)
    index = {}
    for rel, source in sorted(entries.items()):
        _safe_rel(rel)
        index[rel] = {"rendered": fingerprint(os.path.join(digit_dir, rel)), "carried": None}
        if source is not None:
            stored = os.path.join(staged, rel)
            os.makedirs(os.path.dirname(stored), mode=0o700, exist_ok=True)
            shutil.copy2(source, stored)
            index[rel]["carried"] = fingerprint(stored)

    store = _state(digit_dir, OVERRIDE_FILES)
    shutil.rmtree(store, ignore_errors=True)
    if os.path.isdir(staged):
        os.replace(staged, store)
    _write_json(_state(digit_dir, OVERRIDES), index)
    _apply(digit_dir, index)
    return {"status": "ADOPTED", "overrides": len(index)}


def _apply(digit_dir, index):
    for rel, entry in sorted(index.items()):
        destination = os.path.join(digit_dir, rel)
        if entry["carried"] is None:
            if os.path.lexists(destination):
                os.unlink(destination)
        else:
            _write_in_place(_state(digit_dir, OVERRIDE_FILES, rel), destination)


def reapply(digit_dir, discard=False):
    """Return (exit code, result) after carrying stored overrides onto a fresh render."""
    index = _load_overrides(digit_dir)
    if not index:
        return 0, {"status": "NONE"}
    if discard:
        shutil.rmtree(_state(digit_dir, OVERRIDE_FILES), ignore_errors=True)
        os.unlink(_state(digit_dir, OVERRIDES))
        return 0, {"status": "DISCARDED", "paths": sorted(index)}
    # A path still holding the carried version was not re-rendered (a run
    # limited by --tags); only a render that differs from the adopted one is a
    # conflict.
    conflicts = sorted(
        rel for rel, entry in index.items()
        if fingerprint(os.path.join(digit_dir, rel)) not in (entry["rendered"], entry["carried"])
    )
    if conflicts:
        if not os.path.isdir(_state(digit_dir, PRE_DEPLOY)):
            raise ValueError("cannot undo this render: begin did not snapshot the analysed files")
        _restore_snapshot(digit_dir)
        return EXIT_ATTENTION, {"status": "CONFLICT", "paths": sorted(index), "conflicts": conflicts}
    _apply(digit_dir, index)
    return 0, {"status": "REAPPLIED", "paths": sorted(index)}


def record(digit_dir, commit=None):
    if not commit:
        previous = _load_manifest(digit_dir) if os.path.isdir(digit_dir) else None
        commit = (previous or {}).get("deployed_commit")
    shutil.rmtree(_state(digit_dir, PRE_DEPLOY), ignore_errors=True)
    files = analysed_files(digit_dir)
    _write_json(
        _state(digit_dir, MANIFEST),
        {
            "version": VERSION,
            "status": "complete",
            "recorded_at": _now(),
            "deployed_commit": commit,
            "files": files,
        },
    )
    return {"status": "RECORDED", "files": len(files)}


USAGE = (
    "usage: deploy_state.py check DIR | begin DIR | adopt DIR INCOMING DELETED_JSON"
    " | reapply DIR [--discard] | record DIR [COMMIT]"
)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    command, args = (argv[0], argv[1:]) if argv else (None, [])
    try:
        if command == "check" and len(args) == 1:
            code, result = check(args[0])
        elif command == "begin" and len(args) == 1:
            code, result = 0, begin(args[0])
        elif command == "adopt" and len(args) == 3:
            with open(args[2], encoding="utf-8") as stream:
                deleted = json.load(stream)
            if not isinstance(deleted, list) or not all(isinstance(p, str) for p in deleted):
                raise ValueError("deleted paths must be a JSON list of strings")
            code, result = 0, adopt(args[0], args[1], deleted)
        elif command == "reapply" and len(args) in (1, 2) and args[1:] in ([], ["--discard"]):
            code, result = reapply(args[0], discard=args[1:] == ["--discard"])
        elif command == "record" and len(args) in (1, 2):
            code, result = 0, record(args[0], args[1] if len(args) == 2 else None)
        else:
            print(USAGE, file=sys.stderr)
            return 2
    except (OSError, ValueError) as exc:
        print("ERROR: " + str(exc), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return code


if __name__ == "__main__":
    sys.exit(main())
