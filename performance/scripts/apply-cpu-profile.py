#!/usr/bin/env python3
"""Apply CPU limits from a profile YAML to running Docker containers.

Usage:
    python3 apply-cpu-profile.py <profile.yml>
    python3 apply-cpu-profile.py --remove   # remove all CPU limits
"""
import yaml
import subprocess
import sys
import os

COMPOSE_FILE = "docker-compose.yml"

def get_running_containers():
    """Get service→container_id mapping from docker compose."""
    result = subprocess.run(
        ["docker", "compose", "-f", COMPOSE_FILE, "ps", "--format", "{{.Service}} {{.ID}}"],
        capture_output=True, text=True
    )
    containers = {}
    for line in result.stdout.strip().split("\n"):
        if line.strip():
            parts = line.split()
            if len(parts) >= 2:
                containers[parts[0]] = parts[1]
    return containers

def apply_profile(profile_path):
    """Apply CPU limits from profile YAML."""
    with open(profile_path) as f:
        profile = yaml.safe_load(f)

    containers = get_running_containers()
    applied = 0
    skipped = []
    errors = []

    for svc, cfg in profile.get("services", {}).items():
        cpus = cfg.get("cpus")
        if cpus and svc in containers:
            r = subprocess.run(
                ["docker", "update", "--cpus", str(cpus), containers[svc]],
                capture_output=True, text=True
            )
            if r.returncode == 0:
                applied += 1
            else:
                errors.append(f"{svc}: {r.stderr.strip()}")
        elif cpus:
            skipped.append(svc)

    print(f"Applied CPU limits to {applied} containers")
    if skipped:
        print(f"Skipped (not running): {skipped}")
    if errors:
        print(f"Errors: {errors}")
        return 1
    return 0

def remove_limits():
    """Remove all CPU limits from running containers."""
    containers = get_running_containers()
    removed = 0
    for svc, cid in containers.items():
        r = subprocess.run(
            ["docker", "update", "--cpus", "0", cid],
            capture_output=True, text=True
        )
        if r.returncode == 0:
            removed += 1
    print(f"Removed CPU limits from {removed} containers")
    return 0

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    if sys.argv[1] == "--remove":
        sys.exit(remove_limits())
    else:
        sys.exit(apply_profile(sys.argv[1]))
