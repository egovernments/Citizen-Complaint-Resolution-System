# Config-Driven PGR Notifications — Deep Guide

> Authoritative, code-referenced documentation for the config-driven complaint (PGR)
> notification pipeline shipped in **CCRS PR #1059** and **live on bomet** (`ke`).
>
> Every claim here cites `file:line` against the source at the tree this guide was
> written from. Where a fact was checked against the live bomet deployment, the probe
> that verified it is called out inline.

This guide supersedes the older, narrower design notes in
[`docs/Novu_Adapter/NovuAdapter_LLD.md`](../Novu_Adapter/NovuAdapter_LLD.md) (a
"Phase-1" plan where **novu-bridge** resolved templates/providers from Config Service
and gated on preferences — none of which is how the shipped system works) and the
operator runbook in [`docs/notification-onboarding/`](../notification-onboarding/).
Read those for historical context only; **this** guide describes the code as it runs.

## Table of contents

| # | Doc | What it covers |
|---|-----|----------------|
| 1 | **This file** | End-to-end architecture + the sequence diagram |
| 2 | [`01-mdms-masters.md`](01-mdms-masters.md) | The 3 MDMS masters: Routing, Template, ProviderTemplate — shape, uid schemes, authoring, tenant inheritance |
| 3 | [`02-novu-bridge.md`](02-novu-bridge.md) | novu-bridge as a pass-through: 7-route proxy API, ProxyAuthFilter, the dispatch pipeline states (SENT/SKIPPED/FAILED + `NB_*` codes), PII masking, idempotency/DLQ |
| 4 | [`03-channels-providers.md`](03-channels-providers.md) | Channel gate, provider self-service (add/verify/test-send/pull-templates), Twilio + Gmail SMTP, WhatsApp-via-Twilio, preferences/consent (gated off) |
| 5 | [`04-localization.md`](04-localization.md) | Template locale selection, `en_IN`/`hi_IN`, the current single-locale reality |
| 6 | [`05-operations.md`](05-operations.md) | Runbooks: add a routing rule + template, onboard a provider, read the dispatch log, failure-code reference |

---

## 1. What "config-driven" means

Historically PGR notifications were **hardcoded**: a fixed
`NOTIFICATION_ENABLE_FOR_STATUS` gate plus a ladder of per-transition `if`-blocks in
`NotificationService`, each hand-picking a recipient and pulling a message from
egov-localization (`PGR_<ROLE>_<ACTION>_<STATUS>_SMS_MESSAGE`). That legacy path is
still in the file (`NotificationService.getFinalMessage`, lines 189‑550) and still runs
when the feature flag is off.

The new path replaces **both** the gate and the `if`-ladder with **three MDMS masters**:

- **`RAINMAKER-PGR.NotificationRouting`** — the *who/how*: which audiences get notified
  on which channels for a given `(businessService, action, toState)` transition.
- **`RAINMAKER-PGR.NotificationTemplate`** — the *what*: the message body (and EMAIL
  subject) per `(audience, action, toState, channel, locale)`.
- **`RAINMAKER-PGR.NotificationProviderTemplate`** — the *how-it's-delivered*: maps a
  notification to a provider's pre-approved template id (e.g. a Twilio WhatsApp Content
  SID) and its ordered variables.

The switch is a single flag: `pgr.notification.config.driven` (default `false`).
`backend/pgr-services/.../service/NotificationService.java:78-84` — when `true`,
`process()` delegates to `processConfigDriven()` and returns; otherwise the verbatim
legacy behaviour runs.

## 2. The two services and the boundary between them

```
                pgr-services (the BRAIN)                     novu-bridge (the HANDS)
   ┌────────────────────────────────────────────┐   ┌────────────────────────────────────┐
   │ route  → render → resolve recipients →      │   │ validate → gate → identify → trigger│
   │ publish ONE pre-rendered event per          │──▶│ Novu → record every outcome in      │
   │ (recipient × channel)                       │   │ nb_dispatch_log                     │
   └────────────────────────────────────────────┘   └────────────────────────────────────┘
             Kafka topic: complaints.domain.events ─────────────┘
```

The design decision that defines the whole feature: **pgr-services does ALL the
thinking** (routing match, recipient resolution, localization, placeholder
substitution) and emits a **fully pre-rendered** message. **novu-bridge does NO
resolution** — no template lookup, no provider selection, no localization. It is a
pass-through that validates the envelope, applies delivery gates, upserts the Novu
subscriber, triggers a fixed per-channel Novu workflow with the body already in the
payload, and logs the result.

This is a deliberate reversal of the old Phase-1 LLD (which put template/provider/
preference resolution *inside* novu-bridge). The `DispatchPipelineService` class
javadoc states it plainly: *"novu-bridge therefore does NOT resolve templates,
providers, or localization"* (`backend/novu-bridge/.../service/DispatchPipelineService.java:18-30`).

## 3. End-to-end flow

1. A citizen or employee drives a **PGR workflow transition** (APPLY, ASSIGN, REASSIGN,
   REJECT, RESOLVE, REOPEN, RATE). pgr-services persists the complaint and the
   notification consumer invokes `NotificationService.process(request, topic)`.

2. **Flag check** (`NotificationService.java:81`): if `pgr.notification.config.driven`
   is true → `processConfigDriven()` (`:867`).

3. **Route** — `NotificationRouter.route(tenantId, "PGR", null, action, toState)`
   (`:877`) reads the cached `NotificationRouting` rows and returns one `RoutingMatch`
   `(audience, channel, assigneeOnly)` per matching, active row
   (`NotificationRouter.java:56-104`). Matching is on `action` + `toState` only —
   `fromState` is **documentation-only** and ignored at runtime (`:71-79` logs a WARN if
   an author sets it).

4. **Placeholders** — `buildPlaceholderValues(request)` (`:1120`) assembles the token
   map (`id`, `complaint_type`, `status`, `date`, `emp_name`, `ulb`, `download_link`,
   `rating`, `additional_comments`, …), each field isolated in its own try so one
   failing lookup can't blank the rest.

5. **Resolve recipients** — for each match, `resolveByAudience(audience, assigneeOnly,
   request)` (`:968`):
   - `CITIZEN` → the complaint's filer.
   - `EMPLOYEE` → the single assignee (legacy alias).
   - any other role code → the **role pool**: every tenant user holding that role, via
     egov-user `_search` with a `roleCodes` filter run as the internal SYSTEM user
     (`resolveUsersByRole`, `:1002`), paged (`pgr.notification.rolepool.page.size` ×
     `.max.pages`). `assigneeOnly=true` collapses the pool to just the assignee.
   - Recipients are **memoized** per `(audience, assigneeOnly)` so a role authored on
     SMS+WHATSAPP+EMAIL triggers ONE user search, not three (`:887-906`).

6. **Render** — `TemplateRenderer.render(...)` (`:933`) looks up the
   `NotificationTemplate` body for `(audience, action, toState, channel, locale)` and
   substitutes `{tokens}`. For EMAIL it also renders the `subject` and falls back to
   `"Complaint <id>"` if blank (Novu's email step rejects an empty subject) (`:938-943`).

7. **Per-recipient contact gate + dedupe** — a recipient must have the contact the
   channel needs (EMAIL→email, SMS/WHATSAPP→phone) (`:919-926`); a `(channel,
   subscriber)` dedupe key ensures a user holding two notified roles gets ONE message
   per channel (`:927-930`).

8. **Publish** — `publishRenderedEvent(...)` (`:1197`) pushes **one event per
   (recipient × channel)** to `complaints.domain.events` (config
   `complaintsDomainEventsTopic`). The event is flat and pre-rendered: `channel`,
   `subscriberId` (`tenantId:userUuid`, or `tenantId:phone` if no uuid), `contact`
   block, `renderedBody`, `subject`, `transactionId`
   (`serviceRequestId:action:toState:subscriberId:channel`), and a `data` block.

9. **Double-emit guard** — `ComplaintDomainEventService.publishWorkflowTransitionEvent`
   also targets this topic (the coarse legacy `stakeholders[]` event). When the
   config-driven flag is on it **returns early** (`ComplaintDomainEventService.java:51-53`)
   so the topic never carries both shapes at once.

10. **Consume** — `DomainEventConsumer.listen` (`backend/novu-bridge/.../consumer/DomainEventConsumer.java:37`)
    reads the topic and calls `DispatchPipelineService.process(event, true, null)`. On
    any exception it publishes to the **DLQ** topic (`:51-57`).

11. **Validate + gate + deliver** — `DispatchPipelineService.process` (`:58-188`):
    validate envelope → optional preference gate → channel-known gate → channel-enabled
    gate → contact gate → `NovuClient.identifyThenTrigger` → Novu → record the terminal
    status in `nb_dispatch_log`. (Full state table in
    [`02-novu-bridge.md`](02-novu-bridge.md).)

12. **Novu → provider** — Novu triggers the fixed per-channel workflow
    (`complaints-sms` / `complaints-email` / `complaints-whatsapp`) whose step emits
    `payload.body`, and the configured Novu **integration** delivers: Twilio for SMS,
    Gmail SMTP (nodemailer) for email. WhatsApp rides the Twilio `sms` integration with
    a `whatsapp:` sender (test-send path only — no production WhatsApp workflow/provider
    on bomet today, so live WHATSAPP events are `SKIPPED / NB_NO_PROVIDER`).

## 4. Sequence diagram

```
Citizen/Employee   pgr-services                     Kafka                novu-bridge                    Novu            Twilio/SMTP
      │                 │                              │                       │                          │                 │
      │ workflow txn    │                              │                       │                          │                 │
      ├────────────────▶│ NotificationService.process │                       │                          │                 │
      │                 │  flag? processConfigDriven   │                       │                          │                 │
      │                 │                              │                       │                          │                 │
      │                 │ NotificationRouter.route ────┤ (reads MDMS           │                          │                 │
      │                 │   → [RoutingMatch(aud,chan)] │   NotificationRouting)│                          │                 │
      │                 │ buildPlaceholderValues       │                       │                          │                 │
      │                 │ resolveByAudience ───────────┤ (egov-user _search    │                          │                 │
      │                 │   → [ResolvedRecipient]      │   roleCodes / citizen)│                          │                 │
      │                 │ TemplateRenderer.render ─────┤ (reads MDMS           │                          │                 │
      │                 │   → final body (+subject)    │   NotificationTemplate)│                         │                 │
      │                 │                              │                       │                          │                 │
      │                 │ publishRenderedEvent         │                       │                          │                 │
      │                 │  ONE event / recipient×chan  │                       │                          │                 │
      │                 ├─────────────────────────────▶│ complaints.domain.events                         │                 │
      │                 │                              ├──────────────────────▶│ DomainEventConsumer.listen                 │
      │                 │                              │                       │ DispatchPipelineService.process            │
      │                 │                              │                       │  1 EnvelopeValidator.validate              │
      │                 │                              │                       │  2 preference gate (OFF on bomet)          │
      │                 │                              │                       │  3 channel-known gate                      │
      │                 │                              │                       │  4 channel-enabled gate (SMS,EMAIL)        │
      │                 │                              │                       │  5 contact gate                            │
      │                 │                              │                       │ NovuClient.identify (upsert subscriber) ──▶│                 │
      │                 │                              │                       │ NovuClient.trigger(workflowId, body) ─────▶│ deliver ───────▶│
      │                 │                              │                       │ persist nb_dispatch_log(SENT/SKIPPED/FAILED)                 │
      │                 │                              │  on error ◀───────────┤ publishDlq → novu-bridge.dlq               │                 │
```

## 5. Feature flags & topics (pgr-services)

| Property | Default | Meaning | Source |
|----------|---------|---------|--------|
| `pgr.notification.config.driven` | `false` | Master switch for the config-driven path | `PGRConfiguration.java:250-251` |
| `pgr.notification.default.locale` | `en_IN` | Locale used for every recipient (single-locale pilot) | `:253-254` |
| `pgr.notification.rolepool.page.size` | `100` | egov-user page size for role-pool fan-out | `:256-257` |
| `pgr.notification.rolepool.max.pages` | `10` | hard cap on pooled holders (page × pages) | `:259-260` |
| `pgr.notification.mdms.cache.ttl.ms` | `60000` | per-tenant MDMS master cache TTL | `:262-263` |
| `persister`/`kafka` `complaintsDomainEventsTopic` | `complaints.domain.events` | the shared bridge topic | `:241` |
| `isComplaintsDomainEventEnabled` | — | gates the legacy coarse event | `:244` |

The domain-event topic constants (`COMPLAINTS_WORKFLOW_TRANSITIONED`,
`COMPLAINTS.WORKFLOW.<ACTION>`, producer `complaints-service`) live in
`ComplaintDomainEventService.java:23-27` and, for the pre-rendered event, inline in
`publishRenderedEvent` (`NotificationService.java:1224-1240`) and
`PGRConstants.EVENT_NAME_PREFIX` (`:174`).

## 6. What is NOT notified today (by design for bomet)

- **Escalation transitions** (`ESCALATE`, `RESOLVEBYSUPERVISOR`) have **no
  NotificationRouting rows** → they resolve to zero matches and no one is notified.
  The `AUTO_ESCALATE` and `SYSTEM` pseudo-audiences are additionally dropped by the
  router as non-notifiable (`NotificationRouter.java:44-46, 88-93`).
- **WHATSAPP** is authored in MDMS and routed, but has no enabled Novu provider/workflow
  on bomet, so every live WHATSAPP event lands as `SKIPPED / NB_NO_PROVIDER` (verified:
  live `/logs` at `ke` shows exactly this).
