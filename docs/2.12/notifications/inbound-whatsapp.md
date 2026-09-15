# Enabling Inbound WhatsApp (file a complaint by messaging)

> **Status: implemented and deployable. Enable with `enable_chatbot: true`.**
>
> The service, its Compose/Kong/Gatus wiring and its Ansible plumbing all ship in this
> repository. What remains is external: a Twilio account with a WhatsApp sender, and
> pointing that sender's webhook at this deployment (§6).
>
> Verified against `origin/develop` @ `ad9d10b2`. `master` is frozen; this work targets
> `develop`. The `backend/xstate-chatbot/` tree is identical on both (`84a63f11`).
>
> **Sibling link note.** The outbound guide this file links to as `README.md` arrives on
> `develop` with the pending `master` → `develop` merge (commit `26f50889`). Until then the
> outbound guide lives at `docs/notifications-guide/`.

This completes the WhatsApp channel in the other direction. [Enabling Notifications](README.md)
covers **outbound** — the platform pushing complaint updates to a citizen. This covers **inbound** —
a citizen messaging your WhatsApp number to *file* and *track* a complaint.

---

## 0. What documentation already exists

**Nothing in the current tree documents inbound.** `docs/2.12/notifications/README.md` — the single
consolidated notifications guide — covers SMS, WhatsApp and email **outbound** only; it contains no
occurrence of "chatbot" or "inbound". This document fills that gap.

Four chatbot-related documents exist in git history. None is on `master` or `develop`, and only the
first two are about inbound at all:

| Document | Added | Status | Worth reading? |
|---|---|---|---|
| `backend/xstate-chatbot/nodejs/FLOW_SIMULATION.md` (246 lines) | 2026-05-26 `77c6d0ad` | **deleted** 2026-06-01 by `cd3dbd6f` (on master) | **Yes.** Turn-by-turn transcripts of both dialog modes, plus local test commands. Salvaged into §8.1 and §4 below. |
| `backend/xstate-chatbot/nodejs/SANDBOX_IMPLEMENTATION_CONTEXT.md` (132 lines) | 2026-05-26 `77c6d0ad` | **deleted** by the same commit | Partly. Design notes for sandbox mode, which CCRS does not use (§4). Its own "Pending Tasks" list was never closed. |
| `backend/xstate-chatbot/ORG_CODE_TENANT_DESIGN.md` (400 lines) | 2026-06-19 `2caabc59` | side branch only (`notification-karix`), never merged | Design-stage. Proposes resolving the tenant from an org code the citizen types, replacing the fixed `ROOT_TENANTID`. Relevant if one WhatsApp number must serve several tenants — see §11. |
| `backend/docs/WHATSAPP_NOTIFICATION_SETUP.md` (348 lines) | 2026-03-04 `f0ac1885` | **deleted** | No — **outbound**, and superseded by `docs/2.12/notifications/README.md`. |

Recover any of them with `git show <commit>:<path>`, e.g.:

```bash
git show 77c6d0ad:backend/xstate-chatbot/nodejs/FLOW_SIMULATION.md
```

Two caveats before treating the recovered pair as authority. They were working notes for the
**sandbox.digit.org pilot**, deleted deliberately as cleanup, not lost. And they were written
against a tree that still read the retired `RAINMAKER-PGR.ServiceDefs` master — the chatbot moved to
`ComplaintHierarchy` on 2026-06-23/24 (`867de348`, `3f85f9ef`), after both were deleted. Their
complaint-type screens no longer match the code. Everything reused below has been re-checked against
the current tree.

Also stale, for the same reason: `backend/docs/COMPREHENSIVE_WHATSAPP_SETUP_GUIDE.md` is still on
master but describes the superseded Phase-1 design in which `novu-bridge` resolved templates and
providers from Config Service. It links to `WHATSAPP_NOTIFICATION_SETUP.md`, which no longer exists.
It is outbound-only and should not be followed.

---

## 1. How inbound works

Inbound does **not** go through Novu. Novu is an outbound delivery orchestrator and has no webhook
receiver; `novu-bridge` exposes seven `/novu-adapter/v1` routes, all outbound or read-only
(`backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/`).

Inbound is a separate service, `xstate-chatbot`, that Twilio calls directly:

```
Citizen WhatsApp
      │
      ▼  Twilio inbound webhook (form-urlencoded)
POST https://<host>/xstate-chatbot/message
      │
      ├─ channel/twilio.js      normalise text / media / location
      ├─ session-manager.js     resolve or create the citizen in egov-user
      ├─ machine/seva.js+pgr.js XState dialog, state persisted in Postgres
      └─ service/egov-pgr.js    POST pgr-services/v2/request/_create
                                source: "whatsapp"
      │
      ▼
   complaint exists in PGR ──▶ outbound notification (Novu) as normal
```

The two directions share only the Twilio sender number. They are separate services, separate
processes, and there is no session correlation between them — a citizen replying to an outbound
notification starts a **fresh** chatbot session with no knowledge of the complaint it referred to.

This split is the original design intent, not drift. The design doc that introduced Novu froze
inbound as out of scope: *"Inbound WhatsApp conversation remains direct: Provider -> x-state-chatbot"*
(`docs/WhatsApp_Bidirectional/HLD.md:7`, removed from the tree by the 2026-08-27 docs consolidation
`26f50889`; still readable with `git show 26f50889^:docs/WhatsApp_Bidirectional/HLD.md`).

### What the citizen can do

From `backend/xstate-chatbot/nodejs/src/machine/pgr.js`:

| Flow | States |
|---|---|
| **File a complaint** | complaint type (frequent list, or category → item) → location (shared geolocation, or city → locality pick-list) → optional photo → confirm → create |
| **Track complaints** | lists the citizen's recent open complaints with status |

Greeting keywords that reset the dialog: `Hi`, `Hello`, `hi`, `hello`, `egov`, `seva`, `सेवा`,
`Start`, `start`, `Help`, `help` (`session/session-manager.js`, `grammer.reset`).

---

## 2. What this deployment already does for you

Everything below shipped with the inbound-WhatsApp change. It is recorded so you know what
the flag turns on, and what was deliberately left out.

| Area | Shipped |
|---|---|
| Twilio webhook authentication | `X-Twilio-Signature` verified on `/message` and `/status`; fails closed when `TWILIO_AUTH_TOKEN` is unset; origin pinned via `TWILIO_WEBHOOK_BASE_URL` so a forged `Host` cannot steer the check |
| Open-proxy removal | the catch-all reverse proxy is behind `DEV_PROXY_ENABLED`, default off; unmatched paths now 404 |
| `/reminder` | requires `X-Reminder-Token`; the route is disabled entirely when `REMINDER_AUTH_TOKEN` is unset |
| Country code | read from `common-masters.MobileNumberValidation` (the same master egov-user, egov-hrms, digit-ui and novu-bridge use); falls back to `+91` / 10 digits, so India is unchanged |
| Boundary hierarchy | `BOUNDARY_HIERARCHY_TYPE`, default `ADMIN` |
| Deployment | Compose services under the `chatbot` profile, Kong route, Gatus check in both tiers, `enable_chatbot` in Ansible |
| Seed | `PGR.WHATSAPP` row in `tenant.citymodule`, in **both** the default and dev MDMS bundles (the dev bundle alone only loads under `dev.enabled`, so production-onboarded tenants would get an empty city list) |
| Sender address | `twilio_whatsapp_from` keeps its repo-wide `whatsapp:+<E164>` form, shared with the Novu outbound bootstrap; the chatbot strips and re-adds the prefix itself rather than redefining a variable outbound depends on |
| Fail-loud config | an unset Twilio sender raises at send time instead of silently using the eGov demo number `+919880900990` |

Two things are deliberately **not** done, and are tracked separately:

- **Session correlation between the two directions** (§11). A citizen replying to an
  outbound Novu notification starts a fresh dialog with no knowledge of that complaint.
- **The chatbot's own Kafka status-update consumer** stays off (§5). It is a second,
  divergent outbound engine that would double-send.

### 2.0 Historical detail — the gaps this change closed

### 2.1 Security — must land before the service is reachable from the internet

| | Issue | Where |
|---|---|---|
| **S1** | Express mounts a **catch-all reverse proxy to the DIGIT services host** for every path that does not match the chatbot's own context path. Publishing this container turns it into an open proxy onto internal DIGIT APIs. | `nodejs/src/app.js:21-25` |
| **S2** | **No Twilio signature validation.** `isValid()` only checks that the payload *looks* like a Twilio webhook, so anyone who learns the URL can post as any citizen phone number and file complaints in their name. | `nodejs/src/channel/twilio.js:142-157` |
| **S3** | `POST /xstate-chatbot/reminder` is unauthenticated and broadcasts a message to **every** active session. | `nodejs/src/channel/routes/index.js:75-77` |

S1 exists only so the developer-only `react-app` dialog harness can proxy API calls
(`backend/xstate-chatbot/LOCALSETUP.md`). Remove it, or gate it behind a flag that defaults off.
S2 needs `X-Twilio-Signature` verification (HMAC-SHA1 over the full URL plus sorted POST params,
keyed by the Twilio auth token) before any message is processed. S3 should move off the public
path or require a shared secret.

### 2.2 Country code — blocking for any non-India tenant

The phone path hardcodes India in four places:

| Behaviour | Where |
|---|---|
| `whatsapp:+91` prepended to every outbound reply | `twilio.js:273`, `:282`, `:294` |
| leading `91` stripped from inbound numbers | `twilio.js:167` |
| `sanitizeMobileNumber` accepts only 10 digits, or 12 starting `91` — anything else returns `null` | `user-service.js:202-216` |
| `&phone=+91` in the city/locality deep links | `egov-pgr.js:410` |

A Kenyan `+254712345678` is 12 digits not starting `91`, so it fails sanitisation and the citizen
receives *"Invalid mobile number format"*. **`ke` cannot use inbound until this is fixed.**

The fix is to read the existing canonical master **`common-masters.MobileNumberValidation`**
(`{countryCode, mobileNumberRegex}`) — already the single source of truth for egov-user, egov-hrms,
digit-ui and novu-bridge (`novu-bridge/.../web/models/MobileValidationConfig.java`,
`digit-ui-esbuild/products/pgr/src/hooks/pgr/useMobileValidation.js:10-25`).

### 2.3 Hardcoded boundary hierarchy

`egov-pgr.js:468` pins `hierarchyType=ADMIN` in the boundary query. CCRS deployments name the
hierarchy per deployment. Make it an env var (`BOUNDARY_HIERARCHY_TYPE`, default `ADMIN`).

### 2.4 Deployment wiring

| | What | Model to copy |
|---|---|---|
| **D1** | `xstate-chatbot` + `xstate-chatbot-db` services in `local-setup/docker-compose.egov-digit.yaml` under `profiles: ["chatbot"]` | `novu-bridge-endpoint` (Node service, healthcheck, profile) |
| **D2** | `enable_chatbot` in `host_vars`, and `'chatbot'` added to the `compose_profiles` fact | `local-setup/ansible/playbook-deploy.yml`, the `enable_novu → ['notifications']` line |
| **D3** | Kong service + route | `filestore-service` in `local-setup/kong/kong.yml` |
| **D4** | `nginx_features.chatbot_webhook` + a location block | `local-setup/ansible/templates/nginx-site.conf.j2` |
| **D5** | Gatus check on `/xstate-chatbot/health` — **CI fails without it** (`.github/workflows/gatus-coverage.yml` requires every Compose service to be monitored or explicitly exempted) | the `Novu Bridge Endpoint` entry in `local-setup/gatus/config.yaml` |

Sketches for D1–D5 are in §7.

### 2.5 One MDMS seed

`fetchCities` filters `tenant.citymodule` on `module == 'PGR.WHATSAPP'` (`egov-pgr.js:389-395`).
No such row is seeded — `utilities/default-data-handler/.../tenant/tenant.citymodule.json` has
`Workbench`, `PGR`, `HRMS` and others, but not `PGR.WHATSAPP`. Without it the city pick-list comes
back empty. Seed the row listing the WhatsApp-enabled tenants (keeps "which cities are on WhatsApp"
an operator decision), or repoint `fetchCities` at the plain `PGR` module.

### 2.6 Kubernetes only

The Helm chart at `devops/deploy-as-code/charts/core-services/xstate-chatbot/` exists but has **no
release entry** in `coreservices-helmfile.yaml`, so Helmfile never deploys it. It is also stale:
image tag `DIGIT-2.9-LTS-44558a0602-3` (ValueFirst era), `USER_SERVICE_HOST` pointing at a
non-existent `egov-user-chatbot` Service, `LOCALIZATION_SERVICE_HOST` at a non-existent `zuul`,
no `TWILIO_*` envs, and `REPO_PROVIDER` unset so sessions silently fall back to in-memory. Skip
this section entirely for a Compose/Ansible deployment.

---

## 3. Prerequisites — accounts and platform

1. Everything in [Enabling Notifications → Prerequisites](README.md#prerequisites). Inbound reuses
   the same Twilio account and the same WhatsApp sender.
2. A deployment created by `./deploy.sh mycity`.
3. **Outbound WhatsApp already working.** Not a hard dependency, but enable it first: it proves the
   Twilio account, sender and webhook reachability before you add a second moving part.
4. Complaint types seeded in `RAINMAKER-PGR.ComplaintHierarchy`, and boundaries seeded for the
   tenant. The chatbot reads both.

---

## 4. Configure

Add to `local-setup/ansible/inventory/host_vars/mycity.yml`:

| Setting | What it is | Example |
|---|---|---|
| `enable_chatbot` | Starts `xstate-chatbot` and its DB migration. Nothing below works without it. | `true` |
| `chatbot_root_tenant` | Tenant complaints are filed under. Must match the tenant whose boundaries and complaint types are seeded. | `"pg.citya"` |
| `chatbot_whatsapp_business_number` | Your Twilio WhatsApp sender, digits only, no `+`. | `"14155238886"` |
| `chatbot_geo_search` | `false` uses the MDMS/boundary city → locality pick-lists. `true` needs `nlp-engine` (**not deployed in this stack**) and a Google Maps key. Leave `false`. | `false` |
| `chatbot_supported_locales` | Locales the dialog offers. | `"en_IN"` |

Reuses the Twilio values you already set for outbound: `twilio_account_sid`, `twilio_auth_token`,
`twilio_whatsapp_from`.

Three settings are **not** operator-facing and must be fixed in the Compose service definition:

| Setting | Value | Why |
|---|---|---|
| `REPO_PROVIDER` | `Postgres` | `env-variables.js:14` defaults to `InMemory` (`session/repo/index.js:5-12`). On the default, conversations are lost on every restart and break with more than one replica — while the DB migration still runs and creates a table nothing writes to. |
| `KAFKA_CONSUMER_ENABLED` | `false` | See §5. |
| `ENABLE_SANDBOX_MODE` | `false` | Sandbox mode resolves the tenant by emailing `tenant-management/tenant/_search` (`email-tenant-service.js:39`). **`tenant-management` does not exist in CCRS.** |

One value must agree across two services: the chatbot's `USER_SERVICE_HARDCODED_PASSWORD` must
equal egov-user's `CITIZEN_LOGIN_PASSWORD_OTP_FIXED_VALUE`. Both default to `123456`
(`env-variables.js`; `docker-compose.egov-digit.yaml:801-802`), so they already match on a stock
deployment — but if you have rotated the fixed OTP, rotate this too or every citizen login fails.

Then:

```bash
cd local-setup/ansible
./deploy.sh mycity
```

Wait for `failed=0`.

---

## 5. Leave the chatbot's own Kafka consumer off

`KAFKA_CONSUMER_ENABLED=true` starts a second, independent outbound notification engine inside the
chatbot. It consumes the `update-pgr-request` topic and sends its own WhatsApp templates for any
complaint with `source == "whatsapp"` (`machine/service/pgr-status-update-events.js:19`).

Two reasons it must stay off:

1. **It duplicates Novu.** For a WhatsApp-filed complaint, the citizen gets the Novu message *and*
   this one for the same transition.
2. **It cannot work anyway.** It calls `valueFirst.getTransformMessageForTemplate(...)` directly
   (`:4`, `:105`) — ValueFirst, regardless of `WHATSAPP_PROVIDER`, carrying a standing
   `// TODO: Use channel.sendMessageToUser()`. There is no ValueFirst account on this stack.

Novu owns 100% of outbound. Treat `pgr-status-update-events.js` as dead code scheduled for removal,
not as a fallback.

---

## 6. Point Twilio at the deployment

In the Twilio Console, under **Messaging → Senders → WhatsApp senders → your sender**:

| Field | Value |
|---|---|
| When a message comes in | `https://<your-host>/xstate-chatbot/message` · **HTTP POST** |
| Status callback URL | `https://<your-host>/xstate-chatbot/status` · **HTTP POST** |

Both must be publicly reachable over **HTTPS** — Twilio does not deliver to plain HTTP, and it does
not follow redirects. If the deployment is behind a firewall, use a Twilio-reachable tunnel for
testing, never for production.

> Do not configure this until §2.1 is done. Between publishing the URL and validating the Twilio
> signature, anyone who finds the endpoint can file complaints as any phone number, and S1 makes the
> same host an open proxy to internal APIs.

---

## 7. Wiring sketches

Reference shapes for §2.4. Adapt image tags and ports to your deployment.

**Compose** — `local-setup/docker-compose.egov-digit.yaml`:

```yaml
  xstate-chatbot-db:
    image: egovio/xstate-chatbot-db:nightly-develop
    container_name: xstate-chatbot-db
    profiles: ["chatbot"]
    depends_on:
      pgbouncer: { condition: service_healthy }
    environment:
      DB_URL: jdbc:postgresql://postgres:5432/egov
      SCHEMA_TABLE: xstate_chatbot_schema
      FLYWAY_USER: egov
      FLYWAY_PASSWORD: ${POSTGRES_PASSWORD:-egov123}
      FLYWAY_LOCATIONS: filesystem:/flyway/sql/main
    networks: [egov-network]

  xstate-chatbot:
    image: egovio/xstate-chatbot:nightly-develop
    container_name: xstate-chatbot
    restart: unless-stopped
    profiles: ["chatbot"]
    depends_on:
      xstate-chatbot-db: { condition: service_completed_successfully }
      egov-user:         { condition: service_healthy }
      pgr-services:      { condition: service_healthy }
    environment:
      SERVICE_PORT: '8080'
      CONTEXT_PATH: /xstate-chatbot
      WHATSAPP_PROVIDER: Twilio
      REPO_PROVIDER: Postgres            # NOT the InMemory default
      KAFKA_CONSUMER_ENABLED: 'false'    # see section 5
      ENABLE_SANDBOX_MODE: 'false'       # tenant-management does not exist here
      GEO_SEARCH: ${CHATBOT_GEO_SEARCH:-false}
      ROOT_TENANTID: ${CHATBOT_ROOT_TENANT:-pg.citya}
      SUPPORTED_LOCALES: ${CHATBOT_SUPPORTED_LOCALES:-en_IN}
      WHATSAPP_BUSINESS_NUMBER: ${CHATBOT_WHATSAPP_BUSINESS_NUMBER}
      TWILIO_ACCOUNT_SID: ${TWILIO_ACCOUNT_SID}
      TWILIO_AUTH_TOKEN: ${TWILIO_AUTH_TOKEN}
      TWILIO_WHATSAPP_NUMBER: ${TWILIO_WHATSAPP_FROM}
      EGOV_SERVICES_HOST: http://kong:8000/
      EXTERNAL_HOST: ${CHATBOT_EXTERNAL_HOST}/   # public https origin, from `domain` in host_vars
      USER_SERVICE_HOST: http://kong:8000/
      LOCALIZATION_SERVICE_HOST: http://kong:8000/
      USER_SERVICE_HARDCODED_PASSWORD: ${CITIZEN_OTP_FIXED_VALUE:-123456}
      DB_HOST: pgbouncer
      DB_PORT: '5432'
      DB_NAME: egov
      DB_USER: egov
      DB_PASSWORD: ${POSTGRES_PASSWORD:-egov123}
      KAFKA_BOOTSTRAP_SERVER: redpanda:9092
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8080/xstate-chatbot/health >/dev/null 2>&1 || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 30s
    networks: [egov-network]
```

**Kong** — `local-setup/kong/kong.yml`:

```yaml
- name: xstate-chatbot
  url: http://xstate-chatbot:8080
  tags:
  - chatbot
  routes:
  - name: xstate-chatbot-route
    paths:
    - /xstate-chatbot
    strip_path: false
```

Kong carries no global auth plugin, so the webhook is reachable without a DIGIT token — which is
what Twilio needs, and precisely why S2 must be fixed first.

**Gatus** — `local-setup/gatus/config.yaml`:

```yaml
  - name: XState Chatbot
    group: Chatbot
    enabled: ${GATUS_PROFILE_CHATBOT}
    url: "http://xstate-chatbot:8080/xstate-chatbot/health"
    interval: 30s
    conditions:
      - "[STATUS] == 200"
    alerts:
      - type: slack
```

Add `GATUS_PROFILE_CHATBOT={{ enable_chatbot | default(false) | lower }}` to
`local-setup/ansible/templates/digit.env.j2` and `GATUS_PROFILE_CHATBOT: "false"` to the other
compose files that set the sibling `GATUS_PROFILE_*` keys, or `gatus-coverage` CI fails.

**Ansible** — in `playbook-deploy.yml`, alongside the existing profile lines:

```yaml
              + (['chatbot']       if enable_chatbot       | default(false) else [])
```

---

## 8. Verify

Work outwards. Each step isolates one layer.

### 8.0 Dry-run the dialog with no Twilio account

`channel/index.js:5-15` selects the provider by exact match on `WHATSAPP_PROVIDER` — `ValueFirst`,
`Kaleyra`, `Twilio` — and **falls through to the console provider for any other value**. The console
provider prints the bot's replies to stdout instead of sending them (`channel/console.js`), so the
whole dialog can be walked locally with no Twilio account, no sender and no public URL.

```bash
cd backend/xstate-chatbot/nodejs
npm install

export WHATSAPP_PROVIDER=Console      # any non-provider value works
export ENABLE_SANDBOX_MODE=false
export REPO_PROVIDER=InMemory         # fine for a throwaway dry run
export ROOT_TENANTID=pg.citya
export EGOV_SERVICES_HOST=https://<your-host>/
export USER_SERVICE_HOST=https://<your-host>/
export LOCALIZATION_SERVICE_HOST=https://<your-host>/
export GEO_SEARCH=false
export KAFKA_CONSUMER_ENABLED=false

npm start
```

Drive it with the console message shape (`channel/console.js`), not the Twilio form shape:

```bash
curl -fsS -X POST http://localhost:8082/xstate-chatbot/message \
  -H 'Content-Type: application/json' \
  -d '{"message":{"type":"text","input":"Hi"},
       "user":{"mobileNumber":"9876543210"},
       "extraInfo":{"whatsAppBusinessNumber":"14155238886"}}'
```

Replies appear in the server's stdout. Ready-made request bodies:
`backend/xstate-chatbot/nodejs/XState-Chatbot-Console.postman_collection.json`.

This is the cheapest way to confirm that complaint types, cities and localities resolve for a tenant
before committing to any deployment wiring — most first-run failures in §9 surface here.

The machine-level tests need no backend at all (they stub every service):

```bash
cd backend/xstate-chatbot/nodejs && npm test    # 10 cases
```

### 8.1 The deployed path

**1 — the service is up**

```bash
sudo docker compose ps xstate-chatbot
curl -fsS http://127.0.0.1:18000/xstate-chatbot/health
```

**2 — the dialog responds, without Twilio**

Replays what Twilio posts. Use a number valid for the tenant's mobile rule.

```bash
curl -fsS -X POST http://127.0.0.1:18000/xstate-chatbot/message \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'From=whatsapp:+919876543210' \
  --data-urlencode 'To=whatsapp:+14155238886' \
  --data-urlencode 'Body=Hi'

sudo docker logs --tail 50 xstate-chatbot
```

Expect the citizen to be resolved or created in egov-user and a reply attempted. A Twilio error at
this point is fine — the dialog reached the send step, which is what this proves.

**3 — session state persists**

```bash
sudo docker exec -it postgres psql -U egov -d egov \
  -c "SELECT user_id, active, session_id FROM eg_chat_state_v2 ORDER BY id DESC LIMIT 5;"
```

Empty after step 2 means `REPO_PROVIDER` is still `InMemory`.

**4 — end to end from a handset**

Message the sender `Hi`, then walk the menu to submit a complaint.

```bash
sudo docker exec -it postgres psql -U egov -d egov \
  -c "SELECT servicerequestid, servicecode, source, applicationstatus
      FROM eg_pgr_service_v2 WHERE source = 'whatsapp'
      ORDER BY createdtime DESC LIMIT 5;"
```

**5 — both directions**

Resolve that complaint in digit-ui. The citizen should receive the outbound WhatsApp message via
Novu; confirm in **Notifications → Logs** or `nb_dispatch_log`. That is bidirectional: inbound
created the complaint, outbound reported on it.

Replying to that message starts a **new** session rather than continuing the complaint thread.
That is current behaviour, not a fault.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Twilio shows `11200 HTTP retrieval failure` | webhook not publicly reachable over HTTPS, or Kong route missing | check the route; Twilio will not follow redirects or accept plain HTTP |
| *"Invalid mobile number format"* | §2.2 — the number is not 10 digits or 12 starting `91` | blocks every non-India tenant |
| Citizen resolution fails on every message | `USER_SERVICE_HARDCODED_PASSWORD` ≠ egov-user's `CITIZEN_LOGIN_PASSWORD_OTP_FIXED_VALUE` | align the two |
| Dialog restarts after every message | `REPO_PROVIDER` is `InMemory` | set it to `Postgres` |
| Complaint-type list empty | `RAINMAKER-PGR.ComplaintHierarchy` not seeded for the tenant, or no active leaf rows | seed it |
| City list empty | §2.5 — no `PGR.WHATSAPP` row in `tenant.citymodule` | seed the row |
| Locality list empty | `hierarchyType=ADMIN` does not match the tenant's hierarchy (§2.3), or boundaries unseeded | fix the hierarchy name |
| Location step hangs or errors | `GEO_SEARCH=true` and `nlp-engine` is absent | set `GEO_SEARCH=false` |
| Citizen gets two messages per transition | §5 — the chatbot's Kafka consumer is on | set `KAFKA_CONSUMER_ENABLED=false` |
| `INVALID_SOURCE` from pgr-services | `allowed.source` was overridden | default includes `whatsapp` (`pgr-services/.../application.properties:153`) |

---

## 11. One number, several tenants

`ROOT_TENANTID` is a single fixed value (`env-variables.js:18`), and in non-sandbox mode every
complaint is filed under it (`session-manager.js:302`). **One WhatsApp sender therefore serves
exactly one tenant.** For several tenants today you need several Twilio senders and several
chatbot instances.

Two unmerged designs addressed this; neither is implemented:

- **`ORG_CODE_TENANT_DESIGN.md`** (`git show 2caabc59:backend/xstate-chatbot/ORG_CODE_TENANT_DESIGN.md`)
  — the citizen types an organization code, which resolves the tenant. 400 lines of state-by-state
  design against `seva.js`, `session-manager.js`, `user-service.js` and `pgr.js`.
- **Provider-number → tenant lookup** — the sender number the citizen messaged
  (`context.extraInfo.whatsAppBusinessNumber`, already populated by every channel adapter) is looked
  up to get the tenant list, and the citizen picks from a numbered menu. Never committed.

Sandbox mode is a third variant — it resolves the tenant from the citizen's email via
`tenant-management` — and it is **not usable here**: that service does not exist in CCRS (§4).

If multi-tenant inbound is in scope, treat it as a design task in its own right, not part of
enablement.

---

## 10. Code references

| What | Where |
|---|---|
| HTTP entry point and routes | [`backend/xstate-chatbot/nodejs/src/channel/routes/index.js`](../../../backend/xstate-chatbot/nodejs/src/channel/routes/index.js) |
| Twilio channel adapter | [`backend/xstate-chatbot/nodejs/src/channel/twilio.js`](../../../backend/xstate-chatbot/nodejs/src/channel/twilio.js) |
| Session + citizen resolution | [`backend/xstate-chatbot/nodejs/src/session/session-manager.js`](../../../backend/xstate-chatbot/nodejs/src/session/session-manager.js) |
| Dialog state machine | [`backend/xstate-chatbot/nodejs/src/machine/pgr.js`](../../../backend/xstate-chatbot/nodejs/src/machine/pgr.js) |
| PGR + MDMS + boundary calls | [`backend/xstate-chatbot/nodejs/src/machine/service/egov-pgr.js`](../../../backend/xstate-chatbot/nodejs/src/machine/service/egov-pgr.js) |
| All environment variables | [`backend/xstate-chatbot/nodejs/src/env-variables.js`](../../../backend/xstate-chatbot/nodejs/src/env-variables.js) |
| Session schema | [`backend/xstate-chatbot/nodejs/db/migration/main/V20260505000000__chat.sql`](../../../backend/xstate-chatbot/nodejs/db/migration/main/V20260505000000__chat.sql) |
| Dialog tests (`npm test`, 10 cases) | [`backend/xstate-chatbot/nodejs/test/pgr-flow.test.js`](../../../backend/xstate-chatbot/nodejs/test/pgr-flow.test.js) |
| Console request fixtures | [`backend/xstate-chatbot/nodejs/XState-Chatbot-Console.postman_collection.json`](../../../backend/xstate-chatbot/nodejs/XState-Chatbot-Console.postman_collection.json) |
| Helm chart (stale, unreleased — §2.6) | [`devops/deploy-as-code/charts/core-services/xstate-chatbot/`](../../../devops/deploy-as-code/charts/core-services/xstate-chatbot/) |
| Image build entry | [`build/build-config.yml`](../../../build/build-config.yml) |
