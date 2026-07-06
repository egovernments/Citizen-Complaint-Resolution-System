# Design: Self-service provider management in the Configurator

**Date:** 2026-07-06 · **Branch:** `feat/pgr-notifications-configure` (fork → PR #58)

Make the configurator's **Notification Providers** screen a self-service surface: add a
provider (creds entered in the UI, stored server-side), pull the provider's available
templates (read-only, to show what's available), verify connectivity, and send a live
test message. Templates themselves stay **user-authored** (the existing Provider Templates /
Notification Templates screens); this feature is about *providers* + *testing delivery*.

Confirmed decisions (owner, 2026-07-06):
- **Creds entered in the UI → stored server-side** (transit through novu-bridge, never
  persisted in the keyless SPA).
- **All 3 channels + live test-send** in v1 (SMS, Email, WhatsApp).

## 1. Per-channel reality (this is NOT uniform)

| Channel | "Provider" is… | Add = | Templates = | Test-send = |
|---|---|---|---|---|
| **SMS** | a **Novu integration** (`twilio`) | create Novu integration w/ creds | Novu workflows (`complaints-sms`) | Novu `events/trigger` |
| **Email** | a **Novu integration** (`nodemailer`/SMTP) | create Novu integration w/ creds | Novu workflows (`complaints-email`) | Novu `events/trigger` |
| **WhatsApp** | **Twilio-direct** (NOT in Novu) | store Twilio WABA creds+sender in novu-bridge | **Twilio Content API** `ContentAndApprovals` (ContentSids + vars) | Twilio ContentSid send |

So SMS/Email creds live in **Novu**; WhatsApp/Twilio creds live in a **new novu-bridge table**
(novu-bridge has no Twilio creds today). That table is also what the WhatsApp pull-templates,
verify, and test-send read from.

## 2. Storage: `nb_provider_config` (new Flyway migration)

```
nb_provider_config
  id             uuid pk
  tenant_id      text
  channel        text        -- SMS | EMAIL | WHATSAPP
  provider       text        -- twilio | nodemailer | ...
  sender         text        -- e.g. whatsapp:+<E164> (WhatsApp) / from-number
  credentials    text        -- ENCRYPTED blob (see §3); JSON of provider-specific creds
  novu_integration_id text   -- for SMS/EMAIL: the Novu integration _id (creds live in Novu)
  active         boolean
  created_by / created_time / last_modified_*  (audit)
  unique (tenant_id, channel, provider)
```

- **SMS/EMAIL** rows: `credentials` empty, `novu_integration_id` set (Novu holds the secret).
- **WHATSAPP** rows: `credentials` = encrypted `{accountSid, authToken}`, `sender` = WABA number.

## 3. Credential handling + encryption

- Creds POST through novu-bridge over TLS; **never** stored in the SPA or a log
  (reuse `PiiMask`; never log `authToken`/`password`).
- SMS/EMAIL → forwarded to **Novu** create-integration; Novu stores them. novu-bridge keeps
  only the returned `integrationId`.
- WHATSAPP → the `{accountSid, authToken}` are **encrypted at rest** in `credentials` using an
  app-level symmetric key `novu.bridge.cred.enc.key` (env `NOVU_BRIDGE_CRED_ENC_KEY`,
  AES-GCM). If the key is unset, provider-add for WhatsApp is **refused** (fail closed) rather
  than storing plaintext. (Future: delegate to egov-enc-service — out of scope for v1.)
- All new endpoints sit under `/novu-adapter/v1/*` and are gated by the existing
  **ProxyAuthFilter** (EMPLOYEE + allowed role). The write/send endpoints MUST be added to
  `shouldNotFilter`'s allowlist (same trap that hit `/preferences`).

## 4. Endpoints (novu-bridge, behind auth)

| Method | Path | Body / Query | Does |
|---|---|---|---|
| `POST` | `/providers` | `{channel, provider, sender?, credentials{…}}` | SMS/EMAIL → Novu create-integration; WHATSAPP → encrypt+persist row. Returns the created provider (no secrets). |
| `GET` | `/providers/templates` | `?channel=&provider=` | WHATSAPP/twilio → Twilio `ContentAndApprovals` (ContentSid, name, language, status, variables). SMS/EMAIL → Novu workflows. **Read-only listing** — user maps them manually. |
| `POST` | `/providers/verify` | `{channel, provider}` or `{id}` | Ping: Novu integration active / Twilio `Accounts/{sid}.json` fetch. Returns `{ok, detail}`. |
| `POST` | `/providers/test-send` | `{channel, provider, to, templateId?, variables?, body?}` | SMS/EMAIL → Novu trigger to `to`. WHATSAPP → Twilio ContentSid send to `to`. Returns provider status + message id. |

Response envelopes mirror the existing `/integrations` allowlist style — **no secret ever
leaves** (no `authToken`, masked `credentials`).

## 5. Clients

- **NovuClient** (extend): `createIntegration(channel, provider, creds)`, `listWorkflows()`,
  `verifyIntegration(id)`.
- **TwilioClient** (new): `listContentTemplates()` (`GET content.twilio.com/v1/ContentAndApprovals`),
  `verifyAccount()` (`GET api.twilio.com/2010-04-01/Accounts/{sid}.json`),
  `sendContent(to, contentSid, vars)` / `sendSms(to, body)`. Creds read from `nb_provider_config`
  (decrypted per call), never from a static env.

## 6. Configurator (Notification Providers screen)

- **Add Provider** dialog: channel select → provider → credential fields (per provider) →
  `POST /providers`. On success, list refreshes.
- Per-provider row actions:
  - **Pull templates** → `GET /providers/templates` → modal listing available templates
    (ContentSid / workflow, variables, approval status). Read-only; a "copy" affordance so
    the operator can paste the id into the Provider Templates mapping they author.
  - **Verify** → `POST /providers/verify` → green/red badge + detail.
  - **Test delivery** → dialog (recipient + optional template/variables or body) →
    `POST /providers/test-send` → shows provider status + message id + a link to the Logs screen.

## 7. Security / guardrails

- Auth: existing EMPLOYEE+role gate on every new path (add to `shouldNotFilter`).
- Test-send: recipient is operator-entered; the action is behind the auth gate. Log every
  test-send (who, channel, masked recipient) to `nb_dispatch_log` with a `TEST` marker so it's
  auditable and distinguishable from real traffic.
- Creds: fail-closed if the encryption key is unset; never logged; never returned.
- Kong: add routes for the new GET/POST paths under `novu-bridge-proxy`.

## 8. Build phases

1. **Backend foundation** — migration (`nb_provider_config`) + entity/repo + `CredCrypto` (AES-GCM) + config keys.
2. **Clients** — `TwilioClient` (new) + `NovuClient` additions.
3. **ProviderController** — the 4 endpoints + allowlist in `ProxyAuthFilter` + Kong routes + tests.
4. **Configurator** — Add Provider dialog + per-row Pull/Verify/Test actions.
5. **Deploy + test on Bomet** — build amd64, surgical recreate, exercise all 4 for each channel.

Test-send + verify are proven against the live Twilio/Novu on Bomet (owner-authorized test
recipients only). The runbook/tutorial (with screenshots) is written **after** the screens exist.
