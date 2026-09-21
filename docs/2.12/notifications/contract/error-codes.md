# novu-bridge error codes

Every `NB_*` code the bridge can emit, what it means, where an operator sees it, whether
retrying the same input can ever succeed, and what to do about it.

`ErrorCodeCatalogTest` scans `backend/novu-bridge/src/main/java` for `NB_[A-Z_]+` literals and
fails the build if one is missing from this file's machine-readable twin,
`backend/novu-bridge/src/main/resources/contract/error-codes.txt`. A second assertion checks the
two copies agree whenever both are present, so this page cannot quietly fall behind the code.

## Where a code surfaces

| Surface | What it is |
|---|---|
| **ledger** | A row in `nb_dispatch_log` (`last_error_code`), visible on Configurator → Notifications → **Logs**. This is the operator-facing surface. |
| **DLQ** | A message on `novu-bridge.dlq` (default; `novu.bridge.kafka.dlq.topic`), shaped `{event, sourceTopic, errorCode, errorMessage}`. Only events that THROW out of the pipeline land here. |
| **HTTP** | An error response from a `/novu-adapter/v1` endpoint. |
| **startup** | Written by `ConfigurationSanityCheck` at boot. |

A `SKIPPED` outcome writes a ledger row and does **not** DLQ — it is a decision, not a failure.
A rejected envelope writes a `REJECTED` ledger row **and** DLQs, so the operator sees it on the
Logs screen and the payload is still recoverable.

## Retryable

- **no** — the same input will fail again. Fix the producer, or discard.
- **config** — the input is fine; the deployment is not. Change the configuration, then replay
  the DLQ.
- **yes** — a transient condition. Replaying the same message can succeed unchanged.

---

## Envelope rejections

These are thrown by `EnvelopeValidator` before any gate runs. Each writes a `REJECTED` ledger
row first, so nothing disappears, and is then DLQ'd by the consumer.

| Code | Meaning | Surfaces | Retryable | Operator action |
|---|---|---|---|---|
| `NB_INVALID_EVENT` | A required field is missing or blank: `eventId`, `eventType`, `eventName`, `tenantId`, `channel`, `subscriberId`, `renderedBody`. The message names the field. Also raised for a null payload. | ledger (`REJECTED`), DLQ, HTTP 400 on `/dispatch/*` | no | Fix the producer against `envelope-v1.schema.json`. The DLQ message carries the original event. |
| `NB_UNSUPPORTED_SCHEMA_VERSION` | `schemaVersion` is present and is not `1`. | ledger (`REJECTED`), DLQ, HTTP 400 | no | The producer is speaking a version this build does not implement. Upgrade the bridge, or pin the producer back to 1. |
| `NB_UNSUPPORTED_EVENT_TYPE` | `eventType` is not in `novu.bridge.event.types`. The message lists what IS accepted. | ledger (`REJECTED`), DLQ, HTTP 400 | config | Add the type to `NOVU_BRIDGE_EVENT_TYPES` and restart, then replay the DLQ. This is the deliberate allowlist — a new producer is onboarded here, never by teaching the consumer to sniff payload shapes. |
| `NB_INVALID_CORE_SMS` | A message on the DIGIT-core SMS topic could not be translated: no phone, no text, or no tenant and `novu.bridge.core.sms.default.tenant` is blank. | DLQ only — translation fails *before* the pipeline, so there is no ledger row | no / config | If the message genuinely lacked a phone or body, discard. If the tenant was missing, set `NOVU_BRIDGE_CORE_SMS_DEFAULT_TENANT` and replay. |

## Delivery gates — `SKIPPED`

The event was well-formed and a decision was taken not to deliver it. One ledger row, no DLQ,
no exception. These are the codes an operator sees most.

| Code | Meaning | Surfaces | Retryable | Operator action |
|---|---|---|---|---|
| `NB_PREFERENCE_DENIED` | The recipient has not consented to this channel (`digit-user-preferences-service`). | ledger (`SKIPPED`) | no | Nothing. This is consent working. Note an outage of the preference service fails OPEN by default (`novu.bridge.preference.fail.open`) — a check that could not be made is not a refusal. |
| `NB_UNSUPPORTED_CHANNEL` | The envelope's `channel` is not one of SMS, WHATSAPP, EMAIL. Never guessed, never defaulted to SMS. Also thrown by `NovuBridgeConfiguration.getNovuWorkflowId` for a null/unknown channel, which the gate above means is unreachable in normal operation. | ledger (`SKIPPED`), HTTP 500 in the unreachable case | no | A producer typo. Fix the producer. |
| `NB_NO_PROVIDER` | The channel is not enabled for this tenant — no MDMS `NotificationChannel` row switching it on, and no `novu.bridge.channels.enabled` fallback. The most common "nothing is being sent" cause on a fresh deployment. | ledger (`SKIPPED`), startup warning | config | Configurator → Notifications → **Channels**: switch the channel on and pick a provider. `novu.bridge.channels.enabled` is only the bootstrap fallback for tenants with no rows. |
| `NB_CONTACT_MISSING` | An EMAIL event carries no email address, or an SMS/WHATSAPP event no phone. A bridge-side defence: without it the message would trigger the workflow and record a phantom `SENT` with nowhere to go. | ledger (`SKIPPED`) | no | Fix the recipient's record, or fix the producer's recipient filter. |
| `NB_TEMPLATE_NOT_APPROVED` | A WHATSAPP event arrived with no `templateId`. Business-initiated WhatsApp must reference an approved provider template; free-form is rejected by the provider anyway. | ledger (`SKIPPED`) | config | Map an approved template in MDMS `NotificationProviderTemplate` (Configurator → Notifications → **Provider templates**). `GET /providers/twilio-templates` proposes the rows. |
| `NB_PROVIDER_UNAVAILABLE` | The provider the tenant pinned on this channel is missing, disabled, or on the wrong Novu channel. Novu would ACCEPT a trigger naming it and fail the step internally, so the row would read `SENT` for a message that never left. | ledger (`SKIPPED`) | config | Configurator → Notifications → **Providers**: re-activate or replace it. A Novu that cannot be reached fails OPEN, so this code always means a real answer was read. |

## Delivery failures — `FAILED`

The message was handed to a transport and did not get through. A code that is thrown is also
DLQ'd; a code merely reported by the provider is recorded and the pipeline returns normally.

| Code | Meaning | Surfaces | Retryable | Operator action |
|---|---|---|---|---|
| `NB_NOVU_TRIGGER_FAILED` | The Novu trigger call failed (transport error) or answered non-2xx. | ledger (`FAILED`); DLQ on the throw path | yes | Check Novu is up and `novu.api.key` is real. Replay the DLQ. |
| `NB_DELIVERY_ERROR` | A provider threw something that is not a `CustomException` — the catch-all so no failure is silent. The message carries the underlying text. | ledger (`FAILED`), DLQ | yes | Read `last_error_message`. Usually a network fault. |
| `NB_SMSCOUNTRY_UNREACHABLE` | The SMSCountry bulk API could not be reached. | ledger (`FAILED`) | yes | Check egress and `novu.bridge.smscountry.url`. |
| `NB_SMSCOUNTRY_REJECTED` | SMSCountry answered something other than `OK:<jobid>` — an error string, an HTML error page, an empty body. That gateway answers HTTP 200 regardless, so the body is the only truth. | ledger (`FAILED`), HTTP 502 from the adapter | no / config | Read `last_error_message`: usually bad credentials, an unregistered sender id, or (in India) an unregistered DLT template. |
| `NB_PROCESSING_ERROR` | The consumer's outermost catch-all: something failed that carried no `NB_*` code of its own. | DLQ | yes | Read the bridge log for the stack trace; the DLQ message carries the event. |

### Provider-reported statuses (`NB_PROVIDER_*`)

`ReceiptController` stamps a **dynamic** code on a row a delivery receipt moves off `SENT`:
`"NB_PROVIDER_" + status`. Only two values exist, because only three terminal statuses exist
and `DELIVERED` clears the code instead of setting one.

| Code | Meaning | Surfaces | Retryable | Operator action |
|---|---|---|---|---|
| `NB_PROVIDER_FAILED` | The provider reported final failure — `UNDELIV`, `REJECTD`, `EXPIRED`, `failed`, or any word containing `error`. | ledger (`FAILED`) | no | `last_error_message` holds the provider's own word. Usually an unreachable handset, a barred number, or an unregistered template. |
| `NB_PROVIDER_BOUNCED` | The provider reported a bounce (email). | ledger (`BOUNCED`) | no | The address is bad. Correct the recipient's record. |

## Provider management (HTTP only)

Raised by `ProviderController` / `ProviderCatalog` and rendered as
`{"ResponseInfo": …, "Errors":[{"code", "message"}]}`.

| Code | Meaning | Surfaces | Retryable | Operator action |
|---|---|---|---|---|
| `NB_INVALID_PROVIDER` | The request is not usable: no `providerId` on the legacy create form, no `id` on update/delete, an empty change set on `_update`, or a required credential missing for the chosen type. The message names what is missing. | HTTP 400 | no | Fill the form. Required credentials per type come from `GET /providers/catalog`. |
| `NB_UNKNOWN_PROVIDER_TYPE` | The `type` is not in the catalog, or `type` was blank — or, on `_update` with `credentials`, the existing integration's type could not be derived from its identifier, so a rotation cannot be validated. | HTTP 400 | no | Use one of `twilio-sms`, `twilio-whatsapp`, `smtp`, `smscountry`, `ozeki`. An integration with an underivable type must be re-created from the catalog; rotating it blind would blank the credentials Novu omits. |
| `NB_INVALID_CHANNEL` | `channel` is blank or is not SMS / WHATSAPP / EMAIL. | HTTP 400 | no | Fix the request. |
| `NB_PROVIDER_NOT_FOUND` | No integration matches the given `_id` or `identifier`. | HTTP 400 | no | Re-read `GET /integrations`; the id may have been deleted by someone else. |
| `NB_PROVIDER_IN_USE` | Delete refused: a `NotificationChannel` row still routes through this provider. | HTTP 409 | config | Point that channel at another provider first, then delete. The refusal is the point — Novu would delete it happily and every send on that channel would start failing. |
| `NB_ADMIN_ROLE_REQUIRED` | The caller passed the read gate but holds no role from `novu.bridge.proxy.admin.roles`. Applies to `POST /providers`, `/providers/_update`, `/providers/_delete`. | HTTP 403 | no | Rotating a gateway password is a config-admin act. Grant the role deliberately, or have an admin do it. |
| `NB_NO_TWILIO_INTEGRATION` | `GET /providers/twilio-templates` found no Twilio integration carrying credentials in Novu. | HTTP 400 | config | Add the Twilio provider first. |
| `NB_TWILIO_CONTENT_FETCH_FAILED` | The Twilio ContentAndApprovals call failed. | HTTP 400 | yes | Check the Twilio credentials and egress, then retry. |
| `NB_TWILIO_CONTENT_VARS_SERIALIZE` | `contentVariables` could not be serialised for the Twilio override. In practice only reachable with a value Jackson cannot write. | HTTP 400 | no | Fix the producer: `contentVariables` values must be plain scalars. |
| `NB_NOVU_INTEGRATIONS_FAILED` | Listing Novu integrations failed. | HTTP 400 (and 502 from `GET /integrations`, which returns an empty body rather than an empty list) | yes | Check Novu is up and the API key is valid. |
| `NB_NOVU_INTEGRATION_CREATE_FAILED` | Novu refused to create the integration. | HTTP 400 | no / yes | Read the message: usually a credential Novu itself rejects (e.g. a numeric SMTP port — it wants text). |
| `NB_NOVU_INTEGRATION_UPDATE_FAILED` | Novu refused the update. | HTTP 400 | no / yes | As above. |
| `NB_NOVU_INTEGRATION_DELETE_FAILED` | Novu refused the delete. | HTTP 400 | yes | Retry; check Novu is up. |
| `NB_NOVU_WORKFLOWS_FAILED` | Listing Novu workflows failed. | HTTP 400 | yes | Check Novu is up. |

## Internal gateway adapter (HTTP only)

`POST /novu-adapter/v1/gateways/smscountry/send` is called by the Novu worker over the
container network and is never routed by the gateway. It writes its own flat
`{"error": "<code>", "message": …}` body rather than the `Errors` envelope, because the caller
is Novu's `generic-sms` provider, not a DIGIT client.

| Code | Meaning | Surfaces | Retryable | Operator action |
|---|---|---|---|---|
| `NB_ADAPTER_UNAUTHENTICATED` | `X-SMSCountry-User` and/or `X-SMSCountry-Password` were not sent. The credential headers ARE the authentication here. | HTTP 401 | no | The integration in Novu is missing its `apiKey`/`secretKey` credentials, or its header-name credentials were edited. Re-save the provider from the Configurator. |
| `NB_ADAPTER_BAD_REQUEST` | No recipient, or no message text, in the body. | HTTP 400 | no | A malformed `generic-sms` call. Check the integration's `baseUrl` points at this adapter. |

## Contract documents (HTTP only)

| Code | Meaning | Surfaces | Retryable | Operator action |
|---|---|---|---|---|
| `NB_CONTRACT_NOT_PACKAGED` | `GET /contract/envelope` or `/contract/openapi` found no such resource on the classpath. This can only mean the jar was built without `src/main/resources/contract/`. | HTTP 404 | no | A packaging fault, not a request fault. Rebuild the image; read the published copies under `docs/2.12/notifications/contract/` meanwhile. |
| `NB_CONTRACT_UNREADABLE` | The packaged document exists but could not be read. | HTTP 500 | yes | Rebuild the image. |

## Not an `NB_*` code

Two refusals answer with a plain `{"error": "..."}` body and no code, because they happen in
the filter before any controller is reached, and the read-only screens have always parsed that
shape:

| Response | Meaning |
|---|---|
| `401 {"error":"missing bearer token"}` / `{"error":"invalid token"}` | No `Authorization: Bearer`, or egov-user did not resolve it. |
| `403 {"error":"insufficient role"}` | The token resolved, but the user is not an `EMPLOYEE` or holds no role from `novu.bridge.proxy.allowed.roles` / `novu.bridge.proxy.admin.roles`. |

`/receipts/{provider}` likewise answers `401 {"error":"bad receipt secret"}` and
`403 {"error":"receipts are disabled (novu.bridge.receipts.secret is blank)"}`.
