# PGR Config-Driven Notifications — Implementation Plan

**Date:** 2026-06-29
**Status:** BUILT — Phases 0–2 implemented in commit `ef8b617ec`; Bomet cut over (Phase 3) with SMS + Email live via Novu → Twilio / Gmail-SMTP and WhatsApp live via Baileys. This plan has been reconciled to the as-built system; deltas are flagged inline with **AS BUILT** notes and consolidated in [§9 As-built deltas](#9-as-built-deltas).
**Branch:** `feat/pgr-notification-routing` (off `develop`)
**Design:** [2026-06-29-pgr-config-driven-notifications-design.md](./2026-06-29-pgr-config-driven-notifications-design.md)
**Target deploy:** Bomet (`ke.bomet`, `bometfeedbackhub.digit.org`)

> **AS BUILT (the biggest delta):** the routing master was **fully flattened** — one MDMS row per `(businessService, action, toState, audience{CITIZEN|EMPLOYEE}, channel{SMS|WHATSAPP|EMAIL})`, joining **1:1** with `NotificationTemplate` (Bomet seed: 33 routing ↔ 33 templates). There is no `subscribers[]`/`channels[]` array and no `transitions[]` document; `audience` replaces `subscribers[]`, and routing/templates match on `action+toState`. WhatsApp delivery is **direct to baileys-send-service** (not through Novu) — the Novu-provider wrap is BACKLOG TASK-031 (CCRS#973) and the Novu→MDMS template sync is TASK-030 (CCRS#972).

> Line references below predate the build and may drift from the source; the method/field name is the authoritative anchor.

---

## 1. Overview

We are replacing PGR's three hardcoded notification decision points — the `NOTIFICATION_ENABLE_FOR_STATUS` gate, the 7 hardcoded `if (status && action)` blocks in `getFinalMessage()`, and the transition-agnostic `ComplaintDomainEventService.getStakeholders()` — with two cached MDMS masters: **`RAINMAKER-PGR.NotificationRouting`** (the "who") and **`RAINMAKER-PGR.NotificationTemplate`** (the "what"). **AS BUILT, both are fully flattened scalar-row masters:** routing is one row per `(businessService, action, toState, audience, channel)` (audience ∈ {CITIZEN, EMPLOYEE}, channel ∈ {SMS, WHATSAPP, EMAIL}); each row joins 1:1 with a template keyed `(audience, action, toState, channel, locale)`. All orchestration, rendering, and localization stay inside PGR (D1/D4); PGR pre-renders one event per `(recipient × channel)` to `complaints.domain.events`, and **novu-bridge is a thin pass-through delivery+tracking layer**: for SMS/Email it upserts the Novu subscriber (identify, D6) then triggers the per-channel Novu workflow (`complaints-sms`/`complaints-email`) which delivers via the Novu provider (**Twilio** / **Gmail-SMTP nodemailer**); for WhatsApp it POSTs directly to the new self-hosted **baileys-send-service** (D7, free-form), because Novu has no Baileys integration. Everything is **behind a feature flag** (`pgr.notification.config.driven`, default off) with the legacy path retained one release; the Bomet seed reproduces current behavior so cutover is behaviorally a no-op (D8), guarded by a **golden-output backward-compat test**.

**Dependency order across components** (each strictly depends on the prior for an end-to-end pass):

```
Phase 0: MDMS schemas + Bomet seed + configurator
            │  (defines the event contract: closed subscriber enum, eventName=COMPLAINTS.WORKFLOW.<ACTION>,
            │   audience normalization, the §11 routing rows)
            ▼
Phase 1: PGR refactor behind flag (NotificationRouter + SubscriberResolver + TemplateRenderer)
            │  + unit tests + golden-output gate + CI verify on egov-ci
            │  (PGR now emits the per-recipient pre-rendered event shape)
            ▼
Phase 2: Novu + Baileys infra on Bomet (local-setup compose, NOT tilt-demo)
            │  + novu-bridge pass-through + identify + BaileysProviderStrategy + nb_dispatch_log key migration
            │  (consumes the new event shape; delivers + tracks)
            ▼
Phase 3: Bomet cutover — flag on, SMS first → WhatsApp → email + Novu tracking verify
```

Phase 0 and the early parts of Phase 1 can proceed in parallel (PGR code can be written against the schema contract before the seed lands on a live box). Phase 2 infra (compose blocks, Baileys image) can be authored in parallel with Phase 1, but **cannot be flipped on** until the new PGR and novu-bridge images are built. Phase 3 is gated on operator-supplied SMS/email/WhatsApp credentials (§6).

---

## 2. Phase 0–3 plan

### Phase 0 — MDMS masters + schemas + Bomet seed + configurator

Goal: both masters are authored, registered as schemas, seeded on Bomet to reproduce §11, and editable in the configurator. **No code yet flips on**; this defines the contract every later phase codes against.

**P0-1. Author the two MDMS schemas (draft-07) in the default-data-handler.** — DONE.
- File: `utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json` — appended two array elements after `RAINMAKER-PGR.ComplaintHierarchy`: `RAINMAKER-PGR.NotificationRouting` and `RAINMAKER-PGR.NotificationTemplate`, each as `{tenantId:'{tenantid}', code, description, isActive:true, definition:{...}}`.
- **AS BUILT — flattened scalar schemas, NOT nested `transitions[]`:**
  - `NotificationRouting.definition`: `required:[businessService,action,toState,audience,channel]`, `x-unique:[businessService,action,toState,audience,channel]`, `audience.enum=[CITIZEN,EMPLOYEE]` (D3), `channel.enum=[SMS,WHATSAPP,EMAIL]`, `fromState` doc-only (`type:["string","null"]`), `active:boolean`, `additionalProperties:false`. No `transitions[]`, no `subscribers[]`/`channels[]` arrays.
  - `NotificationTemplate.definition`: `required:[audience,action,toState,channel,locale,body]`, `x-unique:[audience,action,toState,channel,locale]` (composite key — no synthetic `code` field was needed), `audience.enum=[CITIZEN,EMPLOYEE]`, `channel.enum=[SMS,WHATSAPP,EMAIL]`, `subject:["string","null"]`, `placeholders:[string]`, `active:boolean`, `additionalProperties:false`.
- **AS-BUILT CORRECTION:** the schema `description` column in MDMS is **≤ 512 chars** — both descriptions were written under that (264 / 380 chars).
- **Acceptance:** `RAINMAKER-PGR.json` is valid JSON (array); both objects parse; enums match D3 + channel set; descriptions ≤ 512 chars.

**P0-2. Register the schema codes authoritatively.**
- File: `utilities/default-data-handler/src/main/resources/application.properties` — append `,RAINMAKER-PGR.NotificationRouting,RAINMAKER-PGR.NotificationTemplate` to `default.mdms.schema.create.list` (line 54) and to the PGR entry in `mdms.schemacode.map` (line 55). (Note: `createMdmsSchemaFromFile` already globs `classpath:schema/*.json` — `DataHandlerService.java:232` — so registration also happens implicitly; the list keeps it authoritative.)
- **Acceptance:** schema setup on a fresh tenant creates both schemas; `mdms_schema_search` returns them.

**P0-3. Schema parity for nairobi-mdms tenants.** — N/A as built.
- The masters ship from `default-data-handler` (P0-1) with `tenantId:'{tenantid}'` substitution; that is the single source. No separate `nairobi-mdms/.../RAINMAKER-PGR/Notification*.json` parity files were created.

**P0-4. Confirm tenant scoping level.** — DONE: **seed at the state-level tenant `ke`.**
- **AS BUILT:** `MDMSUtils.getNotificationRouting/getNotificationTemplates` resolve via `MultiStateInstanceUtil.getStateLevelTenant(tenantId)` — i.e. they cache + query at `ke` (root of `ke.bomet`). The `{tenantid}`-substituted seed lands at that state root, so PGR reads it. No `ke.bomet`-level seed is needed.

**P0-5. Seed `RAINMAKER-PGR.NotificationRouting` (flattened, one row per audience×channel).** — DONE.
- File AS BUILT: `utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationRouting.json` — a **JSON array of 33 scalar rows**, each `{businessService:"PGR", fromState, action, toState, audience, channel, active}`. NOT a single `transitions[]` document. Derived from §11 **validated against `PgrWorkflowConfig.json`**, then crossed with all three channels:
  - APPLY→PENDINGFORASSIGNMENT: CITIZEN
  - ASSIGN→PENDINGATLME: CITIZEN + EMPLOYEE
  - **REASSIGN: fromState=PENDINGATLME→PENDINGFORREASSIGNMENT** CITIZEN + EMPLOYEE
  - REJECT→REJECTED: CITIZEN
  - RESOLVE→RESOLVED (fromState=PENDINGATLME): CITIZEN
  - REOPEN→PENDINGFORASSIGNMENT: CITIZEN + EMPLOYEE
  - RATE→CLOSEDAFTERRESOLUTION (fromState=RESOLVED) and RATE→CLOSEDAFTERREJECTION (fromState=REJECTED): EMPLOYEE
  - **AS BUILT: all three channels {SMS, WHATSAPP, EMAIL} seeded** for every active transition (not SMS-only) — that is why the seed is 33 rows. The cutover relies on the golden test for SMS parity; WHATSAPP/EMAIL are net-new.
  - **EXCLUDE the ghost row** `PENDINGFORREASSIGNMENT·REASSIGN` — no such transition in `PgrWorkflowConfig.json`.
- **Acceptance:** every seeded row has a matching real transition; no ghost rows; loaded by `MdmsBulkLoader` (schemaCode from filename, tenantId from `{tenantid}`).

**P0-6. Seed `RAINMAKER-PGR.NotificationTemplate` (one row per audience×action×toState×channel×locale).** — DONE.
- File AS BUILT: `utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationTemplate.json` — a **JSON array of 33 rows**, each `{audience, action, toState, channel, locale:"en_IN", subject, body, placeholders[], active}`, joining 1:1 with the routing rows. SMS bodies lifted from the legacy `rainmaker-pgr.json` `PGR_*_SMS_MESSAGE` keys via the **curated mapping** (NOT `split('_')`); WHATSAPP/EMAIL bodies adapted from the SMS body. **No synthetic `code` field** — the composite `(audience,action,toState,channel,locale)` is the `x-unique` key. Migration helper: `utilities/default-data-handler/scripts/migrate-pgr-sms-templates.py`.
  - 18 CITIZEN rows (APPLY, ASSIGN, REASSIGN, REJECT, RESOLVE, REOPEN × 3 channels) + 15 EMPLOYEE rows (ASSIGN, REASSIGN, REOPEN, RATE→CLOSEDAFTERRESOLUTION, RATE→CLOSEDAFTERREJECTION × 3 channels).
  - **Note:** the legacy `PGR_DEFAULT_CITIZEN` suffix was NOT migrated as a row — gated by the golden-output test (P1-9).
- **Acceptance:** every routing row has a matching template row (0 missing / 0 orphan); SMS bodies byte-identical to legacy for the golden test.

**P0-7. Configurator: register both resources.** — DONE.
- File: `configurator/packages/data-provider/src/providers/resourceRegistry.ts` — added (AS BUILT, `idField`/`nameField` = `action` since the seed has no `code`/`eventName` field):
  - `'notification-routing':  { type:'mdms', label:'PGR Notification Routing',  schema:'RAINMAKER-PGR.NotificationRouting',  idField:'action', nameField:'action' }`
  - `'notification-template': { type:'mdms', label:'PGR Notification Templates', schema:'RAINMAKER-PGR.NotificationTemplate', idField:'action', nameField:'action' }`
- **Acceptance:** both appear in the configurator's MDMS resource list with working List/Show/Edit/Create.

**P0-8. Configurator: friendly form for `NotificationTemplate` (all scalar/string[] — no custom editor).** — DONE.
- File: `configurator/src/admin/schemaDescriptors/notification-template.ts` — descriptor groups `{Key:[audience,action,toState,channel,locale]}`, `{Content:[subject,body,placeholders,active]}`; `body→'textarea'`, `placeholders→'chip-array'`. **AS BUILT the key is `(audience,action,toState,channel,locale)`** — there is no `code` or `eventName` field.
- File: `configurator/src/admin/schemaDescriptors/index.ts` — import + register both descriptors.
- **Acceptance:** Create/Edit renders body as multiline and placeholders as chips; save persists via the generic provider.

**P0-9. Configurator: `NotificationRouting` form.** — DONE (no custom editor; flattened model made the planned array-of-objects editor unnecessary).
- **AS BUILT — NO custom editor needed.** Because routing was flattened to scalar fields (audience/channel are scalars, not arrays), the generic schema-driven datagrid handles List/Show/Edit/Create. The planned `TransitionRoutingEditor.tsx` / `customEditor` wiring was **not built**.
- File: `configurator/src/admin/schemaDescriptors/notification-routing.ts` — plain descriptor grouping `{Transition:[businessService,fromState,action,toState]}`, `{Routing:[audience,channel,active]}` (scalar fields only, no chip-arrays).
- File: `configurator/src/admin/schemaDescriptors/index.ts` — register `notificationRoutingDescriptor`.
- **Acceptance:** routing rows are inline-editable scalar fields and persist via the generic provider; reload shows the saved rows.

**P0-10. Configurator: navigation + i18n.** — DONE.
- **AS BUILT:** a new **top-level `Notifications` nav group** was added (not under `complaint_management`), with two items `Notification Routing` (`Bell`) and `Notification Templates` (`Mail`), paths `/manage/notification-routing` and `/manage/notification-template`, in `configurator/src/admin/DigitLayout.tsx`.
- File: `configurator/src/providers/i18nProvider.ts` — added `app.nav.notifications`, `app.nav.notification_routing`, `app.nav.notification_templates`.
- The configurator is built via `local-setup/ansible/files/configurator-build.sh`: **build each `file:` sub-package first** (their `package.json main` points at `dist/`, which `npm install` does not build), then `npx vite build --base=/configurator/`.
- **Acceptance:** both appear as first-class nav items under "Notifications" with translated labels.

**Phase 0 exit criteria:** schemas registered (default-data-handler); both masters seeded (33 ↔ 33) at `ke`; configurator renders+edits both via the generic datagrid; tenant scoping confirmed at `ke` (P0-4).

---

### Phase 1 — PGR refactor behind flag + unit/golden tests + CI verify

Goal: PGR reads both masters and emits pre-rendered per-recipient events behind `pgr.notification.config.driven`; legacy path unchanged when flag off; golden-output test proves no-op cutover; verified on egov-ci.

**P1-1. Add constants.**
- File: `backend/pgr-services/src/main/java/org/egov/pgr/util/PGRConstants.java` — after the MDMS jsonpath block (~line 170) add: master names `MDMS_NOTIFICATION_ROUTING`/`MDMS_NOTIFICATION_TEMPLATE`, jsonpaths `$.MdmsRes.RAINMAKER-PGR.NotificationRouting`/`...NotificationTemplate`, subscriber enum constants `SUBSCRIBER_CITIZEN/ASSIGNEE/CREATOR/PREVIOUS_ASSIGNEE`, channel constants `CHANNEL_SMS/WHATSAPP/EMAIL`. **Do NOT delete `NOTIFICATION_ENABLE_FOR_STATUS`** (122–127) — legacy path still uses it.
- **Acceptance:** compiles; legacy constants intact.

**P1-2. Add cached MDMS fetchers (mirror `serviceCodeToSlaCache`).**
- File: `backend/pgr-services/src/main/java/org/egov/pgr/util/MDMSUtils.java` — add `notificationRoutingCache`/`notificationTemplateCache` (`ConcurrentHashMap<String,Object>`), public `getNotificationRouting(tenantId)`/`getNotificationTemplates(tenantId)` (call `getStateLevelTenant` → `computeIfAbsent`, exactly like `getServiceCodeToSlaMillis:45-48`), private `fetchNotificationRouting`/`fetchNotificationTemplates` building a generic `MdmsCriteriaReq` for `RAINMAKER-PGR.[NotificationRouting]/[NotificationTemplate]` via a new `getNotificationModuleRequest(masterName)` (parallel to `getPGRModuleRequest:145-161`), `serviceRequestRepository.fetchResult(getMdmsSearchUrl(), req)`, JsonPath-read the master list; **return empty list (never null) on any exception** so callers fall back to legacy. **Replicate the root-fallback** from `mDMSCall` (96–108) per the P0-4 decision.
- **Acceptance:** unit-mockable; returns parsed list for seeded tenant; empty (not null) on MDMS failure.

**P1-3. Add config flags.**
- File: `backend/pgr-services/src/main/java/org/egov/pgr/config/PGRConfiguration.java` — after `complaintsDomainEventDefaultLocale` (~247): `@Value("${pgr.notification.config.driven:false}") Boolean notificationConfigDriven`, `@Value("${pgr.notification.default.locale:en_IN}") String notificationDefaultLocale`, `@Value("#{'${pgr.notification.channels.default:SMS}'.split(',')}") List<String> defaultChannels`. Reuse `getComplaintsDomainEventsTopic()` and `getMobileDownloadLink()`.
- File: `backend/pgr-services/src/main/resources/application.properties` — near the notification block (~96–104): `pgr.notification.config.driven=false`, `pgr.notification.default.locale=en_IN`, `pgr.notification.channels.default=SMS`. Leave legacy props untouched.
- **Acceptance:** flag defaults off; legacy gate props intact.

**P1-4. New class `NotificationRouter` (the "who").** — DONE.
- New file: `backend/pgr-services/src/main/java/org/egov/pgr/service/notification/NotificationRouter.java` — `route(tenantId, businessService, fromState, action, toState) → List<RoutingMatch>`. Reads `mdmsUtils.getNotificationRouting(tenantId)`, matches rows on `action+toState` (fromState optional). Empty list ⇒ no notification (replaces the `NOTIFICATION_ENABLE_FOR_STATUS` gate).
- **AS-BUILT NOTE:** `RoutingMatch` still carries `List<String> subscribers; List<String> channels`, a holdover from the pre-flatten array model. The **deployed MDMS rows are flat scalar `(audience, channel)`** (P0-1/P0-5) and `NotificationService.processConfigDriven` already maps a relationship `group → audience`. Collapsing the router/`RoutingMatch` to read the scalar `audience`/`channel` directly is the in-flight follow-up (it does not change the deployed data contract or emitted events).
- **Acceptance:** covered by `NotificationRouterTest`.

**P1-5. SubscriberResolver (relationship → User + contact).** — DONE, but **NOT a standalone class**.
- **AS BUILT:** there is no `SubscriberResolver.java`. The resolution logic (citizen + assignee/previous-assignee via PI-history, phone/email lookup, country-code) lives inside `NotificationService` as the private `ResolvedRecipient` record + resolve helpers, normalizing the relationship to the `{CITIZEN, EMPLOYEE}` audience. `getEmployeeName`/`fetchUserByUUID`/`buildMobileWithCountryCode` were retained in `NotificationService` (shared with the legacy path).
- **Acceptance:** exercised by `NotificationConfigDrivenEmissionTest` + `NotificationGoldenOutputTest`.

**P1-6. New class `TemplateRenderer` (config-2 lookup + placeholder fill + localize, D4).** — DONE.
- New file: `backend/pgr-services/src/main/java/org/egov/pgr/service/notification/TemplateRenderer.java` — **AS BUILT** signature `render(tenantId, audience, action, toState, channel, locale, Map<String,String> values) → String body`. Picks by **`(audience, action, toState, channel, locale)`** (NOT `eventName`) with default-locale fallback, returns null (skip recipient, logged) if missing. The caller (`NotificationService`) assembles the placeholder `values` map (all existing tokens: `{id}`,`{complaint_type}`,`{emp_name}`,`{emp_designation}`,`{emp_department}`,`{ulb}`,`{status}`,`{date}`,`{download_link}`,`{rating}`,`{additional_comments}`); the renderer does literal `{token}` substitution.
- **Acceptance:** covered by `TemplateRendererTest`; substitution + locale fallback + missing-template-null verified.

**P1-7. Wire the config-driven path into `NotificationService` (flag-branched).**
- File: `backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java`:
  - Inject `NotificationRouter`, `SubscriberResolver`, `TemplateRenderer`, and the `Producer`.
  - At the top of `process()` (~65): `if (config.getNotificationConfigDriven()) { processConfigDriven(request, topic); return; }` — else fall through to the **verbatim legacy body** (74–160).
  - New `processConfigDriven()`: derive `businessService=PGR`, `action`, `toState=applicationStatus`, `fromState=null`; `route(...)`; for each match, resolve the recipient **in its own try/catch** (failure isolation); for each channel `render(...)`; `publishRenderedEvent(...)`. A `dedupeKey = audience|channel|subscriberKey` skips duplicate emissions within one transition.
  - **AS-BUILT event shape** (`publishRenderedEvent`): `{eventId, eventType:"COMPLAINTS_WORKFLOW_TRANSITIONED", eventName:"COMPLAINTS.WORKFLOW.<ACTION>", eventTime, producer:"complaints-service", module:"Complaints", entityType:"COMPLAINT", entityId, tenantId, channel, subscriberId, contact{userId,type,name,phone,email,locale}, renderedBody, subject, transactionId, data{complaintNo,status,action,toState}}`, pushed via `Producer` to the complaints-domain-events topic. `subscriberId = tenantId+":"+userUuid` (fallback `tenantId+":"+mobile`); `transactionId = serviceRequestId:action:toState:subscriberId:channel`. **Skips when subscriberId is null** (risk R7).
  - `getFinalMessage()` + the 7 if-blocks remain ONLY for legacy; not called when flag on.
- **Acceptance:** flag off ⇒ byte-identical legacy behavior; flag on ⇒ per-recipient×channel events; one bad recipient does not drop the others.

**P1-8. Gate the coarse `ComplaintDomainEventService` publish off when flag on (avoid double-emit).**
- File: `backend/pgr-services/src/main/java/org/egov/pgr/service/ComplaintDomainEventService.java` — `publishWorkflowTransitionEvent` (39–62, called from `PGRService.java:96,178`): no-op (or audit-only) when `config.getNotificationConfigDriven()` is true. Keep `getStakeholders` (103–132) logic intact for legacy (or delegate to `SubscriberResolver`).
- **Acceptance:** with flag on, only per-recipient events appear on `complaints.domain.events` (no coarse stakeholders[] event); flag off ⇒ unchanged.

**P1-9. Unit + golden tests (JUnit 4 + Mockito).** — DONE.
- AS BUILT, the notification test set is: `NotificationRouterTest.java`, `TemplateRendererTest.java`, `NotificationGoldenOutputTest.java` (THE GATE), and `NotificationConfigDrivenEmissionTest.java` (end-to-end TRIGGER: one ASSIGN action → SMS+WHATSAPP+EMAIL events). There is **no** `SubscriberResolverTest.java` (no standalone resolver class — see P1-5).
- `NotificationGoldenOutputTest` asserts `Set<(recipient,channel,renderedBody)>` legacy(flag off) == config-driven(flag on) restricted to **SMS** (WHATSAPP/EMAIL are net-new). URL shortener + date mocked deterministically.
- Fixtures: `src/test/resources/notification/legacy-localization.json`, `seed-templates.json`, `seed-routing.json`.
- **Acceptance:** 26 PGR notification tests green incl. the golden no-op gate.

**P1-10. CI verification on egov-ci (per `ci-testing` skill).**
- New: `local-setup/scripts/ci-notification-routing.py` — admin token; seed both masters at the P0-4 level; restart pgr-services or DEL mdms cache; assert tenant scoping (ke.bomet resolves, sibling does not); drive APPLY→ASSIGN→RESOLVE→RATE via Kong; consume `complaints.domain.events` via `rpk` and assert each event has the full shape + per-recipient×channel fan-out count matches §11; idempotency (replay one event, assert one `nb_dispatch_log` row per transactionId — depends on Phase 2 migration, run after); failure-isolation (inject one bad recipient, assert others still produced).
- **Acceptance:** script exits 0 against a Bomet-shaped tenant on egov-ci; events match §11; failure isolation holds. (Idempotency assertion deferred until P2 migration lands.)

**Phase 1 exit criteria:** flag-off behavior unchanged; flag-on emits correct per-recipient events; golden-output test green; CI script passes; new pgr-services image built+pushed to `10.0.0.4:5000`.

---

### Phase 2 — Novu + Baileys infra on Bomet + novu-bridge pass-through

> **AS BUILT — deploy reality (confirmed):** Bomet does NOT run `tilt-demo`. It deploys via **`local-setup/ansible/deploy.sh bomet`** (→ `playbook-deploy.yml`), which copies `local-setup/docker-compose.egov-digit.yaml` + the per-tenant overlay `docker-compose.bomet.yml` to `/opt/digit/` and runs `docker compose` with `COMPOSE_PROFILES` extended by `notifications` when `enable_novu: true`. **The entire Novu stack already exists** in that file behind the `notifications` profile (novu-mongo/api/worker/ws/dashboard, novu-bridge, novu-bridge-endpoint, digit-user-preferences-service, otp-publisher). This was NOT a port — it was (a) re-point novu-bridge env to pass-through, (b) add ONE `baileys-send-service` block, (c) ensure 3 Kafka topics, (d) set the PGR flag in the Bomet overlay, (e) build+push 3 images. **All edits land in committed files; never `vi` on the box (Ansible reverts server-side edits).**
>
> **Novu bootstrapped via API:** organization **Bomet** with two environments **Development + Production**; the SMS (**Twilio**) + Email (**Gmail/SMTP nodemailer**) integrations and the `complaints-sms` / `complaints-email` / `complaints-whatsapp` workflows (defined in `backend/novu-bridge-endpoint/workflows.js`).

Goal: novu-bridge becomes pass-through + identify; SMS/Email route through Novu providers, WhatsApp branches to baileys-send-service; nb_dispatch_log keyed per recipient.

**P2-1. novu-bridge: gut template/provider resolution from `DispatchPipelineService.process()`.**
- File: `backend/novu-bridge/.../service/DispatchPipelineService.java`:
  - DELETE `configServiceClient.resolveTemplate` + `validateTemplateConfig` (84–88) and the `resolvedTemplate` local.
  - DELETE provider-by-channel resolution + `NB_NO_ACTIVE_PROVIDER` throw (90–102) and the `findMissingRequiredVars`/`NB_REQUIRED_VARS_MISSING` block (104–117).
  - REPLACE the contentVariables/paramOrder/contentSid/novuApiKey assembly + `triggerWithProviderConfig` (146–168) with: read `context.getRenderedBody()/getRenderedSubject()` and call new `NovuClient.identifyThenTrigger(subscriberId, contact, channel, renderedBody, renderedSubject, transactionId, event.getData())`. Novu `name` = fixed per-channel workflow id (`config.getNovuWorkflowId(channel)`); rendered text travels in `payload.body`; use `config.getNovuApiKey()`.
  - Set `transactionId` from `event.getTransactionId()` (new field, fallback `eventId+":"+channel`); pass into trigger + `persist()`.
  - REMOVE the `ConfigServiceClient` field/ctor-param/assignment (24,33,41); DELETE dead helpers `buildOrderedContentVariables`, `buildTemplateOverrides`, `findMissingRequiredVars`, `validateTemplateConfig`, `validateContentSid`, `resolveContentSid`, and `TWILIO_CONTENT_SID_PATTERN` (19). Keep `formatRecipientPhone` + `deriveContext`.
  - `deriveContext()` (285–302): carry `renderedBody`, `renderedSubject`, `email`, `firstName`, `lastName`; keep `locale` from the event (PGR already localized). Decide whether to keep the `preferenceServiceClient.getUserPreferredLocale` override (66–70) — recommend removing or flag-gating (PGR owns locale now).
- **Acceptance:** `configServiceClient.resolveTemplate` is never called when `renderedBody` present; Novu payload.body == event.renderedBody verbatim.

**P2-2. novu-bridge: add subscriber identify (D6) with hand-rolled TTL cache.**
- File: `backend/novu-bridge/.../service/NovuClient.java`:
  - Add `identify(subscriberId, contact, apiKey)` — `POST {novuBaseUrl}/v1/subscribers {subscriberId, phone, email, firstName, lastName, locale, data:{tenantId, role, serviceRequestId}}` with `Authorization: ApiKey ...`. Guard with TTL cache; identify failure logged but **non-fatal** (still trigger).
  - Add `identifyThenTrigger(...)` = identify() then existing `trigger(...)`.
  - Add `private final Map<String,Long> identifiedAt = new ConcurrentHashMap<>();` + `recentlyIdentified`/`markIdentified` using `System.currentTimeMillis()` and `config.getIdentifyCacheTtlMs()`; evict-on-read older than TTL (no caffeine/guava — `MdmsServiceClient.prefixCache:39` is the precedent).
- **Acceptance:** first event POSTs `/v1/subscribers` with full profile+data; second within TTL skips; identify failure does not block trigger.

**P2-3. novu-bridge: BaileysProviderStrategy + fix provider-name collision.**
- New file: `backend/novu-bridge/.../service/provider/BaileysProviderStrategy.java` — `getProviderName()="baileys"`, `supports("baileys"|"baileys-whatsapp")`, `getSupportedChannels()={"whatsapp"}`, `isContentSidValid()=true` (free-form), `buildProviderConfig()` returns empty (delivery is out-of-band HTTP).
- File: `backend/novu-bridge/.../service/provider/WhatsAppBusinessApiProviderStrategy.java` — tighten `supports()` (line 31) to drop the bare `"whatsapp"` alias; keep only `"whatsapp-business-api"`/`"meta"` (else it shadows Baileys; factory picks first match non-deterministically).
- New file: `backend/novu-bridge/.../service/BaileysSendClient.java` — `RestTemplate` client POSTing `{to,text}` (+ optional Bearer) to `cfg.getBaileysUrl()+cfg.getBaileysSendPath()`, mapping HTTP result to `NovuClient.NovuResponse` so the existing `persist(...SENT...)` path works.
- File: `DispatchPipelineService.java` — for `channel=WHATSAPP` + provider=baileys, branch BEFORE the Novu trigger and call `BaileysSendClient.send(to, renderedBody)`; reuse `formatRecipientPhone` but **strip the Twilio `whatsapp:` prefix** (line 282) before Baileys.
- **Acceptance:** WHATSAPP routes to Baileys (not Meta); SMS/EMAIL unchanged; dispatch_log records the Baileys send.

**P2-4. novu-bridge: widen `nb_dispatch_log` idempotency key (Flyway).**
- New file: `backend/novu-bridge/src/main/resources/db/migration/main/V20260701000000__extend_dispatch_unique_key.sql` — `DROP INDEX IF EXISTS uk_nb_dispatch_event_channel; ALTER TABLE nb_dispatch_log ADD COLUMN IF NOT EXISTS transaction_id VARCHAR(256); CREATE UNIQUE INDEX IF NOT EXISTS uk_nb_dispatch_txn ON nb_dispatch_log (transaction_id);` (transaction_id = `serviceRequestId:action:toState:subscriberId:channel`).
- File: `backend/novu-bridge/.../repository/DispatchLogRepository.java` — `upsert()` `ON CONFLICT` clause to key on `transaction_id`; ensure `transaction_id` populated on all persist paths (incl. the SKIPPED/preference-denied path before any persist).
- **Do NOT edit** the applied `V20260217124000` migration (Flyway checksum). `spring.flyway.out-of-order=true` is set (confirm no env disables it).
- **Acceptance:** replaying one event yields exactly one `nb_dispatch_log` row per transactionId; two recipients on same channel don't collide.

**P2-5. novu-bridge: model + config additions.**
- Files (add fields): `DerivedContext.java` (renderedBody, renderedSubject, email, firstName, lastName), `Stakeholder.java` (email, firstName, lastName, locale, channel, renderedBody, renderedSubject, role), `ComplaintsDomainEvent.java` (transactionId; optionally flat channel/renderedBody — **pick one shape and keep consistent with PGR**, risk R3).
- File: `NovuBridgeConfiguration.java` — `@Value` fields: `novu.bridge.baileys.host`, `.send.path`, `novu.bridge.identify.cache.ttl.ms` (default 300000), `novu.bridge.workflow.id.sms/.whatsapp/.email`, plus the `novu.bridge.whatsapp.baileys.url/.send.path/.token/.timeout.ms` getters used by BaileysSendClient.
- File: `backend/novu-bridge/src/main/resources/application.properties` — add the baileys + identify + workflow-id props; mark config-service props (31–33) for removal one release later (D8).
- **Acceptance:** compiles; new props bind; event shape agreed with PGR.

**P2-6. Baileys send-service (new Node microservice).**
- New files under `utilities/baileys-send-service/` (compose path) — `index.js` (Express + `makeWASocket` + `useMultiFileAuthState`, `POST /send {to,text}`, `GET /healthz`, `GET /qr`; Kenya JID normalization 0→254, 9-digit→254; auto-reconnect except on `loggedOut`), `package.json` (baileys `7.0.0-rc.9`, express, qrcode; Node ≥20), `Dockerfile` (`node:20`, `VOLUME /app/auth`, healthcheck on /healthz), `.dockerignore`, `README.md` (operator runbook: QR pairing via SSH tunnel, re-pair on logout, ban-risk caveats).
  - Adapted from the proven `/root/baileys-test.js`.
  - **SEND_TOKEN bearer auth MUST be mandatory in Bomet env**; `/qr` never published on a public port.
- **Acceptance:** local `docker build` succeeds; `/healthz` 503 until paired then 200; `POST /send` delivers in a manual pair test.

**P2-7. Compose: add baileys-send-service + re-point novu-bridge env.**
- File: `local-setup/docker-compose.egov-digit.yaml`:
  - Add `baileys-send-service` block after `otp-publisher` (~line 2288): `profiles:["notifications"]`, `image:${BAILEYS_IMAGE:-baileys-send-service:local}`, `restart:unless-stopped`, port `13040:3040`, volume `baileys_auth_data:/app/auth`, healthcheck `/healthz`, `egov-network`, env `PORT=3040 AUTH_DIR=/app/auth SEND_TOKEN=...`. Add `baileys_auth_data: null` to the top-level `volumes:` block.
  - novu-bridge env (~1985–2061): add `NOVU_BRIDGE_BAILEYS_URL=http://baileys-send-service:3040/send` + the per-channel workflow ids (`NOVU_BRIDGE_WORKFLOW_ID_SMS=complaints-sms`, `..._EMAIL=complaints-email`, `..._WHATSAPP=complaints-whatsapp`); mark config-service envs for removal post-cutover; keep `NOVU_BRIDGE_PREFERENCE_ENABLED=false` initially (PGR owns locale; channel is per-event, not bridge-wide).
  - novu-bridge `depends_on` (~1970–1982): add `baileys-send-service: {condition: service_healthy}`; relax hard `digit-config-service: service_healthy` once template-resolve is gone (retain config-service one release).
  - pgr-services env (~1255–1335): the flag flip lives in the Bomet overlay (P2-9), not here; but ensure the domain-events topic env (`KAFKA_TOPICS_COMPLAINTS_DOMAIN_EVENTS: complaints.domain.events`) and point `${PGR_SERVICES_IMAGE}` at the new CI tag.
  - Make `novu-bridge` image overridable: `image: ${NOVU_BRIDGE_IMAGE:-registry.preview.egov.theflywheel.in/egovio/novu-bridge:latest}`.
- **Acceptance:** `docker compose config` validates; baileys block present; novu-bridge env updated; no hand-edits required on the box.

**P2-8. Compose/Ansible: Kafka topics + image build/push.**
- File: `local-setup/ansible/playbook-deploy.yml`:
  - Add an idempotent topic-create task (gated `enable_novu`): `... exec -T redpanda rpk topic create complaints.domain.events novu-bridge.retry novu-bridge.dlq -p 1 -r 1` with `failed_when:false`.
  - Add CI-side build+push tasks for the 3 custom images (gated on `build_pgr_services`/`build_novu_bridge`/`build_baileys`): `docker build -t 10.0.0.4:5000/egovio/<name>:<tag>` + `docker push`, mirroring the digit-mcp build/push pattern (~475–480) and otp-publisher (~601–612). Bomet pulls via `insecure-registries` (already configured ~189–192).
- File: `local-setup/ansible/templates/digit.env.j2` — add `BAILEYS_IMAGE`, `NOVU_BRIDGE_IMAGE`, `NOVU_BRIDGE_BAILEYS_URL`, `NOVU_BRIDGE_BAILEYS_TOKEN`, baileys `SEND_TOKEN`/`AUTH_DIR`, mirroring `OTP_PUBLISHER_IMAGE`/`PGR_SERVICES_IMAGE` plumbing.
- **Acceptance:** topics created before bridge consumes; 3 images present in registry catalog; `.env` carries the new vars.

**P2-9. Bomet host_vars + overlay (flag on for Bomet only).**
- File: `local-setup/ansible/inventory/host_vars/bomet.yml` (gitignored, operator-local): set `enable_novu: true` and the image pins (`pgr_services_image`, `novu_bridge_image`, `baileys_image` from `10.0.0.4:5000`). Keep `novu_api_key`/Twilio creds empty on first deploy (two-pass bootstrap). The config-driven flag itself is set in the Bomet compose overlay, not host_vars.
- File AS BUILT: `local-setup/docker-compose.bomet.yml` has the `pgr-services` override `environment: { PGR_NOTIFICATION_CONFIG_DRIVEN: 'true', KAFKA_TOPICS_COMPLAINTS_DOMAIN_EVENTS: complaints.domain.events }`. **This is where the config-driven flag is set — only Bomet flips; the shared egov-digit default stays `false`.** The per-tenant overlay survives Ansible re-runs.
- **Acceptance:** `./deploy.sh bomet` brings up the notifications profile incl. baileys; pgr-services runs with the flag on; other tenants unaffected.

**P2-10. novu-bridge tests (JUnit 5 — match the module).**
- File: `backend/novu-bridge/.../service/ProviderAgnosticTest.java` — extend: identify-upsert (first POSTs, second skipped via TTL — assert RestTemplate call count); provider routing (WHATSAPP→Baileys, SMS→gateway, EMAIL→email); pass-through (resolveTemplate NEVER called, payload.body == renderedBody).
- New: `.../service/DispatchPipelinePassThroughTest.java` — identify payload (full profile + data, subscriberId = tenantId:uuid, uuid-less fallback tenantId:mobile), config-service-never-called, renderedBody-used-verbatim.
- New: `.../service/provider/BaileysProviderStrategyTest.java` — supports('baileys')/WHATSAPP, free-form (no contentSid), factory selects Baileys over generic.
- **Acceptance:** all green; pass-through inversion proven.

**Phase 2 exit criteria (met):** novu-bridge image is pass-through + identify; SMS/Email route through Novu (Twilio/Gmail), WhatsApp branches to baileys-send-service (paired on Bomet); topics exist; `nb_dispatch_log` keyed on transactionId; flag on for Bomet. The seed enables all three channels (not SMS-only); SMS parity is gated by the golden test.

---

### Phase 3 — Bomet cutover + tracking verify — LIVE

Status: **SMS + Email live via Novu → Twilio / Gmail-SMTP; WhatsApp live via Baileys (paired).** The seed enables all three channels; the flag is on in the Bomet overlay.

**P3-1. SMS cutover.** — LIVE.
- Pre-req: **Twilio** creds (`ACCOUNT_SID`/`AUTH_TOKEN`/`FROM`) configured as the Novu SMS integration; two-pass Novu bootstrap done (`novu_api_key` populated, re-deploy).
- AS BUILT: flag set in `docker-compose.bomet.yml` (P2-9); SMS routes `PGR → Kafka → novu-bridge → identify → trigger `complaints-sms` → Twilio`.
- Verify: drive ASSIGN; SMS received via Twilio; Novu `/activity` shows subscriber `ke.bomet:<uuid>` + DELIVERED; `nb_dispatch_log` `status=SENT`.
- **Acceptance:** golden-output behavior holds in production; tracking visible in Novu.

**P3-2. WhatsApp enablement (Baileys, direct).** — LIVE.
- Pre-req: dedicated WhatsApp number paired (scan `/qr` via SSH tunnel; auth-state in `baileys_auth_data`); pairing validated on the Hetzner IP (risk R9).
- AS BUILT: WHATSAPP rows are already in the seed; novu-bridge branches `channel=WHATSAPP` to `BaileysSendClient.send` → baileys-send-service (**NOT through Novu** — D7/R10). Tracking is in `nb_dispatch_log` + Baileys logs, not Novu's feed. Wrapping Baileys as a Novu provider so WhatsApp tracks in Novu is **BACKLOG TASK-031 (GitHub egovernments/CCRS#973)**.
- **Acceptance:** WhatsApp delivered via Baileys; SMS still works; Baileys failure is retriable (retry, not DLQ).

**P3-3. Email enablement (Gmail/SMTP via Novu).** — LIVE.
- Pre-req: **Gmail / SMTP** (nodemailer) configured as the Novu email integration with a verified from-address; EMAIL templates (with `subject`) seeded.
- AS BUILT: EMAIL routes through Novu workflow `complaints-email`; recipients need a resolvable email (PGR's resolver populates `contact.email`).
- **Acceptance:** email delivered via Gmail/SMTP + tracked in Novu.

**P3-4. Tracking + monitoring close-out.**
- Run `local-setup/scripts/ci-novu-tracking-check.md` checklist on Bomet: every recipient appears in Novu dashboard as a subscriber WITH profile (the gap §5 closes via identify) AND per-message delivery status across SMS/WhatsApp/email.
- Add a `/healthz != 200` / `state=logged_out` alert for baileys-send-service (manual re-pair runbook in README).
- Monitor Kafka lag (`mcp__DIGIT-*__kafka_lag`) — per-recipient×channel fan-out multiplies event volume on a 256M single-partition redpanda (risk R11).
- **Acceptance:** all channels tracked in Novu; alerting in place; lag nominal.

**Phase 3 exit criteria:** Bomet fully cut over per channel; tracking verified; legacy path can be removed in the following release.

---

## 3. New files (consolidated)

### PGR (`backend/pgr-services`)
| Path | Purpose |
|---|---|
| `src/main/java/org/egov/pgr/service/notification/NotificationRouter.java` | Config-1 lookup: transition → routing matches + channels |
| `src/main/java/org/egov/pgr/service/notification/RoutingMatch.java` | Router result holder (subscribers/channels — pre-flatten holdover, see P1-4) |
| `src/main/java/org/egov/pgr/service/notification/TemplateRenderer.java` | Config-2 lookup `(audience,action,toState,channel,locale)` + placeholder fill + localize (D4) |
| `src/test/java/.../notification/NotificationRouterTest.java` | Router unit tests |
| `src/test/java/.../notification/TemplateRendererTest.java` | Renderer unit tests |
| `src/test/java/.../notification/NotificationGoldenOutputTest.java` | **Backward-compat gate** (legacy == config-driven, SMS) |
| `src/test/java/.../notification/NotificationConfigDrivenEmissionTest.java` | End-to-end TRIGGER: one ASSIGN → SMS+WHATSAPP+EMAIL events |
| `src/test/resources/notification/legacy-localization.json` | Legacy SMS body fixtures |
| `src/test/resources/notification/seed-templates.json` | Config-2 fixtures |
| `src/test/resources/notification/seed-routing.json` | Config-1 fixtures |

> AS BUILT: there is **no** `SubscriberResolver.java`/`SubscriberResolverTest.java` (resolver logic lives in `NotificationService`); the resolver-side modifications landed in the existing `NotificationService.java` (P1-7), not a new class.

### novu-bridge (`backend/novu-bridge`)
| Path | Purpose |
|---|---|
| `src/main/java/.../service/provider/BaileysProviderStrategy.java` | WHATSAPP→Baileys strategy |
| `src/main/java/.../service/BaileysSendClient.java` | RestTemplate client → baileys-send-service `/send` |
| `src/main/resources/db/migration/main/V20260701000000__extend_dispatch_unique_key.sql` | nb_dispatch_log unique key → transactionId |
| `src/test/java/.../service/DispatchPipelinePassThroughTest.java` | Pass-through + identify tests |
| `src/test/java/.../service/provider/BaileysProviderStrategyTest.java` | Baileys strategy tests |

### Baileys send-service (`utilities/baileys-send-service`)
| Path | Purpose |
|---|---|
| `utilities/baileys-send-service/src/server.js` | Express wrapper around Baileys (`/send`, `/healthz`, `/qr`) — AS BUILT under `src/` |
| `utilities/baileys-send-service/package.json` | Pins baileys + express + qrcode (Node ≥20) |
| `utilities/baileys-send-service/Dockerfile` | node:20 image, `/app/auth` volume, healthcheck |
| `utilities/baileys-send-service/.dockerignore` | Keep node_modules/auth out of image |
| `utilities/baileys-send-service/README.md` | Operator runbook (pairing, re-pair, ban-risk) |

### MDMS schemas + seed — AS BUILT (all in `default-data-handler`, NOT nairobi-mdms)
| Path | Purpose |
|---|---|
| `utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json` | Appended both schemas (flattened scalar) — registers via `default.mdms.schema.create.list` |
| `utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationRouting.json` | Routing seed — 33 scalar rows (all 3 channels) |
| `utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationTemplate.json` | Template seed — 33 rows, 1:1 with routing |
| `utilities/default-data-handler/scripts/migrate-pgr-sms-templates.py` | Curated legacy `PGR_*_SMS_MESSAGE` → template migration helper |

> The planned `nairobi-mdms/.../RAINMAKER-PGR/Notification*.json` parity files were **not** created; the `{tenantid}`-substituted default-data-handler seed lands at the state tenant `ke` that PGR reads.

### Configurator — AS BUILT (no custom editor; flat scalar masters)
| Path | Purpose |
|---|---|
| `configurator/src/admin/schemaDescriptors/notification-routing.ts` | Plain descriptor (scalar audience/channel fields) |
| `configurator/src/admin/schemaDescriptors/notification-template.ts` | Plain descriptor (body textarea, placeholders chips) |
| `configurator/src/admin/schemaDescriptors/index.ts` | Register both descriptors |
| `configurator/packages/data-provider/src/providers/resourceRegistry.ts` | Register both MDMS resources (idField=`action`) |
| `configurator/src/admin/DigitLayout.tsx` | New top-level **Notifications** nav group |
| `configurator/src/providers/i18nProvider.ts` | Nav i18n keys |

> The planned `TransitionRoutingEditor.tsx` / `TransitionArrayInput.tsx` were **not** built — flattening removed the array-of-objects editing problem.

### Tests / scripts (CI + ops)
| Path | Purpose |
|---|---|
| `local-setup/scripts/ci-notification-routing.py` | CI integration driver (seed→drive→assert events→idempotency→scoping) |

---

## 4. Per-component change index (file:line → change)

### PGR (`backend/pgr-services`)
- `util/PGRConstants.java` ~after 170 → add NotificationRouting/Template master + jsonpath constants, subscriber + channel enum constants. KEEP `NOTIFICATION_ENABLE_FOR_STATUS` (122–127).
- `util/MDMSUtils.java` (after 67, mirror serviceCodeToSlaCache 37,45–67) → two caches + `getNotificationRouting`/`getNotificationTemplates` + `fetch*` + `getNotificationModuleRequest` (parallel to getPGRModuleRequest 145–161); reuse `getMdmsSearchUrl` (169–171); empty-not-null on error; root-fallback per `mDMSCall` 96–108.
- `config/PGRConfiguration.java` ~after 247 → `notificationConfigDriven`, `notificationDefaultLocale`, `defaultChannels` flags.
- `resources/application.properties` ~96–104 → `pgr.notification.config.driven=false`, `.default.locale`, `.channels.default`.
- `service/NotificationService.java` `process()` 65–161 → flag branch to `processConfigDriven`; legacy body verbatim when off. New `processConfigDriven` + `publishRenderedEvent`. Move `getEmployeeName`/`fetchUserByUUID`/`buildMobileWithCountryCode` → SubscriberResolver, `getHRMSEmployee` → TemplateRenderer. `getFinalMessage` 170–531 retained legacy-only.
- `service/ComplaintDomainEventService.java` `publishWorkflowTransitionEvent` 39–62 (callers `PGRService.java:96,178`) → gate to no-op/audit-only when flag on; `getStakeholders` 103–132 legacy + seed for resolver.

### novu-bridge (`backend/novu-bridge`)
- `service/DispatchPipelineService.java`: 84–88 delete resolveTemplate+validate; 90–117 delete provider-by-channel + required-vars; 146–168 replace with `identifyThenTrigger` reading renderedBody; 285–302 deriveContext carries rendered+contact; 24/33/41 remove ConfigServiceClient; delete dead helpers (201–215,218–247,304–333,335–345,347–361,363–373) + `TWILIO_CONTENT_SID_PATTERN` (19); WHATSAPP+baileys branch → BaileysSendClient, strip `whatsapp:` prefix (282).
- `service/NovuClient.java` 36–77 → `identify` + `identifyThenTrigger`; class body 23–34 → `identifiedAt` TTL cache + helpers.
- `service/provider/WhatsAppBusinessApiProviderStrategy.java` `supports()` 28–32 → drop bare `whatsapp` alias.
- `service/provider/NovuProviderStrategyFactory.java` 31–51 → no edit (auto-discovery); just ensure Baileys wins via providerName='baileys'.
- `repository/DispatchLogRepository.java` `upsert()` ON CONFLICT 35–37 → key on `transaction_id`.
- `web/models/DerivedContext.java` 12–19, `Stakeholder.java` 12–16, `ComplaintsDomainEvent.java` 16–29 → add rendered/contact/transactionId fields.
- `config/NovuBridgeConfiguration.java` after 82 → baileys + identify-ttl + workflow-id + baileys-whatsapp props; mark configHost props (51–58) for removal.
- `resources/application.properties` 31–33 (remove later) + after 42 → baileys/identify/workflow-id props.
- `service/ConfigServiceClient.java` whole file → delete after legacy retired (D8).

### MDMS / default-data-handler
- `utilities/default-data-handler/.../application.properties` 54,55 → append both schema codes to `default.mdms.schema.create.list` + `mdms.schemacode.map`.
- `utilities/default-data-handler/.../schema/RAINMAKER-PGR.json` after 233 → append two schema objects.

### Baileys infra
- `local-setup/docker-compose.egov-digit.yaml`: novu-bridge env 1985–2061 (re-point); depends_on 1970–1982 (+baileys, relax config-service); pgr-services env 1255–1335 (topic, image); new baileys block after 2288 + `baileys_auth_data` volume; redpanda command (optional explicit auto-create).
- `local-setup/ansible/playbook-deploy.yml`: + topic-create task (near novu-bootstrap ~2328); + 3 image build/push tasks (mirror ~475–480, ~601–612).
- `local-setup/ansible/templates/digit.env.j2`: after PGR_SERVICES_IMAGE (20–24) / OTP_PUBLISHER_IMAGE (34) → BAILEYS_IMAGE, NOVU_BRIDGE_IMAGE, baileys env.
- `local-setup/ansible/inventory/host_vars/bomet.yml`: + enable_novu, image pins (flag itself is in the overlay below, not host_vars).
- `local-setup/docker-compose.bomet.yml`: + pgr-services override (`PGR_NOTIFICATION_CONFIG_DRIVEN=true`, `KAFKA_TOPICS_COMPLAINTS_DOMAIN_EVENTS=complaints.domain.events`).

### Configurator
- `packages/data-provider/src/providers/resourceRegistry.ts` after 145 → 2 REGISTRY entries.
- `src/App.tsx` 140–142 → template auto-flows; routing via descriptor customEditor (recommend option a).
- `src/admin/DigitLayout.tsx` 49–57 → 2 nav items + Bell/MessageSquare imports.
- `src/providers/i18nProvider.ts` → 2 app.nav keys.
- `src/admin/schemaDescriptors/index.ts` 1–9,12–21 → import + register both descriptors.
- `src/admin/themeEditor/index.ts` 14–23 → `customEditors['notification-routing']`.
- (optional) `src/admin/widgets/index.tsx` 23–45 + `schemaDescriptors/types.ts` 11–21 → `'object-array'` widget.

---

## 5. Test matrix

| Layer | What's asserted | Where |
|---|---|---|
| PGR unit | transition → routing matches + channels; fromState-optional; empty-on-no-match | `NotificationRouterTest.java` |
| PGR unit | resolver path (citizen + assignee/previous-assignee via PI-history; null-safety; one-failure-isolated) | covered by `NotificationConfigDrivenEmissionTest.java` (no standalone resolver class) |
| PGR unit | placeholder substitution; locale select + default fallback; missing-template→null | `TemplateRendererTest.java` |
| PGR golden (GATE) | `Set<(recipient,channel,renderedBody)>` legacy(flag off) == config-driven(flag on) for every §11 **SMS** transition | `NotificationGoldenOutputTest.java` |
| PGR emission | one ASSIGN action → the full set of per-recipient×channel events (SMS+WHATSAPP+EMAIL) | `NotificationConfigDrivenEmissionTest.java` |
| novu-bridge unit | identify upsert (first POSTs, second skipped via TTL); subscriberId + uuid-less fallback; config-service NEVER called; payload.body == renderedBody | `DispatchPipelinePassThroughTest.java` |
| novu-bridge unit | provider routing SMS→Novu/Twilio, EMAIL→Novu/Gmail, WHATSAPP→Baileys; Baileys wins over Meta | `BaileysProviderStrategyTest.java` |
| CI integration (egov-ci) | seed→drive transitions→events on `complaints.domain.events` match shape + fan-out; tenant scoping; idempotency (1 row/txnId); failure isolation | `local-setup/scripts/ci-notification-routing.py` |

> AS BUILT: 26 PGR tests + 10 novu-bridge tests green (per the build commit). Live SMS/email confirmed via Novu→Twilio/Gmail; WhatsApp via Baileys.

---

## 6. Operator prerequisites (what the human must provide, and the gate)

| Item | Needed for | Gated phase | Notes |
|---|---|---|---|
| **Twilio creds** (`ACCOUNT_SID`/`AUTH_TOKEN`/`FROM`, Kenya-approved) | SMS | **Phase 3 (P3-1)** — live | Configured as the Novu SMS integration. |
| **Novu API key** (sign up at `https://bometfeedbackhub.digit.org/novu/` after first deploy, paste into host_vars, re-deploy) | All Novu delivery (SMS/Email) | **Phase 3** (two-pass bootstrap) | `novu-bridge` won't dispatch until `NOVU_API_KEY` resolves. Novu org **Bomet**, envs **Development + Production**. |
| **Dedicated WhatsApp number** + QR scan + acceptance of unofficial-API/ban risk | WhatsApp | **Phase 3 (P3-2)** — paired | Pair via SSH tunnel to `/qr`; auth-state persists in `baileys_auth_data`. Validated on Hetzner IP (R9). |
| **Gmail / SMTP** (host/port/user/pass, nodemailer) + verified from-address (SPF/DKIM) | Email | **Phase 3 (P3-3)** — live | Novu email integration. |
| **CI/registry push access** (egov-ci → `10.0.0.4:5000`) | Building pgr-services/novu-bridge/baileys images | **Phase 1/2** | Bomet pull configured via `insecure-registries`. |
| **Tenant-scoping** | Correct seed level | **Phase 0 — resolved** | Seed at state tenant `ke` (PGR resolves via state-level tenant). |

**As built:** all three channels are live on Bomet — SMS via Twilio, Email via Gmail/SMTP (both through Novu), WhatsApp via Baileys directly.

---

## 7. Risks & open questions (deduped, with proposed resolution)

| # | Risk / open question | Proposed resolution |
|---|---|---|
| R1 | **`fromState` not available in the Kafka consumer path** — `ServiceRequest` carries only `applicationStatus` (toState); `NotificationConsumer` reconstructs from the record. | Drive the config-driven path from the consumer and have `NotificationRouter` match on **action+toState only** (fromState optional, design §4.1 already allows). Lower blast radius than moving logic into `PGRService` (where fromState exists). REOPEN assignee still resolves via PI-history. |
| R2 | **Double-publish to `complaints.domain.events`** — coarse `ComplaintDomainEventService` event + new per-recipient events; schemas differ (stakeholders[] vs renderedBody). | Gate the coarse publish off when flag on (P1-8). Confirm novu-bridge consumes only the new shape before cutover. |
| R3 | **Event shape contract** owned by PGR but consumed by novu-bridge — flat per-recipient vs nested-under-stakeholders[]. | **Decide flat per-recipient×channel events** (one event = one delivery): cleanest for idempotency + dispatch_log. Lock this in P1-7/P2-5 before either side ships. |
| R4 | **Localization now blocks the event** (render-before-Kafka, D4) — a localization outage fails the whole event instead of degrading. | Decide fallback: `TemplateRenderer` falls back to raw template (un-localized) on localization failure, log + emit, rather than drop. |
| R5 | **`PGR_DEFAULT_CITIZEN` default-suffix message** — legacy appends a second "default" message per citizen (~527); config-driven emits one body per (recipient,channel). | Golden-output test (P1-9) is the gate: if the suffix produced a second distinct SMS, model it as an extra template row or accept the drop with explicit sign-off. |
| R6 | **MDMS tenant scoping** — fetch caches by state-level tenant but seed is at `ke.bomet`; if PGR queries at state level the seed silently returns empty → legacy fallback. | Resolve P0-4 first; replicate `mDMSCall`'s root-fallback in `fetchNotificationRouting/Templates`; seed path is trivially flippable (`ke.bomet` ↔ `ke`). |
| R7 | **Non-unique transactionId** when a citizen has neither uuid nor mobile → `subscriberId` collapses. | Guard: skip + log when subscriberId is null/blank (P1-7). |
| R8 | **Configurator: array-of-objects is un-editable in the generic engine** + a documented **submit-swallow bug** for array masters (`themeEditor/index.ts:16-22`). | Use the dedicated `TransitionRoutingEditor` custom editor (writes via `mdmsUpdate` directly), exactly like `StateInfoEditor`. Investigate/root-cause the swallow bug as part of this work (affects both masters' arrays). |
| R9 | **Baileys datacenter-IP block (HTTP 405)** — `/root/baileys-test.js` hits "WhatsApp blocking this IP" on cloud IPs; Bomet is Hetzner. | **Single biggest unknown — validate pairing on the box early in Phase 2** before committing to WhatsApp. If 405 persists: residential/mobile proxy for Baileys egress, or fall back to official WhatsApp Business API. WhatsApp is best-effort; SMS is guaranteed. |
| R10 | **Novu does not deliver Baileys** — no Novu WhatsApp/Baileys integration; "Novu triggers → Novu delivers WhatsApp" does not apply. | novu-bridge calls baileys-send-service **directly** via `BaileysSendClient` (simpler, keeps dispatch_log accurate). Accept that WhatsApp delivery tracking lives in nb_dispatch_log + Baileys logs, not Novu's feed. |
| R11 | **Per-recipient×channel fan-out multiplies Kafka volume** on a 256M single-partition redpanda + retry/DLQ topics. | Explicit topic-create (P2-8); monitor `kafka_lag` after cutover (P3-4); bump partitions/memory if lag grows. |
| R12 | **Strategy collision** — `WhatsAppBusinessApiProviderStrategy.supports("whatsapp")` shadows Baileys; factory order undefined. | Tighten that `supports()` to drop bare `whatsapp`; seed providerName=`baileys` explicitly (P2-3). |
| R13 | **Test framework split** — PGR is JUnit 4, novu-bridge is JUnit 5. | New tests MUST match the host module's framework or surefire silently skips them (P1-9 JUnit 4; P2-10 JUnit 5). |
| R14 | **Golden test exactness** — two render paths must produce byte-identical strings incl. shortener URL + date formatting (DATE_PATTERN vs DomainEvent Asia/Kolkata formatter). | Mock the URL shortener and date deterministically; restrict golden seed to SMS-only (WhatsApp is net-new, excluded from the no-op gate). |
| R15 | **NotificationTemplate composite key.** | **RESOLVED differently than planned.** No synthetic `code` field was added. The schema uses a native composite `x-unique = [audience, action, toState, channel, locale]` and the configurator registry just uses `idField:'action'` for display. Same flattening applies to NotificationRouting (`x-unique = [businessService, action, toState, audience, channel]`). |
| R16 | **Ansible reverts server-side compose edits** — confirmed (`playbook-deploy.yml` re-copies compose every run). | ALL changes in committed files: `docker-compose.egov-digit.yaml` (shared), `docker-compose.bomet.yml` (Bomet-only overlay), `host_vars/bomet.yml`, `digit.env.j2`. Never `vi` on the box. Named volumes declared in tracked compose, never created manually. |
| R17 | **`enable_tools` per-server MDMS isolation** — MDMS seeded on dev does NOT propagate to Bomet. | Seed on Bomet directly via the nairobi-mdms data path / on-host MCP; the dev-server copy is convenience only. |
| R18 | **Confirm Bomet's actual `NOTIFICATION_ENABLE_FOR_STATUS`** (design §14) to finalize the active seed set. | Read it off the running Bomet pgr-services config in Phase 0; reconcile against §11 + the golden fixtures. |

---

## 8. Effort & critical path

| Component | Days |
|---|---|
| PGR service refactor (router/resolver/renderer + flag + events) | 6 |
| MDMS schemas + Bomet seed (curated mapping, §11 validation) | 2.5 |
| Configurator integration (custom editor + descriptors + nav) | 4 |
| novu-bridge changes (pass-through + identify + Baileys + migration) | 4 |
| Baileys WhatsApp send-service (Node service + provider client) | 4 |
| Novu + Baileys infra on Bomet (compose + Ansible + images) | 3.5 |
| Test implementation (unit + golden + CI + bridge + channel) | 6 |
| **Total (raw, un-parallelized)** | **30** |

**Critical path** (serialized dependency chain that gates the Bomet cutover):

```
P0 schemas+seed+scoping (≈3d)
  → P1 PGR refactor + golden gate + CI verify (≈6–7d, the long pole)
    → P2 novu-bridge pass-through + nb_dispatch_log migration + image build (≈4d)
      → P2 Baileys send-service + pairing validation on Hetzner (≈2–3d, R9 risk)
        → P3 SMS cutover + tracking (≈1–2d)
          → P3 WhatsApp, then email (config-only, ≈1d each)
```

**Critical path ≈ 17–20 working days.** Parallelizable off the critical path: configurator (4d, after P0 schema contract), test fixtures (alongside P1), Baileys image build (alongside P1/P2 — but pairing validation R9 must happen early in P2 since it can force an architecture change). With ~2 engineers (one PGR/backend, one infra/bridge/configurator) the calendar estimate is **≈4 weeks** including the credential-gated Phase 3 channels.

**The two hardest gates:** (1) the golden-output backward-compat test (P1-9) — cutover is only safe if it's green; (2) Baileys pairing on the Hetzner datacenter IP (R9) — validate before committing to WhatsApp on Bomet.

---

## 9. As-built deltas

Built in commit `ef8b617ec` (Phases 0–2) and cut over on Bomet (Phase 3). Summary of where reality differs from the original plan above:

1. **Routing flattened (the big one).** No `transitions[]` / `subscribers[]` / `channels[]`. One scalar MDMS row per `(businessService, action, toState, audience{CITIZEN|EMPLOYEE}, channel{SMS|WHATSAPP|EMAIL})`, joining **1:1** with one `NotificationTemplate` row keyed `(audience, action, toState, channel, locale)`. Bomet seed = **33 routing ↔ 33 templates** (18 CITIZEN + 15 EMPLOYEE; all 3 channels). `audience` replaces `subscribers[]`. Matching is on `action+toState`.
2. **Seed/schema live in `default-data-handler`**, not `nairobi-mdms`, at state tenant `ke` (PGR resolves via `getStateLevelTenant`). No nairobi-mdms parity files.
3. **No synthetic `code` field** — both masters use a native composite `x-unique`.
4. **No `SubscriberResolver` class and no custom configurator editor.** Resolver logic stayed in `NotificationService`; the flat scalar masters render in the generic configurator datagrid. `RoutingMatch` still carries the old `subscribers/channels` arrays (PGR maps `group→audience` at emit time); collapsing it to scalar is the in-flight follow-up.
5. **Delivery is through Novu providers for SMS/Email, direct Baileys for WhatsApp.** SMS → Novu workflow `complaints-sms` → **Twilio**; Email → `complaints-email` → **Gmail/SMTP (nodemailer)**; WhatsApp → `BaileysSendClient` → baileys-send-service (NOT through Novu). Wrapping Baileys as a Novu provider = **BACKLOG TASK-031 / GitHub egovernments/CCRS#973**; syncing Novu-edited templates back to MDMS = **TASK-030 / CCRS#972**.
6. **Novu bootstrapped via API:** org **Bomet**, envs **Development + Production**, with the three `complaints-*` workflows (defined in `novu-bridge-endpoint/workflows.js`).
7. **Deploy reality:** `local-setup/ansible/deploy.sh bomet`; Novu stack behind the `notifications` compose profile (`enable_novu: true`); the `PGR_NOTIFICATION_CONFIG_DRIVEN=true` flag lives in `docker-compose.bomet.yml`. Configurator built via `files/configurator-build.sh` (sub-packages first, then `vite build --base=/configurator/`) and shows a top-level **Notifications** nav section.
8. **Build-time corrections:** REASSIGN → **PENDINGFORREASSIGNMENT** (dead `PENDINGATLME·REASSIGN` row excluded); schema `description` must be **≤ 512 chars** (MDMS column); **NovuClient has no connect/read timeout** (`new RestTemplate()` — hardening candidate); configurator must build `file:` sub-packages before vite.
