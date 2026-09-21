# Developer guide: extending the notification subsystem

Two questions come up every time someone integrates with this box, and this page answers both
end to end:

1. [**How do I add a provider?**](#1-adding-a-provider) — one that Novu supports, one that it
   does not, and one that does not even speak JSON.
2. [**How do I get my module's events delivered?**](#2-adding-an-event-producer) — what to put
   on Kafka, and how to watch it land.

Plus [local testing without real credentials](#3-local-testing-without-real-credentials) and a
[roadmap note](#roadmap-what-is-planned-to-move) on what is planned to move.

The interface you are coding against is published and tested:
[`contract/`](./contract/README.md). Read
[`envelope-v1.schema.json`](./contract/envelope-v1.schema.json) before writing a producer, and
[`outputs.md`](./contract/outputs.md) before writing anything that consumes the results.

---

## 1. Adding a provider

Everything below lives in `backend/novu-bridge/`. Pick the tier by asking **one** question:

```
Does Novu ship a provider for this gateway?
├─ yes ────────────────────────► Tier 1: a catalog entry. No transport code.
└─ no
   └─ Does the gateway speak JSON over HTTP, with a real status code?
      ├─ yes ──────────────────► Tier 2: generic-sms, pointed straight at it.
      └─ no ───────────────────► Tier 3: generic-sms, pointed at an adapter you write.
```

Each tier is strictly more work than the one above. Do not reach for a lower one because it
feels more explicit — a hand-written transport you own forever is a real cost, and Tier 1
providers get credential storage, activity logging and integration management for free.

### Tier 1 — Novu supports it (worked example: Twilio SMS)

One entry in `ProviderCatalog.types()`. No new class, no transport code, no SPA change — the
Configurator renders the credential form straight from the catalog.

```java
types.add(ProviderType.builder()
        .type("acme-sms").label("ACME SMS").channel("SMS").transport("novu")
        .novuProviderId("acme")                     // Novu's own provider id
        .credentialFields(List.of(
                CredentialField.text("apiKey", "API key", true, null, null),
                CredentialField.password("apiSecret", "API secret", true, null),
                CredentialField.text("from", "Sender id", true, "CITY-GOV",
                        "The sender id your messages are registered against")))
        .supportsVerify(true).supportsTestSend(true)
        .build());
```

Then:

1. **Add the type constant** next to `TWILIO_SMS`, `SMTP`, … and put it in
   `TYPES_LONGEST_FIRST`. That list is ordered **longest first** so that
   `twilio-whatsapp-a1b2…` can never resolve to `twilio-sms`. If your new type is a prefix of
   another one, or another one is a prefix of it, order matters — get it wrong and
   `deriveType` will mislabel live integrations.
2. **Credential mapping.** If your form keys *are* Novu's credential keys, `toNovuCredentials`
   already handles you through its default branch, which copies only the keys the catalog
   declares — an operator cannot smuggle an unexpected key into Novu's credential store. If
   they differ, add a case.
3. **`supportsVerify`.** Say `false` unless the gateway really has a credential-check call.
   `smscountry` and `ozeki` say false because the only way to learn whether their login works
   is to send a message, and a "verify" that always passes is worse than none.

**Tests to touch:** `service/provider/ProviderCatalogTest` (the type appears, required
credentials are enforced, the identifier round-trips through `typeFromIdentifier`) and
`web/controllers/ProviderCatalogControllerTest` (the catalog endpoint serves it).

### Tier 2 — Novu does not support it, but it speaks JSON (worked example: Ozeki)

Novu ships a `generic-sms` provider that POSTs a JSON body and reads the response through
configured dot-paths. That is enough for any gateway with a sane JSON API, and it still needs
**no transport code** — only a credential mapping.

Ozeki is the shipped example. Its catalog entry declares `transport: "novu-generic-sms"` and
`novuProviderId: "generic-sms"`, and `ProviderCatalog.ozekiCredentials` does the mapping:

| Novu credential | What it carries | Why |
|---|---|---|
| `baseUrl` | the gateway's own URL | `generic-sms` POSTs here **verbatim** — it appends no path, so a query string survives |
| `apiKey` + `apiKeyRequestHeader` | username, and the header NAME to send it under | `generic-sms` sends credentials as headers: `{[apiKeyRequestHeader]: apiKey}` |
| `secretKey` + `secretKeyRequestHeader` | password, likewise | |
| `from` | sender id | `generic-sms` puts it in the body as both `from` and `sender` |
| `idPath`, `datePath` | dot-paths into the reply | Novu reads the correlation id with a bare `reduce`. Wrong paths cost observability, not delivery |

The body Novu sends is `{to, from, content, id, customData, sender}`. Anything the gateway
needs that is **not** a secret and has no credential slot can ride as a query parameter on
`baseUrl` — that is exactly what `ADAPTER_PARAM_API_URL` does for SMSCountry.

**Tests to touch:** `ProviderCatalogTest` — assert the credential map, key by key. That mapping
is the entire integration; if it is wrong, every send fails at the gateway with no local
symptom.

### Tier 3 — the gateway does not speak JSON (worked example: SMSCountry)

Some gateways cannot be driven by any Novu provider. SMSCountry's legacy bulk API takes
form-encoded parameters, answers in plain text (`OK:<jobid>`), and returns **HTTP 200 for
everything** — a malformed request comes back 200 carrying an ASP.NET stack trace.

The shape of the answer: an `smscountry` provider is really a Novu `generic-sms` integration
pointed at **this service**, and `novu-bridge` wears the JSON face the gateway cannot.

```
Novu worker ──POST JSON──► novu-bridge adapter ──form POST──► SMSCountry
                                    │
                            translates the plain-text
                            reply into JSON + a real
                            HTTP status code
```

What to write, in order:

1. **A client** — `service/SmsCountryClient` is the model: build the gateway's native request,
   parse its native reply, and return a `NovuClient.NovuResponse`. Keep every gateway quirk
   here. Mask recipients in logs (`PiiMask`), never log credentials.
2. **An adapter controller** — `web/controllers/SmsCountryAdapterController`, under
   `/novu-adapter/v1/gateways/<gateway>/send`. Four rules, each learned the hard way:
   - **The credential headers ARE the authentication.** Novu holds no DIGIT token, so this
     path is excluded from `ProxyAuthFilter`. Refuse before touching the gateway, and say only
     which header is missing — never what was sent.
   - **A success must answer a non-empty `id`.** Novu's worker marks the step failed unless
     `result.id` is truthy.
   - **A rejection must answer non-2xx.** Axios throws inside `generic-sms` and the worker
     records `PROVIDER_ERROR`. A 200 with an error body reads as a successful send to
     everything downstream — that is the phantom-`SENT` this whole design avoids.
   - **Sanitize any URL that arrives as a parameter.** It decides where this service posts a
     live credential. Only an absolute `http(s)` URL is honoured; anything else falls back to
     the configured default.
3. **Credential mapping** — as Tier 2, but `baseUrl` points at **your adapter**, not the
   gateway, and the gateway's own URL rides as a query parameter. The URL must be reachable
   **from the Novu worker**, so it is an in-cluster address (`http://novu-bridge:8080/...`),
   never the public gateway.
4. **Gateway routing.** `/novu-adapter/v1/gateways/**` is deliberately unreachable from
   outside: Kong terminates it with 404, its upstream is a dead address, and it is absent from
   the auth-optional whitelist. Keep it that way — the request carries provider credentials in
   headers. Do **not** add a route for it.
5. **A receipt shape**, if the gateway sends delivery reports — see
   [Delivery receipts](#delivery-receipts-optional-but-do-it) below.

**Tests to touch:** `service/SmsCountryClientTest` (every reply shape the gateway really
produces — the OK case, an error string, an HTML error page, an empty body),
`web/controllers/SmsCountryAdapterControllerTest` (missing headers → 401, missing recipient →
400, gateway rejection → 502 not 200, success → non-empty `id`), `ProviderCatalogTest` for the
mapping.

#### Is a `DeliveryProvider` ever the answer?

`service/delivery/DeliveryProvider` is the seam for a transport that bypasses Novu entirely
(`SmsCountryDeliveryProvider` is the one implementation, kept for the pre-catalog
`novu.bridge.sms.provider=smscountry` route). **Prefer the adapter.** A `DeliveryProvider`
gives up Novu's credential store, its activity log and the Configurator's provider management,
and it has to be selected by configuration rather than chosen by an operator. Reach for it only
when the gateway cannot be driven by an HTTP POST at all.

#### Delivery receipts (optional, but do it)

Without a receipt a row stops at `SENT` and nobody ever learns whether the message arrived.
`service/receipts/ReceiptParser` is tolerant by design — it looks for a correlation id and an
outcome word anywhere in the payload — so a new gateway usually needs **nothing** beyond a
route for `/novu-adapter/v1/receipts/<gateway>` and the shared secret. Add key names to
`ID_KEYS` / `REF_KEYS` / `STATUS_KEYS` only if the gateway invents new ones, and extend
`mapStatus` only for an outcome word the substring rules miss. Cover it in `ReceiptParserTest`
with the gateway's real payload, not an idealised one.

---

## 2. Adding an event producer

Your module produces **fully-rendered** messages. It resolves the recipient, picks the
template, fills it, localizes it — and hands over one envelope per (recipient × channel). The
bridge does no resolution and no rendering.

### Step 1 — publish the envelope

Produce to **`notifications.events`** (the module-neutral topic; `complaints.domain.events`
also exists and is still consumed, but it is PGR's and you should not borrow it). The topic
never decides how an event is handled — `eventType` does — so a new producer needs no
consumer-side branching, and may have its own topic if it prefers
(`NOVU_BRIDGE_KAFKA_INPUT_TOPICS` is a comma-separated list).

Required, and nothing else is:

| Field | What to put in it |
|---|---|
| `eventId` | A uuid for this message |
| `eventType` | Your producer's constant — see step 2 |
| `eventName` | Your dotted business event, e.g. `XYZ.LICENCE.RENEWED`. Becomes the template key when you send none |
| `tenantId` | The DIGIT tenant |
| `channel` | `SMS`, `WHATSAPP` or `EMAIL` |
| `subscriberId` | `tenantId:userUuid`, or `tenantId:phone` when there is no uuid |
| `renderedBody` | The final, localized text |

Strongly recommended:

- **`entityId`** — your own handle for whatever this is about. It becomes the ledger's
  `reference_number`, which is how an operator finds every message for one case. Without it the
  bridge falls back to `data.referenceNumber`, then `data.complaintNo`, then the `eventId`.
- **`contact`** — the recipient's phone (SMS/WhatsApp) or email. Without the right one the
  message is recorded `SKIPPED / NB_CONTACT_MISSING`.
- **`module`** — recorded verbatim and shown on the Logs screen.

Channel-specific: `subject` for EMAIL; `templateId` + `contentVariables` for WHATSAPP (without
an approved `templateId` a WhatsApp message is `SKIPPED / NB_TEMPLATE_NOT_APPROVED`).

Start from [`examples/05-module-neutral-sms.json`](./contract/examples/05-module-neutral-sms.json)
— a licence renewal from a module that does not exist in this repository, deliberately carrying
nothing PGR-shaped.

### Idempotency: `transactionId` is the field that matters

The ledger's unique key is `(transaction_id, channel, recipient_value)` and the write is an
upsert. So:

- **Derive it from the business fact, deterministically.** PGR uses
  `entityId:action:toState:subscriberId:channel`. A Kafka redelivery or a producer retry then
  updates the same row instead of double-counting a send.
- **Two genuinely different messages must differ.** `CoreSmsTranslator` appends a fresh uuid on
  purpose: a re-sent OTP *is* a second message and must not overwrite the first.
- Omit it and the bridge derives `eventId:channel`, which dedupes redelivery and nothing else.

### Step 2 — get your eventType onto the allowlist

`novu.bridge.event.types` (`NOVU_BRIDGE_EVENT_TYPES`) is an allowlist. An unlisted type is
recorded `REJECTED / NB_UNSUPPORTED_EVENT_TYPE` and sent to the DLQ.

This is deliberate. The bridge never infers what an event is from which fields happen to be
set; onboarding a producer is an explicit act with a diff. Add your type in
`application.properties`, the compose default and the Helm values, alongside
`COMPLAINTS_WORKFLOW_TRANSITIONED` and `CORE_SMS`.

### Step 3 — watch it land

- **Logs screen** (Configurator → Notifications → Logs), or
  `GET /novu-bridge/novu-adapter/v1/logs?tenantId=…&referenceNumber=…`. Every event gets a row
  with an explicit outcome — there is no silent path.
- **Before going near Kafka**, `POST /novu-adapter/v1/dispatch/_validate` runs one envelope
  through validation and the derivation and writes a `RECEIVED` row without sending anything.
  `_dry-run` with `send: true` does the real thing. Neither is routed publicly; call them
  in-cluster.
- **When nothing appears at all**, check the DLQ (`novu-bridge.dlq`). Its messages carry
  `{event, sourceTopic, errorCode, errorMessage}`. There is **no automatic replay**: fix the
  cause and re-produce the `event` object. Because the ledger keys on `transactionId`, a replay
  updates the existing row rather than duplicating it.

Statuses, transitions, columns and the DLQ shape: [`outputs.md`](./contract/outputs.md).
Every code: [`error-codes.md`](./contract/error-codes.md).

### Adapting a format you do not control

Sometimes the producer is a service you cannot change — a DIGIT core image publishing its own
message shape. The pattern is a **translator keyed on the topic**, not a shape-sniffing branch
in the consumer.

`service/core/CoreSmsTranslator` is the worked example. DIGIT core publishes an `SMSRequest` to
`egov.core.notification.sms` for login OTPs and password resets; the translator turns it into a
v1 envelope with `eventType: CORE_SMS` and hands it to the same pipeline as everything else, so
it gets the same gates, the same provider selection and the same ledger row. Worth copying:

- **The topic is the contract.** It is why this can live in its own class instead of as a
  branch in `DispatchPipelineService` — the pipeline stays module-neutral.
- **Be tolerant about field names, strict about the essentials.** Core images disagree on
  `mobileNumber`/`mobile`/`phone`, so the translator accepts all of them; anything without a
  phone and a message is `NB_INVALID_CORE_SMS`.
- **Fill in what the foreign format lacks.** No tenant? Use a configured default. No E.164?
  Prepend a configured country code. No idempotency key? Mint one that makes each send its own
  row.
- **Translation failures DLQ without a ledger row** — there is no envelope yet to write one
  for. Say so in the runbook so nobody hunts for a row that cannot exist.

Wire it with a `@KafkaListener` on its own topic property, `@ConditionalOnProperty` so a
deployment can switch it off, and hand the result to `DomainEventConsumer.handle(event, topic)`
— never straight to the pipeline, or you lose the DLQ.

**Tests to touch:** a translator test (every field-name variant the real producer emits, plus
the refusal cases) and a consumer wiring test (translation failure DLQs; success reaches the
pipeline). `CoreSmsTranslatorTest` and `CoreSmsConsumerTest` are the models.

---

## 3. Local testing without real credentials

You do not need a Twilio account, an SMS gateway or a mailbox to exercise the whole path. Both
techniques below were used on this project.

### An HTTP mock for an SMS gateway

Stand up any small HTTP server on the compose network that answers what the gateway would, then
point the provider at it — for a Tier 2 provider set `baseUrl` to the mock, for Tier 3 set the
adapter's upstream URL parameter.

What makes a mock useful rather than reassuring:

- **Answer in the gateway's real format**, including its wrong-looking parts. SMSCountry's
  plain-text `OK:<jobid>` with HTTP 200 on failure is the whole reason its adapter exists; a
  mock that returns tidy JSON would test nothing.
- **Make it fail on demand.** A recipient or a keyword that triggers a rejection is what lets
  you see a `FAILED` row and confirm the message is honest.
- **Log what it received.** This is how you verify the credential headers and sender id
  actually arrive — the one thing that silently breaks a provider integration.
- Reachability is from the **Novu worker**, not from your laptop: use the compose service name.

### A local SMTP sink for email

Run a catch-all SMTP server with a web inbox (Mailpit is the one used here) on the compose
network, and register it as the email provider from the Configurator like any other: type
**Email (SMTP)**, host = the service name, port = its SMTP port, any username and password,
`secure` off. Mail is accepted, never forwarded, and appears in its web UI.

This exercises the genuine path — a real Novu `nodemailer` integration, a real SMTP
conversation, a real `SENT` row — with no mailbox and no risk of mailing a real person. Two
gotchas: Novu's `nodemailer` credential store is a **string** map, so the port must be sent as
text, not a number; and it requires `senderName` alongside `from`.

### Either way

- Use **test-send** on the Providers screen for a single round trip; it writes one
  `is_test` row at your tenant so you can see the result on Logs.
- Use `POST /dispatch/_dry-run` with `send: true` to exercise the **full** pipeline — gates,
  consent, provider selection, ledger — which test-send deliberately bypasses.
- Nothing above needs a change to the bridge. If a local test needs production code to behave
  differently, that is a smell: the seam you want is probably a provider, not a flag.

---

## Roadmap: what is planned to move

> **This section describes intent, not commitments. Nothing here is a shape you can code
> against today.**

Today the box owns **delivery**: gating, provider selection, dispatch, the ledger, receipts.
It does not own **routing** (who should be told), **recipient resolution** (who they are and
how to reach them) or **rendering** (what the message says). Those live in the producing
module — for complaints, in `pgr-services` and its MDMS masters `NotificationRouting`,
`NotificationTemplate` and `NotificationChannel`.

That is why the envelope is "pre-rendered": it is the only honest contract while the other half
lives elsewhere.

The intent is to move routing, recipient resolution and rendering **behind** this interface, so
a producing module emits a **thin event** — "this happened to this entity" — and the
notification subsystem decides who hears about it and in what words. A module would then
integrate by describing its events once, rather than by re-implementing recipient resolution
and templating.

What that means for you now:

- **The v1 envelope is not going away.** A thin event would be a new `eventType` and a new
  schema version alongside it, not a replacement, and the bridge would accept both.
- **Write your producer against v1 today.** It is published, tested, and the migration path is
  additive.
- **Do not build on the internals.** `DerivedContext`, the template-key reconstruction and the
  data-block conventions (`action`, `toState`) are implementation, not contract. The contract
  is the schema and `outputs.md`.
- **No shape is promised**, no date is promised, and the thin-event design is not settled.

---

## See also

- [`contract/`](./contract/README.md) — the published interface and how it is kept honest
- [operator-guide.md](./operator-guide.md) — what an operator can change without you
- [message-templates.md](./message-templates.md) — writing the message text
- [README.md](./README.md) — the deployment runbook
