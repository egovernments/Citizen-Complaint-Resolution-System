# Design: Self-service provider management in the Configurator (Novu-native)

**Date:** 2026-07-06 · **Branch:** `feat/pgr-notifications-configure` (fork → PR #58)

Make the configurator's **Notification Providers** screen self-service: **add a provider**
(creds entered in the UI), **pull available templates** (read-only discovery), **verify
connectivity**, and **send a live test message** — for SMS, Email, and WhatsApp.

> **Revision 2 (Novu-native).** An earlier draft proposed a custom `nb_provider_config`
> table + AES-GCM credential encryption + a bespoke `TwilioClient`. **Dropped.** Novu is
> already the provider/credential store, and novu-bridge already carries the dormant
> provider-strategy code (`TwilioProviderStrategy`, `WhatsAppBusinessApiProviderStrategy`,
> factory) plus `NovuClient.trigger(...overrides...)` that forwards Twilio ContentSid
> overrides to Novu. So **every capability maps to an existing Novu API** — no new table,
> no crypto, no direct-Twilio client. Credentials live only in Novu.

## 1. Per-channel mapping to Novu

| Channel | Novu integration | Delivery |
|---|---|---|
| **SMS** | `providerId:"twilio", channel:"sms"` | Novu workflow `complaints-sms` → Twilio SMS |
| **EMAIL** | `providerId:"nodemailer", channel:"email"` (or SendGrid/Mailgun) | Novu workflow `complaints-email` → SMTP |
| **WhatsApp** | **same Twilio `channel:"sms"` integration**, `credentials.from = "whatsapp:+<E164>"` | Novu trigger with `to.phone="whatsapp:+…"` + `overrides.providers.twilio = {contentSid, contentVariables}` for approved templates |

WhatsApp is NOT a separate Novu channel here — it's the Twilio SMS integration used with a
`whatsapp:` sender, and approved templates ride Novu **provider-overrides** (the existing
strategy code builds them).

## 2. novu-bridge endpoints (under `/novu-adapter/v1`, behind `ProxyAuthFilter`)

All four MUST be added to `ProxyAuthFilter.shouldNotFilter`'s allowlist (the trap that hit
`/preferences`) and get Kong routes under `novu-bridge-proxy`.

| Method · Path | Body / Query | Implementation |
|---|---|---|
| `POST /providers` | `{channel, providerId, name, identifier?, credentials{…}}` | Map channel→Novu (`WHATSAPP`→`channel:sms`); `NovuClient.createIntegration` → `POST /v1/integrations`. Return the created integration via the **existing allowlist projection** (no `credentials`). |
| `GET /providers/templates` | `?channel=&providerId=` | `NovuClient.listWorkflows` → `GET /v2/workflows` (delivery shells: workflowId, name). Read-only discovery. WhatsApp ContentSids are shown by the existing Provider Templates (MDMS) screen — this endpoint does not call Twilio. |
| `POST /providers/verify` | `{integrationId}` or `{channel, providerId}` | `GET /v1/integrations`, match, return `{ok, active, detail}`. |
| `POST /providers/test-send` | `{channel, to{phone?,email?}, workflowId?, body?, subject?, contentSid?, variables?[]}` | SMS/EMAIL → `NovuClient.trigger(workflowId or complaints-{sms,email}, subscriberId="nb-test-<uuid>", payload{body,subject})`. WHATSAPP → same, `to.phone="whatsapp:+…"` + `overrides` from a provider strategy (`{providers:{twilio:{contentSid, contentVariables}}}`). Returns `{ok, novuStatus, transactionId}`. Writes a `nb_dispatch_log` row tagged `TEST`. |

Response envelopes mirror `/integrations` — **no secret ever leaves** (no `credentials`,
no token). Creds POST through over TLS to Novu; never logged (reuse `PiiMask`), never returned.

## 3. Clients (novu-bridge — extend `NovuClient` only)

- `createIntegration(name, identifier, providerId, channel, credentials)` → `POST /v1/integrations`
  (payload per `bootstrap-novu-whatsapp.sh`: `{name, identifier, providerId, channel, active:true, check:false, credentials{…}}`).
- `listWorkflows()` → `GET /v2/workflows?limit=100&page=0`.
- `listIntegrations()` / `getIntegration(id)` → `GET /v1/integrations` (reuse whatever
  `IntegrationController` already calls; add a match helper for verify).
- Reuse `NovuClient.trigger(templateKey, subscriberId, phone, payload, txnId, overrides, apiKey)`
  and `NovuProviderStrategyFactory` for the WhatsApp test-send overrides. **No new client.**

## 4. Configurator — Notification Providers screen

- **Add Provider** dialog: channel select → providerId → per-provider credential fields
  (Twilio: accountSid/token/from; SMTP: host/user/pass/from) → `POST /providers`. On success,
  the list (existing `/integrations` view) refreshes.
- Per-provider row actions:
  - **Verify** → `POST /providers/verify` → green/red badge + detail.
  - **Test delivery** → dialog (recipient + optional workflow/body, or contentSid+variables
    for WhatsApp) → `POST /providers/test-send` → shows Novu status + txn id + a link to the
    Logs screen.
  - **Pull templates** → `GET /providers/templates` → modal listing Novu workflows (+ a
    pointer to the Provider Templates screen for WhatsApp ContentSids). Read-only; copy id.

## 5. Security / guardrails

- Auth: existing EMPLOYEE+role gate on every new path (add to `shouldNotFilter`).
- Creds: entered in the UI, POST straight to Novu through novu-bridge; **never** persisted in
  novu-bridge, never logged, never echoed back.
- Test-send: recipient is operator-entered, behind the auth gate; each is logged to
  `nb_dispatch_log` tagged `TEST` (who, channel, masked recipient) — auditable + separable.
- Kong: add GET/POST routes for the new paths under `novu-bridge-proxy`.

## 6. Build order

1. **Backend** — extend `NovuClient` (createIntegration/listWorkflows/verify) + `ProviderController`
   (4 endpoints) + `ProxyAuthFilter` allowlist + Kong routes + tests. `mvn compile` + tests green.
2. **Configurator** — Add-Provider dialog + per-row Verify/Test/Pull actions. `tsc`/build green.
3. **Deploy + test on Bomet** — build novu-bridge amd64, surgical recreate, exercise all four
   for SMS/Email/WhatsApp (owner-authorized test recipients only).

No migration, no crypto, no Twilio client — this reuses Novu + the dormant strategy code.
