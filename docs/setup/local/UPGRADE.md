# Upgrading a DIGIT box that has local changes

Servers drift: someone tunes a Kong route, adds a persister config, edits a
Compose override. A plain `./deploy.sh <tenant>` from a newer checkout
re-renders `/opt/digit` and would silently replace those edits. This guide
covers the two mechanisms that prevent that:

- **The deploy guard and local overrides** (every `./deploy.sh`): hand edits
  are detected, and edits you have adopted are re-applied on every deploy.
- **`digit-upgrade`** (`local-setup/scripts/digit-upgrade`): merges your local
  changes onto a new version, lets you resolve conflicts away from the
  production box's maintenance window, and deploys with a full backup,
  verification and automatic rollback.

## What is analysed

The configuration a deploy renders deterministically from the repository and
the tenant's host_vars: `configs/`, `kong/`, `nginx/`, `otel/`, `gatus/`,
`seeds/`, `db/`, `docker/`, `scripts/`, `dataloader/`,
`postman/`, `opensre/`, `configurator-runtime/`, `novu-worker-providers/`, the
top-level `docker-compose.*.yml` files and `identity-keycloak-realm.json`.

Not analysed: `.env` and `.openbao/` (secrets, rebuilt every deploy from
host_vars and OpenBao), `sherlog/` (generated from its image),
`nginx/globalConfigs.js` (chosen at runtime), `notification-seed/` (seeder
input copied from the repository), `otel/targets/`, logs, caches and
`db/full-dump.sql`. Change those through host_vars, not by hand.

The list lives in `local-setup/scripts/deploy_state.py`; the guard and the
upgrade tool share it.

## Every deploy: the guard and local overrides

`./deploy.sh` records the analysed files after each successful deploy, under
`/opt/digit/.digit-deploy-state/`, along with the deployed commit. Before the
next deploy writes anything, it compares:

- **No hand edits:** the deploy proceeds.
- **Hand edits found:** the deploy stops and lists them. Keep them by running
  the upgrade workflow below (the target can be the version already deployed);
  that turns them into local overrides. Or discard them with a full deploy:
  `./deploy.sh <tenant> -e allow_local_drift=true` (a run limited by `--tags`
  does not re-render the files, so it refuses to).

**Local overrides** are edits adopted through `digit-upgrade deploy`. Every
later `./deploy.sh` re-applies them on top of its render, before any container
starts. If a newer version renders an overridden file differently from the
version the override was made against, carrying your copy forward would drop
that version's change, so the deploy stops and puts every analysed file back
exactly as it was before the run (nothing is restarted). Rebase the overrides
with the upgrade workflow, or drop them all and take the new version's files:
`./deploy.sh <tenant> -e drop_local_overrides=true`.

The first deploy after this guard was introduced has no record to compare
against; it says so and records one. A run limited by `--tags` keeps the
previously recorded deployed version.

## The upgrade workflow

Run it on the DIGIT server, from a checkout of the version you are upgrading
**to**, with that tenant's host_vars in
`local-setup/ansible/inventory/host_vars/<tenant>.yml` (`ansible_connection:
local`). Needs Python 3, PyYAML, Git, `rsync`, `zstd`, `iptables`, and the same
Ansible that `deploy.sh` uses, as `scripts/install-prereqs.sh` sets it up (its
modules need the distribution's passlib and bcrypt; a private virtualenv without
them fails part-way through the deploy).

Update the tenant's host_vars for the target version **before** analysing:
the analysis and the deploy run the target's `preflight.py` and refuse what it
refuses, but some requirements are only checked by the playbook itself (in
2.12.x → master, for example, Keycloak and its SMTP settings). Read the target's
`_example.yml` and release notes. A missed one fails the deploy, which then
rolls back cleanly, but costs a maintenance window.

### Release migration guides come first

A release that changes data or configuration in ways a deploy cannot do on its
own ships a migration guide in its release directory, for example the
v2.12 → v2.20 guide (Keycloak and identity) in [`docs/releases/2.20/`](../../releases/2.20/). `digit-upgrade` does not replace it. Use them together:

| Guide section | With `digit-upgrade` |
|---|---|
| Inventory, stop scheduled deploys (§1.1, §1.2) | Do them. |
| Back up (§1.3) | `digit-upgrade deploy` takes and verifies the backup; keep the guide's OpenBao and Keycloak copies too if you want them off the box. |
| Configuration (§2.1, §2.2) | Do them in host_vars **before** analysing. The analysis refuses what the target's preflight refuses; what only the playbook checks (SMTP) is on you. |
| Data at the root tenant (§2.3) | Do them **before** the deploy. Without the roles and role-actions, the identity BFF and the MCP tenant bootstrap get 403s after the upgrade. |
| Deploy, rebuild the MDMS migrations image (§4) | `digit-upgrade deploy` (it rebuilds the migrations image and reruns the migrators). |
| Users, verify (§5, §6) | Do them after the deploy. |
| Rollback (§7) | Automatic; `digit-upgrade rollback` for an interrupted run. It restores the database too, so it does not depend on whether the old services can start on a migrated one. |

### 1. Back up /opt/digit and analyse

```bash
sudo tar --zstd -cpf /var/backups/opt-digit-$(date +%F).tar.zst -C /opt digit

local-setup/scripts/digit-upgrade analyse \
  --repo . \
  --target-ref <commit, tag or branch to deploy> \
  --tenant mytenant \
  --tenant-vars local-setup/ansible/inventory/host_vars/mytenant.yml \
  --backup /var/backups/opt-digit-YYYY-MM-DD.tar.zst \
  --output /var/lib/digit-upgrade/runs
```

Analysis is read-only: no container, database, OpenBao or `/opt/digit` write.

- `--base-ref` is the version the box runs. It defaults to the commit the box's
  last deploy recorded. A box deployed before the guard has no such record:
  give the commit, or `--base-ref auto` to find it from the box itself (the
  commits whose verbatim-copied files match the box best are rendered, and the
  closest render wins; the report lists the candidates). Do not guess: a wrong
  base turns every difference between the two versions into a "local change".
- `--base-override KEY=VALUE` (repeatable): a host_vars value as it was when the
  base version was deployed, if it has changed since (not for secrets).
- `--exclude GLOB` (repeatable): ignore a path, e.g. a generated file specific
  to this box.

Both versions are rendered exactly as their own `deploy.sh` would render them
(versions from v2.12-beta through v2.12.1, which predate the render contract,
are rendered through their own tasks too; the report says so). Your local
changes are the difference between the base render and the backup; they are
merged onto the target render with Git.

The run directory holds `report.md` (start here), `run.json`,
`local-changes.patch`, the merge `workspace/` and, once ready, `candidate/`.
Every secret-looking value is replaced by `<REDACTED>`; the output is safe to
share for review. Exit status: `0` ready, `2` needs you (conflicts or secret
review), `1` error.

### 2. Resolve conflicts (exit 2, status CONFLICTS)

```bash
cd /var/lib/digit-upgrade/runs/digit-upgrade-*/workspace
git status                      # the conflicted files
# edit each one; markers show yours, the base (|||||||) and the target's
git add <file>                  # or: git rm <file>
local-setup/scripts/digit-upgrade resume /var/lib/digit-upgrade/runs/digit-upgrade-…
```

Do not commit yourself; `resume` checks the resolution and commits it. It
refuses leftover markers, unstaged files, changes to any file that did not
conflict, and secret values typed into a file (keep `<REDACTED>`; secrets are
filled in from the server at deploy time).

### 3. Secret review (exit 2, status SECRET_REVIEW)

When a secret field was changed both on the box and by the target version,
`report.md` lists it. Deployment keeps the box's value; if the target moved or
removed that field, so there is nowhere to keep it, the deploy refuses and
says which. Accept keeping the box's values with:

```bash
local-setup/scripts/digit-upgrade resume <run> --acknowledge-secret-review
```

### 4. Deploy

```bash
git checkout <target commit from run.json>   # clean, exactly the analysed commit
sudo local-setup/scripts/digit-upgrade deploy <run> --confirm
```

The deploy runs as a transient systemd unit, so a dropped SSH session does not
stop it; the terminal only follows its log (`<run>/deploy/deploy.log`). In
order:

1. **Preflight, nothing changes.** The checkout is the analysed commit and
   clean; the tenant vars are byte-identical. Both versions are rendered again
   and `/opt/digit` is re-read: all three must hash exactly as analysed, so the
   deploy installs what was reviewed and nothing on the box moved since the
   backup (if it did, the paths are listed: take a new backup and re-analyse).
   Redacted values are filled in from the unredacted trees, each decided like a
   merged line: unchanged on one side means the other side's value wins.
   PostgreSQL's data directory must be on the `postgres_data` named volume and
   the new Compose stack must mount it at the same place; a box still on the
   image's anonymous volume must first follow
   `docs/releases/2.12/operations/postgres-volume-migration.md`.
   Disk space for the backup is checked.
2. **Maintenance and backup.** Public web traffic is refused for the rest of
   the run by a tagged iptables rule on the nginx ports (loopback and SSH stay
   open; an nginx page could not hold, since `deploy.sh` reloads nginx itself).
   Application containers stop, then:
   a `pg_dump` and globals dump, an MDMS snapshot, and cold archives of
   `/opt/digit`, `/etc/nginx`, `/var/www`, `/opt/digit-ui-esbuild` and every
   volume of the running stack, each read back once written. Backups go to
   `--backup-dir` (default `/var/backups/digit-upgrade`).
3. **MDMS prediction.** The target's MDMS migrations and deploy-time MDMS SQL
   run on a clone of the database. A change to an existing row stops the run
   (exit 2) and restarts the old stack untouched; set each entry of
   `<run>/deploy/mdms-resolution.json` to `backup` (keep yours) or `target`,
   then deploy again with `--mdms-resolution <that file>`.
4. **Deploy.** `deploy.sh` in upgrade-safe mode: no fast-path dump, no user,
   API, notification or localization reseeding; migrations, OpenBao and health
   checks run as normal. Your resolved changes become the box's local
   overrides.
5. **Verify.** Every carried change and deletion is in place, and every MDMS
   row you resolved to `backup` holds. Changes the clone did not predict (an
   application updating rows at startup) are listed in
   `deployment-report.json`, not rolled back.

Any failure in 4 or 5, or an interrupt, rolls back: containers stop,
`/opt/digit`, the host paths and every volume are restored, the exact previous
images are re-tagged and started, and the MDMS rows and configuration are
checked against the backup before any application starts. Traffic is let back
in only on success or a verified rollback; if the rollback itself fails, the
site stays closed and the error names the backup to restore from by hand.
A rolled-back run can be deployed again once the cause is fixed.

### Recovering an interrupted deploy

If the process was killed (or the server rebooted) mid-deploy, a new deploy of
that run is refused until it is recovered:

```bash
sudo local-setup/scripts/digit-upgrade rollback <run>
```

It restarts the old stack if nothing had changed yet and rolls back fully
otherwise; it also removes a database clone a killed run left behind and lifts
the maintenance rule.

### Cleaning up after an upgrade

Nothing is deleted automatically. Once the new version is verified and you no
longer need to roll back by hand:

```bash
# Full backups (database dumps, cold archives of /opt/digit, host state and volumes)
ls -dt /var/backups/digit-upgrade/digit-upgrade-*
B=digit-upgrade-YYYYMMDD-HHMMSS        # one you no longer need
sudo rm -rf /var/backups/digit-upgrade/$B
# The images that ran before that upgrade, pinned so a rollback could restart them
docker images --format '{{.Repository}}:{{.Tag}}' | grep "^digit-upgrade-keep/.*:$B$" | xargs -r docker image rm
# Trees a rollback set aside, and old analysis runs (they hold no secrets in clear)
ls -d /opt/digit.failed-* /etc/nginx.failed-* /var/www.failed-* 2>/dev/null
ls -dt /var/lib/digit-upgrade/runs/digit-upgrade-*
```

Each backup is about twice the size of `/opt/digit` plus the stack's volumes; the
deploy refuses to start without that much free space.

## For playbook authors: the render contract

The analysis renders a version by running its own `playbook-deploy.yml` with
`--tags render` into a scratch directory (`playbook-render.yml`). Every task
that writes the analysed configuration must be tagged `render`, must work
without root, Docker, the network or a database, and must depend only on
host_vars and `always` facts. `local-setup/tests/test_render_contract.py`
fails CI when a task touches the analysed configuration without the tag (or
an entry in its `NOT_RENDERED` list saying why), and actually renders the
current version and the v2.12 tags. Deploy-time SQL that writes MDMS rows must
be listed in `digit_upgrade/mdms.py` (`DEPLOY_SQL`) so the upgrade can predict
it; the same test enforces that.
