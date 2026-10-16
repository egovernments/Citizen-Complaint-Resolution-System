#!/usr/bin/env python3
"""Drop Gatus's stored history for endpoints this stack switches off (#2458).

Gatus deletes stored statuses only for endpoints that are MISSING from its config.
An endpoint that stays in config with `enabled: ${VAR}` resolving to false keeps
its last stored result, so the status page shows it red forever, frozen at the
failure from before it was switched off. This finds those endpoints (the toggles
are read from the running container's environment) and, only if any of them
still has stored rows, stops Gatus, deletes them and starts it again.

Usage: prune-disabled.py <gatus config.yaml> <container>   |   prune-disabled.py --self-test
"""
import json
import os
import re
import sqlite3
import subprocess
import sys

TOGGLE = re.compile(r"^\$\{(\w+)\}$")


def disabled_endpoints(config, env):
    """(group, name) of every endpoint whose `enabled` resolves to false. Unset means on, as in Gatus."""
    out = []
    for ep in (config or {}).get("endpoints") or []:
        enabled = ep.get("enabled", True)
        match = TOGGLE.match(enabled) if isinstance(enabled, str) else None
        if match:
            enabled = env.get(match.group(1), "true")
        if str(enabled).strip().lower() == "false":
            out.append((ep.get("group", ""), ep["name"]))
    return out


def stored(db, endpoints):
    return [e for e in endpoints if db.execute(
        "SELECT 1 FROM endpoints WHERE endpoint_group = ? AND endpoint_name = ?", e).fetchone()]


def prune(db, endpoints):
    db.execute("PRAGMA foreign_keys = ON")  # results, events and uptimes go with their endpoint
    for e in endpoints:
        db.execute("DELETE FROM endpoints WHERE endpoint_group = ? AND endpoint_name = ?", e)
    db.commit()


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True).strip()


def main(config_path, container):
    import yaml
    env = dict(v.split("=", 1) for v in json.loads(docker("inspect", "-f", "{{json .Config.Env}}", container)))
    data_dir = docker("inspect", "-f", '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}', container)
    with open(config_path) as f:
        disabled = disabled_endpoints(yaml.safe_load(f), env)
    db_path = data_dir + "/gatus.db"
    if not os.path.isfile(db_path):  # e.g. a Mac deploy, where the volume lives inside the Docker VM
        print("skip: %s is not reachable from this host" % db_path)
        return
    db = sqlite3.connect(db_path)
    stale = stored(db, disabled)
    db.close()
    if not stale:
        print("no stored history for disabled endpoints")
        return
    docker("stop", container)
    try:
        db = sqlite3.connect(db_path)
        prune(db, stale)
        db.close()
    finally:
        docker("start", container)
    print("CHANGED: pruned " + ", ".join("%s / %s" % e for e in stale))


def self_test():
    config = {"endpoints": [
        {"name": "Kong Admin API", "group": "API Gateway", "enabled": "${GATUS_KONG_ADMIN}"},
        {"name": "Kong Status", "group": "API Gateway"},
        {"name": "Audit Service", "group": "Core Services", "enabled": "${GATUS_AUDIT}"},
        {"name": "OTP Service", "group": "Core Services", "enabled": "${GATUS_PROFILE_OTP}"},
        {"name": "Literal Off", "group": "X", "enabled": False},
    ]}
    env = {"GATUS_KONG_ADMIN": "false", "GATUS_AUDIT": "true"}  # OTP unset: Gatus treats it as on
    want = [("API Gateway", "Kong Admin API"), ("X", "Literal Off")]
    assert disabled_endpoints(config, env) == want, disabled_endpoints(config, env)
    db = sqlite3.connect(":memory:")
    db.executescript("""
        PRAGMA foreign_keys = ON;
        CREATE TABLE endpoints (endpoint_id INTEGER PRIMARY KEY, endpoint_name TEXT, endpoint_group TEXT);
        CREATE TABLE endpoint_results (id INTEGER PRIMARY KEY,
            endpoint_id INTEGER REFERENCES endpoints(endpoint_id) ON DELETE CASCADE);
        INSERT INTO endpoints VALUES (1, 'Kong Admin API', 'API Gateway'), (2, 'Kong Status', 'API Gateway');
        INSERT INTO endpoint_results (endpoint_id) VALUES (1), (2);
    """)
    assert stored(db, want) == [("API Gateway", "Kong Admin API")]
    assert stored(db, [("API Gateway", "Kong Status")]) == [("API Gateway", "Kong Status")]
    prune(db, stored(db, want))
    assert stored(db, want) == []
    assert db.execute("SELECT endpoint_id FROM endpoint_results").fetchall() == [(2,)]  # cascade, Kong Status kept
    print("self-test OK")


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        self_test()
    elif len(sys.argv) == 3:
        main(sys.argv[1], sys.argv[2])
    else:
        sys.exit(__doc__)
