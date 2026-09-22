# What comes out of novu-bridge

The dispatch log, the DLQ, and the delivery receipts the bridge accepts. Thin events are resolved
into v1 envelopes in-process, so both inbound kinds produce the same outputs; a thin event
yields N rows, each marked `source_path = RESOLVED`.

## The dispatch log

Table `nb_dispatch_log`: one row per terminal outcome per recipient × channel, including
rejections and decisions taken before any recipient or channel existed. Read it with
`GET /novu-adapter/v1/logs` (masked) or Configurator → Notifications → **Logs**.

### Statuses

| Status | Meaning | Written by |
|---|---|---|
| `REJECTED` | Failed validation (envelope or thin event); written before the error is thrown, then DLQ'd | `DispatchPipelineService` / `ThinEventPipelineService` |
| `SKIPPED` | Well-formed; a deliberate decision not to deliver (gates, resolution decisions). Never DLQ'd | gates, resolver |
| `RECEIVED` | Validation only (`POST /dispatch/_validate`, or `_dry-run` without `send`) | dry-run path |
| `SENT` | A transport **accepted** it — not delivered | dispatch path |
| `DELIVERED` | A receipt confirmed delivery; stamps `delivered_time` | `ReceiptController` |
| `BOUNCED` | A receipt reported a bounce | `ReceiptController` |
| `FAILED` | Transport refused or threw, or a receipt reported failure | dispatch path, `ReceiptController` |

```
envelope ─► REJECTED | SKIPPED | RECEIVED | FAILED        (terminal)
         └► SENT ─► DELIVERED | BOUNCED | FAILED (NB_PROVIDER_FAILED)
```

Only `SENT` can change, and only via a receipt (`WHERE status = 'SENT'`), so late or duplicate
receipts never regress a row. `SKIPPED` never becomes `SENT`: re-enabling a channel does not
resend.

### Channel-less rows

When the resolver decides before there is a channel (no routing, no recipients, fan-out refused,
unknown audience scheme) or a thin event is rejected at validation:

| Column | Value |
|---|---|
| `channel` | `NONE` |
| `recipient_value` | `none` |
| `transaction_id` | `<transactionSeed>:NONE` |
| `status` | `SKIPPED`, or `REJECTED` at validation |
| `last_error_code` | `NB_NO_ROUTING`, `NB_NO_RECIPIENTS`, `NB_UNKNOWN_AUDIENCE_SCHEME`, `NB_RECIPIENT_LIMIT_EXCEEDED`, `NB_INVALID_THIN_EVENT`, `NB_EVENT_NOT_IN_CATALOGUE` |
| `source_path` | `RESOLVED` |

`NB_NO_TEMPLATE` rows carry the real channel.

### Idempotency

Unique key `(transaction_id, channel, recipient_value)`; writes are upserts, so Kafka redelivery
updates the row and two recipients of one event coexist. A thin event's `transactionSeed`
becomes `<seed>:<subscriberId>:<channel>` (default seed `<entityId>:<eventName>`, then
`<eventId>`). There is **no duplicate suppression**: a replay is dispatched again and upserts
the same row. A random `transactionId` per attempt gives one row per attempt;
`CoreSmsTranslator` deliberately adds a uuid so each OTP is its own row.

### Columns

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `event_id` | varchar(64) NOT NULL | `eventId`; `unknown` on a rejection without one |
| `transaction_id` | varchar(256) NOT NULL | `transactionId`, else `<eventId>:<channel>`; unique key part |
| `reference_number` | varchar(256) | `entityId`, else `data.referenceNumber`, else `data.complaintNo`, else `eventId`; exact or prefix filter |
| `module` | varchar(128) NOT NULL | `unknown` on a rejection without one |
| `event_name` | varchar(256) NOT NULL | |
| `tenant_id` | varchar(256) NOT NULL | |
| `channel` | varchar(64) NOT NULL | `UNKNOWN` on an envelope rejection without one; `NONE` on channel-less rows |
| `source_path` | varchar(32) NOT NULL, default `PRERENDERED` | `PRERENDERED` \| `RESOLVED`; filter `sourcePath` |
| `recipient_value` | varchar(256) NOT NULL | `subscriberId` or `none`; stored raw, masked on read; unique key part |
| `template_key` | varchar(256) | `templateKey`, else `<audience>.<action>.<toState>.<channel>.<locale>`, else `eventName` |
| `template_version` | varchar(64) | reserved |
| `status` | varchar(32) NOT NULL | see above |
| `attempt_count` | int NOT NULL | always 1 — no internal retry |
| `last_error_code` / `last_error_message` | varchar(128) / text | `NB_*` code; provider's own words |
| `provider_response_jsonb` | jsonb | transport acceptance, later the receipt; deep-masked on read |
| `is_test` | boolean NOT NULL, default false | test-sends; hidden unless `includeTest=true` |
| `provider_ref` | varchar(256) | provider correlation id (Novu transactionId, SMSCountry job id) |
| `delivered_time` | bigint | set by a `DELIVERED` receipt |
| `created_time`, `last_modified_time` | bigint NOT NULL | epoch millis |

Indexes: unique `(transaction_id, channel, recipient_value)`; `(status, last_modified_time)`,
`(tenant_id, event_name)`, `(reference_number)`, `(provider_ref)`, `(tenant_id, is_test)`,
`(tenant_id, source_path)`.

**Test-send rows** (`POST /providers/test-send`): at the operator's tenant, `is_test = true`,
`event_name` and `template_key` = `TEST`, subscriber `nb-test-<sha256(seed)[0:16]>` (repeatable).

## The DLQ

Topic `novu-bridge.dlq` (`NOVU_BRIDGE_KAFKA_DLQ_TOPIC`).

```json
{ "event": { "…the message as received…" },
  "sourceTopic": "notifications.events",
  "errorCode": "NB_UNSUPPORTED_EVENT_TYPE",
  "errorMessage": "eventType XYZ_THING is not one of [COMPLAINTS_WORKFLOW_TRANSITIONED, CORE_SMS]" }
```

`event` is the envelope or thin event as received, or the raw `SMSRequest` for a core-SMS
translation failure. `errorCode` is `NB_PROCESSING_ERROR` when the failure carried no code.

- **DLQ'd:** envelope and thin-event rejections, and any failure that throws (provider
  exception, Novu transport failure).
- **Not DLQ'd:** every `SKIPPED` outcome, and a clean non-2xx provider answer (recorded
  `FAILED`).

No automatic replay and no retry topic: fix the cause and re-produce `event` to an input topic;
the upsert updates the existing row.

## Delivery receipts

`POST` or `GET /novu-adapter/v1/receipts/{provider}` — the only way a row leaves `SENT`.

- **Auth:** `novu.bridge.receipts.secret` as header `X-Receipt-Secret` or query `secret`. Blank
  = endpoint off (403). Outside `ProxyAuthFilter`.
- **Matching:** by `transaction_id` or `provider_ref`. Neither present → `matched: 0`.
- **Parsing:** query parameters and JSON body are merged (`secret` removed) and searched up to
  3 levels deep:

| Role | Keys |
|---|---|
| transaction id | `transactionId`, `transaction_id`, `txn` |
| provider ref | `providerRef`, `provider_ref`, `jobno`, `jobId`, `JobNo`, `jobid`, `messageId`, `message_id`, `sid`, `MessageSid` |
| outcome | `status`, `Status`, `event`, `type`, `eventType`, `deliveryStatus`, `MessageStatus` |
| error text | `error`, `errorMessage`, `reason`, `ErrorMessage`, `errorCode` |

Outcome words, case-insensitive substring, first match wins: `undeliv`, `fail`, `reject`,
`expir`, `error` → `FAILED`; `bounce` → `BOUNCED`; `deliv`, `dlvrd` → `DELIVERED`; anything else
(`queued`, `sent`, `read`, …) is acknowledged and ignored.

| Provider path | Typical report |
|---|---|
| `/receipts/novu` | `{"type": "message.delivered", "data": {"transactionId": "…"}}` |
| `/receipts/smscountry` | `GET …/receipts/smscountry?jobno=4689&status=DELIVRD&secret=…` (`jobno` = the adapter's returned `id`, stored as `provider_ref`) |

Other path segments are parsed the same way but need a Kong route. The response is always
`200` once authenticated, e.g.
`{"provider": "smscountry", "providerStatus": "DELIVRD", "status": "DELIVERED", "matched": 1}`;
`matched: 0` means no row matched, the outcome was non-terminal, or the row had already left
`SENT`.
