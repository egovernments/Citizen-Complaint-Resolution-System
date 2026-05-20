# macOS Quickstart — DIGIT in one terminal session

Validated 2026-05-20 on Apple-Silicon Mac / OrbStack. Brings up the full DIGIT stack (~36 containers) with `./deploy.sh <tenant>` and nothing else. No `sudo`, no VM, no sibling repos, no post-deploy scripts.

## Prerequisites (one-time)

```bash
# 1. Docker runtime (pick one — OrbStack is the validated path)
brew install --cask orbstack && orb start
# (or: install Docker Desktop and enable Rosetta in Settings → General)

# 2. Ansible (the deploy runner)
brew install ansible

# 3. Tools used by the deploy
brew install git python@3.12 node@22
```

Hardware: ≥16 GB RAM allocated to the Docker VM, ≥30 GB free host disk (OrbStack grows its VM into host free space).

## Bring it up

```bash
git clone https://github.com/ChakshuGautam/Citizen-Complaint-Resolution-System.git ccrs
cd ccrs/local-setup/ansible

cp inventory/host_vars/maputo.yml.example inventory/host_vars/maputo.yml
# Edit maputo.yml if you want — defaults are validated.

./deploy.sh maputo
```

What this does:

1. Verifies `ansible-playbook` is on PATH (fails fast if not).
2. Prints a banner pointing at `/tmp/mac-stack-up.progress` so you can `tail -f` it during the long converge step.
3. Runs `ansible-playbook playbook-deploy.yml --limit maputo`.
4. The play:
   - Fails fast if the target isn't Debian-family OR macOS (`a80b11b` extended by the consolidated PR).
   - On Darwin: skips Docker host install / apt / systemd / host-nginx tasks (all gated).
   - Copies the compose files into `~/digit/`, renders `.env`, rewrites `STATE_LEVEL_TENANT_ID` + 3 siblings from `state_root` (defaults `pg`).
   - Seeds OpenBao secrets.
   - Pulls images (`docker compose pull`).
   - Runs `mac-stack-up.sh` — the Rosetta converge engine (clean baseline → 10×35s retry loop → idempotent re-entry → live progress sink at `/tmp/mac-stack-up.progress`).
   - Re-renders `.env` with the unsealed OpenBao secrets, runs a SKIP_DOWN converge#2 so the JVMs pick up the new env without re-sealing OpenBao.
   - Waits for Kong + persister + HRMS healthchecks.
   - Renders `globalConfigs.js` against the auto-detected ADMIN-on-state-tenant.
   - Validates: MDMS lookup, ADMIN OAuth mint, configurator 200, digit-ui 200, Gatus 200.

First run: ~8–15 min on a healthy Mac/OrbStack box (image pull dominates). Subsequent re-runs into a healthy stack: ~30 s (the `mac-stack-up.sh` healthy-skip short-circuit fires).

## Live progress while it runs

In another terminal:
```bash
tail -f /tmp/mac-stack-up.progress
watch -n5 "docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'healthy|Exited|Restart'"
```

Look for `mac-stack-up: CONVERGED on attempt N/10`. If you see `mac-stack-up: ABORT — LEAKED NETWORK ENDPOINT`, follow the printed remedy (stop deploy → `docker ps -aq | xargs -r docker rm -f` → restart engine → re-run plain).

## Verify

```bash
curl -sS -o /dev/null -w 'mdms:    %{http_code}\n' http://localhost/egov-mdms-service/health
curl -sS -o /dev/null -w 'ui:      %{http_code}\n' http://localhost/digit-ui/
curl -sS -o /dev/null -w 'status:  %{http_code}\n' http://localhost/status/
curl -sS http://localhost/user/oauth/token \
  -H 'Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=' \
  -d 'username=ADMIN&password=eGov@123&tenantId=pg&userType=EMPLOYEE&scope=read&grant_type=password' \
  | python3 -c 'import json,sys;print("auth:    "+json.load(sys.stdin).get("access_token","MISSING")[:24]+"...")'
```

All four should print 200 / a real token. Add `curl … /configurator/` once you've built and dropped in the digit-configurator dist (see the browser section above).

Open in a browser:
- http://localhost/digit-ui/ — citizen + employee SPA
- http://localhost/status/ — Gatus health dashboard
- http://localhost/configurator/ — DIGIT Studio (tenant onboarding wizard). **Disabled by default.** Build the dist first (`git clone https://github.com/egovernments/digit-configurator && npm ci && npm run build`, drop output into `~/digit/configurator/`), then flip `nginx_features.configurator: true` and re-run `./deploy.sh maputo`. Vendoring digit-configurator in-tree is tracked in PR #50.

Login: `ADMIN` / `eGov@123` / tenant `pg`.

## What this base deploy does NOT include (yet)

- **A fresh non-`pg` tenant (e.g. Maputo / mz / mz.maputo).** Creating those requires MCP `tenant_bootstrap` to seed the MDMS schemas + data + ADMIN user + workflow. Today MCP's GHCR image is `linux/arm64` only and the Mac path forces `linux/amd64` for the JVM images — so `enable_mcp: false` is the default. Follow-up PR makes the MCP image multi-arch + closes the 5 empirical `tenant_bootstrap` gaps; after that lands, flip `enable_mcp: true` + `state_root: mz` (or whichever) and the wizard's Phase-1 will seed your new tenant.
- **Notifications via Novu/Twilio.** `enable_novu: false`. Turn on when you actually need SMS / WhatsApp delivery.

## Stopping / restarting

```bash
# Stop without losing data:
docker compose -f ~/digit/docker-compose.egov-digit.yaml -f ~/digit/docker-compose.fast-path.yml down

# Bring back up (data persists in named volumes):
docker compose -f ~/digit/docker-compose.egov-digit.yaml -f ~/digit/docker-compose.fast-path.yml up -d

# Or just re-run the deploy — idempotent, ~30s on a healthy stack:
cd ccrs/local-setup/ansible && ./deploy.sh maputo
```

## If something breaks

- **`ansible-playbook` not found.** `brew install ansible` (NOT `pip3 install --user` — macOS doesn't add the user-base bin to PATH).
- **`Permission denied: /opt/digit-ui-esbuild`.** Means `digit_ui_mode` wasn't set to `container` in your host_vars. The Mac path always runs `container`.
- **JVM containers crash-looping with `KeyManagementService` JSONException.** You set `state_root:` to a tenant that doesn't exist in MDMS yet. Roll back to `pg`.
- **`mac-stack-up: ABORT — LEAKED NETWORK ENDPOINT`.** Stop deploy → `docker ps -aq | xargs -r docker rm -f` → restart the Docker engine → re-run.
- **Stuck at `mac-stack-up: attempt N/10 ... 0/0 up-or-healthy` forever.** Usually means an image platform mismatch (e.g. `enable_mcp: true` with the arm64-only MCP image). Check `/tmp/mac-stack-up.<N>.log`.
