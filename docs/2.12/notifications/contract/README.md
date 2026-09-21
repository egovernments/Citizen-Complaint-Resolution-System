# The notification contract

The notification subsystem is a black box with a published interface. This folder **is** that
interface. Everything here is generated from, and tested against, the code in
`backend/novu-bridge/` — none of it is prose that can quietly fall behind.

| File | What it defines |
|---|---|
| [`envelope-v1.schema.json`](./envelope-v1.schema.json) | JSON Schema (2020-12) of the inbound Kafka envelope — the subsystem's primary interface |
| [`examples/`](./examples) | Five valid payloads: complaint SMS, complaint email with a subject, WhatsApp with a provider template, a DIGIT-core login OTP, and a non-PGR module |
| [`openapi.yaml`](./openapi.yaml) | OpenAPI 3.0 for every `/novu-adapter/v1` HTTP endpoint, with its auth tier |
| [`error-codes.md`](./error-codes.md) | Every `NB_*` code: meaning, where it surfaces, whether it is retryable, what to do |
| [`outputs.md`](./outputs.md) | What comes out — the dispatch log, the DLQ message, the receipts webhook |

## Fetching it from a running deployment

The same two documents are packaged in the service jar and served read-only, so what you fetch
is what that build actually enforces:

```
GET /novu-bridge/novu-adapter/v1/contract/envelope    # application/json
GET /novu-bridge/novu-adapter/v1/contract/openapi     # application/yaml
```

Unauthenticated by design — they describe an interface, not a deployment, and carry no tenant
data, no recipient and no credential.

## Versioning

The envelope is **version 1** and the version travels in the payload (`schemaVersion`, absent
means `"1"`). An envelope declaring anything else is rejected `NB_UNSUPPORTED_SCHEMA_VERSION`
rather than interpreted.

- Adding an **optional** field is not a version change.
- Renaming a field, removing one, or changing what an existing field means **is**. It gets a
  version 2 schema and a bridge that accepts both.

Java type names are free to change — `ComplaintsDomainEvent` became `NotificationEvent` with no
wire change at all. The JSON field names are not.

## How this stays honest

Three tests in `backend/novu-bridge/src/test/java/org/egov/novubridge/contract/` run on every
build:

| Test | What it would catch |
|---|---|
| `EnvelopeContractSchemaTest` | An example that stopped validating; a field added to `NotificationEvent` but not to the schema; the schema's `required` set drifting from what `EnvelopeValidator` actually enforces, in either direction |
| `ErrorCodeCatalogTest` | An `NB_*` code introduced in the main source and never documented |
| `ContractResourceSyncTest` | This published folder drifting from the copy packaged in the jar |

The jar's copy under `src/main/resources/contract/` is the one the build tests against, because
the Docker test runner mounts only `backend/novu-bridge/`. When this folder is present too, the
tests assert the two are byte-identical; when it is not, they skip that one assertion rather
than fail. **Edit both, or the build says so.**
