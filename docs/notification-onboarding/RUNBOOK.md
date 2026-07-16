# Notifications enablement — runbook

Enable config-driven PGR notifications (SMS · email · WhatsApp) on a **running**
DIGIT/CCRS deployment. Terse; every command was run on a real box.

State root tenant below is `<root>` (e.g. `ke`, `mz`). Config is authored there; city
tenants inherit.

---

## 1. Services — what runs, what to set, which image

| Service | Does | Env to set | Image |
|---|---|---|---|
| **pgr-services** | Brain: reads the routing/template MDMS, renders one message per (recipient × channel), emits to Kafka `complaints.domain.events` | `PGR_NOTIFICATION_CONFIG_DRIVEN=true` | current develop (needs the **Content-SID-pipeline** build for WhatsApp *templates*) |
| **novu-bridge** | Hands: consumes Kafka → triggers Novu per channel → logs `nb_dispatch_log`; also serves the configurator's `/novu-adapter/v1/*` API | `NOVU_API_KEY`, `NOVU_BRIDGE_CHANNELS_ENABLED`, `NOVU_BRIDGE_PROXY_ALLOWED_ROLES` | **pin a current `develop-YYYYMMDD` tag — NOT `:latest`** (it goes months stale) |
| **digit-config-service** | backs the configurator provider/template screens | — | current develop |
| **novu-mongo / novu-api / novu-worker** | Novu core; `novu-worker` is what actually calls Twilio/SMTP | — | `ghcr.io/novuhq/novu/*:2.3.0` |
| **novu-dashboard / novu-ws** | Novu admin UI (enter creds, watch delivery) | dashboard public-URL envs (§5) | `ghcr.io/novuhq/novu/*:2.3.0` |

Skip `digit-user-preferences-service` unless you want per-user consent — the preference
gate defaults **off** (and is fail-closed if on with no seeded consent).

---

## 2. Enable — the steps

Compose helper (**name services explicitly** — a bare `up -d` revives `default-data-handler`, which re-seeds MDMS):
```bash
cd /opt/digit
C="sudo docker compose -f docker-compose.egov-digit.yaml -f docker-compose.fast-path.yml -f docker-compose.migrations.yml -f docker-compose.migrations.ansible.yml"
```

**1 — PGR onto the config-driven path**
```bash
sudo sed -i 's/^PGR_NOTIFICATION_CONFIG_DRIVEN=.*/PGR_NOTIFICATION_CONFIG_DRIVEN=true/' /opt/digit/.env
eval "$C up -d pgr-services"
```

**2 — Pin the bridge + bring up the Novu stack**
```bash
sudo sed -i 's|^NOVU_BRIDGE_IMAGE=.*|NOVU_BRIDGE_IMAGE=<registry>/egovio/novu-bridge:develop-YYYYMMDD|' /opt/digit/.env
eval "$C up -d novu-mongo novu-api novu-worker novu-ws novu-dashboard novu-bridge \
              digit-config-service novu-bridge-migration digit-config-service-migration"
```

**3 — Mint + wire the Novu key**
```bash
KEY=$(NOVU_API_URL=http://localhost:14002 bash /opt/ccrs/backend/novu-bridge/config/novu-mint-key.sh)
echo "NOVU_API_KEY=$KEY" | sudo tee -a /opt/digit/.env >/dev/null
eval "$C up -d novu-bridge"
```

**4 — Channel gate + let the config-admin use the configurator screens**
```bash
echo 'NOVU_BRIDGE_CHANNELS_ENABLED=SMS,EMAIL,WHATSAPP'                     | sudo tee -a /opt/digit/.env >/dev/null
echo 'NOVU_BRIDGE_PROXY_ALLOWED_ROLES=EMPLOYEE,SUPERUSER,GRO,PGR_LME,MDMS_ADMIN' | sudo tee -a /opt/digit/.env >/dev/null
# both must be passed by the compose novu-bridge service (they are NOT by default — add them once)
eval "$C up -d --force-recreate novu-bridge"
sudo docker restart kong-gateway   # a bridge recreate poisons Kong's DNS cache → flush it
```

**5 — Ingress** *(only if you did NOT deploy with `enable_novu:true`)* — add the nginx
`/novu` `/novu-api` `/novu-ws` blocks + the dashboard public-URL envs, and open the port
(`sudo ufw allow 80/tcp`). Copy the `/novu` `/novu-api` `/novu-ws` blocks from
[`local-setup/ansible/templates/nginx-site.conf.j2`](../../local-setup/ansible/templates/nginx-site.conf.j2).

**6 — Seed the MDMS masters** — §4 below.

**7 — Add a provider** — Configurator → *Notification Providers → Add* (Twilio SMS/WhatsApp,
`from = whatsapp:+<sender>`; or SMTP) → **Verify** → **Test-send**. Credentials go to Novu.

**8 — Create the per-channel Novu workflows** *(if not bootstrapped)*:
```bash
KEY=$(sudo docker exec novu-bridge printenv NOVU_API_KEY)
for W in complaints-sms:sms complaints-email:email complaints-whatsapp:sms; do
  ID=${W%:*}; T=${W#*:}
  curl -s -X POST http://localhost:14002/v2/workflows -H "Authorization: ApiKey $KEY" -H 'Content-Type: application/json' -d "{\"workflowId\":\"$ID\",\"name\":\"$ID\",\"active\":true,\"validatePayload\":false,\"steps\":[{\"name\":\"s\",\"type\":\"$T\",\"controlValues\":{\"body\":\"{{ payload.body }}\"}}]}" | grep -o '"workflowId":"[^"]*"' | head -1
done
```

**9 — Drive a complaint, then verify**
```bash
sudo docker exec docker-postgres psql -U egov -d egov -c \
 "select event_name,channel,status,last_error_code from nb_dispatch_log order by created_time desc limit 10;"
```
`SENT` in `nb_dispatch_log` = Novu **accepted** the async trigger — **not** proof of delivery. Ask
Novu itself whether the send actually succeeded (status `sent`, not `error`; surface any `errorId`):
```bash
KEY=$(sudo docker exec novu-bridge printenv NOVU_API_KEY)
curl -s "http://localhost:14002/v1/messages?limit=20" -H "Authorization: ApiKey $KEY" \
 | jq -r '.data[] | "\(.channel)\t\(.status)\t\(.errorId // "")"'
```
**`SENT` in `nb_dispatch_log` ≠ delivered** — the Novu message status (and the handset/inbox, or the
Twilio Messages API) is the truth.

---

## 3. The 4 MDMS records (author at `<root>`)

| Record | What it is | Update when… | Leave alone when… |
|---|---|---|---|
| `RAINMAKER-PGR.NotificationRouting` | **Switchboard.** One row per `(action, toState, audience, channel)` = who gets notified, on which channel, for which transition | adding/removing a channel or audience; running a **custom workflow** (your states differ from stock) | stock workflow — seeded rows fit |
| `RAINMAKER-PGR.NotificationTemplate` | **SMS/email text.** Body (+ email subject) per `(…, channel, locale)` | changing wording; **adding a language** | the WhatsApp wording — it's not here (see below) |
| `RAINMAKER-PGR.NotificationProviderTemplate` | **WhatsApp only.** Maps a routing key → your Twilio **Content SID** + ordered variables | pointing at **your** account's approved SIDs; adding a locale/event | SMS/email — they never read it |
| `common-masters.MobileNumberValidation` | **Country code + regex** → how the recipient phone is formatted for Twilio | your deployment's country (e.g. `+254` vs `+91`) | it already matches your recipients' numbers |

**WhatsApp gotcha:** `NotificationTemplate.body` ≠ the WhatsApp message. WhatsApp sends the
**Meta-approved Twilio template** referenced by the Content SID; the body only drives SMS/email.
So the SMS/email wording (here) and the WhatsApp wording (on Twilio) are maintained separately,
linked only by the `variables` order (`[complaint_type, id, date, …]` → Twilio `{{1}},{{2}},…`).

---

## 4. Seed the masters

Standalone, idempotent, **no ansible** — hits the running MDMS API (`DIGIT_URL` = the gateway
origin your configurator uses). From a CCRS `develop` checkout:
```bash
cd /opt/ccrs/local-setup/scripts && mkdir -p notification-seed
cp ../../utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json \
   ../../utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.Notification*.json \
   notification-seed/

DIGIT_URL=http://<host> NOTIF_TENANT=<root> \
  DIGIT_USERNAME=<root-admin> DIGIT_PASSWORD=eGov@123 \
  SCHEMA_FILE=notification-seed/RAINMAKER-PGR.json DATA_DIR=notification-seed \
  python3 seed-notifications.py
```
`<root-admin>` = **`SUPERADMIN`** on a `default-data-handler`-seeded box, **`ADMIN`** on an
MCP-bootstrapped one. Example output:
```
seed-notifications: tenant=ke url=http://<host>
  schema CREATED RAINMAKER-PGR.NotificationRouting
  schema CREATED RAINMAKER-PGR.NotificationTemplate
  schema CREATED RAINMAKER-PGR.NotificationProviderTemplate
  data RAINMAKER-PGR.NotificationRouting             +24 created, 0 already-present, 0 FAILED (24 in file)
  data RAINMAKER-PGR.NotificationTemplate            +42 created, 0 already-present, 0 FAILED (42 in file)
  data RAINMAKER-PGR.NotificationProviderTemplate    +14 created, 0 already-present, 0 FAILED (14 in file)
DONE: 80 created, 0 already-present.
```
Idempotent — re-run any time; existing rows are skipped. Already have them (a box running
`default-data-handler` with `dev.enabled=true` seeds them ~4 min after start)? This is a verify,
not a create.

---

## 5. Channel status

- **SMS + Email** — fully pipeline-wired; work once the masters are seeded and a provider is added.
- **WhatsApp** — needs (a) the **Content-SID-pipeline** build of pgr-services + novu-bridge (so
  the pipeline sends the approved template, not free-form; free-form is rejected `63016`), and
  (b) `NotificationProviderTemplate` rows pointing at **your** account's approved Content SIDs.
  Business-initiated WhatsApp without an approved template = SKIP, by design.
