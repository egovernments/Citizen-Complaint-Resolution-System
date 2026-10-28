"""Guarded deployment of an analysed upgrade, and rollback.

Runs as root on the DIGIT server, from the checkout of the target commit.
Every phase is journaled in <run>/deploy/journal.json before it starts:

    preflight     checks only; nothing on the box has changed
    backing-up    web traffic refused, writers stopped        → restart previous
    predicting    target MDMS migrations on a database clone  → restart previous
    deploying     deploy.sh in upgrade-safe mode              → full rollback
    verifying     post-deploy checks                          → full rollback
    deployed | aborted | rolled-back | rollback-failed

A run killed in any non-final phase is recovered with ``digit-upgrade
rollback <run>``; a new deploy of it is refused until then.
"""

from __future__ import annotations

import contextlib
import fcntl
import json
import os
import shutil
import signal
import subprocess
import tempfile
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable

import deploy_state

from . import analyse, mdms, render
from .common import (
    NeedsOperator, UpgradeError, read_json, run, run_streaming, safe_relative, sha256_file, stamp,
    utc_now, write_json,
)
from .redaction import REDACTED, RestoreError, Sources, restore, secret_fields, suffix_of
from .trees import prepare

POSTGRES = "docker-postgres"
DB_USER = DB_NAME = "egov"
MAINTENANCE_TAG = "digit-upgrade-maintenance"
CLONE_LABEL = "digit-upgrade-clone"
LOCK_FILE = Path("/run/lock/digit-upgrade.lock")
# Host state a deploy rewrites outside /opt/digit: the nginx site, and the
# static UIs host nginx serves.
HOST_PATHS = (Path("/etc/nginx"), Path("/var/www"), Path("/opt/digit-ui-esbuild"))
# Services that cache MDMS rows; restarted after kept rows are written back.
MDMS_READERS = ("egov-mdms-service", "mdms-backend", "egov-accesscontrol")
FINAL = {"deployed", "aborted", "rolled-back"}
RECOVERABLE_BY_RESTART = {"backing-up", "predicting"}


def stop_process_group(process: subprocess.Popen, grace: float = 30) -> None:
    for sig, wait in ((signal.SIGTERM, grace), (signal.SIGKILL, None)):
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, sig)
        try:
            process.wait(timeout=wait)
            return
        except subprocess.TimeoutExpired:
            continue


class Maintenance:
    """Refuse public web traffic for the whole upgrade window.

    A firewall rule rather than an nginx page: deploy.sh itself reloads and
    starts host nginx part-way through (with the old vhost on tenants that keep
    their own), so nothing in nginx could hold the window shut. Loopback stays
    open for deploy-time health checks; SSH is untouched.  The rule is tagged,
    so a recovery can always find and remove it.
    """

    def __init__(self, ports: list[int], runner: Callable[..., subprocess.CompletedProcess[str]] = run) -> None:
        self.ports, self.run = sorted(set(ports)), runner
        self.tools = [t for t in ("iptables", "ip6tables") if shutil.which(t)]

    def _rule(self) -> list[str]:
        return ["INPUT", "!", "-i", "lo", "-p", "tcp", "-m", "multiport", "--dports", ",".join(map(str, self.ports)),
                "-m", "comment", "--comment", MAINTENANCE_TAG, "-j", "REJECT", "--reject-with", "tcp-reset"]

    def on(self) -> None:
        if "iptables" not in self.tools:
            raise UpgradeError("iptables is required to hold the maintenance window")
        for tool in self.tools:
            if self.run([tool, "-C", *self._rule()], check=False).returncode:
                self.run([tool, "-I", *self._rule()])

    def off(self) -> None:
        for tool in self.tools:
            while self.run([tool, "-C", *self._rule()], check=False).returncode == 0:
                self.run([tool, "-D", *self._rule()])


class Interrupted(Exception):
    """A termination signal arrived; handled like any failure."""


@contextlib.contextmanager
def signals_raise():
    def handler(signum, _frame):
        raise Interrupted(f"received {signal.Signals(signum).name}")

    previous = {s: signal.signal(s, handler) for s in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)}
    try:
        yield
    finally:
        for s, h in previous.items():
            signal.signal(s, h)


@contextlib.contextmanager
def signals_ignored():
    """A rollback must not itself be interrupted half-way."""
    previous = {s: signal.signal(s, signal.SIG_IGN) for s in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)}
    try:
        yield
    finally:
        for s, h in previous.items():
            signal.signal(s, h)


@contextlib.contextmanager
def exclusive_lock():
    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    with LOCK_FILE.open("w") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise UpgradeError("another digit-upgrade deploy or rollback is running on this server") from exc
        yield


class Journal:
    def __init__(self, directory: Path) -> None:
        self.path = directory / "journal.json"
        self.state: dict[str, Any] = read_json(self.path) if self.path.exists() else {"history": []}

    @property
    def phase(self) -> str | None:
        return self.state.get("phase")

    def enter(self, phase: str, **details: Any) -> None:
        self.state.update(details)
        self.state["phase"] = phase
        self.state["history"].append({"phase": phase, "at": utc_now()})
        write_json(self.path, self.state)


@dataclass
class StackRecord:
    """What rollback needs to put the previous stack back, saved with the backup."""

    digit_dir: str
    project: str
    compose_files: list[str]
    services: list[str]
    images: dict[str, dict[str, str]]
    volumes: list[str]
    data_directory: str
    public_ports: list[int] = field(default_factory=lambda: [80, 443])
    host_paths: list[str] = field(default_factory=list)
    mdms_tables: list[str] = field(default_factory=list)
    analysed_files: dict[str, str | None] = field(default_factory=dict)


class Docker:
    """The few Docker and psql operations the deployer needs (replaceable in tests)."""

    def __init__(self, runner: Callable[..., subprocess.CompletedProcess[str]] = run) -> None:
        self.run = runner

    def inspect(self, *names: str) -> list[dict[str, Any]]:
        return json.loads(self.run(["docker", "inspect", *names]).stdout)

    def psql(self, sql: str, container: str = POSTGRES) -> str:
        return self.run([
            "docker", "exec", "-u", "postgres", container, "psql", "-X", "-v", "ON_ERROR_STOP=1",
            "-U", DB_USER, "-d", DB_NAME, "-Atc", sql,
        ]).stdout

    def wait_for_postgres(self, container: str = POSTGRES, seconds: int = 180) -> None:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            ready = self.run(["docker", "exec", container, "pg_isready", "-U", DB_USER, "-d", DB_NAME], check=False)
            if ready.returncode == 0:
                return
            time.sleep(2)
        raise UpgradeError(f"PostgreSQL in {container} did not become ready within {seconds}s")

    def project_containers(self, project: str, running_only: bool = True) -> list[str]:
        args = ["docker", "ps", "-q", "--filter", f"label=com.docker.compose.project={project}"]
        return self.run(args if running_only else [*args[:2], "-a", *args[2:]]).stdout.split()

    def snapshot(self, tables: list[str], container: str = POSTGRES) -> mdms.Snapshot:
        return mdms.index({
            table: [json.loads(line) for line in self.psql(mdms.snapshot_sql(table), container).splitlines() if line]
            for table in tables
        })

    def existing_tables(self, container: str = POSTGRES) -> list[str]:
        names = ",".join(f"'public.{t}'" for t in mdms.TABLES)
        found = self.psql(f"SELECT t FROM unnest(ARRAY[{names}]) t WHERE to_regclass(t) IS NOT NULL", container)
        return sorted(line.removeprefix("public.") for line in found.splitlines() if line)


class Deployment:
    def __init__(self, run_dir: Path, *, backup_parent: Path, resolution: Path | None, docker: Docker | None = None,
                 tool_root: Path = render.TOOL_ROOT, log: Callable[[str], None] = print) -> None:
        self.run_dir = run_dir.resolve()
        self.dir = self.run_dir / "deploy"
        self.backup_parent = backup_parent.resolve()
        self.resolution = resolution.resolve() if resolution else None
        self.docker = docker or Docker()
        self.tool_root = tool_root
        self.log = log
        self.manifest = read_json(self.run_dir / "run.json")
        self.tenant = self.manifest["tenant"]
        self.tenant_vars = tool_root / "local-setup/ansible/inventory/host_vars" / f"{self.tenant}.yml"
        self.journal = Journal(self.dir) if self.dir.is_dir() else None

    # ── preflight: nothing on the box changes ──────────────────────────────

    def preflight(self, scratch: Path) -> dict[str, Any]:
        if os.geteuid() != 0:
            raise UpgradeError("deploy must run as root on the DIGIT server")
        if not shutil.which("iptables"):
            raise UpgradeError("iptables is required to hold the maintenance window")
        if self.manifest["status"] != analyse.READY:
            raise UpgradeError(f"the run is {self.manifest['status']}, not READY; finish it with digit-upgrade resume")
        if self.manifest["deployed"]:
            raise UpgradeError("this run was already deployed")
        self._check_checkout()
        values = self.values = analyse.load_yaml(self.tenant_vars)
        if values.get("ansible_connection") != "local" and values.get("ansible_host") not in (None, "localhost", "127.0.0.1"):
            raise UpgradeError("run the guarded upgrade on the DIGIT server itself (ansible_connection: local)")
        digit_dir = Path(values.get("digit_dir") or "/opt/digit")
        if not digit_dir.is_dir():
            raise UpgradeError(f"live DIGIT directory not found: {digit_dir}")
        if self.backup_parent == digit_dir or digit_dir in self.backup_parent.parents:
            raise UpgradeError("--backup-dir must be outside the DIGIT directory")

        raw = {"live": digit_dir}
        base_vars = scratch / "base-tenant-vars.yml"
        overrides = read_json(self.run_dir / "base-overrides.json") if (self.run_dir / "base-overrides.json").exists() else {}
        analyse.write_yaml(base_vars, analyse.base_tenant_vars(values, overrides))
        for name, commit, vars_path, legacy in (
            ("base", self.manifest["base_commit"], base_vars, True),
            ("target", self.manifest["target_commit"], self.tenant_vars, False),
        ):
            source = scratch / f"{name}-source"
            render.export_commit(self.tool_root, commit, source)
            raw[name] = scratch / f"{name}-render"
            render.render(source, self.tenant, vars_path, raw[name], allow_legacy=legacy)
        known = analyse.values_in_structure(values) | analyse.values_in_structure(analyse.base_tenant_vars(values, overrides))
        prepared = prepare(raw, scratch / "normalized", known_secrets=known, excludes=self.manifest["excludes"])
        self._check_same_as_analysed(prepared.hashes, prepared.normalized["live"])

        overlay, deleted, restore_conflicts = self._materialize(prepared, scratch)
        if restore_conflicts and not self.manifest["secret_review_acknowledged"]:
            raise UpgradeError(
                "secret values changed both locally and in the target, and the analysis did not flag them: "
                + ", ".join(restore_conflicts)
            )
        self._check_secret_promise(prepared, overlay, deleted)
        preview = self._preview(raw["target"], overlay, deleted, scratch / "preview")
        stack = self._discover(digit_dir)
        self._check_postgres_storage(preview, digit_dir, stack)
        self._check_space(digit_dir, stack)
        return {"digit_dir": digit_dir, "overlay": overlay, "deleted": deleted, "stack": stack,
                "restore_conflicts": restore_conflicts}

    def _check_checkout(self) -> None:
        head = run(["git", "rev-parse", "HEAD"], cwd=self.tool_root).stdout.strip()
        if head != self.manifest["target_commit"]:
            raise UpgradeError(
                f"this checkout is at {head}; deploy from a checkout of the analysed target "
                f"{self.manifest['target_commit']} (git checkout {self.manifest['target_commit']})"
            )
        if run(["git", "status", "--porcelain", "--untracked-files=no"], cwd=self.tool_root).stdout.strip():
            raise UpgradeError("the checkout has uncommitted changes; deploy needs exactly the analysed commit")
        if not self.tenant_vars.is_file() or sha256_file(self.tenant_vars) != self.manifest["tenant_vars_sha256"]:
            raise UpgradeError(f"{self.tenant_vars} must exist and be byte-identical to the analysed tenant vars")

    def _check_same_as_analysed(self, hashes: dict[str, str], live_tree: Path) -> None:
        expected = self.manifest["tree_hashes"]
        for name in ("base", "target"):
            if hashes[name] != expected[name]:
                raise UpgradeError(
                    f"the {name} render differs from the analysis (different tool version or tenant vars?); "
                    "re-run the analysis from this checkout"
                )
        if hashes["live"] != expected["live"]:
            changed = self._changed_since_analysis(live_tree)
            raise UpgradeError(
                f"live configuration changed since the analysed backup ({len(changed)} path(s): "
                f"{', '.join(changed[:20])}{' …' if len(changed) > 20 else ''}). Take a fresh backup and "
                "re-run the analysis; nothing was changed"
            )

    def _changed_since_analysis(self, live_tree: Path) -> list[str]:
        workspace = self.run_dir / "workspace"
        with tempfile.TemporaryDirectory() as scratch:
            env = dict(os.environ, GIT_INDEX_FILE=str(Path(scratch) / "index"), GIT_DIR=str(workspace / ".git"),
                       GIT_WORK_TREE=str(live_tree))
            run(["git", "add", "-A"], cwd=live_tree, env=env)
            return run(["git", "diff", "--cached", "--name-only", "live"], cwd=live_tree, env=env).stdout.split()

    def _materialize(self, prepared, scratch: Path) -> tuple[Path, list[str], list[str]]:
        """The private, unredacted overlay of resolved local changes."""
        overlay = self.dir / "overlay"
        shutil.rmtree(overlay, ignore_errors=True)
        overlay.mkdir(mode=0o700, parents=True)
        candidate = self.run_dir / "candidate"
        deleted, conflicts = [], []
        for change in self.manifest["deployment_changes"]:
            rel = safe_relative(change["path"])
            if change["status"] == "D":
                deleted.append(rel.as_posix())
                continue
            source = candidate / rel
            if source.is_symlink() or not source.is_file():
                raise UpgradeError(f"candidate change is not a regular file: {rel}")
            destination = overlay / rel
            destination.parent.mkdir(parents=True, exist_ok=True)
            data = source.read_bytes()
            if REDACTED.encode() not in data:
                shutil.copyfile(source, destination)
            else:
                texts = {}
                for name in ("base", "live", "target"):
                    path = prepared.raw[name] / rel
                    texts[name] = path.read_text(encoding="utf-8") if path.is_file() and not path.is_symlink() else None
                sources = Sources(**texts, redactor=prepared.redactor)
                try:
                    destination.write_text(restore(data.decode("utf-8"), rel.as_posix(), sources), encoding="utf-8", newline="")
                except RestoreError as exc:
                    raise UpgradeError(f"cannot restore redacted values: {exc}") from exc
                conflicts += sources.conflicts
            os.chmod(destination, source.stat().st_mode & 0o777)
        return overlay, sorted(deleted), conflicts

    def _check_secret_promise(self, prepared, overlay: Path, deleted: list[str]) -> None:
        """An acknowledged secret conflict keeps the box's value; refuse if the merge cannot.

        That happens when the target moved or removed the field: the merged file
        then has no place for the box's value, and deploying would silently use
        the target's.
        """
        lost = []
        for finding in self.manifest["secrets"]["findings"]:
            if finding["severity"] != "blocker":
                continue
            rel = finding["path"]
            final = None if rel in deleted else overlay / rel if (overlay / rel).is_file() else prepared.raw["target"] / rel
            live = prepared.raw["live"] / rel
            final_value = secret_fields(final.read_text(encoding="utf-8"), suffix_of(rel)).get(finding["field"]) \
                if final is not None and final.is_file() else None
            live_value = secret_fields(live.read_text(encoding="utf-8"), suffix_of(rel)).get(finding["field"]) \
                if live.is_file() else None
            if final_value != live_value:
                lost.append(f"{rel} {finding['field']}")
        if lost:
            raise UpgradeError(
                "these secrets were changed on this box and by the target, and the merged configuration "
                "cannot keep the box's value (the target moved or removed the field): " + ", ".join(lost)
                + ". Set them where the new version expects them (host_vars or OpenBao) and re-run the analysis "
                "from a fresh backup; nothing was changed"
            )

    @staticmethod
    def _preview(target_render: Path, overlay: Path, deleted: list[str], preview: Path) -> Path:
        """The analysed part of /opt/digit as it will be after the deploy."""
        shutil.copytree(target_render, preview, symlinks=True)
        shutil.copytree(overlay, preview, dirs_exist_ok=True)
        for rel in deleted:
            (preview / rel).unlink(missing_ok=True)
        return preview

    def _discover(self, digit_dir: Path) -> StackRecord:
        postgres = self.docker.inspect(POSTGRES)[0]
        labels = postgres["Config"]["Labels"]
        project = labels.get("com.docker.compose.project")
        if not project:
            raise UpgradeError(f"{POSTGRES} is not a Compose container")
        ids = self.docker.project_containers(project)
        services, images, volumes = [], {}, set()
        for info in self.docker.inspect(*ids):
            service = info["Config"]["Labels"].get("com.docker.compose.service")
            if not service:
                continue
            services.append(service)
            images[service] = {"id": info["Image"], "ref": info["Config"]["Image"]}
            volumes |= {m["Name"] for m in info.get("Mounts", []) if m.get("Type") == "volume"}
        compose_files = [f for f in labels.get("com.docker.compose.project.config_files", "").split(",") if f]
        if not compose_files:
            raise UpgradeError("cannot read the running stack's Compose files from its labels")
        return StackRecord(
            digit_dir=str(digit_dir), project=project, compose_files=compose_files, services=sorted(services),
            images=images, volumes=sorted(volumes),
            data_directory=self.docker.psql("SHOW data_directory").strip(),
            public_ports=sorted({80, 443, int(self.values.get("nginx_host_port") or 80)}),
            host_paths=[str(p) for p in HOST_PATHS if p.exists()],
            mdms_tables=self.docker.existing_tables(),
        )

    def _check_postgres_storage(self, preview: Path, digit_dir: Path, stack: StackRecord) -> None:
        """PGDATA must be on the named volume, and the new stack must mount it at the same place.

        A box whose data still sits in the image's anonymous volume (the base
        Compose file mounts postgres_data at a path PostgreSQL never uses)
        would start the new version on an empty database.
        """
        named = f"{stack.project}_postgres_data"
        mounts = self.docker.inspect(POSTGRES)[0].get("Mounts", [])
        live = [m for m in mounts if m.get("Destination") == stack.data_directory]
        if len(live) != 1 or live[0].get("Type") != "volume" or live[0].get("Name") != named:
            raise UpgradeError(
                f"PostgreSQL data ({stack.data_directory}) is not on the named volume {named}. Move it first: "
                "docs/releases/2.12/operations/postgres-volume-migration.md"
            )
        files = sorted(p.name for p in preview.glob("docker-compose.*.y*ml")
                       if p.name not in ("docker-compose.fast-path.yml", "docker-compose.upgrade-safe.yml"))
        args = ["docker", "compose", "--project-name", stack.project, "--project-directory", str(preview)]
        for name in ["docker-compose.egov-digit.yaml", *[f for f in files if f != "docker-compose.egov-digit.yaml"]]:
            args += ["-f", str(preview / name)]
        args += ["-f", str(self.tool_root / "local-setup/docker-compose.upgrade-safe.yml"),
                 "--profile", "*", "config", "--no-interpolate", "--format", "json"]
        config = json.loads(self.docker.run(args, cwd=preview).stdout)
        volumes = config["services"]["postgres-db"].get("volumes", [])
        data = [v for v in volumes if v.get("target") == stack.data_directory]
        if len(data) != 1 or data[0].get("source") != "postgres_data":
            raise UpgradeError(
                f"the new stack would not mount postgres_data at {stack.data_directory}; refusing to start it on other storage"
            )
        if any(str(v.get("target", "")).startswith("/docker-entrypoint-initdb.d") for v in volumes):
            raise UpgradeError("the new stack would mount an initdb dump into PostgreSQL")

    def _check_space(self, digit_dir: Path, stack: StackRecord) -> None:
        paths = [digit_dir, *map(Path, stack.host_paths)]
        paths += [Path(self.docker.run(["docker", "volume", "inspect", "-f", "{{.Mountpoint}}", v]).stdout.strip())
                  for v in stack.volumes]
        used = sum(int(run(["du", "-sb", str(p)]).stdout.split()[0]) for p in paths)
        self.backup_parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        free = shutil.disk_usage(self.backup_parent).free
        if free < used * 2 + 2 * 1024**3:
            raise UpgradeError(f"not enough space in {self.backup_parent}: {free} bytes free, need {used * 2 + 2 * 1024**3}")

    # ── backup: writers stopped, cold copies ───────────────────────────────

    def backup(self, stack: StackRecord) -> Path:
        backup = self.backup_parent / f"digit-upgrade-{stamp()}"
        backup.mkdir(mode=0o700)
        self.journal.enter("backing-up", backup=str(backup), stack=asdict(stack))
        for container in self.docker.project_containers(stack.project):
            if self.docker.inspect(container)[0]["Name"].lstrip("/") != POSTGRES:
                self.docker.run(["docker", "stop", "--time", "60", container])
        self.log("writers stopped; dumping the database")
        dump = backup / "egov.dump"
        run_streaming(["docker", "exec", "-u", "postgres", POSTGRES, "pg_dump", "-U", DB_USER, "-d", DB_NAME, "-Fc"], stdout=dump)
        run_streaming(["docker", "exec", "-u", "postgres", POSTGRES, "pg_dumpall", "-U", DB_USER, "--globals-only"],
                      stdout=backup / "globals.sql")
        before = self.docker.snapshot(stack.mdms_tables)
        write_json(backup / "mdms-before.json", {t: list(rows.values()) for t, rows in before.items()})
        stack.analysed_files = deploy_state.analysed_files(stack.digit_dir)
        self.docker.run(["docker", "stop", "--time", "120", POSTGRES])
        self.log("database stopped; archiving configuration, host state and volumes")
        archives = {"digit": (Path(stack.digit_dir), backup / "digit.tar.zst")}
        for path in map(Path, stack.host_paths):
            archives[str(path)] = (path, backup / "host" / f"{str(path).strip('/').replace('/', '_')}.tar.zst")
        for volume in stack.volumes:
            archives[f"volume:{volume}"] = (self._mountpoint(volume), backup / "volumes" / f"{volume}.tar.zst")
        for source, archive in archives.values():
            archive.parent.mkdir(mode=0o700, exist_ok=True)
            run(["tar", "--zstd", "-cpf", str(archive), "-C", str(source.parent), source.name])
            run(["tar", "--zstd", "-tf", str(archive)])  # readable end to end
        write_json(backup / "stack.json", asdict(stack))
        return backup

    def _mountpoint(self, volume: str) -> Path:
        path = Path(self.docker.run(["docker", "volume", "inspect", "-f", "{{.Mountpoint}}", volume]).stdout.strip())
        root = Path(self.docker.run(["docker", "info", "-f", "{{.DockerRootDir}}"]).stdout.strip()) / "volumes"
        if path.name != "_data" or path.parent.parent != root:
            raise UpgradeError(f"refusing an unexpected Docker volume mountpoint: {path}")
        return path

    # ── prediction: target migrations on a clone ───────────────────────────

    def predict(self, backup: Path, stack: StackRecord) -> tuple[mdms.Snapshot, list[dict[str, Any]]]:
        self.journal.enter("predicting")
        image = stack.images["postgres-db"]["ref"]
        suffix = os.urandom(4).hex()
        network, clone, migrator = (f"digit-upgrade-{suffix}", f"digit-upgrade-pg-{suffix}", f"digit-upgrade-mdms:{suffix}")
        password = os.urandom(18).hex()
        self.docker.run(["docker", "network", "create", "--label", CLONE_LABEL, network])
        try:
            self.docker.run(["docker", "run", "-d", "--label", CLONE_LABEL, "--name", clone, "--network", network,
                             "-e", f"POSTGRES_USER={DB_USER}",
                             "-e", f"POSTGRES_PASSWORD={password}", "-e", f"POSTGRES_DB={DB_NAME}", image])
            self.docker.wait_for_postgres(clone)
            run_streaming(["docker", "exec", "-i", clone, "pg_restore", "-U", DB_USER, "-d", DB_NAME, "--no-owner",
                           "--exit-on-error"], stdin=backup / "egov.dump")
            self.docker.run(["docker", "build", "-t", migrator, str(self.tool_root / "local-setup/docker/db-migrations")])
            self.docker.run(["docker", "run", "--rm", "--network", network,
                             "-e", f"DB_URL=jdbc:postgresql://{clone}:5432/{DB_NAME}", "-e", f"FLYWAY_USER={DB_USER}",
                             "-e", f"FLYWAY_PASSWORD={password}", "-e", "MIGRATION_SERVICES=egov-mdms", migrator])
            for sql in mdms.DEPLOY_SQL:
                run_streaming(["docker", "exec", "-i", "-u", "postgres", clone, "psql", "-X", "-v", "ON_ERROR_STOP=1",
                               "-U", DB_USER, "-d", DB_NAME], stdin=self.tool_root / sql)
            predicted = self.docker.snapshot(self.docker.existing_tables(clone), clone)
        finally:
            for args in (["docker", "rm", "-f", clone], ["docker", "network", "rm", network], ["docker", "image", "rm", migrator]):
                self.docker.run(args, check=False)

        before = mdms.index(read_json(backup / "mdms-before.json"))
        conflicts = mdms.changes(before, predicted)["modified"]
        write_json(self.dir / "mdms-conflicts.json", mdms.conflict_report(conflicts))
        if conflicts and self.resolution is None:
            template = self.dir / "mdms-resolution.json"
            write_json(template, {mdms.choice_id(c): f"{mdms.BACKUP} or {mdms.TARGET}" for c in conflicts})
            raise NeedsOperator(
                f"the target changes {len(conflicts)} existing MDMS/config row(s); see {self.dir / 'mdms-conflicts.json'}. "
                f"Set each entry of {template} to '{mdms.BACKUP}' or '{mdms.TARGET}', then deploy again with "
                f"--mdms-resolution {template}"
            )
        keep = mdms.resolve(conflicts, read_json(self.resolution) if self.resolution else {})
        for item in keep:
            predicted.setdefault(item["table"], {})[item["key"]] = item["row"]
        return predicted, keep

    # ── deploy and verify ──────────────────────────────────────────────────

    def deploy(self, overlay: Path, deleted: list[str], keep: list[dict[str, Any]], log_file: Path) -> None:
        self.journal.enter("deploying")
        extra = {
            "upgrade_safe_mode": True, "upgrade_overlay_dir": str(overlay), "upgrade_deleted_paths": deleted,
            "force_clean": False, "run_ci_tests": False, "seed_notifications": False,
        }
        self.log(f"running deploy.sh (output: {log_file})")
        with log_file.open("ab") as stream:
            # Own session: on an interrupt the whole tree (bash, ansible-playbook,
            # docker clients) is stopped before rollback touches anything.
            process = subprocess.Popen(
                ["bash", "deploy.sh", self.tenant, "-e", json.dumps(extra)],
                cwd=self.tool_root / "local-setup/ansible", stdout=stream, stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            try:
                code = process.wait()
            except BaseException:
                with signals_ignored():
                    stop_process_group(process)
                raise
        if code:
            raise UpgradeError(f"deploy.sh failed (exit {code}); see {log_file}")
        if keep:
            with tempfile.NamedTemporaryFile("w", dir=self.dir, suffix=".sql") as sql:
                sql.write(mdms.restore_sql(keep))
                sql.flush()
                run_streaming(["docker", "exec", "-i", "-u", "postgres", POSTGRES, "psql", "-X", "-v", "ON_ERROR_STOP=1",
                               "-U", DB_USER, "-d", DB_NAME], stdin=Path(sql.name))
            running = self.docker.run(["docker", "ps", "--format", "{{.Names}}"]).stdout.split()
            restart = [s for s in MDMS_READERS if s in running]
            if restart:
                self.docker.run(["docker", "restart", *restart])

    def verify(self, stack: StackRecord, overlay: Path, deleted: list[str], predicted: mdms.Snapshot,
               keep: list[dict[str, Any]]) -> dict[str, Any]:
        self.journal.enter("verifying")
        digit_dir = Path(stack.digit_dir)
        for file in (p for p in overlay.rglob("*") if p.is_file()):
            rel = file.relative_to(overlay)
            live = digit_dir / rel
            if not live.is_file() or sha256_file(live) != sha256_file(file):
                raise UpgradeError(f"a carried local change did not survive the deploy: {rel.as_posix()}")
        for rel in deleted:
            if (digit_dir / rel).exists():
                raise UpgradeError(f"a resolved local deletion was recreated: {rel}")
        after = self.docker.snapshot(self.docker.existing_tables())
        result = mdms.verify(after, predicted, keep)
        if result["kept_rows_broken"]:
            raise UpgradeError(f"MDMS rows resolved to '{mdms.BACKUP}' did not hold: {result['kept_rows_broken']}")
        return result

    # ── rollback ───────────────────────────────────────────────────────────

    def restart_previous(self, stack: StackRecord) -> None:
        """Bring the previous stack back after a failure that changed no files or data."""
        self._start_previous(stack)

    def _start_previous(self, stack: StackRecord, check_database: Callable[[], None] | None = None) -> None:
        # Tags may have been re-pointed by the new version's pulls; restart the
        # exact images that were running.
        for image in stack.images.values():
            self.docker.run(["docker", "tag", image["id"], image["ref"]])
        args = ["docker", "compose", "--project-name", stack.project]
        for compose_file in stack.compose_files:
            args += ["-f", compose_file]
        # --no-deps: the services' dependencies include migration and seed
        # one-shots, which must not run against the restored data.
        up = [*args, "up", "-d", "--no-deps", "--pull", "never"]
        self.docker.run([*up, "postgres-db"], cwd=Path(stack.digit_dir))
        self.docker.wait_for_postgres()
        if check_database:
            check_database()  # before any application can write
        self.docker.run([*up, *(s for s in stack.services if s != "postgres-db")], cwd=Path(stack.digit_dir))

    def cleanup_clone(self) -> None:
        """Remove what a killed prediction left: a copy of the production database."""
        for kind in ("container", "network"):
            ids = self.docker.run(["docker", kind, "ls", "-q", *(["-a"] if kind == "container" else []),
                                   "--filter", f"label={CLONE_LABEL}"], check=False).stdout.split()
            if ids:
                self.docker.run(["docker", kind, "rm", *(["-f"] if kind == "container" else []), *ids], check=False)
        images = self.docker.run(["docker", "images", "-q", "--filter", "reference=digit-upgrade-mdms"],
                                 check=False).stdout.split()
        if images:
            self.docker.run(["docker", "image", "rm", "-f", *images], check=False)

    def rollback(self, backup: Path, stack: StackRecord, reason: str) -> None:
        with signals_ignored():
            self.journal.enter("rolling-back", rollback_reason=reason)
            try:
                self._rollback(backup, stack)
            except Exception as exc:
                self.journal.enter("rollback-failed", rollback_error=str(exc))
                raise UpgradeError(
                    f"ROLLBACK FAILED: {exc}. Public web traffic stays refused (iptables rule "
                    f"'{MAINTENANCE_TAG}'). Everything needed for a manual restore is in {backup} "
                    f"(stack.json lists what ran). Original failure: {reason}"
                ) from exc
            self.journal.enter("rolled-back")
            Maintenance(stack.public_ports, self.docker.run).off()

    def _rollback(self, backup: Path, stack: StackRecord) -> None:
        self.log(f"rolling back from {backup}")
        running = self.docker.project_containers(stack.project)
        if running:
            self.docker.run(["docker", "stop", "--time", "60", *running])
        suffix = stamp()
        restore_targets = [(Path(stack.digit_dir), backup / "digit.tar.zst")]
        restore_targets += [
            (Path(p), backup / "host" / f"{p.strip('/').replace('/', '_')}.tar.zst") for p in stack.host_paths
        ]
        for path, archive in restore_targets:
            if path.exists():
                path.rename(path.with_name(f"{path.name}.failed-{suffix}"))
            run(["tar", "--zstd", "-xpf", str(archive), "-C", str(path.parent)])
        for volume in stack.volumes:
            mountpoint = self._mountpoint(volume)
            for child in mountpoint.iterdir():
                shutil.rmtree(child) if child.is_dir() and not child.is_symlink() else child.unlink()
            # Archived as <mountpoint>/_data; extract its contents back in place.
            run(["tar", "--zstd", "-xpf", str(backup / "volumes" / f"{volume}.tar.zst"), "-C", str(mountpoint),
                 "--strip-components=1"])
        if deploy_state.analysed_files(stack.digit_dir) != stack.analysed_files:
            raise UpgradeError(f"restored {stack.digit_dir} differs from the backup")

        def check_database() -> None:
            before = mdms.index(read_json(backup / "mdms-before.json"))
            if mdms.summary(before) != mdms.summary(self.docker.snapshot(stack.mdms_tables)):
                raise UpgradeError("restored MDMS rows differ from the backup")

        self._start_previous(stack, check_database)
        if shutil.which("nginx"):
            run(["nginx", "-t"])
            run(["systemctl", "reload", "nginx"], check=False)
        write_json(backup / "rollback-report.json", {"status": "ROLLED_BACK", "at": utc_now(), "failed_trees_suffix": suffix})

    # ── orchestration ──────────────────────────────────────────────────────

    def execute(self) -> dict[str, Any]:
        with exclusive_lock(), signals_raise():
            if self.journal and self.journal.phase not in (None, "aborted", "rolled-back"):
                raise UpgradeError(
                    f"a previous deploy of this run ended in phase '{self.journal.phase}'"
                    + ("; recover with: digit-upgrade rollback " + str(self.run_dir) if self.journal.phase not in FINAL else "")
                )
            self.dir.mkdir(mode=0o700, exist_ok=True)
            self.journal = Journal(self.dir)
            log_file = self.dir / "deploy.log"
            try:
                return self._execute(log_file)
            finally:
                shutil.rmtree(self.dir / "overlay", ignore_errors=True)  # unredacted secrets

    def _execute(self, log_file: Path) -> dict[str, Any]:
        # The scratch tree holds unredacted renders; it lives only as long as preflight.
        with tempfile.TemporaryDirectory(prefix="digit-upgrade-preflight-") as scratch:
            plan = self.preflight(Path(scratch))
        stack = plan["stack"]
        maintenance = Maintenance(stack.public_ports, self.docker.run)
        self.journal.enter("preflight-passed", stack=asdict(stack))
        maintenance.on()
        self.log(f"maintenance: public web traffic on ports {stack.public_ports} is refused until the end")
        try:
            backup = self.backup(stack)
            predicted, keep = self.predict(backup, stack)
        except BaseException:
            with signals_ignored():
                self.restart_previous(stack)
                self.cleanup_clone()
                self.journal.enter("aborted")
                maintenance.off()
            raise
        try:
            self.deploy(plan["overlay"], plan["deleted"], keep, log_file)
            mdms_result = self.verify(stack, plan["overlay"], plan["deleted"], predicted, keep)
        except BaseException as exc:
            self.rollback(backup, stack, str(exc) or type(exc).__name__)
            raise UpgradeError(f"the deploy failed and the previous version was restored: {exc}") from exc
        with signals_ignored():  # the deploy succeeded; finish recording it whatever arrives now
            report = {
                "status": "DEPLOYED", "at": utc_now(), "backup": str(backup),
                "target_commit": self.manifest["target_commit"],
                "carried_changes": len(self.manifest["deployment_changes"]),
                "secret_conflicts_kept_live": plan["restore_conflicts"],
                "mdms": mdms_result,
            }
            write_json(self.dir / "deployment-report.json", report)
            self.manifest["deployed"] = True
            write_json(self.run_dir / "run.json", self.manifest)
            self.journal.enter("deployed")
            maintenance.off()
        return report

    def recover(self) -> str:
        """Finish an interrupted deploy: restart or roll back, as its phase requires."""
        with exclusive_lock(), signals_ignored():
            phase = self.journal.phase if self.journal else None
            if phase is None or "stack" not in self.journal.state:
                return f"nothing to recover (phase: {phase or 'none'})"
            stack = StackRecord(**self.journal.state["stack"])
            backup = Path(self.journal.state["backup"]) if "backup" in self.journal.state else None
            if backup and (backup / "stack.json").exists():
                stack = StackRecord(**read_json(backup / "stack.json"))
            shutil.rmtree(self.dir / "overlay", ignore_errors=True)
            self.cleanup_clone()
            maintenance = Maintenance(stack.public_ports, self.docker.run)
            if phase in FINAL or phase == "preflight-passed":
                maintenance.off()
                return f"nothing to roll back (phase: {phase}); maintenance lifted"
            if phase in RECOVERABLE_BY_RESTART:
                self.restart_previous(stack)
                self.journal.enter("aborted")
                maintenance.off()
                return "the previous stack was restarted; nothing had been changed"
            self.rollback(backup, stack, f"recovery of an interrupted deploy (phase {phase})")
            return f"rolled back to the backup in {backup}"
