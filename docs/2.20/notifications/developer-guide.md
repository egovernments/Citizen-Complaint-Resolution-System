# Developer guide

For developers connecting a module to notifications or changing novu-bridge. Related:
[kafka-events.md](./kafka-events.md) (topics, publishing, verifying),
[providers.md](./providers.md) (adapters, adding a provider), [contract/](./contract/README.md)
(schemas, OpenAPI, error codes, outputs).

## The two inbound kinds

| | Thin event (`kind: "THIN"`) | Pre-rendered envelope (`kind` absent or `"RENDERED"`) |
|---|---|---|
| Producer says | "this happened to this entity" | "send this text to this person on this channel" |
| Messages per business event | one | one per recipient × channel |
| Recipients, language, wording | decided by novu-bridge from `NOTIFICATIONS.*` config — operators can change them | decided by the producer |
| Schema | [thin-event-v1.schema.json](./contract/thin-event-v1.schema.json) | [envelope-v1.schema.json](./contract/envelope-v1.schema.json) |

**Use the thin event.** Keep the envelope (a permanent, non-deprecated interface) for producers
you cannot change, single-recipient messages with no configurable audience, and translated
foreign formats ([below](#adapting-a-format-you-do-not-control)). Both kinds share topics,
gates and the dispatch log.

## Plug a module in

Example: a trade-licence module with no notification code
([examples/thin/03-module-neutral.json](./contract/examples/thin/03-module-neutral.json)).

### 1. Declare events in `NOTIFICATIONS.EventCatalogue`

One row per event. The Configurator builds its pickers and validates templates from it.

| Field | Meaning |
|---|---|
| `module` | Owner, e.g. `XYZ` (required) |
| `eventName` | Key: dotted, module-prefixed, unique (required). Encode the outcome, not just the action — two outcomes needing different words need two names |
| `label` | Picker label (required) |
| `entityType` | What `entityId` names |
| `actors` | `[{name, label, required}]` — actor names your events carry (`ACTOR:<name>`) |
| `placeholders` | `[{name, label, blankWhen}]` — token names without braces |
| `channels` | Allowed channels; absent = any |
| `active` | Absent = true |

```json
{ "module": "XYZ", "eventName": "XYZ.LICENCE.RENEWED", "entityType": "LICENCE",
  "label": "Licence renewed",
  "actors": [{ "name": "holder", "label": "Licence holder", "required": true }],
  "placeholders": [{ "name": "licence_no", "label": "Licence number" },
                   { "name": "valid_until", "label": "Valid until" }],
  "channels": ["SMS", "EMAIL"], "active": true }
```

An uncatalogued `eventName` is `REJECTED / NB_EVENT_NOT_IN_CATALOGUE` and DLQ'd, except on a
tenant with no catalogue rows at all. PGR's rows are generated from its workflow by
`local-setup/scripts/generate_event_catalogue.py` (`--check` after changing the workflow).

### 2. Ship default routing and templates

Per tenant, at the state root, owned by operators after seeding.

```json
{ "module": "XYZ", "eventName": "XYZ.LICENCE.RENEWED", "audience": "ACTOR:holder", "channel": "SMS", "active": true }
{ "module": "XYZ", "eventName": "XYZ.LICENCE.RENEWED", "audience": "ACTOR:holder", "channel": "SMS",
  "locale": "en_IN", "subject": null,
  "body": "Licence {licence_no} is renewed until {valid_until}.", "active": true }
```

`NOTIFICATIONS.Routing` is unique on `(eventName, audience, channel)`; `NOTIFICATIONS.Template`
on `(eventName, audience, channel, locale)`. Every routing row needs a template in
`novu.bridge.default.locale` (`en_IN`). WhatsApp also needs `NOTIFICATIONS.ProviderTemplate`,
unique on `(provider, channel, eventName, audience, locale)`, with the approved `templateId` and
ordered `variables`. Shipped defaults live in
`utilities/default-data-handler/src/main/resources/mdmsData-dev/NOTIFICATIONS/`.

### 3. Publish the event

To `notifications.events` (or your own topic — [kafka-events.md](./kafka-events.md)), and add
your `eventType` to `NOVU_BRIDGE_EVENT_TYPES`.

| Required | |
|---|---|
| `kind` | `"THIN"` |
| `eventId` | uuid of the domain event |
| `eventType` | your producer constant (allowlisted) |
| `module`, `eventName`, `tenantId` | as catalogued |

| Optional | |
|---|---|
| `entityId`, `entityType` | Your handle; becomes `reference_number` on the Logs screen — send it |
| `transactionSeed` | Idempotency seed (below) |
| `actors` | `{name: {userId, type, name, phone, email, locale}}` |
| `recipients` | `[actorRef]` for account-less flows (audience `EVENT_RECIPIENTS`) |
| `data` | token → literal value |
| `localized` | token → localization code, or ordered list of codes |
| `localizationModules`, `localizationLocale` | modules to search in order; the one locale codes are resolved in |
| `dataByLocale` | `{locale: {token: value}}` for values that cannot be codes |
| `ledgerEventName` | name written to the dispatch log if it must differ from `eventName` |
| `payload` | your block, copied to each resolved envelope's `data` |
| `schemaVersion`, `eventTime`, `producer` | as the envelope |

Do not send `channel`, `subscriberId`, `renderedBody`, `subject`, `templateKey`, `templateId` or
`contentVariables`; the bridge produces them.

**Contacts.** For a recipient with an account send only `userId` (and `type`); the bridge
hydrates name, phone and email from egov-user, so no contact data goes on Kafka. Send contact
fields only for account-less recipients.

**Idempotency.** The dispatch log's unique key is `(transaction_id, channel, recipient_value)`
and writes are upserts. The bridge sets `transactionId = <transactionSeed>:<subscriberId>:<channel>`
(`<seed>:NONE` on channel-less rows), and never re-sends a `transactionId` that is already
`SENT` or `DELIVERED`. So the seed must be **one per occurrence**: identical when that occurrence
is redelivered or replayed from the DLQ, different for every new one — including a repeat of the
same kind on the same entity (a second `ASSIGN` into the same state, next year's renewal). A seed
built only from the entity and the kind of event silently drops every repeat. PGR sends
`<serviceRequestId>:<action>:<toState>:<workflow ProcessInstance id>`, falling back to
`auditDetails.lastModifiedTime` for the last part; with neither it omits the seed. Absent, the
seed is `<eventId>`, so keep `eventId` stable when you retry one occurrence. The skip is
check-then-act: two copies of one message arriving at the same moment can both be sent.

**Localization.** Per token the bridge tries each code in `localized[token]`, then
`dataByLocale[locale][token]`, then `data[token]`; with none, the token is left as `{token}`.
Values are resolved once per event in `localizationLocale` (else the default locale); template
text is chosen per recipient. Send both a literal and a code where you can, so a localization
outage degrades to the literal.

### 4. Dry-run, then watch it land

- `POST /novu-bridge/novu-adapter/v1/dispatch/_resolve` with `{"RequestInfo": …, "event": …}`
  runs the real resolver against the tenant's real configuration and returns `envelopes`
  (fully rendered), `terminalCode` (`NB_NO_ROUTING`, `NB_NO_RECIPIENTS`,
  `NB_UNKNOWN_AUDIENCE_SCHEME`, `NB_RECIPIENT_LIMIT_EXCEEDED`) and `diagnostics`. Nothing is sent
  or written. Admin tier (`NB_ADMIN_ROLE_REQUIRED` otherwise) because it returns role holders'
  contacts.
- Then publish and check the Logs screen / `GET …/logs?referenceNumber=…`; `source_path` is
  `RESOLVED` for thin events. Where things land:

| Outcome | Result |
|---|---|
| No routing, no recipients, no template, unknown audience scheme, fan-out over the cap | `SKIPPED` row, never DLQ'd |
| Malformed or uncatalogued event, unknown `eventType` | `REJECTED` row **and** DLQ message |
| Transport failure | `FAILED` row; DLQ message if it threw |

A configuration decision never throws — keep that rule when extending the resolver. Statuses
and columns: [contract/outputs.md](./contract/outputs.md); codes:
[contract/error-codes.md](./contract/error-codes.md).

## How audiences resolve

| Form | Resolved by | I/O |
|---|---|---|
| `ACTOR:<name>` | the event's `actors` | none |
| `ROLE:<code>` | every holder of the role in the tenant (paged egov-user search as `NOVU_BRIDGE_INTERNAL_USER_UUID`, up to `NOVU_BRIDGE_ROLE_POOL_PAGE_SIZE` × `NOVU_BRIDGE_ROLE_POOL_MAX_PAGES` = 100 × 10) | directory search |
| `EVENT_RECIPIENTS` | the event's `recipients` | none |
| `A\|B` | first link that yields anyone | as its links |

Legacy bare names: `CITIZEN` → `ACTOR:citizen`, `EMPLOYEE` → `ACTOR:assignee`,
`AUTO_ESCALATE` / `SYSTEM` → dropped, anything else → `ROLE:<it>`. An unknown scheme is
`SKIPPED / NB_UNKNOWN_AUDIENCE_SCHEME`, never guessed.

- Dedupe is per `(channel, subscriberKey)`, not per audience, and a key is consumed only after a
  successful hand-off.
- A failed audience resolution is not memoized.
- Over `novu.bridge.notifications.recipient.cap` (1000) the **whole** event is
  `SKIPPED / NB_RECIPIENT_LIMIT_EXCEEDED`.

## pgr-services as the reference producer

`backend/pgr-services/src/main/java/org/egov/pgr/service/notification/ThinEventBuilder.java` publishes one thin event
per transition to `complaints.domain.events`. PGR keeps only what the bridge cannot know:
that a transition happened; the assignee (live, else last `ASSIGN` in workflow history, sent as
`actors.assignee` uuid); the thirteen placeholder values including the HRMS department /
designation join; and which localization codes apply. Worked examples:
[contract/examples/thin/](./contract/examples/thin/).

## Swapping the DIGIT seams

`org.egov.novubridge.service.resolution` is module- and platform-neutral; every DIGIT client is
in `service.resolution.digit`. Keep it so: nothing outside `.digit` may import an egov client.

| Interface | Contract | DIGIT implementation |
|---|---|---|
| `RecipientResolver` — `scheme()`, `resolve(AudienceRef, ResolutionContext)` | Never null; empty list is a valid answer (→ `SKIPPED`); throw only on a real failure | `DigitRoleRecipientResolver` (`ROLE`); built-in `ActorRecipientResolver`, `EventRecipientsResolver` |
| `LocaleProvider` — `preferredLocales(tenantId, requestInfo)` | Empty map when the source is unreachable | `DigitLocaleProvider` (digit-user-preferences-service) |
| `LocalizationProvider` — `message(tenantId, locale, modules, code, requestInfo)` | `null` when no module has the code (next code is tried) | `DigitLocalizationProvider` (egov-localization) |
| `UserHydrator` — `hydrate(userId, type, tenantId, requestInfo)` | `null` rather than throw; called only for a `userId` with no contact fields | `DigitUserHydrator` (egov-user) |
| `NotificationConfigRepository` — `routing`, `templates`, `providerTemplates`, `catalogue`, `describe` | — | `MdmsNotificationConfigRepository` (MDMS v2 at the state root; paged; cached `NOVU_BRIDGE_NOTIFICATIONS_CACHE_TTL_MS`; empty results never cached; stale entries served through an MDMS outage; legacy fallback via `LegacyMasterAdapter`) |

Each DIGIT bean is `@ConditionalOnMissingBean` on its interface: define your own bean and the
DIGIT one steps aside. For `RecipientResolver`, register one whose `scheme()` matches (e.g.
`"ROLE"`). A product that puts contacts on the event needs no resolver code.

## Adapting a format you do not control

Use a translator bound to the topic, not shape-sniffing in the consumer. Model:
`service/core/CoreSmsTranslator` + `consumer/CoreSmsConsumer`, which turn DIGIT core's
`SMSRequest` on `egov.core.notification.sms` into a `CORE_SMS` envelope:

- accept every field-name variant the real producer emits (`mobileNumber`/`mobile`/`phone`/`to`,
  `message`/`body`/`text`, `tenantId`/`tenant`); refuse without phone or text
  (`NB_INVALID_CORE_SMS`);
- fill gaps from configuration (`NOVU_BRIDGE_CORE_SMS_DEFAULT_TENANT`,
  `NOVU_BRIDGE_CORE_SMS_COUNTRY_CODE`) and mint a unique `transactionId` per send;
- drop what is no longer worth sending: an OTP (`category` `OTP`) whose `expiryTime` (epoch
  milliseconds) has passed is logged at INFO — without phone or text — and gets no dispatch-log
  row and no DLQ message;
- a translation failure is DLQ'd with no dispatch-log row;
- the listener starts at the **latest** offset when its group has no committed offset (the
  domain-event listeners start at `earliest`): replaying days of queued OTPs is worse than
  missing them;
- wire a `@KafkaListener` on its own topic property, `@ConditionalOnProperty` so it can be
  switched off, and pass the result to `DomainEventConsumer.handle(event, topic)` (not straight
  to the pipeline, or the DLQ is lost).

If the foreign format's recipients should be configurable, emit a thin event with
`EVENT_RECIPIENTS` instead ([examples/thin/04-contact-override.json](./contract/examples/thin/04-contact-override.json)).

## Local testing without real gateways

- **SMS:** run a small HTTP mock on the compose network that answers in the gateway's real
  format (including its failure shapes) and logs what it received; point an Ozeki-type
  provider's HTTP API URL, or an SMSCountry provider's Gateway URL, at it by service name.
- **Email:** run an SMTP sink with a web inbox (e.g. Mailpit) on the compose network and add it
  as an Email (SMTP) provider: host = service name, its SMTP port, any user/password, **Use TLS
  on connect** unticked. Or use Ethereal ([setup-guide.md §8.5](./setup-guide.md#85-testing-email-without-a-real-mailbox)).
- **Test** on the Providers screen exercises one provider; `_resolve` shows what a thin event
  would produce; `POST /novu-bridge/novu-adapter/v1/dispatch/_dry-run` with `"send": true`
  pushes one envelope through the full pipeline (container network only — not routed by Kong).
- To check that a producer change changed no message, resolve the old and new events for the
  same flows with `_resolve` and diff the envelopes.
- After editing the legacy seed or the PGR workflow, run
  `local-setup/scripts/generate_event_catalogue.py --check` and
  `local-setup/scripts/notifications_convert.py --check`.
