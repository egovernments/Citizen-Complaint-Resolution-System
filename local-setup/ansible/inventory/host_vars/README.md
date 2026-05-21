# host_vars/ — per-tenant deploy configuration

One YAML file per tenant. The file's name is the tenant identifier
you pass to `./deploy.sh` (e.g. `./deploy.sh mytenant` reads
`mytenant.yml`).

## What's tracked vs ignored

Only **`_example.yml`** is committed. Everything else matching
`*.yml` in this directory is gitignored (see the repo root
`.gitignore`). The reason: real host_vars files contain
deploy-sensitive values:

| Field | Why it's sensitive |
|---|---|
| `ansible_host` | Production IP / Tailscale address — surface for an attacker |
| `domain` | Maps a tenant to a public hostname |
| `bootstrap_secrets.*` | Initial DB / MinIO / encryption passwords seeded into OpenBao |
| `secrets_path` | Identifies where in OpenBao the tenant's secrets live |

Each operator (or each deploy environment) keeps their own files
locally. Nothing about your specific tenant should land in this
public repo through this directory.

## Workflow

```bash
# 1. start from the template
cp inventory/host_vars/_example.yml inventory/host_vars/mytenant.yml

# 2. fill in real values
$EDITOR inventory/host_vars/mytenant.yml

# 3. deploy — inventory/hosts.yml regenerates itself from this dir
./deploy.sh mytenant
```

There's no step where you edit `inventory/hosts.yml` directly.
`deploy.sh` walks this directory at every run and emits a fresh
inventory file. Drop your tenant's YAML here, and that's the entire
"register a new tenant" workflow.

## How values flow into the deploy

1. **`group_vars/all.yml`** is loaded first — global defaults (Python
   interpreter, etc.).
2. **`group_vars/digit.yml`** layers on top — defaults inherited by
   every tenant in the `digit` group (upstream ports, file paths,
   `tls_enabled: true`, etc.).
3. **`host_vars/<tenant>.yml`** wins last — your overrides for this
   tenant specifically.

So if a field is missing from your `mytenant.yml`, Ansible falls
through to `group_vars/digit.yml` then `group_vars/all.yml`. Only
override what's actually different for your tenant.

## Common gotchas

- **`db_fast_path: true` is effectively required for fresh installs.**
  The slow-path seed SQL files were removed; without the fast-path
  dump, Postgres comes up empty and most JVM services will fail to
  start (no MDMS data → enc-service can't find DataSecurity records →
  egov-user can't auth).

- **Master password lock-in when fast-path is on.** The dump's
  `eg_enc_*_keys` were generated with `MASTER_PASSWORD=asd@#$@$!132123`.
  Setting `elasticsearch_master_password` to anything else breaks
  decryption on first boot (AEADBadTagException).

- **`enable_mcp: true` needs an image source.** Two ways: (1) pair it
  with `build_mcp: true` and the deploy builds the image locally from
  source (`files/mcp-build.sh` → `digit-mcp:local`) — works anywhere,
  no registry; this is the path for Mac and off-VPC boxes. Or (2) leave
  `build_mcp` off to pull `{{ docker_registry }}/digit-mcp:latest` (the
  VPC registry `10.0.0.4:5000` is reachable only inside the Hetzner egov
  VPC). Compose validates every image before starting any service, so
  with neither a local build nor a reachable registry an unresolvable
  MCP image takes the whole stack down. Default `enable_mcp: false`.
  Also set `nginx_features.mcp: true` to expose `/mcp` through nginx.

- **`tls_enabled: false` for sandbox / Tailscale boxes.** Skips the
  `listen 443 ssl` block + redirect, switches the validate-* tasks to
  HTTP with `Host:` header. Useful when there's no Let's Encrypt cert
  yet.

- **`requires_nairobi_mdms: true` activates a git submodule.** The
  Nairobi MDMS records live in a separate repo
  (https://github.com/ChakshuGautam/nairobi-digit-configs) wired in as
  a submodule at `local-setup/ansible/nairobi-mdms`. The playbook
  initialises it only when this flag is true — keeps fresh clones
  fast for tenants that don't need it.

- **`digit_ui_mode: hmr` vs `static`.** Both bind port 18080, only one
  can be active. HMR runs `node esbuild.dev.js` in a tmux session
  watching `/opt/digit-ui-esbuild/` (live reload on git pull). Static
  pre-builds with `node esbuild.build.js` and host nginx serves the
  bundle directly. Pick HMR for active dev, static for stable boxes.

## Field reference

See `_example.yml` — every field has an inline comment.

## I lost my host_vars file

Look in OpenBao (`bao kv get kv/digit/<tenant>`) for the secrets, then
reconstruct the file from `_example.yml` + your memory of which flags
were on. The `ansible_host` and `domain` should be derivable from your
DNS / Tailscale / Hetzner console.
