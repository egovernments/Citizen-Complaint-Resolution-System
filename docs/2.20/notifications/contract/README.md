# The notification contract

The published interface of novu-bridge.

| File | Defines |
|---|---|
| [`thin-event-v1.schema.json`](./thin-event-v1.schema.json) | JSON Schema (2020-12) of the inbound **thin event**: what happened; the bridge decides who is told and what it says |
| [`envelope-v1.schema.json`](./envelope-v1.schema.json) | JSON Schema (2020-12) of the inbound **envelope**: a finished message for one recipient on one channel |
| [`examples/thin/`](./examples/thin) | Thin events: PGR `APPLY`, PGR `ASSIGN`, a module with no notification code, an account-less recipient |
| [`examples/`](./examples) | Envelopes: complaint SMS, complaint email, WhatsApp with a provider template, DIGIT-core login OTP, a non-PGR module |
| [`openapi.yaml`](./openapi.yaml) | OpenAPI 3.0 for every `/novu-adapter/v1` endpoint, with its auth tier |
| [`error-codes.md`](./error-codes.md) | Every `NB_*` code |
| [`outputs.md`](./outputs.md) | The dispatch log, the DLQ message, delivery receipts |

## One discriminator

Both kinds travel on the same input topics ([../kafka-events.md](../kafka-events.md)). Only
`kind`, read from the raw message, decides the path:

| `kind` | Kind | Path |
|---|---|---|
| absent or `"RENDERED"` | envelope | validate → gate → deliver → one dispatch-log row |
| `"THIN"` | thin event | validate → resolve → N envelopes → N rows |

## From a running deployment

The same documents are packaged in the jar and served unauthenticated:

```
GET /novu-bridge/novu-adapter/v1/contract/envelope      # application/json
GET /novu-bridge/novu-adapter/v1/contract/thin-event    # application/json
GET /novu-bridge/novu-adapter/v1/contract/openapi       # application/yaml
```

## Versioning

`schemaVersion` (absent = `"1"`) versions each kind independently; anything else is rejected
`NB_UNSUPPORTED_SCHEMA_VERSION`. Adding an optional field is not a version change; renaming,
removing or changing the meaning of a field is, and needs a v2 schema that the bridge accepts
alongside v1. Java type names may change; JSON field names may not.

## Keeping it in step

Nothing checks these automatically:

- `backend/novu-bridge/src/main/resources/contract/` (served by the bridge) and this folder must
  stay byte-identical; edit both in the same change.
- A field added to `NotificationEvent` or `ThinEvent` goes into its schema; each schema's
  `required` set is what `EnvelopeValidator` / `ThinEventValidator` enforce.
- A new `NB_*` code goes into `error-codes.md` and `error-codes.txt` in the change that first
  emits it.
