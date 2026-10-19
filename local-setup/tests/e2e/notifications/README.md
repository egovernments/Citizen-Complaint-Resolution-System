# Notification E2E suite (config-driven PGR notifications)

End-to-end tests for the config-driven PGR notification feature — provider
management, MDMS routing/templates, per-recipient fan-out, consent, and delivery
through Novu. Each case is API/DB-driven against a **live** DIGIT stack and maps
to the production code it exercises (linked below).

- **Harness:** [`notif-harness.js`](./notif-harness.js) — shared primitives (Kong HTTP, `psql`, DIGIT auth, provider API, `nb_dispatch_log`, MDMS search, one shared complaint fixture).
- **Runner:** [`run-notif-suite.js`](./run-notif-suite.js) / [`run-notif-suite.sh`](./run-notif-suite.sh) — runs `cases/area-*.js` and prints a PASS/FAIL/SKIP matrix keyed by case id. Exits non-zero on any **FAIL** (SKIP is not a failure).
- **Cases:** one file per area under [`cases/`](./cases/).

Setting up the feature? See the [notifications setup guide](../../../../docs/releases/2.20/notifications/setup-guide.md).

## Run it

Run **on the DIGIT host** (the harness shells out to `docker exec <pg> psql` and reaches Kong at `localhost:18000`):

```bash
E2E_EMP_USER=<employee> E2E_EMP_PASS=<pass> \
  ./run-notif-suite.sh --target=bomet          # all areas
E2E_EMP_USER=<employee> E2E_EMP_PASS=<pass> \
  ./run-notif-suite.sh --only=A,C              # a subset
```

Env (full list in [`notif-harness.js`](./notif-harness.js)): `BASE`, `DIGIT_TENANT`, `E2E_TENANT_SLUG` (required: the shared complaint's citizen signs in through the Identity BFF's phone OTP, which needs the box's fixed dev OTP, `identity_dev_fixed_otp: true`, or `E2E_OTP`), `E2E_PUBLIC_ORIGIN` (when `BASE` is not the origin the BFF trusts), `SERVICE_CODE`, `SERVICE_NAME`, `LOCALITY`, `TEST_PHONE` (with `TEST_PHONE_COUNTRY_CODE`, default `91`, or `TEST_PHONE_NATIONAL`: the OTP case sends the number without its country code), `TEST_EMAIL`, `E2E_EMP_USER`, `E2E_EMP_PASS`, `NOVU_API_KEY` (auto-resolved from the `novu-bridge` container if unset), `PG_CONTAINER`.

## Legend

- **Bomet** = result on the pilot (`bometfeedbackhub.digit.org`). ✅ PASS · ⏭ SKIP (not a failure — reason given).
- **Test** links the case file; the anchor (e.g. `guard('A1'`) is the grep target inside it.
- **Exercises** links the production code each case drives (repo-root-relative), named `Class.member` —
  the method, field or schema code to look at. No line anchors: they went stale every time the code moved.
  `local-setup/tests/static/deployment-contracts.test.ts` fails if a named member no longer exists in its file.
- Latest full run on the pilot: **40 cases — 27 ✅ / 0 ❌ / 13 ⏭.** The 13 SKIPs fall into three buckets: (1) a deployment gate is off on Bomet (proxy-auth, preference/consent, WhatsApp channel), (2) the case mutates config or injects a fault (needs a throwaway stack), or (3) it's a Configurator UI check (Playwright, out of this API suite's scope). Most are unlockable on a fresh stack; some of the behavior is also covered by the unit tests listed at the bottom.

---

## Area A — Provider management

Novu integrations via the novu-bridge `ProviderController`. **Test file:** [`cases/area-a-providers.js`](./cases/area-a-providers.js) (every integration is dummy-credentialled + named `zz-e2e-*` and deleted in a `finally`).

| Case | What it verifies | Test | Exercises | Bomet |
|---|---|---|---|---|
| **A1** | Add SMS provider → 200 with integration `_id`, `providerId=twilio`, Novu `channel=sms`. | `guard('A1'` | [`ProviderController.createProvider`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java) createProvider/toNovuChannel · [`NovuClient.createIntegration`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java) createIntegration · [`IntegrationProjection.project`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/IntegrationProjection.java) | ✅ |
| **A2** | Add Email provider → 200 with `_id`, Novu `channel=email` (nodemailer). | `guard('A2'` | [`ProviderController.toNovuChannel`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java) EMAIL→email · [`NovuClient.createIntegration`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java) SMTP creds verbatim | ✅ |
| **A3** | Add WhatsApp provider → maps to the Twilio `sms` channel (`whatsapp:` sender, not a separate Novu channel). | `guard('A3'` | [`ProviderController.toNovuChannel`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java) toNovuChannel WHATSAPP→sms · [`NovuClient.createIntegration`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java) | ✅ |
| **A4** | Creds never echoed — neither the create response nor `/integrations` carries `credentials`/token/SID (allowlist). | `guard('A4'` | [`IntegrationProjection.ALLOWED_FIELDS`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/IntegrationProjection.java) ALLOWED_FIELDS · [`IntegrationController.integrations`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/IntegrationController.java) · [`NovuClient.createIntegration`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java) logs key names only | ✅ |
| **A5** | Verify → `{ok:true,active:true}` for a live integration; `{ok:false}` "no matching" for a missing id. | `guard('A5'` | [`ProviderController.verify`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java) verify · [`NovuClient.listIntegrations`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java) listIntegrations | ✅ |
| **A6** | Test-send SMS → Novu 2xx + exactly one `TEST`-tagged `nb_dispatch_log` row with a **masked** recipient. | `guard('A6'` | [`ProviderController.testSend`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java) testSend · [`DispatchLogRepository.upsert`](/backend/novu-bridge/src/main/java/org/egov/novubridge/repository/DispatchLogRepository.java) upsert · [`PiiMask`](/backend/novu-bridge/src/main/java/org/egov/novubridge/util/PiiMask.java) mask | ✅ |
| **A7** | Test-send WhatsApp → Novu accepts the trigger with the `whatsapp:+E164` + ContentSid/ordered-vars override. | `guard('A7'` | [`ProviderController.toContentVariables`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java) toContentVariables · [`NovuDeliveryProvider.whatsappAddress`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/delivery/NovuDeliveryProvider.java) whatsappAddress · [`NovuClient.buildProviderTemplateOverrides`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java) buildProviderTemplateOverrides · [`DispatchLogRepository.upsert`](/backend/novu-bridge/src/main/java/org/egov/novubridge/repository/DispatchLogRepository.java) | ✅ |
| **A8** | Pull templates → lists Novu workflows (`complaints-sms`, `complaints-email`), only `workflowId`+`name`. | `guard('A8'` | [`ProviderController.templates`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java) templates/extractWorkflows · [`NovuClient.listWorkflows`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java) listWorkflows | ✅ |
| **A9** | Two Twilio SMS integrations (different `from`) coexist. | `guard('A9'` | [`ProviderController.createProvider`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java) · [`NovuClient.createIntegration`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java) | ✅ |
| **A10** | Auth gate: unauthenticated `/providers/templates` → 401 (when the proxy-auth gate is ON). | `guard('A10'` | [`ProxyAuthFilter.doFilterInternal`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/filters/ProxyAuthFilter.java) · [`NovuBridgeConfiguration.proxyAuthEnabled`](/backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java) proxyAuthEnabled | ⏭ gate off on Bomet (`NOVU_BRIDGE_PROXY_AUTH_ENABLED=false`) |
| **A-cleanup** | Every `zz-e2e` integration deleted; all pre-existing real integrations still present. | `FAIL('A-cleanup'` | [`ProviderController.deleteProvider`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java) · [`NovuClient.deleteIntegration`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java) | ✅ |

## Area B — Routing & channels

MDMS `NotificationRouting` + the channel gate. **Test file:** [`cases/area-b-routing.js`](./cases/area-b-routing.js).

| Case | What it verifies | Test | Exercises | Bomet |
|---|---|---|---|---|
| **B1** | City has no routing → falls back to state rows (complaint still dispatches). | `guard('B1'` | [`MdmsNotificationConfigRepository.stateTenant`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/digit/MdmsNotificationConfigRepository.java) stateTenant (masters are read at the state root) · [`MdmsNotificationConfigRepository.load`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/digit/MdmsNotificationConfigRepository.java) load, legacy rows via [`LegacyMasterAdapter`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/digit/LegacyMasterAdapter.java) · [`NotificationRouting.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationRouting.json) | ✅ |
| **B2** | Disable a channel (routing `active=false`) → no dispatch. | `SKIP('B2'` | [`NotificationResolver.match`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/NotificationResolver.java) match skips `active=false` · [`LegacyMasterAdapter.isActive`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/digit/LegacyMasterAdapter.java) isActive | ⏭ mutates MDMS + needs pgr-services restart (fresh stack) |
| **B3** | Per-audience × channel fan-out — CITIZEN over SMS+EMAIL, GRO over SMS. | `guard('B3'` | [`NotificationResolver.resolve`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/NotificationResolver.java) recipients per routing row · [`NotificationResolver.deliver`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/NotificationResolver.java) deliver, one message per recipient × channel · [`DispatchLogRepository.upsert`](/backend/novu-bridge/src/main/java/org/egov/novubridge/repository/DispatchLogRepository.java) | ✅ |
| **B4** | WhatsApp gated off → WA rows `SKIPPED`/`NB_NO_PROVIDER`, **no SMS fallback**. | `guard('B4'` | [`DispatchPipelineService.process`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java) channel gate · [`ChannelPolicyClient.isEnabled`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/policy/ChannelPolicyClient.java) isEnabled, falling back to [`NovuBridgeConfiguration.isChannelEnabled`](/backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java) channels.enabled | ✅ |

## Area C — Templates

`NotificationTemplate` + `NotificationProviderTemplate`. **Test file:** [`cases/area-c-templates.js`](./cases/area-c-templates.js).

| Case | What it verifies | Test | Exercises | Bomet |
|---|---|---|---|---|
| **C1** | City has no template → state fallback (bodies still render). | `guard('C1'` | [`MdmsNotificationConfigRepository.stateTenant`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/digit/MdmsNotificationConfigRepository.java) stateTenant · [`TemplateRenderer.render`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/TemplateRenderer.java) render · [`NotificationTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationTemplate.json) | ✅ |
| **C2** | Per-tenant (city) template override. | `SKIP('C2'` | [`MdmsNotificationConfigRepository.stateTenant`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/digit/MdmsNotificationConfigRepository.java) stateTenant · [`TemplateRenderer.find`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/TemplateRenderer.java) | ⏭ no city-level template authored on Bomet |
| **C3** | Per-locale templates (en_IN/hi_IN) both present for locale selection. | `guard('C3'` | [`TemplateRenderer.find`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/TemplateRenderer.java) locale dim · [`NotificationTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationTemplate.json) · [`NovuBridgeConfiguration.defaultLocale`](/backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java) default.locale | ⏭ only en_IN seeded on Bomet |
| **C4** | Missing-locale template → default-locale fallback. | `SKIP('C4'` | [`TemplateRenderer.find`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/TemplateRenderer.java) default-locale retry · [`NovuBridgeConfiguration.defaultLocale`](/backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java) | ⏭ needs controlled missing-locale seed |
| **C5** | Positional variables substituted in the template's declared order (complaint_type → id → date). | `guard('C5'` | [`TemplateRenderer.substitute`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/TemplateRenderer.java) substitute · [`ThinEventBuilder.data`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/ThinEventBuilder.java) data · [`PlaceholderResolver.resolve`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/PlaceholderResolver.java) resolve · [`NotificationTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationTemplate.json) | ✅ |
| **C6** | `complaint_type` renders the localized **name** (not the code); status localized too. | `guard('C6'` | [`ThinEventBuilder.localized`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/ThinEventBuilder.java) localized codes · [`PlaceholderResolver.resolve`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/PlaceholderResolver.java) localize category + status · [`TemplateRenderer.substitute`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/TemplateRenderer.java) | ✅ |
| **C7** | APPLY/WHATSAPP `NotificationProviderTemplate` resolves a valid Twilio ContentSid (`HX…`). | `guard('C7'` | [`NotificationProviderTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationProviderTemplate.json) · [`RAINMAKER-PGR.NotificationProviderTemplate`](/utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json) schema · [`NotificationResolver.providerTemplate`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/NotificationResolver.java) providerTemplate · [`NovuClient.buildProviderTemplateOverrides`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java) buildProviderTemplateOverrides | ✅ |
| **C8** | Param removed from declared order → placeholder handling. | `SKIP('C8'` | [`NotificationProviderTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationProviderTemplate.json) `variables` · [`ProviderController.toContentVariables`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java) toContentVariables | ⏭ needs controlled ProviderTemplate edit (unit-covered) |
| **C9** | Delivery workflows (`complaints-sms`/`complaints-email`) are valid Novu workflows; fixture produced SENT rows. | `guard('C9'` | [`ProviderController.templates`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java) · [`NovuClient.listWorkflows`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java) · [`NovuBridgeConfiguration.getNovuWorkflowId`](/backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java) workflow-id map | ✅ |

## Area D — Preferences & consent

`digit-user-preferences-service` via the novu-bridge proxy + consent gate. **Test file:** [`cases/area-d-preferences.js`](./cases/area-d-preferences.js).

| Case | What it verifies | Test | Exercises | Bomet |
|---|---|---|---|---|
| **D1** | Per-channel consent gate (deliver only GRANTED channels). | `SKIP('D1'` | [`PreferenceServiceClient.isChannelAllowed`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/PreferenceServiceClient.java) isChannelAllowed · [`NovuBridgeConfiguration.preferenceEnabled`](/backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java) preferenceEnabled | ⏭ preference gate off on Bomet |
| **D2** | Tenant-specific consent scope. | `SKIP('D2'` | [`PreferenceServiceClient.isChannelAllowed`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/PreferenceServiceClient.java) scope/scopeTenant · [`NovuBridgeConfiguration.preferenceEnabled`](/backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java) | ⏭ preference gate off on Bomet |
| **D3** | Default = revoked, no fallback (absent preference → not delivered). | `SKIP('D3'` | [`PreferenceServiceClient.isChannelAllowed`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/PreferenceServiceClient.java) default-deny · [`NovuBridgeConfiguration.preferenceEnabled`](/backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java) | ⏭ preference gate off on Bomet |
| **D4** | `GET /preferences` → 200; a stored preference carries a non-empty `preferredLanguage`. | `guard('D4'` | [`PreferenceController.preferences`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/PreferenceController.java) · [`PreferenceServiceClient.listPreferences`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/PreferenceServiceClient.java) listPreferences · [`ProxyAuthFilter.Caller.mayRead`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/filters/ProxyAuthFilter.java) | ✅ |
| **D5** | Preference read is stable across re-fetch (same userId+lang+consent set). | `guard('D5'` | [`PreferenceController.preferences`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/PreferenceController.java) · [`PreferenceServiceClient.listPreferences`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/PreferenceServiceClient.java) | ✅ |
| **D6** | Consent surfaced read-only in the Configurator screen. | `SKIP('D6'` | [`PreferenceController.preferences`](/backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/PreferenceController.java) (endpoint the UI consumes) | ⏭ Configurator UI (Playwright, out of API-suite scope) |

## Area E — Delivery + resilience

Novu → provider, plus regression guards. **Test file:** [`cases/area-e-delivery.js`](./cases/area-e-delivery.js).

| Case | What it verifies | Test | Exercises | Bomet |
|---|---|---|---|---|
| **E1** | SMS delivers — ≥1 `nb_dispatch_log` SMS row `SENT` (Novu accepted). | `guard('E1'` | [`NotificationService.process`](/backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java) publishes the thin event · [`DispatchPipelineService.persist`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java) SENT row · [`NovuClient.identifyThenTrigger`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java) identifyThenTrigger | ✅ |
| **E2** | Email delivers + **non-empty subject** (empty-subject regression guard). | `guard('E2'` | [`TemplateRenderer.render`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/TemplateRenderer.java) EMAIL subject · [`NotificationResolver.render`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/NotificationResolver.java) blank-subject fallback · [`NovuClient.identifyThenTrigger`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java) payload.subject · [`DispatchPipelineService.persist`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java) | ✅ |
| **E3** | WhatsApp via Novu ContentSid override delivery. | `SKIP('E3'` | [`NovuBridgeConfiguration.isChannelEnabled`](/backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java) isChannelEnabled · [`DispatchPipelineService.process`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java) | ⏭ WhatsApp gated off on Bomet |
| **E4** | Expired Twilio auth → delivery `FAILED`, pipeline doesn't crash. | `SKIP('E4'` | [`DispatchPipelineService.process`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java) catch→FAILED · [`NovuClient.exchange`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/NovuClient.java) | ⏭ fault injection unsafe on live Bomet (unit: `DispatchPipelineFailureRowTest`) |
| **E5** | url-shortener outage doesn't leave literal `{placeholder}` braces. | `guard('E5'` | [`NotificationService.shortenedDownloadLink`](/backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java) isolated shortener try · [`ThinEventBuilder.data`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/ThinEventBuilder.java) `download_link` blanked, not omitted · [`NotificationUtil.getShortnerURL`](/backend/pgr-services/src/main/java/org/egov/pgr/util/NotificationUtil.java) getShortnerURL | ✅ |

## Area F — MDMS master lifecycle & resolution

The 3 masters via mdms-v2 + novu-bridge's resolver. **Test file:** [`cases/area-f-mdms.js`](./cases/area-f-mdms.js).

| Case | What it verifies | Test | Exercises | Bomet |
|---|---|---|---|---|
| **F1** | mdms-v2 `_search` returns non-empty rows for all three masters at the state tenant. | `guard('F1'` | [`RAINMAKER-PGR.json`](/utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json) schemas · [`NotificationTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationTemplate.json) · [`NotificationRouting.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationRouting.json) | ✅ |
| **F2** | Uniqueness — no duplicate `(audience,action,toState,channel,locale)` template rows. | `guard('F2'` | [`RAINMAKER-PGR.NotificationTemplate`](/utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json) x-unique · [`NotificationTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationTemplate.json) | ✅ |
| **F3** | Resolve by (action,toState,audience,channel,locale) → the live SMS body starts with that template's prefix. | `guard('F3'` | [`TemplateRenderer.find`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/TemplateRenderer.java) find · [`NotificationResolver.render`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/NotificationResolver.java) render · [`NotificationTemplate.json`](/utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationTemplate.json) | ✅ |
| **F4** | No-template-resolved → skip + honest log (no crash). | `SKIP('F4'` | [`TemplateRenderer.render`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/TemplateRenderer.java) returns null · [`NotificationResolver.deliver`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/NotificationResolver.java) NO_TEMPLATE skip row | ⏭ needs orphan key |
| **F5** | Rendered body carries live token data — complaint id + dd/mm/yyyy date substituted. | `guard('F5'` | [`ThinEventBuilder.data`](/backend/pgr-services/src/main/java/org/egov/pgr/service/notification/ThinEventBuilder.java) data (id, date) · [`TemplateRenderer.substitute`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/TemplateRenderer.java) · [`DispatchPipelineService.process`](/backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java) | ✅ |

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
