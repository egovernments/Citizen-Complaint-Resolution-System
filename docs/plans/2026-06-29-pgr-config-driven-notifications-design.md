# PGR Config-Driven Notifications — Design

**Date:** 2026-06-29
**Status:** Built & deployed on Bomet — SMS + Email live via Novu → Twilio / Gmail-SMTP; WhatsApp live via Baileys (paired on Bomet). This doc has been reconciled to the as-built system; see [§4.4 As-built corrections](#44-as-built-corrections).
**Target deploy:** Bomet (`ke.bomet`, `bometfeedbackhub.digit.org`)
**Supersedes direction of:** PR #915 / MOZ_007 (no new `workflow-extension-service`; config in MDMS; all biz logic in PGR)
**Built in:** commit `ef8b617ec` (`feat: config-driven notifications`).

> **STATUS UPDATE (2026-07-02):** This doc describes the initial build (commit `ef8b617ec`) and is retained as history. The system has since evolved and been re-reviewed:
>
> - **Current authoritative design:** [2026-07-02-pgr-notifications-design.md](./2026-07-02-pgr-notifications-design.md), published as fork discussion [ChakshuGautam/Citizen-Complaint-Resolution-System#59](https://github.com/ChakshuGautam/Citizen-Complaint-Resolution-System/discussions/59). Biggest deltas vs this doc: `audience` is no longer the closed `{CITIZEN, EMPLOYEE}` enum — it is **any workflow role code** with role-pool fan-out (EMPLOYEE survives only as a legacy alias for the assignee); notifications are also authored inside `PgrWorkflowConfig.json` and split into the two MDMS masters at seed time by default-data-handler; the configurator gained a per-transition Configure tab, a static config checker, and read-only Logs/Providers screens.
> - **Baileys is re-classified as TEST-SCAFFOLDING, not a production provider.** Every "WhatsApp live via Baileys" statement below records what was built during the pilot, not what ships. Removal is planned in [2026-07-02-notification-findings-closure-plan.md](./2026-07-02-notification-findings-closure-plan.md). WhatsApp delivery is deferred to a legitimate provider (Meta WhatsApp Cloud API or Twilio WhatsApp as a Novu integration, behind a v2-native `complaints-whatsapp` workflow); until onboarded, `channel=WHATSAPP` terminates at the bridge as an explicit `SKIPPED`/`NB_NO_PROVIDER` dispatch-log row — never a thrown exception, never a fallback to SMS.
> - **Review corrections:** the 2026-07-02 PR review proved several statements in this doc wrong; each is flagged inline below with a callout in this same style. The full findings table is §5 of the 2026-07-02 design doc; closure steps are in the findings-closure plan; the accompanying test plan is executed via [2026-07-02-notification-test-plan-execution.md](./2026-07-02-notification-test-plan-execution.md).

---

## 1. Context & goals

PGR hardcodes **who** is notified on each workflow transition, in three places:

- `NotificationService.process()` — enable gate `NOTIFICATION_ENABLE_FOR_STATUS.contains(action+"_"+status)` (line 74) + per-transition **employee-phone resolution** (lines 86–116).
- `NotificationService.getFinalMessage()` — **7 hardcoded `if (status && action)` blocks** (lines 186–500) that decide whether a citizen and/or employee message is built.
- `ComplaintDomainEventService.getStakeholders()` — **transition-agnostic** (citizen + every assignee, always).

SMS bodies live in `egov-localization` keyed `PGR_<ROLE>_<ACTION>_<STATUS>_SMS_MESSAGE` (`NotificationUtil.getCustomizedMsg()` line 92).

**Goal:** make routing (the "who") and content (the "what") **data-driven via MDMS, editable in the configurator**, with **all orchestration, rendering, and localization in PGR**. PGR pre-renders and publishes per-recipient events to Kafka; novu-bridge is a thin pass-through that, per channel, **delivers through Novu providers** (SMS → Twilio, Email → Gmail/SMTP nodemailer) and **tracks** in Novu. WhatsApp is delivered **today via Baileys directly** (out-of-band over HTTP); wrapping it as a Novu provider so it tracks alongside SMS/Email is a backlog item (BACKLOG TASK-031, GitHub egovernments/CCRS#973).

> **STATUS UPDATE (2026-07-02):** Baileys was test-scaffolding only, not a production provider, and is being removed per [2026-07-02-notification-findings-closure-plan.md](./2026-07-02-notification-findings-closure-plan.md). TASK-031 / CCRS#973 no longer means "wrap Baileys" — the target is a legitimate provider (Meta WhatsApp Cloud API or Twilio WhatsApp via Novu, behind a v2-native `complaints-whatsapp` workflow). Until then, `channel=WHATSAPP` terminates at the bridge as `SKIPPED`/`NB_NO_PROVIDER`.

## 2. Locked decisions

| # | Decision |
|---|---|
| D1 | **No new microservice in PGR.** PGR is the only brain. (Delivery adds two small infra services: novu-bridge already existed; baileys-send-service is new.) |
| D2 | Config in **MDMS** (two masters), surfaced in the **configurator**. |
| D3 | **As built: routing rows carry a normalized `audience` enum `{CITIZEN, EMPLOYEE}`, not a `subscribers[]` array.** PGR's `SubscriberResolver` maps the closed relationship set (CITIZEN, ASSIGNEE, CREATOR, PREVIOUS_ASSIGNEE) onto those two audiences (CITIZEN → the citizen; EMPLOYEE → the current/last-ASSIGN assignee). Relationships are NOT RBAC roles. See [§4.4](#44-as-built-corrections). |
| D4 | **PGR renders + localizes BEFORE Kafka.** novu-bridge just delivers + tracks; the rendered body travels in the Novu trigger `payload.body`. |
| D5 | **Bring up Novu on Bomet** via the `notifications` Docker-Compose profile in `local-setup/`. SMS/Email flow `PGR → Kafka → novu-bridge → Novu provider`; WhatsApp flows `PGR → Kafka → novu-bridge → baileys-send-service` (direct, today). |
| D6 | Novu subscribers are **upserted (identify), not fetched** — idempotent by `subscriberId`, before the SMS/Email trigger. |
| D7 | **WhatsApp via Baileys** (free-form messages, no Twilio approved-template requirement). As built, novu-bridge calls baileys-send-service **directly** (Novu has no Baileys integration); registering Baileys as a Novu provider so it tracks in Novu is deferred (BACKLOG TASK-031, GitHub egovernments/CCRS#973). |
| D8 | Backward compatible: behind a feature flag (`pgr.notification.config.driven`), legacy path retained one release; Bomet seed reproduces current behavior. |

> **STATUS UPDATE (2026-07-02):** **D3 is superseded** — audience is now any workflow role code (role-pool fan-out via egov-user `roleCodes` search), not the closed `{CITIZEN, EMPLOYEE}` enum; see the 2026-07-02 design doc §4.1. **D5's WhatsApp branch and D7 are superseded** — Baileys is re-classified as test-scaffolding and is being removed per the findings-closure plan; WhatsApp delivery is deferred to a legitimate provider (Meta WhatsApp Cloud API or Twilio WhatsApp as a Novu integration, behind a v2-native `complaints-whatsapp` workflow), with `channel=WHATSAPP` terminating as `SKIPPED`/`NB_NO_PROVIDER` until then — never a fallback to another channel.

## 3. Architecture

```
Workflow transition (PGR _update: action → toState)
        │
        ▼
PGR  ── the only brain (no new service) ───────────────────────────────────
  1. read config 1 (MDMS RAINMAKER-PGR.NotificationRouting), FLATTENED — one row per
        (businessService, action, toState, audience{CITIZEN|EMPLOYEE}, channel{SMS|WHATSAPP|EMAIL})
        match on action+toState (fromState is doc-only; consumer path lacks it)
  2. resolve each audience → concrete user + contact (SubscriberResolver)
        CITIZEN → the citizen; EMPLOYEE → current assignee (or last ASSIGN from PI history)
  3. read config 2 (MDMS RAINMAKER-PGR.NotificationTemplate), joins 1:1 with routing:
        key (audience, action, toState, channel, locale) → body template
  4. RENDER + LOCALIZE fully here, BEFORE Kafka   (D4)
  5. publish ONE event per (recipient × channel) → complaints.domain.events
        { eventName, channel, subscriberId, contact{userId,type,name,phone,email,locale},
          renderedBody, subject, transactionId, data{...} }
        │
        ▼
Kafka → novu-bridge — thin pass-through delivery + tracking ONLY
  • SMS / EMAIL:  identify Novu subscriber (D6) then trigger the per-channel
                  Novu workflow (complaints-sms / complaints-email) with payload.body
                  = the pre-rendered text. NO template resolve, NO localization.
  • WHATSAPP:     POST {to,text} directly to baileys-send-service (Novu has no
                  Baileys integration today; see D7 / BACKLOG TASK-031 / CCRS#973)
  • nb_dispatch_log (idempotent on transactionId) + Novu's own delivery tracking
        │
        ▼
Novu providers:  SMS → Twilio        Email → Gmail / SMTP (nodemailer)
Direct:          WhatsApp → baileys-send-service (paired on Bomet)
```

**The inversion vs PR #915 / current code:** novu-bridge **stops** resolving templates from config-service and **stops** localization — PGR owns both. novu-bridge only identifies subscribers and delivers pre-rendered content **through Novu providers** (Twilio/Gmail) for SMS/Email, and out-of-band to Baileys for WhatsApp. This realizes the PR-body intent: "make it more pass-through, retain all biz logic inside PGR."

> **STATUS UPDATE (2026-07-02):** the `WHATSAPP → baileys-send-service` leg in the diagram above is being removed (Baileys = test-scaffolding; see the header callout). Post-removal, WHATSAPP events terminate at novu-bridge as `SKIPPED`/`NB_NO_PROVIDER` dispatch-log rows until a legitimate provider is onboarded. The review also corrected two tracking claims implicit here: (1) delivery **failures never persist a `FAILED` row** in `nb_dispatch_log` — provider exceptions propagate to the consumer, which only logs + DLQs (finding #3 in the 2026-07-02 design §5); (2) `getNovuWorkflowId`'s unknown/null-channel branch silently falls back to the **SMS** Novu workflow (finding #2). Both fixes are in the findings-closure plan.

## 4. MDMS masters (config 1 & config 2)

### 4.1 `RAINMAKER-PGR.NotificationRouting` (config 1 — the "who")

**As built: fully FLATTENED.** One MDMS record per **`(businessService, action, toState, audience, channel)`**. There is no `transitions[]` array and no `subscribers[]` array — `audience` is a scalar enum `{CITIZEN, EMPLOYEE}` and `channel` is a scalar enum `{SMS, WHATSAPP, EMAIL}`. Each routing row **joins 1:1 with exactly one `NotificationTemplate` row**. Runtime matching is on **`action + toState`**.

```jsonc
{ "businessService":"PGR", "fromState":null,
  "action":"ASSIGN", "toState":"PENDINGATLME",
  "audience":"CITIZEN", "channel":"SMS", "active":true }
```

- `audience` ∈ `{CITIZEN, EMPLOYEE}` (D3). The closed *relationship* set (CITIZEN/ASSIGNEE/CREATOR/PREVIOUS_ASSIGNEE) is collapsed onto these two audiences inside PGR's `SubscriberResolver` — it is NOT a stored array and NOT validated against `BusinessService.roles[]` (the blocker that broke PR #915's own seed).
- `channel` ∈ `{SMS, WHATSAPP, EMAIL}` (one row per channel; the Bomet seed enables all three for every active transition).
- `fromState` is **documentation/UI only**: runtime matching ignores it because the Kafka notification-consumer path reconstructs `ServiceRequest` from the record, which carries only the resulting `applicationStatus` (toState). Where the seed sets it (e.g. REASSIGN, RESOLVE, RATE) it disambiguates for a human reader.
- `x-unique = [businessService, action, toState, audience, channel]`.
- **MDMS schema** (`RAINMAKER-PGR.NotificationRouting`) ships with the master in `default-data-handler` so the configurator renders it.

**Why fully flattened (chosen).** The configurator renders MDMS masters as schema-driven editable datagrids and **skips array/object fields in the grid** (shown as read-only JSON). A nested `transitions[]` or even a `subscribers[]`/`channels[]` chip-array would not be cleanly grid-editable. Scalar-only rows make routing a plain datagrid with no custom editor, and the 1:1 join to `NotificationTemplate` means a row in the configurator's Notification Routing list maps to exactly one editable template. PGR reads all rows for the `businessService` and assembles the routing table in memory. The Bomet seed is **33 rows** (11 active transitions × 3 channels; 18 CITIZEN + 15 EMPLOYEE).

### 4.2 `RAINMAKER-PGR.NotificationTemplate` (config 2 — the "what")

**Key = `(audience, action, toState, channel, locale)`** — the same `(audience, action, toState, channel)` spine as the routing master plus `locale`, so each routing row joins **1:1** with a template row (33 routing rows ↔ 33 template rows in the Bomet seed, all `locale=en_IN` for now). `action+toState` disambiguates same-action transitions (RATE→CLOSEDAFTERRESOLUTION vs CLOSEDAFTERREJECTION). `eventName` (`COMPLAINTS.WORKFLOW.<action>`) is derived only for the emitted Kafka event, not the template key.

```jsonc
{
  "audience": "CITIZEN",             // CITIZEN | EMPLOYEE (normalized recipient class)
  "action": "ASSIGN",
  "toState": "PENDINGATLME",
  "channel": "SMS",                  // SMS | WHATSAPP | EMAIL
  "locale": "en_IN",                 // also sw_KE etc.
  "subject": null,                   // EMAIL only
  "body": "Dear Citizen, Your complaint for {complaint_type} with ID {id} ... assigned to {emp_name}, {emp_designation}, {emp_department}. ...\n\nEGOVS",
  "placeholders": ["complaint_type","date","emp_department","emp_designation","emp_name","id"],
  "active": true
}
```

- Placeholder vocabulary = the existing `{id}`, `{complaint_type}`, `{emp_name}`, `{emp_designation}`, `{emp_department}`, `{ulb}`, `{status}`, `{date}`, `{download_link}`, `{additional_comments}`, `{rating}`, etc. PGR's `TemplateRenderer` does a literal `{token}` → value substitution.
- `audience` is the normalized recipient class set by `SubscriberResolver`: any employee-type relationship (ASSIGNEE/CREATOR/PREVIOUS_ASSIGNEE) → `EMPLOYEE`; the citizen → `CITIZEN`. (Two-audience body model; can split per-relationship later if needed.)
- `subject` is non-null for EMAIL only; null for SMS/WHATSAPP.
- `x-unique = [audience, action, toState, channel, locale]`.
- **Note (R5):** legacy appended a second `PGR_DEFAULT_CITIZEN` message per citizen. The golden-output test gates whether dropping that suffix changes the citizen's delivered text; it was not migrated as a separate template row.
- **Migration:** existing localization `PGR_<ROLE>_<ACTION>_<STATUS>_SMS_MESSAGE` bodies were seeded into this master via a one-time curated mapping (NOT a naive `split('_')` — multi-token statuses like `CLOSEDAFTERRESOLUTION` break that). Helper: `utilities/default-data-handler/scripts/migrate-pgr-sms-templates.py`.

### 4.3 Tenant scoping (Bomet)

**As built: masters are seeded at the state-level tenant `ke`.** PGR's `MDMSUtils.getNotificationRouting/getNotificationTemplates` resolve via `MultiStateInstanceUtil.getStateLevelTenant(tenantId)`, i.e. they cache + query at `ke` (the root of `ke.bomet`), not the city tenant. The seed ships from `default-data-handler` with `tenantId="{tenantid}"` placeholder substitution, so it lands at the state root that PGR reads. This resolved the Phase-0 open item: seed at `ke`.

### 4.4 As-built corrections

Reconciliations made while building (commit `ef8b617ec`); the sections above already reflect them:

- **Routing flattened to scalars.** The planned `transitions[]` / `subscribers[]` / `channels[]` arrays were dropped in favour of one scalar row per `(businessService, action, toState, audience, channel)` — cleaner for the configurator datagrid and a 1:1 join to `NotificationTemplate` (33 ↔ 33).
- **`audience` replaces `subscribers[]`.** PGR resolves the relationship set to a normalized `{CITIZEN, EMPLOYEE}` audience; the routing/template masters store only that.
- **Matching is `action + toState` only.** `fromState` is kept as a documentation field but ignored at runtime (the notification consumer reconstructs `ServiceRequest` from the Kafka record, which lacks the source state).
- **REASSIGN lands on `PENDINGFORREASSIGNMENT`** (from `PENDINGATLME`), not `PENDINGATLME`. The legacy `PENDINGATLME && REASSIGN` block is dead code (no such transition in `PgrWorkflowConfig.json`) and is **excluded** from the seed.
- **Schema `description` must be ≤ 512 chars** — that is the MDMS schema column width. Both new schema descriptions were written under that limit (264 and 380 chars).
- **NovuClient has no connect timeout.** The `RestTemplate` bean (`MainConfiguration.restTemplate()`) is `new RestTemplate()` with no connect/read timeout configured — a slow/hung Novu or Baileys host can block the consumer thread until the socket default. Note for hardening (out of scope of this change).
- **Configurator must build `file:` sub-packages before `vite`.** `npm install` does not build the workspace sub-packages whose `package.json main` points at `dist/`; `files/configurator-build.sh` builds each `packages/*` first, then runs `vite build --base=/configurator/`.

---

## 5. Subscriber model (Novu) — upsert, don't fetch (D6)

Novu identifies subscribers idempotently by `subscriberId`. We **never GET-then-create**; we upsert.

- `subscriberId = tenantId + ":" + userUuid` (fallback `tenantId:mobile` for uuid-less citizens) — set by PGR in `NotificationService.publishRenderedEvent` and read by `DispatchPipelineService`.
- novu-bridge calls **`POST /v1/subscribers` (identify)** with the profile PGR resolved: `phone`, `email`, `firstName`/`lastName` (split from `contact.name`), `locale`, `data:{role, userId}` — then triggers (`NovuClient.identifyThenTrigger`). Identify runs only for SMS/Email (the Novu path); WhatsApp goes straight to Baileys.
- **Today there is no identify call** — `NovuClient.trigger()` only sets `to.subscriberId` + `to.phone` inline, so Novu never holds a real subscriber profile. This is the tracking gap; identify fixes it.
- Profile upsert is safe — Novu stores **preferences separately**, so re-identifying won't reset a citizen's channel preferences.
- **Efficiency:** identify guarded by a short-lived in-memory `subscriberId → identified` TTL cache to skip redundant calls (profiles rarely change).

> **STATUS UPDATE (2026-07-02):** "Identify runs only for SMS/Email; WhatsApp goes straight to Baileys" no longer applies — see the Baileys-removal callouts above. The review also noted the identify TTL map is evict-on-read only, so it grows without bound (nit; tracked in the findings-closure plan).

## 6. Code changes

### 6.1 PGR (`backend/pgr-services`)
- `MDMSUtils`: `getNotificationRouting(tenantId)` + `getNotificationTemplates(tenantId)` — cached at the **state-level tenant** (existing TTL-cache pattern).
- **`NotificationRouter`** (new): `route(tenantId, businessService, fromState, action, toState) → List<RoutingMatch>`. Matches the flat routing rows on `action+toState`. (`RoutingMatch` still holds the pre-flatten `subscribers/channels` arrays; PGR maps relationship→audience at emit time — see implementation P1-4.)
- **`TemplateRenderer`** (new): pick template from config 2 by **`(audience, action, toState, channel, locale)`**, fill placeholders, localize — replaces `getCustomizedMsg` + the hardcoded `getFinalMessage` blocks. **Localization happens here (D4).**
- **Recipient resolution stays in `NotificationService`** (AS BUILT — no standalone `SubscriberResolver` class): the private `ResolvedRecipient` + helpers resolve citizen + assignee/previous-assignee (via `getEmployeeName(..., ASSIGN)` PI-history) and normalize to the `{CITIZEN, EMPLOYEE}` audience.
- `NotificationService.processConfigDriven`: `for each routing match → resolve recipient → for each channel → render → publishRenderedEvent`. Skips the `NOTIFICATION_ENABLE_FOR_STATUS` gate + 7 if-blocks (legacy retained when flag off). Behind flag `pgr.notification.config.driven`.
- Per-event `transactionId = serviceRequestId:action:toState:subscriberId:channel` (idempotency, §10).

> **STATUS UPDATE (2026-07-02):** two claims in this section were proven wrong by review. (1) "cached at the state-level tenant (existing TTL-cache pattern)" — `notificationRoutingCache`/`notificationTemplateCache` actually have **no TTL or invalidation**: non-empty results are cached forever per state tenant, so configurator edits are invisible to pgr-services until a restart (finding #8 in the 2026-07-02 design §5). (2) "Localization happens here (D4)" is only half-true — **per-recipient localization is not implemented**: `processConfigDriven` renders every event in the instance default locale, so the template `locale` dimension and `contact.locale` are effectively dead until PGR resolves a real per-recipient locale (finding #13; fine for the single-locale pilot, now an explicitly documented limitation). Fixes tracked in the findings-closure plan.

### 6.2 novu-bridge (`backend/novu-bridge`)
- `DispatchPipelineService`: **stops** calling `ConfigServiceClient.resolveTemplate` + locale fallback (the whole `ConfigServiceClient` was deleted); reads pre-rendered `renderedBody`/`subject` + `contact` from the flat event and branches by channel.
- **SMS / EMAIL → Novu provider.** `NovuClient.identifyThenTrigger`: identify the subscriber (§5) then trigger a fixed per-channel Novu workflow — `complaints-sms` / `complaints-email` (`config.getNovuWorkflowId(channel)`) — with the rendered text in `payload.body`. Novu's integration delivers: **SMS → Twilio, Email → Gmail/SMTP (nodemailer)**, configured as Novu integrations (dashboard / bootstrap).
- **WHATSAPP → Baileys direct.** `BaileysSendClient.send(to, renderedBody)` POSTs `{to,text}` to `baileys-send-service` (E.164, Twilio `whatsapp:` prefix stripped). **As-built decision (R10): WhatsApp does NOT go through Novu** — Novu has no Baileys integration, so delivery + tracking for WhatsApp live in `nb_dispatch_log` + the Baileys logs. The new strategy `BaileysProviderStrategy` (`providerName=baileys`) exists for routing, and `WhatsAppBusinessApiProviderStrategy.supports()` was narrowed so it no longer shadows bare `whatsapp`. Wrapping Baileys as a first-class Novu provider so it tracks alongside SMS/Email is deferred (BACKLOG TASK-031, GitHub egovernments/CCRS#973).
- Keep `nb_dispatch_log` + retry/DLQ; unique key widened to `transaction_id` via Flyway migration `V20260701000000__extend_dispatch_unique_key.sql`.

> **STATUS UPDATE (2026-07-02):** the "WHATSAPP → Baileys direct" branch, `BaileysSendClient`, and `BaileysProviderStrategy` are being **removed** (Baileys = test-scaffolding). Replacement behavior: WHATSAPP delivery is gated behind a config flag (default off); when disabled, the bridge persists `SKIPPED`/`NB_NO_PROVIDER` via the existing preference-denied pattern and **never** falls through to the SMS workflow (`getNovuWorkflowId`'s default-to-SMS is fixed in the same change). The as-built claim "delivery + tracking for WhatsApp live in `nb_dispatch_log`" was also optimistic: delivery **failures** never persist a `FAILED` row today (finding #3). See the findings-closure plan.

### 6.3 Baileys WhatsApp send-service (`utilities/baileys-send-service`)
- Small Node/Express HTTP service wrapping Baileys (`makeWASocket` + `useMultiFileAuthState`), exposing `POST /send {to, text}`, `GET /healthz`, `GET /qr`, and a QR-pairing/auth-state volume. novu-bridge's `BaileysSendClient` calls `/send` directly for `channel=WHATSAPP`.
- ⚠️ Unofficial WhatsApp API — ToS risk / number-ban risk. Acceptable "for now"; revisit official WhatsApp Business API later.

> **STATUS UPDATE (2026-07-02):** `utilities/baileys-send-service/` is deleted wholesale in the Baileys removal (module + Dockerfile + compose block + `baileys_auth_data` volume + Ansible/env variables; the paired device is unlinked and the send token discarded). The ToS/ban-risk caveat above is one of the reasons Baileys was never a legitimate production provider.

## 7. What you (operator) must provide per channel

| Channel | What's needed from you | Where it's configured |
|---|---|---|
| **SMS** | **Twilio** `ACCOUNT_SID` / `AUTH_TOKEN` / `FROM` number (approved for Kenya). | Novu SMS integration (Twilio). Live on Bomet. |
| **Email** | **Gmail / SMTP** host/port/user/pass (nodemailer) and a verified "from" address (SPF/DKIM for deliverability). | Novu email integration. Live on Bomet. |
| **WhatsApp (Baileys)** | A dedicated **WhatsApp number/account** to pair (scan QR once), agreement to persist Baileys **auth state** (volume), acceptance of unofficial-API risk. | baileys-send-service (direct, out-of-band over HTTP). Paired on Bomet. |

**As built:** all three are configured and live on Bomet — SMS via Twilio, Email via Gmail/SMTP, both through Novu; WhatsApp via Baileys directly.

> **STATUS UPDATE (2026-07-02):** the WhatsApp (Baileys) row is obsolete — the service is decommissioned and the paired device unlinked per the findings-closure plan. The future WhatsApp prerequisite is a Meta WhatsApp Cloud API (or Twilio WhatsApp) account configured as a Novu integration behind a v2-native `complaints-whatsapp` workflow; until then WHATSAPP events log `SKIPPED`/`NB_NO_PROVIDER`.

## 8. Infra — Novu on Bomet (D5)

**Deploy path:** Bomet deploys via `local-setup/ansible/deploy.sh bomet` (host_vars `inventory/host_vars/bomet.yml`, overlay `local-setup/docker-compose.bomet.yml`, `playbook-deploy.yml`). The old `tilt-demo/ansible/deploy-bomet.sh` is removed — ignore the stale root CLAUDE.md.

**The Novu stack already exists** in `local-setup/docker-compose.egov-digit.yaml` behind the **`notifications` compose profile** (`novu-mongo`, `novu-api`, `novu-worker`, `novu-ws`, `novu-dashboard`, `novu-bridge`, `novu-bridge-endpoint`, `digit-user-preferences-service`, `otp-publisher`). So this is **enable + configure**, not port. As built, Bomet sets `enable_novu: true` in host_vars (the playbook appends `notifications` to `COMPOSE_PROFILES`):

- **Novu bootstrapped via API** — org **Bomet**, two environments **Development + Production** — with the SMS/Email/WhatsApp integrations and the `complaints-sms` / `complaints-email` / `complaints-whatsapp` workflows (whose definitions live in `novu-bridge-endpoint/workflows.js`). Two-pass: deploy → sign up at `/novu/` → paste `NOVU_API_KEY` into host_vars → redeploy.
- **Providers:** SMS → **Twilio** (`TWILIO_ACCOUNT_SID`/`AUTH_TOKEN`/`FROM`); Email → **Gmail / SMTP via nodemailer** (Novu email integration). Both configured operator-side; live on Bomet.
- Add the **one new service**: `baileys-send-service` (new compose block + image), profile-gated under `notifications`; paired on Bomet.
- ⚠️ **Ansible reverts server-side compose edits** (`playbook-deploy.yml` re-copies compose each run) → all changes in tracked files (`docker-compose.egov-digit.yaml`, `docker-compose.bomet.yml`, `host_vars/bomet.yml`, `digit.env.j2`); never `vi` on the box; named volumes declared in tracked compose.
- Build custom images (`pgr-services`, `novu-bridge`, `baileys`) on the CI server → push to registry `10.0.0.4:5000` → Bomet pulls.
- Topics: `complaints.domain.events`, `novu-bridge.retry`, `novu-bridge.dlq`.

> **STATUS UPDATE (2026-07-02):** the `baileys-send-service` compose block, `baileys_auth_data` volume, baileys image build/push, and the related env/host_vars entries are all removed by the Baileys decommission — see the findings-closure plan for the exact file-by-file removal scope.

## 9. Configurator

**As built:** both masters appear under a new top-level **Notifications** nav section (`Notification Routing` + `Notification Templates`, registered in `DigitLayout.tsx` + `i18nProvider.ts`). Both are registered in `resourceRegistry.ts` and given schema descriptors (`schemaDescriptors/notification-routing.ts`, `notification-template.ts`). Because the routing master is now **flat scalar fields only** (audience/channel are scalars, not arrays), no custom editor is needed — the generic schema-driven datagrid handles List/Show/Edit/Create for both masters. Operators edit routing + templates without code. The configurator is built by `local-setup/ansible/files/configurator-build.sh` (build `file:` sub-packages first, then `vite build --base=/configurator/`).

## 10. Rollout, idempotency, fallback

- **Feature flag** `pgr.notification.config.driven` (default off → on per tenant). Legacy path kept one release.
- **Seed = exact current behavior** (§11) so cutover is behaviorally a no-op; changes are config-only afterward.
- **Idempotency:** we now emit multiple events per transition (one per recipient×channel). Stable `transactionId` (§6.1) + `nb_dispatch_log` unique key prevent double-send on Kafka redelivery.
- **Failure isolation:** a per-recipient render/publish failure must not drop the others (the current code's single try/catch swallows the rest).

> **STATUS UPDATE (2026-07-02):** "prevent double-send on Kafka redelivery" overstated it — review found idempotency is **log-level only**: the bridge never consults `nb_dispatch_log` before delivering, so a redelivery re-triggers the send. Safe today only because Novu dedupes triggers on `transactionId`; the (now-removed) Baileys HTTP path had no dedupe at all and would double-message on redelivery (finding #15 in the 2026-07-02 design §5). A pre-send SENT-row check is tracked in the findings-closure plan; redelivery tests are G3 in the test-plan-execution doc.

## 11. Behavior table — seed source of truth

Derived from current code (subject to Bomet's actual `NOTIFICATION_ENABLE_FOR_STATUS`); each row verified against `PgrWorkflowConfig.json` before seeding:

Validated against `PgrWorkflowConfig.json` (key = `action + toState`; `ASSIGNEE` resolves to the current workflow assignee, falling back to the last ASSIGN from process-instance history for REOPEN/RATE):

| action → toState | CITIZEN | ASSIGNEE | note |
|---|---|---|---|
| APPLY → PENDINGFORASSIGNMENT | ✅ | — | confirmation |
| ASSIGN → PENDINGATLME | ✅ | ✅ | from PENDINGFORASSIGNMENT **or** PENDINGFORREASSIGNMENT |
| REASSIGN → **PENDINGFORREASSIGNMENT** | ✅ | ✅ | from PENDINGATLME |
| REJECT → REJECTED | ✅ | — | |
| RESOLVE → RESOLVED | ✅ | — | |
| REOPEN → PENDINGFORASSIGNMENT | ✅ | ✅ | assignee via ASSIGN history |
| RATE → CLOSEDAFTERRESOLUTION | — | ✅ | assignee via ASSIGN history |
| RATE → CLOSEDAFTERREJECTION | — | ✅ | assignee via ASSIGN history |

⚠️ Corrections vs the original spec & my first draft: REASSIGN lands on **PENDINGFORREASSIGNMENT** (not PENDINGATLME); the legacy `PENDINGATLME && REASSIGN` block is **dead code** (REASSIGN never lands on PENDINGATLME) and is excluded. `action + toState` disambiguates APPLY vs REOPEN (shared toState) and the two RATE targets.

**As built:** the 8 transitions above expand to **11 audience-rows** (a CITIZEN and/or EMPLOYEE row per transition: 6 CITIZEN + 5 EMPLOYEE). Flattened across the 3 channels {SMS, WHATSAPP, EMAIL}, that is **33 NotificationRouting rows joining 1:1 with 33 NotificationTemplate rows** (18 CITIZEN + 15 EMPLOYEE), all `locale=en_IN`. Seeded + cross-checked (0 missing, 0 orphan). The seed enables all three channels for every active transition; trimming a channel is a config-only edit.

## 12. End-to-end testing strategy

### 12.1 Unit (PGR)
- `NotificationRouter`: table of `(transition) → expected subscriberGroups` for every row in §11.
- `SubscriberResolver`: each group → correct user/contact, incl. PI-history (assignee, previous-assignee), and null-safety (no citizen uuid, no assignee).
- `TemplateRenderer`: placeholder substitution + locale selection + missing-template fallback.

### 12.2 Backward-compatibility (the critical gate)
- **Golden-output test:** for each §11 transition, assert the set of `(recipient, channel, renderedBody)` events from the **config-driven path** equals what the **legacy path** produced (same fixtures, flag on vs off). The cutover must be a behavioral no-op. This is what would have caught PR #915's dropped-recipient narrowing.

### 12.3 Integration (CI server, per `ci-testing` skill)
- Seed routing + template masters; drive real PGR transitions (file → assign → resolve → rate) via API; assert events on `complaints.domain.events` (subscriberId, channel, renderedBody, transactionId).
- **Idempotency:** replay a Kafka event; assert `nb_dispatch_log` dedups (one delivery).
- **Tenant scoping:** confirm `ke.bomet` resolves the seeded master.

### 12.4 novu-bridge
- Subscriber **identify upsert**: first event creates subscriber, second updates (mock Novu, assert `POST /v1/subscribers` payload incl. profile + `data`).
- Provider routing: SMS→gateway strategy, EMAIL→email, WHATSAPP→Baileys.
- Pass-through: bridge does NOT call config-service template resolve.

### 12.5 Channel delivery (staging/Bomet)
- **SMS:** real send to a test MSISDN; confirm receipt + Novu activity feed shows the subscriber + delivery status.
- **Email:** real send; confirm inbox + Novu tracking.
- **WhatsApp (Baileys):** paired test number; `baileys-test.js`-style send; confirm receipt + bridge dispatch_log.
- **Tracking:** verify each subscriber appears in the Novu dashboard with profile + per-message delivery status (the gap we're closing).

> **STATUS UPDATE (2026-07-02):** the §12.4 "WHATSAPP→Baileys" routing assertion and the §12.5 Baileys delivery check are obsolete post-removal. Their replacement is the WHATSAPP-no-provider safe-skip assertions — unit test G2 and e2e assertion G18 in [2026-07-02-notification-test-plan-execution.md](./2026-07-02-notification-test-plan-execution.md), which also lock in "never a fallback to SMS".

### 12.6 E2E (UI, Playwright — optional)
- Citizen files → employee assigns → resolves on Bomet UI; assert the citizen/assignee receive the expected SMS/WhatsApp at each step (smoke-level, against the seeded config).

## 13. Phasing (as built)

- **Phase 0 — DONE.** 2 MDMS masters + schemas authored in `default-data-handler`; Bomet seed (33 routing ↔ 33 templates) reproducing §11; both registered + editable in the configurator.
- **Phase 1 — DONE.** PGR refactor (`NotificationRouter` + `TemplateRenderer` + `processConfigDriven`/`publishRenderedEvent`) behind flag `pgr.notification.config.driven`; emits pre-rendered per-recipient×channel events; golden-output + unit + emission tests green.
- **Phase 2 — DONE.** Novu + baileys-send-service up on Bomet (`notifications` profile); novu-bridge pass-through + identify + Baileys send client; `nb_dispatch_log` keyed on transactionId.
- **Phase 3 — LIVE on Bomet.** Flag on (overlay). **SMS + Email live via Novu → Twilio / Gmail-SMTP; WhatsApp live via Baileys (paired).** Tracking for SMS/Email visible in Novu; WhatsApp tracking in `nb_dispatch_log`.

> **STATUS UPDATE (2026-07-02):** Phase 2/3's "WhatsApp live via Baileys (paired)" records the pilot state, not the shipping state — Baileys is decommissioned (container + volume removed, device unlinked, token discarded) per the findings-closure plan. `channel=WHATSAPP` terminates as `SKIPPED`/`NB_NO_PROVIDER` until a legitimate provider (Meta WhatsApp Cloud API or Twilio WhatsApp via Novu) is onboarded.

## 14. Open items / risks
- Baileys = unofficial WhatsApp (ban risk). Paired on Bomet; monitor for number bans / IP blocks.
- **Backlog:** wrap WhatsApp delivery as a first-class Novu provider so it tracks alongside SMS/Email — BACKLOG TASK-031, GitHub egovernments/CCRS#973.
- **Backlog:** sync templates edited in the Novu editor back to MDMS (MDMS is source of truth) — TASK-030, GitHub egovernments/CCRS#972.
- NovuClient/Baileys calls use a `RestTemplate` with no connect/read timeout (§4.4) — hardening candidate.
- `digit-user-preferences-service` gates per-channel delivery; PGR owns locale. Set `NOVU_BRIDGE_PREFERENCE_ENABLED=false` to disable the gate.

> **STATUS UPDATE (2026-07-02):** this list is superseded as follows. The Baileys ban-risk item is **obsolete** — Baileys is removed outright as test-scaffolding, and BACKLOG TASK-031 / CCRS#973 now targets onboarding the legitimate WhatsApp provider (Meta WhatsApp Cloud API or Twilio WhatsApp via Novu, v2-native `complaints-whatsapp` workflow), not wrapping Baileys. The RestTemplate-timeout item was confirmed by review as a real consumer-stalling hazard (finding #4) and is fixed in the findings-closure plan; the Novu→MDMS template-sync item (TASK-030 / CCRS#972) and the consent-gate rollout remain live. The full 2026-07-02 review findings table (24 rows, incl. items this doc predates: no `FAILED` dispatch rows, unauthenticated `/novu-adapter/v1/*` proxy, unpaginated role-pool search, per-channel contact filtering) is in [2026-07-02-pgr-notifications-design.md](./2026-07-02-pgr-notifications-design.md) §5, closed via [2026-07-02-notification-findings-closure-plan.md](./2026-07-02-notification-findings-closure-plan.md).
