"""Analysis and conflict resume: read-only with respect to the deployment.

Neither starts a container, contacts OpenBao or a database, nor writes to
/opt/digit.  Output goes to a new run directory:

    run.json            inputs, commits, renderers, tree hashes, status
    report.json / .md   what changed locally, conflicts, secret findings
    local-changes.patch the operator's changes (base → live), redacted
    workspace/          Git repository of the merge (resolve conflicts here)
    candidate/          target + local changes, redacted; only when READY
"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

from . import merge, render
from .common import NeedsOperator, UpgradeError, read_json, run, run_streaming, sha256_file, stamp, utc_now, write_json
from .redaction import is_secret_key, redact_structure, values_in_structure
from .trees import leaks, prepare

READY = "READY"
RENDERED_BASE_CANDIDATES = 8
CONFLICTS = "CONFLICTS"
SECRET_REVIEW = "SECRET_REVIEW"


def load_yaml(path: Path) -> dict[str, Any]:
    import yaml

    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise UpgradeError(f"cannot read tenant YAML {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise UpgradeError(f"tenant YAML must be a mapping: {path}")
    return value


def base_tenant_vars(tenant_vars: dict[str, Any], overrides: dict[str, Any]) -> dict[str, Any]:
    return {**tenant_vars, **overrides}


def write_yaml(path: Path, value: dict[str, Any]) -> None:
    import yaml

    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        yaml.safe_dump(value, stream, sort_keys=False)


def open_backup(backup: Path, scratch: Path) -> Path:
    """The /opt/digit root inside a backup directory or tar archive."""
    if backup.is_dir():
        return backup
    if not backup.is_file():
        raise UpgradeError(f"backup not found: {backup}")
    if backup.suffix == ".zst":
        # tarfile reads zstd only from Python 3.14.
        plain = scratch.with_name(scratch.name + ".tar")
        run_streaming(["zstd", "-dcq", str(backup)], stdout=plain)
        backup = plain
    render.extract_tar(backup, scratch)
    for candidate in (scratch / "opt" / "digit", scratch / "digit", scratch):
        if candidate.is_dir() and (candidate / "docker-compose.egov-digit.yaml").is_file():
            return candidate
    entries = [p for p in scratch.iterdir() if p.is_dir()]
    if len(entries) == 1 and (entries[0] / "docker-compose.egov-digit.yaml").is_file():
        return entries[0]
    raise UpgradeError("the backup archive does not contain a DIGIT directory (no docker-compose.egov-digit.yaml)")


def deployed_commit(live_root: Path) -> str | None:
    """The commit the drift guard recorded at the box's last successful deploy."""
    manifest = live_root / ".digit-deploy-state" / "manifest.json"
    if not manifest.is_file():
        return None
    value = read_json(manifest)
    return value.get("deployed_commit") if value.get("status") == "complete" else None


def new_run_dir(parent: Path) -> Path:
    parent.mkdir(parents=True, exist_ok=True)
    base = parent / f"digit-upgrade-{stamp()}"
    candidate, counter = base, 1
    while candidate.exists():
        candidate, counter = Path(f"{base}-{counter}"), counter + 1
    candidate.mkdir(mode=0o700)
    return candidate


def analyse(
    *,
    repo: Path,
    target_ref: str,
    base_ref: str | None,
    tenant: str,
    tenant_vars: Path,
    base_overrides: dict[str, Any],
    backup: Path,
    output: Path,
    excludes: tuple[str, ...],
) -> Path:
    """Run the analysis; return the run directory.  Raises NeedsOperator when not READY."""
    repo = repo.resolve()
    tenant_values = load_yaml(tenant_vars)
    secret_overrides = sorted(key for key in base_overrides if is_secret_key(key))
    if secret_overrides:
        raise UpgradeError(f"--base-override cannot set secrets: {', '.join(secret_overrides)}")
    target_commit = render.resolve_commit(repo, target_ref)

    output.mkdir(parents=True, exist_ok=True)
    # Holds unredacted renders and the backup: private, and removed on exit.
    with tempfile.TemporaryDirectory(prefix=".digit-upgrade-scratch-", dir=output) as scratch_name:
        scratch = Path(scratch_name)
        live_root = open_backup(backup.resolve(), scratch / "backup")
        recorded = deployed_commit(live_root)
        if base_ref is None and recorded is None:
            raise UpgradeError(
                "the backup has no record of the deployed commit (boxes deployed before the drift "
                "guard): give --base-ref, or --base-ref auto to find it from the files on the box"
            )
        base_ref_source = "deploy-state" if base_ref is None else "auto" if base_ref == "auto" else "argument"

        base_values = base_tenant_vars(tenant_values, base_overrides)
        base_vars = scratch / "base-tenant-vars.yml"
        write_yaml(base_vars, base_values)
        raw = {"live": live_root}
        renderers = {}
        base_selection = None
        if base_ref_source == "auto":
            base_commit, raw["base"], renderers["base"], base_selection = _find_base(
                repo, live_root, target_commit, tenant, base_vars, scratch, excludes)
            base_ref = base_commit
        else:
            base_ref = base_ref or recorded
            base_commit = render.resolve_commit(repo, base_ref)
            source = scratch / "base-source"
            render.export_commit(repo, base_commit, source)
            raw["base"] = scratch / "base-render"
            renderers["base"] = render.render(source, tenant, base_vars, raw["base"], allow_legacy=True)
        source = scratch / "target-source"
        render.export_commit(repo, target_commit, source)
        render.preflight(source, tenant_vars)
        raw["target"] = scratch / "target-render"
        renderers["target"] = render.render(source, tenant, tenant_vars, raw["target"], allow_legacy=False)

        known = values_in_structure(tenant_values) | values_in_structure(base_values)
        prepared = prepare(raw, scratch / "normalized", known_secrets=known, excludes=excludes)

        run_dir = new_run_dir(output)
        result = merge.merge(prepared.normalized, run_dir / "workspace")
        patch = merge.git(run_dir / "workspace", "diff", "--binary", "base", "live").stdout
        (run_dir / "local-changes.patch").write_text(patch, encoding="utf-8")
        if not result.conflicts:
            merge.export_worktree(run_dir / "workspace", run_dir / "candidate")

        if base_overrides:
            write_json(run_dir / "base-overrides.json", base_overrides)
        status = CONFLICTS if result.conflicts else SECRET_REVIEW if prepared.secrets["blocker_count"] else READY
        manifest = {
            "created_at": utc_now(),
            "tool_commit": _tool_commit(),
            "tenant": tenant,
            "tenant_vars_sha256": sha256_file(tenant_vars),
            "base_ref": base_ref,
            "base_commit": base_commit,
            "base_ref_source": base_ref_source,
            "base_selection": base_selection,
            "base_overrides": redact_structure(base_overrides),
            "target_ref": target_ref,
            "target_commit": target_commit,
            "renderers": renderers,
            "excludes": list(excludes),
            "tree_hashes": prepared.hashes,
            "status": status,
            "local_changes": result.local_changes,
            "conflicts": result.conflicts,
            "workspace_stage0": result.stage0,
            "deployment_changes": result.deployment_changes,
            "secrets": prepared.secrets,
            "secret_review_acknowledged": False,
            "deployed": False,
        }
        write_json(run_dir / "run.json", manifest)
        write_report(run_dir, manifest)

        found = leaks(run_dir, prepared.redactor.values)
        if found:
            shutil.rmtree(run_dir)
            raise UpgradeError(
                "safety audit: secret values reached the analysis output in "
                + ", ".join(found) + "; the run directory was removed"
            )
    _require_ready(run_dir, manifest)
    return run_dir


def _changed_lines(a: Path, b: Path) -> int:
    """Lines added or removed between two versions of a file (an absent file is empty)."""
    import difflib

    def lines(path: Path) -> list[str]:
        if not path.is_file() or path.is_symlink():
            return []
        data = path.read_bytes()
        return data.decode("utf-8", "replace").splitlines() if b"\0" not in data[:8192] else [data.hex()]

    return sum(1 for line in difflib.unified_diff(lines(a), lines(b), lineterm="", n=0)
               if line[:1] in "+-" and not line.startswith(("+++", "---")))


def _find_base(repo: Path, live_root: Path, target_commit: str, tenant: str, base_vars: Path, scratch: Path,
               excludes: tuple[str, ...]) -> tuple[str, Path, str, dict[str, Any]]:
    """The deployed commit, found from the box: blob-matching shortlist, then the closest render."""
    import deploy_state

    tied = render.base_candidates(repo, live_root, until=target_commit)
    live = deploy_state.analysed_files(str(live_root), excludes)
    scored = []
    for index, (score, commit) in enumerate(tied[:RENDERED_BASE_CANDIDATES]):
        source, out = scratch / f"base-candidate-{index}-source", scratch / f"base-candidate-{index}"
        render.export_commit(repo, commit, source)
        how = render.render(source, tenant, base_vars, out, allow_legacy=True)
        rendered = deploy_state.analysed_files(str(out), excludes)
        differing = sorted(rel for rel in set(live) | set(rendered) if live.get(rel) != rendered.get(rel))
        lines = sum(_changed_lines(live_root / rel, out / rel) for rel in differing)
        scored.append({"commit": commit, "verbatim_score": score, "differing_files": len(differing),
                       "differing_lines": lines, "how": how, "out": out})
        if not differing:
            break
    # The render closest to the box, by how much differs; the newest commit on a tie.
    best = min(scored, key=lambda item: item["differing_lines"])
    selection = {
        "method": "auto",
        "candidates": [{k: v for k, v in item.items() if k not in ("out", "how")} for item in scored],
        # More commits matched equally than were rendered, and none rendered exactly as the box.
        "uncertain": len(tied) > len(scored) and best["differing_lines"] > 0,
    }
    return best["commit"], best["out"], best["how"], selection


def resume(run_dir: Path, *, acknowledge_secret_review: bool) -> Path:
    """Finish a run after the operator resolved conflicts and/or reviewed secrets."""
    run_dir = run_dir.resolve()
    manifest = read_json(run_dir / "run.json")
    if manifest["status"] == CONFLICTS:
        workspace = run_dir / "workspace"
        manifest["deployment_changes"] = merge.conclude(workspace, manifest["conflicts"], manifest["workspace_stage0"])
        merge.export_worktree(workspace, run_dir / "candidate")
        manifest["resolved_conflicts"] = manifest["conflicts"]
        manifest["conflicts"] = []
        manifest["status"] = SECRET_REVIEW if manifest["secrets"]["blocker_count"] else READY
    if manifest["status"] == SECRET_REVIEW and acknowledge_secret_review:
        manifest["secret_review_acknowledged"] = True
        manifest["status"] = READY
    manifest["resumed_at"] = utc_now()
    write_json(run_dir / "run.json", manifest)
    write_report(run_dir, manifest)
    _require_ready(run_dir, manifest)
    return run_dir


def _require_ready(run_dir: Path, manifest: dict[str, Any]) -> None:
    if manifest["status"] == CONFLICTS:
        raise NeedsOperator(
            f"{len(manifest['conflicts'])} file(s) conflict with the target version. Resolve them in "
            f"{run_dir / 'workspace'} (git status; edit; git add / git rm), then run: "
            f"digit-upgrade resume {run_dir}"
        )
    if manifest["status"] == SECRET_REVIEW:
        raise NeedsOperator(
            f"{manifest['secrets']['blocker_count']} secret field(s) were changed both locally and by the "
            f"target version; see {run_dir / 'report.md'}. Deployment keeps the live value for each. "
            f"Accept that with: digit-upgrade resume {run_dir} --acknowledge-secret-review"
        )


def _tool_commit() -> str | None:
    result = run(["git", "rev-parse", "HEAD"], cwd=render.TOOL_ROOT, check=False)
    return result.stdout.strip() or None


def write_report(run_dir: Path, manifest: dict[str, Any]) -> None:
    report = {key: manifest[key] for key in (
        "status", "base_ref", "base_commit", "target_ref", "target_commit", "renderers",
        "local_changes", "conflicts", "deployment_changes", "secrets",
    )}
    write_json(run_dir / "report.json", report)
    secrets = manifest["secrets"]
    out = [
        "# DIGIT upgrade analysis",
        "",
        f"**Status: {manifest['status']}**",
        "",
        f"- Base: `{manifest['base_ref']}` → `{manifest['base_commit']}` (rendered by: {manifest['renderers']['base']})",
        f"- Target: `{manifest['target_ref']}` → `{manifest['target_commit']}`",
        f"- Local changes: **{len(manifest['local_changes'])}**",
        f"- Conflicts: **{len(manifest['conflicts'])}**",
        f"- Secret fields changed locally and by the target: **{secrets['blocker_count']}**"
        + (" (acknowledged: live values are kept)" if manifest["secret_review_acknowledged"] else ""),
        f"- Secret fields changed locally only: **{secrets['warning_count']}**",
        "",
    ]
    if manifest.get("base_selection"):
        out += ["The base was found from the files on the box (--base-ref auto); candidates, closest first:", ""]
        out += [
            f"- `{c['commit'][:12]}`: {c['verbatim_score']} verbatim files matched; its render differs "
            f"from the box in {c['differing_files']} files, {c['differing_lines']} lines"
            for c in sorted(manifest["base_selection"]["candidates"], key=lambda c: c["differing_lines"])
        ]
        if manifest["base_selection"]["uncertain"]:
            out += ["", "> **Uncertain:** more commits matched the box equally well than were rendered, and none",
                    "> rendered exactly as the box. Confirm the deployed commit and pass it with --base-ref."]
        out.append("")
    if manifest["renderers"]["base"] == render.GRAFTED:
        out += [
            "> The base version predates the render contract, so it was rendered by the legacy",
            "> v2.12 renderer. Review the local changes below: a difference the legacy renderer",
            "> does not reproduce shows up as a local change.",
            "",
        ]
    sections = (
        ("Conflicts", [f"- `{path}`" for path in manifest["conflicts"]]),
        ("Local changes", [f"- {c['status']} `{c['path']}`" for c in manifest["local_changes"]]),
        ("Secret findings", [
            f"- `{f['path']}` `{f['field']}`: {f['change']} ({f['severity']})" for f in secrets["findings"]
        ]),
    )
    for title, items in sections:
        if items:
            out += [f"## {title}", "", *items, ""]
    out += [
        "Secret values and fingerprints are never written. Nothing was deployed, and",
        "no container, database or OpenBao was contacted.",
        "",
    ]
    (run_dir / "report.md").write_text("\n".join(out), encoding="utf-8")
