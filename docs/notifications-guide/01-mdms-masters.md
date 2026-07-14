# 1. The three MDMS masters

All routing, content, and provider-template data lives in **MDMS v2** under the module
`RAINMAKER-PGR`. The schema definitions are in
`utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json:234-433`;
dev seed data is under
`utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/`.

pgr-services reads two of them (Routing + Template); novu-bridge reads none at runtime
(ProviderTemplate is available to it but the shipped pass-through path does not consult
it — WhatsApp Content SIDs are supplied only on the configurator test-send path).

## 1.1 `RAINMAKER-PGR.NotificationRouting` — the "who / how"

One row per `(businessService, action, toState, audience, channel)`. Declares that a
transition notifies that audience over that channel.

Schema (`RAINMAKER-PGR.json:234-300`):

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `businessService` | string | ✓ | Workflow service, e.g. `PGR`. |
| `action` | string | ✓ | `APPLY`, `ASSIGN`, `REASSIGN`, `REJECT`, `RESOLVE`, `REOPEN`, `RATE`. |
| `toState` | string | ✓ | Resulting `applicationStatus`, e.g. `PENDINGATLME`. Disambiguates same-action transitions (`RATE→CLOSEDAFTERRESOLUTION` vs `…REJECTION`). |
| `audience` | string | ✓ | Role code to notify. `CITIZEN`=filer; `EMPLOYEE`=assignee alias; any other=role pool. `AUTO_ESCALATE`/`SYSTEM` are non-notifiable. |
| `channel` | enum | ✓ | `SMS` \| `WHATSAPP` \| `EMAIL`. |
| `fromState` | string\|null | — | **Documentation/UI only.** Ignored at runtime (see below). |
| `assigneeOnly` | boolean | — | If true and a named assignee exists, notify only the assignee instead of the whole role pool. |
| `active` | boolean | — | `false` rows are skipped by the router. |

`x-unique` = `[businessService, action, toState, audience, channel]` (`:250-256`) — so a
given transition can fan out to many audiences and channels, one row each.

### Runtime matching (the important subtlety)

`NotificationRouter.route` (`backend/pgr-services/.../service/notification/NotificationRouter.java:56-104`)
matches on **`action` + `toState` only**. It **ignores `fromState`** because the Kafka
notification-consumer path reconstructs the `ServiceRequest` from the record, which
carries only the resulting `applicationStatus` (toState) — not the source state.
`processConfigDriven` calls `route(tenantId, "PGR", null, action, toState)` with a null
`fromState` (`NotificationService.java:877`). If an author *does* set `fromState` on a
row, the router logs a WARN that the row will match **every** transition into that
`toState` (`NotificationRouter.java:71-79`). The schema `description` says the same
(`RAINMAKER-PGR.json:267`). **Leave `fromState` blank.**

The router also:
- drops rows with `active: false` (`:66`),
- drops the non-notifiable pseudo-audiences `AUTO_ESCALATE`/`SYSTEM` with a WARN (`:88-93`),
- drops rows whose `channel` is not one of SMS/WHATSAPP/EMAIL with a WARN (`:94-98`),
- does **not** validate `audience` against any enum — any role string is accepted and
  resolved downstream (`:28-31`).

### Dev seed vs live bomet

The dev seed (`RAINMAKER-PGR.NotificationRouting.json`) ships **24 rows** — the full
7-transition × {CITIZEN/EMPLOYEE} × {SMS/WHATSAPP/EMAIL} matrix.

**Live bomet `ke` is a curated subset** (verified via `/egov-mdms-service/v2/_search`
at `ke`): **10 routing rows** — SMS×5, WHATSAPP×3, EMAIL×2. Operators tune the live set
per deployment; the seed is the reference, not a guarantee of what a given tenant runs.

## 1.2 `RAINMAKER-PGR.NotificationTemplate` — the "what"

One row per `(audience, action, toState, channel, locale)` holding the message body
(and, for EMAIL, a subject). This replaces the egov-localization
`PGR_<ROLE>_<ACTION>_<STATUS>_SMS_MESSAGE` keys.

Schema (`RAINMAKER-PGR.json:301-373`):

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `audience` | string | ✓ | Same vocabulary as Routing. |
| `action` / `toState` | string | ✓ | Join dimensions. |
| `channel` | enum | ✓ | SMS \| WHATSAPP \| EMAIL. |
| `locale` | string | ✓ | e.g. `en_IN`, `hi_IN`, `sw_KE`. |
| `body` | string | ✓ | Message body with `{placeholder}` tokens. |
| `subject` | string\|null | — | EMAIL only; null for SMS/WHATSAPP. |
| `placeholders` | string[] | — | Declared tokens the body uses (documentation aid; not enforced). |
| `active` | boolean | — | `false` rows are skipped. |

`x-unique` = `[audience, action, toState, channel, locale]` (`:318-324`). It joins 1:1
with a NotificationRouting row on `(audience, action, toState, channel)`.

### How it's read + rendered

`TemplateRenderer` (`backend/pgr-services/.../service/notification/TemplateRenderer.java`):
- `render(...)` returns the filled `body`; `renderSubject(...)` returns the filled
  `subject` (`:36-50`).
- `findField(...)` (`:69-83`) linear-scans the cached rows and matches all five
  dimensions case-insensitively, skipping `active:false`.
- **Default-locale fallback** (`:55-58`): if no row matches the requested locale and
  `pgr.notification.default.locale` differs, it retries with the default locale. Returns
  `null` if still unmatched — the caller then skips that recipient/channel and logs
  (`NotificationService.java:946`, "template missing for this (audience,channel): skip").
- `substitute(...)` (`:85-94`) does a literal `{key}`→value replace; null values are
  skipped (leaving the literal token only if the placeholder map lacks it — the
  placeholder builder guards the common tokens with raw-value fallbacks, e.g.
  `complaint_type` falls back to the service code, `NotificationService.java:1131-1133`).

### Placeholder vocabulary

Tokens filled by `buildPlaceholderValues` (`NotificationService.java:1120-1184`):
`id`, `complaint_type`, `status`, `date`, `additional_comments`, `rating`,
`citizen_name`, `download_link`, `ulb`, `ao_designation`, `emp_name`,
`emp_department`, `emp_designation`. Note `{download_link}` calls the URL-shortener and
is isolated so an outage there blanks the link rather than aborting the whole message
(`:1147-1157`).

Example seed row (SMS, citizen, APPLY):

```json
{
  "audience": "CITIZEN", "action": "APPLY", "toState": "PENDINGFORASSIGNMENT",
  "channel": "SMS", "locale": "en_IN", "subject": null,
  "body": "Dear Citizen, Your complaint for {complaint_type} has been submitted with ID {id} on {date}. ...\n\nEGOVS",
  "placeholders": ["complaint_type", "date", "id"], "active": true
}
```

Live bomet `ke`: **10 template rows** (EMAIL×6, WHATSAPP×4 in the curated set) — again a
tuned subset of the seed.

## 1.3 `RAINMAKER-PGR.NotificationProviderTemplate` — the "how it's delivered"

One row per `(provider, channel, audience, action, toState, locale)` mapping a
notification to a provider's pre-registered template id and its **ordered** variables —
e.g. a Twilio WhatsApp **Content SID** (`HX…`).

Schema (`RAINMAKER-PGR.json:374-433+`):

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `provider` | string | ✓ | e.g. `twilio`. |
| `channel` | enum | ✓ | SMS \| WHATSAPP \| EMAIL. |
| `audience`/`action`/`toState`/`locale` | string | ✓ | Join dims (to NotificationTemplate). |
| `templateId` | string | ✓ | Provider-side id, e.g. a Twilio Content SID `HX...`. |
| `templateName` | string | — | Human label for the provider template. |
| `variables` | string[] | ✓ | Ordered variables the provider template expects (positional → Twilio `contentVariables` `{"1":…,"2":…}`). |
| `approvalStatus` | string | — | e.g. `approved` (WhatsApp templates need Meta approval). |
| `active` | boolean | — | |

`x-unique` = `[provider, channel, audience, action, toState, locale]` (`:393-400`).

### Who reads it

The schema `description` says novu-bridge reads it to select the `templateId` and fill
variables when a provider needs a pre-approved template. **In the shipped pass-through
path it is not consulted for normal delivery** — PGR pre-renders the body and novu-bridge
just emits `payload.body`. The one place a Content SID is used is the **configurator
test-send** (`ProviderController.testSend` → `buildWhatsappOverrides`,
`ProviderController.java:252-366`), where the operator supplies the `contentSid` and
positional `variables` directly in the request. So today this master is effectively a
**catalog of approved WhatsApp Content SIDs** that operators copy from when composing a
test send; the live-delivery WhatsApp workflow is not wired on bomet.

Live bomet `ke`: **10 provider-template rows, all WHATSAPP** (all Twilio Content SIDs,
`en_IN` + `hi_IN` pairs) — verified via the MDMS probe.

## 1.4 Caching + tenant inheritance

### Per-tenant cache with stale-serve

`MDMSUtils.getNotificationRouting` / `getNotificationTemplates`
(`backend/pgr-services/.../util/MDMSUtils.java:113-155`) cache the rows **per
state-level tenant** with TTL `pgr.notification.mdms.cache.ttl.ms` (60 s). Behaviour on
an empty/failed fetch is important:

- An **empty** fetch is treated as a transient miss OR an unseeded tenant — it is
  **never cached** (so the next event retries), and a previously cached **non-empty**
  entry is **served stale** rather than dropping notifications during an MDMS blip
  (`:126-130`).
- On an outright MDMS exception the fetch returns an empty list and logs that — with
  the config-driven flag on — **there is no legacy fallback**; notifications for that
  tenant are DROPPED (or served stale) until MDMS recovers or the tenant is seeded
  (`:158-172`).

### Tenant resolution: `ke` → `ke.bomet`

Both getters resolve the incoming tenant to its **state-level tenant** via
`MultiStateInstanceUtil.getStateLevelTenant(tenantId)` (`:114`, `:137`) and read the
masters at that level. A complaint filed at `ke.bomet` (city tenant) reads the routing
and template masters seeded at **`ke`** (state root). This matches every other PGR MDMS
master (ServiceDefs, etc. — see the memory note on ServiceDefs validated at STATE ROOT).
Seed these masters **once at `ke`**; every city under `ke` inherits them.

> Practical consequence: to change a message body for the whole deployment, edit the
> `NotificationTemplate` row at `ke`. There is no per-city override mechanism here —
> the read is always at the state root.
