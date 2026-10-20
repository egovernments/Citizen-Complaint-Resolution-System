# Sherlog

[Sherlog](https://github.com/singhalkarun/sherlog) provides the compose tier's alerting and investigates each
alert. CCRS keeps no alert rules: `local-setup/sherlog/sherlog.yaml` lists the components CCRS runs, and Sherlog
renders the rules, the Alertmanager routing and the inhibitions for them. How it works, every component and
option, cost, and what leaves the box: [Sherlog's standard](https://github.com/singhalkarun/sherlog/blob/main/docs/standards.md).

## Turning it on for a tenant

1. On the host, once: `docker login ghcr.io` with a token that has `read:packages` (Sherlog's images are private
   for now).
2. In host_vars: `enable_sherlog: true` and `sherlog_model_api_key` (from OpenBao). The other settings and their
   defaults are in `ansible/inventory/group_vars/digit.yml`; this tenant's differences from `sherlog.yaml` go in
   `sherlog_overrides`.
3. Deploy. Sherlog runs from `/opt/digit/sherlog` as its own compose project (`/opt/digit/sherlog/sherlog.sh ps`).

`enable_sherlog: false` stops it and removes its rules on the next deploy; its data is kept.

Optional, per tenant: `sherlog_actions: true` lets a collaborator with write access approve a restart of a
service's containers by labelling the Sherlog issue `sherlog-action:restart` (the allowlist is in `sherlog.yaml`);
`postgres_stat_statements: true` adds statement statistics per query id (no query text; one Postgres restart). The
host's journal (kernel OOM kills, unit failures) is in Loki as `job=journal` on a Linux host with a persistent journal
(`/var/log/journal`; elsewhere promtail reads an empty folder and there is no journal); Keycloak's metrics (management
port 9000) are scraped when `enable_keycloak` is on, from an identity-keycloak image built with `--metrics-enabled`.

What the deploy gives Sherlog to work with: the host's journal in Loki (kernel OOM kills, unit failures), Tempo's traces
(the collector drops connection and caller attributes and URL query strings first), and a deploy marker written as
the playbook's last step (`deploy_timestamp_seconds`: commit, ref, host), so an investigation starts from "what
changed" and an alert that resolves after a deploy is closed as verified.

Optional, with `sherlog_docker_diagnostics: true`: investigations may also read the containers' state (restarts,
exit codes, OOM kills, health), last log lines and recent events, through Sherlog's read-only, redacted proxy. It
mounts the Docker socket into a GET-only socket proxy that the investigating agent cannot reach directly.

## Sherlog and OpenSRE

Both are opt-in AI diagnosis on the compose tier ([opensre.md](opensre.md)); they do different jobs and can run
together, though turning both on pays for two models.

| | Sherlog | OpenSRE |
|---|---|---|
| Starts from | Prometheus and Loki alert rules it renders from the components in `local-setup/sherlog/sherlog.yaml` | Gatus checks that are failing |
| Defines alerts and routing | yes (rules, SLOs, Alertmanager) | no |
| Investigates | each critical or warning alert, after deterministic pre-checks, through a redacting proxy | the failing checks, every 15 minutes |
| Output | a report on the box (shadow), or one GitHub issue per problem kept in step with the alert (live) | a log line on the box and in Loki |
| Changes anything | no (restarts only with `sherlog_actions` and a collaborator's label) | no |

Turning Sherlog on also gives OpenSRE better signals: the alerts it fires are visible in Prometheus.
