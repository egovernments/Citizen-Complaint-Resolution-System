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

Optional, with `sherlog_docker_diagnostics: true`: investigations may also read the containers' state (restarts,
exit codes, OOM kills, health), last log lines and recent events, through Sherlog's read-only, redacted proxy. It
mounts the Docker socket into a GET-only socket proxy that the investigating agent cannot reach directly.
