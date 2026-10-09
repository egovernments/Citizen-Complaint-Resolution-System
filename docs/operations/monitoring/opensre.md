# OpenSRE — diagnose-only SRE agent (compose tier)

An optional AI agent that watches a deployment's own monitoring and, when something is failing,
writes down what it thinks is wrong and what a person should do about it. It **changes nothing**
and **sends no alerts**: its only output is a log on the box (and the same lines in Loki).

It runs [OpenSRE](https://github.com/Tracer-Cloud/opensre) (Apache-2.0, pinned to release
`0.1.2026.9.21`) in one container on either tier: `digit-opensre` from
`local-setup/docker-compose.opensre.yml` on the compose tier, or the `opensre` Deployment from
`devops/deploy-as-code/charts/monitoring/opensre/` on Kubernetes
([details](#the-kubernetes-tier)). Everything below describes the compose tier unless it says
otherwise.

> OpenSRE is in public alpha upstream. That is one reason this deployment keeps it read-only,
> log-only and off by default.

---

## What it does

Every `opensre_sweep_interval_minutes` (default 15) the agent asks Gatus which checks are
failing.

| Gatus says | What happens | Model call? |
|---|---|---|
| Everything passing | One `all_clear` line | No |
| Same failing checks as an investigation in the last `opensre_dedupe_hours` (default 6) | One `unchanged` line | No |
| Anything else failing (now **and** on 2 of the last 3 checks) | One investigation | Yes |

An investigation is a single `opensre ask` run. The agent reads Grafana (Prometheus metrics,
Loki logs, traces, alert rules and annotations), Tempo, Redpanda consumer-group lag and topic
health, and on Kubernetes the cluster API. It is given this deployment's
[known-issues runbook](../../releases/2.12/operations/known-issues.md). It returns the root cause with
evidence, the impact on citizens, and the commands a person should run, with the risk of each.

Its scope is **infrastructure only**: the host, containers, the observability stack, the gateway,
databases, the broker and consumer lag. The prompt tells it not to investigate complaints,
notifications or users.

## What it can and cannot touch

| It can | It cannot |
|---|---|
| Query Grafana with a **Viewer** service-account token (read datasources) | Change dashboards, alert rules, users or datasources |
| Read Tempo's HTTP API and Redpanda consumer-group offsets | Produce to Kafka or move offsets |
| Read Gatus's status API | Touch any database |
| Compose: read container state (status, health, exit code, OOM kill, restarts) through `docker-socket-proxy` | Write to Docker: the proxy refuses every write, and no socket is mounted |

Read-only is enforced in two places:

- **OpenSRE itself.** `opensre ask` runs a tool without approval only when the tool declares
  itself read-only, and **denies** everything else. In the pinned release that leaves only the
  Prometheus tool, and the first denied call ends the investigation. So the sweep loop approves a
  fixed list of tools by name (`READ_ONLY_TOOLS` in `run-sweeps.sh`): the Grafana, Tempo, Kafka
  and Kubernetes tools above, each checked to only read. It never passes
  `--dangerously-bypass-approvals`. The parity test fails if the list changes without the test
  changing too. Read a tool's implementation before adding it, and recheck the list when
  upgrading OpenSRE.
- **Credentials.** The only credentials in the container are a Viewer Grafana token and the model
  API key.

## Turn it on

1. **Store a project-owned Anthropic API key** in the tenant's OpenBao secret. Don't use a
   personal key or subscription.
   ```bash
   bao kv patch <secrets_path> opensre_anthropic_api_key=<key>
   ```
   Use `patch`, not `put`: `put` replaces the whole secret and deletes every other key.
2. **Set the flag** in `host_vars/<tenant>.yml`:
   ```yaml
   enable_opensre: true
   ```
3. **Deploy:** `./deploy.sh <tenant>`.

The deploy builds the image on the box. It downloads the pinned release tarball (~140 MB) and
checks it against the release checksum. On the first run with Grafana healthy, the deploy also
creates the `opensre` Grafana service account and its token. The token is stored in OpenBao as
`opensre_grafana_token` and reused on later deploys.

The flag appears in the rendered `/opt/digit/.env` as `OPENSRE_ENABLED`. The profile it selects,
`opensre`, is what decides whether the container exists.

**Without an API key** the container starts and logs `idle` every sweep. If the Grafana token
could not be created, the deploy prints a warning and continues. The agent then works from Tempo,
Kafka lag and Gatus only, until a later deploy creates the token.

## Where the output goes

On the box, in `/opt/digit/opensre/logs/`:

| File | Contents |
|---|---|
| `investigations.log` | Human-readable: one block per investigation, newest at the bottom |
| `sweeps.jsonl` | Every sweep as one JSON object: `all_clear`, `unchanged`, `investigating`, `investigation` (with the full result), `idle`, `paused`, `error` |

```bash
tail -n 60 /opt/digit/opensre/logs/investigations.log
jq -c 'select(.kind == "investigation") | {ts, trigger, exit_code}' /opt/digit/opensre/logs/sweeps.jsonl
```

The same lines are on the container's stdout, so Grafana → Explore → Loki has them too:

```logql
{compose_service="opensre"} | json | kind="investigation"
```

## Pause it, or turn it off

- **Turn it off:** set `enable_opensre: false` and deploy. The container is removed and the logs
  stay on disk.
- **Pause it without a deploy:** set `OPENSRE_ENABLED=false` in `/opt/digit/.env`, then recreate
  the container with the full compose stack. The next deploy re-renders `.env` from host_vars, so
  this only lasts until then.
- **Change the pace:** set `opensre_sweep_interval_minutes` and `opensre_dedupe_hours` in host_vars.

## Cost

A sweep with nothing failing costs nothing; the Gatus check is a plain HTTP call. Each
investigation is a paid model call. For reference, a comparable infrastructure investigation on
bomet (four failing checks, about 20 tool calls) cost about **$0.65–$1** on Claude Opus 5. The
6-hour de-duplication means a problem that persists costs at most four investigations a day.
Set `opensre_model` to a cheaper model to trade depth for cost.

## What leaves the box

Everything the agent reads that ends up in a prompt goes to the model provider (Anthropic),
including log lines and metric values. Before every model call, OpenSRE applies
`local-setup/opensre/guardrails.yml`, which masks:

- JWTs, and `access_token` / `authToken` / `Authorization` values. Kong's auth call puts the live
  session token in a query string that the proxy's access log carries into Loki.
- Password, secret and API-key fields, `sk-` style keys, Novu `ApiKey` headers, OpenBao/Vault
  tokens, and the `user:password@` part of database and other URLs.
- Citizen contact details: mobile/phone/username/email fields, email addresses, OTP codes, and
  Kenyan, Mozambican and Indian mobile numbers, with or without the country code.

**Not masked:** names and free-text complaint descriptions, which no pattern can reliably match.
The phone rules also mask counters that look like a local mobile number (for example a 9-digit
offset starting 82–87), so the agent can lose the odd metric value.
Check a new rule inside the container before relying on it:

```bash
docker exec digit-opensre opensre guardrails test 'GET /user/_details?access_token=abc123'
```

OpenSRE's own product telemetry, Sentry error reporting and local prompt log are switched off
(`OPENSRE_NO_TELEMETRY`, `OPENSRE_SENTRY_DISABLED`, `OPENSRE_PROMPT_LOG_DISABLED`).

## Upgrading OpenSRE

Update `OPENSRE_VERSION` and both `OPENSRE_SHA256_*` build args in
`local-setup/opensre/Dockerfile`. Take the checksums from the release's `.sha256` assets. Also
update the `image:` tag in `docker-compose.opensre.yml` to match. Check the new release's
changelog for changes to `opensre ask`, since upstream is still alpha and moves daily. Recheck
`READ_ONLY_TOOLS` in `run-sweeps.sh` too: a renamed tool makes every investigation fail with
"unknown registered tool name", and a tool that now writes must come off the list.

---

## The Kubernetes tier

The same agent ships as a Helm chart at `devops/deploy-as-code/charts/monitoring/opensre/`, off by
default like every other component there. It runs the same sweep loop and the same redaction rules
— a test (`local-setup/tests/static/opensre-parity.test.ts`) fails the build if the two copies
drift. Edit the compose-tier files under `local-setup/opensre/`, then copy them into the chart's
`files/`.

**It sees more here than on compose.** The pod gets a read-only ServiceAccount, so the agent can
read pod restart counts, crash-loop and OOM-kill events, pod logs, deployments and nodes — exactly
the view the compose tier lacks. The RBAC is `get`/`list` only and excludes secrets.

**It sees less in one place:** this tier runs Jaeger rather than Tempo, and OpenSRE has no Jaeger
integration, so there are no traces. `endpoints.tempoUrl` is empty on purpose.

### Turning it on

1. **Build and push the image** — there is no public one carrying this release:
   ```bash
   docker build local-setup/opensre -t egovio/opensre:0.1.2026.9.21
   docker push egovio/opensre:0.1.2026.9.21
   ```
2. **Create the Secret** in the monitoring namespace. The Grafana token is optional; mint it in
   Grafana as a Viewer service account. Without it the agent still reads Gatus, Kafka lag and the
   cluster.
   ```bash
   kubectl -n monitoring create secret generic opensre \
     --from-literal=anthropic-api-key='<key>' \
     --from-literal=grafana-token='<token>'
   ```
3. **Optional runbook** — the same known-issues page the compose tier attaches:
   ```bash
   kubectl -n monitoring create configmap opensre-runbook \
     --from-file=known-issues.md=docs/releases/2.12/operations/known-issues.md
   ```
   then set `runbook.configMapName: opensre-runbook`.
4. **Flip the toggle** in `charts/environments/env.yaml`:
   ```yaml
   monitoring:
     opensre: true
   ```
   and apply the helmfile as usual.

### Where the output goes

The pod log is the record — `kubectl -n monitoring logs deploy/opensre`, and Loki when the logs
tier is on. The in-pod log files are on an `emptyDir` and do not survive a restart, unlike the
compose tier's bind mount.

### Endpoints it expects

Defaults in the chart's `values.yaml` assume the layout this repo deploys: `gatus.monitoring:8080`,
`grafana.monitoring`, and `kafka-kraft-controller-headless.backbone:9092`. Override them in values
if your cluster differs. Gatus drives the sweep, so with `monitoring.gatus: false` the agent has
nothing to react to and logs that it cannot reach Gatus.

---

## Limits

- **Container state on compose is a snapshot, not a tool.** The agent cannot call Docker. Before
  each investigation the sweep loop reads every container of the deployment through
  `docker-socket-proxy` (`GET` only) and attaches a `docker inspect` summary: status, health and
  the last health-check output, exit code, OOM kill, restarts, timestamps, memory limit and
  restart policy. It never copies environment variables, commands or arguments, which hold the
  stack's secrets; the parity test enforces that. Usage over time comes from `container-stats`
  (Prometheus `container_*`, labelled `container_name`). Without the proxy (below
  `observability_level: metrics`) the loop logs a warning and investigates without the page. The
  Kubernetes tier reads pod state from the cluster API instead.
- **It reasons only from telemetry.** It cannot fetch a health endpoint's response body (such as
  a `/readyz` that names the failing dependency), and silent logs are not proof that a service
  is down. A service that logs nothing and exports no metrics can look stopped. Its reports mark
  such causes "unconfirmed" and list the read-only check that settles them; run that check first.
- **No traces on Kubernetes.** That tier runs Jaeger, which OpenSRE does not integrate with.
- **Loki context.** Below `observability_level: logs` (compose) or with `monitoring.logs: false`
  (Kubernetes) there is no Loki, so investigations have no log context. Below `traces` on compose
  there is no Tempo.
