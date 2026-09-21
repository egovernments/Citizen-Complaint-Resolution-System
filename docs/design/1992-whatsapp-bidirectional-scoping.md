# Bidirectional WhatsApp on CCRS — Scoping Findings & Enablement Plan

> **Issue:** [#1992 — \[Scoping\] To verify if bidirectional whatsapp channel is working with new notifications infrastructure](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1992)
> **Milestone:** Release 2.20 (SaaSSy Phase 1) · **Labels:** `feature:omnichannel`, `feature:saas-enablement`, `scoping/design`
>
> **Target branch:** `master` is frozen and a `master` → `develop` PR is open. Land this work on
> `develop` once that merges. The `backend/xstate-chatbot/` tree is identical on both today, so
> nothing below changes as a result.
>
> **Basis:** re-verified against `origin/master` @ `37cc4c1e` and `origin/develop` @ `ad9d10b2`
> (2026-09-11). The `backend/xstate-chatbot/` tree is byte-identical on both (`84a63f11`), so every
> chatbot `file:line` below holds on either branch. Deployment and doc paths were re-checked on
> current `master`.
>
> **Since first draft:** the 2026-08-27 commit `26f50889` consolidated every notification doc into
> a single guide, [`docs/2.12/notifications/README.md`](../../docs/2.12/notifications/README.md),
> deleting `docs/notifications-guide/`, `docs/WhatsApp_Bidirectional/`, `docs/Novu_Adapter/` and
> `docs/notification-onboarding/`. Citations to those paths below are historical — read them with
> `git show 26f50889^:<path>`. The practical effect on this scoping: **Phase A is now fully
> documented and largely automated**, which is a material improvement over the first draft's
> assessment.
> Statements about the *live* `bomet` / `ke` deployment are quoted from in-repo docs that recorded a
> live probe at the time they were written — they are flagged inline as such and have **not** been
> re-verified against the running environment in this pass.

---

## 1. Verdict

The issue asks whether the previously-built bidirectional WhatsApp enablement still works after the
Novu cutover. The answer splits cleanly in two, because bidirectional WhatsApp is **two independent
subsystems**, and the Novu migration only ever touched one of them.

| Half | Owner | State | Verdict |
|---|---|---|---|
| **Outbound** — complaint updates pushed to the citizen | `pgr-services` → Kafka → `novu-bridge` → Novu → Twilio | Fully implemented, deployed, **switched off by configuration** | **Compatible. Config-only to enable.** |
| **Inbound** — citizen files/tracks a complaint by messaging the WhatsApp number | `xstate-chatbot` | Source present, image built nightly, **deployed nowhere** | **Regressed by omission, not by the Novu work.** Needs deployment + a small code change set. |

So neither of the issue's two branches applies unmodified:

- It is **not** a pure "compatibility preserved → just document the toggle" outcome, because the
  inbound service has no deployment path in either tier (compose or k8s).
- It is **not** a "regression → rebuild" outcome either. Nothing about the Novu work broke the
  chatbot. The two halves never coupled: the design that introduced Novu explicitly froze inbound as
  out of scope — *"Inbound WhatsApp conversation remains direct: Provider -> x-state-chatbot"*
  (`docs/WhatsApp_Bidirectional/HLD.md:7`, now removed — `git show 26f50889^:docs/WhatsApp_Bidirectional/HLD.md`), listing x-state-chatbot under
  *"Services Used As-Is"* with *"No inbound conversation routing changes"* as an explicit non-goal.

The honest framing for the issue: **the outbound half is a config flip; the inbound half was never
onboarded into this repo's deployment tiers and carries an India-only assumption set that blocks the
current target tenant (`ke`).** Section 6 sizes that.

---

## 2. What exists today, end to end

```
                          ┌──────────── INBOUND (xstate-chatbot) ────────────┐
   Citizen                │                                                  │
   WhatsApp ──▶ Twilio ──▶│ POST /xstate-chatbot/message                     │
                          │   channel/twilio.js  → normalise                 │
                          │   session-manager    → login/create citizen      │
                          │   machine/seva+pgr   → XState dialog             │
                          │   service/egov-pgr   → POST pgr-services         │
                          │                        /v2/request/_create       │
                          │                        source:"whatsapp"         │
                          └───────────────────┬──────────────────────────────┘
                                              │
                                        pgr-services
                                              │
                          ┌───────────────────▼──── OUTBOUND (Novu) ─────────┐
                          │ NotificationService.processConfigDriven()        │
                          │   route (MDMS NotificationRouting)               │
                          │   render (MDMS NotificationTemplate)             │
                          │   resolve Twilio Content SID                     │
                          │     (MDMS NotificationProviderTemplate)          │
                          │   publish 1 event / (recipient × channel)        │
                          │        → kafka: complaints.domain.events         │
                          │                     │                            │
                          │            novu-bridge DispatchPipelineService   │
                          │              gates → Novu trigger                │
                          │                     │                            │
                          │                Novu → Twilio → Citizen WhatsApp  │
                          └──────────────────────────────────────────────────┘
```

Both halves terminate at the same Twilio WhatsApp sender. That is what makes it "bidirectional" —
there is no shared code path between them, and no session correlation (see §7.3, Gap G-12).

---

## 3. Outbound half — detailed state

### 3.1 It is built, and built well

The WHATSAPP channel is a first-class citizen of the config-driven notification pipeline:

| Capability | Where | Note |
|---|---|---|
| `WHATSAPP` is a routable channel | `backend/pgr-services/.../notification/NotificationRouter.java:42` | alongside SMS, EMAIL |
| Approved-template resolution | `backend/pgr-services/.../NotificationService.java:964-968` | resolves a Twilio Content SID from `RAINMAKER-PGR.NotificationProviderTemplate`; emits a null `templateId` when nothing matches |
| Bridge-side template gate | `backend/novu-bridge/.../DispatchPipelineService.java:158-167` | a WHATSAPP event with no Content SID is persisted `SKIPPED / NB_TEMPLATE_NOT_APPROVED` rather than sent free-form (Twilio rejects free-form business-initiated with `63016`) |
| Recipient formatting | `DispatchPipelineService.java:175-177` | rewrites the phone to `whatsapp:+<E164>`; idempotent |
| Dedicated Twilio integration targeting | `NovuClient.java:102-127` | injects `overrides.sms.integrationIdentifier` so a WHATSAPP dispatch does not silently fall through to the plain-SMS Twilio integration |
| Channel enablement gate | `NovuBridgeConfiguration.java:110-121` | `novu.bridge.channels.enabled`, default `SMS,EMAIL` |
| Per-channel workflow id | `NovuBridgeConfiguration.getNovuWorkflowId:129-140` | `complaints-whatsapp` by default |
| Seeded approved templates | `utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationProviderTemplate.json` | **14 rows** — 7 transitions (APPLY, ASSIGN, RESOLVE, REJECT, REOPEN, REASSIGN, RATE) × `en_IN` + `hi_IN`, each with a real `HX…` Content SID and its ordered variables |
| `whatsapp` accepted as a complaint source | `backend/pgr-services/src/main/resources/application.properties:153` | `allowed.source=whatsapp,web,mobile,RB Bot` |

### 3.2 Why it does not deliver today

Three deliberate off-switches, all documented in-tree:

1. **`NOVU_BRIDGE_CHANNELS_ENABLED=SMS,EMAIL`** — `local-setup/docker-compose.egov-digit.yaml`, in the
   `novu-bridge` service block. The comment there is explicit: *"WHATSAPP stays OFF until a
   legitimate provider is onboarded as a Novu integration (then just add it here)."*
2. **`NOVU_BRIDGE_INTEGRATION_ID_WHATSAPP` is empty** — same block: *"Leave unset until that
   dedicated integration is onboarded."*
3. **No `complaints-whatsapp` workflow and no WhatsApp-registered Twilio integration exist in
   Novu.** Per `docs/notifications-guide/03-channels-providers.md` §3.1/§3.2 (now removed; recorded from a live
   probe at `ke`): Novu holds `complaints-sms`, `complaints-email`, `test-email-render`, and the
   integrations are two Twilio **SMS** and one Gmail SMTP. Consequence, also recorded live: every
   WHATSAPP event lands `SKIPPED / NB_NO_PROVIDER`.

**Nothing in that list is a code change.** It is a Twilio/Novu onboarding task plus three env values.

---

## 4. Inbound half — detailed state

### 4.1 The service exists and is reasonably current

`backend/xstate-chatbot/` — Node/Express + XState v4, ~3,700 LOC of machine + services.

- **Trimmed to PGR only.** `machine/service/service-loader.js` ships just the PGR v2 path; the
  legacy bills/receipts/PT/WS flows are gone.
- **Migrated to the N-level complaint hierarchy.** `machine/service/egov-pgr.js:110-140`
  (`mapHierarchyToServiceDefs`) reads `RAINMAKER-PGR.ComplaintHierarchy` and adapts leaf rows to the
  old `serviceCode`/`menuPath` shape. The dead `ServiceDefs` master is *not* referenced. This landed
  2026-06-23/24 (`867de348`, `3f85f9ef`) — the chatbot was carried through that migration.
- **Twilio is the default channel.** `env-variables.js:10` — `WHATSAPP_PROVIDER` defaults to
  `Twilio`; ValueFirst/Kaleyra/console remain selectable (`channel/index.js:5-15`).
- **It has tests.** `nodejs/test/pgr-flow.test.js` — 10 `node:test` cases driving the machine with
  stubbed services (happy path, fuzzy city/locality, invalid input, geolocation, track-complaint,
  degraded backend). Run with `npm test` from `backend/xstate-chatbot/nodejs`.
- **It is built nightly.** `build/build-config.yml` registers both `xstate-chatbot` and
  `xstate-chatbot-db`; `.github/workflows/build.yml:17` exposes it as a manual pipeline choice.
- **It has a schema.** `nodejs/db/migration/main/V20260505000000__chat.sql` creates
  `eg_chat_state_v2`.

### 4.2 It is deployed nowhere

| Tier | Evidence |
|---|---|
| **Compose / Ansible (the tier bomet actually runs)** | No `xstate-chatbot` service in any of `local-setup/docker-compose*.y*ml`; no Kong service/route in `local-setup/kong/kong.yml`; no nginx location in `local-setup/ansible/templates/nginx-site.conf.j2`; no `enable_*` flag in `local-setup/ansible/inventory/host_vars/_example.yml`. |
| **Kubernetes / Helm** | The chart exists at `devops/deploy-as-code/charts/core-services/xstate-chatbot/`, but **there is no `xstate-chatbot` release entry** in `devops/deploy-as-code/charts/core-services/coreservices-helmfile.yaml`. Helmfile only deploys named releases, so the chart is inert. |
| **Ever?** | `git log -S"xstate-chatbot" master -- local-setup/ devops/.../coreservices-helmfile.yaml` returns **nothing**. It has never been wired into either tier in this repo's history. |

This is already recorded in the release notes, which is useful corroboration rather than a new
finding: *"Not wired into local-setup compose/ansible — k8s Helm + CI build only"*
(`docs/2.12-beta/release-config-changelog-v2.12-beta.md:86`), and the feature is listed as
*"Kubernetes deployment only (pilot)"* (`docs/2.12-beta/release-notes-v2.12-beta.md:69`).

### 4.3 The Helm chart is stale in ways that would fail at runtime

Even with a release entry added, `devops/deploy-as-code/charts/core-services/xstate-chatbot/values.yaml`
would not work as-is:

| Line | Problem |
|---|---|
| `:26-28` | image tag `DIGIT-2.9-LTS-44558a0602-3` — a pre-CCRS ValueFirst-era build, not the nightly `xstate-chatbot` image this repo now produces |
| `:57-60` | `USER_SERVICE_HOST` ← configmap key `egov-user-chatbot` → `http://egov-user-chatbot:8080/` (`configmaps/values.yaml:125`). **No such Service exists**; this deployment runs `egov-user`. |
| `:66-69` | `LOCALIZATION_SERVICE_HOST` ← configmap key `zuul` → `http://zuul:8080/` (`configmaps/values.yaml:126`). **No such Service exists**; this deployment runs `gateway`. |
| — | `REPO_PROVIDER` is never set, so `env-variables.js:14` defaults to `InMemory` and `session/repo/index.js:5-12` selects the in-memory store — **the DB-migration init container runs and the table is then unused**. Sessions die on restart and break with `replicas > 1`. |
| — | No `TWILIO_*` envs at all. The chart only plumbs `VALUEFIRST_*` secrets. |
| — | Sets `MDMS_HOST`, `PGR_SERVICE_HOST`, `URL_SHORTNER_HOST`, `EGOV_FILESTORE_SERVICE_HOST`, `BILL_SERVICE_HOST`, `COLLECTION_SERVICE_HOST`, `FLOW_RESET_KEYWORDS`, `CONTACT_CARD_*` — **none of which `env-variables.js` reads**. Dead config that implies coverage it does not provide. |
| `:9-12` | `ingress.zuul: true` routes `/xstate-chatbot` to the `gateway` Service (`charts/common/templates/_ingress.yaml`). The gateway then enforces DIGIT auth, and `/xstate-chatbot/message` is **not** in `egov-open-endpoints-whitelist` (`charts/core-services/gateway/values.yaml:50`) — so Twilio's unauthenticated webhook would be rejected. |

The one thing that *is* fine: the referenced secrets exist —
`charts/environments/env-secrets.yaml` defines both `chatbot` (ValueFirst) and `egov-user-chatbot`
(`citizen-login-password-otp-fixed-value: "546941"`), and `configmaps/templates/secrets/chatbot-secret.yaml`
renders the first.

---

## 5. Compatibility assessment against the current platform

What actually still lines up, checked one integration at a time.

| # | Integration | Chatbot expects | Platform provides | Verdict |
|---|---|---|---|---|
| 1 | Complaint create | `POST pgr-services/v2/request/_create`, `source:"whatsapp"` (`egov-pgr.js:16`) | `allowed.source` includes `whatsapp` (`application.properties:153`) | ✅ |
| 2 | Complaint types | `RAINMAKER-PGR.ComplaintHierarchy` via mdms-v2, leaf rows (`egov-pgr.js:110-140,145-160`) | pgr-services reads the same master (`PGRConstants.java:25,152`) | ✅ |
| 3 | Citizen auth | `user/oauth/token`, `grant_type=password`, fixed OTP password (`user-service.js:105-140`) | `CITIZEN_LOGIN_PASSWORD_OTP_FIXED_ENABLED: 'true'`, value `123456` (`docker-compose.egov-digit.yaml:801-802`); chatbot default `USER_SERVICE_HARDCODED_PASSWORD` is also `123456` | ✅ values already match |
| 4 | Citizen create | `user/citizen/_create` | present; open on Kong (`user-auth-public`) | ✅ |
| 5 | Localization | `localization/messages/v1/_search` | present | ✅ (but see G-13) |
| 6 | Filestore | `filestore/v1/files` upload + `/url` download | present | ✅ |
| 7 | URL shortener | `egov-url-shortening/shortener` | deployed in both tiers | ✅ |
| 8 | Boundaries | `boundary-service/boundary-relationships/_search?hierarchyType=ADMIN&boundaryType=<lowest>` (`egov-pgr.js:440-468`), lowest level read from `CMS-BOUNDARY.HierarchySchema` | boundary-service deployed; hierarchy **name is per-deployment**, not guaranteed `ADMIN` | ⚠️ G-9 |
| 9 | City list | MDMS `tenant.citymodule` filtered on `module == 'PGR.WHATSAPP'` (`egov-pgr.js:389-395`) | seed has `Workbench`, `PGR`, `HRMS`, … — **no `PGR.WHATSAPP` row** (`mdmsData-dev/tenant/tenant.citymodule.json`) | ❌ G-10 |
| 10 | Fuzzy city/locality | `nlp-engine/fuzzy/city`, `/fuzzy/locality` (`egov-pgr.js:661,719`) | **`nlp-engine` is not deployed in either tier** | ❌ G-8 |
| 11 | Reverse geocode | Google Maps Geocoding API (`util/google-maps-util.js:6-7`) | external; needs `GOOGLE_MAPS_API_KEY` | ⚠️ G-8 |
| 12 | Sandbox tenant lookup | `tenant-management/tenant/_search?email=` (`email-tenant-service.js:39`) | **`tenant-management` does not exist in CCRS** | ❌ → must run with `ENABLE_SANDBOX_MODE=false` |
| 13 | Kafka | `kafka-node` producer, created at import (`session/kafka/kafka-producer.js:6-7`) | Redpanda (compose) / kafka-kraft (k8s) | ⚠️ G-11 |
| 14 | Outbound status pushes | Kafka `update-pgr-request` → ValueFirst templates (`pgr-status-update-events.js:19,105`) | topic exists; ValueFirst does not | ❌ G-3 — **must stay disabled** |

---

## 6. Gap register

Severity: **P0** blocks a working pilot · **P1** blocks production/non-India · **P2** hardening.

### Deployment gaps

| ID | Sev | Gap | Fix |
|---|---|---|---|
| **G-1** | P0 | No compose/Ansible deployment. The tier bomet runs cannot start the chatbot at all. | Add an `xstate-chatbot` (+ `xstate-chatbot-db` migration) service under a new `chatbot` compose profile; add `enable_chatbot` to `host_vars`; extend the `compose_profiles` fact at `local-setup/ansible/playbook-deploy.yml:1587-1596`. |
| **G-2** | P0 | No public route for the Twilio webhook. | Kong service + route for `/xstate-chatbot` → `xstate-chatbot:8080`, and an nginx location. Kong carries no global auth plugin, so the webhook is reachable without a DIGIT token — which is what Twilio needs, and exactly why G-6/G-7 matter. |
| **G-4** | P1 | No helmfile release; chart stale (§4.3). | Add the release; rewrite `values.yaml` — real image tag, `EGOV_SERVICES_HOST`/`USER_SERVICE_HOST`/`LOCALIZATION_SERVICE_HOST` onto live Services, `REPO_PROVIDER=Postgres`, `TWILIO_*` from a secret, drop the six dead host envs. |
| **G-5** | P1 | K8s gateway would 401 the webhook (`gateway/values.yaml:50`). | Either whitelist `/xstate-chatbot/message` in `egov-open-endpoints-whitelist` **and** mirror it into `local-setup/kong/kong.yml` (the `gateway-whitelist-parity` CI job enforces both tiers stay identical), or set `ingress.zuul: false` so the ingress hits the pod directly and the webhook never traverses the gateway. Prefer the latter — it keeps an unauthenticated path off the shared gateway allowlist. |
| **G-14** | P1 | New compose services must have a Gatus check or CI fails (`.github/workflows/gatus-coverage.yml`). | Add a `/xstate-chatbot/health` check (the endpoint already exists, `channel/routes/index.js:80`) to both `local-setup/gatus/config.yaml` and the k8s Gatus config. |

### Code gaps

| ID | Sev | Gap | Evidence | Fix |
|---|---|---|---|---|
| **G-6** | **P0 (security)** | Express mounts a **catch-all reverse proxy to the DIGIT services host** for every path not under `/xstate-chatbot`. Exposing this container publicly turns it into an open proxy onto internal DIGIT APIs. | `src/app.js:21-25` | Remove the `createProxyMiddleware('/')` mount (it exists only to make the dev `react-app` work — see `LOCALSETUP.md`), or gate it behind a `DEV_PROXY_ENABLED` flag defaulting off. **Do not expose the service publicly until this is done.** |
| **G-7** | **P0 (security)** | No Twilio signature validation. `isValid()` only checks that the payload *looks* like a Twilio webhook, so anyone who learns the URL can inject messages as any citizen phone number. Separately, `POST /xstate-chatbot/reminder` is unauthenticated and broadcasts to every active session. | `src/channel/twilio.js:142-157`; `src/channel/routes/index.js:75-77` | Validate `X-Twilio-Signature` (HMAC-SHA1 over URL + sorted params, keyed by the auth token) before processing. Move `/reminder` off the public path or require a shared secret. |
| **G-3** | **P0** | The Kafka status-update consumer sends outbound WhatsApp **via ValueFirst only**, ignoring `WHATSAPP_PROVIDER`, and would duplicate every message Novu already sends for `whatsapp`-sourced complaints. | `pgr-status-update-events.js:4` imports `channel/value-first` directly; `:105` calls `valueFirst.getTransformMessageForTemplate(...)` with a `// TODO: Use channel.sendMessageToUser()` | **Ship with `KAFKA_CONSUMER_ENABLED=false`.** Novu owns 100% of outbound. Longer term, delete `pgr-status-update-events.js` rather than fix it — it is a second, divergent notification engine. |
| **G-8** | P0 | Location capture depends on two things this platform does not have: `nlp-engine` (not deployed) and a Google Maps key. | `egov-pgr.js:661,719`; `util/google-maps-util.js:6-7` | Set `GEO_SEARCH=false` to route the dialog to the MDMS/boundary city→locality pick-lists, which removes both dependencies. That makes G-9 and G-10 blocking. |
| **G-9** | P1 | `hierarchyType=ADMIN` is hardcoded in the boundary query. CCRS deployments name the hierarchy per-deployment. | `egov-pgr.js:468` | Make it an env var (`BOUNDARY_HIERARCHY_TYPE`), defaulting to `ADMIN`. |
| **G-10** | P0 | `fetchCities` filters `tenant.citymodule` on `module == 'PGR.WHATSAPP'`; no such row is seeded, so the city list comes back empty. | `egov-pgr.js:389-395` vs `mdmsData-dev/tenant/tenant.citymodule.json` | Seed a `PGR.WHATSAPP` citymodule row listing the WhatsApp-enabled tenants (data-only), **or** repoint `fetchCities` at the plain `PGR` module. Prefer seeding — it keeps "which cities are on WhatsApp" an operator decision. |
| **G-15** | **P1** | **India is hardcoded in the phone path.** `+91` is prepended to every outbound recipient; the inbound parser strips a leading `91`; `sanitizeMobileNumber` accepts only 10 digits or 12-digits-starting-`91` and returns `null` otherwise. A Kenyan `+254712345678` fails sanitisation and the citizen gets "Invalid mobile number format". The external city/locality deep links also hardcode `&phone=+91`. | `twilio.js:167,273,282,294`; `user-service.js:202-216`; `egov-pgr.js:410` | Drive country code and national-number rules from the existing canonical master **`common-masters.MobileNumberValidation`** (`{countryCode, mobileNumberRegex}`) — already the single source of truth for egov-user, egov-hrms, digit-ui and novu-bridge (`novu-bridge/.../MobileValidationConfig.java`; `digit-ui-esbuild/products/pgr/src/hooks/pgr/useMobileValidation.js:10-25`). This is the single largest code item and the one that decides whether `ke` is in scope. |
| **G-11** | P2 | `kafka-node@5` is unmaintained and speaks an old protocol; the producer client is constructed at import time even when the consumer is off, so a broker outage produces continuous reconnect noise. | `package.json`; `session/kafka/kafka-producer.js:6-7` | Verify handshake against Redpanda during the pilot. If telemetry is not needed, gate the producer behind a flag; otherwise plan a move to `kafkajs`. |
| **G-12** | P2 | No session correlation between halves. A citizen replying to an outbound Novu template starts a *fresh* chatbot session with no knowledge of the complaint. "Bidirectional" today means "both directions exist", not "one conversation". | design-level | Out of scope for enablement. Worth a follow-up issue if product expects reply-in-thread. |
| **G-13** | P2 | `localisation-service.init()` fetches **every** message for the tenant+locale with no `module` filter, and `getMessageForCode` would throw on an unknown locale. | `machine/util/localisation-service.js:62-64,27` | Add `module=rainmaker-pgr,digit-tenants` and a null-guard. |
| **G-16** | P2 | Dependency age: `axios@^0.18.1`, `request@^2.88.0` (deprecated), `xstate@^4.13.0`, on `node:23.9.0-alpine` (a non-LTS line). | `package.json`; `Dockerfile:1` | Run `npm audit`, bump `axios`, drop `request`, pin an LTS Node base before production. |
| **G-17** | P2 | `npm test` for the chatbot runs in **no** CI workflow, despite a real 10-case suite existing. | `.github/workflows/*` | Add a small workflow on `backend/xstate-chatbot/**`. |
| **G-18** | P1 | **No inbound documentation exists.** The consolidated `docs/2.12/notifications/README.md` is outbound-only (no "chatbot"/"inbound" anywhere). The only inbound write-ups — `FLOW_SIMULATION.md` and `SANDBOX_IMPLEMENTATION_CONTEXT.md` — were deleted from master by `cd3dbd6f` (2026-06-01) and predate the ComplaintHierarchy migration. `backend/docs/COMPREHENSIVE_WHATSAPP_SETUP_GUIDE.md` is still on master but describes the superseded Phase-1 design and links to a file that no longer exists. | `git log --all -- '*FLOW_SIMULATION*'` | Ship `docs/2.12/notifications/inbound-whatsapp.md`; delete or mark the stale `COMPREHENSIVE_WHATSAPP_SETUP_GUIDE.md`. |

---

## 7. Enablement plan

Four phases. **A is independent of B–D and should ship first** — it delivers real citizen value on
its own and de-risks the Twilio/Novu onboarding that the inbound half also depends on.

### Phase A — Outbound WhatsApp (config + operations only, no code)

*Deliverable: citizens receive complaint updates on WhatsApp. Reversible by reverting one setting.*

**This phase is already written up and largely automated.** Follow
[`docs/2.12/notifications/README.md` → *Enable WhatsApp*](../../docs/2.12/notifications/README.md#enable-whatsapp).
Nothing in this scoping adds to it. In outline:

1. Set `twilio_account_sid`, `twilio_auth_token`, `twilio_whatsapp_from` and add `WHATSAPP` to
   `novu_bridge_channels_enabled` in `local-setup/ansible/inventory/host_vars/<tenant>.yml`.
2. Re-run `./deploy.sh <tenant>`. The deploy runs
   `backend/novu-bridge/config/bootstrap-novu-whatsapp.sh`, which creates the `twilio-whatsapp`
   Novu integration and the `complaints-whatsapp` workflow. (Run it by hand only if the Twilio
   credentials were added after the first deploy.)
3. Verify the integration is `active` and the workflow exists, per the guide's *Verify WhatsApp*
   `curl`s.
4. Match approved Twilio Content SIDs to PGR transitions: **Configurator → Notifications →
   Providers → Sync WhatsApp templates**. The 14 `HX…` SIDs seeded in
   `RAINMAKER-PGR.NotificationProviderTemplate.json` were minted against a different Twilio account
   and are **not portable** — each account needs its own approved templates with the expected names
   and ordered variables.
5. Trigger a real transition; read **Notifications → Logs** / `nb_dispatch_log`. Expected `SENT`.
   The two failure codes to recognise: `NB_NO_PROVIDER` (steps 1–2 incomplete) and
   `NB_TEMPLATE_NOT_APPROVED` (step 4 incomplete).

One trap the guide calls out and that this scoping confirms matters: notification configuration is
resolved from the **state root** of the complaint's tenant. A complaint in `pg.citya` reads config
from `pg`, which may not be the deployment's `state_root`. If they differ, re-run the idempotent
notification seed for the complaint root before testing.

**Effort: S.** No build, no code — host_vars + one deploy + Configurator template sync.

### Phase B — Inbound pilot on the compose tier (`ke` or a staging tenant)

*Deliverable: a citizen can file and track a complaint by messaging the WhatsApp number.*

The operator-facing write-up for this phase is the companion document
[`docs/2.12/notifications/inbound-whatsapp.md`](../../docs/2.12/notifications/inbound-whatsapp.md)
— settings, Twilio webhook setup, wiring sketches, verification and troubleshooting. The table
below is the engineering task breakdown behind it.

Code changes, in dependency order — **B1 and B2 are non-negotiable prerequisites to exposing the
service publicly**:

| Step | Change | Gap |
|---|---|---|
| B1 | Remove / flag-gate the catch-all proxy in `src/app.js:21-25` | G-6 |
| B2 | Add `X-Twilio-Signature` validation; protect `/reminder` | G-7 |
| B3 | Make country code + mobile validation MDMS-driven (`common-masters.MobileNumberValidation`) | G-15 |
| B4 | `BOUNDARY_HIERARCHY_TYPE` env instead of the hardcoded `ADMIN` | G-9 |

Deployment changes:

| Step | Change | Gap |
|---|---|---|
| B5 | `xstate-chatbot` + `xstate-chatbot-db` services in `docker-compose.egov-digit.yaml` under `profiles: ["chatbot"]` | G-1 |
| B6 | `enable_chatbot` in `host_vars/_example.yml`; add `'chatbot'` to the `compose_profiles` fact (`playbook-deploy.yml:1587-1596`) | G-1 |
| B7 | Kong service + route `/xstate-chatbot` → `xstate-chatbot:8080`; nginx location | G-2 |
| B8 | Gatus check on `/xstate-chatbot/health` (both tiers, or CI fails) | G-14 |

Data / config:

| Step | Change | Gap |
|---|---|---|
| B9 | Seed `PGR.WHATSAPP` into `tenant.citymodule` for the pilot tenants | G-10 |
| B10 | Confirm the `ADMIN_`-prefix locality convention (`egov-pgr.js:889`) matches the tenant's boundary codes | — |

Runtime settings for the pilot:

```
WHATSAPP_PROVIDER=Twilio
REPO_PROVIDER=Postgres          # NOT the InMemory default
KAFKA_CONSUMER_ENABLED=false    # G-3 — Novu owns all outbound
ENABLE_SANDBOX_MODE=false       # tenant-management does not exist here
GEO_SEARCH=false                # G-8 — avoids nlp-engine + Google Maps
ROOT_TENANTID=<pilot tenant>
SERVICE_PORT=8080
CONTEXT_PATH=/xstate-chatbot
TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_NUMBER
USER_SERVICE_HARDCODED_PASSWORD=<must equal CITIZEN_LOGIN_PASSWORD_OTP_FIXED_VALUE>
```

Finally, point the Twilio number's inbound webhook at
`https://<host>/xstate-chatbot/message` and the status callback at `/xstate-chatbot/status`.

**Effort: M** (≈1 sprint), assuming G-15 is scoped to "read the MDMS master" rather than a full
i18n/number-format rework.

### Phase C — Kubernetes parity

Only needed if a k8s tenant wants this. Add the helmfile release and rewrite the chart per §4.3;
resolve G-5 (prefer `ingress.zuul: false` over widening the shared gateway allowlist).
**Effort: S–M.**

### Phase D — Hardening

G-11 (Kafka client), G-13 (localization fetch), G-16 (dependencies / Node LTS), G-17 (CI tests).
**Effort: M.** Should complete before any production tenant, and can run in parallel with B.

---

## 8. Verification plan

| Layer | Test | Pass criterion |
|---|---|---|
| Unit | `cd backend/xstate-chatbot/nodejs && npm test` | 10/10 |
| Outbound | Configurator → Notification Providers → Test-Send (WHATSAPP) | message delivered; `nb_dispatch_log` row `SENT`, tagged `TEST` |
| Outbound E2E | File a complaint via digit-ui, walk it ASSIGN → RESOLVE | one WHATSAPP row per transition, all `SENT` |
| Inbound smoke | `POST /xstate-chatbot/message` with a synthetic Twilio form body (see `nodejs/XState-Chatbot-Console.postman_collection.json`) | 200; a reply is sent |
| Inbound E2E | From a real handset: `Hi` → complaint type → locality → submit | complaint exists in PGR with `source=whatsapp`; the citizen's WhatsApp receives the APPLY notification **via Novu** |
| Bidirectional | Same complaint: employee resolves it in digit-ui | citizen receives the RESOLVE WhatsApp message; replying `Hi` opens a fresh session (expected — see G-12) |
| Resilience | Restart the chatbot container mid-dialog | session survives (proves `REPO_PROVIDER=Postgres`) |
| Negative | Two notified roles held by one user; a WHATSAPP event with no approved template | one message per channel; `SKIPPED / NB_TEMPLATE_NOT_APPROVED` recorded, no free-form send |
| Security | Unsigned POST to `/message`; `GET /<some-internal-path>` on the chatbot host | rejected (G-7); not proxied (G-6) |

---

## 9. Decisions needed before build starts

1. **Which tenant is the pilot?** If it is `ke`, **G-15 is P0, not P1** — the chatbot currently
   cannot process a Kenyan number at all. An India-numbered staging tenant would let B ship without
   G-15 and defer it.
2. **Compose only, or compose + k8s?** Phase C roughly doubles the deployment work for a tier no
   current tenant uses. Recommend compose-only for 2.20.
3. **Is `pgr-status-update-events.js` deleted or kept?** Keeping it dormant leaves a second
   notification engine in the tree that a future operator can switch on and double-send from.
   Recommend deleting it in Phase B.
4. **Does "bidirectional" require reply-in-thread (G-12)?** If product means a citizen can reply to
   an outbound notification and be resumed *in the context of that complaint*, that is a design
   increment beyond this plan and needs its own issue.

---

## 10. Recommended answer to post on #1992

> Bidirectional WhatsApp is two subsystems and the Novu cutover only touched one.
>
> **Outbound is compatible, needs no code, and is already documented.** The WHATSAPP channel is
> fully implemented across pgr-services and novu-bridge (approved-template gate, `whatsapp:+E164`
> formatting, dedicated integration targeting). Enabling it is Twilio credentials plus `WHATSAPP` in
> `novu_bridge_channels_enabled`, then a deploy — the playbook runs `bootstrap-novu-whatsapp.sh`,
> which creates the `twilio-whatsapp` integration and the `complaints-whatsapp` workflow. Procedure:
> `docs/2.12/notifications/README.md` → *Enable WhatsApp*. The one real task is per-account Twilio
> template approval: the seeded `HX…` Content SIDs belong to a different account and are not
> portable; use Configurator → *Sync WhatsApp templates*.
>
> **Inbound did not regress — it was never deployed here.** `xstate-chatbot` is in the repo, current
> with the ComplaintHierarchy migration, tested, and built nightly, but it has no release entry in
> the helmfile and no presence in the compose/Ansible tier, and `git log -S` confirms it never has.
> The Helm chart that does exist is ValueFirst-era and points at Services (`egov-user-chatbot`,
> `zuul`) that this deployment does not run.
>
> Enabling inbound is ~1 sprint and needs, in priority order: two security fixes before anything is
> exposed (a catch-all reverse proxy in `app.js` and missing Twilio signature validation), MDMS-driven
> country-code handling (the phone path hardcodes `+91`, which blocks `ke` outright), a compose
> service + Kong route + Gatus check, and one MDMS seed (`PGR.WHATSAPP` in `tenant.citymodule`).
> The chatbot's own Kafka status-update consumer must stay off — it is a second outbound engine that
> would duplicate Novu's messages via a ValueFirst path that no longer exists.
>
> Full analysis with `file:line` evidence, gap register and phased plan: *(link to this doc)*.
> Operator guide for the inbound half: `docs/2.12/notifications/inbound-whatsapp.md`.
