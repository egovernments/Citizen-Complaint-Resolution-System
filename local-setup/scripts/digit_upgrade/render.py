"""Export a Git commit and render the /opt/digit configuration it would deploy.

A version that carries the render contract (``local-setup/ansible/
playbook-render.yml`` starting with ``# digit-render-contract: 1``) renders
itself: its own playbook-deploy.yml, limited to the tasks tagged ``render``.

Versions before the contract (v2.12-beta, v2.12, v2.12.1, and any commit in
between) have the same tasks without the tag.  For those the tag is grafted,
by exact task name, onto the frozen v2.12 list plus every task this version
tags, in the exported copy; the version then renders itself the same way, so
every file still comes from that version's own tasks and templates.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
import tarfile
import tempfile
from pathlib import Path, PurePosixPath
from typing import Iterable

from .common import SHA, UpgradeError, run, run_streaming

CONTRACT_MARKER = "# digit-render-contract: 1"
OWN = "own"
GRAFTED = "grafted-v2.12"
TOOL_ROOT = Path(__file__).resolve().parents[3]
# The render tasks of the v2.12 series, by exact name.  Frozen: those versions
# never change, and later ones carry their own tags.
LEGACY_RENDER_TASKS = (
    "Create DIGIT directory",
    "Copy registry-prefixed Docker Compose file",
    "Copy fast-path overlay (used only when db_fast_path is true)",
    "Copy DB-migration overlay",
    "Remove retired Ansible migrations overlay (if present)",
    "Copy monitoring overlay",
    "Copy Matomo overlay",
    "Per-tenant compose overlay — check for docker-compose.{{ inventory_hostname }}.yml",
    "Per-tenant compose overlay — copy to target (if present)",
    "Synchronize config directories",
    "Kong — stage a copy to pin CORS origins into",
    "Kong — pin CORS origins to the tenant domain (staging copy)",
    "Kong — write the pinned config back IN PLACE (preserves the inode)",
    "Synchronize docker build context dirs",
    "Configurator SPA — ensure the runtime-config dir exists",
    "Configurator SPA — render runtime config.js",
    "Add API proxy to digit-ui nginx config",
    "Set Grafana domain in compose",
    "Set PARENT_LEVEL_TENANT_ID (egov-inbox) in compose",
    "Set DIGIT_TENANT (digit-mcp / jupyter) in compose",
    "Set DIGIT_TENANT (digit-mcp) in compose",
    "Set EGOV_MOBILE_VALIDATION_DEFAULT_COUNTRY_CODE (egov-user) in compose",
    "Set EGOV_MOBILE_VALIDATION_DEFAULT_REGEX (egov-user) in compose",
    "post-bootstrap — set STATE_LEVEL_TENANT_ID (state-root) in compose",
    "post-bootstrap — set EGOV_STATE_LEVEL_TENANT_ID (state-root) in compose",
    "post-bootstrap — set EGOV_STATELEVEL_TENANT (HRMS variant) in compose",
    "post-bootstrap — set PGR_STATELEVEL_TENANTID (pgr-services variant) in compose",
    "post-bootstrap — set EGOV_UI_APP_HOST_MAP (pgr-services tenant key) in compose",
    "post-bootstrap — set STATE_LEVEL_TENANT_ID (city tier — enc-service + workflow) in compose",
    "post-bootstrap — set STATE_LEVEL_TENANT_ID (inbox-service `mz` default) in compose",
    "post-bootstrap — point hrms-prereq-gate at state_root in compose",
    "notif-seed — stage schema + data + seeder on target",
)
_TASK_NAME = re.compile(r'    - name: "?(?P<name>.*?)"?\n')
_TASK_KEY = re.compile(r"      (?P<key>[A-Za-z_.]+):(?P<rest>.*)\n")


def resolve_commit(repo: Path, ref: str) -> str:
    result = run(["git", "rev-parse", "--verify", f"{ref}^{{commit}}"], cwd=repo, check=False)
    commit = result.stdout.strip()
    if result.returncode or not SHA.fullmatch(commit):
        raise UpgradeError(f"Git reference does not name a commit in {repo}: {ref}")
    return commit


def export_commit(repo: Path, commit: str, destination: Path) -> None:
    """Extract the commit's tree (no .git) into destination."""
    destination.mkdir(parents=True)
    with tempfile.TemporaryDirectory() as scratch:
        archive = Path(scratch) / "tree.tar"
        run_streaming(["git", "archive", "--format=tar", commit], stdout=archive, cwd=repo)
        extract_tar(archive, destination, skip_unsafe_links=True)


def extract_tar(archive: Path, destination: Path, *, skip_unsafe_links: bool = False) -> None:
    """Extract a tar archive, refusing any member that could escape destination.

    Historical refs contain developer-machine symlinks (node_modules) pointing
    outside the tree; with skip_unsafe_links those are dropped instead of
    failing the export, since no deploy reads them.
    """
    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()
    with tarfile.open(archive, "r:*") as bundle:
        members = []
        for member in bundle.getmembers():
            name = PurePosixPath(member.name)
            if name.is_absolute() or ".." in name.parts:
                raise UpgradeError(f"unsafe archive member: {member.name}")
            if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
                continue  # devices, FIFOs
            if member.issym() or member.islnk():
                link = PurePosixPath(member.linkname)
                joined = PurePosixPath(os.path.normpath(name.parent / link)) if member.issym() else link
                if link.is_absolute() or joined.parts[:1] == ("..",):
                    if skip_unsafe_links:
                        continue
                    raise UpgradeError(f"archive link escapes its root: {member.name} -> {member.linkname}")
            target = (root / Path(*name.parts)).resolve()
            if target != root and root not in target.parents:
                raise UpgradeError(f"archive member escapes destination: {member.name}")
            members.append(member)
        if sys.version_info >= (3, 12):
            bundle.extractall(destination, members=members, filter="data")
        else:
            bundle.extractall(destination, members=members)  # validated above


# Directories and Compose files a deploy copies verbatim from local-setup/:
# identical bytes on the box identify the version that deployed them.
VERBATIM_DIRS = ("configs", "dataloader", "db", "docker", "gatus", "otel", "postman", "scripts", "seeds")
VERBATIM_FILES = ("docker-compose.fast-path.yml", "docker-compose.matomo.yml", "docker-compose.migrations.yml",
                  "docker-compose.monitoring.yml", "docker-compose.opensre.yml")


def base_candidates(repo: Path, live_root: Path, *, until: str) -> list[tuple[int, str]]:
    """The commits whose verbatim-copied files best match the box, best first.

    For a box deployed before the drift guard recorded its version.  Scores
    every commit up to `until` that touched local-setup: files identical to the
    box count for it, files it has that the box lacks count against it.
    """
    paths = [p for d in VERBATIM_DIRS for p in sorted((live_root / d).rglob("*")) if p.is_file() and not p.is_symlink()]
    paths += [live_root / f for f in VERBATIM_FILES if (live_root / f).is_file()]
    if not paths:
        raise UpgradeError(f"{live_root} has none of the files a deploy copies verbatim; give --base-ref")
    blobs = _hash_objects(repo, paths)
    live = {p.relative_to(live_root).as_posix(): b for p, b in zip(paths, blobs)}
    scored = []
    for commit in run(["git", "rev-list", until, "--", "local-setup"], cwd=repo).stdout.split():
        listing = run(["git", "ls-tree", "-r", commit, "--",
                       *(f"local-setup/{d}" for d in VERBATIM_DIRS + VERBATIM_FILES),
                       *(f"local-setup/ansible/{d}" for d in VERBATIM_DIRS)], cwd=repo).stdout
        found: dict[str, dict[str, str]] = {"ansible": {}, "": {}}
        for line in listing.splitlines():
            meta, path = line.split("\t", 1)
            rel = path.removeprefix("local-setup/")
            where = "ansible" if rel.startswith("ansible/") else ""
            found[where][rel.removeprefix("ansible/")] = meta.split()[2]
        # Like the deploy's `src: ../<dir>`: Ansible looks in playbook_dir/files/../<dir>
        # (local-setup/ansible/<dir>) before playbook_dir/../<dir> (local-setup/<dir>).
        tree = {}
        for rel, blob in found[""].items():
            top = rel.split("/", 1)[0]
            if top not in VERBATIM_DIRS or not any(r.split("/", 1)[0] == top for r in found["ansible"]):
                tree[rel] = blob
        tree.update(found["ansible"])
        same = sum(tree.get(rel) == blob for rel, blob in live.items())
        missing = sum(rel not in live for rel in tree if rel.split("/", 1)[0] in VERBATIM_DIRS)
        scored.append((same - missing, commit))
    scored.sort(key=lambda item: -item[0])  # stable: newest first among equals
    best = scored[0][0] if scored else None
    return [item for item in scored if item[0] == best]


def _hash_objects(repo: Path, paths: list[Path]) -> list[str]:
    import subprocess

    result = subprocess.run(["git", "hash-object", "--stdin-paths"], cwd=repo, input="\n".join(map(str, paths)),
                            capture_output=True, text=True, check=False)
    if result.returncode:
        raise UpgradeError(f"git hash-object failed: {result.stderr.strip()}")
    return result.stdout.split()


def preflight(source: Path, tenant_vars: Path) -> None:
    """The version's own host_vars preflight (what deploy.sh runs first), if it has one."""
    script = source / "local-setup/scripts/preflight.py"
    if not script.is_file():
        return
    result = run([sys.executable, str(script), str(tenant_vars.resolve())], cwd=source / "local-setup/ansible", check=False)
    if result.returncode:
        failures = [line for line in (result.stdout + result.stderr).splitlines() if line.startswith("[FAIL]")]
        raise UpgradeError(
            "the tenant vars do not pass the target version's preflight, so its deploy.sh would refuse them:\n  "
            + "\n  ".join(failures or [(result.stdout + result.stderr).strip()[-2000:]])
        )


def has_contract(source: Path) -> bool:
    playbook = source / "local-setup/ansible/playbook-render.yml"
    if not playbook.is_file():
        return False
    with playbook.open(encoding="utf-8") as stream:
        return any(next(stream, "").strip() == CONTRACT_MARKER for _ in range(3))


def render(source: Path, tenant: str, tenant_vars: Path, destination: Path, *, allow_legacy: bool) -> str:
    """Render source (an exported tree) for tenant into destination; return how."""
    source, tenant_vars, destination = source.resolve(), tenant_vars.resolve(), destination.resolve()
    how = OWN
    if not has_contract(source):
        if not allow_legacy:
            raise UpgradeError(
                "the target version predates the render contract "
                "(local-setup/ansible/playbook-render.yml); upgrade targets must include it"
            )
        graft_render_contract(source)
        how = GRAFTED
    _render(source, tenant, tenant_vars, destination)
    return how


def tag_tasks(playbook: str, names: Iterable[str], *, strip_ownership: bool = False) -> str:
    """Add the `render` tag to every play-level task with one of these exact names.

    strip_ownership drops `owner:`/`group:` from those tasks: a render runs
    unprivileged, and ownership is not part of what is compared.
    """
    wanted = set(names)
    out: list[str] = []
    in_task = False
    for line in playbook.splitlines(keepends=True):
        name = _TASK_NAME.fullmatch(line)
        if name:
            in_task = name.group("name") in wanted
            out.append(line)
            if in_task:
                out.append("      tags: ['render']\n")
            continue
        key = _TASK_KEY.fullmatch(line)
        if in_task and key and key.group("key") == "tags":
            # Merge into the tag line inserted above instead of a duplicate key.
            existing = key.group("rest").strip()
            merged = existing[:-1] + ", 'render']" if existing.startswith("[") else f"[{existing}, 'render']"
            index = max(i for i, text in enumerate(out) if text == "      tags: ['render']\n")
            out[index] = f"      tags: {merged}\n"
            continue
        if line.startswith("    - "):
            in_task = False
        if in_task and strip_ownership and re.match(r"\s{8}(owner|group):", line):
            continue
        out.append(line)
    return "".join(out)


def render_task_names(playbook: Path) -> set[str]:
    """Names of the play-level tasks a contract playbook tags `render`."""
    import yaml

    play = yaml.safe_load(playbook.read_text(encoding="utf-8"))[0]
    names = set()
    for task in (play.get("pre_tasks") or []) + play.get("tasks", []):
        if isinstance(task, dict) and "render" in (task.get("tags") or []) and task.get("name"):
            names.add(task["name"])
    return names


def graft_render_contract(source: Path) -> None:
    ansible_dir = source / "local-setup/ansible"
    playbook = ansible_dir / "playbook-deploy.yml"
    names = set(LEGACY_RENDER_TASKS) | render_task_names(TOOL_ROOT / "local-setup/ansible/playbook-deploy.yml")
    playbook.write_text(tag_tasks(playbook.read_text(encoding="utf-8"), names, strip_ownership=True), encoding="utf-8")
    shutil.copyfile(TOOL_ROOT / "local-setup/ansible/playbook-render.yml", ansible_dir / "playbook-render.yml")


def _render(source: Path, tenant: str, tenant_vars: Path, destination: Path) -> None:
    ansible_dir = source / "local-setup/ansible"
    with tempfile.TemporaryDirectory(prefix="digit-render-inventory-") as scratch:
        inventory = Path(scratch)
        shutil.copytree(ansible_dir / "inventory/group_vars", inventory / "group_vars")
        (inventory / "host_vars").mkdir()
        shutil.copyfile(tenant_vars, inventory / "host_vars" / f"{tenant}.yml")
        host = {"ansible_connection": "local", "ansible_python_interpreter": sys.executable}
        hosts = {"all": {"children": {"digit": {"hosts": {tenant: host}}}}}
        (inventory / "hosts.yml").write_text(json.dumps(hosts), encoding="utf-8")
        env = dict(os.environ, ANSIBLE_NOCOLOR="1", ANSIBLE_RETRY_FILES_ENABLED="0")
        result = run(
            [
                "ansible-playbook", "-i", str(inventory / "hosts.yml"), "--limit", tenant,
                "playbook-render.yml", "--tags", "render",
                "-e", json.dumps({"digit_dir": str(destination)}),
            ],
            cwd=ansible_dir, env=env, check=False,
        )
    if result.returncode:
        tail = "\n".join((result.stdout + "\n" + result.stderr).strip().splitlines()[-40:])
        raise UpgradeError(f"rendering {source.name} failed:\n{tail}")
