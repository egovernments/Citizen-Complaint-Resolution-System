# Notification E2E suite (config-driven PGR notifications)

End-to-end tests for the config-driven PGR notification feature — provider
management, MDMS routing/templates, per-recipient fan-out, consent, and delivery
through Novu. Each case is API/DB-driven against a **live** DIGIT stack and maps
to the production code it exercises (linked below).

- **Harness:** [`notif-harness.js`](./notif-harness.js) — shared primitives (Kong HTTP, `psql`, DIGIT auth, provider API, `nb_dispatch_log`, MDMS search, one shared complaint fixture).
- **Runner:** [`run-notif-suite.js`](./run-notif-suite.js) / [`run-notif-suite.sh`](./run-notif-suite.sh) — runs `cases/area-*.js` and prints a PASS/FAIL/SKIP matrix keyed by case id. Exits non-zero on any **FAIL** (SKIP is not a failure).
- **Cases:** one file per area under [`cases/`](./cases/).

Setting up the feature? See the [notifications setup guide](../../../../docs/2.20/notifications/setup-guide.md).

## Run it

Run **on the DIGIT host** (the harness shells out to `docker exec <pg> psql` and reaches Kong at `localhost:18000`):

```bash
E2E_EMP_USER=<employee> E2E_EMP_PASS=<pass> \
  ./run-notif-suite.sh --target=bomet          # all areas
E2E_EMP_USER=<employee> E2E_EMP_PASS=<pass> \
  ./run-notif-suite.sh --only=A,C              # a subset
```

Env (full list in [`notif-harness.js`](./notif-harness.js)): `BASE`, `DIGIT_TENANT`, `SERVICE_CODE`, `SERVICE_NAME`, `LOCALITY`, `TEST_PHONE` (with `TEST_PHONE_COUNTRY_CODE`, default `91`, or `TEST_PHONE_NATIONAL`: the OTP case sends the number without its country code), `TEST_EMAIL`, `E2E_EMP_USER`, `E2E_EMP_PASS`, `NOVU_API_KEY` (auto-resolved from the `novu-bridge` container if unset), `PG_CONTAINER`.

## Legend

- **Bomet** = result on the pilot (`bometfeedbackhub.digit.org`). ✅ PASS · ⏭ SKIP (not a failure — reason given).
- **Test** links the case file; the anchor (e.g. `guard('A1'`) is the grep target inside it.
- **Exercises** links the production code each case drives (repo-root-relative). Line anchors are approximate.
- Latest full run on the pilot: **40 cases — 27 ✅ / 0 ❌ / 13 ⏭.** The 13 SKIPs fall into three buckets: (1) a deployment gate is off on Bomet (proxy-auth, preference/consent, WhatsApp channel), (2) the case mutates config or injects a fault (needs a throwaway stack), or (3) it's a Configurator UI check (Playwright, out of this API suite's scope). Most are unlockable on a fresh stack; some of the behavior is also covered by the unit tests listed at the bottom.

---

## Area A — Provider management

Novu integrations via the novu-bridge `ProviderController`. **Test file:** [`cases/area-a-providers.js`](./cases/area-a-providers.js) (every integration is dummy-credentialled + named `zz-e2e-*` and deleted in a `finally`).

| Case | What it verifies | Test | Exercises | Bomet |
|---|---|---|---|---|
| **A1** | Add SMS provider → 200 with integration `_id`, `providerId=twilio`, Novu `channel=sms`. | `guard('A1'` | [`ProviderController#L105`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java#L105) createProvider/toNovuChannel · [`NovuClient#L257`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java#L257) createIntegration · [`IntegrationProjection#L25`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/IntegrationProjection.java#L25) | ✅ |
| **A2** | Add Email provider → 200 with `_id`, Novu `channel=email` (nodemailer). | `guard('A2'` | [`ProviderController#L105`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java#L105) EMAIL→email · [`NovuClient#L257`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java#L257) SMTP creds verbatim | ✅ |
| **A3** | Add WhatsApp provider → maps to the Twilio `sms` channel (`whatsapp:` sender, not a separate Novu channel). | `guard('A3'` | [`ProviderController#L421`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java#L421) toNovuChannel WHATSAPP→sms · [`NovuClient#L257`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java#L257) | ✅ |
| **A4** | Creds never echoed — neither the create response nor `/integrations` carries `credentials`/token/SID (allowlist). | `guard('A4'` | [`IntegrationProjection#L17`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/IntegrationProjection.java#L17) ALLOWED_FIELDS · [`IntegrationController#L30`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/IntegrationController.java#L30) · [`NovuClient#L267`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java#L267) logs key names only | ✅ |
| **A5** | Verify → `{ok:true,active:true}` for a live integration; `{ok:false}` "no matching" for a missing id. | `guard('A5'` | [`ProviderController#L304`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java#L304) verify · [`NovuClient#L244`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java#L244) listIntegrations | ✅ |
| **A6** | Test-send SMS → Novu 2xx + exactly one `TEST`-tagged `nb_dispatch_log` row with a **masked** recipient. | `guard('A6'` | [`ProviderController#L351`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java#L351) testSend · [`DispatchLogRepository#L33`](/backend/novu-bridge/src/main/java/org/egov/novubridge/repository/DispatchLogRepository.java#L33) upsert · [`PiiMask`](/backend/novu-bridge/src/main/java/org/egov/novubridge/util/PiiMask.java) mask | ✅ |
| **A7** | Test-send WhatsApp → Novu accepts the trigger with the `whatsapp:+E164` + ContentSid/ordered-vars override. | `guard('A7'` | [`ProviderController#L448`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java#L448) toContentVariables · [`NovuDeliveryProvider#L99`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/delivery/NovuDeliveryProvider.java#L99) whatsappAddress · [`NovuClient#L143`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java#L143) buildProviderTemplateOverrides · [`DispatchLogRepository#L33`](/backend/novu-bridge/src/main/java/org/egov/novubridge/repository/DispatchLogRepository.java#L33) | ✅ |
| **A8** | Pull templates → lists Novu workflows (`complaints-sms`, `complaints-email`), only `workflowId`+`name`. | `guard('A8'` | [`ProviderController#L241`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java#L241) templates/extractWorkflows · [`NovuClient#L301`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java#L301) listWorkflows | ✅ |
| **A9** | Two Twilio SMS integrations (different `from`) coexist. | `guard('A9'` | [`ProviderController#L105`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java#L105) · [`NovuClient#L257`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java#L257) | ✅ |
| **A10** | Auth gate: unauthenticated `/providers/templates` → 401 (when the proxy-auth gate is ON). | `guard('A10'` | [`ProxyAuthFilter#L95`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/filters/ProxyAuthFilter.java#L95) · [`NovuBridgeConfiguration#L132`](/backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java#L132) proxyAuthEnabled | ⏭ gate off on Bomet (`NOVU_BRIDGE_PROXY_AUTH_ENABLED=false`) |
| **A-cleanup** | Every `zz-e2e` integration deleted; all pre-existing real integrations still present. | `FAIL('A-cleanup'` | [`ProviderController#L105`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java#L105) · [`NovuClient#L257`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java#L257) | ✅ |

## Area B — Routing & channels

MDMS `NotificationRouting` + the channel gate. **Test file:** [`cases/area-b-routing.js`](./cases/area-b-routing.js).

| Case | What it verifies | Test | Exercises | Bomet |
|---|---|---|---|---|
| **B1** | City has no routing → falls back to state rows (complaint still dispatches). | `guard('B1'` | [`MdmsNotificationConfigRepository#L310`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/digit/MdmsNotificationConfigRepository.java#L310) stateTenant (masters are read at the state root) · [`MdmsNotificationConfigRepository#L77`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/digit/MdmsNotificationConfigRepository.java#L77) load, legacy rows via [`LegacyMasterAdapter`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/digit/LegacyMasterAdapter.java) · [`NotificationRouting.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationRouting.json) | ✅ |
| **B2** | Disable a channel (routing `active=false`) → no dispatch. | `SKIP('B2'` | [`NotificationResolver#L318`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/NotificationResolver.java#L318) match skips `active=false` · [`LegacyMasterAdapter#L118`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/digit/LegacyMasterAdapter.java#L118) isActive | ⏭ mutates MDMS + needs pgr-services restart (fresh stack) |
| **B3** | Per-audience × channel fan-out — CITIZEN over SMS+EMAIL, GRO over SMS. | `guard('B3'` | [`NotificationResolver#L126`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/NotificationResolver.java#L126) recipients per routing row · [`NotificationResolver#L185`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/NotificationResolver.java#L185) deliver, one message per recipient × channel · [`DispatchLogRepository#L33`](/backend/novu-bridge/src/main/java/org/egov/novubridge/repository/DispatchLogRepository.java#L33) | ✅ |
| **B4** | WhatsApp gated off → WA rows `SKIPPED`/`NB_NO_PROVIDER`, **no SMS fallback**. | `guard('B4'` | [`DispatchPipelineService#L120`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java#L120) channel gate · [`ChannelPolicyClient#L56`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/policy/ChannelPolicyClient.java#L56) isEnabled, falling back to [`NovuBridgeConfiguration#L229`](/backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java#L229) channels.enabled | ✅ |

## Area C — Templates

`NotificationTemplate` + `NotificationProviderTemplate`. **Test file:** [`cases/area-c-templates.js`](./cases/area-c-templates.js).

| Case | What it verifies | Test | Exercises | Bomet |
|---|---|---|---|---|
| **C1** | City has no template → state fallback (bodies still render). | `guard('C1'` | [`MdmsNotificationConfigRepository#L310`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/digit/MdmsNotificationConfigRepository.java#L310) stateTenant · [`TemplateRenderer#L43`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/TemplateRenderer.java#L43) render · [`NotificationTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationTemplate.json) | ✅ |
| **C2** | Per-tenant (city) template override. | `SKIP('C2'` | [`MdmsNotificationConfigRepository#L310`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/digit/MdmsNotificationConfigRepository.java#L310) stateTenant · [`TemplateRenderer#L60`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/TemplateRenderer.java#L60) | ⏭ no city-level template authored on Bomet |
| **C3** | Per-locale templates (en_IN/hi_IN) both present for locale selection. | `guard('C3'` | [`TemplateRenderer#L60`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/TemplateRenderer.java#L60) locale dim · [`NotificationTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationTemplate.json) · [`NovuBridgeConfiguration#L40`](/backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java#L40) default.locale | ⏭ only en_IN seeded on Bomet |
| **C4** | Missing-locale template → default-locale fallback. | `SKIP('C4'` | [`TemplateRenderer#L60`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/TemplateRenderer.java#L60) default-locale retry · [`NovuBridgeConfiguration#L40`](/backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java#L40) | ⏭ needs controlled missing-locale seed |
| **C5** | Positional variables substituted in the template's declared order (complaint_type → id → date). | `guard('C5'` | [`TemplateRenderer#L92`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/TemplateRenderer.java#L92) substitute · [`ThinEventBuilder#L176`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/ThinEventBuilder.java#L176) data · [`PlaceholderResolver#L26`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/PlaceholderResolver.java#L26) resolve · [`NotificationTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationTemplate.json) | ✅ |
| **C6** | `complaint_type` renders the localized **name** (not the code); status localized too. | `guard('C6'` | [`ThinEventBuilder#L210`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/ThinEventBuilder.java#L210) localized codes · [`PlaceholderResolver#L26`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/PlaceholderResolver.java#L26) localize category + status · [`TemplateRenderer#L92`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/TemplateRenderer.java#L92) | ✅ |
| **C7** | APPLY/WHATSAPP `NotificationProviderTemplate` resolves a valid Twilio ContentSid (`HX…`). | `guard('C7'` | [`NotificationProviderTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationProviderTemplate.json) · [`RAINMAKER-PGR.json#L427`](/utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json#L427) schema · [`NotificationResolver#L423`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/NotificationResolver.java#L423) providerTemplate · [`NovuClient#L143`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java#L143) buildProviderTemplateOverrides | ✅ |
| **C8** | Param removed from declared order → placeholder handling. | `SKIP('C8'` | [`NotificationProviderTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationProviderTemplate.json) `variables` · [`ProviderController#L448`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java#L448) toContentVariables | ⏭ needs controlled ProviderTemplate edit (unit-covered) |
| **C9** | Delivery workflows (`complaints-sms`/`complaints-email`) are valid Novu workflows; fixture produced SENT rows. | `guard('C9'` | [`ProviderController#L241`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java#L241) · [`NovuClient#L301`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java#L301) · [`NovuBridgeConfiguration#L235`](/backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java#L235) workflow-id map | ✅ |

## Area D — Preferences & consent

`digit-user-preferences-service` via the novu-bridge proxy + consent gate. **Test file:** [`cases/area-d-preferences.js`](./cases/area-d-preferences.js).

| Case | What it verifies | Test | Exercises | Bomet |
|---|---|---|---|---|
| **D1** | Per-channel consent gate (deliver only GRANTED channels). | `SKIP('D1'` | [`PreferenceServiceClient#L31`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/PreferenceServiceClient.java#L31) isChannelAllowed · [`NovuBridgeConfiguration#L43`](/backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java#L43) preferenceEnabled | ⏭ preference gate off on Bomet |
| **D2** | Tenant-specific consent scope. | `SKIP('D2'` | [`PreferenceServiceClient#L89`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/PreferenceServiceClient.java#L89) scope/scopeTenant · [`NovuBridgeConfiguration#L43`](/backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java#L43) | ⏭ preference gate off on Bomet |
| **D3** | Default = revoked, no fallback (absent preference → not delivered). | `SKIP('D3'` | [`PreferenceServiceClient#L67`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/PreferenceServiceClient.java#L67) default-deny · [`NovuBridgeConfiguration#L43`](/backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java#L43) | ⏭ preference gate off on Bomet |
| **D4** | `GET /preferences` → 200; a stored preference carries a non-empty `preferredLanguage`. | `guard('D4'` | [`PreferenceController#L35`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/PreferenceController.java#L35) · [`PreferenceServiceClient#L113`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/PreferenceServiceClient.java#L113) listPreferences · [`ProxyAuthFilter#L79`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/filters/ProxyAuthFilter.java#L79) | ✅ |
| **D5** | Preference read is stable across re-fetch (same userId+lang+consent set). | `guard('D5'` | [`PreferenceController#L35`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/PreferenceController.java#L35) · [`PreferenceServiceClient#L113`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/PreferenceServiceClient.java#L113) | ✅ |
| **D6** | Consent surfaced read-only in the Configurator screen. | `SKIP('D6'` | [`PreferenceController#L35`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/PreferenceController.java#L35) (endpoint the UI consumes) | ⏭ Configurator UI (Playwright, out of API-suite scope) |

## Area E — Delivery + resilience

Novu → provider, plus regression guards. **Test file:** [`cases/area-e-delivery.js`](./cases/area-e-delivery.js).

| Case | What it verifies | Test | Exercises | Bomet |
|---|---|---|---|---|
| **E1** | SMS delivers — ≥1 `nb_dispatch_log` SMS row `SENT` (Novu accepted). | `guard('E1'` | [`NotificationService#L141`](/backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java#L141) publishes the thin event · [`DispatchPipelineService#L192`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java#L192) SENT row · [`NovuClient#L51`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java#L51) identifyThenTrigger | ✅ |
| **E2** | Email delivers + **non-empty subject** (empty-subject regression guard). | `guard('E2'` | [`TemplateRenderer#L43`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/TemplateRenderer.java#L43) EMAIL subject · [`NotificationResolver#L408`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/NotificationResolver.java#L408) blank-subject fallback · [`NovuClient#L69`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java#L69) payload.subject · [`DispatchPipelineService#L192`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java#L192) | ✅ |
| **E3** | WhatsApp via Novu ContentSid override delivery. | `SKIP('E3'` | [`NovuBridgeConfiguration#L229`](/backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java#L229) isChannelEnabled · [`DispatchPipelineService#L120`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java#L120) | ⏭ WhatsApp gated off on Bomet |
| **E4** | Expired Twilio auth → delivery `FAILED`, pipeline doesn't crash. | `SKIP('E4'` | [`DispatchPipelineService#L171`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java#L171) catch→FAILED · [`NovuClient#L308`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java#L308) | ⏭ fault injection unsafe on live Bomet (unit: `DispatchPipelineFailureRowTest`) |
| **E5** | url-shortener outage doesn't leave literal `{placeholder}` braces. | `guard('E5'` | [`NotificationService#L200`](/backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java#L200) isolated shortener try · [`ThinEventBuilder#L196`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/ThinEventBuilder.java#L196) `download_link` blanked, not omitted · [`NotificationUtil#L37`](/backend/pgr-services/src/main/java/org/egov/pgr/util/NotificationUtil.java#L37) getShortnerURL | ✅ |

## Area F — MDMS master lifecycle & resolution

The 3 masters via mdms-v2 + novu-bridge's resolver. **Test file:** [`cases/area-f-mdms.js`](./cases/area-f-mdms.js).

| Case | What it verifies | Test | Exercises | Bomet |
|---|---|---|---|---|
| **F1** | mdms-v2 `_search` returns non-empty rows for all three masters at the state tenant. | `guard('F1'` | [`RAINMAKER-PGR.json`](/utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json) schemas · [`NotificationTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationTemplate.json) · [`NotificationRouting.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationRouting.json) | ✅ |
| **F2** | Uniqueness — no duplicate `(audience,action,toState,channel,locale)` template rows. | `guard('F2'` | [`RAINMAKER-PGR.json#L369`](/utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json#L369) x-unique · [`NotificationTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationTemplate.json) | ✅ |
| **F3** | Resolve by (action,toState,audience,channel,locale) → the live SMS body starts with that template's prefix. | `guard('F3'` | [`TemplateRenderer#L60`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/TemplateRenderer.java#L60) find · [`NotificationResolver#L408`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/NotificationResolver.java#L408) render · [`NotificationTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationTemplate.json) | ✅ |
| **F4** | No-template-resolved → skip + honest log (no crash). | `SKIP('F4'` | [`TemplateRenderer#L43`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/TemplateRenderer.java#L43) returns null · [`NotificationResolver#L235`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/NotificationResolver.java#L235) NO_TEMPLATE skip row | ⏭ needs orphan key |
| **F5** | Rendered body carries live token data — complaint id + dd/mm/yyyy date substituted. | `guard('F5'` | [`ThinEventBuilder#L176`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/ThinEventBuilder.java#L176) data (id, date) · [`TemplateRenderer#L92`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/TemplateRenderer.java#L92) · [`DispatchPipelineService#L156`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java#L156) | ✅ |

---

## Area G — Login OTP through the bridge

Login OTPs are DIGIT-core `SMSRequest`s on `egov.core.notification.sms`; novu-bridge translates them into the envelope and delivers them like any other SMS. **Test file:** [`cases/area-g-otp.js`](./cases/area-g-otp.js). Needs the `otp` profile (`enable_otp_services: true`, Kong mocks stripped); the cases SKIP when `/user-otp` is still the mock.

| Case | What it verifies | Test | Exercises | Bomet |
|---|---|---|---|---|
| **G1** | `POST /user-otp/v1/_send` for a test number leaves a `CORE.SMS.OTP` dispatch-log row at the tenant — `SENT`, or `SKIPPED/NB_NO_PROVIDER` when SMS is off. Never no row. | `guard('G1'` | [`CoreSmsTranslator`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/core/CoreSmsTranslator.java) · [`CoreSmsConsumer`](/backend/novu-bridge/src/main/java/org/egov/novubridge/consumer/CoreSmsConsumer.java) | ⏭ otp profile off |
| **G2** | The OTP row never stores the code: neither `provider_response_jsonb` nor `last_error_message` contains the 6-digit OTP. | `guard('G2'` | [`DispatchPipelineService`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java) persist path | ⏭ otp profile off |

---

## Related unit/component tests

Some of the SKIP-only behaviors (e.g. fault injection) are pinned by these fast tests:

- **novu-bridge** — provider endpoints, `ProxyAuthFilter` auth gate, dispatch FAILED-row persistence (`DispatchPipelineFailureRowTest`).
- **default-data-handler** — [`PgrWorkflowConfigSplitterTest`](/utilities/default-data-handler/src/test/java/org/egov/handler/service/PgrWorkflowConfigSplitterTest.java) (BusinessService split + malformed-config skip).
- **Configurator** — `validateNotifications.test.ts` (notification config vs. workflow BusinessService state machine, rules R1–R6).
