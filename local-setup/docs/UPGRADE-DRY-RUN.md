# DIGIT upgrade rebase dry run

This analyser answers two questions without changing a deployment:

1. What is different between the clean base release and the supplied
   `/opt/digit` backup?
2. Can those local changes be rebased onto the target release without a
   conflict?

It never runs `deploy.sh`, starts containers, contacts OpenBao, connects to a
database, or writes to live `/opt/digit`.

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
deployed.

## Renderer maintenance

`local-setup/ansible/playbook-render.yml` is deliberately separate from the
production playbook. It may only copy, template, or rewrite files below its
temporary `render_dir`. When a production playbook gains a deterministic
`/opt/digit` write, update the renderer and its contract test in
`local-setup/tests/test_upgrade_dry_run.py`. Unknown deployment destinations
fail closed until renderer coverage is added.
