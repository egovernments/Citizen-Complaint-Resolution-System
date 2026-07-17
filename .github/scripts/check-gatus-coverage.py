#!/usr/bin/env python3
"""CI guard: every service deployed by Compose or k3s must have a Gatus check,
and the two tiers' endpoint catalogues must stay identical.

Three failure modes this catches:

  1. UNMONITORED   a service is deployed but nothing checks it. This is how
                   egov-url-shortening sat DOWN for days unnoticed, and how the
                   whole mcp stack ran unwatched.
  2. DANGLING      a Gatus check points at a host no tier deploys, so it is
                   red forever and trains people to ignore the dashboard.
  3. TIER DRIFT    an endpoint is defined for one tier but not the other, so a
                   service is watched on Compose and blind on k3s (or vice versa).

Matching is by URL HOST, not by name, because the two are not the same thing:
`tcp://postgres:5432` reaches the *pgbouncer* service via a compose network
alias, and `postgres-db` is the real database. Comparing service names to URLs
naively would report both as unmonitored. Aliases are resolved from the compose
`networks:` block and from k8s Service names.

A service that genuinely cannot be probed (no listening port, or a one-shot job
that exits) must be listed in EXEMPT with a reason. That is deliberate: adding a
service then forgets to monitor it fails CI until someone makes an explicit call.

Sources of truth:
  compose:  local-setup/docker-compose.yml, local-setup/docker-compose.egov-digit.yaml
  k3s:      local-setup/k8s/**/*.yaml            (kind: Service)
  gatus:    local-setup/gatus/config.yaml        (compose tier)
            local-setup/k8s/tools/gatus.yaml     (k3s tier, gatus-config ConfigMap)

Run with --self-test to verify the detection logic itself catches each failure mode.
"""
import json
import pathlib
import re
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[2]
LS = ROOT / "local-setup"

# The compose files whose services must be covered. These are the two real
# deployment paths, plus the overlays ansible layers on top:
#
#   docker-compose.yml          the local / CI path (.github/workflows/local-setup-ci.yaml
#                               runs a bare `docker compose up -d` against it).
#   docker-compose.egov-digit.yaml
#                               the tenant path. ansible deploys ONLY this file plus the
#                               overlays below -- never docker-compose.yml (see
#                               playbook-deploy.yml "Compute compose file stack",
#                               compose_files: -f docker-compose.egov-digit.yaml ...).
#
# The overlays add no long-lived services of their own (they add *-migration one-shots
# and override existing services), but they are listed so that a future long-lived
# service added there cannot slip past this check.
#
# registry.yml / deploy.yaml / db-migrations.yml are variants of the above and would
# only contribute duplicate names.
COMPOSE_FILES = [
    LS / "docker-compose.yml",
    LS / "docker-compose.egov-digit.yaml",
    LS / "docker-compose.migrations.yml",
    LS / "docker-compose.migrations.ansible.yml",
    LS / "docker-compose.fast-path.yml",
]
K8S_DIR = LS / "k8s"
GATUS_COMPOSE = LS / "gatus/config.yaml"
GATUS_K8S = LS / "k8s/tools/gatus.yaml"

# Services that cannot or should not carry a Gatus check. Every entry needs a
# reason; "we didn't get round to it" is not one.
EXEMPT = {
    # One-shot jobs: they run to completion and exit. A health check would be
    # red by design once they finish successfully.
    "minio-init": "one-shot: seeds the bucket then exits",
    "pgr-workflow-seed": "one-shot: seeds workflow defs then exits",
    "localization-seed": "one-shot: seeds messages then exits",
    "localization-cache-bust": "one-shot: busts the cache then exits",
    "default-data-handler": "one-shot: loads default data then exits",
    "hrms-prereq-gate": "one-shot: gate container, exits on success",
    "db-history-normalize": "one-shot: restart:no, no ports; normalises flyway history then exits",
    # No listening port at all -- nothing to probe.
    "telemetry": "no port: alpine sidecar, file-based healthcheck only",
    "novu-worker": "no port: kafka/queue worker, exposes no HTTP or TCP listener",
    "promtail": "no port: log-shipper agent, tails files and pushes to loki",
    # Observability plumbing. Deliberately out of scope: Gatus is the DIGIT
    # serving-stack dashboard, and these failing costs visibility, not service.
    # Monitoring the monitoring is a separate decision -- if it is ever wanted,
    # they need a GATUS_OBSERVABILITY toggle, since none of them exist in the
    # k3s tier or in docker-compose.yml, only in docker-compose.egov-digit.yaml.
    "grafana": "observability plumbing: dashboards UI, not a serving dependency",
    "prometheus": "observability plumbing: metrics store, not a serving dependency",
    "loki": "observability plumbing: log store, not a serving dependency",
    "tempo": "observability plumbing: trace store, not a serving dependency",
    "otel-collector": "observability plumbing: telemetry pipeline, not a serving dependency",
    # Deploy-time only: nothing declares depends_on openbao, and ansible reads its
    # secrets during the deploy and injects them as env, so a runtime outage does
    # not break serving. Listens on 127.0.0.1 only, so Gatus could not reach it.
    "openbao": "deploy-time secrets store: no runtime dependents, binds 127.0.0.1 only",
    # Tooling, not part of the serving stack.
    "jupyter": "dev tool, not a serving dependency",
    "gatus": "the monitor itself",
}

# Suffixes that mark generated one-shot migration containers. These are created
# per schema-owning service by the migrations overlay and all exit on success.
EXEMPT_SUFFIXES = ("-migration", "-migrations", "-seed", "-init")


def _is_exempt(name: str):
    if name in EXEMPT:
        return EXEMPT[name]
    for suf in EXEMPT_SUFFIXES:
        if name.endswith(suf):
            return f"one-shot: matches '*{suf}'"
    return None


def _load(path: pathlib.Path):
    return yaml.safe_load(path.read_text())


def _stub_vars(text: str) -> str:
    """Gatus reads ${VAR} itself; make the YAML parseable without resolving them."""
    return re.sub(r"\$\{([A-Z0-9_]+)(:-[^}]*)?\}", r"__\1__", text)


def compose_targets(paths):
    """{reachable dns name -> service name} for every compose service.

    Includes network aliases, because a Gatus URL names the DNS host, and the
    host is often an alias rather than the service (postgres -> pgbouncer).
    """
    names, aliases = {}, {}
    for p in paths:
        if not p.exists():
            continue
        doc = yaml.safe_load(_stub_vars(p.read_text())) or {}
        for svc, body in (doc.get("services") or {}).items():
            names[svc] = svc
            nets = (body or {}).get("networks")
            if isinstance(nets, dict):
                for net in nets.values():
                    for a in ((net or {}).get("aliases") or []):
                        aliases[a] = svc
    names.update(aliases)
    return names


def k8s_targets(root: pathlib.Path):
    """{reachable dns name -> canonical workload} for every k8s Service.

    Two Services with the same selector front the same pods, so one is an alias
    of the other -- `kafka` and `redpanda` both select app=redpanda. Checking
    either covers the workload, so they collapse to one target. Without this,
    the alias Service looks unmonitored and CI cries wolf.
    """
    docs = []
    for f in sorted(root.rglob("*.yaml")):
        docs.extend(d for d in yaml.safe_load_all(_stub_vars(f.read_text())) if d)
    return k8s_targets_from_docs(docs)


def k8s_targets_from_docs(docs):
    """Collapse Services by selector; see k8s_targets. Split out to be testable."""
    by_selector = {}
    for doc in docs:
        if doc.get("kind") != "Service":
            continue
        name = doc["metadata"]["name"]
        sel = doc.get("spec", {}).get("selector") or {}
        key = tuple(sorted(sel.items())) or ("__none__", name)
        by_selector.setdefault(key, []).append(name)
    out = {}
    for names in by_selector.values():
        canonical = sorted(names)[0]
        for n in names:
            out[n] = canonical
    return out


def _hosts(endpoints):
    """Hostname of each endpoint URL, e.g. http://egov-user:8107/x -> egov-user."""
    hosts = set()
    for e in endpoints:
        m = re.match(r"^[a-z]+://([^:/]+)", str(e.get("url", "")))
        if m:
            hosts.add(m.group(1))
    return hosts


def gatus_compose_endpoints():
    return (yaml.safe_load(_stub_vars(GATUS_COMPOSE.read_text())) or {}).get("endpoints") or []


def gatus_k8s_endpoints():
    for doc in yaml.safe_load_all(_stub_vars(GATUS_K8S.read_text())):
        if doc and doc.get("kind") == "ConfigMap" and "config.yaml" in (doc.get("data") or {}):
            return (yaml.safe_load(_stub_vars(doc["data"]["config.yaml"])) or {}).get("endpoints") or []
    return []


def find_unmonitored(targets, monitored_hosts):
    """Services with no endpoint pointing at them (or any of their aliases)."""
    covered = {targets[h] for h in monitored_hosts if h in targets}
    missing = []
    for svc in sorted(set(targets.values())):
        if svc in covered or _is_exempt(svc):
            continue
        missing.append(svc)
    return missing


def find_dangling(monitored_hosts, all_targets):
    return sorted(h for h in monitored_hosts if h not in all_targets)


def find_drift(compose_eps, k8s_eps):
    a = {e["name"]: e for e in compose_eps}
    b = {e["name"]: e for e in k8s_eps}
    only_compose = sorted(set(a) - set(b))
    only_k8s = sorted(set(b) - set(a))
    differing = sorted(
        n for n in (set(a) & set(b))
        if json.dumps(a[n], sort_keys=True) != json.dumps(b[n], sort_keys=True)
    )
    return only_compose, only_k8s, differing


def report() -> int:
    ctargets = compose_targets(COMPOSE_FILES)
    ktargets = k8s_targets(K8S_DIR)
    ceps, keps = gatus_compose_endpoints(), gatus_k8s_endpoints()
    chosts, khosts = _hosts(ceps), _hosts(keps)

    rc = 0

    unmon_c = find_unmonitored(ctargets, chosts)
    if unmon_c:
        rc = 1
        print("FAIL: compose services with no Gatus check "
              "(add one to local-setup/gatus/config.yaml, or add to EXEMPT with a reason):")
        for s in unmon_c:
            print(f"  - {s}")

    unmon_k = find_unmonitored(ktargets, khosts)
    if unmon_k:
        rc = 1
        print("FAIL: k3s Services with no Gatus check "
              "(add one to the gatus-config ConfigMap in local-setup/k8s/tools/gatus.yaml):")
        for s in unmon_k:
            print(f"  - {s}")

    every = set(ctargets) | set(ktargets)
    dangling = find_dangling(chosts | khosts, every)
    if dangling:
        rc = 1
        print("FAIL: Gatus checks pointing at hosts no tier deploys "
              "(red forever -- fix the URL or drop the check):")
        for h in dangling:
            print(f"  - {h}")

    only_c, only_k, differ = find_drift(ceps, keps)
    if only_c or only_k or differ:
        rc = 1
        print("FAIL: the two tiers' endpoint catalogues have drifted "
              "(define every endpoint in BOTH files; gate with GATUS_PROFILE_*/GATUS_PROXIES "
              "rather than omitting it from one tier):")
        for n in only_c:
            print(f"  - only in compose: {n}")
        for n in only_k:
            print(f"  - only in k3s:     {n}")
        for n in differ:
            print(f"  - differs between tiers: {n}")

    if rc == 0:
        print(f"OK: {len(set(ctargets.values()))} compose services, "
              f"{len(set(ktargets.values()))} k3s Services, "
              f"{len(ceps)} endpoints per tier, no drift, no dangling checks.")
    return rc


def self_test() -> int:
    """Prove each detector actually fires; a green check that cannot fail is worthless."""
    failures = []

    # 1. an unmonitored service is caught
    targets = {"svc-a": "svc-a", "svc-b": "svc-b"}
    if find_unmonitored(targets, {"svc-a"}) != ["svc-b"]:
        failures.append("unmonitored detector missed a service with no check")

    # 2. exempt services are not reported
    if find_unmonitored({"minio-init": "minio-init"}, set()) != []:
        failures.append("exempt service was wrongly reported as unmonitored")
    if find_unmonitored({"foo-migration": "foo-migration"}, set()) != []:
        failures.append("'*-migration' suffix was wrongly reported as unmonitored")

    # 3. an alias counts as coverage (the postgres -> pgbouncer case)
    if find_unmonitored({"pgbouncer": "pgbouncer", "postgres": "pgbouncer"}, {"postgres"}) != []:
        failures.append("alias-covered service was wrongly reported as unmonitored")

    # 3b. k8s Services sharing a selector collapse (the kafka -> redpanda case):
    #     checking either name covers the workload...
    k8s_alias = {"kafka": "redpanda", "redpanda": "redpanda", "redis": "redis"}
    if find_unmonitored(k8s_alias, {"kafka"}) != ["redis"]:
        failures.append("k8s alias Service did not count as coverage of its workload")
    # ...but a Service with a different selector is still its own target.
    if find_unmonitored(k8s_alias, {"redpanda"}) != ["redis"]:
        failures.append("a genuinely distinct k8s Service was not reported")

    # 3c. selector grouping itself: same selector -> one canonical target.
    grouped = k8s_targets_from_docs([
        {"kind": "Service", "metadata": {"name": "kafka"}, "spec": {"selector": {"app": "redpanda"}}},
        {"kind": "Service", "metadata": {"name": "redpanda"}, "spec": {"selector": {"app": "redpanda"}}},
        {"kind": "Service", "metadata": {"name": "redis"}, "spec": {"selector": {"app": "redis"}}},
    ])
    if grouped != {"kafka": "kafka", "redpanda": "kafka", "redis": "redis"}:
        failures.append(f"selector grouping wrong: {grouped}")

    # 4. a dangling check is caught
    if find_dangling({"ghost"}, {"real": "real"}) != ["ghost"]:
        failures.append("dangling detector missed a check with no service")

    # 5. tier drift is caught, in both directions and on value changes
    a = [{"name": "X", "url": "http://x:1/h"}, {"name": "OnlyC", "url": "http://c:1/h"}]
    b = [{"name": "X", "url": "http://x:2/h"}, {"name": "OnlyK", "url": "http://k:1/h"}]
    only_c, only_k, differ = find_drift(a, b)
    if only_c != ["OnlyC"] or only_k != ["OnlyK"] or differ != ["X"]:
        failures.append("drift detector missed only-compose / only-k3s / differing endpoints")

    # 6. identical catalogues are clean
    if any(find_drift(a, a)):
        failures.append("drift detector reported drift between a catalogue and itself")

    # 7. URL host extraction handles tcp:// and ${VAR} ports
    got = _hosts([{"url": "tcp://postgres-db:5432"},
                  {"url": "http://egov-notification-sms:__GATUS_SMS_PORT__/x/health"}])
    if got != {"postgres-db", "egov-notification-sms"}:
        failures.append(f"host extraction wrong: {got}")

    for f in failures:
        print(f"SELF-TEST FAIL: {f}")
    if failures:
        return 1
    print("self-test OK: all detectors fire on their failure mode")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    return report()


if __name__ == "__main__":
    sys.exit(main())
