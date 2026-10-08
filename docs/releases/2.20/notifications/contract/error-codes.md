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
DLQs. `NB_INVALID_CORE_SMS`, `NB_CONFIG_UNAVAILABLE` and `NB_RESOLUTION_INCOMPLETE` DLQ with no
row of their own. **Retryable**: *no* = the same input fails again; *config* = fix configuration, then
replay the DLQ; *yes* = transient.

## Envelope rejections (`REJECTED`, then DLQ)

| Code | Meaning | Retryable | Action |
|---|---|---|---|
| `NB_INVALID_EVENT` | Missing/blank `eventId`, `eventType`, `eventName`, `tenantId`, `channel`, `subscriberId` or `renderedBody` (named in the message), or null payload. HTTP 400 on `/dispatch/*` | no | Fix the producer against `envelope-v1.schema.json` |
| `NB_UNSUPPORTED_SCHEMA_VERSION` | `schemaVersion` present and not `1` (both kinds) | no | Upgrade the bridge or pin the producer to 1 |
| `NB_UNSUPPORTED_EVENT_TYPE` | `eventType` not in `novu.bridge.event.types` (both kinds) | config | Add it to `NOVU_BRIDGE_EVENT_TYPES`, restart, replay |
| `NB_INVALID_CORE_SMS` | A core `SMSRequest` without phone or text, or without tenant while `NOVU_BRIDGE_CORE_SMS_DEFAULT_TENANT` is blank. **DLQ only, no row**; the DLQ copy has no text and a masked phone ([outputs.md](./outputs.md#the-dlq)) | no / config | Discard (it cannot be replayed; the user asks again). Missing tenant: set the default tenant for the next ones |

## Thin-event rejections (`REJECTED`, channel `NONE`, then DLQ)

| Code | Meaning | Retryable | Action |
|---|---|---|---|
| `NB_INVALID_THIN_EVENT` | Missing/blank `kind`, `eventId`, `eventType`, `module`, `eventName` or `tenantId`; `kind` not `THIN`; null payload | no | Fix the producer against `thin-event-v1.schema.json` |
| `NB_EVENT_NOT_IN_CATALOGUE` | `eventName` has no active `NOTIFICATIONS.EventCatalogue` row | config | Add the catalogue row, replay |

## Thin-event failures (DLQ only, no row)

These write **no** dispatch-log row for the event: it goes to `novu-bridge.dlq` only, so the Logs
screen does not show it — read the DLQ ([kafka-events.md](../kafka-events.md#verify-delivery)).

| Code | Meaning | Retryable | Action |
|---|---|---|---|
| `NB_CONFIG_UNAVAILABLE` | A notification master could not be read from MDMS and no cached copy exists; nothing was sent | yes | Replay from the DLQ once MDMS is reachable |
| `NB_RESOLUTION_INCOMPLETE` | A user lookup or a per-recipient send failed; every other recipient was delivered (and keeps its own row) | yes | Replay from the DLQ once the cause is fixed; recipients already `SENT`/`DELIVERED` are not sent again |

## Delivery gates (`SKIPPED`)

| Code | Meaning | Retryable | Action |
|---|---|---|---|
| `NB_PREFERENCE_DENIED` | Recipient has not consented to the channel. A preference-service outage allows delivery by default (`NOVU_BRIDGE_PREFERENCE_FAIL_OPEN`) | no | None — consent working |
| `NB_UNSUPPORTED_CHANNEL` | Envelope `channel` is not SMS, WHATSAPP or EMAIL | no | Fix the producer |
| `NB_NO_PROVIDER` | Channel not enabled for the tenant: it has channel rows and none enables this channel (a missing row is off), or it has no rows and the channel is not in `novu.bridge.channels.enabled`. Also a startup warning | config | Notifications → **Channels**: switch it on, select a provider |
| `NB_CONTACT_MISSING` | EMAIL without an address, SMS/WHATSAPP without a phone; on the thin path, per resolved recipient | no | Fix the recipient record, the producer, or the routing channel |
| `NB_CONTACT_INVALID` | SMS/WHATSAPP phone that is national (no `+` / `00`) and no country code is known to complete it: not from the user record, not from the tenant's `common-masters.MobileNumberValidation` rule (read at the tenant, then its state root), and `NOVU_BRIDGE_CORE_SMS_COUNTRY_CODE` is blank. Never sent as `+` + the national number | config | Add the tenant's mobile rule (Configurator → Mobile Number Validation; workspaces get it at signup), or set `NOVU_BRIDGE_CORE_SMS_COUNTRY_CODE`; replay is not needed, the next message goes out |
| `NB_TEMPLATE_NOT_APPROVED` | WHATSAPP message with no approved `templateId` | config | Providers → **Sync WhatsApp templates**, save on **Provider Templates (WhatsApp)** |
| `NB_PROVIDER_UNAVAILABLE` | The channel's selected provider is missing, disabled or on another channel; or it is SMSCountry, Ozeki or Jasmin while `NOVU_BRIDGE_DIGIT_WORKER_PROVIDERS=false` (the Novu worker does not load DIGIT's providers); or, for a channel with no provider selected: Novu has **no active integration that delivers the channel** at all (whatever the flag — Novu would accept the trigger and fail the job with "Subscriber does not have an active integration"; an integration whose catalog type delivers another channel, such as Twilio WhatsApp for SMS, does not count), or Novu's default for it (its primary integration, or every active one when none is primary, or the one `NOVU_BRIDGE_INTEGRATION_ID_WHATSAPP` names) is one of those three under the same flag | config | Re-enable it or select another on **Channels**; with no provider at all, add one on **Providers** and select it; for the worker case, select a Twilio provider or mount the providers into the worker ([providers.md](../providers.md#digits-worker-providers)) |

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
| `NB_SMSCOUNTRY_UNREACHABLE` | Legacy direct route (`novu.bridge.sms.provider=smscountry`): SMSCountry bulk API unreachable | yes | Check egress and `novu.bridge.smscountry.url` |
| `NB_SMSCOUNTRY_REJECTED` | Legacy direct route: SMSCountry answered anything but `OK:<jobid>` | no / config | Usually credentials, sender id or (India) DLT template; the gateway's reply is in the bridge log (by the masked txn quoted in `last_error_message`), redacted, not in `last_error_message` |
| `NB_PROCESSING_ERROR` | Uncoded failure caught by the consumer. DLQ only | yes | Bridge log has the stack trace |
| `NB_PROVIDER_FAILED` | A receipt reported final failure (`UNDELIV`, `REJECTD`, `EXPIRED`, `failed`, `…error…`) | no | `last_error_message` holds the provider's word |
| `NB_PROVIDER_BOUNCED` | A receipt reported a bounce (status `BOUNCED`) | no | Correct the address |
| `NB_TENANT_ACCOUNT_UNAVAILABLE` | The tenant's root has its own Novu organization ([tenant-accounts.md](../tenant-accounts.md)) but its row could not be read or its stored key does not decrypt (wrong `NOVU_BRIDGE_TENANT_KEY_ENCRYPTION_KEY`). Fails closed: never sent through the shared account. Also DLQ | yes / config | Check the bridge database and the encryption key (and `..._PREVIOUS` during a rotation); replay |

## Provider management (HTTP only)

Body: `{"ResponseInfo": …, "Errors": [{"code", "message"}]}`.

| Code | HTTP | Meaning / action |
|---|---|---|
| `NB_INVALID_PROVIDER` | 400 | Missing `id` / `providerId`, empty `_update`, a required credential missing (see `GET /providers/catalog`), a catalog-form `identifier` that does not start with `<type>-`, no `tenantId` on `_delete` / `_update` with `active: false`, or a credential rotation on an integration whose Novu provider is not its type's (an SMSCountry / Ozeki provider made as `generic-sms` before they became native): add a new provider, select it, delete the old one |
| `NB_UNKNOWN_PROVIDER_TYPE` | 400 | `type` not one of `twilio-sms`, `twilio-whatsapp`, `smtp`, `smscountry`, `ozeki`, `jasmin`, or an existing integration's type cannot be derived for a rotation — re-create it from the catalog |
| `NB_PROVIDER_TYPE_UNAVAILABLE` | 400 | Creating, rotating, re-enabling (`active: true`), testing or checking an SMSCountry, Ozeki or Jasmin provider while `NOVU_BRIDGE_DIGIT_WORKER_PROVIDERS=false`: the Novu worker does not load DIGIT's providers, so Novu would accept it and fail every send. Choose another provider, or mount `novu-worker-providers` into the worker and set the flag to `true`. Renaming, disabling and deleting one still work |
| `NB_INVALID_CHANNEL` | 400 | `channel` blank or not SMS / WHATSAPP / EMAIL |
| `NB_PROVIDER_NOT_FOUND` | 400 | No integration with that `_id` / identifier |
| `NB_PROVIDER_UNAVAILABLE` | 409 | `test-send` refused: nothing could deliver the test, by the check dispatch makes ([delivery gates](#delivery-gates-skipped)), on a fresh read of Novu's integrations. The named integration is disabled or on another channel than the test's (one Novu does not know is `NB_PROVIDER_NOT_FOUND`); or none is named and Novu has no active integration that delivers the channel, or its default is SMSCountry, Ozeki or Jasmin while `NOVU_BRIDGE_DIGIT_WORKER_PROVIDERS=false`. Nothing was sent and no row written; the message says what to fix. When Novu's integration list cannot be read, the test is sent unchecked and the 200 carries `warning` |
| `NB_PROVIDER_IN_USE` | 409 | Delete or disable refused: a channel still selects it (by identifier or Novu `_id`) — select another first. Or it is the integration `NOVU_BRIDGE_INTEGRATION_ID_WHATSAPP` names while an enabled WhatsApp channel selects no provider. Or it is the last active integration of its DIGIT channel (SMS, WhatsApp or Email: a Twilio WhatsApp integration is no substitute for SMS, nor SMS for WhatsApp) while an enabled channel of that kind with no selected provider sends through Novu's default: a legacy row without `provider`, a state on `NOVU_BRIDGE_CHANNELS_ENABLED`, or every tenant with the channel policy off — select a provider on those channels, or add and enable another first. Also when a state's channel rows could not be read: nothing changed, retry once MDMS answers |
| `NB_ADMIN_ROLE_REQUIRED` | 403 | Create / `_update` / `_delete` / `test-send` / `/dispatch/_dry-run` / `/dispatch/_resolve` without a role from `novu.bridge.proxy.admin.roles` held at a state tenant (a city-level admin role does not count) |
| `NB_TENANT_NOT_ALLOWED` | 403 | A provider call with `?tenantId=<workspace>` on a workspace that has its own Novu organization, by a caller holding no admin role at that workspace's root (writes) or without it among its tenants (reads), an owning state's admin included; `/logs` or `/config/source` for a tenant that is not the caller's own, nor a city of its state; `_delete` / disable for a `tenantId` whose state the caller holds no admin role at; or create / `_update` / `_delete` / `test-send` by an admin whose state does not own the deployment's providers (owners: the state of `NOVU_BRIDGE_CORE_SMS_DEFAULT_TENANT` plus `NOVU_BRIDGE_PROVIDER_ADMIN_TENANTS`; with neither set, nobody); or `/dispatch/_resolve` / `_dry-run` by an admin of neither the event tenant's state root nor an owning state (`_dry-run` with `send: true` needs an owning state) |
| `NB_NO_TWILIO_INTEGRATION` | 400 | Template sync found no Twilio integration with credentials |
| `NB_TWILIO_CONTENT_FETCH_FAILED` | 400 | Twilio ContentAndApprovals call failed; check credentials and egress (retryable) |
| `NB_TWILIO_CONTENT_VARS_SERIALIZE` | 400 | `contentVariables` values must be plain scalars |
| `NB_NOVU_INTEGRATIONS_FAILED` | 400 / 502 | Listing Novu integrations failed; check Novu and the API key |
| `NB_NOVU_INTEGRATION_CREATE_FAILED` / `NB_NOVU_INTEGRATION_UPDATE_FAILED` / `NB_NOVU_INTEGRATION_DELETE_FAILED` | 400 | Novu refused; read the message (e.g. SMTP port must be text) |
| `NB_NOVU_WORKFLOWS_FAILED` | 400 | Listing Novu workflows failed |
| `NB_TENANT_MISMATCH` | 400 | `_delete` / disable on a workspace's own organization with a body `tenantId` of another root |

## Tenant accounts and `messages/_send` (HTTP only, internal)

The internal APIs of [tenant-accounts.md](../tenant-accounts.md): `/tenants/**` and
`POST /messages/_send`, header `X-Novu-Bridge-Token`. Body: `{"Errors": [{"code", "message"}]}`.

| Code | HTTP | Meaning / action |
|---|---|---|
| `NB_INTERNAL_API_DISABLED` | 403 | The token for this API is not configured (`NOVU_BRIDGE_INTERNAL_ADMIN_TOKEN` / `_SEND_TOKEN`), so the API is off |
| `NB_INTERNAL_TOKEN_REQUIRED` / `NB_INTERNAL_TOKEN_INVALID` | 401 | No `X-Novu-Bridge-Token`, or not this API's token (the send token opens only `_send` and `GET /tenants/{tenant}`) |
| `NB_TENANT_ACCOUNTS_DISABLED` | 409 | Provision or deprovision while `NOVU_BRIDGE_TENANT_ACCOUNTS_ENABLED` is false |
| `NB_TENANT_ACCOUNTS_MISCONFIGURED` | 503 | No Novu admin login, or an encryption key shorter than 32 characters |
| `NB_INVALID_TENANT` | 400 | `tenantId` is not a tenant code (lower-case letters, digits, `-`, `_`; a dotted id means its root) |
| `NB_PROVISIONING_IN_PROGRESS` | 409 | Another request holds the tenant's lease (2 min); retry shortly |
| `NB_PROVISIONING_FAILED` / `NB_DEPROVISIONING_FAILED` | 500 / 502 | Unexpected failure; the row keeps `last_error_code` / `last_error_message`. Retry: provision is idempotent |
| `NB_NOVU_PLATFORM_LOGIN_FAILED` | 502 | Novu refused the platform admin login: check `NOVU_BRIDGE_NOVU_ADMIN_EMAIL` / `_PASSWORD` (the deploy's `novu_admin_password` in OpenBao) |
| `NB_NOVU_PLATFORM_FAILED` | 502 | Novu refused or misanswered an organization, environment or key call; read the message |
| `NB_NOVU_WORKFLOW_CREATE_FAILED` | 502 | Novu refused a workflow in the tenant's organization; retry the provision |
| `NB_NOVU_UNAVAILABLE` | 503 | Novu could not be reached (provision, status, `_send`) |
| `NB_NOVU_NOTIFICATIONS_FAILED` | — | Reading a send's job state failed; `_send` then answers `202 QUEUED`, never an error |
| `NB_TENANT_NOT_PROVISIONED` | 409 (404 on `_deprovision`) | The tenant's root has no organization of its own. On `_send`, the BFF maps it to `OTP_CHANNEL_UNAVAILABLE` |
| `NB_NO_PROVIDER_FOR_CHANNEL` | 422 | `_send`: the tenant has an organization but no usable provider carries the channel (the selected one is missing, disabled or the wrong channel, or none is active). The BFF maps it to `OTP_CHANNEL_UNAVAILABLE` |
| `NB_PROVIDER_FAILED` | 502 | `_send`: Novu ran the send and the provider refused it; the message carries Novu's short reason, masked |
| `NB_NOVU_TRIGGER_FAILED` | 502 | `_send`: Novu refused the trigger |
| `NB_INVALID_REQUEST` / `NB_UNKNOWN_TEMPLATE` | 400 | `_send` body malformed (channel, E.164 recipient: a national number is refused, never completed with a country code, 4-12 character code, an expiry within 24 h), or a `templateKey` other than `OTP` |

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
