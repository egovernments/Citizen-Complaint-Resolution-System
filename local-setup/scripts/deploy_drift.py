#!/usr/bin/env python3
"""Detect hand edits to a deployed DIGIT directory between deployments.

``playbook-deploy.yml`` runs this on the deployment target:

* ``check``  before anything is written to the DIGIT directory.  Exit 3 when
  protected files differ from the manifest of the last successful deployment.
* ``begin``  once the check has passed, to mark the manifest as belonging to an
  in-progress deployment.  A deployment that fails half-way leaves files that
  are neither the old nor the new render; the next check reports that state
  instead of treating the deployment's own writes as hand edits.
* ``record`` after a successful deployment, to write a fresh manifest.

Normal redeploys re-render these files from the repository, so a hand edit
made directly on the server is silently overwritten.  The guard stops that
and points the operator at the upgrade workflow, which carries local changes
forward explicitly (docs/setup/local/UPGRADE-DRY-RUN.md).

Standard library only, and compatible with the Python 3 that Ansible already
requires on the target.
"""

import datetime
import hashlib
import json
import os
import sys

# Kept in step with CONFIG_ROOTS in upgrade_deploy.py: these are the
# configuration roots operators edit by hand, and every container mounts them
# read-only, so they change only through a deployment or a manual edit.
PROTECTED_ROOTS = ("configs", "kong", "nginx", "seeds", "notification-seed")
STATE_DIR = ".digit-deploy-state"
MANIFEST = "manifest.json"
VERSION = 1
EXIT_DRIFT = 3


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _is_compose_file(name):
    return name.startswith("docker-compose.") and name.endswith((".yml", ".yaml"))


def protected_files(digit_dir):
    """Return {relative path: fingerprint} for every protected file."""
    result = {}
    for name in sorted(os.listdir(digit_dir)):
        path = os.path.join(digit_dir, name)
        if os.path.isfile(path) and not os.path.islink(path) and _is_compose_file(name):
            result[name] = _sha256(path)
    for root_name in PROTECTED_ROOTS:
        root = os.path.join(digit_dir, root_name)
        if not os.path.isdir(root) or os.path.islink(root):
            continue
        for current, dirs, files in os.walk(root):
            dirs.sort()
            for name in sorted(files):
                path = os.path.join(current, name)
                rel = os.path.relpath(path, digit_dir).replace(os.sep, "/")
                if os.path.islink(path):
                    result[rel] = "symlink:" + os.readlink(path)
                elif os.path.isfile(path):
                    result[rel] = _sha256(path)
    return result


def _manifest_path(digit_dir):
    return os.path.join(digit_dir, STATE_DIR, MANIFEST)


def _load(digit_dir):
    path = _manifest_path(digit_dir)
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as stream:
        value = json.load(stream)
    if not isinstance(value, dict) or not isinstance(value.get("files"), dict):
        raise ValueError("deployment manifest is malformed: " + path)
    return value


def _write(digit_dir, manifest):
    state = os.path.join(digit_dir, STATE_DIR)
    os.makedirs(state, mode=0o700, exist_ok=True)
    path = _manifest_path(digit_dir)
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as stream:
        json.dump(manifest, stream, indent=2, sort_keys=True)
        stream.write("\n")
    os.replace(temporary, path)


def compare(recorded, current):
    """Return the sorted modified, added and removed protected paths."""
    modified = sorted(
        path for path in recorded if path in current and current[path] != recorded[path]
    )
    added = sorted(path for path in current if path not in recorded)
    removed = sorted(path for path in recorded if path not in current)
    return {"modified": modified, "added": added, "removed": removed}


def check(digit_dir):
    """Return (exit code, result) for the pre-deployment drift check."""
    if not os.path.isdir(digit_dir):
        return 0, {"status": "NO_DEPLOYMENT"}
    manifest = _load(digit_dir)
    if manifest is None:
        return 0, {"status": "NO_BASELINE"}
    if manifest.get("status") != "complete":
        return 0, {
            "status": "INCOMPLETE_PREVIOUS",
            "started_at": manifest.get("started_at"),
        }
    changes = compare(manifest["files"], protected_files(digit_dir))
    if any(changes.values()):
        result = {"status": "DRIFT", "recorded_at": manifest.get("recorded_at")}
        result.update(changes)
        return EXIT_DRIFT, result
    return 0, {"status": "CLEAN", "recorded_at": manifest.get("recorded_at")}


def begin(digit_dir):
    manifest = _load(digit_dir) if os.path.isdir(digit_dir) else None
    if manifest is None:
        return {"status": "NO_BASELINE"}
    manifest["status"] = "in-progress"
    manifest["started_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    _write(digit_dir, manifest)
    return {"status": "IN_PROGRESS"}


def record(digit_dir):
    files = protected_files(digit_dir)
    _write(
        digit_dir,
        {
            "version": VERSION,
            "status": "complete",
            "recorded_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "files": files,
        },
    )
    return {"status": "RECORDED", "files": len(files)}


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 2 or argv[0] not in ("check", "begin", "record"):
        print("usage: deploy_drift.py {check|begin|record} DIGIT_DIR", file=sys.stderr)
        return 2
    command, digit_dir = argv
    try:
        if command == "check":
            code, result = check(digit_dir)
        else:
            code, result = 0, (begin if command == "begin" else record)(digit_dir)
    except (OSError, ValueError) as exc:
        print("ERROR: " + str(exc), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return code


if __name__ == "__main__":
    sys.exit(main())
