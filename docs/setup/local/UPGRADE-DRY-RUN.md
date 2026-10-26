# DIGIT upgrade rebase and guarded deployment

This analyser answers two questions without changing a deployment:

1. What is different between the clean base release and the supplied
   `/opt/digit` backup?
2. Can those local changes be rebased onto the target release without a
   conflict?

Analysis and resume never run `deploy.sh`, start containers, contact OpenBao,
connect to a database, or write to live `/opt/digit`. Deployment is a separate,
explicit command available only after a candidate is ready.

## Prerequisites

- A local Git checkout containing both references. Fetch them before running;
  the analyser never fetches or switches branches.
- Python 3, Git, `ansible-playbook`, and PyYAML.
- The tenant YAML used for the deployed environment.
- A read-only `/opt/digit` backup, supplied as a directory or tar archive.

## Run

```bash
python3 local-setup/scripts/upgrade-dry-run.py \
  --repo /path/to/Citizen-Complaint-Resolution-System \
  --base-ref v2.12-beta \
  --target-ref master \
  --tenant mycity \
  --tenant-vars /secure/path/mycity.yml \
  --base-override enable_novu=false \
  --backup /path/to/opt-digit-backup.tar.gz \
  --output /path/to/dry-run-output
```

The analyser resolves both references to commit SHAs before doing any work.
Therefore `master` means one exact commit for that run, even if the branch
moves later.

## Result

- Exit `0`: the local changes rebased cleanly and a candidate was created.
- Exit `2`: rebase or secret conflicts were found; no candidate was created.
  Rebase conflicts leave a persistent `resolution-workspace/` in the run
  directory.
- Exit `1`: invalid input, unsupported layout, render failure, or internal
  error.

Each run creates a timestamped directory. Start with `report.md`, then use
`report.json` and `run-manifest.json` for automation. `candidate/`
contains the target render plus all rebased local edits.
`conflicts/` contains safe conflict markers and metadata. The sanitized local
change bundle is in `local-changes.patch`, `local-files/`, and
`deletions.json`.

## Resolve and resume

When the initial run reports rebase conflicts, it preserves the real Git
rebase state in `<run>/resolution-workspace/repository`. This is a sanitized
copy; live `/opt/digit` remains untouched.

```bash
cd /path/to/dry-run-output/digit-dry-run-*/resolution-workspace/repository
git status

# Edit every unmerged file, choosing or combining the target and local sides.
git add path/to/resolved-file
# Use git rm for a resolution that deletes a file.
```

Do not run `git rebase --continue` manually. After every conflict is resolved
and staged, let the analyser validate the workspace and continue the rebase:

```bash
python3 local-setup/scripts/upgrade-dry-run.py \
  --resume-workspace \
  /path/to/dry-run-output/digit-dry-run-*/resolution-workspace
```

If the original report contains secret blockers, the first resume attempt
stops and asks for an explicit acknowledgement. After confirming that the
candidate remains redacted and runtime secrets will be restored through the
deployment secret mechanism, rerun with:

```bash
python3 local-setup/scripts/upgrade-dry-run.py \
  --resume-workspace \
  /path/to/dry-run-output/digit-dry-run-*/resolution-workspace \
  --acknowledge-secret-review
```

Resume rejects unresolved markers, unstaged resolutions, changes outside the
original local-change set, and newly introduced secret-like values. On success
it creates `candidate/`, updates the report and manifest, and keeps the
resolution history for audit. It still does not deploy or replace
`/opt/digit`.

The analyser excludes `.openbao`, caches, logs, temporary results, downloaded
OpenTelemetry binaries, and `db/full-dump.sql` from configuration overlays.
Secret-like fields in text, YAML, JSON, and `.env` content are replaced with
`<REDACTED>` before diffing or writing output.

Use repeatable `--exclude GLOB` arguments for environment-specific generated
paths. Effective exclusions and resolved commit SHAs are recorded in
`run-manifest.json`. The candidate is sanitized analysis output and must not be
copied directly to `/opt/digit`.

## Guarded deployment

Run deployment on the DIGIT server from a clean checkout whose `HEAD` is the
exact `target_commit` recorded in `run-manifest.json`. The tenant YAML in
`inventory/host_vars/<tenant>.yml` must exactly match `--tenant-vars`.

Live `/opt/digit` must also still match the analysed backup for every locally
changed path. If a file was edited, a secret rotated, or a deleted file
recreated after the backup was taken, deployment stops before anything is
backed up or stopped and lists the affected paths. Take a fresh backup and
re-run the analysis so those changes are carried into the candidate. Secret
values in the candidate are restored from live `/opt/digit` first.

```bash
sudo python3 local-setup/scripts/upgrade-dry-run.py \
  --deploy-run /path/to/dry-run-output/digit-dry-run-YYYYMMDD-HHMMSS \
  --repo /path/to/Citizen-Complaint-Resolution-System \
  --tenant mycity \
  --tenant-vars /path/to/Citizen-Complaint-Resolution-System/local-setup/ansible/inventory/host_vars/mycity.yml \
  --backup /var/backups/digit/digit \
  --backup-dir /var/backups/digit-upgrade \
  --confirm-deploy
```

This command is intentionally separate from analysis/resume. It enters a
maintenance window, stops application writers, and creates all of the
following before deployment:

- PostgreSQL custom-format and globals dumps, verified with `pg_restore`;
- deterministic row counts and SHA-256 fingerprints for `eg_mdms_data`,
  `eg_mdms_schema_definition`, and `eg_config_data`;
- a dedicated MDMS/config archive and per-file hashes;
- a cold `/opt/digit` archive and cold archives of every Compose volume,
  including anonymous volumes.

The target MDMS migrations run first against an isolated clone of the backup.
An update or deletion of an existing MDMS/config-service row is reported as a
conflict and production is restarted unchanged. Review the sanitized
`mdms-conflicts.json`, edit the generated `mdms-resolution.json` so every value
is either `backup` or `target`, then rerun explicitly:

```bash
sudo python3 local-setup/scripts/upgrade-dry-run.py \
  --deploy-run /path/to/dry-run-output/digit-dry-run-YYYYMMDD-HHMMSS \
  --repo /path/to/Citizen-Complaint-Resolution-System \
  --tenant mycity \
  --tenant-vars /path/to/Citizen-Complaint-Resolution-System/local-setup/ansible/inventory/host_vars/mycity.yml \
  --backup /var/backups/digit/digit \
  --backup-dir /var/backups/digit-upgrade \
  --mdms-resolution /path/to/dry-run-output/digit-dry-run-YYYYMMDD-HHMMSS/mdms-resolution.json \
  --confirm-deploy
```

Upgrade mode invokes the normal `deploy.sh` procedure with a gated
`upgrade_safe_mode=true` overlay. It preserves the established PostgreSQL data
mount, removes the fast-path dump initializer, disables compose/API seed jobs,
restores secrets through the existing OpenBao path, and still runs versioned
database migrations and normal health checks. A normal `./deploy.sh <tenant>`
does not enable any of these upgrade-only branches.

After startup the command requires the resolved MDMS counts/checksums and every
protected local configuration hash to match. Any deployment, health, MDMS, or
configuration failure stops the new stack, restores `/opt/digit` and every
captured volume, starts the previous service set, and verifies the original
MDMS and configuration fingerprints. A failed rollback leaves an explicit
error and preserves the backup for manual recovery.

## Normal deploys refuse to overwrite hand edits

Every successful `./deploy.sh <tenant>` records SHA-256 hashes of the protected
configuration under `/opt/digit/.digit-deploy-state/`. The protected set is
`configs/`, `kong/`, `nginx/`, `seeds/`, `notification-seed/`, and the
top-level `docker-compose.*.yml` files. The next deploy compares them before it
writes anything. If any protected file was modified, added, or removed on the
server, the deploy stops and lists them instead of silently replacing them.

- To keep the edits, carry them forward with the analysis and guarded
  deployment described above.
- To discard them, rerun with `./deploy.sh <tenant> -e allow_local_drift=true`.

The first deploy after this change has no baseline, so it only reports that
and records one. If the previous deploy did not finish, its partial writes
cannot be told apart from hand edits, so the guard reports that and records a
fresh baseline. The guarded upgrade verifies local changes itself and skips
this check. The state directory is excluded from upgrade analysis.

## Renderer maintenance

`local-setup/ansible/playbook-render.yml` is deliberately separate from the
production playbook. It may only copy, template, or rewrite files below its
temporary `render_dir`. When a production playbook gains a deterministic
`/opt/digit` write, update the renderer and its contract test in
`local-setup/tests/test_upgrade_dry_run.py`. Unknown deployment destinations
fail closed until renderer coverage is added.
