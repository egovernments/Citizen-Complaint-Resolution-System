<!-- REFERENCE BACKBONE (draft). Generated + code-verified 2026-07-06.
This is the accurate content backbone for the screenshot-based operator TUTORIAL,
which will be written after the self-service provider screens land (see
docs/plans/2026-07-06-configurator-provider-management-design.md).
The verify-pass corrections have been folded into the body; one minor open note remains in the appendix. -->

# Runbook: Onboarding a New Notification Provider (Config-Driven PGR Notifications)

**Applies to:** DIGIT/CCRS PGR config-driven notifications, branch `feat/pgr-notifications-configure` (deployed).
**Audience:** Operators/engineers wiring SMS, Email, or WhatsApp delivery for a new deployment or adding a provider.
**Secrets:** Every credential in this doc is a `<PLACEHOLDER>`. Never paste real account SIDs, auth tokens, or API keys into shared docs or commits.

> **IMPORTANT ACCURACY NOTE — read before you start.**
> A common premise is *"WhatsApp is delivered novu-bridge → Twilio ContentSid directly, not through Novu."* **This is inaccurate for the current deployed branch.** On `feat/pgr-notifications-configure`:
> - `novu-bridge` is a **pure pass-through**. It does **not** resolve templates/providers/localization and makes **zero** direct Twilio API calls (no `api.twilio.com`).
> - **WhatsApp is delivered by nothing** today — `WHATSAPP` is deliberately absent from `NOVU_BRIDGE_CHANNELS_ENABLED` (`=SMS,EMAIL`), so every WhatsApp event is honestly recorded as `SKIPPED / NB_NO_PROVIDER`.
> - The legacy Twilio-ContentSid override path (`TwilioProviderStrategy` → `_passthrough.body.contentSid` → `overrides.providers.twilio`) still routed **through Novu** (`POST /v1/events/trigger` with overrides), not direct-to-Twilio. It is **dead code** in pass-through mode.
> - The old Baileys WhatsApp-Web service was **fully removed**.
>
> The **ContentSid mapping** (`RAINMAKER-PGR.NotificationProviderTemplate`) is the **forward/design path** for WhatsApp, not the live runtime. Section 5 documents both what to prepare on the Twilio side and the hard truth about what it takes to actually deliver.

---

## 1. Overview

### 1.1 Delivery paths

| Channel | Enabled by default? | How it's delivered today |
|---------|--------------------|--------------------------|
| **SMS** | Yes (`SMS` in `NOVU_BRIDGE_CHANNELS_ENABLED`) | novu-bridge → Novu workflow `complaints-sms` → Novu **Twilio** integration (`channel:"sms"`) → SMS |
| **EMAIL** | Yes (`EMAIL` in the enabled list) | novu-bridge → Novu workflow `complaints-email` → Novu **nodemailer/SMTP** integration (dashboard-configured) → email |
| **WHATSAPP** | **No** (deliberately absent) | **Not delivered.** Gated off → every event = `SKIPPED / NB_NO_PROVIDER`. Forward path = ContentSid mapping in MDMS master (design, see §5) |

### 1.2 The three MDMS masters (who → what → how)

1. **`RAINMAKER-PGR.NotificationRouting`** — *WHO* gets notified and over *WHICH* channel for a transition. Read by pgr-services `NotificationRouter`.
2. **`RAINMAKER-PGR.NotificationTemplate`** — *WHAT* the message says (body/subject with `{tokens}`). pgr-services `TemplateRenderer` fills placeholders and publishes the rendered text **before** delivery.
3. **`RAINMAKER-PGR.NotificationProviderTemplate`** — *HOW* an external provider delivers a pre-approved template (provider template id + ordered variables). Read when the provider needs a pre-approved template (WhatsApp/Twilio Content SID).

### 1.3 ASCII flow

```
                         PGR (pgr-services)
        reads RAINMAKER-PGR.NotificationRouting   (WHO + which channel)
        reads RAINMAKER-PGR.NotificationTemplate  (WHAT: body/subject, per-locale)
        renders + localizes  ->  ONE event per (recipient x channel)
                                   |
                                   v
                   Kafka topic:  complaints.domain.events
                          (retry: novu-bridge.retry / dlq: novu-bridge.dlq)
                                   |
                                   v
                     novu-bridge  (pure pass-through)
          1) identify/upsert Novu subscriber  POST /v1/subscribers
          2) preference gate  ->  contact gate  ->  channel gates
          3) trigger per-channel workflow      POST /v1/events/trigger
          4) record outcome in  nb_dispatch_log  (keyed by transactionId)
                    |                 |                     |
        channel=SMS |   channel=EMAIL |    channel=WHATSAPP |
                    v                 v                     v
        workflow            workflow            NOT in NOVU_BRIDGE_CHANNELS_ENABLED
        complaints-sms      complaints-email    -> SKIPPED / NB_NO_PROVIDER
             |                   |               (verifyNoInteractions with Novu;
             v                   v                never falls back to another channel)
    Novu Twilio SMS      Novu nodemailer/
    integration ->       SMTP integration
    Twilio -> SMS        (dashboard) -> email
```

---

## 2. Concepts glossary

| Term | Meaning in this system |
|------|------------------------|
| **Channel** | Transport enum, strictly one of `SMS`, `WHATSAPP`, `EMAIL` (`KNOWN_CHANNELS`). Any other value fails schema validation / hits `NB_UNSUPPORTED_CHANNEL`. The **delivery gate** is `NOVU_BRIDGE_CHANNELS_ENABLED` (plural). Do **not** confuse with the legacy singular `NOVU_BRIDGE_CHANNEL` (default `SMS`), which the config-driven path does not use. |
| **Provider** | The external sender behind a channel — e.g. `twilio` (SMS), a nodemailer/SMTP host (email). In the MDMS master the `provider` field names it (e.g. `twilio`). |
| **Integration** | A **Novu-side** provider configuration record (credentials + channel binding), created via `POST /v1/integrations`. Novu's only bootstrap-created integration is **Twilio bound to `channel:"sms"`**. Email/WhatsApp integrations, if any, must be added in the Novu dashboard. |
| **Routing** | A `NotificationRouting` row: for a `(businessService, action, toState, audience, channel)` it declares that this audience is notified over this channel. Runtime matches on **`action + toState`** (`fromState` is documentation/UI-only). |
| **Template** | A `NotificationTemplate` row: the localized `body`/`subject` with `{token}` placeholders, keyed per `(audience, action, toState, channel, locale)`. Replaces the legacy `PGR_<ROLE>_<ACTION>_<STATUS>_SMS_MESSAGE` localization keys. |
| **Provider-template** | A `NotificationProviderTemplate` row: maps a rendered notification to a pre-registered provider template id (`templateId` = Twilio Content SID `HX…`) plus an **ordered** `variables[]` list substituted positionally into the provider template. |

---

## 3. Onboard an SMS provider (Twilio, via Novu)

SMS is the fully-supported delivery path. The Novu Twilio SMS integration is what actually sends.

### 3.1 Prerequisites
- Novu stack running (enable with `enable_novu: true`; adds `novu-api`, `novu-worker`, `novu-ws`, `novu-dashboard`, `novu-mongo`, `novu-bridge`, `digit-config-service`, `digit-user-preferences-service`).
- A **real Novu environment API key**. The two-deploy flow: first boot → operator signs up at `/novu/` to mint the key → second deploy wires it. Bomet uses a Novu **DEVELOPMENT**-environment key (workflow creation is only allowed in Dev on self-hosted Novu).
- An **SMS-capable Twilio number you OWN**, in plain E.164 (e.g. `<TWILIO_SMS_FROM_E164>`). This is a *different* number from any WhatsApp sender.

> The defaults `test-api-key-123` (app) and `changeme` (compose) will **not** work — Novu returns 401. Override with the real key at deploy time.

### 3.2 Create the Novu Twilio integration
Header format is `Authorization: ApiKey <key>` — **space, capital A/K, not `Bearer`** (wrong format → 401).

```bash
curl -X POST "${NOVU_BASE_URL}/v1/integrations" \
  -H "Authorization: ApiKey <NOVU_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
        "providerId": "twilio",
        "channel": "sms",
        "active": true,
        "credentials": {
          "accountSid": "<TWILIO_ACCOUNT_SID>",
          "token": "<TWILIO_AUTH_TOKEN>",
          "from": "<TWILIO_SMS_FROM_E164>"
        }
      }'
```

This is exactly what `config/bootstrap-novu-whatsapp.sh` does (despite its name it creates the **Twilio SMS** integration). The same script also creates the workflow via the Novu v2 API:

```bash
curl -X POST "${NOVU_BASE_URL}/v2/workflows" \
  -H "Authorization: ApiKey <NOVU_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{ "...": "single step of type \"sms\"", "workflowId": "complaints-sms" }'
```

> **Workflow-id gotcha.** The pass-through pipeline resolves workflow ids `complaints-sms` / `complaints-whatsapp` / `complaints-email` (envs `NOVU_BRIDGE_WORKFLOW_ID_SMS/_WHATSAPP/_EMAIL`). But the bootstrap script also has an older convention that creates `complaints-whatsapp-v1` and event-convention workflows (`COMPLAINTS.WORKFLOW.APPLY`, …). On Bomet only **`complaints-sms`** (and email) actually exist in the Dev env. If a channel's workflow was never created in Novu, `/v1/events/trigger` fails → `FAILED / NB_NOVU_TRIGGER_FAILED`.

### 3.3 Enable the channel
`SMS` is already in the default `NOVU_BRIDGE_CHANNELS_ENABLED=SMS,EMAIL`, so no change needed for SMS-only. Confirm the env is not overridden to exclude it.

### 3.4 Ansible wiring (per-deployment)
Set host_vars (secrets are placeholders here):
```yaml
enable_novu: true
pgr_notification_config_driven: true
novu_api_key: "<NOVU_API_KEY>"          # empty -> bootstrap + key-wiring SKIPPED, bridge can't dispatch (401)
twilio_account_sid: "<TWILIO_ACCOUNT_SID>"
twilio_auth_token: "<TWILIO_AUTH_TOKEN>"
```
The deploy playbook writes `NOVU_API_KEY=` into the compose `.env`, **force-recreates** `novu-bridge` so it picks up the key, and only runs the notif seed when `twilio_account_sid` length > 0.

### 3.5 Verify
- **Server-side list:** `GET ${NOVU_BASE_URL}/v1/integrations` (ApiKey) → confirm a `twilio` / `sms` / `active:true` row.
- **Configurator (read-only):** *Notifications → Notification Providers* (`GET /novu-bridge/novu-adapter/v1/integrations`). Shows only the allowlist `_id, providerId, channel, name, identifier, active, primary, environmentId`; the response is an **allowlist projection** — the `credentials` object is **not copied at all** (no key names, no `***` placeholders — nothing outside the allowlist ever leaves the service). There is deliberately **no** endpoint returning the raw Novu key or any secret.
- **End-to-end dry/real:**
  - `POST /novu-bridge/novu-adapter/v1/dispatch/_validate` — runs the pipeline, no send.
  - `POST /novu-bridge/novu-adapter/v1/dispatch/_dry-run?send=true` — optional real send.
  - `POST /novu-bridge/novu-adapter/v1/dispatch/_test-trigger` — direct Novu trigger (bypasses consent/config).
- File a complaint and check `nb_dispatch_log` for `status=SENT`. **`SENT` means Novu accepted the trigger, not that Twilio delivered** — confirm real delivery in Novu `db.messages` / `db.executiondetails` and the Twilio console (`delivered`/`read`).

---

## 4. Onboard an Email provider (nodemailer/SMTP, via Novu)

`EMAIL` is enabled by default, and novu-bridge triggers `complaints-email` through Novu. **But the repo ships no email-integration setup** — `bootstrap-novu-whatsapp.sh` only creates the Twilio SMS integration, and there is no nodemailer/SMTP script.

### 4.1 Steps
1. Confirm `EMAIL` is present in `NOVU_BRIDGE_CHANNELS_ENABLED` (default has it).
2. Confirm the `complaints-email` workflow exists in Novu (env `NOVU_BRIDGE_WORKFLOW_ID_EMAIL`, default `complaints-email`). If missing, triggers fail `FAILED / NB_NOVU_TRIGGER_FAILED`.
3. **In the Novu dashboard**, create an **email-channel integration** (nodemailer / SMTP, e.g. Gmail SMTP) with your SMTP host/credentials. This is manual — there is no script.
4. Ensure recipients actually have an email address — the **contact gate** drops any EMAIL event with no `contact.email` as `SKIPPED / NB_CONTACT_MISSING` (bridge-side defense against phantom-SENT on a shared topic).

### 4.2 Verify
- `POST /novu-bridge/novu-adapter/v1/dispatch/_test-trigger` for an EMAIL row, then check `nb_dispatch_log`.
- If `nb_dispatch_log` shows `SENT` but no email arrives, the trigger reached Novu but **Novu has no email provider to deliver through** — create the nodemailer/SMTP integration (step 3).
- `subject` is meaningful **only for EMAIL** (`null` for SMS/WhatsApp). novu-bridge puts `renderedBody` in `payload.body` and includes `subject` only when a rendered subject exists.

---

## 5. Onboard a WhatsApp provider (Twilio WABA)

> **Read the accuracy note at the top first.** On the deployed pass-through branch, adding WhatsApp requires **two independent things**, and the ContentSid mapping alone does **not** deliver:
> 1. **A real WhatsApp integration onboarded as a Novu integration** + a working `complaints-whatsapp` Novu workflow. Novu currently has **no** WhatsApp integration (only Twilio-`sms`). WhatsApp cannot ride Novu SMS channel-routing.
> 2. **`WHATSAPP` added to `NOVU_BRIDGE_CHANNELS_ENABLED`.**
>
> Adding `WHATSAPP` to the env **without** the Novu-side provider just flips `SKIPPED / NB_NO_PROVIDER` into an attempted trigger that then fails downstream (`FAILED / NB_NOVU_TRIGGER_FAILED`).

The Twilio-side preparation below is required regardless (it produces the approved Content templates and their `HX…` SIDs), and is the forward path the design targets.

### 5.1 Register a live WABA sender (not the sandbox)
- **Production must use an approved WABA sender** in `whatsapp:+<E164>` form (Bomet's is `ONLINE` and reaches `delivered`/`read`).
- The Twilio **sandbox** number `whatsapp:+14155238886` is **OFFLINE / do-not-use**: it returns **error 63015** unless the exact recipient first sends `join <code>` to it (opens only a 24h window).
- **Trap:** the Ansible/example default `twilio_whatsapp_from` is the sandbox number. A fresh tenant that never edits it is silently on the sandbox. Set:
  ```yaml
  twilio_whatsapp_from: "whatsapp:+<YOUR_WABA_SENDER_E164>"
  ```
  (exported as env `TWILIO_WHATSAPP_FROM`). WhatsApp and SMS senders are **different numbers** — a WhatsApp-only sender cannot send SMS.

### 5.2 Create and approve Content templates (Twilio Content API)
Free-form WhatsApp is **rejected** for business-initiated messages — you must send an **approved Content template** (`HX…` ContentSid) plus **positional** `contentVariables` `{{1}},{{2}},…`.

- **List templates + approval status:**
  ```bash
  curl -u "<TWILIO_ACCOUNT_SID>:<TWILIO_AUTH_TOKEN>" \
       "https://content.twilio.com/v1/ContentAndApprovals"
  ```
  Only `approvalStatus = approved` templates are sendable; `rejected`/`unsubmitted` fail safe to SKIPPED (never a Twilio 400).
- **Verify a single template's variable order** before mapping/swapping a SID:
  ```bash
  curl -u "<TWILIO_ACCOUNT_SID>:<TWILIO_AUTH_TOKEN>" \
       "https://content.twilio.com/v1/Content/<SID>"
  ```
  Positional order **cannot be auto-trusted** — confirm `{{n}}` slots against the live body and keep `variables[]` aligned. Swapping a SID without re-checking silently corrupts messages.
- **Only CITIZEN-audience templates are approved today (~26–28).** GRO/PGR_LME/EMPLOYEE WhatsApp needs new Meta-approved templates (~2-day approval); until then officer WhatsApp legs SKIP and officers get SMS+Email only.
- **Error 63016** (distinct from 63015) = message sent outside the 24h window **without** an approved Content template. Approved ContentSids solve 63016; they do **not** solve 63015 (which is "recipient hasn't joined the sandbox").

### 5.3 Map ContentSids into `RAINMAKER-PGR.NotificationProviderTemplate`
Add one row per `(provider, channel, audience, action, toState, locale)`. The Content SID goes in **`templateId`** (there is **no** field literally named `ContentSid`). `variables[]` is **order-sensitive** (positional substitution). Provider language codes are the **short** form `en`/`hi` mapped from our `en_IN`/`hi_IN`.

The 7 verified CITIZEN routing keys (EN / HI ContentSids + ordered variables):

| action.toState | EN ContentSid | HI ContentSid | Ordered `variables[]` |
|----------------|---------------|---------------|-----------------------|
| `APPLY.PENDINGFORASSIGNMENT` | `HX67fae4a61c4f50db8a11ebac21c50a79` | `HX0f48a25c5dff81a1c5ee47a2cd122b36` | `complaint_type, id, date` |
| `ASSIGN.PENDINGATLME` | `HX9d0ab22fb14080bdfd3d4cb43d9bd6f7` | `HX0d5538241557b1b56a910b8a48fc6b48` | `complaint_type, id, date, emp_name, emp_designation, emp_department` |
| `RESOLVE.RESOLVED` | `HXe6f34b83cc6e7179c0ede06472dd81fb` | `HX7676f0a4eb2f9da5b2f207b8a9202710` | `…, emp_name` |
| `REJECT.REJECTED` | `HXea318abc741dd5c09555617a4ecad490` | `HX38efc29e9d643f7e8717cbf11015c4aa` | `…, additional_comments` |
| `REOPEN.PENDINGFORASSIGNMENT` | `HXc7f239a0b267bbe208898c32bbd6034a` | `HX04e739b1b1e115e4a54f062f044738ac` | (as APPLY) |
| `REASSIGN.PENDINGFORREASSIGNMENT` | `HX7dc390ab0a8cd7cd3bde32768278dbd7` | `HX276d74eefa5ae90d2e0716a4cdc3c7ca` | `…, emp_name, emp_designation, emp_department` |
| `RATE.CLOSEDAFTERRESOLUTION` | `HXa0ad0ef3f58903809464f1707a9347a8` | `HX84ff2205a1ea72eaa1326fd93bb37368` | (rating-set) |

Example MDMS row (uid pattern `twilio.WHATSAPP.CITIZEN.{action}.{toState}.{locale}`):
```json
{
  "provider": "twilio",
  "channel": "WHATSAPP",
  "audience": "CITIZEN",
  "action": "APPLY",
  "toState": "PENDINGFORASSIGNMENT",
  "locale": "en_IN",
  "templateId": "HX67fae4a61c4f50db8a11ebac21c50a79",
  "templateName": "complaints_apply_pendingforassignment_message_new",
  "variables": ["complaint_type", "id", "date"],
  "approvalStatus": "approved",
  "active": true
}
```
The seeder `seed-provider-templates.py` registers this schema at tenant `ke` and inserts the 14 CITIZEN/WHATSAPP rows (7 keys × EN+HI), `approvalStatus="approved"`, `active=true`. You can also edit rows in the configurator: *Notifications → Provider Templates (WhatsApp)* (full CRUD via generic MDMS forms).

> **Two parallel wirings — don't conflate.** The **deployed runtime** actually reads `digit-config-service` masters `ProviderDetail` + `TemplateBinding` (table `eg_config_data`, seeded via `POST /config-service/config/v1/_create/<schema>`) — those `TemplateBinding` rows map `COMPLAINTS.WORKFLOW.{APPLY|…}` → the same `HX…` SIDs. The `RAINMAKER-PGR.NotificationProviderTemplate` MDMS master is the **forward design**. config-service does **no** hierarchical tenant fallback — seed the **exact** tenant the PGR event carries (often root `ke`, not `ke.<city>`), or every complaint fails `CONFIG_NOT_RESOLVED`. The upsert seeder needs `_search`/`_update`, which Kong does **not** route — run `seed.sh` in-cluster against `CONFIG_SERVICE_URL` (`http://digit-config-service:8080`), else it falls back to create-only and warns.

### 5.4 Enable the channel gate
Only after the Novu-side WhatsApp integration + `complaints-whatsapp` workflow exist:
```yaml
novu_bridge_channels_enabled: "SMS,EMAIL,WHATSAPP"   # env NOVU_BRIDGE_CHANNELS_ENABLED
```
Force-recreate `novu-bridge` so it re-reads the env.

### 5.5 Direct-trigger test shape
```bash
curl -X POST "<HOST>/novu-bridge/novu-adapter/v1/dispatch/_test-trigger" \
  -H "Content-Type: application/json" \
  -d '{
        "templateKey": "APPLY.PENDINGFORASSIGNMENT",
        "phone": "whatsapp:+<E164>",
        "contentSid": "HX67fae4a61c4f50db8a11ebac21c50a79",
        "contentVariables": { "1": "Jane Doe", "2": "CMP-123" }
      }'
```
Note: in pass-through mode `_test-trigger` **ignores** `contentSid`/`contentVariables` (PGR owns rendering); use it to exercise the trigger, not the template resolution.

### 5.6 OTP is intentionally NOT on Twilio
The `OTP.SEND` binding has **no** contentSid (`channel=sms`) and stays on the hardcoded OTP path — no `twilio/authentication` template exists (OTP templates were rejected). Do **not** "fix" it by adding a contentSid; it needs CCRS #43 + an SMS-capable sender first.

---

## 6. Wiring reference

### 6.1 novu-bridge / Novu env vars

| Env var | Spring property | Default | Notes |
|---------|-----------------|---------|-------|
| `NOVU_API_KEY` | `novu.api.key` | `test-api-key-123` (app) / `changeme` (compose) | **Must** be the real Novu-env key. Placeholder defaults → 401. |
| `NOVU_BASE_URL` | `novu.base.url` | `http://novu-api:3000` (compose) / `http://novu-api.novu:3000` (app) | Novu REST base. |
| **`NOVU_BRIDGE_CHANNELS_ENABLED`** | `novu.bridge.channels.enabled` | **`SMS,EMAIL`** | **The real delivery gate.** Comma-separated, case-insensitive/trimmed. `WHATSAPP` deliberately absent. |
| `NOVU_BRIDGE_CHANNEL` | `novu.bridge.channel` | `SMS` | **Legacy singular knob, NOT used** by the config-driven path. Don't confuse with the plural. |
| `NOVU_BRIDGE_WORKFLOW_ID_SMS` | `novu.bridge.workflow.id.sms` | `complaints-sms` | Per-channel workflow id. Never defaults across channels; unknown → `NB_UNSUPPORTED_CHANNEL`. |
| `NOVU_BRIDGE_WORKFLOW_ID_WHATSAPP` | `novu.bridge.workflow.id.whatsapp` | `complaints-whatsapp` | |
| `NOVU_BRIDGE_WORKFLOW_ID_EMAIL` | `novu.bridge.workflow.id.email` | `complaints-email` | |
| `NOVU_BRIDGE_IDENTIFY_CACHE_TTL_MS` | `novu.bridge.identify.cache.ttl.ms` | `300000` | Subscriber-identify TTL cache window (identify is idempotent + non-fatal). |
| `NOVU_BRIDGE_PREFERENCE_ENABLED` | `novu.bridge.preference.enabled` | **`false` (compose)** / `true` (app) | Compose default off because upstream `_check` 404s. Turning on without a working user-preferences `_check` → `SKIPPED / NB_PREFERENCE_DENIED` or error. |
| `NOVU_BRIDGE_PREFERENCE_SEARCH_PATH` | — | — | Preference lookup path. |
| `TWILIO_ACCOUNT_SID` | — | — | `<PLACEHOLDER>` (Twilio Console → Account Info). |
| `TWILIO_AUTH_TOKEN` | — | — | `<PLACEHOLDER>`. |
| `TWILIO_WHATSAPP_FROM` | — | `whatsapp:+14155238886` (sandbox) | **Override for production** to a live WABA sender. |
| `TWILIO_FROM` (seed.sh) | — | — | SMS sender in plain E.164. |

**Ansible host_vars:** `enable_novu`, `pgr_notification_config_driven`, `novu_api_key`, `novu_bridge_channels_enabled`, `novu_bridge_channel`, `novu_bridge_image`, `twilio_account_sid`, `twilio_auth_token`, `twilio_whatsapp_from`. The notif seed runs only when `twilio_account_sid` length > 0; key-wiring runs only when `novu_api_key` is non-empty.

**Kafka:** input `complaints.domain.events`, retry `novu-bridge.retry`, DLQ `novu-bridge.dlq`, consumer group `novu-bridge`.

**Novu REST calls made by novu-bridge (all `Authorization: ApiKey <key>`):** `POST /v1/subscribers` (identify), `POST /v1/events/trigger` (trigger), `GET /v1/integrations` (list).

### 6.2 The three MDMS masters

Schema file: `utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json` (edit `src/main/resources`, **not** the `target/classes` build copy).

**`RAINMAKER-PGR.NotificationRouting`** — x-unique `[businessService, action, toState, audience, channel]`; uid `businessService.action.toState.audience.channel`; seed has 24 rows.

| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `businessService` | string | yes | e.g. `PGR` |
| `fromState` | string \| null | no | **Documentation/UI-only** — runtime matches on `action+toState`. Leave blank. |
| `action` | string | yes | `APPLY/ASSIGN/RESOLVE/REJECT/REOPEN/REASSIGN/RATE` |
| `toState` | string | yes | Disambiguator (e.g. `RATE→CLOSEDAFTERRESOLUTION` vs `…AFTERREJECTION`) |
| `audience` | string | yes | Role code; `CITIZEN`=filer; `AUTO_ESCALATE`/`SYSTEM` non-notifiable |
| `channel` | enum `SMS/WHATSAPP/EMAIL` | yes | |
| `assigneeOnly` | boolean | no | true → notify named assignee only |
| `active` | boolean | no | |

```json
{ "businessService":"PGR","fromState":null,"action":"APPLY","toState":"PENDINGFORASSIGNMENT",
  "audience":"CITIZEN","channel":"SMS","assigneeOnly":false,"active":true }
```

**`RAINMAKER-PGR.NotificationTemplate`** — x-unique `[audience, action, toState, channel, locale]`; uid `audience.action.toState.channel.locale`; seed has 42 rows. Replaces legacy `PGR_<ROLE>_<ACTION>_<STATUS>_SMS_MESSAGE` localization keys.

| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `audience` | string | yes | |
| `action` | string | yes | |
| `toState` | string | yes | |
| `channel` | enum `SMS/WHATSAPP/EMAIL` | yes | |
| `locale` | string | yes | e.g. `en_IN`, `hi_IN`, `sw_KE` |
| `subject` | string \| null | no | **EMAIL only**; null for SMS/WhatsApp |
| `body` | string | yes | `{token}` placeholders |
| `placeholders` | string[] | no | declared tokens (`id, complaint_type, citizen_name, emp_name, ulb, status, date, download_link, rating, additional_comments`) |
| `active` | boolean | no | |

```json
{ "audience":"CITIZEN","action":"APPLY","toState":"PENDINGFORASSIGNMENT","channel":"EMAIL",
  "locale":"en_IN","subject":"DIGIT: Complaint {id} ({complaint_type})",
  "body":"Your complaint {id} ({complaint_type}) was registered on {date}.",
  "placeholders":["id","complaint_type","date"],"active":true }
```

**`RAINMAKER-PGR.NotificationProviderTemplate`** — x-unique `[provider, channel, audience, action, toState, locale]`; uid `provider.channel.audience.action.toState.locale`; required `[provider, channel, action, toState, locale, templateId, variables]`; seed has 14 rows (all `provider=twilio`, `channel=WHATSAPP`, `audience=CITIZEN`, `en_IN`+`hi_IN`, `approved`).

| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `provider` | string | yes | e.g. `twilio` |
| `channel` | enum `SMS/WHATSAPP/EMAIL` | yes | |
| `audience` | string | **no** (but IS in x-unique) | can pass required-validation while omitted — still used for uniqueness |
| `action` | string | yes | |
| `toState` | string | yes | |
| `locale` | string | yes | `en_IN`→provider `en`, `hi_IN`→`hi` |
| `templateId` | string | yes | **Twilio Content SID `HX…`** (there is no field named `ContentSid`) |
| `templateName` | string | no | human-readable; registry `nameField` |
| `variables` | string[] | yes | **ORDER-SENSITIVE** positional slots |
| `approvalStatus` | string | no | only `approved` is sendable |
| `active` | boolean | no | |

> Joins: Routing → Template by `(audience, action, toState, channel)` (Routing has **no locale** → one routing row fans out over locale-specific Template rows). ProviderTemplate → Template by `(audience, action, toState, channel, locale)` (per-locale overlay). Seed covers only `twilio`+`WHATSAPP`; SMS/EMAIL have no provider-template rows (they deliver as rendered text without a pre-approved provider template).

### 6.3 Configurator screens — read-only vs editable

Nav group **Notifications** (`app.nav.notifications`), 7 items in order:

| Screen (nav label) | Registry key | Type | Editable? | Backing |
|--------------------|--------------|------|-----------|---------|
| Configure | `notification-configure` | CustomRoute | **Editable** (dedicated UI; writes routing **+** template pair) | MDMS routing + template |
| Notification Routing | `notification-routing` | mdms | **Editable** (CRUD; rich descriptor) | `RAINMAKER-PGR.NotificationRouting` |
| Notification Templates | `notification-template` | mdms | **Editable** (CRUD; rich descriptor) | `RAINMAKER-PGR.NotificationTemplate` |
| Provider Templates (WhatsApp) | `notification-provider-template` | mdms | **Editable** (CRUD; **no** descriptor → default widgets) | `RAINMAKER-PGR.NotificationProviderTemplate` |
| Notification Logs | `notification-log` | custom | **Read-only** (`rowActions="none"`, tenant-scoped) | `GET /novu-bridge/novu-adapter/v1/logs` |
| Notification Providers | `notification-provider` | custom | **Read-only** (allowlist projection; no `credentials` key emitted at all) | `GET /novu-bridge/novu-adapter/v1/integrations` |
| User Preferences | `notification-preference` | custom | **Read-only** | `GET /novu-bridge/novu-adapter/v1/preferences` |

Notes: the ContentSid mapping screen is **editable** despite its name (generic MDMS master). The SPA is keyless — it never holds the Novu ApiKey; novu-bridge calls Novu server-side and its allowlist projection omits the `credentials` object entirely. The Providers screen fetches the whole integration list and paginates client-side.

---

## 7. Localization

### 7.1 Locale resolution order (per recipient, authoritative)
1. **User's consented language** — `preferredLanguage` on the `USER_NOTIFICATION_PREFERENCES` record in `digit-user-preferences-service` (validated against `{en_IN, hi_IN, fr_IN, pt_IN}`), read via `PreferenceServiceClient` (same record/service used for per-channel consent — no new store).
2. else **deployment default** — `pgr.notification.default.locale` (instance/deployment default, not tenant-scoped; default `en_IN`).
3. else hard fallback **`"en"`**.

One language per recipient. A role pool with mixed locales renders **per-member grouped by resolved locale**, never once for the whole pool.

### 7.2 How an approved/localized template is chosen (by channel)
- **WHATSAPP (strict, approval-gated):** `approved(provider, routingKey K, locale L)` → use its Twilio ContentSid + ordered vars; else `approved(provider, K, defaultLocale)`; else **SKIP** (fail-safe) — **never** free-form WhatsApp, never fall back to another channel. (This approval-aware selection is the forward design; it is not yet implemented — see §7.3.)
- **SMS / EMAIL (content-only, no approval concept):** localized body/subject in `L` (via egov-localization) → default-locale body/subject → free-form always allowed. Do **not** apply WhatsApp approval logic here.
- Provider language codes are the **short** form (`en`/`hi`); the ProviderTemplate `locale` field maps `en_IN`↔`en`. Mismatch → selection won't line up.

### 7.3 Reality check (interim behavior)
The full locale+approval-aware layer is **not implemented today**. The emitter renders **once in `pgr.notification.default.locale` for everyone** (the "W2.9 single-locale" limitation); it does not yet read per-recipient consented locale, and EMAIL stays `en` for now. The template `locale` dimension is effectively dead for per-recipient localization until (1) egov-localization-backed body/subject resolution and (2) the fallback chain in `TemplateRenderer`/emitter are built. Also: `en_IN` is **hardcoded** in the configurator checker/Configure tab while the backend default locale is a config property — flipping the deployment default can produce false checker (R2) errors and edits that miss the locale the runtime actually reads.

---

## 8. Verifying delivery

Three sources of truth, in order of increasing authority:

| Source | What it tells you | How to read |
|--------|-------------------|-------------|
| **`nb_dispatch_log`** (bridge audit) | Whether the bridge accepted/gated/triggered. Statuses `SENT / FAILED / SKIPPED / RECEIVED`, keyed by `transactionId`; carries `channel`, `status`, `lastErrorCode`, `lastErrorMessage`, `providerResponse`. | Query the bridge DB; or via configurator **Notification Logs** (read-only, tenant-scoped, `GET /novu-adapter/v1/logs`). |
| **Novu `db.messages` / `db.executiondetails`** (in `novu-mongo`) | Whether Novu handed off to the provider and the provider result. | Inspect novu-mongo. |
| **Provider console** (Twilio) | Real delivery: `delivered` / `read` (or `failed` + Twilio error code). | Twilio console. |

> **`SENT` ≠ delivered.** `SENT` only means Novu **accepted the trigger**. A green `nb_dispatch_log` row can still be an undelivered/failed message — confirm with Novu execution details and the Twilio console. `RECEIVED` is written on validation-only runs (`send=false`).

**What `SKIPPED` / the error codes mean** (`SKIPPED` is reused for four distinct `lastErrorCode`s — only `lastErrorCode` distinguishes why):

| `lastErrorCode` | Meaning |
|-----------------|---------|
| `NB_NO_PROVIDER` | **Known** channel that is **not** in `NOVU_BRIDGE_CHANNELS_ENABLED` — the WhatsApp pre-onboarding case. Honestly skipped, **never** re-routed to another channel, and Novu is not touched at all. |
| `NB_UNSUPPORTED_CHANNEL` | Channel not in `KNOWN_CHANNELS {SMS,WHATSAPP,EMAIL}` (e.g. a typo/`PIGEON`). Never reaches Novu; "never guess, never fall back to SMS". |
| `NB_CONTACT_MISSING` | EMAIL row with no email, or SMS/WhatsApp row with no phone. Bridge-side defense against phantom-SENT. |
| `NB_PREFERENCE_DENIED` | Preference gate denied the channel (only when `NOVU_BRIDGE_PREFERENCE_ENABLED=true`). |

`FAILED` codes: `NB_NOVU_TRIGGER_FAILED` (Novu returned non-2xx, e.g. missing workflow or 401), `NB_DELIVERY_ERROR` (other exception), plus `CustomException` codes (which DLQ the message).

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Every WhatsApp event is `SKIPPED / NB_NO_PROVIDER` | `WHATSAPP` not in `NOVU_BRIDGE_CHANNELS_ENABLED` (default `SMS,EMAIL`) — **and** there is no Novu WhatsApp integration on this branch | Onboard a real WhatsApp integration as a Novu integration + create `complaints-whatsapp` workflow, **then** add `WHATSAPP` to the enabled list. Env alone will only turn SKIP into a downstream failure. |
| WhatsApp send returns **error 63015** | Recipient hasn't joined the Twilio **sandbox** `whatsapp:+14155238886` (opens only a 24h window) | Move off the sandbox — set `TWILIO_WHATSAPP_FROM` to a live approved WABA sender. Sandbox is a dead end for real onboarding. |
| WhatsApp send returns **error 63016** | Message sent outside the 24h window **without** an approved Content template | Use an approved `HX…` ContentSid + positional `contentVariables`. (63016 ≠ 63015.) |
| WhatsApp works for citizens, silent for officers | Only **CITIZEN** Twilio templates are approved | Create + get Meta approval for GRO/PGR_LME/EMPLOYEE templates (~2 days). Until then officers get SMS+Email; legs SKIP. |
| Any channel: `FAILED / NB_NOVU_TRIGGER_FAILED` | The per-channel Novu workflow was never created (e.g. only `complaints-sms` exists), or **401** from Novu | Verify the workflow id exists in Novu; verify `NOVU_API_KEY` is the real env key and header is `Authorization: ApiKey <key>` (not `Bearer`). |
| All triggers 401 | `NOVU_API_KEY` still `test-api-key-123`/`changeme`, or empty `novu_api_key` in host_vars (bootstrap + key-wiring skipped) | Set the real Novu **Dev**-env key; redeploy so novu-bridge is force-recreated with it. |
| Email trigger `SENT` in `nb_dispatch_log`, but no email arrives | No nodemailer/SMTP integration in Novu (repo ships none) | Create the email-channel integration manually in the Novu dashboard. |
| Email event `SKIPPED / NB_CONTACT_MISSING` | Recipient has no email (contact gate) | Ensure the recipient carries an email; note `subject` is EMAIL-only (null for SMS/WhatsApp). |
| Channel `SKIPPED / NB_UNSUPPORTED_CHANNEL` | Channel value not in `{SMS,WHATSAPP,EMAIL}` (typo/bad enum) | Fix the `channel` value in the routing/template row. |
| Events `SKIPPED / NB_PREFERENCE_DENIED` or preference errors | `NOVU_BRIDGE_PREFERENCE_ENABLED=true` but no working user-preferences `_check` (upstream 404s) | Leave it `false` unless `digit-user-preferences-service` `_check` is deployed. |
| Every complaint fails `CONFIG_NOT_RESOLVED` (config-service runtime path) | Seeded the city tenant but PGR events carry the **root** tenant (`ke`); config-service does **no** hierarchical fallback | Seed the exact tenant the PGR event carries (check pgr-services logs). |
| Seeder corrections don't take; WARNING about create-only | Kong routes only config-service `_create`/`_resolve`, not `_search`/`_update` | Run `seed.sh` **in-cluster** against `CONFIG_SERVICE_URL` (`http://digit-config-service:8080`). |
| WhatsApp content shows wrong values in slots | `variables[]` order drifted from the template's `{{n}}` positions | Re-verify with `GET content.twilio.com/v1/Content/<SID>` and realign; have an operator confirm order. Never swap a SID without re-checking. |
| `serviceName` shows a raw code in slot `{{1}}` (not a label) | Producer emits the PGR serviceCode, not the localized display label | Known content nuance — needs a localization lookup in the producer (not a wiring bug). |
| Fresh tenant silently on sandbox | `twilio_whatsapp_from` left at the example/Ansible default `whatsapp:+14155238886` | Set a live WABA sender in host_vars before deploy. |
| Provider Templates screen edits don't apply as expected / no field help | `notification-provider-template` has **no** schema descriptor → default widgets, and the runtime path may read `TemplateBinding` (config-service), not the MDMS master | Know which wiring is live; use the correct store. Don't conflate the MDMS master (forward design) with `TemplateBinding`/`ProviderDetail` (deployed). |

> **Secrets reminder:** `host_vars` contains a **real** Twilio account SID/auth token and the resume docs reference a real Novu API key. Never echo, commit, or paste these — refer to them only as `<TWILIO_ACCOUNT_SID>` / `<TWILIO_AUTH_TOKEN>` / `<NOVU_API_KEY>`.

---

## Appendix: verify-pass corrections (code-grounded)

Verification complete. The corrections below have been **folded into the body** above; one minor note remains open.

**FOLDED IN** (no longer present in the body):
- Removed the invented error code `NB_TEMPLATE_NOT_APPROVED` from §7.2 and §8 — the pipeline only ever writes the four SKIPPED `lastErrorCode`s `NB_PREFERENCE_DENIED`, `NB_UNSUPPORTED_CHANNEL`, `NB_NO_PROVIDER`, `NB_CONTACT_MISSING` (`backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java`).
- Corrected the config property to `pgr.notification.default.locale` (default `en_IN`) in §7.1/§7.3, and noted it is an instance/deployment default rather than tenant-scoped (`backend/pgr-services/src/main/resources/application.properties:102`, `PGRConfiguration.java:253`, `NotificationService.java:861`).
- Fixed the credential-projection wording in §3.5/§6.3: the read-only integrations projection is a pure allowlist (`_id, providerId, channel, name, identifier, active, primary, environmentId`) and never copies `credentials` at all — no key names, no `***` placeholders (`IntegrationController.java`, `IntegrationProjection.java`).

Note on the §3.2 bootstrap-workflow claim: re-verification against `backend/novu-bridge/config/bootstrap-novu-whatsapp.sh` shows the script **does** create `complaints-sms` (and `complaints-email`) channel workflows (see `NOVU_SMS_WORKFLOW_ID`/`ensure_channel_workflow` near lines 75-76, 358-359), in addition to `complaints-whatsapp-v1`. The §3.2 body is therefore accurate and was left unchanged; the earlier appendix note flagging it was stale.

**STILL OPEN**

- **Minor — env var `NOVU_BRIDGE_PREFERENCE_SEARCH_PATH` is not wired** (§6.1 table): there is no `${NOVU_BRIDGE_PREFERENCE_SEARCH_PATH:...}` binding in `application.properties`; only the Spring property `novu.bridge.preference.search.path` (default `/user-preference/v1/_search`) exists, defined solely in `NovuBridgeConfiguration.java:55`. The table already leaves its Spring-property/default cells as "—", so the impact is small, but that env name does not override anything.

**Everything else verified accurate**, including: `NOVU_BRIDGE_CHANNELS_ENABLED` default `SMS,EMAIL` (`application.properties:52`); compose defaults `NOVU_API_KEY=changeme`, `NOVU_BASE_URL=http://novu-api:3000`, `NOVU_BRIDGE_PREFERENCE_ENABLED=false` (`local-setup/docker-compose.egov-digit.yaml:2209,2208,2159`); app defaults `test-api-key-123` / `http://novu-api.novu:3000` / preference `true` (`application.properties:58,57,26); `KNOWN_CHANNELS={SMS,WHATSAPP,EMAIL}` and gate order (`DispatchPipelineService.java:35`); workflow-id envs and `NB_UNSUPPORTED_CHANNEL` throw (`NovuBridgeConfiguration.java:99-141`); Kafka topics `complaints.domain.events` / `novu-bridge.retry` / `novu-bridge.dlq` + group `novu-bridge` (`application.properties:12,18-20`); Novu REST paths `/v1/subscribers`, `/v1/events/trigger` (`NovuClient.java:128,184`); all dispatch/log/integration/preference endpoint paths under `/novu-bridge/novu-adapter/v1/...`; the three MDMS schemas, their x-unique/uid/required fields, and `templateId` (no `ContentSid` field) (`utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json`); seed row counts 24/42/14 (`.../mdmsData-dev/RAINMAKER-PGR/*.json`); all 14 EN/HI ContentSids + ordered variables + tenant `ke` (`local-setup/scripts/seed-provider-templates.py`); TemplateBinding/ProviderDetail via config-service `_create`, `CONFIG_SERVICE_URL=http://digit-config-service:8080`, Kong not routing `_search`/`_update` (`local-setup/db/notif-mdms-seed/seed.sh`); `COMPLAINTS.WORKFLOW.*` → HX SIDs and `OTP.SEND` channel `sms` with no contentSid (`.../data/template-bindings.json`); configurator nav `app.nav.notifications` with the 7 registry keys in order (`configurator/src/admin/DigitLayout.tsx:48-56`); `preferredLanguage` validated against `{en_IN,hi_IN,fr_IN,pt_IN}` (`backend/digit-user-preferences-service/internal/validation/preference_validation.go:118`); container names (`_example.yml:263-264`).

**Secret/leak scan: clean.** The runbook uses placeholders throughout. No real account SID/token/API key, no `10.0.0.x` IP, and no ssh alias (e.g. `egov-nairobi`) leaked into it. The `whatsapp:+14155238886` sandbox number, the `HX…` ContentSids, and the `test-api-key-123`/`changeme` defaults are all public/non-secret values already present in the repo.