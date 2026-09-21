# Notification E2E suite (config-driven PGR notifications)

End-to-end tests for the config-driven PGR notification feature — provider
management, MDMS routing/templates, per-recipient fan-out, consent, and delivery
through Novu. Each case is API/DB-driven against a **live** DIGIT stack and maps
to the production code it exercises (linked below).

- **Harness:** [`notif-harness.js`](./notif-harness.js) — shared primitives (Kong HTTP, `psql`, DIGIT auth, provider API, `nb_dispatch_log`, MDMS search, the per-tenant config-source rule, one shared complaint fixture).
- **Config rules:** [`notif-config.js`](./notif-config.js) — the pure functions behind those decisions (source selection, `eventName` parsing, audience schemes, the channel-outcome expectation table). No I/O, no env, so they are unit-tested without a server: `node --test notif-config.test.js`.
- **Runner:** [`run-notif-suite.js`](./run-notif-suite.js) / [`run-notif-suite.sh`](./run-notif-suite.sh) — runs `cases/area-*.js` and prints a PASS/FAIL/SKIP matrix keyed by case id. Exits non-zero on any **FAIL** (SKIP is not a failure).
- **Cases:** one file per area under [`cases/`](./cases/).

### Which config namespace the suite reads

Notification config is moving from the PGR-specific `RAINMAKER-PGR.Notification*` masters to the
module-neutral `NOTIFICATIONS.*` ones. The suite does not pick a side and is not configured to: it
mirrors the bridge's own rule, **per tenant and all-or-nothing** — a tenant with active rows in
`NOTIFICATIONS.Routing` is served the new masters for every master; a tenant with none is served
its legacy rows through the read adapter. That decision is made in exactly one place
(`H.notificationSource()`), printed in the run header, and every area reads its masters through
`H.notifMaster()` / `H.notifSchemaCode()`. Area **H** asserts the endpoint that makes the same
answer readable in production, `GET /novu-adapter/v1/config/source`.

Setting up the feature? Use the single [Novu notifications guide](../../../../docs/2.12/notifications/README.md).

## Run it

Run **on the DIGIT host** (the harness shells out to `docker exec <pg> psql` and reaches Kong at `localhost:18000`):

```bash
E2E_EMP_USER=<employee> E2E_EMP_PASS=<pass> \
  ./run-notif-suite.sh --target=bomet          # all areas
E2E_EMP_USER=<employee> E2E_EMP_PASS=<pass> \
  ./run-notif-suite.sh --only=A,C              # a subset
```

Env (full list in [`notif-harness.js`](./notif-harness.js)): `BASE`, `DIGIT_TENANT`, `SERVICE_CODE`, `SERVICE_NAME`, `LOCALITY`, `TEST_PHONE`, `TEST_EMAIL`, `E2E_EMP_USER`, `E2E_EMP_PASS`, `NOVU_API_KEY` (auto-resolved from the `novu-bridge` container if unset), `PG_CONTAINER`.

## Legend

- **Bomet** = result on the pilot (`bometfeedbackhub.digit.org`). ✅ PASS · ⏭ SKIP (not a failure — reason given).
- **Test** links the case file; the anchor (e.g. `guard('A1'`) is the grep target inside it.
- **Exercises** links the production code each case drives (repo-root-relative). Line anchors are approximate.
- Latest full run on the pilot: **40 cases — 27 ✅ / 0 ❌ / 13 ⏭.** The 13 SKIPs fall into three buckets: (1) a deployment gate is off on Bomet (proxy-auth, preference/consent, WhatsApp channel), (2) the case mutates config or injects a fault (needs a throwaway stack), or (3) it's a Configurator UI check (Playwright, out of this API suite's scope). Most are unlockable on a fresh stack; behavior is also covered by the unit tests linked at the bottom.
- **The four cases added with the thin-event move — F1b, H1, H2, H3 — have NOT been run on the pilot yet** (44 cases total). They need a deployment carrying the resolution stage; against the pre-move producer every one of them SKIPs with the reason, which is the intended answer and not a pass.

---

## Area A — Provider management

Novu integrations via the novu-bridge `ProviderController`. **Test file:** [`cases/area-a-providers.js`](./cases/area-a-providers.js) (every integration is dummy-credentialled + named `zz-e2e-*` and deleted in a `finally`).

| Case | What it verifies | Test | Exercises | Bomet |
|---|---|---|---|---|
| **A1** | Add SMS provider → 200 with integration `_id`, `providerId=twilio`, Novu `channel=sms`. | `guard('A1'` | [`ProviderController#L83`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java#L83) createProvider/toNovuChannel · [`NovuClient#L359`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java#L359) createIntegration · [`IntegrationProjection#L37`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/IntegrationProjection.java#L37) | ✅ |
| **A2** | Add Email provider → 200 with `_id`, Novu `channel=email` (nodemailer). | `guard('A2'` | [`ProviderController#L83`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java#L83) EMAIL→email · [`NovuClient#L359`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java#L359) SMTP creds verbatim | ✅ |
| **A3** | Add WhatsApp provider → maps to the Twilio `sms` channel (`whatsapp:` sender, not a separate Novu channel). | `guard('A3'` | [`ProviderController#L279`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java#L279) toNovuChannel WHATSAPP→sms · [`NovuClient#L359`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java#L359) | ✅ |
| **A4** | Creds never echoed — neither the create response nor `/integrations` carries `credentials`/token/SID (allowlist). | `guard('A4'` | [`IntegrationProjection#L25`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/IntegrationProjection.java#L25) ALLOWED_FIELDS · [`IntegrationController#L50`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/IntegrationController.java#L50) · [`NovuClient#L378`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java#L378) logs key names only | ✅ |
| **A5** | Verify → `{ok:true,active:true}` for a live integration; `{ok:false}` "no matching" for a missing id. | `guard('A5'` | [`ProviderController#L163`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java#L163) verify · [`NovuClient#L318`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java#L318) listIntegrations | ✅ |
| **A6** | Test-send SMS → Novu 2xx + exactly one `TEST`-tagged `nb_dispatch_log` row with a **masked** recipient. | `guard('A6'` | [`ProviderController#L214`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java#L214) testSend · [`DispatchLogRepository#L33`](/backend/novu-bridge/src/main/java/org/egov/novubridge/repository/DispatchLogRepository.java#L33) upsert · [`PiiMask`](/backend/novu-bridge/src/main/java/org/egov/novubridge/util/PiiMask.java) mask | ✅ |
| **A7** | Test-send WhatsApp → Novu accepts the trigger with the `whatsapp:+E164` + ContentSid/ordered-vars override. | `guard('A7'` | [`ProviderController#L246`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java#L246) buildWhatsappOverrides · [`TwilioProviderStrategy#L45`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/provider/TwilioProviderStrategy.java#L45) · [`DispatchLogRepository#L33`](/backend/novu-bridge/src/main/java/org/egov/novubridge/repository/DispatchLogRepository.java#L33) | ✅ |
| **A8** | Pull templates → lists Novu workflows (`complaints-sms`, `complaints-email`), only `workflowId`+`name`. | `guard('A8'` | [`ProviderController#L113`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java#L113) templates/extractWorkflows · [`NovuClient#L405`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java#L405) listWorkflows | ✅ |
| **A9** | Two Twilio SMS integrations (different `from`) coexist. | `guard('A9'` | [`ProviderController#L83`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java#L83) · [`NovuClient#L359`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java#L359) | ✅ |
| **A10** | Auth gate: unauthenticated `/providers/templates` → 401 (when the proxy-auth gate is ON). | `guard('A10'` | [`ProxyAuthFilter#L82`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/filters/ProxyAuthFilter.java#L82) · [`NovuBridgeConfiguration#L72`](/backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java#L72) proxyAuthEnabled | ⏭ gate off on Bomet (`NOVU_BRIDGE_PROXY_AUTH_ENABLED=false`) |
| **A-cleanup** | Every `zz-e2e` integration deleted; all pre-existing real integrations still present. | `FAIL('A-cleanup'` | [`ProviderController#L83`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java#L83) · [`NovuClient#L359`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java#L359) | ✅ |

## Area B — Routing & channels

The **Routing** master — `NOTIFICATIONS.Routing` or `RAINMAKER-PGR.NotificationRouting`, whichever
serves the tenant — plus the channel gate. **Test file:** [`cases/area-b-routing.js`](./cases/area-b-routing.js).

| Case | What it verifies | Test | Exercises | Bomet |
|---|---|---|---|---|
| **B1** | City has no routing → falls back to state rows (complaint still dispatches). Reads whichever Routing master serves the tenant. | `guard('B1'` | [`ChannelPolicyClient`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/policy/ChannelPolicyClient.java) per-tenant namespace fallback · [`NotificationRouter#L62`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/NotificationRouter.java#L62) route · [`NOTIFICATIONS.Routing.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/NOTIFICATIONS/NOTIFICATIONS.Routing.json) · [`NotificationRouting.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationRouting.json) | ✅ |
| **B2** | Disable a channel (routing `active=false`) → no dispatch. | `SKIP('B2'` | [`NotificationRouter#L66`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/NotificationRouter.java#L66) honors `active=false` | ⏭ mutates MDMS + needs a pgr-services restart on the pre-move path (fresh stack) |
| **B3** | Per-audience × channel fan-out, against the tenant's **own** routing rows rather than a hardcoded CITIZEN/GRO pair — audiences are matched through the scheme parser, so `CITIZEN` and `ACTOR:citizen` are one check. | `guard('B3'` | [`NotificationService#L877`](/backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java#L877) fan-out loop · [`notif-config.js`](./notif-config.js) `buildExpectRows` / `rowMatchesAudience` · [`DispatchLogRepository#L33`](/backend/novu-bridge/src/main/java/org/egov/novubridge/repository/DispatchLogRepository.java#L33) | ✅ |
| **B4** | WhatsApp rows carry the outcome the tenant's **own channel policy** predicts — off → `NB_NO_PROVIDER`, on with no approved template → `NB_TEMPLATE_NOT_APPROVED`, on with an unusable provider → `NB_PROVIDER_UNAVAILABLE`, otherwise `SENT` — and **no SMS fallback**, always. | `guard('B4'` | [`DispatchPipelineService#L146`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java#L146) gates 2–3 · [`ChannelPolicyClient`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/policy/ChannelPolicyClient.java) · [`notif-config.js`](./notif-config.js) `channelExpectation` | ✅ |

## Area C — Templates

The **Template** + **ProviderTemplate** masters, in whichever namespace serves the tenant.
**Test file:** [`cases/area-c-templates.js`](./cases/area-c-templates.js).

| Case | What it verifies | Test | Exercises | Bomet |
|---|---|---|---|---|
| **C1** | City has no template → state fallback (bodies still render). | `guard('C1'` | [`NotificationService#L867`](/backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java#L867) processConfigDriven · [`MDMSUtils#L136`](/backend/pgr-services/src/main/java/org/egov/pgr/util/MDMSUtils.java#L136) getNotificationTemplates · [`NotificationTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationTemplate.json) | ✅ |
| **C2** | Per-tenant (city) template override. | `SKIP('C2'` | [`MDMSUtils#L137`](/backend/pgr-services/src/main/java/org/egov/pgr/util/MDMSUtils.java#L137) getStateLevelTenant · [`TemplateRenderer#L69`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/TemplateRenderer.java#L69) | ⏭ no city-level template authored on Bomet |
| **C3** | Per-locale templates (en_IN/hi_IN) both present for locale selection. | `guard('C3'` | [`TemplateRenderer#L69`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/TemplateRenderer.java#L69) locale dim · [`NotificationTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationTemplate.json) · [`PGRConfiguration#L253`](/backend/pgr-services/src/main/java/org/egov/pgr/config/PGRConfiguration.java#L253) default.locale | ⏭ only en_IN seeded on Bomet |
| **C4** | Missing-locale template → default-locale fallback. | `SKIP('C4'` | [`TemplateRenderer#L55`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/TemplateRenderer.java#L55) default-locale retry · [`PGRConfiguration#L253`](/backend/pgr-services/src/main/java/org/egov/pgr/config/PGRConfiguration.java#L253) | ⏭ needs controlled missing-locale seed (unit-covered) |
| **C5** | Positional variables substituted in the template's declared order (complaint_type → id → date). | `guard('C5'` | [`TemplateRenderer#L85`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/TemplateRenderer.java#L85) substitute · [`NotificationService#L1120`](/backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java#L1120) buildPlaceholderValues · [`NotificationTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationTemplate.json) | ✅ |
| **C6** | `complaint_type` renders the localized **name** (not the code); status localized too. | `guard('C6'` | [`NotificationService#L1129`](/backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java#L1129) localize category · [`NotificationService#L1136`](/backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java#L1136) localize status · [`TemplateRenderer#L85`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/TemplateRenderer.java#L85) | ✅ |
| **C7** | The APPLY/WHATSAPP ProviderTemplate row resolves a valid Twilio ContentSid (`HX…`) — keyed off `eventName` in the new namespace and off `action`+`toState` in the legacy one. | `guard('C7'` | [`NotificationProviderTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationProviderTemplate.json) · [`RAINMAKER-PGR.json#L376`](/utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json#L376) schema · [`TwilioProviderStrategy#L87`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/provider/TwilioProviderStrategy.java#L87) | ✅ |
| **C8** | Param removed from declared order → placeholder handling. | `SKIP('C8'` | [`NotificationProviderTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationProviderTemplate.json) `variables` · [`ProviderController#L328`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java#L328) toContentVariables | ⏭ needs controlled ProviderTemplate edit (unit-covered) |
| **C9** | Delivery workflows (`complaints-sms`/`complaints-email`) are valid Novu workflows; fixture produced SENT rows. | `guard('C9'` | [`ProviderController#L113`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java#L113) · [`NovuClient#L405`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java#L405) · [`NovuBridgeConfiguration#L99`](/backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java#L99) workflow-id map | ✅ |

## Area D — Preferences & consent

`digit-user-preferences-service` via the novu-bridge proxy + consent gate. **Test file:** [`cases/area-d-preferences.js`](./cases/area-d-preferences.js).

| Case | What it verifies | Test | Exercises | Bomet |
|---|---|---|---|---|
| **D1** | Per-channel consent gate (deliver only GRANTED channels). | `SKIP('D1'` | [`PreferenceServiceClient#L30`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/PreferenceServiceClient.java#L30) isChannelAllowed · [`NovuBridgeConfiguration#L43`](/backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java#L43) preferenceEnabled | ⏭ preference gate off on Bomet |
| **D2** | Tenant-specific consent scope. | `SKIP('D2'` | [`PreferenceServiceClient#L88`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/PreferenceServiceClient.java#L88) scope/scopeTenant · [`NovuBridgeConfiguration#L43`](/backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java#L43) | ⏭ preference gate off on Bomet |
| **D3** | Default = revoked, no fallback (absent preference → not delivered). | `SKIP('D3'` | [`PreferenceServiceClient#L66`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/PreferenceServiceClient.java#L66) default-deny · [`NovuBridgeConfiguration#L43`](/backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java#L43) | ⏭ preference gate off on Bomet |
| **D4** | `GET /preferences` → 200; a stored preference carries a non-empty `preferredLanguage`. | `guard('D4'` | [`PreferenceController#L58`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/PreferenceController.java#L58) · [`PreferenceServiceClient#L177`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/PreferenceServiceClient.java#L177) listPreferences · [`ProxyAuthFilter#L74`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/filters/ProxyAuthFilter.java#L74) | ✅ |
| **D5** | Preference read is stable across re-fetch (same userId+lang+consent set). | `guard('D5'` | [`PreferenceController#L58`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/PreferenceController.java#L58) · [`PreferenceServiceClient#L177`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/PreferenceServiceClient.java#L177) | ✅ |
| **D6** | Consent surfaced read-only in the Configurator screen. | `SKIP('D6'` | [`PreferenceController#L58`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/PreferenceController.java#L58) (endpoint the UI consumes) | ⏭ Configurator UI (Playwright, out of API-suite scope) |

## Area E — Delivery + resilience

Novu → provider, plus regression guards. **Test file:** [`cases/area-e-delivery.js`](./cases/area-e-delivery.js).

| Case | What it verifies | Test | Exercises | Bomet |
|---|---|---|---|---|
| **E1** | SMS delivers — ≥1 `nb_dispatch_log` SMS row `SENT` (Novu accepted). | `guard('E1'` | [`NotificationService#L1197`](/backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java#L1197) publishRenderedEvent · [`DispatchPipelineService#L177`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java#L177) SENT row · [`NovuClient#L58`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java#L58) trigger | ✅ |
| **E2** | Email delivers + **non-empty subject** (empty-subject regression guard). | `guard('E2'` | [`TemplateRenderer#L47`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/TemplateRenderer.java#L47) renderSubject · [`NovuClient#L71`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java#L71) payload.subject · [`DispatchPipelineService#L177`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java#L177) | ✅ |
| **E3** | WhatsApp via Novu ContentSid override delivery. | `SKIP('E3'` | [`NovuBridgeConfiguration#L120`](/backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java#L120) isChannelEnabled · [`DispatchPipelineService#L117`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java#L117) | ⏭ WhatsApp gated off on Bomet |
| **E4** | Expired Twilio auth → delivery `FAILED`, pipeline doesn't crash. | `SKIP('E4'` | [`DispatchPipelineService#L153`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java#L153) catch→FAILED · [`NovuClient#L194`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java#L194) | ⏭ fault injection unsafe on live Bomet (unit: `DispatchPipelineFailureRowTest`) |
| **E5** | url-shortener outage doesn't leave literal `{placeholder}` braces. | `guard('E5'` | [`NotificationService#L1147`](/backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java#L1147) isolated download_link try · [`TemplateRenderer#L85`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/TemplateRenderer.java#L85) · [`NotificationUtil#L166`](/backend/pgr-services/src/main/java/org/egov/pgr/util/NotificationUtil.java#L166) getShortnerURL | ✅ |

## Area F — MDMS master lifecycle & resolution

The masters via mdms-v2 + the resolver, in whichever namespace serves the tenant.
**Test file:** [`cases/area-f-mdms.js`](./cases/area-f-mdms.js).

| Case | What it verifies | Test | Exercises | Bomet |
|---|---|---|---|---|
| **F1** | mdms-v2 `_search` returns non-empty rows for Routing + Template + ProviderTemplate at the state tenant, under the serving namespace. | `guard('F1'` | [`NOTIFICATIONS.json`](/utilities/default-data-handler/src/main/resources/schema/NOTIFICATIONS.json) · [`RAINMAKER-PGR.json`](/utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json) schemas · [`NOTIFICATIONS.Routing.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/NOTIFICATIONS/NOTIFICATIONS.Routing.json) | ✅ |
| **F1b** | On a copied tenant, `NOTIFICATIONS.EventCatalogue` has rows and every `eventName` splits into `(action, toState)`. An uncatalogued name is `REJECTED`/`NB_EVENT_NOT_IN_CATALOGUE`, so an empty catalogue on the new namespace is a silent outage. | `guard('F1b'` | [`error-codes.md`](/docs/2.12/notifications/contract/error-codes.md) `NB_EVENT_NOT_IN_CATALOGUE` · [`generate_event_catalogue.py`](/local-setup/scripts/generate_event_catalogue.py) | new — SKIPs on a tenant still served the legacy namespace |
| **F2** | Uniqueness — no duplicate template keys. The key is per namespace: `(eventName,audience,channel,locale)` for `NOTIFICATIONS.Template`, `(audience,action,toState,channel,locale)` for the legacy master (`eventName` subsumes action+toState). | `guard('F2'` | [`NOTIFICATIONS.json`](/utilities/default-data-handler/src/main/resources/schema/NOTIFICATIONS.json) x-unique · [`RAINMAKER-PGR.json#L318`](/utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json#L318) x-unique | ✅ |
| **F3** | Resolve by (transition, audience, channel, locale) → exactly one row, and the live SMS body starts with that template's prefix. Audience matched through the scheme parser. | `guard('F3'` | [`TemplateRenderer#L69`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/TemplateRenderer.java#L69) findField · [`notif-config.js`](./notif-config.js) `parseAudience` | ✅ |
| **F4** | No-template-resolved → skip + honest log. On the thin path it is no longer only a log line: a routed recipient with no template is a `SKIPPED` row on the **real** channel with `NB_NO_TEMPLATE`. | `SKIP('F4'` | [`error-codes.md`](/docs/2.12/notifications/contract/error-codes.md) `NB_NO_TEMPLATE` · [`TemplateRenderer#L60`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/TemplateRenderer.java#L60) | ⏭ needs orphan key (unit: `NotificationResolverEdgeCasesTest`) |
| **F5** | Rendered body carries live token data — complaint id + dd/mm/yyyy date substituted. | `guard('F5'` | [`NotificationService#L1127`](/backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java#L1127) buildPlaceholderValues · [`TemplateRenderer#L85`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/TemplateRenderer.java#L85) · [`DispatchPipelineService#L147`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java#L147) | ✅ |

---

## Area G — Login OTP through the bridge

Login OTPs are DIGIT-core `SMSRequest`s on `egov.core.notification.sms`; novu-bridge translates them into the envelope and delivers them like any other SMS. **Test file:** [`cases/area-g-otp.js`](./cases/area-g-otp.js). Needs the `otp` profile (`enable_otp_services: true`, Kong mocks stripped); the cases SKIP when `/user-otp` is still the mock.

| Case | What it verifies | Test | Exercises | Bomet |
|---|---|---|---|---|
| **G1** | `POST /user-otp/v1/_send` for a test number leaves a `CORE.SMS.OTP` dispatch-log row at the tenant — `SENT`, or `SKIPPED/NB_NO_PROVIDER` when SMS is off. Never no row. | `guard('G1'` | [`CoreSmsTranslator`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/core/CoreSmsTranslator.java) · [`CoreSmsConsumer`](/backend/novu-bridge/src/main/java/org/egov/novubridge/consumer/CoreSmsConsumer.java) | ⏭ otp profile off |
| **G2** | The OTP row never stores the code: neither `provider_response_jsonb` nor `last_error_message` contains the 6-digit OTP. | `guard('G2'` | [`DispatchPipelineService`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java) persist path | ⏭ otp profile off |

---

## Area H — Thin-event path

The move itself: notification decisions leaving `pgr-services` and landing in the box. Areas A–G
assert notification *behaviour* and are deliberately blind to which half produced it; these three
assert **which half did**. **Test file:** [`cases/area-h-thin.js`](./cases/area-h-thin.js).

Every case SKIPs cleanly, with the reason, on a server still running the pre-move producer — a 404
from the endpoint or a missing `source_path` column is a deployment fact, not a test failure.

| Case | What it verifies | Test | Exercises | Bomet |
|---|---|---|---|---|
| **H1** | `GET /novu-adapter/v1/config/source?tenantId=` reports which namespace serves each master, with **non-zero** row counts, and agrees with what `eg_mdms_data` says on this host. There is no setting to read — the data chooses — so this endpoint *is* the observability, and an endpoint that reports nothing is the failure mode. | `guard('H1'` | [`ConfigSourceController`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ConfigSourceController.java) · [`ConfigSourceReport`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/config/ConfigSourceReport.java) | new — needs a bridge with the resolution stage |
| **H2** | `POST /novu-adapter/v1/dispatch/_resolve` on an APPLY-shaped thin event returns the **would-be** envelopes (complete v1 fields, well-formed `transactionId`s) or a `terminalCode` saying why there are none — and writes **no ledger row**: the total from `/logs` is identical before and after. A dry run that quietly wrote rows would be worse than none, because operators point it at production. | `guard('H2'` | [`DispatchController#_resolve`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/DispatchController.java) · [`ThinEventResolveResponse`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/models/ThinEventResolveResponse.java) · [`thin-event-v1.schema.json`](/docs/2.12/notifications/contract/thin-event-v1.schema.json) | new — admin-only; needs `E2E_EMP_USER`/`E2E_EMP_PASS` when the proxy-auth gate is on |
| **H3** | A real complaint's ledger rows all carry `source_path=RESOLVED`. A complaint producing **both** `RESOLVED` and `PRERENDERED` rows FAILS: two producers are live at once, which is the rolling-cutover double-send risk (design R1), and the ledger cannot show it any other way because both paths mint the same `transaction_id`. | `guard('H3'` | [`outputs.md`](/docs/2.12/notifications/contract/outputs.md) `source_path` · [`V20260921130000__add_source_path.sql`](/backend/novu-bridge/src/main/resources/db/migration/main/V20260921130000__add_source_path.sql) | new — SKIPs when the column is absent or every row is `PRERENDERED` |

---

## Related unit/component tests

The SKIP-only behaviors (fault injection, locale/orphan fallback, config mutation) are pinned by these fast tests:

- **pgr-services emitter** — [`service/notification/`](/backend/pgr-services/src/test/java/org/egov/pgr/service/notification): `NotificationRouterTest`, `TemplateRendererTest`, `NotificationResolverEdgeCasesTest`, `NotificationRolePoolResolutionTest`, `NotificationGoldenOutputTest`, `NotificationConfigDrivenEmissionTest`, `SeedFixtureDriftTest`, and [`MDMSUtilsNotificationCacheTest`](/backend/pgr-services/src/test/java/org/egov/pgr/util/MDMSUtilsNotificationCacheTest.java).
- **novu-bridge** — provider endpoints, `ProxyAuthFilter` auth gate, dispatch FAILED-row persistence (`DispatchPipelineFailureRowTest`).
- **default-data-handler** — [`PgrWorkflowConfigSplitterTest`](/utilities/default-data-handler/src/test/java/org/egov/handler/service/PgrWorkflowConfigSplitterTest.java) (BusinessService split + malformed-config skip).
- **Configurator** — `validateNotifications.test.ts` (notification config vs. workflow BusinessService state machine, rules R1–R6).
- **This suite's own rules** — [`notif-config.test.js`](./notif-config.test.js), run with `node --test` and no server at all. It pins source selection, `eventName` parsing, the audience-scheme table (including chains and legacy bare names), the audience-index join, the channel-outcome expectation table and the E2E-4 no-routing expectation. CI runs it from [`notification-e2e-helpers.yml`](/.github/workflows/notification-e2e-helpers.yml).
