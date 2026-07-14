# Notifications — Configurator Demo Action Plan

A click-by-click script for demoing the **Notifications** feature *at the configurator*.
Read this while driving the screen. Every page description is taken from the source
that renders it (cited per section), so what you say matches what runs.

- **URL:** https://bometfeedbackhub.digit.org/configurator/
- **Mode:** log in **Management** mode
- **Credentials:** `KE_ADMIN` / `eGov@123`
- **Tenant Code:** field is prefilled `ke` — **leave it untouched** and submit (this was recently fixed; submitting with the prefilled value now works).
- After login you land in **Management Studio**. The left nav has a **Notifications** section (source: `configurator/src/admin/DigitLayout.tsx:48-56`) with 7 pages, in order:

  | # | Nav label (exact) | Route | What it is |
  |---|---|---|---|
  | 1 | **Configure** | `/manage/notification-configure` | Per-transition notification authoring on a workflow |
  | 2 | **Notification Routing** | `/manage/notification-routing` | Raw "who gets notified" MDMS master (CRUD) |
  | 3 | **Notification Templates** | `/manage/notification-template` | Raw message-body MDMS master (CRUD) |
  | 4 | **Provider Templates (WhatsApp)** | `/manage/notification-provider-template` | Approved WhatsApp ContentSids MDMS master (CRUD) |
  | 5 | **Notification Logs** | `/manage/notification-log` | Live delivery log (read-only) |
  | 6 | **Notification Providers** | `/manage/notification-provider` | Novu integrations + Verify/Test/Templates |
  | 7 | **User Preferences** | `/manage/notification-preference` | Per-user channel consent (read-only) |

  (Exact labels: `configurator/src/providers/i18nProvider.ts:44-50`.)

**Mental model to open with (one sentence):**
> "Notifications are *config, not code* — two MDMS masters decide **who** gets told and **what** the message says; a Novu bridge does the actual SMS/email sending; and everything that goes out is logged. The configurator lets a non-developer author, validate, test, and audit all of it."

---

## The architecture in 20 seconds (say this once, up front)

```
   Configure tab  ──writes──►  MDMS: NotificationRouting   (WHO: audience × channel per transition)
       │                        MDMS: NotificationTemplate  (WHAT: message body per audience/action/channel/locale)
       │                               │
  PGR workflow event ─────────────────►│  PGR renders + localizes the template, publishes to Kafka
                                        ▼
                                   novu-bridge  ──►  Novu  ──►  Twilio (SMS) / Gmail SMTP (Email)
                                        │
                                        └──►  nb_dispatch_log  ◄── Notification Logs page reads this
```

- **MDMS masters** (config): `RAINMAKER-PGR.NotificationRouting`, `.NotificationTemplate`, `.NotificationProviderTemplate`.
- **novu-bridge proxy** (runtime + read APIs): `/novu-bridge/novu-adapter/v1/{integrations,logs,preferences,providers,providers/templates,providers/verify,providers/test-send}`. It holds the Novu ApiKey server-side (this SPA is keyless), redacts credentials, and masks recipient PII.
- Resource→backing wiring is in `configurator/packages/data-provider/src/providers/resourceRegistry.ts:165-199`.

---

# Page 1 — Configure
*Source: `configurator/src/resources/notification-configure/NotificationConfigure.tsx`*

**What it is.** The headline screen. A per-transition view of one workflow BusinessService (defaults to **PGR**). Each workflow transition (`ACTION → nextState`) becomes a row, and you add/edit/remove notifications on it inline — no JSON, no MDMS spelunking.

**What it does / backing.** It is the friendly front-end over the two masters. Every chip you add **writes to both** `RAINMAKER-PGR.NotificationRouting` *and* `RAINMAKER-PGR.NotificationTemplate` in one action (`saveNotificationPair`, `notificationWritePath.ts`). It **reads** `workflow-business-services` (the state machine), `notification-routing`, `notification-template`, and `access-roles` (to offer valid audiences). The unique keys are derived server-side by egov-mdms-v2 from the flat fields, so a plain create round-trips (see the file header, `NotificationConfigure.tsx:9-21`).
- Routing uid: `businessService.action.toState.audience.channel`
- Template uid: `audience.action.toState.channel.locale`

**Demo steps.**
1. Click **Configure**. Point out the **Business Service** picker — it auto-selects **PGR** (`NotificationConfigure.tsx:567-573`).
2. Scroll the **Transitions** table. Left column = each workflow state (with **Start**/**End** chips + a status chip); right column = its transitions. Each transition shows: `ACTION → toState`, an **actors:** line (the workflow roles that can perform it, e.g. `GRO`, `PGR_LME` — rendered as links), and a **notifications:** line of chips.
3. Point at a populated transition. On this deployment the merged routing shows **APPLY → GRO + CITIZEN** (a new complaint tells both the officer and the filer) and **ASSIGN → PGR_LME** (assignment tells the assignee). Each chip reads `AUDIENCE · CHANNEL` and, if a template body exists, a `·template` marker (`NotificationConfigure.tsx:298-301`).
4. Hover a chip → a **pencil** (edit) and **trash** (remove) appear. Click **pencil** on one to open the inline editor and show the real body text with `{id} {complaint_type} {status}` tokens. **Cancel** out (don't save yet — save it in the e2e section).
5. Click **Validate** (top of the card). A green **All checks passed** / **Passed · N warnings** badge or a red error count appears. Click **Show details** if there are findings. Explain: this is a static cross-check of the two masters against the live state machine (rules R1–R6 below), run in the browser before anything ships.
6. Click **Show business service JSON** to reveal the raw workflow-v2 record, then hide it. Use it to make the point that `action.nextState` is a **state UUID** and the tool resolves it to the `applicationStatus` name so routing matches (`NotificationConfigure.tsx:618-623`).

**The Validate rules (name them if asked)** — `validateNotifications.ts`:
- **R1 audience-role-exists** (error) — audience is CITIZEN, a real workflow role, or in access-roles.
- **R2 routing-has-template** (error) — every active routing row has an active `en_IN` template.
- **R3 channel-allowed** (error) — channel ∈ {SMS, WHATSAPP, EMAIL}.
- **R4 transition-exists** (error) — the `action → toState` is a real workflow transition.
- **R5 no-orphan-template** (warn) — no template without a matching routing row.
- **R6 non-notifiable-audience** (warn) — audiences `AUTO_ESCALATE`/`SYSTEM` never send.

**Talk track.**
> "This is where a county administrator, not an engineer, decides notifications. Each line is a real step in the complaint's life. I pick who to tell and on which channel, type the message once, and the tool writes both the routing rule and the template together — and validates them against the actual workflow before I leave the page. Notice APPLY notifies both the citizen who filed and the ward officer; ASSIGN notifies whoever it lands on."

---

# Page 2 — Notification Routing
*Source: schema descriptor `configurator/src/admin/schemaDescriptors/notification-routing.ts`; generic MDMS CRUD via `MdmsResourcePage/Show/Edit/Create`; registry `resourceRegistry.ts:165`.*

**What it is.** The raw **"who gets notified"** master, `RAINMAKER-PGR.NotificationRouting`, shown as a standard MDMS list/show/edit/create grid. One flat row per `(businessService, action, toState, audience, channel)`. This is the table the Configure tab writes into — here you see and edit it directly.

**What it does / backing.** Full **read + write** against `RAINMAKER-PGR.NotificationRouting` (egov-mdms-v2). Fields (from the descriptor): `businessService`, `fromState` (doc-only — runtime matches on action+toState, leave blank), `action`, `toState`, `audience`, `channel`, `active`. `audience` = `CITIZEN`, any role code (`GRO`, `PGR_LME`, …), or `EMPLOYEE` (legacy = current assignee).

**Demo steps.**
1. Click **Notification Routing**. Show the grid of routing rows — this is the same data as the Configure chips, in table form.
2. Open one row (**Show**) to display the flat fields. Point at `audience` + `channel`.
3. Optional: click **Edit** to show it's a plain form, then **Cancel**. (Explain: the Configure tab is the preferred authoring surface; this is the "under the hood" master for power users.)

**Talk track.**
> "Same data as the Configure chips, but as the raw config master. Every notification rule is one row keyed by business-service, action, target-state, audience and channel. Config, not code — an operator can read exactly why a message did or didn't go out."

---

# Page 3 — Notification Templates
*Source: schema descriptor `configurator/src/admin/schemaDescriptors/notification-template.ts`; generic MDMS CRUD; registry `resourceRegistry.ts:166`.*

**What it is.** The raw **message-body** master, `RAINMAKER-PGR.NotificationTemplate`. One row per `(audience, action, toState, channel, locale)`. This is the "what the message says" half that pairs 1:1 with a routing row.

**What it does / backing.** Full **read + write** against `RAINMAKER-PGR.NotificationTemplate`. Fields: `audience`, `action`, `toState`, `channel`, `locale` (e.g. `en_IN`, `sw_KE`), `subject` (EMAIL only), `body`, `placeholders`, `active`. PGR renders and localizes these **before** publishing to Kafka.

**Demo steps.**
1. Click **Notification Templates**. Show the grid.
2. Open a row (**Show**) and read the **body** — call out the tokens: `{id} {complaint_type} {emp_name} {ulb} {status} {date} {download_link} {rating} {additional_comments}` (`notification-template.ts:24`).
3. Make the localization point: the `locale` field is what lets the same notification exist in `en_IN` and `sw_KE`; PGR picks the recipient's locale at send time.

**Talk track.**
> "The routing rule says *who and which channel*; the template says *what it reads*. Same key minus the locale, plus a locale — so one rule can carry English and Swahili copy, and the platform localizes per recipient before it ever hits Kafka."

---

# Page 4 — Provider Templates (WhatsApp)
*Source: generic MDMS CRUD driven by MDMS schema; registry `resourceRegistry.ts:167-171` (`schema: RAINMAKER-PGR.NotificationProviderTemplate`, `nameField: templateName`).*

**What it is.** The **approved WhatsApp ContentSid** registry, `RAINMAKER-PGR.NotificationProviderTemplate`. WhatsApp (unlike SMS/email) can only send **pre-approved** templates identified by a Twilio **ContentSid**; this master maps `(provider, channel, key, locale)` → an approved ContentSid + its ordered variables + an approval status.

**What it does / backing.** Full **read + write** against `RAINMAKER-PGR.NotificationProviderTemplate`. Each row carries a `locale` and an `approvalStatus`, so an operator can see which provider templates are approved and sendable (`resourceRegistry.ts:167-171`). This is the WhatsApp counterpart to the free-text Notification Templates — WhatsApp bodies are **not** free text.

**Demo steps.**
1. Click **Provider Templates (WhatsApp)**. Show the grid (may be sparse on this deployment — that's expected; WhatsApp isn't wired for live send here).
2. Point out the columns that matter: the **ContentSid**, the **variables**, and **approvalStatus**.
3. Tie it back: on **Notification Providers → Test → WhatsApp**, and in the **Novu Workflows** dialog's amber note, the tool tells operators "approved WhatsApp ContentSids live *here*" (`NotificationProviderList.tsx:383-388, 538-542`).

**Talk track.**
> "WhatsApp is special — you can't send arbitrary text, only Meta/Twilio-approved templates keyed by a ContentSid. This master is the county's registry of those approved templates and their variables, per locale. It's why WhatsApp is a separate screen from the free-text SMS/email templates."

> ⚠️ Do **not** attempt a live WhatsApp send in the demo — there is no paired sender on this box (see caveats).

---

# Page 5 — Notification Logs
*Source: `configurator/src/resources/notification-logs/NotificationLogList.tsx`; backing `GET /novu-bridge/novu-adapter/v1/logs` (`resourceRegistry.ts:178-182`).*

**What it is.** The **live delivery audit** — every notification novu-bridge processed, newest first, each with an explicit terminal status. This is the "did it actually send?" screen. 590+ rows on this deployment.

**What it does / backing.** **Read-only** proxy fetch of `nb_dispatch_log` via novu-bridge. Columns (`NotificationLogList.tsx:56-126`): Created time, **Complaint** (links to the complaint), **Channel**, **Status**, **Recipient** (masked), **Template** (`templateKey` + version), **Attempts**, **Error** (`lastErrorCode: lastErrorMessage`). Recipients are masked client-side *and* server-side; `providerResponse` PII is masked in the bridge.

**Demo steps.**
1. Click **Notification Logs**. Point out the volume (hundreds of rows) — proof the pipeline is live, not a mock.
2. Use the **Complaint #** filter (type a reference number) — it's the real server-side search (`alwaysOn`, `NotificationLogList.tsx:35`).
3. Use the **Channel** filter → **SMS**: these show **SENT** with a masked phone (`***123`) and a `templateKey`.
4. Use the **Channel** filter → **WhatsApp**: these show **SKIPPED** with error **NB_NO_PROVIDER** — explain this is *honest*: WhatsApp events are recorded, not silently dropped, because no WhatsApp provider is enabled yet (`NotificationLogList.tsx:11-19, 128-134`).
5. Point at the masked **Recipient** column (`m***@domain`, `***123`) — PII never renders in full.

**Talk track.**
> "This is the receipt drawer. Every message the platform tried to send is here with a hard status — SENT, SKIPPED, FAILED — the recipient masked for privacy, the template it used, and any provider error. SMS is going out through Twilio; WhatsApp shows as SKIPPED / NB_NO_PROVIDER because we haven't paired a WhatsApp sender — nothing is hidden."

---

# Page 6 — Notification Providers
*Source: `configurator/src/resources/notification-providers/NotificationProviderList.tsx` + `providerApi.ts`; backing `/novu-bridge/novu-adapter/v1/{integrations,providers,providers/verify,providers/test-send,providers/templates}` (`resourceRegistry.ts:183-186`).*

**What it is.** The **channel connections** screen — the Novu integrations that actually deliver messages (Twilio for SMS/WhatsApp, Gmail SMTP for email), plus self-service **Add / Verify / Test / Templates** actions.

**What it does / backing.** **Reads** integrations from novu-bridge (credentials redacted to `***` server-side). Row actions map to bridge POSTs: **Verify** → `/providers/verify`, **Test** → `/providers/test-send`, **Templates** → `/providers/templates`; **Add Provider** → `POST /providers`. Credentials live only in the dialog's local state and are sent once on submit — never stored or echoed (`NotificationProviderList.tsx:80-84, 647-655`). Columns: Channel, Provider ID, Name, Active, Primary. **No Credentials column** (removed) and WhatsApp rows render without collapsing into SMS (`rowChannel`, `providerApi.ts:177-191`).

**Demo steps.**
1. Click **Notification Providers**. On this deployment you should see **Twilio (SMS)** and **Gmail SMTP (Email)** rows, both **Active**.
2. On the SMS row, click **Verify** → an inline green **Verified** badge appears (calls `/providers/verify`). Do the same on Email.
3. Click **Templates** on the **SMS** row → the **"Novu Workflows"** dialog opens and **fetches on open**, **channel-filtered**: SMS shows the `complaints-sms` workflow; each row carries a channel badge (`NotificationProviderList.tsx:438-473, 517-535`). Copy a workflow ID with the **Copy** button to show it round-trips. Read the amber note: WhatsApp ContentSids live on the Provider Templates screen, and SMS/email *text* lives under Notification Templates — this dialog is Novu **delivery workflows**, not message text.
4. Click **Templates** on the **Email** row → show the filter changes to email workflows (proves the channel filter is real, not cosmetic).
5. Optional but safe: click **Test** on the SMS row to open the **Send Test Message** dialog. Point out the channel selector, recipient, body, and the **View Notification Logs** shortcut link (`NotificationProviderList.tsx:411-419`). If you want a live send, use an **owner-authorized** phone only — each test is logged. Then jump to Notification Logs to show the row land.
6. Optional: click **Add Provider** to show the dialog (channel → provider ID → name → per-provider credential fields; the hint says credentials go straight to Novu over TLS and aren't stored). **Cancel** without saving.

**Talk track.**
> "These are the actual pipes. Twilio carries SMS, Gmail SMTP carries email, both live and verifiable from this screen — Verify pings Novu and comes back green. Templates shows the Novu delivery workflows for *that* channel — notice SMS and email give different lists. Credentials are never shown; the bridge redacts them and holds the API key server-side. I can even fire a test message and watch it appear in the logs."

*(Previously the Templates dialog was mislabeled and never loaded, and the list had a Credentials column and collapsed WhatsApp rows — all fixed; what you see now is the corrected behavior.)*

---

# Page 7 — User Preferences
*Source: `configurator/src/resources/notification-preferences/NotificationPreferenceList.tsx`; backing `GET /novu-bridge/novu-adapter/v1/preferences` (`resourceRegistry.ts:195-199`).*

**What it is.** **Per-user consent**, read-only. One row per user: their per-channel consent (WhatsApp / SMS / Email as **GRANTED**/**REVOKED**) and preferred language.

**What it does / backing.** **Read-only** proxy fetch of preferences, **tenant-scoped** (omitting the tenant would leak cross-tenant rows, so the screen always scopes to the session tenant). No create/edit/delete — consent is owned by the citizen, surfaced here for audit (`NotificationPreferenceList.tsx:54-71`).

**Demo steps.**
1. Click **User Preferences**. Show the grid: **User**, **Preferred Language**, **WhatsApp**, **SMS**, **Email** consent chips (a `--` means no recorded consent for that channel).
2. Make the governance point: this is the consent ledger. In a consent-enforcing deployment, a REVOKED channel here suppresses that user's messages.

**Talk track.**
> "Consent is the citizen's, not ours. This read-only ledger shows, per user, which channels they've allowed and their language. When the consent gate is enforced, a REVOKED channel here means we simply don't send on it."

> ℹ️ On this deployment the **consent gate is OFF at runtime** — messages send regardless of what's shown here. Say this if asked why SMS still sends; don't dwell on it.

---

# End-to-end demo — author → (drive) → observe → deliver

Goal: show a notification going from **authored config** to **live delivery + audit** without leaving the tools. ~5–7 minutes.

**Logins needed:** `KE_ADMIN` / `eGov@123` (configurator) for authoring/observing. *Optional* a citizen login on the PGR portal only if you choose to file a real complaint (Variant A). The no-file variant (B) needs only `KE_ADMIN`.

### Sequence

1. **Author (Configure tab).** `/manage/notification-configure` → PGR auto-selected.
   - Find a transition with **no** citizen SMS yet (or use a low-traffic one). Click **Add** on that transition.
   - In the inline form: **Audience** = `CITIZEN`, **Channel** = `SMS`, **Body** = `Demo: your complaint {id} is now {status}.` → **Save**.
   - This one action writes **both** a `NotificationRouting` row and a `NotificationTemplate` row (`saveNotificationPair`). A green "Notification added" toast confirms.
2. **Prove the write took (Routing + Templates pages).**
   - `/manage/notification-routing` → the new `CITIZEN · SMS` row for that action/toState is present.
   - `/manage/notification-template` → the paired `en_IN` body row is present with your text.
3. **Validate.** Back on **Configure** → **Validate** → green **All checks passed** (R2 now satisfied because routing has its template). If you deliberately deleted the template you'd see a red `routing-has-template` — a nice "the tool catches mistakes" beat.
4. **Trigger a dispatch** — pick one:
   - **Variant A (live, more impressive):** on the citizen PGR portal, file a complaint (or advance one) through the transition you configured. This causes PGR to render your template and hand it to novu-bridge.
   - **Variant B (no complaint filing):** go to **Notification Providers → Test** on the SMS row and send one test message to an **owner-authorized** phone. This exercises the exact same delivery path (novu-bridge → Novu → Twilio → dispatch log) without needing a citizen login.
5. **Observe delivery (Notification Logs).** `/manage/notification-log` → newest row on top:
   - Variant A: a **SMS / SENT** row linked to your complaint number, with the masked recipient and your `templateKey`.
   - Variant B: a **SMS / SENT** row for the test recipient.
   - Filter by **Channel = SMS** if the list is busy.
6. **Show the delivery machinery (Notification Providers).** Same page → **Verify** the SMS provider (green), then **Templates** → the channel-filtered **Novu Workflows** dialog (`complaints-sms` for SMS; switch to the Email row to prove the filter). This closes the loop: *config authored → provider connected → message delivered → audited.*

### One-line narration of the loop
> "I authored *who* and *what* on one screen, the tool validated it against the real workflow and wrote both masters, a complaint (or a test) fired it, Twilio delivered it, and it's now a SENT line in the audit log — all without touching code or a database."

---

## Pre-demo checklist

- [ ] Browser open to https://bometfeedbackhub.digit.org/configurator/ , **Management** mode.
- [ ] Logged in as `KE_ADMIN` / `eGov@123`, **Tenant Code left as prefilled `ke`**, submit works.
- [ ] Left nav shows the **Notifications** section with all 7 pages.
- [ ] **Notification Providers** shows **Twilio (SMS)** + **Gmail SMTP (Email)**, both **Active**; **Verify** returns green on both.
- [ ] **Notification Logs** loads with hundreds of rows (SMS→SENT, WhatsApp→SKIPPED/NB_NO_PROVIDER).
- [ ] **Configure** auto-selects **PGR** and renders transitions with real state names + chips.
- [ ] If doing a **live test send**, have an **owner-authorized** phone number ready (tests are logged).
- [ ] Know your caveats (below) before someone asks.

### Caveats to state proactively
- **WhatsApp live delivery is out of scope** — there's no paired baileys/QR sender on this box, so WhatsApp events show as **SKIPPED / NB_NO_PROVIDER** in the logs. The *config* surfaces (Provider Templates, WhatsApp option in Test) exist and are real; delivery isn't wired.
- **Consent gate is OFF at runtime** — User Preferences is a real read-only ledger, but messages currently send regardless of the consent shown there.
- Channel gate on this deployment is **SMS, EMAIL** only.

---

## 5-minute highlight reel (ordering)

1. **Configure** (2 min) — the transitions table, the APPLY→GRO+CITIZEN / ASSIGN→PGR_LME chips, edit a chip to show real body text, click **Validate** → green. *This is the money screen.*
2. **Notification Logs** (1.5 min) — hundreds of live rows; filter SMS→SENT with masked recipient; show WhatsApp→SKIPPED as "honest, not hidden."
3. **Notification Providers** (1 min) — **Verify** SMS goes green; **Templates** opens the channel-filtered **Novu Workflows** dialog (SMS vs Email lists differ).
4. **One sentence each** on Routing + Templates (the two masters Configure writes) and User Preferences (the consent ledger). *Don't full-tour these under time pressure.*

---

## Do NOT demo live
- **WhatsApp delivery** — no QR/baileys pairing on this deployment; it will show SKIPPED. Show the *config* (Provider Templates), not a send.
- **Escalation notifications** — there are **no escalation routing rules** on this deployment, so don't promise an auto-escalation SMS; the escalation *engine* is a separate feature.
- **A test send to a random/unowned number** — only use owner-authorized recipients; every test is logged and PII-visible to whoever reads that phone.
- **Editing/deleting production routing rows** on the raw Routing/Templates pages during the demo — author on the **Configure** tab where the pair is written together and validated.

---

### Source index (for anyone who asks "where is this in the code")
| Page | Primary source |
|---|---|
| Configure | `configurator/src/resources/notification-configure/NotificationConfigure.tsx`, `notificationWritePath.ts`, `workflow-services/validateNotifications.ts` |
| Notification Routing | `configurator/src/admin/schemaDescriptors/notification-routing.ts` |
| Notification Templates | `configurator/src/admin/schemaDescriptors/notification-template.ts` |
| Provider Templates (WhatsApp) | registry `configurator/packages/data-provider/src/providers/resourceRegistry.ts:167-171` |
| Notification Logs | `configurator/src/resources/notification-logs/NotificationLogList.tsx` |
| Notification Providers | `configurator/src/resources/notification-providers/NotificationProviderList.tsx`, `providerApi.ts` |
| User Preferences | `configurator/src/resources/notification-preferences/NotificationPreferenceList.tsx` |
| Backing wiring | `configurator/packages/data-provider/src/providers/resourceRegistry.ts:165-199` |
| Nav + labels | `configurator/src/admin/DigitLayout.tsx:48-56`, `configurator/src/providers/i18nProvider.ts:44-50` |
