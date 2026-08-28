#!/usr/bin/env python3
"""Apply CPU limits from a profile YAML to running Docker containers.

Usage:
    python3 apply-cpu-profile.py <profile.yml>
    python3 apply-cpu-profile.py --remove   # remove all CPU limits

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
import yaml
import subprocess
import sys


def get_running_containers():
    """Map compose service name -> container id for every running container."""
    result = subprocess.run(
        ["docker", "ps", "--format", "{{.Label \"com.docker.compose.service\"}} {{.ID}}"],
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
    """Return the container's current NanoCpus, or None if unreadable."""
    r = subprocess.run(
        ["docker", "inspect", cid, "--format", "{{.HostConfig.NanoCpus}}"],
        capture_output=True, text=True
    )
    return r.stdout.strip() if r.returncode == 0 else None


def apply_profile(profile_path):
    """Apply CPU limits from profile YAML."""
    with open(profile_path) as f:
        profile = yaml.safe_load(f)

    containers = get_running_containers()
    if not containers:
        print("ERROR: resolved 0 running containers. Refusing to report success "
              "for a no-op profile application.", file=sys.stderr)
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


def remove_limits():
    """Remove all CPU limits from running containers."""
    containers = get_running_containers()
    if not containers:
        print("ERROR: resolved 0 running containers. CPU limits may still be in "
              "place — NOT reporting success.", file=sys.stderr)
        return 1

    removed, errors, still_limited = 0, [], []
    for svc, cid in containers.items():
        r = subprocess.run(
            ["docker", "update", "--cpus", "0", cid],
            capture_output=True, text=True
        )
        if r.returncode == 0:
            removed += 1
            if _verify(cid) not in ("0", None):
                still_limited.append(svc)
        else:
            errors.append(f"{svc}: {r.stderr.strip()}")

    print(f"Removed CPU limits from {removed} containers")
    if errors:
        print(f"Errors: {errors}", file=sys.stderr)
    if still_limited:
        print(f"ERROR: still limited after removal: {still_limited}", file=sys.stderr)
    return 1 if (errors or still_limited) else 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    sys.exit(remove_limits() if sys.argv[1] == "--remove" else apply_profile(sys.argv[1]))
