# Notifications enablement — runbook

Enable config-driven PGR notifications (SMS · email · WhatsApp) on a **running**
DIGIT/CCRS deployment. Terse; every command was run on a real box.

State root tenant below is `<root>` (e.g. `ke`, `mz`). Config is authored there; city
tenants inherit.

**Scripts** — the runnable pieces (the installer chains them; run individually to resume/verify):
- [`enable-notifications.sh`](../../local-setup/scripts/enable-notifications.sh) — **primary path**: whole flow, resumable + pre/post-validated per step
- [`seed-notifications.py`](../../local-setup/scripts/seed-notifications.py) — seed the 4 MDMS masters
- [`persist-provider-templates.py`](../../local-setup/scripts/persist-provider-templates.py) — pull **your** approved Twilio SIDs → MDMS
- [`drive-test-complaint.py`](../../local-setup/scripts/drive-test-complaint.py) — the final **drive + verify** (self-discovering)
- [`bootstrap-novu-whatsapp.sh`](../../backend/novu-bridge/config/bootstrap-novu-whatsapp.sh) · [`novu-mint-key.sh`](../../backend/novu-bridge/config/novu-mint-key.sh) — Novu integration + workflows / API key

---

## 1. Services — what runs, what to set, which image

| Service | Does | Env to set | Image |
|---|---|---|---|
| **pgr-services** | Brain: reads the routing/template MDMS, renders one message per (recipient × channel), emits to Kafka `complaints.domain.events` | `PGR_NOTIFICATION_CONFIG_DRIVEN=true` | `egovio/pgr-services:whatsapp-contentsid-pipeline-f76f6ea` (public Docker Hub, multi-arch — has the Content-SID path). The base `develop-*` images do **not**. |
| **novu-bridge** | Hands: consumes Kafka → triggers Novu per channel → logs `nb_dispatch_log`; also serves the configurator's `/novu-adapter/v1/*` API | `NOVU_API_KEY`, `NOVU_BRIDGE_CHANNELS_ENABLED`, `NOVU_BRIDGE_PROXY_ALLOWED_ROLES` | `egovio/novu-bridge:whatsapp-contentsid-pipeline-f76f6ea` (public Docker Hub, multi-arch). The base `develop-*` tags lack the Content-SID WhatsApp path. |
| **digit-config-service** | backs the configurator provider/template screens | — | current develop |
| **novu-mongo / novu-api / novu-worker** | Novu core; `novu-worker` is what actually calls Twilio/SMTP | — | `ghcr.io/novuhq/novu/*:2.3.0` |
| **novu-dashboard / novu-ws** | Novu admin UI (enter creds, watch delivery) | dashboard public-URL envs (§2 step 5) | `ghcr.io/novuhq/novu/*:2.3.0` |

Skip `digit-user-preferences-service` unless you want per-user consent — the preference
gate defaults **off** (and is fail-closed if on with no seeded consent).

---

## 2. Enable — the steps

**Primary path: run the installer.** [`local-setup/scripts/enable-notifications.sh`](../../local-setup/scripts/enable-notifications.sh)
is the self-narrating, resumable, validated form of everything below — it pins the Content-SID
images, mints the Novu key, opens the channel gate, seeds the masters, and bootstraps Novu, with
loud-failing pre/postconditions. Export the three `TWILIO_*` vars and your external `PUBLIC_URL`
(pass `--local` only if the box itself is the public origin), then `./enable-notifications.sh`.
The steps below are the same thing by hand, for when you need to do one piece.

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
# Content-SID WhatsApp needs THIS image (public Docker Hub, multi-arch); the base
# develop-* tags lack the Content-SID path. Pin the matching pgr-services image too.
sudo sed -i 's|^NOVU_BRIDGE_IMAGE=.*|NOVU_BRIDGE_IMAGE=egovio/novu-bridge:whatsapp-contentsid-pipeline-f76f6ea|' /opt/digit/.env
sudo sed -i 's|^PGR_SERVICES_IMAGE=.*|PGR_SERVICES_IMAGE=egovio/pgr-services:whatsapp-contentsid-pipeline-f76f6ea|' /opt/digit/.env
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
Or run [`bootstrap-novu-whatsapp.sh`](../../backend/novu-bridge/config/bootstrap-novu-whatsapp.sh),
which also creates the Twilio integration. **For a standalone run you must set
`NOVU_BASE_URL=http://localhost:14002`** — its built-in default is `:1336` (wrong for this stack;
`enable-notifications.sh` passes `:14002` for you, so this only bites a bare `bash bootstrap-novu-whatsapp.sh`).

**9 — WhatsApp only: your Content templates → your SIDs** *(SMS/email skip this)* — author +
Meta-approve your Content templates, then persist your account's SIDs to MDMS. See **§5.0–5.2**.

**10 — Drive a complaint + verify** — the final check. Run
[`drive-test-complaint.py`](../../local-setup/scripts/drive-test-complaint.py) (or file one by hand),
then confirm delivery — see **[§5.4](#54-drive-a-real-complaint-and-verify--the-final-step)**.

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

## 5. WhatsApp last-mile — templates → SIDs → test-send → drive a complaint

SMS/email work once §4 is seeded and a provider added (§2.7). WhatsApp needs three more things:
your **approved Content templates**, their **SIDs persisted into MDMS**, and a **real send verified**.
The `<token>` below is an employee/admin Bearer token; `<host>` is your external origin.

### 5.0 Author your Content templates FIRST
A fresh Twilio account has **zero** approved templates → every WhatsApp leg comes back
`SKIPPED / NB_TEMPLATE_NOT_APPROVED`. Before anything else you must build the ~14 Content templates
in **Twilio's Content Template Builder** and get each one **Meta-approved**. Use the seed JSON
[`RAINMAKER-PGR.NotificationProviderTemplate.json`](../../utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationProviderTemplate.json)
as the canonical reference for which events exist and the ordered `variables` each template expects
(`[complaint_type, id, date, …]` → Twilio `{{1}},{{2}},…`). It carries the naming/variable layout,
**not** approved bodies — you author those in Twilio.

### 5.1 Sync + persist from the configurator (primary path)
Configurator → **Notification Providers** → **Sync WhatsApp templates**. The dialog pulls your
account's approved templates, auto-matches them to routing rows (approved pre-selected; unmatched
shown as diagnostics), and **Persist** upserts them into `RAINMAKER-PGR.NotificationProviderTemplate`.
Idempotent (create-or-update by routing tuple).

![Notification Providers → Sync WhatsApp templates](https://raw.githubusercontent.com/KDwevedi/Citizen-Complaint-Resolution-System/screenshots-notifications/notifications/configurator-notification-providers.png)
![Sync dialog — 14 matched, review + Persist](https://raw.githubusercontent.com/KDwevedi/Citizen-Complaint-Resolution-System/screenshots-notifications/notifications/configurator-sync-twilio-templates.png)

### 5.2 …or the same thing headless (CLI)
```bash
# pull
curl -H "Authorization: Bearer <token>" \
  http://<host>/novu-bridge/novu-adapter/v1/providers/twilio-templates
# pull + upsert your SIDs into MDMS (--dry-run to preview)
DIGIT_URL=http://<host> NOTIF_TENANT=<root> DIGIT_USERNAME=SUPERADMIN DIGIT_PASSWORD=eGov@123 \
  python3 local-setup/scripts/persist-provider-templates.py
```
[`persist-provider-templates.py`](../../local-setup/scripts/persist-provider-templates.py) exits
non-zero if coverage is incomplete (< 7 stock routing keys), so you know WhatsApp isn't fully wired.

### 5.3 Test-send
```bash
curl -X POST -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
  http://<host>/novu-bridge/novu-adapter/v1/providers/test-send \
  -d '{"channel":"WHATSAPP","to":{"phone":"+2547XXXXXXXX"},"contentSid":"HXxxxxxxxx","variables":["Garbage","CMP-123","2026-07-17"]}'
```
Bearer auth; writes one `TEST`-tagged `nb_dispatch_log` row. A `SKIPPED/NB_TEMPLATE_NOT_APPROVED`
here means §5.0 isn't done for that template.

### 5.4 Drive a real complaint and verify — the FINAL step

Do this only after §4 (seed) and §5.0–5.2 (your Content templates + persisted SIDs). Fully scripted +
self-discovering: [`local-setup/scripts/drive-test-complaint.py`](../../local-setup/scripts/drive-test-complaint.py)
— finds a city tenant/locality/serviceCode, creates a citizen, files a complaint, and runs the three
checks below.
```bash
python3 local-setup/scripts/drive-test-complaint.py --mobile 7011854675 --country +91
```
Filing by hand needs: a **city** tenant with boundaries (`INVALID_BOUNDARY` at the state root), a real
`address.locality.code` (`select code from boundary_relationship where boundarytype='Locality'`), a
non-null `geoLocation` (null crashes the persister → 200 but no row), a `ComplaintHierarchy` leaf
`serviceCode`, and filing as a **CITIZEN** (SUPERADMIN gets `INVALID ROLE` on `APPLY`).

**What "done" looks like — three levels of truth:**
```bash
# 1) bridge accepted + emitted — WhatsApp row SENT
sudo docker exec docker-postgres psql -U egov -d egov -c \
 "select event_name,channel,status,last_error_code from nb_dispatch_log order by created_time desc limit 10;"
# 2) Novu actually sent (SENT above only = trigger accepted, async):
KEY=$(sudo docker exec novu-bridge printenv NOVU_API_KEY)
curl -s "http://localhost:14002/v1/messages?limit=20" -H "Authorization: ApiKey $KEY" \
 | jq -r '.data[] | "\(.transactionId)\t\(.status)\t\(.errorId // "")"'   # want status=sent
# 3) reached the handset — Twilio Messages API final status = delivered/read
```
> **WhatsApp shows up as `channel=sms` in Novu** (`complaints-whatsapp` is an sms-type step), so
> `?channel=whatsapp` returns 0 — split SMS vs WhatsApp by the **`transactionId` suffix**
> (`…:WHATSAPP` vs `…:SMS`), not by Novu's `channel`. `SENT` in `nb_dispatch_log` ≠ delivered; the
> Novu message status and Twilio's final status are the truth.

---

## 6. Channel status

- **SMS** — fully pipeline-wired; works once the masters are seeded (§4) and a Twilio provider added (§2.7).
- **Email** — the pipeline and the `complaints-email` workflow are wired, **but delivery still needs a
  Novu SMTP integration added by hand** in the Novu dashboard. `bootstrap-novu-whatsapp.sh` creates the
  Twilio integration + the email *workflow* only — **no SMTP provider**. Until you add one, email
  triggers "succeed" (workflow fires) but nothing is delivered; only **SMS + WhatsApp** actually send.
- **WhatsApp** — needs (a) the **Content-SID-pipeline** images of pgr-services + novu-bridge (so
  the pipeline sends the approved template, not free-form; free-form is rejected `63016`),
  (b) `NotificationProviderTemplate` rows pointing at **your** account's approved Content SIDs, and
  (c) the §5 last-mile done. Business-initiated WhatsApp without an approved template = SKIP, by design.

> **Reference box (8c24g):** it runs **hand-built local image tags**
> (`pgr-services:wa-contentsid` / `novu-bridge:wa-sync`) of the **same commit** as the published
> `egovio/{pgr-services,novu-bridge}:whatsapp-contentsid-pipeline-f76f6ea` images — so the "running
> images" there won't literally match the published tag names, though the code is identical.
