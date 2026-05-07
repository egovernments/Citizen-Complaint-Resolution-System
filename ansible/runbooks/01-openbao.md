# Runbook 01 — OpenBao (per-tenant secrets backend)

| Field | Value |
|---|---|
| When to use | Adding/rotating/reading a secret on Nairobi or Bomet |
| Severity | P2 (config/audit), P0 if OpenBao is down (services that pull secrets won't start) |
| Affects | All tenants (each has its own OpenBao) |
| Time to fix | 1–10 min |
| Reverses | Yes — `bao kv put` writes a new version; old versions remain readable |

## What it is

A file-backed OpenBao instance per tenant, running as the `openbao` container alongside DIGIT. Used as the canonical store for per-tenant secrets (DB password, Keycloak admin, OAuth client secrets, registry creds, etc.). Read by Ansible at deploy time via `vault_kv2_get` lookups.

## Access

OpenBao is bound to `127.0.0.1:18200` on the host (no public exposure). Tunnel through SSH:

```bash
ssh -L 18200:127.0.0.1:18200 egov-nairobi
# in another terminal:
open http://localhost:18200/ui
```

The root token + unseal key live at `/opt/digit/.openbao/init.json` on the target server (mode 0600, root-only):

```bash
ssh egov-nairobi "cat /opt/digit/.openbao/init.json" | python3 -c "import json,sys; d=json.load(sys.stdin); print('root token:', d['root_token']); print('unseal key:', d['keys_base64'][0])"
```

**Back this file up out-of-band.** Losing it = losing access to every secret in this tenant's OpenBao. There's no way to recover (file storage with a single Shamir share is one-key-or-nothing).

## Read a secret

```bash
ssh -L 18200:127.0.0.1:18200 egov-nairobi
# in another shell:
export BAO_ADDR=http://localhost:18200
export BAO_TOKEN=$(ssh egov-nairobi "jq -r .root_token /opt/digit/.openbao/init.json")
bao kv get kv/digit/nairobi
# or via curl:
curl -s -H "X-Vault-Token: $BAO_TOKEN" \
  http://localhost:18200/v1/kv/data/digit/nairobi \
  | jq '.data.data'
```

## Write / rotate a secret

```bash
bao kv put kv/digit/nairobi postgres_password='new-strong-pwd'
# or merge with existing:
bao kv patch kv/digit/nairobi keycloak_admin_password='another-pwd'
```

After rotation, re-deploy so services pick up the new value:

```bash
cd /root/code/Citizen-Complaint-Resolution-System/ansible
./deploy.sh nairobi
```

(The next-PR change makes this automatic — services restart whenever their secrets change.)

## Initial seeding

The deploy playbook seeds `bootstrap_secrets:` from `inventory/host_vars/<tenant>.yml` **once** (with `cas=0`, so subsequent edits via `bao kv put` are not overwritten). To pre-fill values on first deploy, set:

```yaml
# host_vars/nairobi.yml
bootstrap_secrets:
  postgres_password: "{{ vault_postgres_password }}"   # ansible-vault-encrypted
  keycloak_admin_password: "{{ vault_keycloak_admin_password }}"
```

For ongoing operations, prefer the UI / `bao kv put` over editing host_vars (the cas=0 guard means a second edit won't take effect anyway).

## OpenBao restart / unseal

`docker restart openbao` re-seals (file storage). The next `./deploy.sh <tenant>` re-unseals automatically using the saved key. To unseal manually:

```bash
ssh egov-nairobi
KEY=$(jq -r .keys_base64[0] /opt/digit/.openbao/init.json)
docker exec openbao bao operator unseal "$KEY"
```

## Audit log (who read what)

Enable file-backed audit:

```bash
bao audit enable file file_path=/openbao/file/audit.log
```

Then on the host:

```bash
ssh egov-nairobi "tail -f /var/lib/docker/volumes/digit_openbao_data/_data/audit.log"
```

Each entry includes the request type, path, requester identity (token accessor), and timestamp.

## Disaster — init.json lost

Recovery path:

1. `docker compose -f docker-compose.egov-digit.yaml stop openbao`.
2. Wipe the volume: `docker volume rm digit_openbao_data` (this deletes ALL secrets in this tenant's OpenBao).
3. `./deploy.sh <tenant>` — playbook re-inits, captures new keys, seeds bootstrap secrets again.
4. Re-add any post-bootstrap secrets manually (anything not in `bootstrap_secrets`).

## Upgrade path to real production-grade

This setup uses 1-share Shamir + the unseal key on the same host as the data. Adequate for a test deployment, **not** for proper data-at-rest protection. For production:

- Use cloud-KMS auto-unseal (`seal "awskms"` / `seal "gcpckms"` block in OpenBao config) so the seal key never lives on the box.
- Increase to 3-of-5 Shamir shares distributed to 5 operators if no cloud-KMS is available.
- Enable TLS on the listener (replace `tls_disable: true`).
- Restrict access via OIDC + per-tenant policies instead of root-token-only.

## Related

- Ansible playbook: `ansible/playbook-deploy.yml` (OpenBao bootstrap section)
- Compose service: `docker-compose.egov-digit.yaml` (`openbao` service + `openbao_data` volume)
- Issue: TBD (OpenBao integration tracker)
