# 3. Channels & providers

## 3.1 The channel gate

Three channels exist end-to-end: **SMS**, **EMAIL**, **WHATSAPP**
(`PGRConstants.java:161-163`, and the MDMS `channel` enum). Whether a channel actually
**delivers** is a novu-bridge deployment policy, independent of MDMS routing:

`novu.bridge.channels.enabled` (`NovuBridgeConfiguration.java:110-121`) — default
`SMS,EMAIL`. **Live bomet runs exactly this** (`NOVU_BRIDGE_CHANNELS_ENABLED=SMS,EMAIL`).
A channel that is routed + templated in MDMS but not in this list is persisted as
`SKIPPED / NB_NO_PROVIDER` (`DispatchPipelineService.java:116-125`) — an honest record,
never a silent downgrade to another channel.

Each enabled channel maps to a **fixed Novu workflow id**
(`NovuBridgeConfiguration.getNovuWorkflowId :129-140`):

| Channel | Workflow property | Default id | Novu step type |
|---------|-------------------|-----------|----------------|
| SMS | `novu.bridge.workflow.id.sms` | `complaints-sms` | `sms` |
| EMAIL | `novu.bridge.workflow.id.email` | `complaints-email` | `email` |
| WHATSAPP | `novu.bridge.workflow.id.whatsapp` | `complaints-whatsapp` | (rides Twilio `sms`) |

Each workflow is a thin "delivery shell": its single step emits `payload.body` (and
`payload.subject` for email). PGR already rendered the text; Novu just carries it to the
provider.

*Verified live* (`GET /providers/templates` at `ke`): Novu has `complaints-sms` (sms),
`complaints-email` (email), and a `test-email-render` (email). There is **no**
`complaints-whatsapp` workflow — consistent with WHATSAPP being disabled.

## 3.2 Providers on bomet

`GET /integrations` (`IntegrationController.java:50-63`) lists the Novu integrations as
an allowlist projection. *Verified live* at `ke`:

| providerId | Novu channel | identifier | active |
|------------|--------------|-----------|--------|
| `twilio` | `sms` | `twilio-sms-5SPX31qOy` | ✓ (primary) |
| `twilio` | `sms` | `twilio-sms-2RbZJo7Xo` | ✓ |
| `nodemailer` | `email` | `gmail-smtp-LzTrshabn` | ✓ |
| `novu` | `in_app` | `novu-inbox-*` (×2) | ✓ |

So live delivery is: **Twilio** for SMS (primary Twilio SMS integration), **Gmail SMTP
via nodemailer** for email. There is **no WhatsApp integration** — the reason live
WHATSAPP events land as `NB_NO_PROVIDER`.

### Secrets never leave the service

Novu is the credential store. novu-bridge holds only the Novu ApiKey and applies it
server-side (`NovuClient` sets `Authorization: ApiKey …` on every call, e.g. `:118`).
The SPA is **keyless**. Every response that touches Novu data is built by the
`IntegrationProjection` **allowlist** — only `_id`, `providerId`, `channel`, `name`,
`identifier`, `active`, `primary`, `environmentId` are copied; **no `credentials` key,
masked or otherwise, ever leaves** (`IntegrationController.java:23-30`,
`ProviderController.java:40-51`). Operator-entered credentials POST straight through to
Novu over TLS and live only there; only credential *key names* (never values) are logged
(`NovuClient.createIntegration :295-331`).

## 3.3 Provider self-service (the Notification Providers screen)

`configurator/src/resources/notification-providers/` (`providerApi.ts`,
`NotificationProviderList.tsx`) drives four provider operations. All hit
`/novu-bridge/novu-adapter/v1/providers*` same-origin with the DIGIT bearer token
(`providerApi.ts:11-13, 70-74`).

### Add — `POST /providers` (`ProviderController.createProvider :83-112`)

Body: `{name, identifier?, providerId, channel, credentials}`. Maps the DIGIT channel to
a Novu channel via `toNovuChannel` (`:314-327`): **SMS and WHATSAPP → Novu `sms`**;
EMAIL → Novu `email`. Calls `NovuClient.createIntegration` and returns the created
integration via the allowlist projection.

**WhatsApp identifier marker (recent fix).** Because WHATSAPP is stored as a Novu `sms`
integration, the "WHATSAPP" designation would be lost on every subsequent list. To
preserve it, when the operator adds a WhatsApp provider without an explicit identifier,
the controller stamps a deterministic `whatsapp-<sha>` identifier
(`stableId` of the name, no clock/random) (`:99-103`). The SPA reads that marker back to
re-derive WHATSAPP for display (`providerApi.rowChannel :181-189`) — so WhatsApp rows no
longer collapse into plain SMS rows on refetch.

### Pull Templates — `GET /providers/templates` (`ProviderController.templates :127-152`)

Read-only discovery of Novu **workflows** (delivery shells) — it does NOT call Twilio
(Twilio has no SMS template registry; SMS/EMAIL text lives in MDMS
`NotificationTemplate`, approved WhatsApp Content SIDs in `NotificationProviderTemplate`).
Returns `{workflowId, name, channels[]}` per workflow. **Recent fixes**:

- `channel` now **filters** by the workflow's Novu step types (`stepTypeOverviews`):
  SMS/WHATSAPP → workflows with an `sms` step, EMAIL → `email` (`:133-146`). A response
  without step metadata degrades to the unfiltered list (`:137-139`).
- Each row now returns a `channels[]` array (the workflow's step types) (`:145`).
- In the SPA the dialog is titled **"Novu Workflows"** and fetches on open
  (`NotificationProviderList.tsx`, `providerApi.pullTemplates :107-118`).

### Verify — `POST /providers/verify` (`ProviderController.verify :201-239`)

Body: `{integrationId}` OR `{channel, providerId}`. Matches the integration in
`GET /v1/integrations` (by Novu `_id`/`identifier`, or channel+providerId) and returns
`{ok, active, detail}` — a connectivity/active check without sending anything.

### Test-Send — `POST /providers/test-send` (`ProviderController.testSend :252-309`)

Sends one **live** test through Novu and writes a `TEST`-tagged `nb_dispatch_log` row
with a **masked** recipient (`writeTestLog :381-404`, `event_name`/`template_key` =
`"TEST"`, `tenantId="TEST"`), keeping tests auditable and separable from real traffic.

- **SMS/EMAIL**: trigger the per-channel workflow with a `{body, subject}` payload. For
  EMAIL the `to.email` is passed explicitly (the synthetic `nb-test-*` subscriber has no
  stored email, so without it the email step has no address) (`:290-298`).
- **WHATSAPP**: rides the Twilio `sms` integration — `to.phone = "whatsapp:+<E164>"`
  plus `overrides.providers.twilio` carrying the approved **Content SID** +
  `contentVariables`, built by `TwilioProviderStrategy` via `buildWhatsappOverrides`
  (`:284-289, 348-366`). No credentials/sender are set in the override — those live in
  the Novu integration.
- `subscriberId` is a stable `nb-test-<sha>` of the seed (no clock/random) so a repeated
  test is reproducible/idempotent (`:268-273`).

## 3.4 WhatsApp-via-Twilio, precisely

WhatsApp is **not a separate Novu channel** in this stack. It is the **Twilio SMS Novu
integration** used with a `whatsapp:`-prefixed sender and a pre-approved Twilio Content
Template:

- Channel mapping collapses WHATSAPP → Novu `sms` (`ProviderController.toNovuChannel :318-321`).
- Phone formatting adds the `whatsapp:` prefix for the Twilio Programmable WhatsApp API;
  SMS takes raw E.164 (`DispatchPipelineService.formatRecipientPhone :227-258`).
- The Content SID + positional variables come from
  `RAINMAKER-PGR.NotificationProviderTemplate` (the operator copies an `HX…` id and its
  ordered variables into the test-send request) and are injected as Twilio `overrides`.

Today this path is exercised **only via the configurator test-send** — there is no
production WhatsApp workflow/integration wired on bomet, so citizen-facing WHATSAPP
events skip with `NB_NO_PROVIDER`. Enabling it later means: add a WhatsApp-capable Twilio
integration in Novu, add `WHATSAPP` to `novu.bridge.channels.enabled`, and wire a
`complaints-whatsapp` workflow.

## 3.5 Preferences & consent (gated OFF at runtime)

Per-user channel consent is a real, populated data layer — but the **runtime gate is
disabled** on bomet.

### The gate

`DispatchPipelineService` calls `PreferenceServiceClient.isChannelAllowed` before
delivery (`:80-92`). That method (`PreferenceServiceClient.java:30-106`):

- If `novu.bridge.preference.enabled` is **false**, returns `true` immediately —
  "allow by default" (`:35-38`). **This is the live bomet state**
  (`NOVU_BRIDGE_PREFERENCE_ENABLED=false`), so consent is **not enforced** today.
- When enabled: a blank `userId` is denied (`:39-42`); otherwise it POSTs to the
  preference service (`preferenceCode` = `USER_NOTIFICATION_PREFERENCES`), reads
  `payload.consent[<CHANNEL>]`, and allows only when `status == GRANTED` (`:82-96`). The
  `TENANT`-scope check is currently commented out (`:97-99`), so any GRANTED consent
  passes regardless of scope.

### The read surface

`GET /preferences` (`PreferenceController.java:58-101`) lists consent records via an
**allowlist** projection: only `userId`, `tenantId`, `preferredLanguage`, and the
`consent` map are copied — no PII, nothing else (`:40-44, 83-101`). The underlying search
is `PreferenceServiceClient.listPreferences :116-153`.

*Verified live* at `ke`: **1** preference record —
`{userId:…, tenantId:ke, preferredLanguage:hi_IN, consent:{SMS:{scope:GLOBAL,status:GRANTED},
EMAIL:{…GRANTED}, WHATSAPP:{…GRANTED}}}`. So the consent shape exists and is queryable,
but because the runtime gate is off, it does not currently affect delivery. Document
consent to operators as "captured, not yet enforced."

> Note: `preferredLanguage: hi_IN` on this record has **no delivery effect today** —
> PGR renders every recipient in the single default locale (see
> [`04-localization.md`](04-localization.md)).
