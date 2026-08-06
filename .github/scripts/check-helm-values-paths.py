#!/usr/bin/env python3
"""CI guard: a values key that no chart reads is silently ignored, not an error.

This is the failure mode nothing else in the toolchain catches. Helm merges
values into a plain map; a key nothing references is dropped without a warning,
an exit code, or a line of output. `helm template` does NOT catch it either --
it fails only on template syntax errors, explicit required/fail calls, or a
values.schema.json violation, and the charts here ship no schema. So a setting
at the wrong path looks exactly like working configuration, in the file and in
review, forever.

Two real defects in this repo, both long-lived, both invisible to every other
check, are what this guard exists for:

  1. charts/environments/env.yaml sets prometheus.retention and
     prometheus.storageSpec (a 15Gi gp3 volume). kube-prometheus-stack reads
     those at prometheus.prometheusSpec.*. Effective result: Prometheus and
     Alertmanager run on emptyDir and lose every metric on pod restart, while
     the file states 15Gi of persistent storage.

  2. The same file sets ingress-nginx.controller.metrics.*. ingress-nginx is a
     vendored upstream chart that reads .Values.controller.* directly, so the
     whole block is inert -- and the chart's own defaults, which are the
     inverse of the intent, win instead.

SCOPE, and why it is narrow on purpose
--------------------------------------
Only EXTERNAL / vendored charts are checked -- ones whose values.yaml is the
complete upstream reference for what the chart reads.

DIGIT's own charts are deliberately excluded. They read values inside templates
via `index .Values "some-key"` without declaring them in values.yaml, so
values.yaml is not a complete reference for them and comparing against it
produces false positives (verified: hrms-dev-mode, memory_limits and images are
all genuinely consumed but undeclared). Covering them needs the reference set to
include template references too -- a later refinement, not a blocker. A guard
that cries wolf gets disabled, which would cost more than it saves.

Run with --self-test to verify the detection logic itself catches the failure
mode and stays quiet on correct configuration.
"""
import pathlib
import sys
import tempfile

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[2]
DAC = ROOT / "devops" / "deploy-as-code"
ENV = DAC / "charts" / "environments" / "env.yaml"

# env.yaml top-level block -> the chart values file that defines what that
# chart actually reads. Only external/vendored charts; see SCOPE above.
#
# Both entries receive the whole env.yaml tree via the helmfile's
# `{{ .Values | toYaml }}`, so a key must sit at the path the chart reads.
CASES = [
    ("prometheus", DAC / "charts/monitoring/values/prometheus.yaml"),
    ("ingress-nginx", DAC / "charts/backbone-services/ingress-nginx/values.yaml"),
]

# Keys consumed by helmfile/templating rather than by the chart itself.
# Every entry needs a reason -- "it was noisy" is not one.
ALLOW = {
    # helmfile's own release scoping, not a chart value
    "prometheus.namespace": "helmfile release field, not read by the chart",
}

# Mis-paths that already exist, each with the issue that fixes it. Same shape as
# FROZEN_LATEST_DEBT in local-setup/tests/static/infra-contracts.test.ts: the
# guard goes in green today and fails on anything NEW, instead of being merged
# red and ignored.
#
# This list may only shrink. A path here that no longer reproduces is a STALE
# BASELINE and fails the check too -- otherwise the baseline outlives the bug
# and quietly re-opens the hole it was meant to hold.
KNOWN_UNREAD = {
    "prometheus.retention": "#1645 -- reads at prometheus.prometheusSpec.retention",
    "prometheus.storageSpec": "#1645 -- reads at prometheus.prometheusSpec.storageSpec",
    "prometheus.externalLabels": "#1645 -- reads at prometheus.prometheusSpec.externalLabels",
    "prometheus.additionalScrapeConfigs": "#1645 -- reads at prometheus.prometheusSpec.additionalScrapeConfigs",
    "prometheus.alertmanager": "#1645 -- chart reads alertmanager.enabled at top level",
    "ingress-nginx": "#1648 -- vendored chart reads .Values.controller.* at root, not under a chart-name block",
}


def key_paths(node, prefix=""):
    """Every dotted key path in a mapping, parents included."""
    out = set()
    if isinstance(node, dict):
        for k, v in node.items():
            p = f"{prefix}.{k}" if prefix else str(k)
            out.add(p)
            out |= key_paths(v, p)
    return out


def load(path):
    """Parse YAML, failing loudly. For a coverage guard every uncertainty
    resolves toward a false green, so an unreadable input is a hard error."""
    try:
        return yaml.safe_load(path.read_text()) or {}
    except (OSError, yaml.YAMLError) as e:
        print(f"FAIL: cannot read {path}: {e}")
        raise SystemExit(2)


def orphans_for(env_tree, block, reference):
    """Key paths the env block sets that the reference chart never defines.

    Only the SHALLOWEST path of each branch is reported: if `prometheus.storageSpec`
    is unread then every path beneath it is too, and listing them all buries the
    one line a human needs to act on.
    """
    if block not in env_tree:
        return []
    ours = key_paths({block: env_tree[block]})
    theirs = key_paths(reference)
    unread = {p for p in ours if p not in theirs and p not in ALLOW}
    return sorted(p for p in unread if not any(p.startswith(q + ".") for q in unread))


def run():
    env_tree = load(ENV)
    seen = set()
    new = []
    for block, ref_path in CASES:
        if not ref_path.exists():
            print(f"FAIL: reference values file missing: {ref_path}")
            return 2
        for p in orphans_for(env_tree, block, load(ref_path)):
            seen.add(p)
            if p not in KNOWN_UNREAD:
                new.append((p, block, ref_path))

    stale = sorted(set(KNOWN_UNREAD) - seen)
    rc = 0

    if new:
        rc = 1
        print("FAIL: env.yaml sets values no chart reads. These are silently "
              "ignored at deploy time -- the file says one thing, the cluster "
              "does another.\n")
        for p, block, ref_path in new:
            print(f"  {p}")
            print(f"      block `{block}:`, chart reference "
                  f"{ref_path.relative_to(ROOT)}")
        print("\nMove each key to the path the chart actually reads, then confirm "
              "by RENDERING the chart and checking the output -- reading the "
              "values file is what let the existing ones through.\n")

    if stale:
        rc = 1
        print("FAIL: KNOWN_UNREAD lists paths that no longer reproduce. If they "
              "were fixed, delete them -- a baseline that outlives its bug "
              "quietly re-opens the hole it was holding.\n")
        for p in stale:
            print(f"  {p}    ({KNOWN_UNREAD[p]})")
        print()

    if rc == 0:
        print(f"OK: {len(CASES)} external chart(s) checked, no new unread key "
              f"paths. {len(KNOWN_UNREAD)} known mis-path(s) still outstanding:")
        for p in sorted(KNOWN_UNREAD):
            print(f"  {p}    ({KNOWN_UNREAD[p]})")
    return rc


def self_test():
    """Prove the detector fires on a mis-path and stays quiet on a correct one."""
    with tempfile.TemporaryDirectory() as td:
        tmp = pathlib.Path(td)

        # A chart that reads foo.barSpec.retention
        ref = tmp / "ref.yaml"
        ref.write_text(yaml.safe_dump({"foo": {"barSpec": {"retention": "10d"}}}))
        reference = load(ref)

        # 1. mis-pathed one level too shallow -- the real bug shape
        bad = {"foo": {"retention": "7d"}}
        got = orphans_for(bad, "foo", reference)
        assert got == ["foo.retention"], f"mis-path not detected: {got}"

        # 2. correct path -- must stay silent
        good = {"foo": {"barSpec": {"retention": "7d"}}}
        got = orphans_for(good, "foo", reference)
        assert got == [], f"false positive on correct config: {got}"

        # 3. a wholly orphaned wrapper block reports the wrapper, not its leaves
        wrapped = {"foo": {"controller": {"metrics": {"enabled": False}}}}
        got = orphans_for(wrapped, "foo", reference)
        assert got == ["foo.controller"], f"wrapper not collapsed: {got}"

        # 4. absent block is not a failure
        assert orphans_for({}, "foo", reference) == []

    print("self-test OK: detects mis-paths and orphaned blocks, "
          "silent on correct configuration")
    return 0


if __name__ == "__main__":
    sys.exit(self_test() if "--self-test" in sys.argv else run())
