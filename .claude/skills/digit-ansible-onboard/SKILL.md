---
name: digit-ansible-onboard
description: Use when an operator says "deploy DIGIT to a new server", "set up a fresh box", "onboard a new tenant via Ansible", or similar. This skill probes the target machine, asks the operator a fixed set of questions to fill in tenant-specific values, writes a `host_vars/<tenant>.yml` from `_example.yml`, runs `./deploy.sh <tenant>`, and validates the result.
---

# DIGIT Ansible Onboard

End-to-end guided onboarding for a new server (any Ubuntu 24.04 box reachable over SSH). Probes the target, asks the operator ≤ 10 questions, generates an inventory file, runs the playbook, and verifies infra. Designed so an operator who has the repo and SSH access can stand up a full DIGIT stack (services + UI + configurator) without writing YAML by hand.

## IRON LAW

```
NEVER GUESS A SECRET. NEVER FILL IN bootstrap_secrets WITHOUT ASKING THE OPERATOR.
```

If a question's answer is non-trivial (a secret, a tenant code, a domain), ASK. The operator-facing UX is a small, ordered list of prompts — not an autopilot.

## Inputs

- An SSH alias (or `user@host`) for the target. The skill assumes you can `ssh <alias>` non-interactively.
- The CCRS repo checked out locally with `local-setup/ansible/` present.
- The operator at the keyboard (for the 10 questions).

## Procedure

### Step 1 — Probe the target

Before asking anything, gather enough state from the target to (a) decide if the box is suitable, (b) pre-fill defaults for the operator. Run these via SSH and summarize back to the operator:

```bash
ssh <alias> '
echo "=== OS ==="; cat /etc/os-release | grep PRETTY_NAME
echo "=== CPU/RAM ==="; nproc; free -h | head -2
echo "=== Disk free ==="; df -h / | tail -1
echo "=== Public IP ==="; curl -s -4 ifconfig.me; echo
echo "=== VPC IP candidates ==="; ip -4 -o addr show | awk "{print \$2, \$4}"
echo "=== Docker installed? ==="; command -v docker && docker --version || echo "no"
echo "=== Existing DIGIT? ==="; ls /opt/digit 2>/dev/null && docker ps --format "{{.Names}}" 2>/dev/null | head -5 || echo "no"
echo "=== nginx + LE certs? ==="; command -v nginx && ls /etc/letsencrypt/live 2>/dev/null || echo "no"
'
```

Capture results. Use to pre-fill defaults below and to refuse if the box is unsuitable (Ubuntu < 22.04, < 8 GB RAM, < 50 GB free, …).

### Step 2 — Read the example to know what to ask

`local-setup/ansible/inventory/host_vars/_example.yml` is the source of truth for *what* an inventory file contains. Open it and note every key that an operator typically overrides. The 10 questions below cover all required ones; the rest get defaults.

### Step 3 — Ask the operator 10 questions

Ask **one at a time**, in order. Show the default in parentheses. Don't proceed past a question without an answer or an explicit "use default".

| # | Question | Default | Maps to |
|---|---|---|---|
| 1 | **Tenant code** (letters and dots only — egov-user rejects digits). Example: `ke.subhashini`. | none — must ask | `tenant` (used as `host_vars/<tenant>.yml` filename) |
| 2 | **Public domain** for the box (e.g. `subhashini.digit.org`). Set `none` to skip TLS. | none — must ask | `domain` |
| 3 | **TLS** — already have a wildcard or LE cert at `/etc/letsencrypt/live/<domain>/`? | `false` for non-prod boxes | `tls_enabled` |
| 4 | **State tenant ID** (the root). For `ke.subhashini` it's `ke`. | derived from Q1 by splitting on `.` | `state_tenant_id` |
| 5 | **Country mobile prefix and regex** — e.g. Kenya = 9 digits starting with `1` or `7`. | inferred from `state_tenant_id` if `ke` | `core_mobile_configs` |
| 6 | **Country/region for PGR boundary** — e.g. `Kenya / Nairobi County / Bomet County`. | inferred from `state_tenant_id` | `pgr_boundary_country`, `pgr_boundary_region` |
| 7 | **S3 bucket for assets** (logo, banner). Skip if no bucket yet. | empty | `asset_s3_bucket` |
| 8 | **Enable opt-in features?** Multi-select from {`mcp`, `configurator`, `search`, `claude_code`, `ci_tests`, `db_fast_path`, `nairobi_mdms`}. | `mcp`, `configurator`, `db_fast_path`, `ci_tests` (the four that make a deploy genuinely *usable* + verified) | `enable_mcp`, `nginx_features.configurator`, `enable_search_stack`, `install_claude_code`, `run_ci_tests`, `db_fast_path`, `requires_nairobi_mdms` |
| 9 | **OpenBao master password** — used to encrypt the dump's symmetric keys. The CCRS fast-path dump is locked to `asd@#$@$!132123`. Use that unless you regenerated the dump. | `asd@#$@$!132123` | `bootstrap_secrets.elasticsearch_master_password` |
| 10 | **SSH alias / `user@host`** for ansible to reach the target. | derived from `ssh <alias>` config — verify the alias works | `ansible_host` |

After asking all 10, summarise the answers back and confirm before writing the file.

### Step 4 — Write `host_vars/<tenant>.yml`

```bash
cp local-setup/ansible/inventory/host_vars/_example.yml \
   local-setup/ansible/inventory/host_vars/<tenant>.yml
```

Then apply the operator's answers with focused `sed`/edits, not by rewriting the file from scratch. Preserve the comments — they're the operator's manual.

Common substitutions:

- `mytenant` → tenant code (Q1)
- `your-domain.example.com` → domain (Q2)
- `tls_enabled: true|false`
- `enable_mcp: true|false`
- `ansible_host: <ip-or-alias>` (Q10)

For `bootstrap_secrets.elasticsearch_master_password`: use Q9's value verbatim. Don't echo it back in summaries — show `***` instead.

### Step 5 — Deploy

```bash
cd local-setup/ansible
./deploy.sh <tenant>
```

This regenerates `hosts.yml` from `host_vars/*.yml` and runs the playbook. It takes ~15 min for a fresh box, plus another ~5–10 min if opt-in CI tests are enabled.

Run in the background (the operator is going to want to watch other things). Stream progress only at task boundaries, not every line — Ansible is verbose and the operator will tune you out otherwise.

### Step 6 — Validate

The playbook's last task is "INFRA VALIDATION RESULTS". A clean run shows:

```
All containers:        HEALTHY
Public UI:             200 OK
Gatus /status/:        200 OK
MCP /mcp:              200 OK
Auth flow:             access_token minted
MDMS StateInfo:        non-empty
OpenBao:               unsealed + initialized
```

Anything `FAIL` or `SKIPPED` should be flagged to the operator with the exact failing task name and the host_vars key that probably caused it.

If `run_ci_tests: true` was set in Q8, also report the Newman + regression suite results. Newman should be 16/16 (digit-core-validation + complaints-demo); CRSLoader v2 regression should be 11/11. Anything less is a real regression — point to the corresponding test name.

### Step 7 — Hand over (testable links)

Print this template back to the operator, with the placeholders filled
in from their answers and the actual probe results. Mark each line with
✅ / ❌ from a fresh `curl` you run *now*, not from what the deploy
*should* have produced.

```
═════════════════════════════════════════════════════════════════
  DEPLOY SUMMARY — <tenant>  (<host>)
═════════════════════════════════════════════════════════════════

▼ URLs you can hit right now

  UI                    <scheme>://<host>/digit-ui/
                        — login as ADMIN / eGov@123 on tenantId=pg
                          (see "Login caveat" below)

  Configurator          <scheme>://<host>/configurator/
                        — only if Q8 enabled it; 404 otherwise

  MCP REST shim         <scheme>://<host>/v1/healthz
                        <scheme>://<host>/v1/version
                        <scheme>://<host>/v1/tools           (no auth)
                        <scheme>://<host>/v1/tenant/bootstrap (POST + auth)

  Status dashboard      <scheme>://<host>/status/

  PGR API (Kong)        <scheme>://<host>/pgr-services/v2/request/_search
                        <scheme>://<host>/egov-mdms-service/v1/_search

▼ Login caveat

  ADMIN / eGov@123 logs in fine on tenantId=pg (the dump's seed tenant).
  It does NOT yet log in on tenantId=<state_tenant_id> until you bootstrap:

    curl -X POST <scheme>://<host>/v1/tenant/bootstrap \
      -H "Content-Type: application/json" \
      -d '{"target_tenant":"<state_tenant_id>",
           "source_tenant":"pg",
           "auth":{"username":"ADMIN","password":"eGov@123","tenant_id":"pg"}}'

  After that, ADMIN/eGov@123 works on <state_tenant_id> too.

▼ Operator-side bits to keep

  Inventory   local-setup/ansible/inventory/host_vars/<tenant>.yml
              (gitignored — your local copy is the source of truth)

  OpenBao     scp <ssh-target>:/opt/digit/.openbao/init.json ./
              root token + unseal key — DO NOT lose

  Re-deploy   cd local-setup/ansible && ./deploy.sh <tenant>
              fully idempotent — re-runnable any time

  Tunnel UIs  ssh -L 18200:127.0.0.1:18200 <ssh-target>   # OpenBao UI
              ssh -L 18888:127.0.0.1:18888 <ssh-target>   # Jupyter

▼ CI verification (if Q8 included ci_tests)

  Newman digit-core-validation:    expect "All assertions passed"
  Newman complaints-demo PGR e2e:  expect "All assertions passed"  (16/16)
  CRSLoader v2 regression:         expect 11 passed, 0 failed

  Anything less is a real regression — don't ship.
═════════════════════════════════════════════════════════════════
```

The point is the operator doesn't need to dig: every URL above is
clickable/curlable, and the login caveat answers the most common "why
can't I log in" question on day 1.

Run a quick `curl` per URL and mark each ✅/❌ in the printed summary.
The operator should be able to immediately retry whichever ones are ❌.

## Known refusals

- **Box not Hetzner-internal but operator wants `enable_mcp: true`.** The MCP image lives at `10.0.0.4:5000` (VPC-only). For public boxes, switch `docker_registry` to a public mirror or set `enable_mcp: false`. Don't silently downgrade — ask.
- **Operator asks to enable `db_fast_path` on a box with existing live data.** The fast-path overlay corrects the postgres volume mount path, which forces container recreation and wipes any anonymous-volume data. Confirm explicitly.
- **State tenant has digits** (e.g. `ke2`). egov-user rejects digits in tenant IDs at the DTO level. Reject the value and ask for a letter-only alternative.

## What this skill deliberately does NOT do

- It doesn't write secrets to the repo. `host_vars/<tenant>.yml` is gitignored; the operator keeps it locally.
- It doesn't auto-pick a domain for the operator. DNS is out-of-band.
- It doesn't bypass the 10-question gate. If the operator asks you to "just figure it out", refuse and walk through the questions — most fields don't have safe inferences for a brand-new tenant.

## Useful references

- `local-setup/ansible/README.md` — operator-facing deploy guide
- `local-setup/ansible/inventory/host_vars/_example.yml` — every flag with inline docs
- `local-setup/ansible/inventory/host_vars/README.md` — known gotchas (master-password lock, MCP VPC scope, TLS+LE)
- `CLAUDE.md` (gitignored) — full local-setup notes for the platform team
- `gist:5115e8efafbc7fd9470c0d3d04bf4897` — REST onboarding API the configurator calls into
