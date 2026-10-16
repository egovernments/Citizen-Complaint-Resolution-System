# Sherlog: alerting and automatic root-cause analysis (compose tier)

Sherlog gives CCRS alert rules for every component it runs and investigates each alert. CCRS does not maintain alert
rules: `local-setup/sherlog/sherlog.yaml` declares the components (host, Postgres, Redpanda, Kong, the JVM services,
per-service SLOs, error logs, Gatus, Prometheus), and Sherlog renders the rules for them from maintained upstream
rule sets (node_exporter's and postgres_exporter's mixins, Redpanda's alert definitions, Grafana's JVM library,
Sloth for SLOs). The standard and every option: https://github.com/singhalkarun/sherlog/blob/main/docs/standards.md

```
Prometheus (rule_files: sherlog/rendered/prometheus) ─┐
Loki ruler (sherlog/rendered/loki)                    ├─► sherlog-alertmanager ─► sherlog-trigger ─► report / GitHub issue
                                                      ┘                     └─► Slack (optional)
```

## Turning it on for a tenant

1. On the host, once: `docker login ghcr.io` with a token that has `read:packages` (Sherlog's images are private for now).
2. In host_vars:
   ```yaml
   enable_sherlog: true
   sherlog_model_api_key: "..."      # SECRET, from OpenBao
   sherlog_mode: shadow              # reports stay on the box; "live" sends them
   ```
3. Deploy. The playbook renders the rules into `/opt/digit/sherlog/rendered`, which Prometheus and Loki already
   mount, starts the `sherlog` profile, and reloads Prometheus.

Optional: `sherlog_github_issues_repo` and `sherlog_github_issues_token` (one issue per problem, live mode),
`sherlog_alert_slack_webhook_url` (critical and warning alerts to Slack; log alerts never page),
`sherlog_deadman_url` (a dead man's switch for the alerting itself), and `sherlog_overrides` for this tenant's
differences, same shape as `sherlog.yaml`:

```yaml
sherlog_overrides:
  components:
    logs: {threshold: 20}
    services: {overrides: {pgr-services: {latency_seconds: 2.5}}}
  investigate:
    skip_services: [loki, promtail, postgres-db]
```

Turning it off (`enable_sherlog: false`) stops the services and removes the rendered rules and the Alertmanager
target on the next deploy.

## What it costs and what leaves the box

Each investigation is one LLM conversation of roughly $0.04 to $0.13; at most `sherlog_daily_investigations` (30) a
day. Only critical and warning alerts are investigated. Log lines are redacted (emails, phone numbers, tokens) by
`sherlog-proxy` before anything is sent to the model; the agent runs on an internal network that reaches only the
proxy.

## Checking the rules against this box

From a machine with Docker and a tunnel to the box's Prometheus (`ssh -L 19090:127.0.0.1:19090 <host>`), Sherlog's
`tools/contract.sh http://host.docker.internal:19090 <rendered folder>` lists metrics and labels the rules expect but
this Prometheus does not have (pint, read-only).

## Not yet covered

- Kubernetes tier: Sherlog's Helm chart renders the same standard as a PrometheusRule and AlertmanagerConfig for
  kube-prometheus-stack; wiring it into `devops/deploy-as-code/charts/monitoring` is a follow-up. Log alerts there
  need the Loki ruler, which the deprecated loki-stack chart (Loki 2.9) does not configure.
- Exporters for components CCRS runs but does not scrape yet (PgBouncer, Elasticsearch, Redis, MinIO, cAdvisor):
  adding them is CCRS's, and each one is then one line in `sherlog.yaml`.
