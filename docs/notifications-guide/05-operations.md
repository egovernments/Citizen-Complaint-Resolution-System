# 5. Operations & runbooks

All MDMS edits below are made at the **state-level tenant `ke`** (city tenants under
`ke` inherit — see [`01-mdms-masters.md §1.4`](01-mdms-masters.md)). Changes become
visible within the MDMS cache TTL (`pgr.notification.mdms.cache.ttl.ms`, 60 s) without a
pgr-services restart (`MDMSUtils.java:113-155`).

## 5.1 Add a new notified transition (routing + template)

To notify, say, the **GRO role pool by EMAIL** when a complaint is `RESOLVE`d:

1. **Add a routing row** to `RAINMAKER-PGR.NotificationRouting` at `ke`:
   ```json
   {"businessService":"PGR","action":"RESOLVE","toState":"RESOLVED",
    "audience":"GRO","channel":"EMAIL","active":true}
   ```
   - Leave `fromState` **blank** (it is ignored at runtime; setting it logs a WARN and
     the row still matches every transition into `RESOLVED` —
     `NotificationRouter.java:71-79`).
   - `audience` can be any role code. A role code fans out to **every tenant user holding
     that role** (the pool). Add `"assigneeOnly": true` to instead notify only the named
     assignee when one exists (`RoutingMatch` / `resolveByAudience :988-993`).
   - The `x-unique` key is `(businessService, action, toState, audience, channel)` — one
     row per channel you want.

2. **Add the matching template** to `RAINMAKER-PGR.NotificationTemplate` at `ke`, same
   `(audience, action, toState, channel)` + a `locale`:
   ```json
   {"audience":"GRO","action":"RESOLVE","toState":"RESOLVED","channel":"EMAIL",
    "locale":"en_IN","subject":"Complaint {id} resolved",
    "body":"Complaint {complaint_type} ({id}) was resolved on {date}.",
    "placeholders":["complaint_type","id","date"],"active":true}
   ```
   - Use the `locale` = your `pgr.notification.default.locale` (else the message renders
     but is never selected — see [`04-localization.md`](04-localization.md)).
   - **EMAIL must have a `subject`** (Novu rejects a blank one; PGR falls back to
     `"Complaint <id>"` if you omit it — `NotificationService.java:938-943`).
   - Only use `{tokens}` the placeholder builder produces (`buildPlaceholderValues
     :1120-1184`): `id`, `complaint_type`, `status`, `date`, `emp_name`,
     `emp_department`, `emp_designation`, `ao_designation`, `ulb`, `citizen_name`,
     `rating`, `additional_comments`, `download_link`. An unknown token ships literally.

3. **Verify the channel is enabled.** For EMAIL/SMS on bomet it is
   (`novu.bridge.channels.enabled=SMS,EMAIL`). If you route a channel that isn't enabled,
   the log will show `SKIPPED / NB_NO_PROVIDER` rather than a delivery.

**No routing row = no notification.** If either the routing OR the template is missing,
that recipient/channel is silently skipped (with an INFO log:
`NotificationRouter` "No notification routing…"; `TemplateRenderer` "No
NotificationTemplate for…"). This is why escalation transitions (`ESCALATE`,
`RESOLVEBYSUPERVISOR`) send nothing today — they have no routing rows.

## 5.2 Onboard a provider (configurator "Notification Providers" screen)

You never touch Novu directly; the configurator does it through novu-bridge.

1. **Add** → fills `POST /providers` with `{name, providerId, channel, credentials}`.
   - SMS → `providerId: twilio`, credentials `{accountSid, authToken, from}`.
   - EMAIL → `providerId: nodemailer`, credentials `{host, user, password, from, …}`.
   - WHATSAPP → `providerId: twilio` (stored as Novu `sms`; gets a `whatsapp-<sha>`
     identifier marker so the row keeps its WhatsApp designation —
     `ProviderController.java:99-103`).
   - Credentials go straight to Novu over TLS; they are never persisted, logged (only key
     names), or echoed back (`NovuClient.createIntegration :295-331`).
2. **Verify** → `POST /providers/verify` returns `{ok, active, detail}` by matching the
   integration in Novu (`:201-239`).
3. **Pull Templates** ("Novu Workflows" dialog) → `GET /providers/templates` lists the
   channel-filtered delivery workflows (`:127-152`).
4. **Test-Send** → `POST /providers/test-send` sends one live message and writes a
   `TEST`-tagged, masked `nb_dispatch_log` row (`:252-309`). For WhatsApp, supply the
   approved Content SID (`contentSid`) + positional `variables` from
   `NotificationProviderTemplate`.

To actually **enable** a new channel end-to-end you also need (a) the channel in
`novu.bridge.channels.enabled` and (b) a `complaints-<channel>` Novu workflow.

## 5.3 Read the dispatch log (configurator "Notification Logs")

`GET /logs?tenantId=ke` (`DispatchLogController.java:55-98`), newest first. Filters:
`referenceNumber` (complaint no; add `referenceNumberPrefix=true` for prefix match),
`transactionId`, `channel`, `status`; paged `limit` (≤500) / `offset`.

Reading a row:
- `status` + `lastErrorCode` tell you the outcome — see the full table in
  [`02-novu-bridge.md §2.1`](02-novu-bridge.md).
- `recipientValue` is the masked `subscriberId` (`ke:<uuid>` or `ke:<masked-phone>`).
- `templateKey` is the routing/template identity (`audience.action.toState.channel[.locale]`);
  null on rows written before that fix shipped.
- `providerResponse` is the (deep-masked) Novu delivery receipt.
- `TEST`-tagged rows (`eventName=TEST`, `tenantId=TEST`) are configurator test-sends, not
  real traffic.

## 5.4 Failure-code quick reference

| Symptom in `/logs` | Root cause | Fix |
|--------------------|-----------|-----|
| `SKIPPED / NB_NO_PROVIDER` | Channel routed in MDMS but not in `novu.bridge.channels.enabled` (WHATSAPP on bomet). | Enable the channel + wire its Novu workflow/integration, or remove the routing row. |
| `SKIPPED / NB_UNSUPPORTED_CHANNEL` | Channel null/unknown on the event. | Bad routing/template `channel` value — must be SMS/WHATSAPP/EMAIL. |
| `SKIPPED / NB_CONTACT_MISSING` | Recipient lacks the email/phone the channel needs. | Fix the user's contact in egov-user/HRMS. |
| `SKIPPED / NB_PREFERENCE_DENIED` | Consent not GRANTED (only when the gate is ON — it's OFF on bomet). | Grant consent, or leave the gate off. |
| `FAILED / NB_NOVU_TRIGGER_FAILED` | Novu returned non-2xx (bad workflow id, Novu down, provider misconfig). | Check the Novu workflow exists + the integration credentials. |
| `FAILED / NB_DELIVERY_ERROR` | Unexpected exception talking to Novu. | Check novu-bridge ↔ Novu connectivity. |
| **No row at all** | No routing row, or no template matched, or the config-driven flag is off. | Add the routing + template rows; confirm `pgr.notification.config.driven=true`. |
| DLQ (`novu-bridge.dlq`) `NB_INVALID_EVENT` | Malformed event (missing channel/body/subscriberId for a pre-rendered event). | pgr-services emission bug — inspect `publishRenderedEvent`. |

## 5.5 Turning the whole feature on/off

- Master switch: `pgr.notification.config.driven` (pgr-services). `false` → legacy
  hardcoded path; `true` → MDMS-driven path + the double-emit guard on the coarse event
  (`NotificationService.java:81`, `ComplaintDomainEventService.java:51-53`).
- Do **not** leave the coarse legacy domain event enabled *and* config-driven off if you
  also consume `complaints.domain.events` for notifications — the guard only suppresses
  the coarse event when config-driven is on. With config-driven on, the topic carries
  only pre-rendered per-recipient events.

## 5.6 Health-check probe (read-only, from an operator box)

Against bomet Kong (`ssh` Kong tunnel → `:18000`), mint an EMPLOYEE token and read the
three masters + the proxy endpoints:

```bash
KONG=http://127.0.0.1:18000
TOKEN=$(curl -s -X POST "$KONG/user/oauth/token" \
  -H "Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=" \
  -d "username=KE_ADMIN&password=eGov@123&tenantId=ke&userType=EMPLOYEE&scope=read&grant_type=password" \
  | jq -r .access_token)

# MDMS masters at ke
for m in NotificationRouting NotificationTemplate NotificationProviderTemplate; do
  curl -s -X POST "$KONG/egov-mdms-service/v2/_search" -H 'Content-Type: application/json' \
    -d "{\"RequestInfo\":{\"authToken\":\"$TOKEN\"},\"MdmsCriteria\":{\"tenantId\":\"ke\",\"schemaCode\":\"RAINMAKER-PGR.$m\"}}" \
    | jq '.mdms | length'
done

# Proxy (Bearer token, EMPLOYEE + allowlisted role)
curl -s "$KONG/novu-bridge/novu-adapter/v1/integrations"       -H "Authorization: Bearer $TOKEN" | jq '.data[] | {providerId,channel,active}'
curl -s "$KONG/novu-bridge/novu-adapter/v1/providers/templates" -H "Authorization: Bearer $TOKEN" | jq '.data'
curl -s "$KONG/novu-bridge/novu-adapter/v1/logs?tenantId=ke&limit=5" -H "Authorization: Bearer $TOKEN" | jq '.total, (.data[] | {channel,status,lastErrorCode})'
```

A healthy bomet returns non-empty masters, the Twilio/nodemailer integrations, the
`complaints-sms`/`complaints-email` workflows, and a growing `/logs` with SMS `SENT` +
WhatsApp `SKIPPED/NB_NO_PROVIDER` rows (as of this writing, `/logs total` at `ke` was
590).
