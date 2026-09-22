# The notification contract

The notification subsystem is a black box with a published interface. This folder **is** that
interface. Everything here is generated from, and tested against, the code in
`backend/novu-bridge/` — none of it is prose that can quietly fall behind.

| File | What it defines |
|---|---|
| [`envelope-v1.schema.json`](./envelope-v1.schema.json) | JSON Schema (2020-12) of the inbound Kafka **envelope** — a finished message for one recipient on one channel |
| [`thin-event-v1.schema.json`](./thin-event-v1.schema.json) | JSON Schema (2020-12) of the inbound Kafka **thin domain event** — what happened, with the box deciding who to tell and what to say |
| [`examples/`](./examples) | Five valid envelopes: complaint SMS, complaint email with a subject, WhatsApp with a provider template, a DIGIT-core login OTP, and a non-PGR module |
| [`examples/thin/`](./examples/thin) | Four valid thin events: a PGR `APPLY`, a PGR `ASSIGN`, a module with no notification code of its own, and an account-less flow that carries its own contact |
| [`openapi.yaml`](./openapi.yaml) | OpenAPI 3.0 for every `/novu-adapter/v1` HTTP endpoint, with its auth tier |
| [`error-codes.md`](./error-codes.md) | Every `NB_*` code: meaning, where it surfaces, whether it is retryable, what to do |
| [`outputs.md`](./outputs.md) | What comes out — the dispatch log, the DLQ message, the receipts webhook |

## Two kinds, one discriminator

Both kinds travel on the same input topics (`novu.bridge.kafka.input.topics`). The topic never
decides how a message is handled, and neither does its shape. One field does:

| `kind` | Meaning | Schema | Path |
|---|---|---|---|
| absent, or `"RENDERED"` | the pre-rendered envelope | [`envelope-v1.schema.json`](./envelope-v1.schema.json) | validate → gate → deliver → one ledger row |
| `"THIN"` | a domain event, un-routed and un-rendered | [`thin-event-v1.schema.json`](./thin-event-v1.schema.json) | validate → **resolve** → N envelopes → N ledger rows |

**Absent is the normal form for an envelope.** `kind` was added to `envelope-v1.schema.json`
as an *optional* field, which by the rule below is not a version change, so no existing v1
producer needs to do anything — now or later. The pre-rendered envelope is a public interface
forever; the thin event is *additional*, not a replacement.

The bridge reads `kind` off the raw map before binding to a model. It never infers the kind
from which fields happen to be set, exactly as it never infers a producer from the payload
shape.

## Fetching it from a running deployment

The same two documents are packaged in the service jar and served read-only, so what you fetch
is what that build actually enforces:

```
GET /novu-bridge/novu-adapter/v1/contract/envelope      # application/json
GET /novu-bridge/novu-adapter/v1/contract/thin-event    # application/json
GET /novu-bridge/novu-adapter/v1/contract/openapi       # application/yaml
```

Unauthenticated by design — they describe an interface, not a deployment, and carry no tenant
data, no recipient and no credential.

## Versioning

Both kinds are **version 1** and the version travels in the payload (`schemaVersion`, absent
means `"1"`). A message declaring anything else is rejected `NB_UNSUPPORTED_SCHEMA_VERSION`
rather than interpreted. `schemaVersion` versions the *kind*: a thin event is
`{"kind":"THIN","schemaVersion":"1"}` and an envelope is `{"schemaVersion":"1"}`, and the two
version independently.

- Adding an **optional** field is not a version change.
- Renaming a field, removing one, or changing what an existing field means **is**. It gets a
  version 2 schema and a bridge that accepts both.

Java type names are free to change — `ComplaintsDomainEvent` became `NotificationEvent` with no
wire change at all. The JSON field names are not.

## Keeping it honest

Nothing checks these files automatically; the discipline is manual:

- **Two copies.** `backend/novu-bridge/src/main/resources/contract/` is packaged in the jar
  (the bridge serves it) and this folder is the published copy. Edit both in the same change
  and keep them byte-identical.
- **Schemas match the validators.** A field added to `NotificationEvent` or `ThinEvent` goes
  into the schema too, and each schema's `required` set is exactly what `EnvelopeValidator` /
  `ThinEventValidator` enforces.
- **`envelope-v1.schema.json` is frozen.** Changing the pre-rendered contract is a new schema
  version, not an edit.
- **Error codes.** An `NB_*` code is added to `error-codes.md` and `error-codes.txt` in the
  change that first emits it.
