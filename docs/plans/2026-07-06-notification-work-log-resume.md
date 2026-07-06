# Notification Consolidation — Work Log & Resume Point

**Date:** 2026-07-06 · **Branch:** `feat/pgr-notifications-configure` (fork
`ChakshuGautam/Citizen-Complaint-Resolution-System`) → **PR #58** (base `develop`).
**NEVER push to `egovernments/CCRS`.** All work is fork-only.

This is the single-file consolidation to resume from. It covers the config-driven PGR
notification consolidation (SMS + WhatsApp + Email), everything deployed/tested on the **Bomet**
pilot, and what's left.

---

## 1. TL;DR status

- **Config-driven notifications** (MDMS-routed, per-recipient, role-audience) are **live on Bomet**
  and proven end-to-end: full complaint lifecycle × EN + HI × {SMS, WhatsApp, Email} delivered to
  real recipients (Citizen + GRO + LME).
- **PR #58** holds it all: findings W1–W5, tests, placeholder/subject fixes, provider→template
  mapping (Twilio WhatsApp ContentSids), configurator "Provider Templates" screen, hi_IN seed,
  schema, design docs, **user-preference seeder + configurator "User Preferences" screen**.
- **User preferences DONE + live on Bomet:** the 3 test accounts seeded in
  `digit-user-preferences-service` (Kanav hi_IN/all-granted, Shambhavi en_IN/WhatsApp-revoked,
  Chakshu hi_IN/all-granted) and surfaced read-only in the configurator (novu-bridge
  `/novu-adapter/v1/preferences` proxy → Kong route → "User Preferences" list screen).
  Verified in-browser (nav + consent chips + preferredLanguage render).
- **Remaining:** fresh-box Ansible test (`mh-iterations`); per-recipient locale impl; WhatsApp
  emitter wiring (novu-bridge→Twilio ContentSid); officer WhatsApp templates (Twilio approval).

## 2. Commits on PR #58 (in order)

| Commit | What |
|---|---|
| `a819c12a7` | Findings W1–W5 (Baileys removed + channel gate; FAILED-row persist; per-channel contact gate; role-pool pagination; MDMS cache TTL; configurator write-path) |
| `e9ffbbb14` | Test plan Phase 1+2 (pgr 67, novu-bridge 70, ddh 7, configurator) |
| `6ec9fcffe` | Plans stamped EXECUTED |
| `15f1b743f` | pgr placeholder resilience (isolate `{download_link}`, fallbacks) |
| `3643c3945` | pgr renders + sends **EMAIL subject** (config-driven emails were all dropped by Novu) |
| `ffcf20dba` | E2E-2 pool assertion tolerant of assignee/pool overlap |
| provider design/seed commits | `NotificationProviderTemplate` mapping + design doc + configurator Provider Templates screen |
| `57358096c` | Seed gaps: hi_IN CITIZEN templates + ProviderTemplate schema + trim EMPLOYEE-on-no-assignee + constant email subjects |
| `e8941faca` | Docs: consent-service `preferredLanguage` reuse + notification timeline flowchart |

## 3. What's LIVE on Bomet (`ssh egov-bomet`, tenant `ke.bomet`, root `ke`)

- **Images** (built amd64 on the DEV BOX — egov-ci is ARM; pushed to VPC registry `10.0.0.4:5000`):
  `pgr-services-dev:notif-3643c3945`, `default-data-handler:splitter-6ec9fcf`,
  `novu-bridge:passthrough-6ec9fcf`. Surgical recreate via
  `/opt/digit/docker-compose.notif-deploy.yml` overlay + `--no-deps --force-recreate` (other ~32
  containers untouched). Durability pinned in `local-setup/ansible/inventory/host_vars/bomet.yml`.
- **Config:** `PGR_NOTIFICATION_CONFIG_DRIVEN=true`, `NOVU_BRIDGE_CHANNELS_ENABLED=SMS,EMAIL`
  (WHATSAPP not yet enabled through the emitter). Novu API key fixed in `/opt/digit/.env`
  (`NOVU_API_KEY` was `changeme` → the real key → 401s gone).
- **MDMS masters** (tenant `ke`, DB `docker-postgres` / `egov`/`egov`):
  `RAINMAKER-PGR.NotificationRouting` 28 active, `NotificationTemplate` 28 active + hi_IN,
  `NotificationProviderTemplate` 14 (CITIZEN WhatsApp ContentSids EN+HI). EMPLOYEE-on-no-assignee
  rows deactivated; email subjects constant (`DIGIT: Complaint {id} ({complaint_type})`).
- **url-shortening fixed:** was 400ing (OTEL `OpenTelemetryDriver` rejects `jdbc:postgresql://`);
  overlay sets `SPRING_DATASOURCE_DRIVER_CLASS_NAME=org.postgresql.Driver`.
- **Configurator** deployed to `/var/www/configurator/` (served `/configurator/`) with the
  **Provider Templates** screen (Notifications nav).

## 4. Delivery channels — proven state

- **SMS**: Novu → **Twilio** (`AC2ef0de…`, sender `+14197076534`). Verified `delivered` to +91.
- **Email**: Novu → **nodemailer** (Gmail SMTP `contact@theflywheel.in`). Verified `sent`.
- **WhatsApp**: **Twilio WABA sender `whatsapp:+917676472431` (ONLINE)** — approved ContentSid +
  positional ContentVariables → `delivered`/`read`. Sandbox `+14155238886` is OFFLINE (error
  `63015` = recipient must join) — **do not use**. Novu has **no** WhatsApp integration; the design
  routes WhatsApp via **novu-bridge → Twilio ContentSid directly** (not through Novu). Sender tier =
  250 recipients/24h (unverified). WABA sends to any country (pricing per recipient country).
- **Twilio templates**: 26 approved complaint templates, **all CITIZEN-audience**, EN + HI
  (apply/assign/resolve/reject/reopen/reassign/rate). **No officer (GRO/LME/EMPLOYEE) templates.**
  OTP templates rejected → OTP moves to **SMSCountry** (admin-side, separate path).

## 5. Test recipients (owner-authorized)

| Who | Phone | Email | Role |
|---|---|---|---|
| **Chakshu** (owner) | `+919415787824` | `contact@theflywheel.in` | CITIZEN |
| **Kanav** | `+917011854675` | `kanav11dwevedi@gmail.com` | PGR_LME (`E2E_LME_TESTER`, uuid c8375b76) |
| **Shambhavi** | `+919673409136` | `shambhavi.naik@gmail.com` | GRO (`E2E_GRO_TESTER`, uuid 6bc7fd15) |

Full lifecycle E2E (both languages) delivered: Citizen WA(read)+SMS(delivered)+Email(sent) for all
7 actions; GRO email on APPLY; LME email on ASSIGN/REASSIGN. Test scripts: `/tmp/lifecycle-e2e.py`,
`/tmp/e2e-multilang.py` (on the dev box; run ON Bomet with TW_SID/TW_TOK/NOVU_KEY env).

## 6. Locale / preferences (design)

- **One language per recipient.** Resolution: `digit-user-preferences-service.preferredLanguage`
  (same `USER_NOTIFICATION_PREFERENCES` record novu-bridge queries for consent; validated
  `{en_IN,hi_IN,fr_IN,pt_IN}`) → deployment default (`config.notification.default.locale`) → `en`.
- **Interim:** emitter renders once in deployment default; **email = en for now**. Per-recipient
  resolution not yet coded (W2.9 single-locale limitation).
- Design + timeline flowchart: `docs/plans/2026-07-06-provider-template-mapping-design.md` (§7 locale,
  §8 timeline: who-gets-what-when matrix).

## 7. Key gotchas (don't re-learn these)

- Build images **amd64 on the dev box** (egov-ci is aarch64 → `no matching manifest for linux/amd64`
  on Bomet). Recipe: `docker build --platform linux/amd64 --build-arg WORK_DIR=<dir> -f build/maven/Dockerfile .`
- `eg_user` PK is `(id, tenantid)`. egov-user container = `digit-egov-user-1`. DB = `docker-postgres`/`egov`.
- Kenya **mobile validation** (`common-masters.MobileNumberValidation` `^0?[17][0-9]{8}$`, cached in
  `egov-mdms-service`) rejects Indian numbers — blocks setting +91 on a user; but **direct Twilio/Novu
  sends to a number don't need a user record**.
- `nb_dispatch_log` `SENT` = Novu **accepted** the trigger, NOT delivered. Delivery truth =
  `db.messages` + `db.executiondetails` + `docker logs novu-worker` (this is how the empty-subject
  email bug + null-content were found).
- MDMS schemas created on fresh install by DDH `DataHandlerService.createMdmsSchemaFromFile()` glob
  over `classpath:schema/*.json` at startup (`schema/RAINMAKER-PGR.json` holds the notification
  schemas). Data seeded by `MdmsBulkLoader` from `mdmsData-dev/**` (schemaCode = filename).
- oauth token for API scripts: `Basic ZWdvdi11c2VyLWNsaWVudDo=` (`egov-user-client:` empty secret).
- **bometadmin logs in at `ke.bomet`** (city), NOT `ke` (root → "Invalid login credentials").
- **preference listing = `_search`, NOT `_check`**: `NOVU_BRIDGE_PREFERENCE_CHECK_PATH=/user-preference/v1/_check`
  is a boolean-consent path (404 where unwired); the full list is `/user-preference/v1/_search`
  (returns `{preferences:[...]}`). The proxy uses a dedicated `preference.search.path` config.
- **ProxyAuthFilter gotcha**: `shouldNotFilter` allowlists paths by prefix — any NEW `/novu-adapter/v1/*`
  endpoint MUST be added there or it serves UNAUTHENTICATED despite `proxyAuthEnabled=true` (caught + fixed
  for `/preferences`). Bomet's Kong `kong.yml` is hand-maintained and lacked the `novu-bridge-proxy` service
  entirely — the Logs/Providers/Preferences routes had to be appended + `kong reload`.
- Configurator "User Preferences" screen queries the proxy WITHOUT a tenant filter (`customTenantScoped:false`),
  so it lists ALL preferences by `preferenceCode` (all 3 test accounts, across `ke` + `ke.bomet`).

## 8. Open / remaining work

1. ~~**Seed user preferences** for the 3 test accounts~~ — **DONE**. Live on Bomet; reproducible
   seeder `local-setup/scripts/seed-test-account-preferences.py` (looks up test employees by
   userName → upserts USER_NOTIFICATION_PREFERENCES). Commit `c441e8556`.
2. ~~**Surface preferences in the configurator**~~ — **DONE**. novu-bridge read-only
   `GET /novu-adapter/v1/preferences` (allowlist projection: userId, tenantId, preferredLanguage,
   per-channel consent — no PII) mirroring the `/integrations` proxy; Kong `novu-bridge-preferences-route`;
   configurator `notification-preference` resource + "User Preferences" list screen (consent chips +
   preferredLanguage). Commits `93d0fedd2`, `d0cd4c347` (search-path fix), `3396d73a4` (auth-gate fix).
   Live image on Bomet: `novu-bridge:prefs-3396d73a4`; Kong route hand-added to `/opt/digit/kong/kong.yml`
   (also in branch `local-setup/kong/kong.yml` so Ansible regen preserves it). Verified in-browser.
3. **Fresh-box Ansible test** (`./deploy.sh mh-iterations`) — validate reproducibility of the whole
   PR #58 seed/schema/images on a wiped sandbox. (`mh-iterations` reachable, `db_fast_path`+CI on.)
4. **Per-recipient locale** in `pgr NotificationService.processConfigDriven` (read `preferredLanguage`,
   render per recipient). Currently single default locale.
5. **WhatsApp emitter wiring**: novu-bridge → Twilio ContentSid using `NotificationProviderTemplate`
   (design §5); then enable `WHATSAPP` on the channel gate. Officer legs SKIP until officer templates.
6. **Officer WhatsApp templates** in Twilio (needs Meta approval ~2 days): `complaints_lme_assign_*`,
   `complaints_gro_apply_*`, etc. — then provider-link auto-sync maps them.
7. **RATE cross-master inconsistency**: `NotificationProviderTemplate` has a CITIZEN RATE row but
   routing/templates treat RATE as EMPLOYEE-only — reconcile (drop the provider row or add CITIZEN
   rate routing+template).
8. **Configurator provider-link auto-sync** (fetch Twilio `ContentAndApprovals`, auto-match by
   naming, populate MDMS) — design §4, not built.

## 9. How to resume / verify

- Verify Bomet notif config: `ssh egov-bomet` → check the 3 MDMS masters + the 3 container images.
- Re-run lifecycle delivery: `scp /tmp/lifecycle-e2e.py egov-bomet:/tmp/` then
  `ssh egov-bomet "TW_SID=… TW_TOK=… NOVU_KEY=… python3 /tmp/lifecycle-e2e.py"` (creds in
  `host_vars/bomet.yml`, Novu key `f49dfaf43c3c92b4f4028be6376b69df`).
- Related memory: `[[pgr-notif-e2e-deploy-state]]`, `[[twilio-content-templates-bomet]]`.
