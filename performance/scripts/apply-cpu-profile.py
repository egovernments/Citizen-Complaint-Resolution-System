#!/usr/bin/env python3
"""Apply CPU limits from a profile YAML to running Docker containers.

Usage:
    python3 apply-cpu-profile.py <profile.yml> [--project NAME]
    python3 apply-cpu-profile.py --remove [--project NAME]

Every action is scoped to ONE compose project. Without a project filter the
label lookup below matches every compose-managed container on the host, so
--remove would clear CPU quotas belonging to unrelated stacks: harmless on a
dedicated box, destructive on a shared one. The project comes from --project,
else $COMPOSE_PROJECT_NAME, else auto-detection when exactly one compose
project is running. With several running and none named, this refuses rather
than guessing.

Containers are resolved by their `com.docker.compose.service` label rather than
via `docker compose ps`. The previous implementation shelled out to
`docker compose -f docker-compose.yml ps`, which requires that exact filename to
exist in the working directory. Deployments that spread the stack over several
compose files (docker-compose.egov-digit.yaml + per-tenant overlays) have no
such file, so the lookup returned an empty mapping, every service was reported
as "skipped (not running)", and BOTH apply and remove exited 0 having done
nothing. A profile matrix run that way yields identical unthrottled results
under four different profile labels, and the remove path silently leaves the
stack throttled. Resolving by label works regardless of how compose was invoked.
"""
import os
import yaml
import subprocess
import sys


def list_projects():
    """Distinct compose project labels among running containers."""
    r = subprocess.run(
        ["docker", "ps", "--format", "{{.Label \"com.docker.compose.project\"}}"],
        capture_output=True, text=True
    )
    if r.returncode != 0:
        return []
    return sorted({p for p in r.stdout.split() if p})


def resolve_project(explicit=None):
    """Pick the single compose project to act on, or None to abort.

    Fails closed: with several projects running and none named, guessing would
    mean reaching into another stack.
    """
    if explicit:
        return explicit
    if os.environ.get("COMPOSE_PROJECT_NAME"):
        return os.environ["COMPOSE_PROJECT_NAME"]
    projects = list_projects()
    if len(projects) == 1:
        return projects[0]
    if not projects:
        print("ERROR: no running compose-managed containers found.", file=sys.stderr)
        return None
    print("ERROR: %d compose projects are running: %s. Refusing to guess which "
          "to touch - pass --project NAME or set COMPOSE_PROJECT_NAME."
          % (len(projects), projects), file=sys.stderr)
    return None


def get_running_containers(project):
    """Map compose service name -> container id, within one compose project."""
    result = subprocess.run(
        ["docker", "ps",
         "--filter", "label=com.docker.compose.project=%s" % project,
         "--format", "{{.Label \"com.docker.compose.service\"}} {{.ID}}"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"ERROR: docker ps failed: {result.stderr.strip()}", file=sys.stderr)
        return {}
    containers = {}
    for line in result.stdout.strip().split("\n"):
        parts = line.split()
        if len(parts) >= 2 and parts[0]:
            containers.setdefault(parts[0], parts[1])
    return containers


def _verify(cid):
    """Return "0" when the container is genuinely unthrottled, else the quota.

    Reads the cgroup rather than HostConfig.NanoCpus: that metadata field cannot
    be cleared by `docker update` and stays stale (cosmetic) until the container
    is recreated, so trusting it reports throttling that is no longer enforced —
    and, worse, reports success when it still is.
    """
    r = subprocess.run(
        ["docker", "exec", cid, "cat", "/sys/fs/cgroup/cpu.max"],
        capture_output=True, text=True
    )
    if r.returncode != 0:
        return None
    quota = r.stdout.strip().split()[0] if r.stdout.strip() else ""
    return "0" if quota == "max" else quota


def apply_profile(profile_path, project):
    """Apply CPU limits from profile YAML, within one compose project."""
    with open(profile_path) as f:
        profile = yaml.safe_load(f)

    containers = get_running_containers(project)
    if not containers:
        print("ERROR: resolved 0 running containers in project %s. Refusing to "
              "report success for a no-op profile application." % project,
              file=sys.stderr)
        return 1

    applied, skipped, errors = 0, [], []
    for svc, cfg in (profile.get("services") or {}).items():
        cpus = (cfg or {}).get("cpus")
        if not cpus:
            continue
        if svc not in containers:
            skipped.append(svc)
            continue
        r = subprocess.run(
            ["docker", "update", "--cpus", str(cpus), containers[svc]],
            capture_output=True, text=True
        )
        if r.returncode == 0:
            applied += 1
        else:
            errors.append(f"{svc}: {r.stderr.strip()}")

    print(f"Applied CPU limits to {applied} containers")
    if skipped:
        print(f"Skipped (not running): {skipped}")
    if errors:
        print(f"Errors: {errors}", file=sys.stderr)
        return 1
    if applied == 0:
        print("ERROR: profile matched 0 running services. The profile's service "
              "names do not match this deployment.", file=sys.stderr)
        return 1
    return 0


def remove_limits(project):
    """Remove CPU limits from this compose project's containers only."""
    containers = get_running_containers(project)
    if not containers:
        print("ERROR: resolved 0 running containers in project %s. CPU limits "
              "may still be in place — NOT reporting success." % project,
              file=sys.stderr)
        return 1

    removed, errors, still_limited, untouched = 0, [], [], 0
    for svc, cid in containers.items():
        # Already unlimited, so leave it alone. Keeps the blast radius to the
        # containers a profile actually limited.
        if _verify(cid) == "0":
            untouched += 1
            continue
        # `--cpus 0` is a SILENT NO-OP: the daemon ignores a zero NanoCPUs and
        # leaves the cgroup quota in place, so the container stays throttled
        # while docker reports success. Clearing cpu-quota/cpu-period is the
        # only form that actually resets cpu.max to "max". Verified on
        # Docker 29 — `--cpus 0` left every container throttled.
        r = subprocess.run(
            ["docker", "update", "--cpu-quota", "-1", "--cpu-period", "0", cid],
            capture_output=True, text=True
        )
        if r.returncode == 0:
            removed += 1
            if _verify(cid) not in ("0", None):
                still_limited.append(svc)
        else:
            errors.append(f"{svc}: {r.stderr.strip()}")

    print("Removed CPU limits from %d containers in project %s%s"
          % (removed, project,
             " (%d already unlimited)" % untouched if untouched else ""))
    if errors:
        print(f"Errors: {errors}", file=sys.stderr)
    if still_limited:
        print(f"ERROR: still limited after removal: {still_limited}", file=sys.stderr)
    return 1 if (errors or still_limited) else 0


if __name__ == "__main__":
    args = sys.argv[1:]
    project_arg = None
    if "--project" in args:
        i = args.index("--project")
        if i + 1 >= len(args):
            print("ERROR: --project needs a value", file=sys.stderr)
            sys.exit(1)
        project_arg = args[i + 1]
        del args[i:i + 2]
    if not args:
        print(__doc__)
        sys.exit(1)

    project = resolve_project(project_arg)
    if not project:
        sys.exit(1)

    sys.exit(remove_limits(project) if args[0] == "--remove"
             else apply_profile(args[0], project))
