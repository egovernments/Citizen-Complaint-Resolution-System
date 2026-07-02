> **Status:** Published verbatim as fork discussion [ChakshuGautam/Citizen-Complaint-Resolution-System#59](https://github.com/ChakshuGautam/Citizen-Complaint-Resolution-System/discussions/59); this file is the in-repo archive of that discussion.
> **Findings closure:** the §5 findings table is closed step-by-step in [2026-07-02-notification-findings-closure-plan.md](./2026-07-02-notification-findings-closure-plan.md).
> **Test execution:** the §6 test plan (G1–G20) is executed via [2026-07-02-notification-test-plan-execution.md](./2026-07-02-notification-test-plan-execution.md).

# Design: Config-driven PGR notifications (MDMS routing + templates, Novu delivery)

## 1. TL;DR

This PR replaces PGR's hardcoded notification logic (routing baked into `NotificationService`, message text in localization keys) with a **config-driven pipeline**: two MDMS masters (`RAINMAKER-PGR.NotificationRouting` and `NotificationTemplate`) declare *who* gets notified on *which* workflow transition over *which* channel and with *what* message; pgr-services resolves audiences (including role-pool fan-out), renders and localizes the message, and emits one pre-rendered event per (recipient × channel) to Kafka; novu-bridge becomes a domain-dumb pass-through that identifies the subscriber in Novu and triggers a per-channel Novu workflow, logging every outcome to `nb_dispatch_log`. Both masters are authored in a single artifact (`PgrWorkflowConfig.json`, next to the workflow it belongs to) and split apart at seed time by default-data-handler; the configurator gains a per-transition "Notifications" management surface with a static config checker, plus read-only Logs and Providers screens. The whole runtime path is behind a feature flag (`pgr.notification.config.driven`) with a golden-output test gate proving SMS parity with the legacy path. PR: https://github.com/ChakshuGautam/Citizen-Complaint-Resolution-System/pull/58 (78 files, +11305/−543).

## 2. Architecture

```
 AUTHORING                          SEEDING                             CONFIG STORE
 ┌──────────────────────────┐      ┌──────────────────────┐            ┌─────────────────────────────────┐
 │ PgrWorkflowConfig.json   │      │ default-data-handler │  stripped  │ workflow-v2 (BusinessService)   │
 │  workflow states/actions │─────►│ 3-step splitter:     │───────────►│  (no notification fields)       │
 │  + notifications[]       │      │ 1 parse raw tree     │            └─────────────────────────────────┘
 │  + notificationTemplates │      │ 2 strip notif fields │            ┌─────────────────────────────────┐
 └──────────────────────────┘      │ 3 emit MDMS rows     │───────────►│ MDMS v2  RAINMAKER-PGR          │
                                   └──────────────────────┘ idempotent │  NotificationRouting            │
                                                                       │   uid: bs.action.toState        │
                                                                       │        .audience.channel        │
                                                                       │  NotificationTemplate           │
                                                                       │   uid: audience.action.toState  │
                                                                       │        .channel.locale          │
                                                                       └───────────────┬─────────────────┘
 RUNTIME                                                                               │ read (cached)
 ┌─────────────────────────────────────────────────────────────────────────────────┐  │
 │ pgr-services   flag: pgr.notification.config.driven                             │◄─┘
 │  workflow transition ─► NotificationRouter (match action/toState/active rows)   │
 │    audience resolution:  CITIZEN → complaint filer                              │
 │                          EMPLOYEE → legacy alias for current assignee           │
 │                          <ROLE>  → holder pool via egov-user roleCodes search   │
 │                          AUTO_ESCALATE / SYSTEM → dropped (non-notifiable)      │
 │  TemplateRenderer (audience/action/toState/channel/locale, default-locale       │
 │  fallback) ─► ONE event per (recipient × channel), dedupe key channel|subscriber│
 │  transactionId = complaintId:action:toState:subscriberId:channel                │
 └───────────────────────────────┬─────────────────────────────────────────────────┘
                                 ▼  Kafka: complaints.domain.events
 ┌─────────────────────────────────────────────────────────────────────────────────┐
 │ novu-bridge (pass-through: no template resolution, body delivered verbatim)     │
 │  validate envelope ─► consent gate (PreferenceServiceClient, currently OFF)     │
 │  ─► identify Novu subscriber (5-min TTL cache) ─► trigger per-channel workflow  │
 │  ─► upsert nb_dispatch_log on (transaction_id, channel, recipient_value)        │
 │  read-only proxy: /novu-adapter/v1/logs, /novu-adapter/v1/integrations          │
 └───────────────────────────────┬─────────────────────────────────────────────────┘
                                 ▼  Novu CE v2.3.0 (workflows MUST be v2-native)
                 complaints-sms   ──► Twilio SMS
                 complaints-email ──► SMTP
                 WHATSAPP ──────────► no production provider yet ─► SKIPPED (never a fallback)
```

**Authoring → seeding.** Operators (and the repo's default seeds) author notifications *inside* `PgrWorkflowConfig.json`, per workflow action: `notifications[]` (audience, channel, optional fromState/assigneeOnly) plus top-level `notificationTemplates[]`. workflow-v2 has no extension point and silently drops unknown fields, so default-data-handler's `createPgrWorkflowConfig` splits the artifact: it strips the authoring-only fields from the raw tree before POSTing the BusinessService, then emits the routing and template rows to MDMS with deterministic uniqueIdentifiers (`businessService.action.toState.audience.channel` and `audience.action.toState.channel.locale`). Emission is idempotent (duplicate creates tolerated), so tenant setup is re-runnable. Routing and template rows join 1:1 per (audience, action, toState, channel) — an active routing row without a matching template is a config error the checker flags (R2).

**Runtime.** With the flag on, `NotificationService.processConfigDriven` asks `NotificationRouter` for the rows matching (businessService, action, toState); each row yields an audience + channel. `CITIZEN` resolves to the complaint filer; `EMPLOYEE` is kept as a legacy alias for the current assignee; any other value is treated as a workflow **role code** and expands to the tenant's holder pool via an egov-user `roleCodes` search — deliberately mirroring the workflow engine's own `isRoleAvailable` gate. Non-notifiable pseudo-audiences (`AUTO_ESCALATE`, `SYSTEM`) are dropped. `TemplateRenderer` fills placeholders and applies default-locale fallback; PGR then publishes one fully-rendered event per (recipient × channel), deduped on `channel|subscriberId`, with a stable `transactionId` (`complaintId:action:toState:subscriberId:channel`) that doubles as the idempotency key downstream (Novu dedupes triggers on it; `nb_dispatch_log` upserts on it).

**Delivery.** novu-bridge no longer resolves templates or providers for this path: it validates the envelope, optionally consults the consent gate (shipped disabled), identifies the Novu subscriber (contact + locale), triggers the per-channel Novu workflow with the rendered body as payload, and records the outcome in `nb_dispatch_log`. Novu CE v2.3.0 only renders **v2-native** workflows (controlValues + Liquid `{{ payload.body }}`); v1-origin workflows accept triggers and render *nothing* — the "blank email" bug found during the pilot. SMS is delivered via Twilio, email via SMTP, both as Novu integrations.

**WhatsApp.** The channel is **defined in config** — the MDMS schema enum keeps `WHATSAPP`, seeds carry WHATSAPP rows, and PGR will emit WHATSAPP events per config — but delivery is **not yet backed by a production provider**. The Baileys client used during development was test-scaffolding only; it is **not a legitimate provider and is being removed**. WhatsApp delivery activates when a legitimate provider (Meta WhatsApp Cloud API or Twilio WhatsApp, as a Novu integration behind a v2-native `complaints-whatsapp` workflow) is onboarded. Until then, `channel=WHATSAPP` must terminate at the bridge as an **explicit SKIPPED / no-provider dispatch-log row** — never a thrown exception (that would DLQ-spam permanently undeliverable events) and **never a fallback to another channel**. Because the config layer is provider-agnostic and delivery is gated at the bridge edge, onboarding the real provider later is pure Novu configuration plus one flag — zero PGR/MDMS/configurator churn.

### Decommissioning the test WhatsApp path (Baileys removal scope)

Baileys is confined to the delivery edge; the MDMS model, PGR emitter (save one stale test Javadoc), and event contract are untouched by removal:

- **novu-bridge code**: delete `BaileysSendClient.java` and `provider/BaileysProviderStrategy.java`; in `DispatchPipelineService` remove the client dependency and the `WHATSAPP → Baileys` branch; remove the four `novu.bridge.whatsapp.baileys.*` config fields/properties (one of which, the timeout, was already dead code); decide who reclaims the bare `"whatsapp"` alias in the provider-strategy factory (the diff removed it from the Meta strategy specifically to avoid shadowing Baileys); update the stale Javadoc "direct Baileys/Telegram sends bypass the log" notes — bridge-routed WHATSAPP sends already persist rows in `nb_dispatch_log` today, so this is a comment correction, not a new observability gain. Also fix the stale "Baileys for WHATSAPP" Javadoc in `NotificationConfigDrivenEmissionTest.java`.
- **Replacement behavior**: gate WHATSAPP delivery behind a flag (e.g. `novu.bridge.channel.whatsapp.enabled`, default false, optionally backed by a cached probe of Novu's integrations list); when disabled, persist `SKIPPED` / `NB_NO_PROVIDER` via the existing preference-denied pattern. Fix `getNovuWorkflowId`'s default-to-SMS in the same change (see findings).
- **Standalone service**: delete `utilities/baileys-send-service/` entirely (~2.9k lines incl. lockfile).
- **Compose/Ansible**: remove the baileys service block, auth volume, `depends_on`, and env vars from `local-setup/docker-compose.egov-digit.yaml`; the baileys image/token variables and build tasks from the Ansible templates, playbook, and example host_vars; a stray comment in `docker-compose.bomet.yml`.
- **Tests**: delete `BaileysProviderStrategyTest` (4 tests); rewrite `DispatchPipelinePassThroughTest.whatsappEvent_routesToBaileys_notNovu` into the WHATSAPP-no-provider safe-skip test; flip the e2e script's WHATSAPP "warn" branch into a hard SKIPPED assertion.
- **Docs/UI copy**: the design/implementation docs' Baileys-specific decision (D7) is superseded by the target architecture above; reword the configurator Logs screen's "direct WhatsApp not tracked" subtitle and comments.
- **Ops**: remove the container + auth volume from the pilot server, unlink the paired device, discard the send token.
- **Keep**: WHATSAPP routing/template MDMS rows stay authored (tenants wanting silence set `active=false`); `SKIPPED/NB_NO_PROVIDER` rows in the interim are the honest, debuggable representation.

## 3. Configurator management surface

- **Configure tab** (on the Workflow Service screen): per-transition notification authoring anchored on the BusinessService. Live workflow-v2 records carry `action.nextState` as a state **UUID**; the tab resolves UUID → `applicationStatus` so operators see and store real state names. Each transition row shows its (audience × channel) chips with inline add/edit/remove that writes **both** MDMS masters (routing + template) as a pair, relying on server-side x-unique uid derivation. A JSON toggle exposes the raw BusinessService.
- **Static checker** (`validateNotifications`, pure/React-free): R1 audience must be a known role code (error), R2 every active routing row needs an active default-locale template (error, with a distinct message when only another locale exists), R3 channel must be in the allowed set (error), R4 the routing row's (action, toState) must be a real workflow transition (error — this is where the UUID resolution matters), R5 orphan templates with no routing (warn), R6 non-notifiable audiences like AUTO_ESCALATE (warn, and suppresses R1 for them). 11 vitest cases pass.
- **MDMS resources**: Notification Routing and Notification Templates are also browsable/editable as generic MDMS resources with schema descriptors.
- **Logs + Providers screens**: read-only, served through a new novu-bridge proxy — `/novu-adapter/v1/logs` pages `nb_dispatch_log` (tenant-scoped, filterable by reference number prefix/channel/status, clamped limits, honest totals) and `/novu-adapter/v1/integrations` lists Novu integrations with **credentials redacted server-side** (any `credentials` map at any depth is masked wholesale).
- **Pilot caveat (stated honestly)**: the proxy route is **not auth-gated at Kong** on the pilot deployment; recipient masking currently happens client-side only, and two code comments incorrectly claim JWT gating. Hardening (Kong auth + server-side masking + shipping the route in the repo rather than hand-wiring it) is tracked in Open items and the findings table below.

## 4. Key design decisions

1. **Audience = workflow ROLE, with pool semantics.** A routing row's audience is any workflow role code; every current holder of that role in the tenant is notified. This matches the workflow engine's own `isRoleAvailable` actionability gate — the people who *can* act get told they *should*. `CITIZEN` is the filer; `EMPLOYEE` survives only as a legacy alias for the assignee; `assigneeOnly` narrows a role row to the assignee.
2. **Author together, store apart.** Notifications belong conceptually to the workflow, so the authored artifact is the BusinessService JSON — one file, one review surface, config co-located with the transitions it decorates. But workflow-v2 has no extensible field and *silently drops* unknown fields, so persisting there would lose the data. The splitter keeps the engine generic and puts the runtime config where runtime config lives: MDMS.
3. **Pre-render in PGR; the bridge stays domain-dumb.** PGR owns routing, templating, and localization (it has the domain objects and MDMS access); novu-bridge only validates, identifies, triggers, and logs. This keeps the bridge reusable for any future domain topic and makes the Kafka event self-contained and auditable.
4. **One event per (recipient × channel), with a deterministic transactionId.** Fan-out happens at the producer, so every delivery attempt is individually logged, retried, and deduped. `complaintId:action:toState:subscriberId:channel` is idempotent across redeliveries: Novu dedupes triggers on it and `nb_dispatch_log` upserts on (transaction_id, channel, recipient_value).
5. **Feature flag + golden-output parity gate.** The legacy path is untouched; the flag selects one or the other. A 9-test golden-output suite renders every legacy SMS transition through the config-driven path and asserts set-equality with the legacy `NotificationUtil` output — making the eventual default-flip an auditable no-op rather than a leap of faith.
6. **Novu workflows must be v2-native.** Novu CE v2.3.0 renders only v2-origin workflows (controlValues + Liquid `{{ payload.body }}`); v1-origin workflows accept triggers and silently render nothing. The pilot's blank-email bug came from exactly this; workflow bootstrap must create v2-native definitions (see Open items).

## 5. Review findings

Two review streams (backend + configurator) over the exact diff. Material findings, unsoftened:

| # | Severity | Area | Finding | Suggested fix |
|---|----------|------|---------|---------------|
| 1 | **Blocker** | Configurator | All Configure-tab writes are fire-and-forget: `useCreate`/`useUpdate`/`useDelete` called without `{ returnPromise: true }` (ra-core 5.14.5) — every `await` resolves void, all try/catch is dead code, and "Notification added" success toasts fire even when the MDMS write failed | Pass `{ returnPromise: true }` on every mutation call (mode is already pessimistic) |
| 2 | Major | novu-bridge | Unknown/null channel silently falls back to the **SMS** Novu workflow (`getNovuWorkflowId` `default:` branch). Reachable today via legacy envelopes; a future channel string would be silently delivered as SMS. (Note: `getNovuWorkflowId` has an explicit WHATSAPP case, so a naive Baileys removal routes WHATSAPP events to the unprovisioned `complaints-whatsapp` Novu workflow — `NB_NOVU_TRIGGER_FAILED` → DLQ spam, or phantom SENT rows if Novu acknowledges the unknown workflow — which is why the explicit channel-enable gate + SKIPPED/`NB_NO_PROVIDER` row is required work, not what removal alone yields) | Throw `NB_UNSUPPORTED_CHANNEL` or persist SKIPPED; never default to SMS |
| 3 | Major | novu-bridge | Delivery failures never persist a FAILED row — provider exceptions propagate to the consumer, which only logs + DLQs. The new Logs screen shows *nothing* for exactly the failures it exists to surface | try/catch around delivery, persist FAILED with error code, rethrow for DLQ |
| 4 | Major | novu-bridge | Shared `RestTemplate` has no connect/read timeouts; one hung endpoint stalls the entire Kafka consumer (rebalance loops). The new `baileys.timeout.ms` property is dead config nothing reads | Configure a `ClientHttpRequestFactory` with sane timeouts |
| 5 | Major | novu-bridge / deploy | `/novu-adapter/v1/*` has **no auth** (no RequestInfo, Bearer token unchecked); `recipient_value`/`transaction_id` can embed raw phone numbers; referenceNumber prefix search makes complaints enumerable. Simultaneously the repo ships **no route** for it (nginx template declines, no Kong route), so stock deploys 404 and the only way to make the screens work is hand-wiring the unauthenticated proxy | Ship the Kong route **with** auth (EMPLOYEE/ADMIN role) + server-side recipient masking; fix comments claiming JWT gating |
| 6 | Major | pgr-services | Role-pool egov-user search is unpaginated — silently truncates at the default page size (10 in stock config), so a 30-holder role notifies 10 people with no warning. Pool also re-fetched once per (role × channel) | Explicit pageSize + pagination loop (or documented cap with WARN); memoize per-audience within one invocation |
| 7 | Major | pgr-services | No per-channel contact filtering: phone-only users on EMAIL rows produce phantom `SENT` rows (email step fails invisibly inside Novu); email-only users on phone channels produce guaranteed DLQ noise | Filter at emission: EMAIL requires email, SMS/WHATSAPP require phone; log skips |
| 8 | Major | pgr-services | MDMS routing/template caches have **no TTL/invalidation** — configurator edits are invisible until pgr-services restarts. Worse, a log comment claims a legacy fallback that doesn't exist: flag ON + MDMS miss (or unseeded tenant) silently drops ALL notifications, coarse event included | Short TTL (bridge already has the pattern); correct the comment; ERROR-log the drop |
| 9 | Major | Configurator | No duplicate/partial-write handling: MDMS phantom-200 duplicate creates return an empty array → swallowed TypeError → operator's new text **silently discarded** (with a success toast, per #1); partial write leaves an active routing row with no template | Branch Add→update when the key exists; make `mdmsCreate` throw explicitly on an empty create response |
| 10 | Major | Configurator | Edit that changes audience/channel creates a new pair but never deactivates the old — the "edited" notification now fires **twice** | Soft-delete the old ids after creating the new pair, or block key changes in edit mode |
| 11 | Major | Configurator | Remove → re-Add is likely permanently broken: soft-delete leaves the uniqueIdentifier intact, create dedupe collides on it (phantom-200 → swallowed TypeError), and the update path filters to active rows so the inactive row can never be resurrected | Add a reactivation branch: search including inactive rows, update with `isActive=true` |
| 12 | Minor | pgr-services | Dedupe key is added to the emitted set **before** render/publish succeeds — a missing template on the first match burns the key and silently blocks a later valid match for the same user | Add to the set only after successful publish |
| 13 | Minor | pgr-services | Per-recipient localization is not actually implemented: everything renders in the instance default locale; the template `locale` dimension and recipient locale field are dead. Fine for the single-locale pilot, but undocumented | Document the limitation; later resolve real per-recipient locale and render per (audience, channel, locale) |
| 14 | Minor | pgr-services | Authored `fromState` is silently ignored on the production path (router always called with null) — a row constrained to fromState=X applies on every transition into toState | Resolve fromState from the ProcessInstance, or hide the field in schema + UI until honored |
| 15 | Minor | novu-bridge | Idempotency is log-level only: redelivery re-triggers the send. Safe today because Novu dedupes on transactionId, but any non-Novu provider would double-message | Cheap pre-send check for an existing SENT row |
| 16 | Minor | default-data-handler | Splitter NPEs on malformed authoring rows (missing audience/channel/nextState) and only IOException is caught — the NPE aborts tenant setup *after* the workflow was already POSTed | Validate the four fields; skip + WARN on malformed rows |
| 17 | Minor | default-data-handler | **No splitter test** — the designed golden-output round-trip test was never written (only a contextLoads stub exists). Highest-value missing test in the PR | See G1 in the test plan |
| 18 | Minor | Seeds | Two divergent seed sources for the same masters: the dev seed encodes the *legacy* policy (33 rows), `PgrWorkflowConfig.json` the *new* role-pool policy (11 rows) — a tenant seeded by both gets a contradictory merged policy (double SMS on ASSIGN). The regen script also overwrites hand-added WHATSAPP/EMAIL rows | One canonical source (the splitter); generate the dev seed from it |
| 19 | Minor | Logging | Citizen phone numbers logged at INFO across the pipeline (and the bridge ships at DEBUG); with log aggregation this puts MSISDNs in a third store with different retention | Mask to last-4 in log statements |
| 20 | Minor | Configurator | R4's UUID→applicationStatus resolution — the exact regression the checker was fixed for — has **zero test coverage** (all fixtures use symbolic state names the live API never returns) | Add a live-shaped fixture (G8) |
| 21 | Minor | Configurator | Template key lacks `businessService`: once a second workflow onboards, cross-BS template sharing yields R5 false positives and delete-time collateral; PGR's own REOPEN chip is silently shared across two transition rows | businessService prefix on the template key (or at least a "shared" indicator) before a second workflow onboards |
| 22 | Minor | Configurator | `en_IN` hardcoded in checker + Configure tab while the backend default locale is a config property — a deployment flipping it gets false R2 errors and edits that miss the locale the runtime reads | Read the default locale from config; surface non-default-locale siblings |
| 23 | Minor | Configurator | Stale descriptor help says audience is "CITIZEN or EMPLOYEE" (contradicting the role-audience headline feature); `assigneeOnly` is schema-supported but unreachable from any UI | Fix help text; expose or explicitly defer assigneeOnly |
| 24 | Nit | Both | Dead/misleading knobs (`RENDERED_BODY_MODE`, `IDENTIFY_ENABLED`, `channels.default`, inert "rollback" properties whose client class was deleted); committed Playwright report artifacts; ~90 lines of duplicated ValidationPanel JSX; redaction is denylist-by-location (allowlist would be strictly safer in front of an unauthenticated route); unbounded identify-TTL map | Delete or wire up; gitignore artifacts; extract shared panel; allowlist redaction |

**What's done well** (worth keeping as-is): the golden-output legacy-parity gate (including the all-transitions sweep and the explicit rejection of empty-set false proofs) is exactly the right harness for a rewrite-behind-a-flag; `DispatchLogRepository` is cleanly parameterized with mandatory tenantId and clamped limits; the Flyway migration is correctly additive; the splitter's strip-before-POST + idempotent emit ordering is safely re-runnable; `validateNotifications` is pure, well-typed, and fully rule-covered; the "custom" read-only dataProvider type is cleanly scoped; configurator type-check is clean.

## 6. Automated test plan

### Already covered (51 passing automated tests + 1 live E2E, all verified by running the suites)

| Suite | Layer | Count | What it pins |
|-------|-------|-------|--------------|
| `NotificationRouterTest` | pgr-services unit | 14 | Full routing-match matrix: audience keep/drop (roles kept verbatim, AUTO_ESCALATE/SYSTEM dropped), unknown channel dropped, toState disambiguation (RATE), fromState optional/specific, inactive rows, blank inputs |
| `TemplateRendererTest` | pgr-services unit | 5 | Placeholder fill, default-locale fallback, missing template → null, case-insensitive keys, null placeholder left literal |
| `NotificationConfigDrivenEmissionTest` | pgr-services unit | 4 | One event per channel with full envelope assertions, flag-off short-circuit, role-pool fan-out (2 holders → 2 events), cross-role `channel|subscriber` dedupe |
| `NotificationGoldenOutputTest` | pgr-services unit | 9 | SMS backward-compat gate: config-driven output set-equals legacy output for every transition, incl. an all-seed-rows sweep |
| `DispatchPipelinePassThroughTest` | novu-bridge unit | 4 | Verbatim pass-through per channel (no template/provider resolution), preference-denied → SKIPPED |
| `BaileysProviderStrategyTest` | novu-bridge unit | 4 | Baileys-specific; **deleted wholesale with the provider** (its one durable concern — who owns bare `"whatsapp"` in the strategy factory — must be re-pinned against the future provider) |
| `ProviderAgnosticTest` | novu-bridge unit | 2 | Pre-existing legacy tests, weak assertions; not part of this PR |
| `validateNotifications.test.ts` | configurator unit | 11 | All six rules R1–R6, case-insensitivity, string-boolean active flags, inactive-row handling |
| `e2e-role-notifications.js` | live E2E (Bomet pilot) | 1 scenario | **The existing end-to-end test this plan builds on**: drives the complaint workflow via API actions — citizen registers and files (APPLY), employee ASSIGNs, then RESOLVEs — and after each transition asserts the per-role/per-channel dispatch records reaching the Novu pipeline (dispatch-log rows parsed by transactionId, each recipient cross-checked against actual role assignments), against the expected matrix from `PgrWorkflowConfig.json`. Hard-fails on any missing row (WhatsApp currently downgraded to a warning — flips to a hard assertion post-Baileys, see G18) |
| default-data-handler | — | 0 | **Gap**: only a contextLoads stub; the designed splitter round-trip test does not exist (G1) |

**Scope notes**: Baileys-specific delivery tests are **excluded** — the provider is being removed. A **WHATSAPP-no-provider safe-skip test is included** (G2 unit, G18 e2e) to lock in the no-silent-fallback ruling.

### To add

**Unit**

| ID | Component | Case | Priority |
|----|-----------|------|----------|
| G2 | novu-bridge | `channel=WHATSAPP` with no provider → no Novu trigger, no send, explicit SKIPPED/`NB_NO_PROVIDER` dispatch row, and **no SMS fallback** (replaces the Baileys pass-through test) | P0 |
| G4 | pgr-services `NotificationService` | Resolver edges: role with zero holders → zero events, no exception; holder missing phone/email → skipped per channel, rest of pool notified; `assigneeOnly=true` restricts to assignee; EMPLOYEE alias → assignee (not pool search); CITIZEN who also holds a routed role → one message per channel; egov-user search failure → graceful skip | P0 |
| G5 | pgr-services | Fixture-drift guard: golden-test fixtures JSON-equal to the authoritative default-data-handler seed files they were copied from | P0 |
| G6 | novu-bridge | Unknown channel (e.g. `PIGEON`) rejected/skipped with logged status — never defaulted into the SMS workflow (the bridge must defend independently of PGR's router) | P1 |
| G7 | novu-bridge | Novu non-2xx/null response → dispatch row records FAILED (today `SENT` is persisted unconditionally) and the /logs proxy surfaces it | P1 |
| G10 | novu-bridge controllers | Proxy contract: tenantId required (400 absent), filters, pagination clamp, and **redaction** — credentials never appear in the response, including nested provider config | P1 |
| G11 | novu-bridge | Consent-gate flag matrix: OFF → preference service never consulted; ON + allowed → delivered; ON + service unreachable → pin fail-open vs fail-closed explicitly | P1 |
| G12 | pgr-services `MDMSUtils` | Cache semantics: non-empty cached per tenant, empty NOT cached (retry), and a pinning test for the staleness-until-restart behavior | P1 |
| G13 | novu-bridge | EnvelopeValidator negatives through the pipeline: missing body/subscriber/transactionId/contact → rejected with an INVALID log row, no provider call | P1 |
| G20 | pgr-services | Per-recipient locale propagation (e.g. `sw_KE` recipient gets the `sw_KE` template body) — service-level, not just renderer fallback | P2 |

**Integration**

| ID | Component | Case | Priority |
|----|-----------|------|----------|
| G1 | default-data-handler | **Splitter golden round-trip** (highest-value missing test): feed `PgrWorkflowConfig.json` through with mocked workflow-v2 + MDMS clients; assert (a) POSTed workflow has zero notification-field residue at any depth, (b) emitted MDMS payloads exactly equal the checked-in seed fixtures, (c) uid schemes hold, (d) re-run is idempotent under phantom-200 semantics | P0 |
| G3 | novu-bridge | transactionId redelivery idempotency: same event twice → provider send not repeated (or current behavior pinned explicitly); DB-level test of the (transaction_id, channel, recipient_value) upsert key — two recipients coexist, same triple upserts | P0 |
| G19 | novu-bridge | Kafka wiring (embedded Kafka/testcontainers): a JSON event on `complaints.domain.events` reaches the pipeline with the envelope intact | P2 |

**E2E** — all extend the existing Bomet script (same harness, new assertions/scenarios; no duplication of APPLY/ASSIGN/RESOLVE):

| ID | Component | Case | Priority |
|----|-----------|------|----------|
| G14 | e2e script | Extend past RESOLVE: REJECT (separate complaint), REOPEN, RATE against both closed states — asserting each transition's expected matrix (RATE's toState disambiguation is live-path untested) | P2 |
| G15 | e2e script | Multi-holder pool completeness: role with ≥2 holders → dispatch-row count equals holder count with valid contacts (not just ≥1); dual-role holder appears exactly once per channel | P2 |
| G16 | e2e script | Novu-side verification: query Novu's messages/activity API by transactionId and assert the trigger produced a rendered message — closes exactly the observability hole the blank-email bug hid in | P2 |
| G17 | e2e script | Negative case: a transition with no routing rows produces zero new dispatch rows within the wait window — proves config actually gates emission | P2 |
| G18 | e2e script | Post-Baileys WHATSAPP flip: replace the warn branch with a hard assertion that WHATSAPP events log SKIPPED/no-provider and that **no SMS row exists carrying a WhatsApp-routed body** | P2 |

**Configurator UI**

| ID | Component | Case | Priority |
|----|-----------|------|----------|
| G8 | `validateNotifications` | Checker against a live-shaped BusinessService (UUID `nextState`, states carrying uuid + applicationStatus): R4 does not false-positive on valid transitions and does fire on a uuid pointing at a missing state | P1 |
| G9 | Configure tab | Dual-master write path: Add creates both routing and template rows with correct uids; partial failure (routing succeeds, template fails) surfaces an error at write time; Edit and Remove update/deactivate both masters; duplicate-key Add handled | P1 |

## 7. Open items

1. **Proxy auth hardening (pilot → GA gate).** Ship the `/novu-adapter/v1/*` route in the repo **with** Kong auth (EMPLOYEE/ADMIN), add server-side recipient masking, and correct the code comments that currently claim JWT gating. Until then the Logs/Providers screens either 404 on stock deploys or run over a hand-wired unauthenticated proxy — neither is acceptable beyond the pilot.
2. **WhatsApp provider onboarding.** Onboard a legitimate provider (Meta WhatsApp Cloud API or Twilio WhatsApp) as a Novu integration with a v2-native `complaints-whatsapp` workflow, then flip the bridge's channel-enable gate. Config, seeds, and configurator need no changes. Interim behavior: explicit SKIPPED/no-provider rows (G2/G18 pin this).
3. **Novu workflow bootstrap must create v2-native workflows.** CE v2.3.0 silently renders nothing for v1-origin workflows — the blank-email failure mode. Any bootstrap/sync automation must create workflows with controlValues + Liquid payload bindings, and G16 gives the e2e detection net. Related upstream work: issue #972 (Novu template sync) and #973 (provider wrap).
4. **Consent gate rollout.** The preference gate is shipped disabled; before enabling, pin fail-open vs fail-closed on preference-service outage (G11) and define the citizen-facing opt-out surface.
5. **MDMS cache invalidation.** Decide TTL vs explicit refresh hook for pgr-services' routing/template caches so configurator edits take effect without a restart (finding #8, test G12).
6. **Seed-source consolidation.** Make the splitter the single canonical source for routing/template seeds; regenerate the dev seed from it (finding #18).
7. **Cross-references.** Telegram as a future channel: discussion #995 (RFC) — the unknown-channel handling in finding #2 and G6 is a prerequisite for adding any new channel safely. Novu template sync and provider wrapping: issues #972 / #973.