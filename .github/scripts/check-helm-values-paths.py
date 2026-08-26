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

One more limit, for whoever extends CASES: key_paths/orphans_for recurse into
`dict` nodes only, never into `list` items. A mis-keyed field inside a list
element -- an `extraVolumes:` / container-array style block -- is therefore NOT
detected; only the list-valued key itself is, at its own path. That is harmless
for the two CASES here (the one list in scope, prometheus.additionalScrapeConfigs,
is caught whole at the top level and baselined as such), but a chart whose
overrides live inside lists needs list recursion added first, or it will be
covered in name only.

Run with --self-test to verify the detection logic itself catches the failure
mode and stays quiet on correct configuration.

Set VALUES_BASELINE_REF to a git ref (CI passes the pull request's base commit)
to additionally verify that the KNOWN_UNREAD baseline has not grown since that
revision. Without it that one check is skipped, loudly.
"""
import ast
import os
import pathlib
import subprocess
import sys
import tempfile

import yaml

SELF = pathlib.Path(__file__).resolve()
ROOT = SELF.parents[2]
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
# This list may only shrink, and that is ENFORCED, not merely asked for: a path
# here that no longer reproduces is a STALE BASELINE and fails the check, and an
# entry ADDED since the base revision fails it too (see baseline_growth). Without
# the second half the rule is unenforceable -- a change that introduces a
# mis-path and lists it here in the same breath makes that path `seen`, so
# neither the new-path check nor the stale check fires.
#
# The five `prometheus.*` entries that used to sit here were removed once PR
# #1659's re-pathing merged into this branch: env.yaml now sets those values
# under prometheus.prometheusSpec.* (and alertmanager at the top level), the
# paths the chart actually reads. Keeping them in KNOWN_UNREAD would be a stale
# baseline re-opening the very hole the guard exists to catch -- the guard goes
# red on exactly that, which is what flagged this cleanup. Only `ingress-nginx`
# (#1648) still needs an entry.
KNOWN_UNREAD = {
    "ingress-nginx": "#1648 -- vendored chart reads .Values.controller.* at root; the helmfile now re-paths this block deliberately (PR #1679), so the env.yaml keys are read via templating rather than by the chart",
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


def passthrough_paths(node, prefix=""):
    """Paths whose reference value is an empty map or null.

    Upstream charts use these for free-form blocks handed straight to
    `toYaml` -- `storageSpec: {}`, `resources: {}`, `nodeSelector: {}`. Any
    structure underneath is valid and IS read, so descending into them and
    demanding each child appear in the reference reports pure noise.

    Found by fixing #1645: re-pathing storageSpec correctly then tripped this
    guard on `storageSpec.volumeClaimTemplate`, which is exactly the shape the
    chart expects. A guard that fails a correct fix is worse than no guard.
    """
    out = set()
    if isinstance(node, dict):
        for k, v in node.items():
            p = f"{prefix}.{k}" if prefix else str(k)
            if v is None or (isinstance(v, dict) and not v):
                out.add(p)
            else:
                out |= passthrough_paths(v, p)
    return out


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
    free = passthrough_paths(reference)
    unread = {
        p for p in ours
        if p not in theirs
        and p not in ALLOW
        # anything below a free-form block is the chart's to interpret
        and not any(p.startswith(f + ".") for f in free)
    }
    return sorted(p for p in unread if not any(p.startswith(q + ".") for q in unread))


# git ref KNOWN_UNREAD is compared against. CI sets it to the pull request's
# base commit; see .github/workflows/deploy-as-code-validation.yml.
BASELINE_REF_ENV = "VALUES_BASELINE_REF"


def known_unread_in_source(src):
    """KNOWN_UNREAD's keys as declared in `src`, or None if it cannot be read.

    The source is PARSED, never executed: another revision of this file is data
    here, not code to run.
    """
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return None
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == "KNOWN_UNREAD"
                for t in node.targets):
            try:
                return set(ast.literal_eval(node.value))
            except ValueError:
                return None
    return None


def known_unread_at(ref):
    """KNOWN_UNREAD's keys as of git `ref`, or None if that revision is unreadable
    (ref unknown, file not there yet, or not a git checkout at all)."""
    try:
        proc = subprocess.run(
            ["git", "-C", str(ROOT), "show",
             f"{ref}:{SELF.relative_to(ROOT).as_posix()}"],
            capture_output=True, text=True)
    except OSError:
        return None
    if proc.returncode != 0:
        return None
    return known_unread_in_source(proc.stdout)


def baseline_growth():
    """(entries added to KNOWN_UNREAD since the base revision, status line).

    The stale check above compares the baseline with the CURRENT env.yaml, which
    cannot enforce "may only shrink": add a mis-path and list it here in the same
    change and the path is `seen`, so nothing fires. Only the previous revision
    of the list catches that, so read it and reject anything new.

    The revision comes from VALUES_BASELINE_REF. Off CI there is no dependable
    answer -- a working tree sits wherever it sits -- so an unset or unreadable
    ref SKIPS this one check loudly rather than crashing or guessing at a base
    and failing a legitimate local run. The run on the pull request is the
    authoritative one and always has the ref. To check locally, point it at the
    merge-base: VALUES_BASELINE_REF=$(git merge-base HEAD origin/develop).
    """
    ref = os.environ.get(BASELINE_REF_ENV, "").strip()
    if not ref:
        return [], (f"baseline-growth check SKIPPED: {BASELINE_REF_ENV} is unset. "
                    f"Set it to a git ref (in CI, the PR base) to verify that "
                    f"KNOWN_UNREAD has not grown.")
    base = known_unread_at(ref)
    if base is None:
        return [], (f"baseline-growth check SKIPPED: no readable revision of this "
                    f"file at {ref} -- new file, unknown ref, or no git checkout.")
    return sorted(set(KNOWN_UNREAD) - base), (
        f"baseline-growth check: KNOWN_UNREAD vs {ref} "
        f"({len(base)} entries there, {len(KNOWN_UNREAD)} here).")


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
    added, baseline_note = baseline_growth()
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
        print("\nThis is the EXPECTED outcome when the fixing pull request lands: "
              "delete the listed entries from KNOWN_UNREAD in that same change. "
              "The five prometheus.* entries all go together with #1659.\n")

    if added:
        rc = 1
        print("FAIL: KNOWN_UNREAD has GROWN. It is a baseline of mis-paths that "
              "predate this guard and may only shrink -- a newly unread key has "
              "to be FIXED, not recorded here. Recording it is how a guard gets "
              "switched off one line at a time, and it is invisible to every "
              "other check in this script: listing the path makes it `seen`.\n")
        for p in added:
            print(f"  {p}    ({KNOWN_UNREAD[p]})")
        print("\nIf an entry genuinely belongs in the baseline -- a pre-existing "
              "mis-path this change only made visible -- say so in the pull "
              "request and have a human agree to it.\n")

    if rc == 0:
        print(f"OK: {len(CASES)} external chart(s) checked, no new unread key "
              f"paths. {len(KNOWN_UNREAD)} known mis-path(s) still outstanding:")
        for p in sorted(KNOWN_UNREAD):
            print(f"  {p}    ({KNOWN_UNREAD[p]})")
    print(baseline_note)
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

        # 5. free-form passthrough blocks: the chart declares `storageSpec: {}`
        #    and hands whatever is underneath to toYaml, so children are valid
        #    and must NOT be reported. Regression test for the false positive
        #    that fixing #1645 exposed.
        ref2 = tmp / "ref2.yaml"
        ref2.write_text(yaml.safe_dump({"foo": {"barSpec": {"storageSpec": {}}}}))
        reference2 = load(ref2)
        deep = {"foo": {"barSpec": {"storageSpec": {
            "volumeClaimTemplate": {"spec": {"resources": {"requests": {"storage": "15Gi"}}}}}}}}
        got = orphans_for(deep, "foo", reference2)
        assert got == [], f"false positive under a free-form block: {got}"

        # ...but a genuine mis-path OUTSIDE the free-form block still fires
        got = orphans_for({"foo": {"storageSpec": {"x": 1}}}, "foo", reference2)
        assert got == ["foo.storageSpec"], f"mis-path masked by passthrough logic: {got}"

    # 6. the baseline-growth guard: it reads KNOWN_UNREAD out of another
    #    revision of this file WITHOUT executing it, fires on an addition, and
    #    stays silent on a removal (the list is allowed to shrink).
    before = known_unread_in_source(
        'KNOWN_UNREAD = {\n    "a.b": "#1 -- reason",\n    "c.d": "#2 -- reason",\n}\n')
    assert before == {"a.b", "c.d"}, f"baseline not parsed: {before}"
    assert sorted({"a.b", "c.d", "e.f"} - before) == ["e.f"], "addition not caught"
    assert sorted({"a.b"} - before) == [], "removal wrongly flagged"

    #    unreadable or absent baselines degrade to "unknown" (-> skipped), never
    #    to a silent pass-by-accident inside the comparison itself
    assert known_unread_in_source("KNOWN_UNREAD = {") is None, "syntax error not handled"
    assert known_unread_in_source("X = 1\n") is None, "absent baseline not handled"
    assert known_unread_in_source(
        "KNOWN_UNREAD = {k: v for k, v in x}") is None, "non-literal not handled"
    assert known_unread_at("definitely-not-a-ref") is None, "bad git ref not handled"

    print("self-test OK: detects mis-paths and orphaned blocks, "
          "silent on correct configuration, and rejects baseline growth")
    return 0


if __name__ == "__main__":
    sys.exit(self_test() if "--self-test" in sys.argv else run())
