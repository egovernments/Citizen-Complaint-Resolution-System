# What comes out of the box

Either a pre-rendered envelope (`envelope-v1.schema.json`) or a thin domain event
(`thin-event-v1.schema.json`) goes in. This is everything that comes out: the delivery ledger,
the dead-letter topic, and the receipts the bridge accepts back from providers.

The two inbound kinds produce the **same outputs**. A thin event is resolved into v1 envelopes
in-process and those envelopes go through the same pipeline, so the statuses, the keys, the
upsert semantics and the DLQ shape below are identical either way. What differs is arity and
one column: one envelope is one row, one thin event is N rows, and every row says which path it
came in on (`source_path`).

- [The dispatch log](#the-dispatch-log)
- [The DLQ](#the-dlq)
- [Delivery receipts](#delivery-receipts)

---

## The dispatch log

One table, `nb_dispatch_log`. **Exactly one row per terminal outcome per (recipient × channel)**
— including rejections, which used to vanish into the DLQ without a trace, and including the
decisions taken before there was a recipient or a channel at all, which used to be a log line
inside the producing module. Read through `GET /novu-adapter/v1/logs` (PII masked) and shown on
Configurator → Notifications → **Logs**.

### Which path produced the row

`source_path` is on every row: `PRERENDERED` when the producer sent a finished v1 envelope,
`RESOLVED` when it sent a thin domain event and the box routed, recruited, rendered and
localized it. Rows written before the column existed read `PRERENDERED`, which is what they
were.

This is not an audit nicety. There is **no configuration** that says which path a deployment is
on — deliberately, because a setting can be dropped with a compose overlay and flip behaviour in
silence, which is how a live server once lost its notifications for days. The path is recorded
per message instead, filterable (`GET /logs?sourcePath=RESOLVED`), in production. Looking at one
column beats reading any config you could have made readable.

### Channel-less rows

`channel` is normally `SMS`, `WHATSAPP` or `EMAIL`. On the thin path it can also be **`NONE`**:
the box reached a terminal decision before there was a channel to name — no routing row matched,
every audience resolved to nobody, the fan-out was refused, or a routing row named an audience
scheme nothing can resolve. Such a row carries:

| Column | Value |
|---|---|
| `channel` | `NONE` |
| `recipient_value` | `none` (lower case, so it cannot be mistaken for a subscriber) |
| `transaction_id` | `<transactionSeed>:NONE` |
| `status` | `SKIPPED`, or `REJECTED` for a thin event refused at validation |
| `last_error_code` | `NB_NO_ROUTING`, `NB_NO_RECIPIENTS`, `NB_UNKNOWN_AUDIENCE_SCHEME`, `NB_RECIPIENT_LIMIT_EXCEEDED`, `NB_INVALID_THIN_EVENT`, `NB_EVENT_NOT_IN_CATALOGUE` |
| `source_path` | `RESOLVED` |

Appending the pseudo-channel to the transaction id is what keeps the unique key
`(transaction_id, channel, recipient_value)` intact, so a redelivery upserts the same row rather
than accumulating duplicates — the same property the real rows have, for the same reason.

`NB_NO_TEMPLATE` is deliberately **not** channel-less: by the time it fires the box knows which
channel it could not render for, and the row says so.

### Statuses

| Status | Meaning | Written by |
|---|---|---|
| `REJECTED` | The message failed validation — the envelope's, or the thin event's. Written *before* the error is thrown, so the operator can see what was refused; the consumer then DLQs it. | `DispatchPipelineService.persistRejected`, `ThinEventPipelineService.persistRejected` |
| `SKIPPED` | Well-formed, and a deliberate decision not to deliver: consent denied, channel off for the tenant, unsupported channel, no contact for the channel, no approved WhatsApp template, provider unusable — or, on the thin path, no routing, no recipients, no template, a refused fan-out, or a build with no resolution stage. A decision, not a failure — never DLQ'd. | the delivery gates; the resolution stage |
| `RECEIVED` | Validation-only pass (`POST /dispatch/_validate`, or `_dry-run` without `send`). Nothing was handed to a transport. | the dry-run path |
| `SENT` | A transport ACCEPTED the message. **Not delivered** — queued. This is the strongest statement the bridge can make without a receipt. | the dispatch path |
| `DELIVERED` | A provider receipt confirmed delivery. Stamps `delivered_time`. | `ReceiptController` |
| `BOUNCED` | A provider receipt reported a bounce. | `ReceiptController` |
| `FAILED` | The transport refused it, threw, or a receipt reported final failure. `last_error_code` holds the code, `last_error_message` the provider's own words. | the dispatch path, or `ReceiptController` |

### Transitions

```
                   ┌─ REJECTED   (terminal; also DLQ'd)
                   ├─ SKIPPED    (terminal)
   envelope ──────►├─ RECEIVED   (terminal; dry run only)
                   ├─ FAILED     (terminal at dispatch time)
                   └─ SENT ──────► DELIVERED   (+ delivered_time)
                                 ├ BOUNCED
                                 └ FAILED      (last_error_code = NB_PROVIDER_FAILED)
```

`SENT` is the only status a row can move OFF, and only a receipt moves it. Everything else is
terminal. Two consequences worth knowing:

- **A late or duplicate receipt cannot regress a row.** The update carries
  `WHERE status = 'SENT'`, so a second `DELIVERED` report, or a `FAILED` arriving after a
  `DELIVERED`, matches nothing and is acknowledged with `matched: 0`.
- **`SKIPPED` never becomes `SENT`.** Re-enabling a channel does not resurrect the messages
  skipped while it was off. They were not queued anywhere.

### Idempotency

The unique key is **`(transaction_id, channel, recipient_value)`** — not `event_id`. The write
is an upsert on that key, which is what lets:

- Kafka redelivery of the same envelope update its row instead of creating a second one;
- two recipients of the same business event coexist on the same channel.

A thin event does not carry a `transactionId` — it carries a **`transactionSeed`**, which the
box completes into `<seed>:<subscriberId>:<channel>` per resolved message and into
`<seed>:NONE` on a channel-less row. A producer that seeds `<entityId>:<ACTION>:<TOSTATE>`
therefore gets transaction ids byte-identical to the ones it used to mint itself, which is what
makes a mid-flight redeploy safe. Absent, the seed is derived `<entityId>:<eventName>`, and
failing that `<eventId>`.

There is **no duplicate suppression** on either path. A replayed event is dispatched again and
upserts the same row; there is no "a SENT row already exists, skip it" gate anywhere. That is
today's semantics and it is deliberate — which is why the release that cuts a producer over must
stop the old instance before starting the new one (compose recreate already does; Kubernetes
needs `strategy: Recreate` for that release).

This is why `transactionId` is the field that matters most in the envelope. A producer that
sends a random `transactionId` per attempt gets one row per attempt; one that sends a
deterministic key gets one row per real message. `CoreSmsTranslator` deliberately appends a
fresh uuid, because a re-sent OTP genuinely IS a second message and must not overwrite the
first.

### Columns

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `event_id` | varchar(64) NOT NULL | envelope `eventId`; `"unknown"` on a rejection that carried none |
| `transaction_id` | varchar(256) NOT NULL | envelope `transactionId`, else `<eventId>:<channel>`. Part of the unique key |
| `reference_number` | varchar(256) | the producing module's own handle — `entityId`, else `data.referenceNumber`, else `data.complaintNo`, else `eventId`. Indexed; filterable exactly or by prefix |
| `module` | varchar(128) NOT NULL | envelope `module`; `"unknown"` on a rejection that carried none |
| `event_name` | varchar(256) NOT NULL | envelope `eventName` |
| `tenant_id` | varchar(256) NOT NULL | |
| `channel` | varchar(64) NOT NULL | `UNKNOWN` on an envelope rejection that carried none; `NONE` on a channel-less row |
| `source_path` | varchar(32) NOT NULL default `PRERENDERED` | `PRERENDERED` \| `RESOLVED` — which inbound kind produced this row. Indexed with `tenant_id`; filterable |
| `recipient_value` | varchar(256) NOT NULL | the `subscriberId`, or `none` on a channel-less row. Stored raw, **masked at read time**. Part of the unique key |
| `template_key` | varchar(256) | envelope `templateKey`, else `<audience>.<action>.<toState>.<channel>.<locale>`, else `eventName` |
| `template_version` | varchar(64) | reserved; not written today |
| `status` | varchar(32) NOT NULL | the table above |
| `attempt_count` | int NOT NULL | always 1 today — the bridge does not retry internally |
| `last_error_code` | varchar(128) | an `NB_*` code; see `error-codes.md` |
| `last_error_message` | text | the provider's own words where there are any |
| `provider_response_jsonb` | jsonb | the transport's raw acceptance, later replaced by the receipt. **Deep-masked at read time** — it echoes the raw `transactionId`, which for a uuid-less recipient embeds a phone number |
| `is_test` | boolean NOT NULL default false | operator test-sends. Hidden from the Logs screen unless `includeTest=true` |
| `provider_ref` | varchar(256) | provider-side correlation id (Novu transactionId, SMSCountry jobId) — the second way a receipt finds the row. Indexed |
| `delivered_time` | bigint | stamped only by a `DELIVERED` receipt |
| `created_time`, `last_modified_time` | bigint NOT NULL | epoch millis |

Indexes: unique `(transaction_id, channel, recipient_value)`; `(status, last_modified_time)`,
`(tenant_id, event_name)`, `(reference_number)`, `(provider_ref)`, `(tenant_id, is_test)`,
`(tenant_id, source_path)`.

### Test-send rows

`POST /providers/test-send` writes one row at the operator's own `tenantId` with
`is_test = true`, `event_name` and `template_key` both `TEST`, and a masked recipient. Live
tests are therefore auditable and visible on request, and never counted as real traffic. The
derived `subscriberId` is `nb-test-<sha256(seed)[0:16]>` — no clock, no random — so repeating a
test is idempotent.

---

## The DLQ

Topic `novu-bridge.dlq` (`novu.bridge.kafka.dlq.topic` / `NOVU_BRIDGE_KAFKA_DLQ_TOPIC`),
published with the event's `tenantId` as the Kafka key.

```json
{
  "event": { "…the original envelope, verbatim…" },
  "sourceTopic": "notifications.events",
  "errorCode": "NB_UNSUPPORTED_EVENT_TYPE",
  "errorMessage": "eventType XYZ_THING is not one of [COMPLAINTS_WORKFLOW_TRANSITIONED, CORE_SMS]"
}
```

| Field | Notes |
|---|---|
| `event` | The message as received — the envelope, or the thin event. The shape does not vary by kind, and neither does the DLQ's. For a message that failed CORE-SMS translation this is instead the raw `SMSRequest` map, because no envelope was ever built |
| `sourceTopic` | Which input topic it arrived on |
| `errorCode` | The `NB_*` code, or `NB_PROCESSING_ERROR` for anything that carried none |
| `errorMessage` | Human-readable detail |

What does and does not get here:

- **DLQ'd**: envelope rejections, thin-event rejections (`NB_INVALID_THIN_EVENT`,
  `NB_EVENT_NOT_IN_CATALOGUE`, `NB_UNSUPPORTED_EVENT_TYPE`, `NB_UNSUPPORTED_SCHEMA_VERSION`), and
  any failure that THROWS out of the pipeline (a provider exception, a Novu transport failure).
- **Not DLQ'd**: every `SKIPPED` outcome, and a provider that answered cleanly with a rejection
  (a non-2xx from Novu) — those are recorded `FAILED` in the ledger and the pipeline returns
  normally.

There is **no automatic replay.** The DLQ is a recovery buffer: fix the cause, then re-produce
the `event` object to an input topic. Because the ledger key is `transactionId`, replaying an
event updates its existing row rather than creating a duplicate.

The bridge does **not** retry internally — no retry topic, `attempt_count` is always 1. A
transport failure is one row and one DLQ message.

---

## Delivery receipts

`POST` or `GET /novu-adapter/v1/receipts/{provider}`. This is the only way a row moves past
`SENT`.

**Auth**: the shared secret `novu.bridge.receipts.secret`, as header `X-Receipt-Secret` or
query `secret`. Blank secret = the endpoint is OFF and answers 403. It sits outside
`ProxyAuthFilter` because the caller is a machine, not an operator.

**Matching**: the row is found by `transaction_id` **OR** `provider_ref`. A report carrying
neither is answered `matched: 0, note: "no transactionId / provider reference in the report"`.

**Parsing is tolerant on purpose.** Providers version their webhook shapes independently of us,
so the parser looks for a correlation id and an outcome word anywhere in the payload (up to 3
levels deep, through objects and arrays) rather than binding to one exact schema. Query
parameters and JSON body are merged; `secret` is stripped first.

Keys it looks for:

| Role | Keys |
|---|---|
| transaction id | `transactionId`, `transaction_id`, `txn` |
| provider ref | `providerRef`, `provider_ref`, `jobno`, `jobId`, `JobNo`, `jobid`, `messageId`, `message_id`, `sid`, `MessageSid` |
| outcome | `status`, `Status`, `event`, `type`, `eventType`, `deliveryStatus`, `MessageStatus` |
| error text | `error`, `errorMessage`, `reason`, `ErrorMessage`, `errorCode` |

**Outcome words → status** (case-insensitive substring match, in this order):

| Contains | Status |
|---|---|
| `undeliv`, `fail`, `reject`, `expir`, `error` | `FAILED` |
| `bounce` | `BOUNCED` |
| `deliv`, `dlvrd` | `DELIVERED` |
| anything else (`queued`, `sent`, `accepted`, `read`, unknown) | non-terminal — acknowledged, ignored, `matched: 0` |

Note the order: a word containing both (`undelivered`) resolves to `FAILED`, not `DELIVERED`.

### Per provider

**`/receipts/novu`** — Novu's delivery webhook. Carries `transactionId` at the top level or
nested under `payload` / `data` / `message`, plus a status word such as `message.delivered`,
`delivered`, `sent`, `failed`.

```json
{ "type": "message.delivered",
  "data": { "transactionId": "PGR-2026-000123:ASSIGN:PENDINGATLME:ke.bomet:9a1f…:SMS" } }
```

**`/receipts/smscountry`** — the bulk API's delivery reports, usually a **GET** with query
parameters. Carries `jobno` / `JobNo` (what the adapter returned as `id`, stored as
`provider_ref`) plus a status such as `DELIVRD`, `UNDELIV`, `EXPIRED`, `REJECTD`.

```
GET /novu-bridge/novu-adapter/v1/receipts/smscountry?jobno=4689&status=DELIVRD&secret=…
```

**Any other provider** is parsed on the same rules — the path segment is only recorded and
echoed back. Only `novu` and `smscountry` are routed by the gateway; a new one needs a gateway
route.

### Response

Always `200` once authenticated. The verdict is in the body, never in the status code — a
provider retrying a webhook because it saw a 4xx would be worse than useless.

```json
{ "provider": "smscountry", "providerStatus": "DELIVRD",
  "status": "DELIVERED", "matched": 1 }
```

`matched: 0` is normal and means one of three things, distinguished by `note` and `status`:
the report addressed no row, it was non-terminal, or the row had already moved off `SENT`.
