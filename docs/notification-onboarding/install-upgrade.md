# Upgrade: add config-driven PGR notifications to an **existing** DIGIT deployment

Turn on config-driven notifications (SMS · Email · WhatsApp) on a box that is
**already running** DIGIT/CCRS with live data. Unlike a
[fresh install](./install-fresh.md), here you must bring the Novu stack up
*beside* your running services, seed the notification config **without
disturbing existing data**, and cut PGR over one tenant at a time.

Related docs: [Fresh install](./install-fresh.md) · [Configurator tutorial](./TUTORIAL.md)
· [Provider onboarding runbook](./provider-onboarding-runbook.md).

---

## Before you start — two safety rules

1. **Do NOT flip `db_fast_path` on a live box.** Production boxes
   (e.g. Bomet/Nairobi) keep their Postgres data in an anonymous volume;
   `db_fast_path: true` corrects the volume mount, which forces a container
   recreate and **wipes existing data**. Leave `db_fast_path: false` on any box
   that already has live complaints. (See the repo `CLAUDE.md`.)
2. **The MDMS seed is additive and idempotent** — it creates the 3 notification
   masters at the state root and skips rows that already exist (`x-unique`
   phantom-200). It never touches complaints, users, or other MDMS masters.

The upgrade is safe because the feature is **gated**: until you set
`pgr_notification_config_driven: true`, PGR stays on the legacy path even with
the Novu stack running.

---

## The shape of the upgrade

An upgrade has two distinct parts, and they use the playbook differently:

| Part | What it does | How you run it |
|---|---|---|
| **A. Bring up + wire the Novu stack** | starts the 8 notification containers, bootstraps the Twilio integration + workflows, wires `NOVU_API_KEY`, force-recreates `novu-bridge` | a **full** `./deploy.sh <tenant>` (these tasks are gated on `enable_novu`, not tag-scoped) |
| **B. Seed the 3 MDMS masters** | creates `NotificationRouting` / `NotificationTemplate` / `NotificationProviderTemplate` at the state root, idempotently | `./deploy.sh <tenant> --tags notifications` (repeatable, standalone) |

> `--tags notifications` runs **only the seed** (part B). Bringing the Novu
> stack up and wiring the key (part A) happen in a full deploy. So the first
> upgrade needs at least one full deploy; after that, `--tags notifications` is
> your fast, safe re-seed.

---

## Step 1 — add the notification host_vars

Edit `inventory/host_vars/<tenant>.yml` (do **not** change `db_fast_path`):

```yaml
enable_novu: true                        # +8 containers, ~+1 GB RAM
pgr_notification_config_driven: true     # cut THIS tenant onto the config-driven path

novu_api_key: ""                         # empty on the first pass (Step 2)
twilio_account_sid: ""
twilio_auth_token: ""
twilio_whatsapp_from: "whatsapp:+14155238886"

# Config-driven images — pin registry builds or build on the box.
# novu_bridge_image:  "<registry>/egovio/novu-bridge:passthrough-<sha>"
# pgr_services_image: "<registry>/egovio/pgr-services:notif-config-<sha>"
build_novu_bridge:  false
build_pgr_services: false

# novu_bridge_channels_enabled: "SMS,EMAIL"   # add WHATSAPP after a WA provider is onboarded
```

---

## Step 2 — one full deploy (Novu stack + auto-minted key + seed)

```bash
cd local-setup/ansible
./deploy.sh <tenant>
```

This starts the 8 notification containers **alongside** your running stack and
recreates `pgr-services` / `novu-bridge` with the config-driven env. Existing
Postgres data is untouched (`db_fast_path` stays `false`).

Because `novu_api_key` is empty, the playbook **mints the Novu key
programmatically** ([`novu-mint-key.sh`](../../backend/novu-bridge/config/novu-mint-key.sh):
`register` → JWT → read the Development env key), wires it into the compose
`.env`, and recreates `novu-bridge`. No dashboard signup, no second deploy.
(Pin `novu_api_key:` in host_vars to use an external key instead — a pinned key
skips minting.) The seed (part B) also runs at the end of this deploy.

`novu-bridge` can now reach Novu — but nothing **delivers** until a provider is
added (Step 3).

---

## Step 3 — add a provider

Credentials live in Novu, not our DB. Pick one:

- **Self-service:** Configurator → *Notifications → Notification Providers → Add
  provider* (Twilio SMS/WhatsApp or SMTP) → Verify → Test-send. See the
  [tutorial](./TUTORIAL.md).
- **Ansible-bootstrapped:** set `twilio_account_sid` / `twilio_auth_token` /
  `twilio_whatsapp_from` in host_vars and re-run `./deploy.sh <tenant>` — creates
  the Twilio integration plus all three workflows: the `complaints-sms` /
  `complaints-email` pass-through workflows the bridge triggers, and the legacy
  `complaints-whatsapp-v1` workflow.

---

## Step 4 — (re)seed / update the MDMS masters anytime

Whenever you change routing/templates (or want to confirm the masters are
present), run the seed on its own — no full redeploy, no downtime:

```bash
./deploy.sh <tenant> --tags notifications
```

Idempotent: existing rows are skipped, new/changed rows are added. This is the
"just add the notification config" add-on path.

---

## Step 5 — verify the cutover

```bash
# Novu integration exists
curl -s -H "Authorization: ApiKey <novu_api_key>" https://<host>/novu-api/v1/integrations | jq '.data[] | {providerId, channel, active}'

# Masters present → Configurator → Notifications → Routing / Templates / Provider Templates

# File a complaint on <tenant>, then:
docker exec <pg_container> psql -U egov -d postgres -c \
  "select event_name, channel, status, last_error_code from nb_dispatch_log order by createdtime desc limit 10;"
```

Expect `SENT` rows for the enabled channels. `SENT` = Novu accepted the trigger;
confirm real delivery in the Novu dashboard / Twilio console
([runbook §8](./provider-onboarding-runbook.md#8-verifying-delivery)).

---

## Rollback (instant, per-tenant)

Set `pgr_notification_config_driven: false` and redeploy `pgr-services` — PGR
falls back to the legacy notification path immediately. The Novu stack can keep
running harmlessly, or set `enable_novu: false` and redeploy to remove the 8
containers. Because the cutover is a single per-tenant flag, you can roll a
fleet forward (or back) one tenant at a time.
