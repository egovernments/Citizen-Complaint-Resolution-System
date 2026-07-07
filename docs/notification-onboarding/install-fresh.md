# Install: config-driven PGR notifications on a **fresh** DIGIT deployment

Bring up a brand-new DIGIT/CCRS box with config-driven notifications
(SMS · Email · WhatsApp) enabled from the first deploy. Nothing is running yet,
so there is no live data to protect and no legacy notification path to cut over
from — everything comes up together.

> **Adding notifications to a box that is *already* running?** Use the
> [upgrade path](./install-upgrade.md) instead — it brings up the Novu stack
> beside your live data and seeds the masters as an idempotent add-on. This doc
> assumes a clean box.

Related docs: [Configurator tutorial](./TUTORIAL.md) (how an operator uses the
screens) · [Provider onboarding runbook](./provider-onboarding-runbook.md) (the
deep reference for provider/Novu/WhatsApp wiring).

---

## What "enabled" means

Four things must all be true for a complaint transition to deliver a message:

| Piece | Turned on by | Notes |
|---|---|---|
| **Novu delivery stack** (8 containers) | `enable_novu: true` | `digit-config-service`, `digit-user-preferences-service`, `novu-bridge`, `novu-api`, `novu-worker`, `novu-ws`, `novu-dashboard`, `novu-mongo`. ~+1 GB RAM. |
| **PGR on the config-driven path** | `pgr_notification_config_driven: true` | PGR reads the MDMS masters, renders per recipient, emits one event per `(recipient × channel)`. Default `false` = legacy hardcoded path. |
| **The 3 MDMS masters seeded** | the notif-seed tasks (run automatically on a full deploy when the gate above is on) | `RAINMAKER-PGR.NotificationRouting`, `.NotificationTemplate`, `.NotificationProviderTemplate`, at the **state root** (e.g. `ke`). |
| **A real Novu API key + a provider** | `novu_api_key` + `twilio_*` | Self-hosted Novu mints the key on first sign-up → two-deploy flow (below). |

The channel gate `novu_bridge_channels_enabled` (default `SMS,EMAIL`) is the
final delivery switch — `WHATSAPP` is added only once a WhatsApp provider is
onboarded.

---

## Step 1 — host_vars

`cp inventory/host_vars/_example.yml inventory/host_vars/<tenant>.yml`, then set
(the notification block, secrets are placeholders):

```yaml
# --- fresh-install baseline ---
db_fast_path: true                       # dump-seeded first boot (fresh installs only)

# --- notifications ---
enable_novu: true                        # 8-container notifications profile
pgr_notification_config_driven: true     # PGR reads the MDMS masters + emits per-recipient events
# seed_notifications: true               # implied by the flag above; set explicitly to force

# Pasted after the first deploy (see Step 2). Leave empty on the first run.
novu_api_key: ""

# Twilio SMS/WhatsApp creds the bootstrap registers as a Novu integration.
twilio_account_sid: ""
twilio_auth_token: ""
twilio_whatsapp_from: "whatsapp:+14155238886"   # Twilio Sandbox default

# Config-driven images: pin the published/registry builds, OR build on the box.
# novu_bridge_image:  "<registry>/egovio/novu-bridge:passthrough-<sha>"
# pgr_services_image: "<registry>/egovio/pgr-services:notif-config-<sha>"
build_novu_bridge:  false
build_pgr_services: false

# Delivery gate. Add WHATSAPP only after a WA provider is onboarded.
# novu_bridge_channels_enabled: "SMS,EMAIL"
```

`db_fast_path: true` is **required** on a fresh install (see the repo
`CLAUDE.md`); it dump-seeds Postgres on first boot. Only ever use it on a clean
box.

---

## Step 2 — first deploy (brings the stack up)

```bash
cd local-setup/ansible
./deploy.sh <tenant>
```

This brings up the full stack **including** the 8 notification containers. On a
self-hosted Novu the API key does not exist yet, so `novu_api_key` is empty and
the playbook **skips the Novu bootstrap** and prints an operator hint. That is
expected on the first run.

Because `pgr_notification_config_driven: true`, the **notif-seed tasks run as
part of this same deploy** (they are gated on that flag) — the 3 MDMS masters
are created at the state root. No separate `--tags` run is needed on a fresh
install.

---

## Step 3 — mint the Novu key + provider creds

1. Open `https://<host>/novu/` and sign up — this creates the first
   organization + environment + **API key** in your self-hosted Novu. Use the
   **Development** environment (self-hosted Novu only allows workflow creation
   in Dev).
2. Paste the key and your Twilio creds into `inventory/host_vars/<tenant>.yml`:
   ```yaml
   novu_api_key: "<pasted-key>"
   twilio_account_sid: "<sid>"
   twilio_auth_token: "<token>"
   ```
   (Or store them in OpenBao if you don't want plaintext — see the
   [runbook](./provider-onboarding-runbook.md#6-wiring-reference).)

---

## Step 4 — second deploy (wires the key + bootstraps the provider)

```bash
./deploy.sh <tenant>
```

With `novu_api_key` now set, the playbook:
- creates the Twilio **SMS integration** + the `complaints-sms` / `complaints-email`
  workflows inside Novu (via `config/bootstrap-novu-whatsapp.sh`),
- writes `NOVU_API_KEY=…` into the compose `.env`,
- **force-recreates `novu-bridge`** so it picks up the key,
- re-runs the (idempotent) MDMS seed.

---

## Step 5 — verify

```bash
# 1. Novu has the integration
curl -s -H "Authorization: ApiKey <novu_api_key>" https://<host>/novu-api/v1/integrations | jq '.data[] | {providerId, channel, active}'

# 2. The masters landed (state root)
#    Configurator → Notifications → Notification Routing / Templates / Provider Templates

# 3. End to end: file a complaint, then check the dispatch log
docker exec <pg_container> psql -U egov -d postgres -c \
  "select event_name, channel, status, last_error_code from nb_dispatch_log order by createdtime desc limit 10;"
```

`status=SENT` means **Novu accepted the trigger**, not that Twilio delivered —
confirm real delivery in the Novu dashboard / Twilio console. Full verification
recipes are in the [runbook §8](./provider-onboarding-runbook.md#8-verifying-delivery).

To add WhatsApp, onboard a WABA sender and map ContentSids per
[runbook §5](./provider-onboarding-runbook.md#5-onboard-a-whatsapp-provider-twilio-waba),
then add `WHATSAPP` to `novu_bridge_channels_enabled`.

---

## Rollback

Set `pgr_notification_config_driven: false` and redeploy — PGR reverts to the
legacy notification path. The gate is per-tenant, so this is a safe, reversible
cutover.
