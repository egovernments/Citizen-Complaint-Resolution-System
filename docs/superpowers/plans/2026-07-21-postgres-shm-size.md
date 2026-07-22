# Postgres `/dev/shm` Sizing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set `shm_size` on the `postgres-db` service in all six Compose files so parallel complaint-list queries stop failing with `could not resize shared memory segment`, and document that a hand-run `docker compose up` gets no log rotation.

**Architecture:** Postgres allocates ~8 MB of dynamic shared memory in `/dev/shm` per parallel query. Docker's default pad is 64 MB, capping every stack at ~8 concurrent parallel queries. The pad is sized from pgbouncer's `DEFAULT_POOL_SIZE`, which bounds concurrency at the database under transaction pooling: `1gb` for the three pool=60 files, `256m` for the three pool=20 files. No new services, no query changes.

**Tech Stack:** Docker Compose v2 (YAML), Markdown. Verification via `docker compose config --format json` + Python 3.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-21-postgres-shm-size-design.md`. Read it before starting.
- Branch: `fix/postgres-shm-size-1365`, already created off `develop`. Do not branch off `master`.
- Do **not** add a CI guard. The user explicitly declined one; the verification script in Task 1 lives in the scratchpad and is never committed.
- Do **not** change any `deploy.resources.limits` value. The 768M memory caps stay exactly as they are.
- Do **not** touch `docker-compose.fast-path.yml`. Its `postgres-db` block overrides only `volumes`, and Compose merges overlays per key, so `shm_size` from the base file survives.
- Exact values, no substitutions: `1gb` and `256m` (lowercase, as written).
- Scratchpad directory for temporary files: `/tmp/claude-1000/-home-ubuntu-projects-egov-devops-Citizen-Complaint-Resolution-System/78d2754b-a12a-46f5-bbc0-cd420400bedf/scratchpad`

**The six files and their values** (this mapping is the whole change — get it right):

| Compose file | pool | `shm_size` |
|---|---|---|
| `local-setup/docker-compose.egov-digit.yaml` | 60 | `1gb` |
| `local-setup/docker-compose.registry.yml` | 60 | `1gb` |
| `docker-compose.egov-digit.yaml` (repo root) | 60 | `1gb` |
| `local-setup/docker-compose.yml` | 20 | `256m` |
| `local-setup/docker-compose.db-migrations.yml` | 20 | `256m` |
| `local-setup/docker-compose.deploy.yaml` | 20 | `256m` |

**Two facts already verified empirically — do not re-derive, but do rely on them:**

1. `docker compose config --format json` normalizes `shm_size` to a **string of bytes**: `1gb` → `"1073741824"`, `256m` → `"268435456"`. Compare against strings, not ints.
2. `local-setup/docker-compose.egov-digit.yaml` will not parse unless `DDH_IMAGE` is set (otherwise: `service "default-data-handler" has neither an image nor a build context specified`). The other five parse with no env. Set `DDH_IMAGE=placeholder` for that one file only.

---

## File Structure

| File | Change |
|---|---|
| `local-setup/docker-compose.yml` | Modify: add `shm_size: 256m` + comment to `postgres-db` (block begins line 3) |
| `local-setup/docker-compose.egov-digit.yaml` | Modify: add `shm_size: 1gb` + comment to `postgres-db` (block begins line 95) |
| `local-setup/docker-compose.registry.yml` | Modify: add `shm_size: 1gb` + comment to `postgres-db` (block begins line 70) |
| `local-setup/docker-compose.db-migrations.yml` | Modify: add `shm_size: 256m` + comment to `postgres-db` |
| `local-setup/docker-compose.deploy.yaml` | Modify: add `shm_size: 256m` + comment to `postgres-db` |
| `docker-compose.egov-digit.yaml` | Modify: add `shm_size: 1gb` + comment to `postgres-db` |
| `local-setup/README.md` | Modify: new `### Disk usage: container logs` under `## Resource Usage` (table ends line 580) |
| `<scratchpad>/check_shm.py` | Create: verification script. **Not committed.** |

Two tasks. Task 1 is the config change and is gated on the checker going red then green. Task 2 is documentation and is independently reviewable — a reviewer could reasonably accept the sizing and reject the wording, or vice versa.

---

### Task 1: `shm_size` on `postgres-db` in all six Compose files

**Files:**
- Create: `<scratchpad>/check_shm.py` (temporary, not committed)
- Modify: `local-setup/docker-compose.yml`, `local-setup/docker-compose.egov-digit.yaml`, `local-setup/docker-compose.registry.yml`, `local-setup/docker-compose.db-migrations.yml`, `local-setup/docker-compose.deploy.yaml`, `docker-compose.egov-digit.yaml`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `services["postgres-db"].shm_size` present in all six rendered configs. Task 2 depends on none of it.

- [ ] **Step 1: Write the failing check**

Write to `<scratchpad>/check_shm.py` (substitute the real scratchpad path from Global Constraints):

```python
#!/usr/bin/env python3
"""Assert each Compose file's postgres-db gets the /dev/shm its pgbouncer pool needs.

Run from the repo root. Temporary verification for issue #1365 — not committed.
"""
import json
import os
import subprocess
import sys

GB = "1073741824"  # what `compose config` reports for 1gb
MB256 = "268435456"  # ... and for 256m

# path -> (expected shm_size, extra env needed to make the file parse)
EXPECTED = {
    "local-setup/docker-compose.egov-digit.yaml": (GB, {"DDH_IMAGE": "placeholder"}),
    "local-setup/docker-compose.registry.yml": (GB, {}),
    "docker-compose.egov-digit.yaml": (GB, {}),
    "local-setup/docker-compose.yml": (MB256, {}),
    "local-setup/docker-compose.db-migrations.yml": (MB256, {}),
    "local-setup/docker-compose.deploy.yaml": (MB256, {}),
}

failed = False
for path, (want, extra_env) in EXPECTED.items():
    env = {**os.environ, **extra_env}
    proc = subprocess.run(
        ["docker", "compose", "-f", path, "config", "--format", "json"],
        capture_output=True, text=True, env=env,
    )
    if proc.returncode != 0:
        err = "\n".join(
            ln for ln in proc.stderr.splitlines() if "level=warning" not in ln
        )
        print(f"FAIL  {path}\n      did not parse: {err.strip()}")
        failed = True
        continue

    got = json.loads(proc.stdout)["services"]["postgres-db"].get("shm_size")
    if got == want:
        print(f"OK    {path}  shm_size={got}")
    else:
        print(f"FAIL  {path}  shm_size={got!r}, want {want!r}")
        failed = True

sys.exit(1 if failed else 0)
```

- [ ] **Step 2: Run the check to verify it fails**

Run from the repo root:

```bash
python3 "<scratchpad>/check_shm.py"
```

Expected: exit 1, with all six lines reading `FAIL ... shm_size=None, want '...'` — the key is absent everywhere today. If any line already says `OK`, stop: someone has partially applied this change and you need to reconcile before continuing.

- [ ] **Step 3: Add `shm_size` to the three pool=60 files**

In each of these three, insert the comment and key immediately after the `container_name: docker-postgres` line inside the `postgres-db` service, keeping the file's existing 4-space service-key indentation.

`local-setup/docker-compose.egov-digit.yaml` and `docker-compose.egov-digit.yaml` (repo root) — both currently read:

```yaml
  postgres-db:
    image: registry.preview.egov.theflywheel.in/postgres:16
    container_name: docker-postgres
    environment:
```

becomes:

```yaml
  postgres-db:
    image: registry.preview.egov.theflywheel.in/postgres:16
    container_name: docker-postgres
    # /dev/shm sizing (issue #1365). Postgres puts the dynamic shared memory
    # that a parallel query's workers use to exchange tuples here — about 8 MB
    # per query. Docker's default pad is 64 MB, so the 9th concurrent parallel
    # query fails with "could not resize shared memory segment ... No space
    # left on device". pgbouncer runs transaction pooling, so its
    # DEFAULT_POOL_SIZE (60 below) is what bounds concurrency at the database:
    # 60 x 8 MB = 480 MB worst case. A tmpfs is a ceiling, not a reservation —
    # unused pages cost no memory.
    shm_size: 1gb
    environment:
```

`local-setup/docker-compose.registry.yml` — same `image:`/`container_name:` pair, same insertion, same comment, same `shm_size: 1gb`.

- [ ] **Step 4: Add `shm_size` to the two pool=20 files that cap memory**

`local-setup/docker-compose.yml` currently reads:

```yaml
  postgres-db:
    image: postgres:16
    container_name: docker-postgres
    environment:
```

becomes:

```yaml
  postgres-db:
    image: postgres:16
    container_name: docker-postgres
    # /dev/shm sizing (issue #1365). Postgres puts the dynamic shared memory
    # that a parallel query's workers use to exchange tuples here — about 8 MB
    # per query — and Docker's default pad is only 64 MB. pgbouncer's
    # DEFAULT_POOL_SIZE is 20 on this stack, so 20 x 8 MB = 160 MB covers it.
    # Not 1gb like the deployed stacks: this container is capped at 768M below,
    # and /dev/shm is a tmpfs charged to that same cgroup, so a 1 GB pad would
    # let postgres be OOM-killed by filling shm alone — a worse failure than
    # the one being fixed.
    shm_size: 256m
    environment:
```

`local-setup/docker-compose.db-migrations.yml` — identical `image:`/`container_name:` pair, identical insertion, identical comment and value.

- [ ] **Step 5: Add `shm_size` to the remaining pool=20 file**

`local-setup/docker-compose.deploy.yaml` has no memory cap, so its comment drops the OOM clause:

```yaml
  postgres-db:
    image: postgres:16
    container_name: docker-postgres
    # /dev/shm sizing (issue #1365). Postgres puts the dynamic shared memory
    # that a parallel query's workers use to exchange tuples here — about 8 MB
    # per query — and Docker's default pad is only 64 MB. pgbouncer's
    # DEFAULT_POOL_SIZE is 20 on this stack, so 20 x 8 MB = 160 MB covers it.
    shm_size: 256m
    environment:
```

- [ ] **Step 6: Run the check to verify it passes**

```bash
python3 "<scratchpad>/check_shm.py"
```

Expected: exit 0, six lines:

```
OK    local-setup/docker-compose.egov-digit.yaml  shm_size=1073741824
OK    local-setup/docker-compose.registry.yml  shm_size=1073741824
OK    docker-compose.egov-digit.yaml  shm_size=1073741824
OK    local-setup/docker-compose.yml  shm_size=268435456
OK    local-setup/docker-compose.db-migrations.yml  shm_size=268435456
OK    local-setup/docker-compose.deploy.yaml  shm_size=268435456
```

- [ ] **Step 7: Confirm the pad is real inside a running container**

The rendered config proves the YAML; this proves the kernel honours it. On the dev stack:

```bash
cd local-setup
docker compose -f docker-compose.yml up -d postgres-db
docker exec docker-postgres df -h /dev/shm
```

Expected: the `Size` column reads `256M`. Before this change it read `64M`.

Then tear it down so no stray container is left behind:

```bash
docker compose -f docker-compose.yml down
cd ..
```

If `docker compose up` is not possible in your environment (no daemon, no image pull), record that this step was skipped — do not mark it done.

- [ ] **Step 8: Confirm the memory caps were not touched**

```bash
git diff -U0 -- local-setup/docker-compose.yml local-setup/docker-compose.db-migrations.yml | grep -E '^[-+].*(memory|cpus)' || echo "clean: no resource-limit lines changed"
```

Expected: `clean: no resource-limit lines changed`.

- [ ] **Step 9: Commit**

```bash
git add local-setup/docker-compose.yml \
        local-setup/docker-compose.egov-digit.yaml \
        local-setup/docker-compose.registry.yml \
        local-setup/docker-compose.db-migrations.yml \
        local-setup/docker-compose.deploy.yaml \
        docker-compose.egov-digit.yaml
git commit -m "fix(compose): size postgres /dev/shm from the pgbouncer pool (#1365)

No compose file set shm_size, so postgres-db ran with Docker's 64 MB
default. Postgres allocates ~8 MB of dynamic shared memory per parallel
query, so the complaint-list endpoint failed with 'could not resize
shared memory segment' past ~8 concurrent queries — 1,412 of 3,831
requests (36.9%) in a k6 run.

Sizes the pad from DEFAULT_POOL_SIZE, which bounds concurrency at the
database under transaction pooling: 1gb for the three pool=60 stacks,
256m for the three pool=20 ones. The two 768M-capped files stay at 256m
deliberately — /dev/shm is a tmpfs charged to the container's memory
cgroup, so a 1 GB pad there would make an OOM-kill of postgres reachable.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: README note on log rotation for hand-run Compose

**Files:**
- Modify: `local-setup/README.md` — insert after the Resource Usage table (ends line 580, `| **Total** | **~3.8 GB** |`) and before the `---` that follows it

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed downstream. Final task.

Context for the writer: the disk-fill half of #1365 is fixed on branch `fix/docker-log-rotation-1342`, which writes `max-size`/`max-file` into `/etc/docker/daemon.json` from `playbook-deploy.yml`. That only reaches hosts deployed by Ansible. Someone running `docker compose up` by hand gets no rotation at all, and unbounded logs filled a host disk, drove Postgres into `PANIC: could not write to file ... No space left on device`, and left it crash-looping — crash recovery must itself write a checkpoint, so a full disk means Postgres does not come back without intervention.

- [ ] **Step 1: Add the section**

Insert this immediately after the `| **Total** | **~3.8 GB** |` row. (The outer fence below is four backticks so the nested JSON block survives; insert only what is *between* them, starting at `### Disk usage`.)

````markdown
### Disk usage: container logs

Container logs are **not** rotated by Compose. With Docker's default `json-file`
driver they grow without bound: measured on an idle stack 21 hours after start,
7.9 GB total — 4.3 GB from the MDMS backend and 2.6 GB from the OTel collector
alone, roughly 9 GB/day before any load.

This is not cosmetic. When the disk fills, Postgres hits
`PANIC: could not write to file ... No space left on device` and crash-loops,
because recovery must itself write a checkpoint. It does not return without
intervention, and every service then fails on connection acquisition.

The Ansible playbook (Option C) configures rotation for you, in
`/etc/docker/daemon.json`. **If you started the stack by hand with
`docker compose up`, you must configure it yourself** — it is a daemon-level
setting, not a Compose one:

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "100m", "max-file": "10" }
}
```

Then `sudo systemctl restart docker`. The limits apply to containers **created
after** the restart — existing containers keep the settings they were created
with until recreated, so run `docker compose up -d --force-recreate` if the
stack is already running.
````

- [ ] **Step 2: Verify the Markdown renders**

The section contains a fenced JSON block nested inside prose. Confirm the fences are balanced and no heading was orphaned:

```bash
python3 - <<'PY'
import re, pathlib
t = pathlib.Path("local-setup/README.md").read_text()
assert t.count("```") % 2 == 0, "unbalanced code fences"
assert "### Disk usage: container logs" in t, "section missing"
assert t.index("### Disk usage: container logs") > t.index("| **Total** | **~3.8 GB** |"), "section landed above the table"
assert t.index("### Disk usage: container logs") < t.index("## API Access"), "section landed outside Resource Usage"
print("README structure OK")
PY
```

Expected: `README structure OK`.

- [ ] **Step 3: Commit**

```bash
git add local-setup/README.md
git commit -m "docs(local-setup): warn that hand-run compose gets no log rotation (#1365)

The daemon.json log-opts written by playbook-deploy.yml only reach hosts
deployed via Ansible. A bare 'docker compose up' rotates nothing, and
unbounded json-file logs (~9 GB/day at idle, measured) filled a host disk
and left Postgres crash-looping — recovery needs to write a checkpoint,
so a full disk is terminal without intervention.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Done When

- [ ] `check_shm.py` exits 0 with all six `OK` lines
- [ ] `df -h /dev/shm` in `docker-postgres` reports `256M` on the dev stack (or the step is recorded as skipped)
- [ ] No `deploy.resources.limits` value changed anywhere in the diff
- [ ] `docker-compose.fast-path.yml` untouched
- [ ] No CI workflow file touched
- [ ] `check_shm.py` was never `git add`ed — confirm with `git status --porcelain` showing a clean tree
- [ ] Two commits on `fix/postgres-shm-size-1365`, on top of the spec commit `975235bc`

## Out of Scope

Do not implement these even if they look adjacent:

- A CI guard asserting `shm_size` is present — explicitly declined.
- `max_parallel_workers_per_gather = 0`, or an index for the list query — considered and rejected in the spec.
- The two unconfirmed failures in #1365 (`Unknown error occurred in decryption process`, `INVALID ACTION`).
- Changing HTTP 400 to 5xx for server-side exceptions — belongs in `pgr-services`/core, its own issue.
