# DIGIT upgrade dry run

This analyser answers two questions without changing a deployment:

1. What is different between the clean current release and the supplied
   `/opt/digit` backup?
2. Which of those local changes can be carried onto the target release, and
   which ones conflict?

It also compares the two repository MDMS baselines. It never runs `deploy.sh`,
starts containers, contacts OpenBao, or connects to a database.

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
  --current-ref v2.12-beta \
  --target-ref master \
  --tenant mycity \
  --tenant-vars /secure/path/mycity.yml \
  --backup /path/to/opt-digit-backup.tar.gz \
  --output /path/to/dry-run-output
```

The analyser resolves both references to commit SHAs before doing any work.
Therefore `master` means one exact commit for that run, even if the branch
moves later.

## Result

- Exit `0`: no configuration conflicts and no MDMS changes.
- Exit `2`: configuration conflicts or MDMS changes; deployment is blocked.
- Exit `1`: invalid input, unsupported layout, render failure, or internal
  error.

Each run creates a timestamped directory. Start with `report.md`, then use
`report.json` and `run-manifest.json` for automation. `merged-candidate/`
contains the target render plus every non-conflicting local edit.
`conflicts/` contains safe conflict markers and metadata. The sanitized local
change bundle is in `local-changes.patch`, `local-files/`, and
`deletions.json`.

The analyser excludes `.openbao`, caches, logs, temporary results, downloaded
OpenTelemetry binaries, and `db/full-dump.sql` from configuration overlays.
The SQL dump is read directly from each Git reference only for the MDMS gate.
Secret-like fields in text, YAML, JSON, and `.env` content are replaced with
`<REDACTED>` before diffing or writing output.

## Renderer maintenance

`local-setup/ansible/playbook-render.yml` is deliberately separate from the
production playbook. It may only copy, template, or rewrite files below its
temporary `render_dir`. When a production playbook gains a deterministic
`/opt/digit` write, update the renderer and its contract test in
`local-setup/tests/test_upgrade_dry_run.py`. Unknown current baselines fail
closed until a compatibility profile is added.
