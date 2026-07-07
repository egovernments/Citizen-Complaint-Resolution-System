# Notification E2E suite (config-driven PGR notifications)

End-to-end tests for the config-driven PGR notification feature — provider
management, MDMS routing/templates, per-recipient fan-out, consent, and delivery
through Novu. Each case is API/DB-driven against a **live** DIGIT stack and maps
to the production code it exercises (linked below).

- **Harness:** [`notif-harness.js`](./notif-harness.js) — shared primitives (Kong HTTP, `psql`, DIGIT auth, provider API, `nb_dispatch_log`, MDMS search, one shared complaint fixture).
- **Runner:** [`run-notif-suite.js`](./run-notif-suite.js) / [`run-notif-suite.sh`](./run-notif-suite.sh) — runs `cases/area-*.js` and prints a PASS/FAIL/SKIP matrix keyed by case id. Exits non-zero on any **FAIL** (SKIP is not a failure).
- **Cases:** one file per area under [`cases/`](./cases/).

Setting up the feature? See the install docs: [fresh install](../../../../docs/notification-onboarding/install-fresh.md) · [upgrade an existing deployment](../../../../docs/notification-onboarding/install-upgrade.md) · [Configurator tutorial](../../../../docs/notification-onboarding/TUTORIAL.md) · [provider runbook](../../../../docs/notification-onboarding/provider-onboarding-runbook.md).

## Run it

Run **on the DIGIT host** (the harness shells out to `docker exec <pg> psql` and reaches Kong at `localhost:18000`):

```bash
E2E_EMP_USER=<employee> E2E_EMP_PASS=<pass> \
  ./run-notif-suite.sh --target=bomet          # all areas
./run-notif-suite.sh --only=A,C                # a subset
```

Env (full list in [`notif-harness.js`](./notif-harness.js)): `BASE`, `DIGIT_TENANT`, `SERVICE_CODE`, `SERVICE_NAME`, `LOCALITY`, `TEST_PHONE`, `TEST_EMAIL`, `E2E_EMP_USER`, `E2E_EMP_PASS`, `NOVU_API_KEY` (auto-resolved from the `novu-bridge` container if unset), `PG_CONTAINER`.

## Legend

- **Bomet** = result on the pilot (`bometfeedbackhub.digit.org`). ✅ PASS · ⏭ SKIP (not a failure — reason given).
- **Test** links the case file; the anchor (e.g. `guard('A1'`) is the grep target inside it.
- **Exercises** links the production code each case drives (repo-root-relative). Line anchors are approximate.
- Latest full run on the pilot: **40 cases — 27 ✅ / 0 ❌ / 13 ⏭.** The 13 SKIPs fall into three buckets: (1) a deployment gate is off on Bomet (proxy-auth, preference/consent, WhatsApp channel), (2) the case mutates config or injects a fault (needs a throwaway stack), or (3) it's a Configurator UI check (Playwright, out of this API suite's scope). Most are unlockable on a fresh stack; behavior is also covered by the unit tests linked at the bottom.

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

MDMS `NotificationRouting` + the channel gate. **Test file:** [`cases/area-b-routing.js`](./cases/area-b-routing.js).

| Case | What it verifies | Test | Exercises | Bomet |
|---|---|---|---|---|
| **B1** | City has no routing → falls back to state rows (complaint still dispatches). | `guard('B1'` | [`NotificationRouter#L62`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/NotificationRouter.java#L62) route · [`MDMSUtils#L113`](/backend/pgr-services/src/main/java/org/egov/pgr/util/MDMSUtils.java#L113) getNotificationRouting · [`NotificationRouting.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationRouting.json) | ✅ |
| **B2** | Disable a channel (routing `active=false`) → no dispatch. | `SKIP('B2'` | [`NotificationRouter#L66`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/NotificationRouter.java#L66) honors `active=false` | ⏭ mutates MDMS + needs pgr-services restart (fresh stack) |
| **B3** | Per-audience × channel fan-out — CITIZEN over SMS+EMAIL, GRO over SMS. | `guard('B3'` | [`NotificationService#L877`](/backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java#L877) fan-out loop · [`NotificationRouter#L101`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/NotificationRouter.java#L101) one match per (audience,channel) · [`DispatchLogRepository#L33`](/backend/novu-bridge/src/main/java/org/egov/novubridge/repository/DispatchLogRepository.java#L33) | ✅ |
| **B4** | WhatsApp gated off → WA rows `SKIPPED`/`NB_NO_PROVIDER`, **no SMS fallback**. | `guard('B4'` | [`DispatchPipelineService#L116`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java#L116) Gate 2 · [`NovuBridgeConfiguration#L117`](/backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java#L117) channels.enabled · [`NotificationService#L877`](/backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java#L877) distinct WA event | ✅ |

## Area C — Templates

`NotificationTemplate` + `NotificationProviderTemplate`. **Test file:** [`cases/area-c-templates.js`](./cases/area-c-templates.js).

| Case | What it verifies | Test | Exercises | Bomet |
|---|---|---|---|---|
| **C1** | City has no template → state fallback (bodies still render). | `guard('C1'` | [`NotificationService#L867`](/backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java#L867) processConfigDriven · [`MDMSUtils#L136`](/backend/pgr-services/src/main/java/org/egov/pgr/util/MDMSUtils.java#L136) getNotificationTemplates · [`NotificationTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationTemplate.json) | ✅ |
| **C2** | Per-tenant (city) template override. | `SKIP('C2'` | [`MDMSUtils#L137`](/backend/pgr-services/src/main/java/org/egov/pgr/util/MDMSUtils.java#L137) getStateLevelTenant · [`TemplateRenderer#L69`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/TemplateRenderer.java#L69) | ⏭ no city-level template authored on Bomet |
| **C3** | Per-locale templates (en_IN/hi_IN) both present for locale selection. | `guard('C3'` | [`TemplateRenderer#L69`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/TemplateRenderer.java#L69) locale dim · [`NotificationTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationTemplate.json) · [`PGRConfiguration#L253`](/backend/pgr-services/src/main/java/org/egov/pgr/config/PGRConfiguration.java#L253) default.locale | ⏭ only en_IN seeded on Bomet |
| **C4** | Missing-locale template → default-locale fallback. | `SKIP('C4'` | [`TemplateRenderer#L55`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/TemplateRenderer.java#L55) default-locale retry · [`PGRConfiguration#L253`](/backend/pgr-services/src/main/java/org/egov/pgr/config/PGRConfiguration.java#L253) | ⏭ needs controlled missing-locale seed (unit-covered) |
| **C5** | Positional variables substituted in the template's declared order (complaint_type → id → date). | `guard('C5'` | [`TemplateRenderer#L85`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/TemplateRenderer.java#L85) substitute · [`NotificationService#L1120`](/backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java#L1120) buildPlaceholderValues · [`NotificationTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationTemplate.json) | ✅ |
| **C6** | `complaint_type` renders the localized **name** (not the code); status localized too. | `guard('C6'` | [`NotificationService#L1129`](/backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java#L1129) localize category · [`NotificationService#L1136`](/backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java#L1136) localize status · [`TemplateRenderer#L85`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/TemplateRenderer.java#L85) | ✅ |
| **C7** | APPLY/WHATSAPP `NotificationProviderTemplate` resolves a valid Twilio ContentSid (`HX…`). | `guard('C7'` | [`NotificationProviderTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationProviderTemplate.json) · [`RAINMAKER-PGR.json#L376`](/utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json#L376) schema · [`TwilioProviderStrategy#L87`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/provider/TwilioProviderStrategy.java#L87) | ✅ |
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

The 3 masters via mdms-v2 + the emitter's resolver. **Test file:** [`cases/area-f-mdms.js`](./cases/area-f-mdms.js).

| Case | What it verifies | Test | Exercises | Bomet |
|---|---|---|---|---|
| **F1** | mdms-v2 `_search` returns non-empty rows for all three masters at the state tenant. | `guard('F1'` | [`RAINMAKER-PGR.json`](/utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json) schemas · [`NotificationTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationTemplate.json) · [`NotificationRouting.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationRouting.json) | ✅ |
| **F2** | Uniqueness — no duplicate `(audience,action,toState,channel,locale)` template rows. | `guard('F2'` | [`RAINMAKER-PGR.json#L318`](/utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json#L318) x-unique · [`NotificationTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationTemplate.json) | ✅ |
| **F3** | Resolve by (action,toState,audience,channel,locale) → the live SMS body starts with that template's prefix. | `guard('F3'` | [`TemplateRenderer#L69`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/TemplateRenderer.java#L69) findField · [`NotificationService#L857`](/backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java#L857) processConfigDriven · [`NotificationTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationTemplate.json) | ✅ |
| **F4** | No-template-resolved → skip + honest log (no crash). | `SKIP('F4'` | [`TemplateRenderer#L60`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/TemplateRenderer.java#L60) returns null+logs · [`NotificationService#L946`](/backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java#L946) skip on null | ⏭ needs orphan key (unit: `NotificationResolverEdgeCasesTest`) |
| **F5** | Rendered body carries live token data — complaint id + dd/mm/yyyy date substituted. | `guard('F5'` | [`NotificationService#L1127`](/backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java#L1127) buildPlaceholderValues · [`TemplateRenderer#L85`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/TemplateRenderer.java#L85) · [`DispatchPipelineService#L147`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java#L147) | ✅ |

---

## Related unit/component tests

The SKIP-only behaviors (fault injection, locale/orphan fallback, config mutation) are pinned by these fast tests:

- **pgr-services emitter** — [`service/notification/`](/backend/pgr-services/src/test/java/org/egov/pgr/service/notification): `NotificationRouterTest`, `TemplateRendererTest`, `NotificationResolverEdgeCasesTest`, `NotificationRolePoolResolutionTest`, `NotificationGoldenOutputTest`, `NotificationConfigDrivenEmissionTest`, `SeedFixtureDriftTest`, and [`MDMSUtilsNotificationCacheTest`](/backend/pgr-services/src/test/java/org/egov/pgr/util/MDMSUtilsNotificationCacheTest.java).
- **novu-bridge** — provider endpoints, `ProxyAuthFilter` auth gate, dispatch FAILED-row persistence (`DispatchPipelineFailureRowTest`).
- **default-data-handler** — [`PgrWorkflowConfigSplitterTest`](/utilities/default-data-handler/src/test/java/org/egov/handler/service/PgrWorkflowConfigSplitterTest.java) (BusinessService split + malformed-config skip).
- **Configurator** — `validateNotifications.test.ts` (notification config vs. workflow BusinessService state machine, rules R1–R6).
