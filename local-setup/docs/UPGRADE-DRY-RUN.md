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
- Exit `1`: invalid input, unsupported layout, render failure, or internal
  error.

Each run creates a timestamped directory. Start with `report.md`, then use
`report.json` and `run-manifest.json` for automation. `candidate/`
contains the target render plus all rebased local edits.
`conflicts/` contains safe conflict markers and metadata. The sanitized local
change bundle is in `local-changes.patch`, `local-files/`, and
`deletions.json`.

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
