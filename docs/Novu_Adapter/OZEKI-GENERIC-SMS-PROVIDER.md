# Ozeki SMS Gateway via Novu `generic-sms` — Design

**Status**: bridge implementation included in this PR (`OzekiOverridesBuilder` + `NovuClient` SMS-leg wiring + `NOVU_BRIDGE_SMS_PROVIDER` / `NOVU_BRIDGE_OZEKI_INTEGRATION_IDENTIFIER` knobs, default off). The R1 empirical gate (§4) against a live Ozeki gateway is still outstanding — do not enable in a deployment before running it. Mechanics verified 2026-07-17 against Novu v2.3.0 source (the self-hosted tag we deploy).
**Goal**: send SMS through a customer-hosted [Ozeki SMS Gateway](https://ozeki-sms-gateway.com/p_5667-http-sms-api.html) (HTTP REST, common in on-prem installs) from the DIGIT notification pipeline, with the provider visible in the Novu dashboard (integration store + activity feed), **without forking Novu images** and **without a standalone shim service**.

---

## 1. Decision summary

| Concern | Decision |
|---|---|
| Novu-side provider | Built-in **`generic-sms`** integration (present in v2.3.0; no image rebuild) |
| Request reshaping (the `messages[]` body Ozeki expects) | **`_passthrough.body`** provider override attached by novu-bridge at trigger time |
| Auth | generic-sms credentials: `apiKeyRequestHeader = "Authorization"`, `apiKey = "Basic <base64(user:pass)>"` |
| Message id / correlation | Bridge `transactionId` → Ozeki `message_id` (echoed by the gateway) → Novu message `identifier` via `idPath` |
| Integration selection | `overrides.sms.integrationIdentifier` (works even when another SMS integration stays primary) |
| Delivery status | v1 = submit-level only (Ozeki's JSON API has no status webhook); folder-polling poller is a possible v2 |
| Branded "Ozeki" tile | Out of scope; optional upstream PR to novuhq/novu (separate track) |

## 2. Verified mechanics (from source, file:line)

**Ozeki wire contract** (vendor docs + official Java client `ozekisms/java-send-sms-http-rest-ozeki`):
- `POST http://<gw>:9509/api?action=sendmsg` (HTTPS :9508), Basic auth (gateway "HTTP API user"), JSON.
- Body: `{"messages":[{"message_id":"<any-string>","to_address":"+E164","text":"..."}]}` — one object per recipient; other fields optional (the official client serializes omit-if-null).
- Response: `{"http_code":200,"response_code":"SUCCESS","response_msg":"...","data":{"total_count":1,"success_count":1,"failed_count":0,"messages":[{"message_id":"<echoed>","status":"SUCCESS",...}]}}`.
- Failure `response_code` values are **undocumented**; there is no status-query action and no JSON-API delivery webhook (only `sent`/`notsent` folder polling via `receivemsg`, or the legacy GET API's `reporturl`).

**Novu v2.3.0 `generic-sms`** (`packages/providers/src/lib/sms/generic-sms/generic-sms.provider.ts`):
- POSTs to `baseUrl` verbatim (query string allowed → put `?action=sendmsg` inside `baseUrl`); body = `transform(bridgeProviderData, {...options, sender})`.
- `base.provider.ts:74-88`: `_passthrough.body` is **not case-transformed** (`to_address` survives) and deep-merges with **highest priority** over trigger data.
- Headers = `{[apiKeyRequestHeader]: apiKey}` (+ optional secret pair) → Basic auth works natively. `_passthrough.headers` are **ignored** on the non-token path — do not rely on them.
- `idPath` resolver is a dot-path reduce (`generic-sms.provider.ts:86-90`) → **`data.messages.0.message_id` resolves** (JS numeric-string indexing). If the response lacks `data.messages`, the reduce throws → Novu marks the message failed (an accidental but useful guard against malformed/error envelopes).
- No SSRF guard in 2.3.0 (added upstream later) → private-network gateway URLs work; re-check on Novu upgrades.

**Worker plumbing** (`apps/worker/src/app/workflow/usecases/send-message/`):
- `send-message.base.ts:52-63` `combineOverrides`: provider data = `overrides.providers[<novuProviderId>]` → the overrides key **must be `generic-sms`**, not `ozeki`.
- `send-message-sms.usecase.ts:53`: `overrides.sms.integrationIdentifier` pins the integration per trigger → Ozeki sends work while e.g. Twilio remains the primary SMS integration.
- `send-message-sms.usecase.ts:298-300`: `options.to = phone`, `options.content =` rendered step body. These leak into the JSON body alongside our `messages[]` (deepMerge only adds) — see Risk R1.

**Bridge reality check**: trigger `overrides` are sent **raw** — Novu does not handlebars-compile them. Therefore `messages[0].text` must be a concrete string at trigger time.
- develop (`backend/novu-bridge`, `NovuClient.java:98`): the bridge never holds the final text (Novu renders the workflow step body) → **this design is NOT implementable on develop's render flow as-is**.
- pass-through D4/D6 (`feat/whatsapp-contentsid-pipeline`, `NovuClient.identifyThenTrigger`): receives `renderedBody`, `contact.phone`, `transactionId` — everything the envelope needs, in one scope. The WhatsApp contentSid override (`buildProviderTemplateOverrides`) is the exact precedent for attaching a provider envelope there.

**⇒ Hard dependency: this design targets the pass-through pipeline.** (Fallback for a Novu-rendered pipeline would be a forked native provider — out of scope.)

## 3. Design

### 3.1 Novu integration (config-only; dashboard-visible)

Create via dashboard, `POST /v1/integrations`, or the configurator's Notification Providers screen (`NovuClient.createIntegration` already supports arbitrary providerIds):

```json
{
  "name": "Ozeki SMS Gateway",
  "identifier": "ozeki-sms",
  "providerId": "generic-sms",
  "channel": "sms",
  "active": true,
  "check": false,
  "credentials": {
    "baseUrl": "http://<gateway-host>:9509/api?action=sendmsg",
    "apiKeyRequestHeader": "Authorization",
    "apiKey": "Basic <base64(httpapiuser:password)>",
    "from": "<default-sender>",
    "idPath": "data.messages.0.message_id"
  }
}
```

Leave `datePath` unset (a missing `date` key returns undefined → provider falls back to `new Date()`; a wrong path could throw). Single-provider installs may simply make this the primary SMS integration; multi-provider installs rely on the identifier override below.

### 3.2 Bridge change (the only code change; pass-through NovuClient)

New `OzekiOverridesBuilder` (mirror of `buildProviderTemplateOverrides`) producing:

```json
{
  "sms": { "integrationIdentifier": "<configured id>" },
  "providers": { "generic-sms": { "_passthrough": { "body": {
    "messages": [{
      "message_id": "<transactionId>",
      "to_address": "<contact.phone (+E164, already formatted)>",
      "text": "<renderedBody>"
    }]
  }}}}
}
```

Wire-in point: the `identifyThenTrigger` SMS leg — when Ozeki is enabled, call the existing overrides-accepting `trigger(...)` overload instead of the plain one.

Enablement knob (holistic, no per-deployment values in code): env/config `NOVU_BRIDGE_SMS_PROVIDER=ozeki` + `NOVU_BRIDGE_OZEKI_INTEGRATION_IDENTIFIER=ozeki-sms` on the bridge container, defaulting off. If/when the develop strategy pipeline and the pass-through design are reconciled, the same builder wraps into an `OzekiProviderStrategy`; that needs two small interface tweaks — an overrides-key hook (develop's `NovuClient.java:98` keys overrides by `ProviderDetail.providerName`, but the worker requires `generic-sms`) and a delivery-context overload carrying `{phone, renderedBody, transactionId}`.

Optional per-message sender: add `"from_address": "<sender>"` to the message object — the wire field exists in the official client, but gateway/SMSC honoring is route-dependent (unconfirmed; test).

### 3.3 Resulting wire request (what Ozeki actually receives)

```
POST http://<gw>:9509/api?action=sendmsg
Authorization: Basic <b64>            ← from integration credentials
Content-Type: application/json

{
  "to": "+254700000001",              ← Novu options leak-through (expected ignored — R1)
  "content": "Complaint KE-123 ...",  ← ditto
  "sender": "<from>",                 ← ditto
  "id": "<novu message id>",          ← ditto
  "customData": {},                   ← ditto
  "messages": [{                      ← ours, via _passthrough (highest merge priority)
    "message_id": "<txn>",
    "to_address": "+254700000001",
    "text": "Complaint KE-123 ..."
  }]
}
```

Correlation chain: `nb_dispatch_log.transactionId` = Ozeki `message_id` = Novu activity-feed message `identifier` (via `idPath`).

## 4. Risks / empirical gates (test in this order, before writing bridge code)

- **R1 (gate #1)**: Ozeki must tolerate the unknown top-level fields (`to`, `content`, `sender`, `id`, `customData`). Ozeki 10 is .NET (typically tolerant deserialization) and the official client omits-if-null, but this is unconfirmed. One curl against a real/trial gateway settles it. If it rejects → fall back to a native-provider fork (or a rewrite proxy, previously rejected).
- **R2**: HTTP 200 + `response_code != "SUCCESS"` (or `failed_count > 0`) with a well-formed envelope would still be marked sent (generic-sms only extracts `idPath`). Accepted v1 limitation — same class as Novu's fire-and-forget providers (e.g. Kannel). Mitigation path: v2 poller on `receivemsg&folder=notsent` matching `message_id`, writing back to `nb_dispatch_log`.
- **R3**: Auth-failure behavior of the gateway (401 vs 200-with-error) is undocumented; probe once and record.
- **R4**: Novu versions past 2.3.0 add SSRF protection to generic-sms — a private-IP `baseUrl` may need the SSRF guard disabled in self-hosted env.
- **R5**: Datetime fields, if ever added (`time_to_send`, `valid_until`), are `yyyy-MM-dd HH:mm:ss` gateway-local — not ISO-8601.

## 5. Validation plan (mechanism-level)

1. **Gate R1/R3**: curl the canonical envelope + leak-through fields at a trial Ozeki install (free vendor download) or the target gateway. No bridge code before this passes.
2. Mock-gateway container (records the request, replies the canonical SUCCESS envelope) → point a generic-sms integration at it in a repro environment → trigger a real PGR complaint event → assert: mock received the correct `messages[]`; Novu activity feed shows the message with `identifier == transactionId`; `nb_dispatch_log` row SENT.
3. Real-gateway smoke: one complaint → phone receives the SMS.

## 6. Out of scope / future

- **Delivery-report poller** (`receivemsg` sent/notsent folders) — v2.
- **Branded Ozeki tile**: upstream `ozeki` provider PR to novuhq/novu (`pnpm run generate:provider`; ~7 files across @novu/providers, @novu/shared, application-generic, @novu/framework + dashboard SVG). Parallel track; self-hosted deployments pick it up on a future version bump.
- **Inbound SMS** (`receivemsg` folder=inbox) — not a notification concern.
