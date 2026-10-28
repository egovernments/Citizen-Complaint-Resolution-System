"""digit-upgrade: carry local /opt/digit changes onto a new DIGIT version, safely.

    digit-upgrade analyse ...      what changed locally, and does it merge?
    digit-upgrade resume RUN       after resolving conflicts in RUN/workspace
    digit-upgrade deploy RUN       guarded deployment with backup and rollback
    digit-upgrade rollback RUN     recover an interrupted deploy

Exit status: 0 done, 2 waiting for an operator decision, 1 error.
See docs/setup/local/UPGRADE.md.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from .common import NeedsOperator, UpgradeError, read_json, stamp, utc_now, write_json

UNIT_ENV = "DIGIT_UPGRADE_UNIT"


def parse_override(raw: str) -> tuple[str, Any]:
    import yaml

    key, separator, value = raw.partition("=")
    if not separator or not key.isidentifier():
        raise argparse.ArgumentTypeError(f"expected TOP_LEVEL_KEY=YAML_VALUE, got {raw!r}")
    try:
        return key, yaml.safe_load(value)
    except yaml.YAMLError as exc:
        raise argparse.ArgumentTypeError(f"invalid YAML value in {raw!r}: {exc}") from exc


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="digit-upgrade", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)

    a = commands.add_parser("analyse", help="analyse a backup against a target version (read-only)")
    a.add_argument("--repo", type=Path, required=True, help="Git checkout holding both versions (fetched)")
    a.add_argument("--target-ref", required=True, help="version to upgrade to")
    a.add_argument("--base-ref", help="version the box runs (default: recorded by its last deploy)")
    a.add_argument("--tenant", required=True)
    a.add_argument("--tenant-vars", type=Path, required=True, help="the tenant's host_vars YAML")
    a.add_argument("--backup", type=Path, required=True, help="copy of /opt/digit: directory or tar archive")
    a.add_argument("--output", type=Path, required=True, help="directory for run directories")
    a.add_argument("--base-override", type=parse_override, action="append", default=[], metavar="KEY=YAML",
                   help="tenant variable as it was when the base version was deployed (repeatable)")
    a.add_argument("--exclude", action="append", default=[], metavar="GLOB",
                   help="also ignore matching paths (fnmatch on the /opt/digit-relative path; repeatable)")

    r = commands.add_parser("resume", help="finish a run after resolving conflicts or reviewing secrets")
    r.add_argument("run", type=Path)
    r.add_argument("--acknowledge-secret-review", action="store_true",
                   help="keep the live value for every secret changed both locally and by the target")

    d = commands.add_parser("deploy", help="deploy a READY run (root, on the DIGIT server)")
    d.add_argument("run", type=Path)
    d.add_argument("--confirm", action="store_true", required=True,
                   help="required: the deploy takes the site into maintenance")
    d.add_argument("--backup-dir", type=Path, default=Path("/var/backups/digit-upgrade"))
    d.add_argument("--mdms-resolution", type=Path, help="choices for the MDMS conflicts of a previous attempt")
    d.add_argument("--foreground", action="store_true", help="do not detach into a systemd unit")

    b = commands.add_parser("rollback", help="recover an interrupted deploy (root, on the DIGIT server)")
    b.add_argument("run", type=Path)
    b.add_argument("--foreground", action="store_true", help="do not detach into a systemd unit")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "analyse":
            from .analyse import analyse

            run_dir = analyse(
                repo=args.repo, target_ref=args.target_ref, base_ref=args.base_ref, tenant=args.tenant,
                tenant_vars=args.tenant_vars, base_overrides=dict(args.base_override), backup=args.backup,
                output=args.output, excludes=tuple(args.exclude),
            )
            print(f"READY: {run_dir}\nreport: {run_dir / 'report.md'}")
            return 0
        if args.command == "resume":
            from .analyse import resume

            run_dir = resume(args.run, acknowledge_secret_review=args.acknowledge_secret_review)
            print(f"READY: {run_dir}")
            return 0
        if not args.foreground and UNIT_ENV not in os.environ and shutil.which("systemd-run"):
            return detach(args)
        return run_on_server(args)
    except NeedsOperator as exc:
        print(f"ACTION NEEDED: {exc}", file=sys.stderr)
        return 2
    except UpgradeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


def run_on_server(args: argparse.Namespace) -> int:
    from .deploy import Deployment

    log_dir = args.run.resolve() / "deploy"
    log_dir.mkdir(mode=0o700, exist_ok=True)
    log_file = log_dir / "deploy.log"

    def log(message: str) -> None:
        line = f"[{utc_now()}] {message}"
        print(line, flush=True)
        with log_file.open("a", encoding="utf-8") as stream:
            stream.write(line + "\n")

    code, message = 0, ""
    try:
        deployment = Deployment(
            args.run, backup_parent=getattr(args, "backup_dir", Path("/var/backups/digit-upgrade")),
            resolution=getattr(args, "mdms_resolution", None), log=log,
        )
        if args.command == "deploy":
            report = deployment.execute()
            message = f"DEPLOYED. Backup: {report['backup']}. Report: {log_dir / 'deployment-report.json'}"
        else:
            message = deployment.recover()
    except NeedsOperator as exc:
        code, message = 2, f"ACTION NEEDED: {exc}"
    except Exception as exc:  # an operational tool must report, never traceback silently
        code, message = 1, f"ERROR: {exc}"
    log(message)
    write_json(log_dir / "exit.json", {"code": code, "message": message, "at": utc_now()})
    return code


def detach(args: argparse.Namespace) -> int:
    """Run in a transient systemd unit and follow its log.

    A dropped SSH session or closed terminal then only stops the following,
    never the deploy itself.
    """
    log_dir = args.run.resolve() / "deploy"
    log_dir.mkdir(mode=0o700, exist_ok=True)
    (log_dir / "exit.json").unlink(missing_ok=True)
    unit = f"digit-upgrade-{stamp()}"
    passthrough = [f"--setenv={k}={os.environ[k]}" for k in ("PATH", "HOME", "LANG") if k in os.environ]
    command = [
        "systemd-run", f"--unit={unit}", "--collect", "--property=TimeoutStopSec=3h",
        f"--working-directory={Path.cwd()}", f"--setenv={UNIT_ENV}={unit}",
        f"--setenv=PYTHONPATH={Path(__file__).resolve().parents[1]}", *passthrough,
        sys.executable, "-m", "digit_upgrade", *sys.argv[1:], "--foreground",
    ]
    subprocess.run(command, check=True)
    print(f"running as systemd unit {unit}; following {log_dir / 'deploy.log'} "
          f"(safe to disconnect: journalctl -fu {unit})")
    return follow(log_dir, unit)


def follow(log_dir: Path, unit: str) -> int:
    log_file, position = log_dir / "deploy.log", 0

    def drain() -> None:
        nonlocal position
        if log_file.exists():
            with log_file.open(encoding="utf-8", errors="replace") as stream:
                stream.seek(position)
                sys.stdout.write(stream.read())
                position = stream.tell()
            sys.stdout.flush()

    while True:
        drain()
        if (log_dir / "exit.json").exists():
            drain()  # the final line is written just before exit.json
            return int(read_json(log_dir / "exit.json")["code"])
        active = subprocess.run(["systemctl", "is-active", "--quiet", unit], check=False).returncode == 0
        if not active and not (log_dir / "exit.json").exists():
            print(f"ERROR: unit {unit} stopped without a result; see journalctl -u {unit}", file=sys.stderr)
            return 1
        time.sleep(2)


if __name__ == "__main__":
    sys.exit(main())
