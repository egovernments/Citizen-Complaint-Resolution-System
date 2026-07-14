# 2. novu-bridge — the pass-through delivery + tracking layer

novu-bridge is a Spring Boot service (`org.egov.novubridge`, servlet context
`/novu-bridge`, listens on `:8080`). It has two surfaces:

1. a **Kafka consumer** that delivers pre-rendered events, and
2. a **proxy REST API** the configurator SPA calls to observe and self-service the
   notification stack.

It holds exactly one secret the SPA never sees — the **Novu ApiKey** — and is the only
thing that talks to Novu.

## 2.1 The consumer + dispatch pipeline

`DomainEventConsumer.listen` (`backend/novu-bridge/.../consumer/DomainEventConsumer.java:37-49`)
listens on `novu.bridge.kafka.input.topic` (`complaints.domain.events`) **and** the
retry topic, converts the record to a `ComplaintsDomainEvent`, and calls
`DispatchPipelineService.process(event, true, null)`. Any `CustomException` or other
exception is logged and DLQ'd (`:42-48`).

`DispatchPipelineService.process` (`backend/novu-bridge/.../service/DispatchPipelineService.java:58-188`)
runs a fixed sequence of gates. Each gate either short-circuits with a persisted
terminal row or falls through to the next:

| Step | What it does | Outcome on failure | Code |
|------|--------------|--------------------|------|
| 1. **Validate envelope** | `EnvelopeValidator.validate` — required fields present | throws `NB_INVALID_EVENT` (→ DLQ) | `:62`, `EnvelopeValidator.java:11-48` |
| 2. **Derive context + subscriberId** | flatten the pre-rendered event; require a subscriberId | throws `NB_SUBSCRIBER_ID_MISSING` | `:64-72`, `deriveContext :260-307` |
| 3. **Preference gate** | `PreferenceServiceClient.isChannelAllowed` | persist `SKIPPED / NB_PREFERENCE_DENIED` | `:80-92` |
| 4. **send=false short-circuit** | validate-only / dry-run mode | persist `RECEIVED`, return | `:94-103` |
| 5. **Channel-known gate** | must be SMS/WHATSAPP/EMAIL — never guess | persist `SKIPPED / NB_UNSUPPORTED_CHANNEL` | `:106-115` |
| 6. **Channel-enabled gate** | `config.isChannelEnabled(channel)` (`novu.bridge.channels.enabled`) | persist `SKIPPED / NB_NO_PROVIDER` | `:116-125` |
| 7. **Contact gate** | EMAIL needs email; SMS/WHATSAPP need phone (bridge-side defense) | persist `SKIPPED / NB_CONTACT_MISSING` | `:129-145` |
| 8. **Identify + trigger** | `NovuClient.identifyThenTrigger` → Novu | on `CustomException`: persist `FAILED / <code>` + rethrow (→ DLQ); other: `FAILED / NB_DELIVERY_ERROR` | `:147-159` |
| 9. **Status check** | Novu HTTP 2xx? | non-2xx: persist `FAILED / NB_NOVU_TRIGGER_FAILED` (no rethrow) | `:161-172` |
| 10. **Success** | | persist `SENT` | `:177-188` |

Two independent gates (6 vs 7) matter: **channel-enabled** is a deployment policy (is
there a provider for this channel at all?), **contact** is a per-recipient data check.
Both persist a distinct code so the log tells you *why* nothing was sent. The bridge
re-checks contact even though PGR already filtered on emission, because it consumes a
shared topic and must defend independently — a phone-only recipient on an EMAIL row
would otherwise "phantom-SENT" with no address (`:129-133`).

### Terminal statuses & `NB_*` code reference

| Status | `lastErrorCode` | Meaning |
|--------|-----------------|---------|
| `SENT` | — | Novu accepted the trigger (HTTP 2xx). |
| `RECEIVED` | — | Validation-only (`send=false`) — dry-run, not delivered. |
| `SKIPPED` | `NB_PREFERENCE_DENIED` | Recipient's channel consent not GRANTED (only when preference gate is ON). |
| `SKIPPED` | `NB_UNSUPPORTED_CHANNEL` | Channel is null/unknown. |
| `SKIPPED` | `NB_NO_PROVIDER` | Channel known but not in `novu.bridge.channels.enabled` (e.g. WHATSAPP on bomet). |
| `SKIPPED` | `NB_CONTACT_MISSING` | Recipient lacks the email/phone the channel needs. |
| `FAILED` | `NB_NOVU_TRIGGER_FAILED` | Novu returned non-2xx, or the trigger threw. |
| `FAILED` | `NB_DELIVERY_ERROR` | Unexpected exception during identify/trigger. |
| `FAILED` | `NB_SUBSCRIBER_ID_MISSING` | Event carried no subscriberId (bad event). |
| — (DLQ) | `NB_INVALID_EVENT` | Envelope validation failed (thrown before persist). |
| — (DLQ) | `NB_PROCESSING_ERROR` | Any other unhandled consumer exception. |

The design principle repeated throughout: **never guess, never fall back to another
channel.** An unroutable message becomes an honest, debuggable `SKIPPED` row, not a
silent SMS (`NovuBridgeConfiguration.getNovuWorkflowId` throws rather than default to
SMS, `:129-140`; `channelsEnabled` javadoc `:110-116`).

### The event envelope (`ComplaintsDomainEvent`)

`EnvelopeValidator` requires `eventId`, `eventType`, `eventName`, `tenantId` always
(`:15-26`). For a **pre-rendered** event (the normal path — detected by a non-null
`contact` or non-blank `renderedBody`, `:28`) it additionally requires `channel`,
`renderedBody`, and `subscriberId` (`:32-41`). A **legacy** coarse event (no contact/body)
must instead carry a `workflow.toState` (`:45-47`). `deriveContext` handles both shapes:
the pre-rendered branch reads the flat fields (`:262-279`); the fallback branch mines the
first `stakeholders[]` entry (`:282-306`).

### Idempotency & DLQ

- **Idempotency key** = `transactionId`
  (`serviceRequestId:action:toState:subscriberId:channel`, built in
  `NotificationService.publishRenderedEvent :1208`). Every `nb_dispatch_log` row is
  keyed/`upsert`ed by it (`persist :309-331`, `DispatchLogRepository.upsert`), so a
  Kafka redelivery updates the same row rather than double-counting. Novu also receives
  the `transactionId` on trigger (`NovuClient.trigger :169-171`), giving provider-side
  dedupe.
- **Subscriber identify** is separately idempotent + TTL-cached in-memory
  (`NovuClient.identify :77-130`, `novu.bridge.identify.cache.ttl.ms` = 5 min), and its
  failures are **non-fatal** — a missing profile only degrades tracking, not delivery
  (`:125-129`).
- **DLQ**: on any consumer exception the event + error code/message are pushed to
  `novu.bridge.kafka.dlq.topic` (`novu-bridge.dlq`) (`DomainEventConsumer.publishDlq :51-57`).
  The **retry** topic (`novu-bridge.retry`) is listened to but nothing publishes to it
  yet — reserved for future use (`NovuBridgeConfiguration.java:24-26`).

## 2.2 The proxy REST API (configurator surface)

All proxy endpoints live under `/novu-adapter/v1` and are consumed by the configurator's
four notification screens. Kong exposes them under `/novu-bridge/novu-adapter/v1/...`.

### The 7 Kong-routed endpoints

`local-setup/kong/kong.yml:384-437` — service `novu-bridge-proxy` → `http://novu-bridge:8080`,
`strip_path:false` (novu-bridge's servlet context is `/novu-bridge`):

| Route | Method | Path | Controller |
|-------|--------|------|------------|
| logs | GET | `/novu-bridge/novu-adapter/v1/logs` | `DispatchLogController` |
| integrations | GET | `/novu-bridge/novu-adapter/v1/integrations` | `IntegrationController` |
| preferences | GET | `/novu-bridge/novu-adapter/v1/preferences` | `PreferenceController` |
| providers (create) | POST | `/novu-bridge/novu-adapter/v1/providers` | `ProviderController.createProvider` |
| providers/templates | GET | `/novu-bridge/novu-adapter/v1/providers/templates` | `ProviderController.templates` |
| providers/verify | POST | `/novu-bridge/novu-adapter/v1/providers/verify` | `ProviderController.verify` |
| providers/test-send | POST | `/novu-bridge/novu-adapter/v1/providers/test-send` | `ProviderController.testSend` |

### The intentionally UNROUTED `/dispatch/*` trio

`DispatchController` (`backend/novu-bridge/.../web/controllers/DispatchController.java:20`)
exposes `POST /novu-adapter/v1/dispatch/_validate`, `/_dry-run`, `/_test-trigger`
(`:32-73`). Kong does **not** route `/dispatch/*` — the comment in `kong.yml:387-388`
says so explicitly ("*The /dispatch/\* diagnostics trio stays unrouted on purpose*").
They remain reachable in-cluster for diagnostics but are not exposed publicly. They are
still covered by `ProxyAuthFilter`'s URL pattern were they ever routed
(`ProxyAuthFilter.java:42-44`). `_validate`/`_dry-run` reuse the pipeline with
`send=false`/configurable send; `_test-trigger` is a pass-through Novu trigger whose
`contentSid`/`contentVariables` are accepted for backward-compatible request shape but
no longer used (PGR owns rendering) (`DispatchPipelineService.testTrigger :190-204`).

### Endpoint parameters

- **`GET /logs`** (`DispatchLogController.java:55-98`): `tenantId` **required**;
  optional `referenceNumber` (+`referenceNumberPrefix`), `transactionId`, `channel`,
  `status`; paged via `limit` (default 50, max 500) / `offset`. Returns
  `{data:[DispatchLogEntry], total}`, newest first. `total` is the unpaged count for the
  same filters.
- **`GET /integrations`** (`IntegrationController.java:50-63`): no params; returns the
  Novu integration list as an **allowlist projection**, `{data, total}`.
- **`GET /preferences`** (`PreferenceController.java:58-73`): `tenantId` (optional —
  blank = all tenants), `limit` (default 100), `offset` (default 0).
- **`POST /providers`**, **`GET /providers/templates`**, **`POST /providers/verify`**,
  **`POST /providers/test-send`** — see [`03-channels-providers.md`](03-channels-providers.md).

## 2.3 Authentication — `ProxyAuthFilter`

Auth happens **inside** novu-bridge, not at Kong (Kong is "a dumb router here",
`kong.yml:388-390`). `ProxyAuthFilter` (`backend/novu-bridge/.../web/filters/ProxyAuthFilter.java`)
is an `OncePerRequestFilter` that guards `/novu-adapter/v1/{logs,integrations,preferences,providers*}`
(`shouldNotFilter :62-76` — everything else, including `/dispatch/*`, is also matched by
prefix but not routed):

1. CORS `OPTIONS` preflight passes unauthenticated (`:64-67`).
2. If `novu.bridge.proxy.auth.enabled` is false → pass (local-dev escape hatch, `:82-85`).
3. Require `Authorization: Bearer <token>` (`:87-96`).
4. **Introspect** the opaque DIGIT token against egov-user
   `POST /user/_details?access_token=<token>` (`introspect :131-141`).
5. **Authorize** only if the resolved user is `type == EMPLOYEE` **and** carries at
   least one role code in `novu.bridge.proxy.allowed.roles`
   (default `EMPLOYEE,SUPERUSER,GRO,PGR_LME`) (`isAuthorized :145-166`,
   `NovuBridgeConfiguration.java:76-77`).
6. **Token cache**: a valid token is cached by **SHA-256 hash** (never the raw token)
   for 60 s so the Logs screen's polling doesn't hammer egov-user (`:49, 99-125`).

Failures return `401` (missing/invalid token) or `403` (insufficient role) as JSON
(`:168-172`).

## 2.4 PII masking

`PiiMask` (`backend/novu-bridge/.../util/PiiMask.java`) is applied at **read time** and
in **logs**, so raw recipient data never crosses the wire or lands in a log line:

- **Phones**: any run of 7+ digits → `***` + last 3 digits (`0712345678` → `***678`)
  (`maskDigits :122-132`).
- **Emails**: keep the first char of the local part (`chakshu@x.org` → `c***@x.org`)
  (`maskEmail :111-120`).
- **UUIDs**: no 7+-digit run → pass through untouched (not PII) (`:16-21`).
- `maskEmbedded` masks PII anywhere inside a delimited string (e.g. a `transactionId`
  whose subscriber segment is a raw phone) (`:53-68`).
- `maskDeep` recursively masks a JSON structure — used on the `providerResponse`
  delivery receipt (`:81-90`).

The `GET /logs` projection masks three fields per row before returning:
`recipientValue` (`mask`), `transactionId` (`maskEmbedded`), and `providerResponse`
(`maskDeep`) — **stored rows stay raw; only the read projection is masked**
(`DispatchLogController.java:79-91`). pgr-services applies the identical rule to its own
log lines (`NotificationService.maskPii :1254-1264`). *Verified live*: `/logs` at `ke`
returns `recipientValue` like `ke:6bc550c5-…-***938f04e` and `ke:…:b***874e01` — uuids
intact, embedded phone digits masked.

## 2.5 The dispatch log row (`nb_dispatch_log`)

`DispatchLogEntry` fields written by `persist` (`DispatchPipelineService.java:309-331`):
`eventId`, `transactionId`, `referenceNumber` (= complaint number / `entityId`),
`module`, `eventName`, `tenantId`, `channel`, `recipientValue` (= subscriberId),
`templateKey`, `status`, `attemptCount`, `lastErrorCode`, `lastErrorMessage`,
`providerResponse`, `createdTime`, `lastModifiedTime`.

### `templateKey` (recent fix, PR #1059 tail)

`resolveTemplateKey` (`:333-362`) records a routing/template identity on every row.
Precedence: (1) an explicit `event.templateKey` on the wire if present; (2) otherwise
**reconstruct** the routing key from segments the event already carries verbatim —
`audience.action.toState.channel[.locale]` (`:356-359`); (3) legacy envelopes fall back
to `eventName`. Nothing is fabricated — every segment comes off the event. *Live nuance*:
historical rows predating this change show `templateKey: null` (verified — the sample
`/logs` rows at `ke` had null `templateKey`); rows written after the fix carry the
reconstructed key.
