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

The guard also refuses to run on inputs it cannot trust, because for a coverage
check every uncertainty resolves toward a false green, and a false green here is
worse than no check at all -- it is a dashboard people believe. So a missing
source file, or an ambiguous network alias, is a hard failure rather than a skip.

Sources of truth (every one of these names BOTH extensions on purpose -- betting a
coverage gap on a file-naming convention nothing enforces is how they hide):
  compose:  every local-setup/**/*compose*.{yml,yaml} -- enumerated in COMPOSE_FILES and
            cross-checked against the directory so a new one cannot go unscanned.
            Not just `docker-compose*` at the top level: `compose.yaml` is docker
            compose's default, highest-precedence name, and would shadow
            docker-compose.yml for the bare `docker compose up -d` CI runs.
  k3s:      local-setup/k8s/**/*.{yaml,yml}      (kind: Service)
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

# Every compose file in local-setup/ whose services must be covered.
#
#   docker-compose.yml          the local / CI path (.github/workflows/local-setup-ci.yaml
#                               runs a bare `docker compose up -d` against it).
#   docker-compose.egov-digit.yaml
#                               the tenant path -- never docker-compose.yml. ansible
#                               deploys this file plus the fast-path/migrations overlays
#                               AND a per-tenant overlay when one exists, i.e.
#                               docker-compose.<inventory_hostname>.yml -- which is what
#                               docker-compose.bomet.yml is. See playbook-deploy.yml
#                               "Compute compose -f flags (fast-path + migrations +
#                               per-tenant overlay)".
#   deploy.yaml / registry.yml / db-migrations.yml / core.yml
#                               variants that mostly duplicate the above, but are real
#                               usage paths of their own (the digit-mcp docs deploy with
#                               deploy.yaml). They contributed nothing but duplicate
#                               names when this list was written, which is exactly why
#                               they were left out -- and that reasoning was wrong: a
#                               *future* service unique to one of them would have slipped
#                               through silently. Scanning a file whose services are all
#                               duplicates costs nothing; not scanning it costs coverage.
#   docker-compose.tilt.yml     image-override overlay for the hot-reload Tiltfile (#1288).
#                               Overrides `image:` on pgr-services/digit-ui only, so it adds
#                               no service of its own -- listed because the check below
#                               requires every compose file on disk to be accounted for,
#                               and "adds nothing today" is exactly the assumption that
#                               went stale for the five files above.
#   docker-compose.monitoring.yml
#                               host-metrics overlay (#1335): adds node-exporter, always
#                               layered by ansible alongside the migrations overlay. Its
#                               one service is observability plumbing and is EXEMPT below
#                               (same call as grafana/prometheus/otel-collector) -- but the
#                               file still has to be listed here, or find_unlisted_compose_files
#                               fails it as a compose file the guard does not scan.
#
# This list is the guard's whole perimeter. Anything not in it is unwatched, so it is
# checked against the directory listing below rather than maintained by memory.
#
# NOTE: .github/workflows/gatus-coverage.yml watches `local-setup/**`, so it already
# triggers on every entry here wherever it lives -- adding one needs no change there. Do
# not narrow that filter to a list of names: when a paths: filter guesses wrong the
# workflow never runs, so the guard cannot report what it was never invoked to see.
COMPOSE_FILES = [
    LS / "docker-compose.yml",
    LS / "docker-compose.egov-digit.yaml",
    LS / "docker-compose.migrations.yml",
    LS / "docker-compose.migrations.ansible.yml",
    LS / "docker-compose.fast-path.yml",
    LS / "docker-compose.deploy.yaml",
    LS / "docker-compose.registry.yml",
    LS / "docker-compose.db-migrations.yml",
    LS / "docker-compose.bomet.yml",
    LS / "docker-compose.core.yml",
    LS / "docker-compose.tilt.yml",
    LS / "docker-compose.monitoring.yml",
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
    # k3s tier or in docker-compose.yml: they are defined in
    # docker-compose.egov-digit.yaml, and grafana/tempo/otel-collector also in
    # docker-compose.registry.yml.
    "grafana": "observability plumbing: dashboards UI, not a serving dependency",
    "prometheus": "observability plumbing: metrics store, not a serving dependency",
    "loki": "observability plumbing: log store, not a serving dependency",
    "tempo": "observability plumbing: trace store, not a serving dependency",
    "otel-collector": "observability plumbing: telemetry pipeline, not a serving dependency",
    "node-exporter": "observability plumbing: host-metrics exporter (#1335), not a serving dependency; scraped by prometheus, absent from k3s tier and docker-compose.yml",
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
#
# A suffix alone is NOT enough to exempt a service: the name is a hint, the absence
# of a listening port is the evidence. Exempting on the name alone meant any future
# service called `session-init` or `search-seed` was waived through no matter how
# long-lived it was -- reopening, for a whole class of names, exactly the "forgotten
# by construction" gap this guard exists to close. See _is_exempt.
EXEMPT_SUFFIXES = ("-migration", "-migrations", "-seed", "-init")


def _is_exempt(name: str, listens: bool = True):
    """Reason this service needs no Gatus check, or None if it needs one.

    `listens` says whether the service publishes a port (compose `ports`/`expose`,
    or a k8s Service, which by definition fronts one). It defaults to True so that
    the conservative answer -- "this must be monitored" -- is what you get when the
    caller cannot prove otherwise.
    """
    if name in EXEMPT:
        return EXEMPT[name]
    for suf in EXEMPT_SUFFIXES:
        if name.endswith(suf):
            if listens:
                # Named like a one-shot but holds a port open: not a one-shot.
                # Monitor it, or give it an explicit EXEMPT entry with a reason.
                return None
            return f"one-shot: matches '*{suf}' and publishes no port"
    return None


class _StrictLoader(yaml.SafeLoader):
    """SafeLoader that rejects duplicate mapping keys instead of last-key-wins.

    PyYAML silently keeps the last of a repeated key; `docker compose` rejects the
    file outright. That gap is a false green with the guard's name on it: the file
    docker compose refuses to parse at all is one this guard would happily certify,
    reading a mangled half-parse as fact.

    It is not hypothetical. docker-compose.db-migrations.yml had `db-seed:` indented
    4 spaces instead of 2, so it merged into the preceding pgr-workflow-seed service:
    `db-seed` vanished as a service, pgr-workflow-seed silently became postgres:16,
    and user-seed depended on a service that did not exist. Broken since a7286953,
    the first local-setup commit, and read as valid by every yaml.safe_load in here.
    """


_MERGE_TAG = "tag:yaml.org,2002:merge"


def _no_duplicate_keys(loader, node, deep=False):
    """Reject keys written twice in the same mapping; allow everything else.

    Only *explicit* keys are checked, and the check runs before any merge key is
    resolved. Both details matter:

      * `<<: *anchor` is the standard way to DRY up compose files, and it is valid
        input -- `docker compose config` accepts it. Rejecting it would be a false
        RED, which is the same sin as a false green wearing the other hat.
      * a merge deliberately supplies keys that an explicit one may then override
        (that is what merge means). Those collide by design, so checking after the
        merge is flattened would fail the very idiom this is meant to permit.

    So: scan the raw pairs, skip the merge keys, then hand off to SafeConstructor,
    which flattens the merge itself and lets explicit keys win as YAML specifies.
    """
    seen = {}
    for key_node, _ in node.value:
        if key_node.tag == _MERGE_TAG:
            continue
        key = loader.construct_object(key_node, deep=deep)
        if key in seen:
            raise yaml.constructor.ConstructorError(
                None, None,
                f"duplicate key {key!r} on line {key_node.start_mark.line + 1} "
                f"(first defined on line {seen[key] + 1}). PyYAML keeps the last one "
                f"silently, so whatever the first said is gone and this guard cannot "
                f"trust what it just read. Usually a key indented one level too deep, "
                f"merging into its predecessor.",
                key_node.start_mark,
            )
        seen[key] = key_node.start_mark.line
    return loader.construct_mapping(node, deep=deep)


_StrictLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _no_duplicate_keys
)


def _rel(p: pathlib.Path) -> str:
    """Repo-relative path for messages; falls back to the full path (self-test tmpdirs)."""
    try:
        return str(p.relative_to(ROOT))
    except ValueError:
        return str(p)


def _load_strict(text: str, where: str):
    """Parse YAML, refusing a document with duplicate keys.

    EVERY input this guard reads goes through here -- compose files, k8s manifests,
    and both gatus configs. Not just compose: the first cut hardened only
    compose_targets and left the other three loads on plain safe_load, so the
    docstring's "refuses to run on inputs it cannot trust" was true of a quarter of
    the inputs. A duplicate `kind:` in a k8s manifest silently dropped that Service
    out of the perimeter and the guard still printed OK.
    """
    try:
        return yaml.load(text, Loader=_StrictLoader) or {}
    except yaml.YAMLError as e:
        raise GuardError(f"{where} is not trustworthy YAML: {e}")


def _load_all_strict(text: str, where: str):
    """Same, for multi-document YAML (k8s manifests)."""
    try:
        return [d for d in yaml.load_all(text, Loader=_StrictLoader) if d]
    except yaml.YAMLError as e:
        raise GuardError(f"{where} is not trustworthy YAML: {e}")


def _stub_vars(text: str) -> str:
    """Gatus reads ${VAR} itself; make the YAML parseable without resolving them."""
    return re.sub(r"\$\{([A-Z0-9_]+)(:-[^}]*)?\}", r"__\1__", text)


class GuardError(Exception):
    """The guard cannot trust its own inputs. Never a silent pass."""


def compose_targets(paths):
    """({reachable dns name -> service name}, {service -> publishes a port}).

    Includes network aliases, because a Gatus URL names the DNS host, and the
    host is often an alias rather than the service (postgres -> pgbouncer).
    """
    names, aliases, listens = {}, {}, {}
    for p in paths:
        if not p.exists():
            # Skipping a missing source used to be a `continue`, which made the
            # guard pass while reading nothing: rename docker-compose.yml away and
            # it still reported OK. A source it cannot read is a broken guard, and
            # a broken guard must fail loudly rather than certify an empty perimeter.
            raise GuardError(
                f"{_rel(p)} is listed in COMPOSE_FILES but does not exist. "
                f"If it was renamed or removed, update COMPOSE_FILES (and the paths: "
                f"filters in .github/workflows/gatus-coverage.yml) to match."
            )
        doc = _load_strict(_stub_vars(p.read_text()), _rel(p))
        for svc, body in (doc.get("services") or {}).items():
            body = body or {}
            names[svc] = svc
            # A service may appear in several files (overlays override the base);
            # if it publishes a port in any of them, it listens.
            listens[svc] = listens.get(svc, False) or bool(body.get("ports") or body.get("expose"))
            nets = body.get("networks")
            if isinstance(nets, dict):
                for net in nets.values():
                    for a in ((net or {}).get("aliases") or []):
                        prev = aliases.get(a)
                        if prev is not None and prev != svc:
                            raise GuardError(
                                f"network alias '{a}' is claimed by two services "
                                f"('{prev}' and '{svc}'). One would silently absorb the "
                                f"other's Gatus check. Give them distinct aliases."
                            )
                        aliases[a] = svc

    # An alias that shadows a real service name is the dangerous case: `names.update`
    # below would overwrite the real service's own entry, so it vanishes as a required
    # target and the impostor inherits its check. That is precisely how a dead
    # postgres-db could hide behind a live pooler -- the bug this dashboard exists to
    # catch -- reintroduced with zero CI signal.
    for a, svc in aliases.items():
        if a in names and a != svc:
            raise GuardError(
                f"network alias '{a}' on service '{svc}' shadows the real service "
                f"named '{a}'. The alias would absorb '{a}'s Gatus check and '{a}' "
                f"itself would no longer need monitoring. Rename the alias."
            )

    names.update(aliases)
    return names, listens


def find_unlisted_compose_files():
    """Compose files on disk that COMPOSE_FILES does not scan.

    The perimeter must not be maintained from memory: a new docker-compose.*.yml is
    invisible to this guard until it is listed, and invisible is indistinguishable
    from covered. Adding one now forces the decision.
    """
    listed = {p.resolve() for p in COMPOSE_FILES}
    # rglob, and *compose* rather than docker-compose*: `compose.yaml` is docker
    # compose's DEFAULT, highest-precedence filename -- it would shadow
    # docker-compose.yml for the bare `docker compose up -d` that local-setup-ci runs,
    # while sitting wholly outside this perimeter. A name-shaped check only sees the
    # names it already expects.
    on_disk = {p.resolve() for p in LS.rglob("*compose*.yml")} | \
              {p.resolve() for p in LS.rglob("*compose*.yaml")}
    return sorted(str(p.relative_to(LS)) for p in on_disk - listed)


def k8s_targets(root: pathlib.Path):
    """{reachable dns name -> canonical workload} for every k8s Service.

    Two Services with the same selector front the same pods, so one is an alias
    of the other -- `kafka` and `redpanda` both select app=redpanda. Checking
    either covers the workload, so they collapse to one target. Without this,
    the alias Service looks unmonitored and CI cries wolf.

    Both .yaml and .yml are read. Everything under k8s/ happens to be .yaml today,
    so globbing one extension looks fine and silently drops the first Service anyone
    writes as .yml -- unmonitored, with the guard still green. That is the same
    assumption that made the docstring's compose glob wrong, and it is not worth
    betting a coverage gap on a file-naming convention nobody enforces.
    """
    docs = []
    for f in sorted(set(root.rglob("*.yaml")) | set(root.rglob("*.yml"))):
        docs.extend(_load_all_strict(_stub_vars(f.read_text()), _rel(f)))
    return k8s_targets_from_docs(docs)


def k8s_targets_from_docs(docs):
    """Collapse Services by selector; see k8s_targets. Split out to be testable."""
    by_selector = {}
    for doc in docs:
        if doc.get("kind") != "Service":
            continue
        name = doc["metadata"]["name"]
        sel = doc.get("spec", {}).get("selector") or {}
        # Namespace is part of the identity: two Services in different namespaces with
        # the same selector front DIFFERENT workloads, and collapsing them would mask
        # one. Everything is in `digit` today, which is exactly when this looks safe.
        ns = doc["metadata"].get("namespace", "default")
        key = (ns, tuple(sorted(sel.items()))) if sel else (ns, "__none__", name)
        by_selector.setdefault(key, []).append((ns, name))

    def _grp(k):
        if len(k) == 3:            # (ns, "__none__", name): no selector
            return f"namespace={k[0]}, no selector"
        sel_d = dict(k[1])
        return f"namespace={k[0]}, selector={sel_d}" if sel_d else f"namespace={k[0]}, no selector"
    # The grouping key carries namespace, but the returned map is keyed by bare Service
    # NAME, because that is all a Gatus URL gives us to match on (`_hosts` extracts a
    # hostname, which has no namespace). So two Services that share a name cannot both be
    # represented -- see the two collision branches below.
    out = {}
    owner = {}   # Service name -> the (ns, selector) group key that first claimed it
    for gkey, group in by_selector.items():
        canonical = sorted(n for _, n in group)[0]
        for _ns, n in group:
            if n in out:
                if owner[n] == gkey:
                    # Same name, namespace AND selector: the same workload declared
                    # twice (a copy-pasted or duplicated manifest), not a collision
                    # between two different workloads. "rename one" would be wrong --
                    # it would leave two live Services doing the same thing.
                    raise GuardError(
                        f"k8s Service {n!r} is declared more than once with the same "
                        f"name, namespace and selector ({_grp(gkey)}) -- a duplicate "
                        f"manifest, not a naming collision. Remove the duplicate."
                    )
                # Same name, DIFFERENT workload (different namespace and/or selector).
                # A Gatus URL names only the host, so this map cannot represent both,
                # and one's coverage would reattribute to the other. Fail loud rather
                # than pick a winner, as compose_targets does for a shadowing alias.
                # Not reachable on today's tree (everything is one workload per name);
                # a hard error rather than an (ns, name) key, which would break every
                # downstream targets[host] lookup since hosts carry no namespace.
                raise GuardError(
                    f"two k8s Services are both named {n!r} but front different "
                    f"workloads ({_grp(owner[n])} vs {_grp(gkey)}). A Gatus URL names "
                    f"only the host, so this map cannot tell them apart and one's "
                    f"coverage would reattribute to the other. Rename one."
                )
            out[n] = canonical
            owner[n] = gkey
    return out


def _is_literally_disabled(endpoint) -> bool:
    """True only for `enabled: false` written as a literal in the file.

    A `${GATUS_PROFILE_*}` value is NOT disabled: it is resolved at runtime to match
    what that deployment actually runs, which is the whole point of the toggles, and
    static analysis cannot know the answer. (_stub_vars has already rewritten those
    to __NAME__ by the time we get here, so they read as neither true nor false.)

    A literal `false`, though, is knowable right now: the endpoint is inert in every
    deployment, so counting it as coverage means the dashboard claims a service is
    watched by a probe that can never run.
    """
    return endpoint.get("enabled") is False


_STUB = re.compile(r"^__[A-Z0-9_]+__$")   # what _stub_vars leaves behind for ${VAR}


# Gatus's ConvertGroupAndEndpointNameToKey lowercases each of group and name and folds
# these characters to '-', then joins the two with '_'.
_GATUS_FOLD = str.maketrans({c: "-" for c in "/_.,# "})


def _gatus_key(endpoint) -> str:
    """Gatus's own identity for an endpoint, matching ConvertGroupAndEndpointNameToKey.

    Each of group and name is sanitised FIRST (lowercase, fold / _ . , # and space to
    '-'), and only then joined with '_'. Sanitising before the join is what keeps the
    key injective and faithful to Gatus:

      * injective -- a literal '_' inside a component becomes '-', so (group='A_B',
        name='C') -> 'a-b_c' and (group='A', name='B_C') -> 'a_b-c' stay distinct.
        The earlier version joined first and folded only spaces, collapsing both to
        'a_b_c' -- a fabricated duplicate (false red) Gatus would never raise, since
        Gatus folds the underscores too.
      * faithful -- a bare tuple (group, name) would be injective but would treat
        'A B' and 'A-B' as different, whereas Gatus folds both to 'a-b'; that could
        MISS a real Gatus duplicate (a false green). Matching Gatus's own folding is
        the only key that agrees with the tool this guard is modelling.
    """
    def fold(x):
        return str(x).lower().translate(_GATUS_FOLD)
    return f"{fold(endpoint.get('group', ''))}_{fold(endpoint.get('name', ''))}"


def _validate_endpoints(endpoints, where):
    """Reject a Gatus config Gatus itself would refuse to start on.

    The guard validated its own model of the config and never asked whether Gatus
    could load it, so it green-lit files that make the dashboard die on boot -- the
    exact failure the duplicate-key work exists to prevent, one level up. Both of
    these were verified against twinproduction/gatus:latest:

      * two endpoints sharing (group, name) ->
            panic: invalid endpoint infrastructure_postgresql:
                   name and group combination must be unique
        and the guard printed `OK ... 51 endpoints per tier, no drift` -- contradicting
        itself in its own success line: find_drift keyed by name at the time, so the
        duplicate silently vanished. (It keys by group+name now -- same identity as
        this check -- but a duplicate still has to be rejected here, because two
        endpoints with one identity collapse wherever they are keyed.)
      * `enabled: "false"` (quoted) ->
            panic: cannot unmarshal !!str `false` into bool
        and the guard counted it as live coverage, since `"false" is False` is False.
    """
    seen = {}
    for e in endpoints:
        key = _gatus_key(e)
        if key in seen:
            raise GuardError(
                f"{where}: two endpoints share the group+name {key!r} "
                f"({seen[key]!r} and {e.get('name')!r}). Gatus refuses to start on this "
                f"(\"name and group combination must be unique\"), and the drift check "
                f"keys by group+name too, so the duplicate would collapse there silently."
            )
        seen[key] = e.get("name")

        enabled = e.get("enabled")
        if enabled is None or isinstance(enabled, bool):
            continue
        if isinstance(enabled, str) and _STUB.match(enabled):
            continue          # ${GATUS_PROFILE_*}: resolved at runtime, not our business
        raise GuardError(
            f"{where}: endpoint {e.get('name')!r} has enabled: {enabled!r}, which is "
            f"neither a bool nor a ${{VAR}}. Gatus unmarshals `enabled` into a bool and "
            f"panics on anything else (a quoted \"false\" is a string, not false)."
        )


def _hosts(endpoints):
    """Hostname of each ENABLED endpoint URL, e.g. http://egov-user:8107/x -> egov-user.

    Literally-disabled endpoints are skipped, so they cannot pass as coverage.
    """
    hosts = set()
    for e in endpoints:
        if _is_literally_disabled(e):
            continue
        m = re.match(r"^[a-z]+://([^:/]+)", str(e.get("url", "")))
        if m:
            hosts.add(m.group(1))
    return hosts


def gatus_compose_endpoints():
    doc = _load_strict(_stub_vars(GATUS_COMPOSE.read_text()), _rel(GATUS_COMPOSE))
    eps = doc.get("endpoints") or []
    _validate_endpoints(eps, _rel(GATUS_COMPOSE))
    return eps


def gatus_k8s_endpoints():
    for doc in _load_all_strict(_stub_vars(GATUS_K8S.read_text()), _rel(GATUS_K8S)):
        if doc.get("kind") == "ConfigMap" and "config.yaml" in (doc.get("data") or {}):
            # The embedded config is its own YAML document; a duplicate key in there
            # is just as untrustworthy as one in the manifest around it.
            where = f"{_rel(GATUS_K8S)} (embedded config.yaml)"
            inner = _load_strict(_stub_vars(doc["data"]["config.yaml"]), where)
            eps = inner.get("endpoints") or []
            _validate_endpoints(eps, where)
            return eps
    return []


def find_unmonitored(targets, monitored_hosts, listens=None):
    """Services with no endpoint pointing at them (or any of their aliases).

    `listens` maps service -> publishes a port. Anything absent from it is assumed
    to listen, so a service can never be exempted by a name suffix on the strength
    of missing information.
    """
    listens = listens or {}
    covered = {targets[h] for h in monitored_hosts if h in targets}
    missing = []
    for svc in sorted(set(targets.values())):
        if svc in covered or _is_exempt(svc, listens.get(svc, True)):
            continue
        missing.append(svc)
    return missing


def find_dangling(monitored_hosts, all_targets):
    return sorted(h for h in monitored_hosts if h not in all_targets)


def find_drift(compose_eps, k8s_eps):
    """Endpoints in one tier only, or differing between tiers.

    Keyed by _gatus_key (group+name), not name alone. Gatus's identity for an
    endpoint is the pair, and _validate_endpoints deliberately permits the same name
    in different groups -- so keying by name let two legitimate endpoints collapse
    into one dict entry, last-wins, and took the drift with them. Both of these
    reported "no drift" while keying by name:

        Core/Health diverges, Optional/Health identical -> differs=[]  (last wins,
            so the tier that actually diverged was never compared)
        Core/Health missing from k3s entirely           -> only_compose=[]

    That is failure mode 3 -- the one this function exists for -- going silent.
    """
    a = {_gatus_key(e): e for e in compose_eps}
    b = {_gatus_key(e): e for e in k8s_eps}
    only_compose = sorted(set(a) - set(b))
    only_k8s = sorted(set(b) - set(a))
    differing = sorted(
        k for k in (set(a) & set(b))
        if json.dumps(a[k], sort_keys=True) != json.dumps(b[k], sort_keys=True)
    )
    return only_compose, only_k8s, differing


def report() -> int:
    ctargets, clistens = compose_targets(COMPOSE_FILES)
    ktargets = k8s_targets(K8S_DIR)
    ceps, keps = gatus_compose_endpoints(), gatus_k8s_endpoints()
    chosts, khosts = _hosts(ceps), _hosts(keps)

    rc = 0

    unlisted = find_unlisted_compose_files()
    if unlisted:
        rc = 1
        print("FAIL: compose files this guard does not scan "
              "(add them to COMPOSE_FILES and to both paths: filters in "
              ".github/workflows/gatus-coverage.yml, or this guard is blind to them):")
        for f in unlisted:
            print(f"  - {f}")

    unmon_c = find_unmonitored(ctargets, chosts, clistens)
    if unmon_c:
        rc = 1
        print("FAIL: compose services with no Gatus check "
              "(add one to local-setup/gatus/config.yaml, or add to EXEMPT with a reason):")
        for s in unmon_c:
            print(f"  - {s}")

    # Every k8s Service fronts a port by definition, so none can claim the
    # one-shot suffix exemption; listens defaults to True for all of them.
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
    if find_unmonitored({"foo-migration": "foo-migration"}, set(), {"foo-migration": False}) != []:
        failures.append("'*-migration' suffix with no port was wrongly reported as unmonitored")

    # 2b. the suffix exemption is evidence-based, not name-based: a service named
    #     like a one-shot but holding a port open is NOT a one-shot and must be
    #     monitored. Without this, any future `session-init` is silently waived.
    if find_unmonitored({"session-init": "session-init"}, set(), {"session-init": True}) != ["session-init"]:
        failures.append("a port-publishing '*-init' was wrongly exempted by its name alone")
    # ...and an unknown service defaults to "must be monitored" rather than exempt.
    if find_unmonitored({"mystery-seed": "mystery-seed"}, set()) != ["mystery-seed"]:
        failures.append("'*-seed' with unknown port status defaulted to exempt instead of monitored")
    # An explicit EXEMPT entry still wins regardless of ports.
    if _is_exempt("gatus", listens=True) is None:
        failures.append("explicit EXEMPT entry stopped applying to a listening service")

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

    # 3d. the grouping key is namespace-aware, but the returned map is keyed by bare
    #     Service name (a Gatus host has no namespace). Two same-named Services in
    #     different namespaces front different workloads and cannot both be represented,
    #     so the flatten must fail loud rather than silently overwrite one -- otherwise
    #     the very cross-namespace masking the (ns, selector) key prevents at grouping
    #     time reappears one loop later at flatten time.
    #     ...and the message must fit the collision. Different workloads sharing a name
    #     ("front different workloads ... Rename one"):
    try:
        k8s_targets_from_docs([
            {"kind": "Service", "metadata": {"name": "redis", "namespace": "ns-a"},
             "spec": {"selector": {"app": "redis-a"}}},
            {"kind": "Service", "metadata": {"name": "redis", "namespace": "ns-b"},
             "spec": {"selector": {"app": "redis-b"}}},
        ])
        failures.append("two same-named Services in different namespaces collapsed silently")
    except GuardError as e:
        if "different" not in str(e).lower():
            failures.append(f"cross-workload collision got the wrong message: {e}")

    # 3e. the SAME workload declared twice (duplicate manifest) is the only collision
    #     reachable on today's tree, and must not be described as "different workloads"
    #     or told to "rename one" -- the fix is to delete the duplicate.
    try:
        k8s_targets_from_docs([
            {"kind": "Service", "metadata": {"name": "redis", "namespace": "digit"},
             "spec": {"selector": {"app": "redis"}}},
            {"kind": "Service", "metadata": {"name": "redis", "namespace": "digit"},
             "spec": {"selector": {"app": "redis"}}},
        ])
        failures.append("a duplicate k8s manifest was not caught")
    except GuardError as e:
        if "duplicate" not in str(e).lower() or "different workloads" in str(e).lower():
            failures.append(f"duplicate manifest got the cross-workload message: {e}")

    # 4. a dangling check is caught
    if find_dangling({"ghost"}, {"real": "real"}) != ["ghost"]:
        failures.append("dangling detector missed a check with no service")

    # 5. tier drift is caught, in both directions and on value changes.
    #    Keys are _gatus_key (group+name, lowercased) -- gatus's own identity.
    a = [{"name": "X", "group": "G", "url": "http://x:1/h"},
         {"name": "OnlyC", "group": "G", "url": "http://c:1/h"}]
    b = [{"name": "X", "group": "G", "url": "http://x:2/h"},
         {"name": "OnlyK", "group": "G", "url": "http://k:1/h"}]
    only_c, only_k, differ = find_drift(a, b)
    if only_c != ["g_onlyc"] or only_k != ["g_onlyk"] or differ != ["g_x"]:
        failures.append(
            f"drift detector missed only-compose / only-k3s / differing endpoints: "
            f"{only_c} {only_k} {differ}")

    # 5b. two endpoints may legitimately share a NAME in different GROUPS -- gatus's
    #     identity is the pair, and _validate_endpoints permits it. Keying drift by
    #     name alone collapsed them last-wins and took the drift with them.
    same_name_c = [{"name": "Health", "group": "Core", "url": "http://a:1/h"},
                   {"name": "Health", "group": "Optional", "url": "http://b:2/h"}]
    #     the FIRST one diverges; the last is identical, so last-wins hid it entirely
    same_name_k = [{"name": "Health", "group": "Core", "url": "http://GHOST:9/h"},
                   {"name": "Health", "group": "Optional", "url": "http://b:2/h"}]
    if find_drift(same_name_c, same_name_k)[2] != ["core_health"]:
        failures.append("drift hid in a same-name/different-group pair (divergence)")
    #     ...and a whole endpoint missing from one tier must not vanish either
    if find_drift(same_name_c, [same_name_c[1]])[0] != ["core_health"]:
        failures.append("drift hid in a same-name/different-group pair (missing endpoint)")

    # 6. identical catalogues are clean
    if any(find_drift(a, a)):
        failures.append("drift detector reported drift between a catalogue and itself")

    # 7. URL host extraction handles tcp:// and ${VAR} ports
    got = _hosts([{"url": "tcp://postgres-db:5432"},
                  {"url": "http://egov-notification-sms:__GATUS_SMS_PORT__/x/health"}])
    if got != {"postgres-db", "egov-notification-sms"}:
        failures.append(f"host extraction wrong: {got}")

    # 8. the guard refuses to run on inputs it cannot trust, rather than passing.
    #    Each of these used to be a silent green.
    import tempfile

    def _expect_guard_error(what, write):
        with tempfile.TemporaryDirectory() as td:
            p = pathlib.Path(td) / "docker-compose.probe.yml"
            p.write_text(write)
            try:
                compose_targets([p])
            except GuardError:
                return
            failures.append(what)

    # 8a. a COMPOSE_FILES entry that does not exist must be fatal, not skipped.
    try:
        compose_targets([LS / "docker-compose.NOT-A-REAL-FILE.yml"])
        failures.append("a missing compose file was silently skipped instead of failing")
    except GuardError:
        pass

    # 8b. two services claiming one alias: one would absorb the other's check.
    _expect_guard_error(
        "two services sharing a network alias were silently collapsed",
        "services:\n"
        "  svc-a: {networks: {digit: {aliases: [shared]}}}\n"
        "  svc-b: {networks: {digit: {aliases: [shared]}}}\n",
    )

    # 8c. an alias shadowing a real service name: the postgres-db masking case.
    _expect_guard_error(
        "an alias shadowing a real service name silently hijacked its coverage",
        "services:\n"
        "  postgres-db: {ports: ['5432:5432']}\n"
        "  evil-svc: {networks: {digit: {aliases: [postgres-db]}}}\n",
    )

    # 8e. a duplicate key -- PyYAML keeps the last silently, docker compose rejects
    #     the file. Reading a mangled half-parse as fact is a false green.
    _expect_guard_error(
        "a duplicate mapping key was silently last-key-wins'd instead of failing",
        "services:\n"
        "  svc-a:\n"
        "    image: curl\n"
        "    image: postgres:16\n",
    )

    # 8f. the real shape it takes: a service key mis-indented into its predecessor,
    #     which is how db-seed vanished out of docker-compose.db-migrations.yml.
    _expect_guard_error(
        "a mis-indented service key merged into its predecessor without complaint",
        "services:\n"
        "  first-svc:\n"
        "    image: curl\n"
        "    restart: 'no'\n"
        "    second-svc:\n"          # 4 spaces: merges into first-svc
        "    image: postgres:16\n",  # -> duplicate 'image' on first-svc
    )

    # 8d. a legitimate alias (postgres -> pgbouncer) must still be accepted, and
    #     the same alias repeated across overlay files is not a collision.
    with tempfile.TemporaryDirectory() as td:
        a = pathlib.Path(td) / "docker-compose.a.yml"
        b = pathlib.Path(td) / "docker-compose.b.yml"
        a.write_text("services:\n  pgbouncer: {ports: ['5432'], networks: {digit: {aliases: [postgres]}}}\n")
        b.write_text("services:\n  pgbouncer: {networks: {digit: {aliases: [postgres]}}}\n")
        try:
            targets, listens = compose_targets([a, b])
            if targets.get("postgres") != "pgbouncer":
                failures.append(f"legitimate alias was not resolved: {targets}")
            if not listens.get("pgbouncer"):
                failures.append("port published in one overlay file was lost when merging files")
        except GuardError as e:
            failures.append(f"legitimate repeated alias wrongly rejected: {e}")

    # 8g. the strict loader must not become a FALSE RED. `<<: *anchor` is the standard
    #     way to DRY up compose files and `docker compose config` accepts it, so the
    #     guard has to as well -- including the override case, where an explicit key
    #     deliberately beats the merged one and is NOT a duplicate.
    def _expect_accepted(what, text, check=None):
        with tempfile.TemporaryDirectory() as td:
            p = pathlib.Path(td) / "docker-compose.probe.yml"
            p.write_text(text)
            try:
                doc = _load_strict(p.read_text(), "probe")
            except GuardError as e:
                failures.append(f"{what}: {e}")
                return
            if check and not check(doc):
                failures.append(f"{what}: parsed, but merge semantics are wrong: {doc}")

    _expect_accepted(
        "a plain '<<: *anchor' merge was rejected as untrustworthy",
        "x-common: &common\n  restart: always\nservices:\n  svc-a:\n    <<: *common\n    image: curl\n",
        lambda d: d["services"]["svc-a"]["restart"] == "always",
    )
    _expect_accepted(
        "an explicit key overriding a merged one was miscounted as a duplicate",
        "x-common: &common\n  restart: always\nservices:\n  svc-a:\n    <<: *common\n"
        "    restart: 'no'\n    image: curl\n",
        lambda d: d["services"]["svc-a"]["restart"] == "no",  # explicit must win
    )

    # 8h. strictness must apply to EVERY input, not just compose. A duplicate key in a
    #     k8s manifest silently dropped that Service out of the perimeter while the
    #     guard printed OK -- the same last-key-wins class, three loads it did not cover.
    try:
        _load_all_strict("kind: Service\nkind: ConfigMap\n", "probe")
        failures.append("multi-doc loader accepted a duplicate key instead of failing")
    except GuardError:
        pass
    #     ...and a legitimate multi-document manifest still parses.
    try:
        docs = _load_all_strict("kind: Service\nmetadata: {name: a}\n---\nkind: Deployment\n", "probe")
        if [d.get("kind") for d in docs] != ["Service", "Deployment"]:
            failures.append(f"multi-doc loader mangled a valid manifest: {docs}")
    except GuardError as e:
        failures.append(f"multi-doc loader rejected a valid manifest: {e}")

    # 8j. k8s manifests are read as BOTH .yaml and .yml. Everything under k8s/ is
    #     .yaml today, so a one-extension glob looks fine and silently drops the first
    #     Service anyone writes as .yml -- unmonitored, guard still green.
    with tempfile.TemporaryDirectory() as td:
        root = pathlib.Path(td)
        (root / "a.yaml").write_text(
            "apiVersion: v1\nkind: Service\nmetadata: {name: svc-yaml}\nspec: {selector: {app: a}}\n")
        (root / "b.yml").write_text(
            "apiVersion: v1\nkind: Service\nmetadata: {name: svc-yml}\nspec: {selector: {app: b}}\n")
        got = set(k8s_targets(root))
        if got != {"svc-yaml", "svc-yml"}:
            failures.append(f"k8s manifest glob missed an extension: saw {sorted(got)}")

    # 8i. a literally-disabled endpoint is not coverage: it can never run, in any
    #     deployment, so counting it means claiming a probe that does nothing.
    if _hosts([{"url": "tcp://postgres-db:5432", "enabled": False}]):
        failures.append("an `enabled: false` endpoint was counted as coverage")
    #     ...but a ${GATUS_PROFILE_*} endpoint IS coverage -- it is resolved at runtime
    #     to match what that deployment runs, which static analysis cannot second-guess.
    #     (_stub_vars has already rewritten it to __NAME__ by this point.)
    if _hosts([{"url": "tcp://postgres-db:5432", "enabled": "__GATUS_PROFILE_MCP__"}]) != {"postgres-db"}:
        failures.append("a runtime-gated ${GATUS_PROFILE_*} endpoint was wrongly discounted")
    #     ...and an endpoint with no `enabled:` at all is enabled (Gatus's own default).
    if _hosts([{"url": "tcp://postgres-db:5432"}]) != {"postgres-db"}:
        failures.append("an endpoint with no `enabled:` key was wrongly discounted")

    # 8k. the guard must not certify a config Gatus itself panics on. Both of these
    #     were verified against twinproduction/gatus:latest.
    def _expect_endpoint_error(what, eps):
        try:
            _validate_endpoints(eps, "probe")
        except GuardError:
            return
        failures.append(what)

    #     duplicate (group, name): "name and group combination must be unique"
    _expect_endpoint_error(
        "two endpoints sharing group+name passed -- gatus would refuse to start",
        [{"name": "PostgreSQL", "group": "Infrastructure", "url": "tcp://postgres-db:5432"},
         {"name": "PostgreSQL", "group": "Infrastructure", "url": "tcp://redis:6379"}],
    )
    #     ...case/spacing folded the way gatus folds it, so `Foo Bar` == `foo-bar`.
    _expect_endpoint_error(
        "group+name duplicate slipped through on case/spacing",
        [{"name": "Foo Bar", "group": "G", "url": "tcp://a:1"},
         {"name": "foo-bar", "group": "g", "url": "tcp://b:1"}],
    )
    #     _gatus_key must be injective: (group, name) pairs that differ only in where an
    #     underscore falls must NOT collide, or a legitimate config is falsely rejected.
    if _gatus_key({"group": "A", "name": "B_C"}) == _gatus_key({"group": "A_B", "name": "C"}):
        failures.append("_gatus_key collided on distinct group/name pairs (underscore separator)")
    #     ...and it must match Gatus's own folding, so 'A B' and 'A-B' ARE the same key
    #     (Gatus folds both to 'a-b'); keying them apart would miss a real duplicate.
    if _gatus_key({"group": "G", "name": "A B"}) != _gatus_key({"group": "G", "name": "A-B"}):
        failures.append("_gatus_key did not fold space/dash the way Gatus does")

    #     enabled must be a bool: a quoted "false" is a string and gatus panics
    #     ("cannot unmarshal !!str `false` into bool").
    _expect_endpoint_error(
        "enabled: \"false\" (a string) passed -- gatus would refuse to start",
        [{"name": "Redis", "group": "Infrastructure", "url": "tcp://redis:6379", "enabled": "false"}],
    )
    #     ...but real bools, absent keys, and ${VAR} stubs are all fine.
    try:
        _validate_endpoints([
            {"name": "a", "group": "G", "url": "tcp://a:1", "enabled": True},
            {"name": "b", "group": "G", "url": "tcp://b:1", "enabled": False},
            {"name": "c", "group": "G", "url": "tcp://c:1"},
            {"name": "d", "group": "G", "url": "tcp://d:1", "enabled": "__GATUS_PROFILE_MCP__"},
        ], "probe")
    except GuardError as e:
        failures.append(f"a valid endpoint set was rejected: {e}")

    # 9. the perimeter is derived from disk, not memory: every compose file present
    #    must be scanned, so a newly added one cannot be invisible to this guard.
    #    Both tiers' real configs must also satisfy the gatus-loadability rules above.
    unlisted = find_unlisted_compose_files()
    if unlisted:
        failures.append(f"compose files exist that COMPOSE_FILES does not scan: {unlisted}")

    for f in failures:
        print(f"SELF-TEST FAIL: {f}")
    if failures:
        return 1
    print("self-test OK: all detectors fire on their failure mode")
    return 0


def main() -> int:
    try:
        if "--self-test" in sys.argv:
            return self_test()
        return report()
    except GuardError as e:
        print(f"FAIL: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
