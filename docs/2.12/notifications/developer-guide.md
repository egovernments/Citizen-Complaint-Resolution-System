# Developer guide: extending the notification subsystem

Three questions come up every time someone integrates with this box, and this page
answers all three end to end:

1. [**How do I get my module's notifications sent?**](#1-plugging-a-module-into-notifications)
   — publish a thin event and let the box route, resolve and render it.
2. [**How do I add a provider?**](#2-adding-a-provider) — one that Novu supports,
   one that it does not, and one that does not even speak JSON.
3. [**How do I supply my own recipients, locales or localization?**](#3-swapping-the-digit-half)
   — the four interfaces, and the package boundary that keeps them real.

Plus [local testing without real credentials](#4-local-testing-without-real-credentials)
and [testing your integration](#5-testing-your-integration).

The interface you are coding against is published and tested:
[`contract/`](./contract/README.md). Read
[`thin-event-v1.schema.json`](./contract/thin-event-v1.schema.json) before writing
a producer, [`envelope-v1.schema.json`](./contract/envelope-v1.schema.json) if you
are on the pre-rendered path, and [`outputs.md`](./contract/outputs.md) before
writing anything that consumes the results.

---

## The two interfaces

There are two kinds of message the bridge accepts, told apart by one field —
`kind` — read off the raw map before binding. Never inferred from which fields
happen to be set.

| | **Thin domain event** (`kind: "THIN"`) | **Pre-rendered envelope** (`kind` absent or `"RENDERED"`) |
|---|---|---|
| You say | *this happened to this entity* | *send exactly this text to exactly this person on this channel* |
| Messages per business event | one | one per recipient × channel |
| Who decides the recipients | the box, from routing config | you |
| Who picks the language | the box, per recipient | you |
| Who writes the words | the box, from the template masters | you |
| An operator can change who is told, and what it says | **yes**, in the Configurator | no, it is in your code |
| Schema | [`thin-event-v1.schema.json`](./contract/thin-event-v1.schema.json) | [`envelope-v1.schema.json`](./contract/envelope-v1.schema.json) |

**Use the thin event.** It is the reason this subsystem exists: a module describes
its events once and stops owning recipient resolution, localization and
templating. It also puts far less personal data on the broker — a role
notification to a forty-person pool used to put forty phone numbers on a Kafka
topic; now it puts none.

**The pre-rendered envelope is a public interface forever.** It is not deprecated
and it is not going away. Reach for it when:

- the producer is outside this repository and cannot be taught a new shape;
- the message genuinely has one recipient and no configurable audience;
- you are adapting a foreign format — see
  [adapting a format you do not control](#adapting-a-format-you-do-not-control).

Both kinds travel on the same topics. The topic never decides how a message is
handled.

---

## 1. Plugging a module into notifications

Worked end to end for an imaginary trade-licence service with **no notification
code at all**. The published example is
[`examples/thin/03-module-neutral.json`](./contract/examples/thin/03-module-neutral.json).

### Step 1 — declare your events in `NOTIFICATIONS.EventCatalogue`

One row per event you will ever fire. This is the authoring vocabulary: the
Configurator reads it to build its pickers and to validate templates **before any
event of that type has ever been seen**. An operator writing a message for a
rarely-fired event would otherwise get no checking at all.

| Field | Meaning |
|---|---|
| `module` | Owner, e.g. `XYZ`. Required. Not part of the key |
| `eventName` | The key. Dotted, module-prefixed, globally unique. Required |
| `label` | What the Configurator shows in a picker. Required |
| `entityType` | What `entityId` names, e.g. `LICENCE` |
| `actors` | `[{name, label, required}]` — the actor names your producer will send. Feeds the audience picker's Actor list |
| `placeholders` | `[{name, label, blankWhen}]` — the token vocabulary for this event. `name` is the token **without braces** |
| `channels` | `["SMS","WHATSAPP","EMAIL"]` — which channels this event may be routed to. Absent means no restriction |
| `active` | Absent means true |

```json
{
  "module": "XYZ",
  "eventName": "XYZ.LICENCE.RENEWED",
  "entityType": "LICENCE",
  "label": "Licence renewed",
  "actors": [{ "name": "holder", "label": "Licence holder", "required": true }],
  "placeholders": [
    { "name": "licence_no",  "label": "Licence number" },
    { "name": "valid_until", "label": "Valid until" },
    { "name": "trade_name",  "label": "Trade name" },
    { "name": "holder_name", "label": "Holder name", "blankWhen": "the licence was filed without a name" }
  ],
  "channels": ["SMS", "EMAIL"],
  "active": true
}
```

**Make the event name carry the outcome, not just the action.** The name is a
config key, and two outcomes that need different words must be two names. PGR
learned this the hard way: `COMPLAINTS.WORKFLOW.RATE.CLOSEDAFTERRESOLUTION` and
`…RATE.CLOSEDAFTERREJECTION` are the same action with opposite meanings.

**An uncatalogued event is refused** — `REJECTED / NB_EVENT_NOT_IN_CATALOGUE`,
plus a DLQ message. The one exception is a tenant with **no catalogue rows at
all**, which is a server upgraded before the seed step ran; refusing everything
there would break the no-manual-migration promise.

PGR does not hand-write its rows. `local-setup/scripts/generate_event_catalogue.py`
walks the workflow definition and emits one row per reachable `(action, toState)`;
a CI job re-runs the generator and fails on a diff. Do the same if your events are
derivable from something you already own.

### Step 2 — add routing rows and templates

Both are per tenant and both are edited by an operator in the Configurator. You
ship defaults; you do not own them afterwards.

**`NOTIFICATIONS.Routing`** — unique on `(eventName, audience, channel)`:

```json
{ "module": "XYZ", "eventName": "XYZ.LICENCE.RENEWED", "audience": "ACTOR:holder",          "channel": "SMS",   "active": true }
{ "module": "XYZ", "eventName": "XYZ.LICENCE.RENEWED", "audience": "ROLE:LICENCE_OFFICER",  "channel": "EMAIL", "active": true }
```

**`NOTIFICATIONS.Template`** — unique on `(eventName, audience, channel, locale)`:

```json
{ "module": "XYZ", "eventName": "XYZ.LICENCE.RENEWED", "audience": "ACTOR:holder",
  "channel": "SMS", "locale": "en_IN", "subject": null,
  "body": "Licence {licence_no} for {trade_name} is renewed until {valid_until}.",
  "active": true }
```

Every routing row needs a template in the deployment's default locale
(`novu.bridge.default.locale`, `en_IN`), because that is the fallback every
recipient lands on. Without one the message is `SKIPPED / NB_NO_TEMPLATE`.

For WhatsApp add `NOTIFICATIONS.ProviderTemplate`, unique on
`(provider, channel, eventName, audience, locale)`, carrying the provider's
approved `templateId` and its **ordered** `variables`.

### Step 3 — publish the event

Produce to **`notifications.events`** — the module-neutral topic, already on the
default input list alongside PGR's own `complaints.domain.events`. A module may
have its own topic instead (`NOVU_BRIDGE_KAFKA_INPUT_TOPICS` is a comma-separated
list); the topic changes nothing about how the event is handled.

**Required, and nothing else is:**

| Field | What to put in it |
|---|---|
| `kind` | The constant `"THIN"` |
| `eventId` | A uuid for the **domain event**, not for a message. One thin event, N ledger rows, one `eventId` |
| `eventType` | Your producer's constant — see step 4 |
| `module` | Your module name. Recorded verbatim in the ledger, and the catalogue's owner key |
| `eventName` | The catalogue key |
| `tenantId` | The DIGIT tenant |

**Optional and load-bearing:**

| Field | What to put in it |
|---|---|
| `entityId` | Your own handle for the thing this happened to. Becomes the ledger's `reference_number`, which is how an operator finds every message about one case. **Send it.** |
| `entityType` | What `entityId` names |
| `transactionSeed` | The idempotency seed — see below |
| `actors` | `{name: actorRef}` — the people this event is *about*, keyed by the name routing refers to as `ACTOR:<name>` |
| `recipients` | `[actorRef]` — explicit contacts for account-less flows, reached by the audience `EVENT_RECIPIENTS` |
| `data` | Placeholder name → literal value |
| `localized` | Placeholder name → a localization code, or an ordered list of codes to try |
| `localizationModules` | Which localization modules to search, **in order** |
| `localizationLocale` | The one locale the codes are resolved in, for the whole event |
| `dataByLocale` | `{locale: {token: value}}` — the escape hatch for a value that cannot be a code |
| `ledgerEventName` | The name stamped on the ledger rows, when it must differ from the config key |
| `payload` | Your own structured block, echoed onto every minted envelope's `data` |
| `schemaVersion`, `eventTime`, `producer` | As the envelope |

**Absent on purpose:** `channel`, `subscriberId`, `renderedBody`, `subject`,
`templateKey`, `templateId`, `contentVariables`. The box produces all of those. A
producer that filled them in would be re-implementing the thing this removes.

#### What goes on the wire, and what must not

An actor ref is `{userId, type, name, phone, email, locale}`.

> **Send a uuid when the recipient has an account. Send contact fields only when
> they do not.**

With a `userId` and no contact fields at all, the box hydrates name, phone and
email from the directory, and none of it ever touches Kafka. Supply contacts only
for a recipient with no account — an anonymously-filed case, an OTP target.

Keep the *message* off the wire too. `data` carries placeholder **values**, not
sentences: it is the same information the rendered body used to carry, sent once
instead of once per recipient, and it never leaves the box. If a value is
sensitive and does not belong in every message, do not put it in `data` and do not
reference it from a template.

#### Idempotency: `transactionSeed`

The ledger's unique key is `(transaction_id, channel, recipient_value)` and the
write is an upsert. The box does not invent the key, it **completes** one:

```
transactionId = <transactionSeed>:<subscriberId>:<channel>
```

- **Derive the seed from the business fact, deterministically.** PGR sends
  `<serviceRequestId>:<ACTION>:<TOSTATE>`, which makes the result byte-identical
  to what it published before the cutover — so a redeploy mid-flight cannot
  double-send.
- **Two genuinely different messages must differ.** A re-sent OTP *is* a second
  message and must not overwrite the first; put something unique in the seed.
- Omit it and the box derives `<entityId>:<eventName>`, then `<eventId>`.

A channel-less decision row is stamped `<seed>:NONE`, which keeps the unique key
intact for a decision taken before any channel existed.

#### Localization

`data` carries literals, `localized` carries codes. Per token, the box tries:
the first code in `localized[token]` that has a message → `dataByLocale[locale][token]`
→ `data[token]` → **the token is left unsubstituted**, braces and all.

```json
"data":      { "complaint_type": "Streetlight", "status": "RESOLVED" },
"localized": { "complaint_type": ["COMPLAINT_HIERARCHY.Streetlight",
                                  "pgr.complaint.category.Streetlight"],
               "status":         ["CS_COMMON_RESOLVED"] },
"localizationModules": ["rainmaker-pgr", "rainmaker-common"]
```

Deciding *which* codes apply is your knowledge; looking them up is a DIGIT
primitive. Send both the literal and the code where you have both — a localization
outage then degrades to the raw value instead of blanking the token.

Two things that catch people:

- **Localization is resolved once per event, in one locale** — `localizationLocale`,
  else the deployment default. In a two-language fan-out both recipients get the
  *template text* in their own language and the *same substituted values*. That is
  deliberate: it is exactly what the pre-rendered path did, and changing it is a
  decision, not an accident. A producer migrating across sets
  `localizationLocale` to the locale it used to build its values with, and its
  messages come out byte-identical.
- **A token with no value anywhere is absent, not blank.** The renderer then
  leaves its braces literal. A blank looks like a working template with nothing to
  say; an empty WhatsApp variable is also what Twilio rejects.

### Step 4 — get your `eventType` onto the allowlist

`novu.bridge.event.types` (`NOVU_BRIDGE_EVENT_TYPES`, default
`COMPLAINTS_WORKFLOW_TRANSITIONED,CORE_SMS`) is an allowlist. An unlisted type is
`REJECTED / NB_UNSUPPORTED_EVENT_TYPE` **and** DLQ'd, per message.

This is deliberate, and it is the safety property the rollout depends on: the
failure mode of a misconfigured deployment is a screen full of red rows, not
silence. Onboarding a producer is an explicit act with a diff. Add your type in
`application.properties`, the compose default and the Helm values.

### Step 5 — dry-run it before you touch Kafka

```
POST /novu-bridge/novu-adapter/v1/dispatch/_resolve
{ "RequestInfo": {...}, "event": { ...your thin event... } }
```

It runs the **real** resolver against the tenant's **real** configuration — the
same routing rows, templates, role pools and language preferences — and returns
the envelopes it would mint, in emission order, fully rendered, with the contact
block filled in. **Nothing is sent and no ledger row is written**, which is what
makes it safe to point at a production tenant.

The response carries:

- `envelopes` — what each recipient would get;
- `terminalCode` — the channel-less decision, when there would be none
  (`NB_NO_ROUTING`, `NB_NO_RECIPIENTS`, `NB_UNKNOWN_AUDIENCE_SCHEME`,
  `NB_RECIPIENT_LIMIT_EXCEEDED`);
- `diagnostics` — every decision taken on the way, including per-recipient skips.

It answers "why would this send nothing?" *before* the event happens instead of
forensically afterwards.

**It is admin-only.** It expands role pools and returns contact details for every
holder of a role, which is broader than the Logs screen's read tier should hand
out. A caller without a role from `novu.bridge.proxy.admin.roles` gets
`403 NB_ADMIN_ROLE_REQUIRED`.

### Step 6 — watch it land

- **Logs screen** (Configurator → Notifications → **Notification Logs**), or
  `GET /novu-bridge/novu-adapter/v1/logs?tenantId=…&referenceNumber=…`.
- **`source_path`** on every row says which half produced it: `PRERENDERED` (a
  producer sent a finished envelope) or `RESOLVED` (the box routed and rendered
  it). The API filters on it — `&sourcePath=RESOLVED` — which is how you answer
  "is this deployment on the new path?" per message, in production. The
  Configurator does not expose that filter yet.
- **Every outcome is a row.** There is no silent path. A decision the box takes
  before there is a channel gets a row with `channel = NONE`, `recipient_value =
  none` and the reason in `last_error_code`.
- **When nothing appears at all**, check the DLQ (`novu-bridge.dlq`). Its messages
  carry `{event, sourceTopic, errorCode, errorMessage}`. There is **no automatic
  replay**: fix the cause and re-produce the `event` object. Because the ledger
  keys on the transaction id, a replay updates the existing rows rather than
  duplicating them.

#### Which failures are rows, and which are DLQ messages

The rule is worth internalising, because it decides where you look.

| The box decided… | Result |
|---|---|
| …there is no routing, nobody resolved, no template, an unknown audience scheme, or the fan-out is over the cap | A `SKIPPED` **ledger row**. Never DLQ'd — a replay would produce the identical answer forever |
| …the message is malformed, or names an event that is not in the catalogue | A `REJECTED` ledger row **and** a DLQ message. Write the row first, so an operator can see what was refused |
| …a transport failed | A `FAILED` ledger row, and a DLQ message on the throw path. Retryable |

**A configuration decision never throws.** That is the design rule; keep it if you
extend the resolver.

Statuses, transitions, columns and the DLQ shape:
[`outputs.md`](./contract/outputs.md). Every code:
[`error-codes.md`](./contract/error-codes.md).

### How audiences resolve

A routing row's `audience` is a **reference with a scheme**, resolved in-process
by a resolver registered for that scheme.

| Form | Resolved by | I/O? |
|---|---|---|
| `ACTOR:<name>` | the event's `actors` map | none |
| `ROLE:<code>` | every holder of the role in the tenant | a directory search |
| `EVENT_RECIPIENTS` | the event's `recipients[]` | none |
| `A\|B` | the first link that yields a non-empty list | as its links |

Legacy bare names still parse, so a tenant whose configuration has not been copied
yet resolves identically: `CITIZEN` → `ACTOR:citizen`, `EMPLOYEE` →
`ACTOR:assignee`, `AUTO_ESCALATE` / `SYSTEM` → dropped, anything else →
`ROLE:<it>`. The old `assigneeOnly` flag has no equivalent because it becomes the
chain `ACTOR:assignee|ROLE:<code>` — which is exactly what "notify the assignee,
but fall through to the pool rather than notifying nobody" always meant.

**An unknown scheme is never guessed at.** `SOMETHING:x` finds no resolver and
produces `SKIPPED / NB_UNKNOWN_AUDIENCE_SCHEME`. Falling back to "treat it as a
role" would silently notify nobody and look like configuration that works.

Three fan-out semantics that are easy to lose and cost real incidents:

- **Dedupe is on `(channel, subscriberKey)`, and the audience is deliberately not
  in the key** — someone holding two notified roles gets one message per channel,
  not two. The key is consumed **only after a successful hand-off**, so a missing
  template on the first routing row cannot suppress the second row for the same
  person.
- **A failed audience resolution is not memoized.** The memo exists so a role
  authored on three channels triggers one directory search rather than three;
  caching a failure would turn one blip into a silent three-channel outage.
- **The fan-out cap refuses the whole event.** A thin event naming a role is an
  unbounded instruction. Over `novu.bridge.notifications.recipient.cap` (1000),
  nothing is delivered and the event is `SKIPPED / NB_RECIPIENT_LIMIT_EXCEEDED` —
  half a fan-out is worse than none, because nobody can tell which half went.

### How PGR does it

`pgr-services` is the reference producer, and it is worth reading as one: it keeps
exactly the four things the box cannot know, and sends everything else as data.

| Stays in PGR | Why |
|---|---|
| Deciding a workflow transition happened | Workflow vocabulary |
| Resolving the assignee (the live assignee, else the last `ASSIGN` in workflow history) | A workflow-history walk is PGR knowledge. The box is simply told the answer as `actors.assignee` — which deletes a workflow call from the notification path entirely |
| Building the thirteen placeholder values, including the HRMS/department join behind `{emp_department}` and `{emp_designation}` | They are placeholder *values*, not recipients |
| Choosing which localization codes apply (the `COMPLAINT_HIERARCHY.*` → `pgr.complaint.category.*` ladder) | Which codes apply is PGR's; looking them up is not |

Everything else — audience matching, role-pool expansion, per-recipient language,
template lookup with locale fallback, placeholder substitution, provider-template
resolution, fan-out, dedupe, the contact gate, minting the envelope — now happens
in the box.

Two files are worth reading before you write your own producer:

- `backend/pgr-services/src/main/java/org/egov/pgr/service/notification/ThinEventBuilder.java`
  — the real thing. Pure assembly: every value it needs has already been fetched,
  and it names no audience, expands no role pool, looks up no localization
  message, picks no template and mints no envelope.
- `backend/novu-bridge/src/test/java/org/egov/novubridge/service/resolution/golden/ScenarioThinEventBuilder.java`
  — the same event built independently, inside the bridge's own tests, as the
  definition of what PGR *must* emit. Every line has a comment saying which
  producer behaviour it corresponds to. A mirrored copy lives in pgr-services'
  tests (`golden/BridgeThinEventSpec.java`) because the test runner mounts one
  module at a time.

Having the definition written twice, independently, is the point: the recorded
fixture cannot quietly drift into "whatever the producer happens to do".

---

## 2. Adding a provider

Everything below lives in `backend/novu-bridge/`. Pick the tier by asking **one**
question:

```
Does Novu ship a provider for this gateway?
├─ yes ────────────────────────► Tier 1: a catalog entry. No transport code.
└─ no
   └─ Does the gateway speak JSON over HTTP, with a real status code?
      ├─ yes ──────────────────► Tier 2: generic-sms, pointed straight at it.
      └─ no ───────────────────► Tier 3: generic-sms, pointed at an adapter you write.
```

Each tier is strictly more work than the one above. Do not reach for a lower one
because it feels more explicit — a hand-written transport you own forever is a
real cost, and Tier 1 providers get credential storage, activity logging and
integration management for free.

### Tier 1 — Novu supports it (worked example: Twilio SMS)

One entry in `ProviderCatalog.types()`. No new class, no transport code, no SPA
change — the Configurator renders the credential form straight from the catalog.

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
   `twilio-whatsapp-a1b2…` can never resolve to `twilio-sms`. If your new type is
   a prefix of another one, or another one is a prefix of it, order matters — get
   it wrong and `typeFromIdentifier` will mislabel live integrations.
2. **Credential mapping.** If your form keys *are* Novu's credential keys,
   `toNovuCredentials` already handles you through its default branch, which
   copies only the keys the catalog declares — an operator cannot smuggle an
   unexpected key into Novu's credential store. If they differ, add a case.
3. **`supportsVerify`.** Say `false` unless the gateway really has a
   credential-check call. `smscountry` and `ozeki` say false because the only way
   to learn whether their login works is to send a message, and a "verify" that
   always passes is worse than none.

**Tests to touch:** `service/provider/ProviderCatalogTest` (the type appears,
required credentials are enforced, the identifier round-trips through
`typeFromIdentifier`) and `web/controllers/ProviderCatalogControllerTest` (the
catalog endpoint serves it).

### Tier 2 — Novu does not support it, but it speaks JSON (worked example: Ozeki)

Novu ships a `generic-sms` provider that POSTs a JSON body and reads the response
through configured dot-paths. That is enough for any gateway with a sane JSON API,
and it still needs **no transport code** — only a credential mapping.

Ozeki is the shipped example. Its catalog entry declares
`transport: "novu-generic-sms"` and `novuProviderId: "generic-sms"`, and
`ProviderCatalog.ozekiCredentials` does the mapping:

| Novu credential | What it carries | Why |
|---|---|---|
| `baseUrl` | the gateway's own URL | `generic-sms` POSTs here **verbatim** — it appends no path, so a query string survives |
| `apiKey` + `apiKeyRequestHeader` | username, and the header NAME to send it under | `generic-sms` sends credentials as headers: `{[apiKeyRequestHeader]: apiKey}` |
| `secretKey` + `secretKeyRequestHeader` | password, likewise | |
| `from` | sender id | `generic-sms` puts it in the body as both `from` and `sender` |
| `idPath`, `datePath` | dot-paths into the reply | Novu reads the correlation id with a bare `reduce`. Wrong paths cost observability, not delivery |

The body Novu sends is `{to, from, content, id, customData, sender}`. Anything the
gateway needs that is **not** a secret and has no credential slot can ride as a
query parameter on `baseUrl` — that is exactly what `ADAPTER_PARAM_API_URL` does
for SMSCountry.

**Tests to touch:** `ProviderCatalogTest` — assert the credential map, key by key.
That mapping is the entire integration; if it is wrong, every send fails at the
gateway with no local symptom.

### Tier 3 — the gateway does not speak JSON (worked example: SMSCountry)

Some gateways cannot be driven by any Novu provider. SMSCountry's legacy bulk API
takes form-encoded parameters, answers in plain text (`OK:<jobid>`), and returns
**HTTP 200 for everything** — a malformed request comes back 200 carrying an
ASP.NET stack trace.

The shape of the answer: an `smscountry` provider is really a Novu `generic-sms`
integration pointed at **this service**, and `novu-bridge` wears the JSON face the
gateway cannot.

```
Novu worker ──POST JSON──► novu-bridge adapter ──form POST──► SMSCountry
                                    │
                            translates the plain-text
                            reply into JSON + a real
                            HTTP status code
```

What to write, in order:

1. **A client** — `service/SmsCountryClient` is the model: build the gateway's
   native request, parse its native reply, and return a `NovuClient.NovuResponse`.
   Keep every gateway quirk here. Mask recipients in logs (`PiiMask`), never log
   credentials.
2. **An adapter controller** — `web/controllers/SmsCountryAdapterController`,
   under `/novu-adapter/v1/gateways/<gateway>/send`. Four rules, each learned the
   hard way:
   - **The credential headers ARE the authentication.** Novu holds no DIGIT token,
     so this path is excluded from `ProxyAuthFilter`. Refuse before touching the
     gateway, and say only which header is missing — never what was sent.
   - **A success must answer a non-empty `id`.** Novu's worker marks the step
     failed unless `result.id` is truthy.
   - **A rejection must answer non-2xx.** Axios throws inside `generic-sms` and the
     worker records `PROVIDER_ERROR`. A 200 with an error body reads as a
     successful send to everything downstream — that is the phantom-`SENT` this
     whole design avoids.
   - **Sanitize any URL that arrives as a parameter.** It decides where this
     service posts a live credential. Only an absolute `http(s)` URL is honoured;
     anything else falls back to the configured default.
3. **Credential mapping** — as Tier 2, but `baseUrl` points at **your adapter**,
   not the gateway, and the gateway's own URL rides as a query parameter. The URL
   must be reachable **from the Novu worker**, so it is an in-cluster address
   (`novu.bridge.smscountry.adapter.url`, default
   `http://novu-bridge:8080/novu-bridge/novu-adapter/v1/gateways/smscountry/send`),
   never the public gateway.
4. **Gateway routing.** `/novu-bridge/novu-adapter/v1/gateways/**` is deliberately
   unreachable from outside, and blocked three redundant ways: it is absent from
   Kong's auth-optional list, a Kong route terminates it with 404 before anything
   is proxied, and that route's upstream is a dead address. Keep it that way — the
   request carries provider credentials in headers. Do **not** add a route for it.
5. **A receipt shape**, if the gateway sends delivery reports — see
   [Delivery receipts](#delivery-receipts-optional-but-do-it) below.

**Tests to touch:** `service/SmsCountryClientTest` (every reply shape the gateway
really produces — the OK case, an error string, an HTML error page, an empty
body), `web/controllers/SmsCountryAdapterControllerTest` (missing headers → 401,
missing recipient → 400, gateway rejection → 502 not 200, success → non-empty
`id`), `ProviderCatalogTest` for the mapping.

#### Is a `DeliveryProvider` ever the answer?

`service/delivery/DeliveryProvider` is the seam for a transport that bypasses Novu
entirely (`SmsCountryDeliveryProvider` is the one implementation, kept for the
pre-catalog `novu.bridge.sms.provider=smscountry` route). **Prefer the adapter.**
A `DeliveryProvider` gives up Novu's credential store, its activity log and the
Configurator's provider management, and it has to be selected by configuration
rather than chosen by an operator. Reach for it only when the gateway cannot be
driven by an HTTP POST at all.

#### Delivery receipts (optional, but do it)

Without a receipt a row stops at `SENT` and nobody ever learns whether the message
arrived. `service/receipts/ReceiptParser` is tolerant by design — it looks for a
correlation id and an outcome word anywhere in the payload — so a new gateway
usually needs **nothing** beyond a route for `/novu-adapter/v1/receipts/<gateway>`
and the shared secret. Add key names to `ID_KEYS` / `REF_KEYS` / `STATUS_KEYS`
only if the gateway invents new ones, and extend `mapStatus` only for an outcome
word the substring rules miss. Cover it in `ReceiptParserTest` with the gateway's
real payload, not an idealised one.

---

## 3. Swapping the DIGIT half

The resolution stage is module-neutral **and** platform-neutral. Four interfaces
separate "what notifications mean" from "where this product keeps its people".

```
org.egov.novubridge.service.resolution/          module-neutral. No DIGIT imports.
  NotificationResolver         the fan-out loop
  TemplateRenderer             template lookup + {token} substitution
  PlaceholderResolver          data / localized / dataByLocale, once per event
  AudienceRef                  scheme parsing
  RecipientResolver  (SPI 1)   ─┐
  LocaleProvider     (SPI 2)    │  the four seams
  LocalizationProvider (SPI 3)  │
  UserHydrator       (SPI 4)   ─┘
  ActorRecipientResolver       built-in, no I/O
  EventRecipientsResolver      built-in, no I/O
  config/NotificationConfigRepository   where the four masters come from

org.egov.novubridge.service.resolution.digit/    DIGIT adapters. Every egov client lives here.
  MdmsNotificationConfigRepository   the masters, from MDMS v2
  DigitRoleRecipientResolver         egov-user search by roleCodes
  DigitUserHydrator                  egov-user search by uuid
  DigitLocaleProvider                digit-user-preferences-service
  DigitLocalizationProvider          egov-localization
  LegacyMasterAdapter                reads a RAINMAKER-PGR.* row in the new shape
```

### The four interfaces

```java
/** SPI 1 of 4. Turns one audience reference into the people it names. */
public interface RecipientResolver {
    String scheme();                                            // "ACTOR", "ROLE", "EVENT_RECIPIENTS", …
    List<Recipient> resolve(AudienceRef ref, ResolutionContext ctx);
}

/** SPI 2 of 4. Which language each person wants to be written to in. */
public interface LocaleProvider {
    Map<String, String> preferredLocales(String tenantId, RequestInfo requestInfo);
}

/** SPI 3 of 4. Localization code to message. */
public interface LocalizationProvider {
    String message(String tenantId, String locale, List<String> modules, String code, RequestInfo requestInfo);
}

/** SPI 4 of 4. A uuid to a contactable person. */
public interface UserHydrator {
    Recipient hydrate(String userId, String type, String tenantId, RequestInfo requestInfo);
}
```

`Recipient` is `(userId, type, name, phone, email, locale)` with
`subscriberKey()` (`userId`, falling back to `phone`) and `reachableOn(channel)`.

The contracts are as important as the signatures:

- `RecipientResolver.resolve` is **never null**, and an **empty list is a
  legitimate answer** — it produces a `SKIPPED` row. Throw only for a genuine
  failure (the directory is unreachable); the caller logs it and treats the
  audience as having yielded nothing, without poisoning its memo.
- `LocaleProvider.preferredLocales` returns an **empty map** when it cannot reach
  its source. A preference service being down must not stop a notification; it
  must only stop it being translated.
- `LocalizationProvider.message` returns **null** when no module has the code —
  and null is the answer, not an error, so the next code in the ladder is tried
  and an outage degrades to the producer's raw value rather than a blank.
- `UserHydrator.hydrate` returns **null** rather than throwing, and only runs when
  the producer supplied a `userId` and **no contact fields at all**.

### Supplying your own

Every DIGIT bean is `@ConditionalOnMissingBean` **on its interface**. Define your
own `LocaleProvider` and the DIGIT one steps aside; nothing else changes. Resolvers
are a collection rather than a single bean, so the DIGIT role resolver is
conditioned on its own concrete type — define a `RecipientResolver` whose
`scheme()` is `"ROLE"` (or `"GROUP"`, if that is what your configuration says) and
yours is the one registered for that scheme.

A product that puts contacts on the event needs **no resolver code at all**:
`ActorRecipientResolver` and `EventRecipientsResolver` do no I/O and ship in the
core package. You need one only if you want role-pool expansion against your own
directory.

Routing, templates, fan-out, dedupe, gating, the ledger and the provider catalog
are untouched by any of this.

### The package boundary is enforced, not asserted

`ResolutionPackageIsolationTest` fails the build if anything under
`service.resolution` outside `.digit` imports an egov client. That is what keeps
the seam real rather than aspirational.

`StaticRecipientResolverTest` runs the whole resolution stage with a hand-written
resolver and no DIGIT services reachable, and asserts a full envelope set comes
out. If that test were hard to write, the seam would be fake — so it is the test
to read first if you are porting this somewhere else.

### Where the configuration comes from

`NotificationConfigRepository` is the one interface behind all four masters:

```java
List<RoutingRow>          routing(String tenantId);
List<TemplateRow>         templates(String tenantId);
List<ProviderTemplateRow> providerTemplates(String tenantId);
List<CatalogueRow>        catalogue(String tenantId);
ConfigSourceReport        describe(String tenantId);
```

The DIGIT implementation reads MDMS v2 at the **state root**, pages
(`novu.bridge.notifications.page.size` × `.max.pages`), caches for
`novu.bridge.notifications.cache.ttl.ms`, **never caches an empty result**, and
serves a stale non-empty entry through an MDMS outage.

It also carries the upgrade path: a tenant with **zero** `NOTIFICATIONS.Routing`
rows is served its legacy `RAINMAKER-PGR.Notification*` rows through
`LegacyMasterAdapter`, converted on the way in. The decision is **per tenant,
cross-master, all-or-nothing** — never per row, because per-row precedence between
two namespaces is the kind of thing nobody can reason about at 2am. There is no
setting; `describe` (and `GET /novu-adapter/v1/config/source`) reports which
namespace answered, which is how an operator sees it.

### Adapting a format you do not control

Sometimes the producer is a service you cannot change — a DIGIT core image
publishing its own message shape. The pattern is a **translator keyed on the
topic**, not a shape-sniffing branch in the consumer.

`service/core/CoreSmsTranslator` is the worked example. DIGIT core publishes an
`SMSRequest` to `egov.core.notification.sms` for login OTPs and password resets;
the translator turns it into a v1 envelope with `eventType: CORE_SMS` and hands it
to the same pipeline as everything else, so it gets the same gates, the same
provider selection and the same ledger row. Worth copying:

- **The topic is the contract.** It is why this can live in its own class instead
  of as a branch in the pipeline — the pipeline stays module-neutral.
- **Be tolerant about field names, strict about the essentials.** Core images
  disagree on `mobileNumber`/`mobile`/`phone`, so the translator accepts all of
  them; anything without a phone and a message is `NB_INVALID_CORE_SMS`.
- **Fill in what the foreign format lacks.** No tenant? Use a configured default.
  No E.164? Prepend a configured country code. No idempotency key? Mint one that
  makes each send its own row.
- **Translation failures DLQ without a ledger row** — there is no envelope yet to
  write one for. Say so in the runbook so nobody hunts for a row that cannot
  exist.

Wire it with a `@KafkaListener` on its own topic property, `@ConditionalOnProperty`
so a deployment can switch it off, and hand the result to
`DomainEventConsumer.handle(event, topic)` — never straight to the pipeline, or you
lose the DLQ.

A foreign format whose recipients *are* configurable is a candidate for a thin
event with the `EVENT_RECIPIENTS` audience instead — see
[`examples/thin/04-contact-override.json`](./contract/examples/thin/04-contact-override.json).

**Tests to touch:** a translator test (every field-name variant the real producer
emits, plus the refusal cases) and a consumer wiring test (translation failure
DLQs; success reaches the pipeline). `CoreSmsTranslatorTest` and
`CoreSmsConsumerTest` are the models.

---

## 4. Local testing without real credentials

You do not need a Twilio account, an SMS gateway or a mailbox to exercise the
whole path. Both techniques below were used on this project.

### An HTTP mock for an SMS gateway

Stand up any small HTTP server on the compose network that answers what the
gateway would, then point the provider at it — for a Tier 2 provider set `baseUrl`
to the mock, for Tier 3 set the adapter's upstream URL parameter.

What makes a mock useful rather than reassuring:

- **Answer in the gateway's real format**, including its wrong-looking parts.
  SMSCountry's plain-text `OK:<jobid>` with HTTP 200 on failure is the whole
  reason its adapter exists; a mock that returns tidy JSON would test nothing.
- **Make it fail on demand.** A recipient or a keyword that triggers a rejection
  is what lets you see a `FAILED` row and confirm the message is honest.
- **Log what it received.** This is how you verify the credential headers and
  sender id actually arrive — the one thing that silently breaks a provider
  integration.
- Reachability is from the **Novu worker**, not from your laptop: use the compose
  service name.

### A local SMTP sink for email

Run a catch-all SMTP server with a web inbox (Mailpit is the one used here) on the
compose network, and register it as the email provider from the Configurator like
any other: type **Email (SMTP)**, host = the service name, port = its SMTP port,
any username and password, **Use TLS on connect** unticked. Mail is accepted,
never forwarded, and appears in its web UI.

This exercises the genuine path — a real Novu `nodemailer` integration, a real
SMTP conversation, a real `SENT` row — with no mailbox and no risk of mailing a
real person. Two gotchas: Novu's `nodemailer` credential store is a **string**
map, so the port must be sent as text, not a number; and it requires `senderName`
alongside `from`.

### Either way

- Use **Test** on the Providers screen for a single round trip; it writes one
  `is_test` row at your tenant so you can see the result on the Logs screen.
- Use `POST /dispatch/_resolve` to see what a thin event **would** produce without
  sending anything or writing a row.
- Use `POST /dispatch/_dry-run` with `send: true` to push one envelope down the
  **full** live path — gates, consent, provider selection, ledger — which
  test-send deliberately bypasses.
- Nothing above needs a change to the bridge. If a local test needs production
  code to behave differently, that is a smell: the seam you want is probably a
  provider or an SPI, not a flag.

---

## 5. Testing your integration

### The golden-master approach, and how to copy it

Moving PGR's notification logic into the box was a refactor of something live,
which means "the tests pass" had to mean "the messages did not change". The
pattern that made that checkable is worth reusing whenever you change a producer.

1. **Record what is published today, verbatim.** One shared input matrix
   (`backend/pgr-services/src/test/resources/golden/inputs/scenarios.json`, 26
   scenarios) and two generated fixtures, one per side of the move:
   `golden-envelopes.json` — the 57 pre-rendered envelopes PGR published *before*
   the cutover, now frozen as the bridge's acceptance criterion — and
   `golden-thin-events.json` — the 26 thin events it publishes *after*. Both are
   compared field for field, including `transactionId`, `renderedBody`,
   `subject`, `templateKey`, `contentVariables` and the whole contact block. Only
   two fields are normalised (a random uuid and a wall clock), and each is
   shape-checked before being replaced.
2. **Cover the shapes that break, not the happy path.** The 26 scenarios include
   both locales, a role pool with a holder who has no uuid, a localization
   outage, a URL-shortener outage, an unapproved WhatsApp template and an email
   with no subject.
3. **Never regenerate to make a red test green.** A failure means the observable
   contract changed: a different body, a different transaction id, a recipient
   gained or lost. Regenerate only when the change is intended, and say so in the
   commit message.
4. **Write the intended differences down as data, not as a judgement call.**
   `ThinEventParityTest.INTENDED_DIFFERENCES` is a table of
   `(scenario, field, old, new, reason)` applied to the expected value before
   comparison. Anything else that differs is a failure. That is the property worth
   having: *"we changed only what we said we would"* becomes checkable, and "the
   test passes" stops meaning "someone decided the difference was fine".
5. **Do not stub the parts most likely to regress.** The parity test runs the real
   legacy adapter, the real renderer, the real role-pool resolver with its paging
   and its uuid-less handling, the real placeholder resolver and the real fan-out
   loop. Only four network seams are in-memory. A test that stubbed the resolvers
   would prove the loop and nothing about role-pool ordering or the legacy
   audience join.
6. **Assert emission order.** The order the producer was called in — routing-row
   order crossed with recipient order — is a real observable, and a port must not
   reorder it silently.

7. **Write the expectation independently of the code that satisfies it.** The
   thin-event fixture is *generated* from the real producer and then *checked*
   against a restatement of what the bridge expects, written from the bridge's
   side. Generate-and-commit alone would only record whatever the producer
   happens to do.

To copy this for your module: record your producer's output before you change it,
build the thin event your producer *will* emit, POST it to `/dispatch/_resolve`
against the same configuration, and diff the two lists.

### The other tests worth knowing about

| Test | What it would catch |
|---|---|
| `ThinEventContractSchemaTest` | A field on `ThinEvent` that is not in the published schema; the schema's `required` set drifting from what `ThinEventValidator` enforces, in either direction; a published example that stopped validating |
| `EnvelopeV1FrozenTest` | Any edit at all to `envelope-v1.schema.json` — it holds a hash, so changing the pre-rendered contract is a deliberate two-file act |
| `ContractResourceSyncTest` | `docs/2.12/notifications/contract/` drifting from the copy packaged in the jar. **Edit both, or the build says so** |
| `ErrorCodeCatalogTest` | An `NB_*` code introduced in the main source and never documented, or documented and never introduced |
| `ResolutionPackageIsolationTest` | A DIGIT client imported into the module-neutral resolution package |
| `LegacyMasterAdapterConversionTest` | The Java read adapter and `notifications_convert.py` disagreeing about how a legacy row converts |
| `NotificationResolverEdgeCasesTest` | The fan-out semantics above — dedupe keys, the cap, unmemoized failures |
| `defaultSeeds.test.ts` (configurator) | The shipped seed data failing its own validator |
| `generate_event_catalogue.py --check` | The shipped PGR catalogue drifting from the workflow it is generated from |
| `notifications_convert.py --check` | The shipped `NOTIFICATIONS.*` defaults drifting from the legacy seed they are converted from |

---

## See also

- [`contract/`](./contract/README.md) — the published interface and how it is kept honest
- [setup-guide.md](./setup-guide.md) — what an operator does with what you ship
- [operator-guide.md](./operator-guide.md) — what an operator can change without you
- [message-templates.md](./message-templates.md) — the message text and its validation rules
- [README.md](./README.md) — the deployment runbook
