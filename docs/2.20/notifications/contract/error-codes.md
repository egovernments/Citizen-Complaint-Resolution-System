# novu-bridge error codes

Every `NB_*` code the bridge emits. Machine-readable twin:
`backend/novu-bridge/src/main/resources/contract/error-codes.txt` — add a new code to both.

**Where a code surfaces**

| Surface | What it is |
|---|---|
| ledger | `last_error_code` on an `nb_dispatch_log` row, shown on Configurator → Notifications → **Logs** |
| DLQ | A message on `novu-bridge.dlq`: `{event, sourceTopic, errorCode, errorMessage}`; only events that throw |
| HTTP | An error response from a `/novu-adapter/v1` endpoint |

A `SKIPPED` outcome writes a row and never DLQs. A rejection writes a `REJECTED` row **and**
DLQs. **Retryable**: *no* = the same input fails again; *config* = fix configuration, then
replay the DLQ; *yes* = transient.

## Envelope rejections (`REJECTED`, then DLQ)

| Code | Meaning | Retryable | Action |
|---|---|---|---|
| `NB_INVALID_EVENT` | Missing/blank `eventId`, `eventType`, `eventName`, `tenantId`, `channel`, `subscriberId` or `renderedBody` (named in the message), or null payload. HTTP 400 on `/dispatch/*` | no | Fix the producer against `envelope-v1.schema.json` |
| `NB_UNSUPPORTED_SCHEMA_VERSION` | `schemaVersion` present and not `1` (both kinds) | no | Upgrade the bridge or pin the producer to 1 |
| `NB_UNSUPPORTED_EVENT_TYPE` | `eventType` not in `novu.bridge.event.types` (both kinds) | config | Add it to `NOVU_BRIDGE_EVENT_TYPES`, restart, replay |
| `NB_INVALID_CORE_SMS` | A core `SMSRequest` without phone or text, or without tenant while `NOVU_BRIDGE_CORE_SMS_DEFAULT_TENANT` is blank. **DLQ only, no row** | no / config | Discard, or set the default tenant and replay |

## Thin-event rejections (`REJECTED`, channel `NONE`, then DLQ)

| Code | Meaning | Retryable | Action |
|---|---|---|---|
| `NB_INVALID_THIN_EVENT` | Missing/blank `kind`, `eventId`, `eventType`, `module`, `eventName` or `tenantId`; `kind` not `THIN`; null payload | no | Fix the producer against `thin-event-v1.schema.json` |
| `NB_EVENT_NOT_IN_CATALOGUE` | `eventName` has no active `NOTIFICATIONS.EventCatalogue` row | config | Add the catalogue row, replay |
| `NB_CONFIG_UNAVAILABLE` | A notification master could not be read from MDMS and no cached copy exists; nothing was sent | yes | Replay from the DLQ once MDMS is reachable |
| `NB_RESOLUTION_INCOMPLETE` | A user lookup or a per-recipient send failed; every other recipient was delivered | yes | Replay from the DLQ once the cause is fixed; recipients already `SENT`/`DELIVERED` are not sent again |

## Delivery gates (`SKIPPED`)

| Code | Meaning | Retryable | Action |
|---|---|---|---|
| `NB_PREFERENCE_DENIED` | Recipient has not consented to the channel. A preference-service outage allows delivery by default (`NOVU_BRIDGE_PREFERENCE_FAIL_OPEN`) | no | None — consent working |
| `NB_UNSUPPORTED_CHANNEL` | Envelope `channel` is not SMS, WHATSAPP or EMAIL | no | Fix the producer |
| `NB_NO_PROVIDER` | Channel not enabled for the tenant (no `NOTIFICATIONS.Channel` row enabling it, no `novu.bridge.channels.enabled` fallback). Also a startup warning | config | Notifications → **Channels**: switch it on, select a provider |
| `NB_CONTACT_MISSING` | EMAIL without an address, SMS/WHATSAPP without a phone; on the thin path, per resolved recipient | no | Fix the recipient record, the producer, or the routing channel |
| `NB_TEMPLATE_NOT_APPROVED` | WHATSAPP message with no approved `templateId` | config | Providers → **Sync WhatsApp templates**, save on **Provider Templates (WhatsApp)** |
| `NB_PROVIDER_UNAVAILABLE` | The channel's selected provider is missing, disabled or on another channel | config | Re-enable it or select another on **Channels** |

## Resolution decisions (`SKIPPED`, thin path only)

Channel `NONE`, `recipient_value` `none`, `transaction_id` `<seed>:NONE` — except
`NB_NO_TEMPLATE`, which names the real channel. Never DLQ'd.

| Code | Meaning | Action |
|---|---|---|
| `NB_NO_ROUTING` | No active routing row for the `eventName` | Add routing on **Routing** / **Configure** |
| `NB_NO_RECIPIENTS` | Every audience resolved to nobody | Check role holders in the tenant, or that the producer sent the actor |
| `NB_UNKNOWN_AUDIENCE_SCHEME` | Audience scheme with no resolver | Fix the routing row |
| `NB_RECIPIENT_LIMIT_EXCEEDED` | Fan-out over `novu.bridge.notifications.recipient.cap` (1000); **nothing** delivered | Check role assignment; raise the cap deliberately |
| `NB_NO_TEMPLATE` | No template for `(eventName, audience, channel, locale)` nor the default locale | Add it on **Templates** |

## Delivery failures (`FAILED`)

| Code | Meaning | Retryable | Action |
|---|---|---|---|
| `NB_NOVU_TRIGGER_FAILED` | Novu trigger failed or answered non-2xx (DLQ when thrown) | yes | Check Novu and `NOVU_API_KEY`; replay |
| `NB_DELIVERY_ERROR` | A provider threw an unexpected exception (also DLQ) | yes | Read `last_error_message` |
| `NB_SMSCOUNTRY_UNREACHABLE` | SMSCountry bulk API unreachable | yes | Check egress and `novu.bridge.smscountry.url` |
| `NB_SMSCOUNTRY_REJECTED` | SMSCountry answered anything but `OK:<jobid>`; HTTP 502 from the adapter | no / config | Usually credentials, sender id or (India) DLT template; the gateway's reply is in the bridge log (by txn), redacted, not in `last_error_message` |
| `NB_PROCESSING_ERROR` | Uncoded failure caught by the consumer. DLQ only | yes | Bridge log has the stack trace |
| `NB_PROVIDER_FAILED` | A receipt reported final failure (`UNDELIV`, `REJECTD`, `EXPIRED`, `failed`, `…error…`) | no | `last_error_message` holds the provider's word |
| `NB_PROVIDER_BOUNCED` | A receipt reported a bounce (status `BOUNCED`) | no | Correct the address |

## Provider management (HTTP only)

Body: `{"ResponseInfo": …, "Errors": [{"code", "message"}]}`.

| Code | HTTP | Meaning / action |
|---|---|---|
| `NB_INVALID_PROVIDER` | 400 | Missing `id` / `providerId`, empty `_update`, or a required credential missing (see `GET /providers/catalog`) |
| `NB_UNKNOWN_PROVIDER_TYPE` | 400 | `type` not one of `twilio-sms`, `twilio-whatsapp`, `smtp`, `smscountry`, `ozeki`, or an existing integration's type cannot be derived for a rotation — re-create it from the catalog |
| `NB_INVALID_CHANNEL` | 400 | `channel` blank or not SMS / WHATSAPP / EMAIL |
| `NB_PROVIDER_NOT_FOUND` | 400 | No integration with that `_id` / identifier |
| `NB_PROVIDER_IN_USE` | 409 | Delete refused: a channel still selects it. Select another first |
| `NB_ADMIN_ROLE_REQUIRED` | 403 | Create / `_update` / `_delete` / `/dispatch/_resolve` without a role from `novu.bridge.proxy.admin.roles` |
| `NB_NO_TWILIO_INTEGRATION` | 400 | Template sync found no Twilio integration with credentials |
| `NB_TWILIO_CONTENT_FETCH_FAILED` | 400 | Twilio ContentAndApprovals call failed; check credentials and egress (retryable) |
| `NB_TWILIO_CONTENT_VARS_SERIALIZE` | 400 | `contentVariables` values must be plain scalars |
| `NB_NOVU_INTEGRATIONS_FAILED` | 400 / 502 | Listing Novu integrations failed; check Novu and the API key |
| `NB_NOVU_INTEGRATION_CREATE_FAILED` / `NB_NOVU_INTEGRATION_UPDATE_FAILED` / `NB_NOVU_INTEGRATION_DELETE_FAILED` | 400 | Novu refused; read the message (e.g. SMTP port must be text) |
| `NB_NOVU_WORKFLOWS_FAILED` | 400 | Listing Novu workflows failed |

## Internal gateway adapter (HTTP only)

`POST /novu-adapter/v1/gateways/smscountry/send`, called by the Novu worker; body
`{"error": "<code>", "message": …}`.

| Code | HTTP | Meaning / action |
|---|---|---|
| `NB_ADAPTER_UNAUTHENTICATED` | 401 | `X-SMSCountry-User` / `X-SMSCountry-Password` missing — re-save the provider from the Configurator |
| `NB_ADAPTER_BAD_REQUEST` | 400 | No recipient or text — check the integration's `baseUrl` points at the adapter |

## Contract documents (HTTP only)

| Code | HTTP | Meaning / action |
|---|---|---|
| `NB_CONTRACT_NOT_PACKAGED` | 404 | The jar was built without `src/main/resources/contract/` — rebuild the image |
| `NB_CONTRACT_UNREADABLE` | 500 | Packaged document unreadable — rebuild the image |

## Not an `NB_*` code

Refusals from `ProxyAuthFilter`, body `{"error": "..."}`:

| Response | Meaning |
|---|---|
| `401 missing bearer token` / `invalid token` | No `Authorization: Bearer`, or egov-user did not resolve it |
| `403 insufficient role` | Not an `EMPLOYEE`, or no role from `novu.bridge.proxy.allowed.roles` / `admin.roles` |

`/receipts/{provider}` answers `401 bad receipt secret`, or `403` when
`novu.bridge.receipts.secret` is blank.
