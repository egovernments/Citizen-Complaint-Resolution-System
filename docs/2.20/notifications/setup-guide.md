# Setting up and running notifications

The operator guide: from nothing to a delivered SMS, WhatsApp or email, then day-to-day
operation and troubleshooting. Section 2 needs server access; everything else is in the
Configurator under **Notifications**.

Upgrading a 2.12 deployment? Read [migration.md](./migration.md) first.

| Step | What you do | Where |
|---|---|---|
| [1](#1-before-you-start) | Collect accounts and roles | — |
| [2](#2-turn-the-stack-on) | Deploy the notification stack | Server |
| [3](#3-add-a-provider) | Add a provider and its credentials | Providers |
| [4](#4-switch-the-channel-on) | Select the provider for a channel and switch it on | Channels |
| [5](#5-configure-what-is-sent) | Review events, routing, templates; validate | Configure |
| [6](#6-send-a-test-and-read-the-logs) | Send a test, read the result | Providers, Logs |
| [7](#7-going-live-and-troubleshooting) | Checklist and troubleshooting | — |
| [8](#8-deployment-reference) | Deployment settings, receipts, per-channel server steps | Server |

## 1. Before you start

**Accounts, per channel.** Channels are independent; set up one, two or all three.

| Channel | You need |
|---|---|
| SMS | An account with Twilio, SMSCountry (legacy bulk API, panel login), or an Ozeki gateway you run. India: DLT-registered templates ([§8.4](#84-sms-india-dlt-registration)). |
| WhatsApp | A Twilio account with a WhatsApp-enabled sender **and Meta-approved message templates**. Nothing sends without them — start approval early. |
| Email | An SMTP mailbox. Gmail / Microsoft 365 need an **app password**, not the account password. |

**SMS also carries login OTPs.** With `enable_otp_services: true` (which requires
`enable_novu: true`; the deploy refuses otherwise), login OTPs go through the same SMS
channel, provider and log. Switching SMS off stops OTP login (rows read
`SKIPPED / NB_NO_PROVIDER`, event name `CORE.SMS.OTP`); changing the SMS provider changes
who sends OTPs.

**Roles.** Two tiers, set at deploy time:

| To | You need a role from | Default |
|---|---|---|
| Use the screens: logs, providers, preferences; **Check status** | `novu_bridge_proxy_allowed_roles` | `EMPLOYEE,SUPERUSER,GRO,PGR_LME,MDMS_ADMIN` |
| Create a provider, rotate its credentials, disable or delete it, **Test** it; `POST /dispatch/_resolve`, `/dispatch/_dry-run` | `novu_bridge_proxy_admin_roles`, **held at the state tenant** | `SUPERUSER,MDMS_ADMIN,ACCOUNT_ADMIN` |

Without an admin role at a state tenant those calls answer `403 NB_ADMIN_ROLE_REQUIRED`: a
provider serves the whole deployment, so an admin role held only at a city (`ke.bomet`) does not
count. An admin role also satisfies the first tier. Logs and the config-source report answer only
for your own tenant — for a user at the state tenant, the state and its cities — and
`403 NB_TENANT_NOT_ALLOWED` for any other. Editing Channels / Routing / Templates / Provider Templates is
governed by the ordinary MDMS roles (`MDMS_ADMIN`, `ACCOUNT_ADMIN`, `SUPERUSER`).

## 2. Turn the stack on

1. In `local-setup/ansible/inventory/host_vars/mycity.yml` set `enable_novu: true`
   (`seed_notifications` follows it). Other settings: [§8.1](#81-deployment-settings).
2. Deploy and wait for `failed=0`:
   ```bash
   cd local-setup/ansible
   ./deploy.sh mycity
   ```
3. Verify the Novu API key — a green recap is not enough, the provider bootstrap may fail
   without failing the deploy:
   ```bash
   export NOVU_BASE_URL='http://127.0.0.1:14002'
   export NOVU_API_KEY="$(sudo sed -n 's/^NOVU_API_KEY=//p' /opt/digit/.env | tail -1)"
   test -n "$NOVU_API_KEY" && test "$NOVU_API_KEY" != changeme
   curl -fsS -H "Authorization: ApiKey $NOVU_API_KEY" "$NOVU_BASE_URL/v1/integrations" >/dev/null
   ```
   Stop if any command fails: every provider operation goes through `novu-bridge`, which
   cannot work with an empty, placeholder or invalid key.

The deploy starts novu-bridge, Novu and digit-user-preferences-service; mints the Novu API
key into `/opt/digit/.env`; creates the Novu workflows `complaints-sms`,
`complaints-whatsapp`, `complaints-email`; creates the Kafka topics
([kafka-events.md](./kafka-events.md)); grants the access-control actions (restarting
`egov-accesscontrol` when it added any; a role the tenant does not have gets no grant and is
listed as `ACL-ROLES-ABSENT`, which is not a failure) and then seeds the `NOTIFICATIONS.*`
masters. A tenant
with no channel rows gets one row per channel, **on only if `novu_bridge_channels_enabled` lists
it** (unset: all three off) and with no provider selected; a tenant that has rows keeps them
([migration.md](./migration.md#channel-rows-what-happens-to-an-existing-tenant)). It also syncs `local-setup/kong/kong.yml`; if you edit
that file by hand, apply it with `sudo docker exec kong-gateway kong reload`.

> Never set `NOVU_BRIDGE_PROXY_AUTH_ENABLED=false` on a reachable deployment: Kong delegates
> authentication for these routes to novu-bridge, so provider creation and test-send become
> unauthenticated ([#1942](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1942)).

## 3. Add a provider

**Notifications → Providers → Add Provider**: pick the type, give a name, fill the
credential fields, **Create Provider**.

| Type | Channel | Fields |
|---|---|---|
| Twilio SMS | SMS | Account SID (`AC…`), Auth token, From number (E.164, e.g. `+14155238886`) |
| Twilio WhatsApp | WHATSAPP | Account SID, Auth token, WhatsApp sender (`whatsapp:+14155238886`; the sandbox number works after `join <code>` from your handset) |
| Email (SMTP) | EMAIL | SMTP host, SMTP port (`587`), Username, Password (app password), From address (usually = username), From name, Use TLS on connect (port 465) |
| SMSCountry | SMS | Panel username, Panel password, Registered sender id, Gateway URL (blank = standard bulk endpoint). Legacy bulk API only; a panel showing AuthKey/AuthToken is the unsupported REST API. A Gateway URL on any other host (a mock, a regional endpoint) must be listed in `novu_bridge_smscountry_allowed_hosts` ([§8.1](#81-deployment-settings)): otherwise saving is refused (`NB_ADAPTER_URL_NOT_ALLOWED`), and a provider saved earlier with such a URL fails every send rather than posting these credentials to the standard endpoint |
| Ozeki SMS Gateway | SMS | HTTP API URL (e.g. `https://ozeki.example.org:9509/api?action=sendmessage`), Username, Password, Sender id (optional) |

Email traps:

- Gmail / Microsoft 365 with 2FA reject the account password with
  `535-5.7.8 Username and Password not accepted`. Use a 16-character app password.
- **Use TLS on connect** means TLS from the first byte: tick it for port **465**, leave it
  unticked for **587** (STARTTLS). Ticked with 587 hangs or fails the handshake.

Credentials are stored **only in Novu**: never in MDMS, `/opt/digit/.env` or logs, and never
returned to the browser.

Row actions on the Providers list:

| Action | What it does |
|---|---|
| **Check status** | Confirms the integration exists and is enabled. Proves **no** credential for any type. |
| **Test** | Sends one real message (see [§6](#6-send-a-test-and-read-the-logs)). The only credential proof. Admin role at the state tenant. |
| **Rotate credentials** | Asks for every field again — the store overwrites, it does not merge. |
| **Rename** | Display name only. |
| **Disable** / **Enable** | Switches the Novu integration off/on. **Disable** is guarded like **Delete**. |
| **Delete** | Refused with `409 NB_PROVIDER_IN_USE` while a channel still selects it (checked in MDMS at that moment, for your state and every state this deployment has sent for), and also when those channel rows cannot be read — nothing is deleted; try again. Point the channel elsewhere first. |
| **Delivery workflows** | Read-only list of Novu workflows for the channel — plumbing, not message text. |

The page also has **Sync WhatsApp templates** ([§5.5](#55-whatsapp-provider-templates)).
How the types work and how to add a new one: [providers.md](./providers.md).

## 4. Switch the channel on

**Notifications → Channels** (MDMS `NOTIFICATIONS.Channel`, one row per SMS / WHATSAPP /
EMAIL, held at the **state** tenant). Select the provider and use **Enable** / **Disable**.
Only providers of that channel are offered. Changes apply within about a minute (60 s cache).

- **One provider per channel, per state.** Selecting another replaces it. No fan-out, no
  failover, no per-city provider.
- You must be logged in at the state tenant; scoped to a city, Enable/Disable are disabled
  ("You are scoped to … switch to the state tenant to change channel policy").
- A channel with no provider selected falls back to the deployment's env settings
  ([§8.1](#81-deployment-settings)); Validate flags it (`channel-needs-provider`).

Status card messages:

| It says | Do this |
|---|---|
| "… is on and delivering through *Name*" | Nothing. |
| "No channel policy row for …" | Switch the channel on so the choice is explicit. |
| "… is off. Every event on this channel is recorded SKIPPED / NB_NO_PROVIDER …" | Switch on once its provider exists. |
| "… is on but no provider is configured for it." | [Add a provider](#3-add-a-provider). |
| "… is on but no provider is selected." | Select one. |
| "… selected provider *Name* no longer exists / is disabled / does not serve …" | Re-enable it or select another. Meanwhile every message is `SKIPPED / NB_PROVIDER_UNAVAILABLE` (never a false `SENT`). |
| "… the Novu workflow complaints-… is missing" | Deployment job: re-run `./deploy.sh`. |

## 5. Configure what is sent

A message goes out only when channel, routing, template and provider all line up; anything
missing becomes a `SKIPPED` row on Logs with the reason.

| Screen | Holds | Stored in |
|---|---|---|
| Providers | Gateway accounts and credentials | Novu |
| Channels | On/off and selected provider per channel | `NOTIFICATIONS.Channel` |
| Configure | Guided editor: pick a **Module**, edit routing + templates per event, **Validate**; OTP wording ([§5.6](#56-changing-the-otp-wording)) | — (OTP wording: localization) |
| Events | Events, their actors, placeholders and allowed channels. **Read-only** | `NOTIFICATIONS.EventCatalogue` |
| Templates | Message text per event × audience × channel × locale | `NOTIFICATIONS.Template` |
| Routing | Who is told, per event × audience × channel | `NOTIFICATIONS.Routing` |
| Provider Templates (WhatsApp) | Approved WhatsApp template per routing key | `NOTIFICATIONS.ProviderTemplate` |
| Logs | Every attempt and its outcome | `nb_dispatch_log` |
| User Preferences | Each user's language and per-channel consent (read-only) | digit-user-preferences-service |

Use **Configure** day to day; it edits a routing row and its templates together. The masters
live at the state tenant. Legacy `RAINMAKER-PGR.Notification*` masters appear read-only under
**Advanced** as "Legacy (PGR) …"; a tenant not yet copied shows the banner *"This tenant has not
been migrated yet — shown read-only"* — see [migration.md](./migration.md). The Configurator
decides which namespace is live exactly as novu-bridge does: routing and templates from whether
the tenant has any `NOTIFICATIONS.Routing` row (active or not), channel policy from whether it
has channel rows. While a tenant is on its legacy masters, creating a raw
`NOTIFICATIONS.Routing` or `NOTIFICATIONS.Channel` row is refused (`namespace-switch`, below).

Shipped defaults for complaints: 14 events, 24 routing rows (citizen on SMS/WhatsApp/email for
APPLY, ASSIGN, REASSIGN, REJECT, RESOLVE, REOPEN; assignee on all three when assigned and when
rated), 42 templates (24 `en_IN` + 18 `hi_IN`), 14 WhatsApp provider templates (7 events ×
`en_IN`/`hi_IN`, **belonging to the reference demo Twilio account — they will not work on
yours**), 3 channel rows (off, unless `novu_bridge_channels_enabled` listed the channel when the
tenant was seeded).

### 5.1 Events

Events are declared by the producing module (PGR's are generated from its workflow), named
like `COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME`. The Events screen is the authority for which
actor names an audience may use and which `{tokens}` a template may use. You cannot create
events here.

### 5.2 Routing and audiences

One row per *(event, audience, channel)*: "when **X** happens, tell **audience** by **channel**".

| Audience (Kind on Configure) | Stored as | Means |
|---|---|---|
| Actor on the event | `ACTOR:<name>` | A person the event names; complaints carry `citizen` and `assignee` |
| Everyone with a role | `ROLE:<code>` | Every holder of the role in the tenant |
| Contacts on the event | `EVENT_RECIPIENTS` | Contacts carried on the event (account-less, e.g. OTP) |
| fallback chain | `A\|B` | Try A; if it names nobody, try B. Added with **+ add a fallback …**, shown as *or, if empty:* |

`AUTO_ESCALATE` and `SYSTEM` are dropped (not people). Legacy bare names still work:
`CITIZEN` = `ACTOR:citizen`, `EMPLOYEE` = `ACTOR:assignee`. A person reached through two
audiences gets one message per channel.

### 5.3 Templates and placeholders

One template per *(event, audience, channel, locale)*. A routing row without a template sends
nothing (`NB_NO_TEMPLATE`). **Every routing row needs an `en_IN` template** — it is the fallback
for recipients whose language has none.

- SMS: body only. 160 GSM-7 characters per segment (153 when split); one non-GSM character
  (curly quote, em dash, Devanagari, accented letters) switches the whole message to UCS-2:
  70 per segment (67 when split).
- Email: subject + body; a blank subject becomes `Complaint <id>`.
- WhatsApp: the body is **not** sent — see [§5.5](#55-whatsapp-provider-templates).

Placeholders use **single braces**: `{id}`. `{{id}}` and `{ id }` are sent literally. A
placeholder with no value is delivered **as its braces** (`{emp_name}`), except
`{download_link}`, which is blanked. On WhatsApp a missing value is an empty string.

Complaint placeholders:

| Placeholder | Becomes | Empty when |
|---|---|---|
| `{id}` | Complaint number | never |
| `{complaint_type}` | Category, translated where possible | never |
| `{status}` | Current status, translated | before the first transition |
| `{date}` | Filing date, `dd/MM/yyyy` | never |
| `{additional_comments}` | Employee's comment on this action | no comment |
| `{rating}` | Citizen's rating 1–5 | not rated yet |
| `{citizen_name}` | Filer's name | filed without a name |
| `{download_link}` | Short app link | shortener unavailable |
| `{ulb}` | City / district, translated | no district on the address |
| `{ao_designation}` | Assigning officer's designation label | label not translated |
| `{emp_name}` / `{emp_department}` / `{emp_designation}` | Current assignee's name / department / designation | not assigned yet (e.g. APPLY) |

Values are resolved once per event in one locale; the template text is chosen per recipient.
Recipients get their profile's `preferredLanguage` where a template exists, else `en_IN`.

### 5.4 Validation rules

**Configure → Validate** answers **All checks passed**, **Passed · N warning(s)** or
**N error(s)**; **Show details** lists findings by rule id. Every save runs the same check on
the configuration as it would be after the save: errors your change causes block it (*"This
change cannot be saved until the following is fixed:"*); warnings and pre-existing errors on
other rows do not. Removing the last template of an active routing row is refused.

| Rule | Level | Meaning → fix |
|---|---|---|
| `audience-role-exists` | error | Actor not declared by the event, or role code unknown → use one the Events screen lists / an existing role |
| `audience-scheme` | error | Unknown audience scheme (`NB_UNKNOWN_AUDIENCE_SCHEME`) → use `ACTOR:`, `ROLE:`, `EVENT_RECIPIENTS` or a chain |
| `routing-has-template` | error | Active routing row has no active `en_IN` template → add it or deactivate the row |
| `channel-allowed` | error | Channel not SMS / WHATSAPP / EMAIL |
| `transition-exists` | error | Event not in the catalogue → pick one from Events |
| `channel-gateway-mismatch` | error | Legacy direct gateway cannot carry the channel (`smscountry` is SMS only) → gateway `novu` + a provider |
| `channel-needs-provider` | error / warn | Enabled channel, no provider (error if routing uses it) → select one on Channels |
| `channel-provider-missing` | error / warn | Selected provider no longer exists → select another |
| `channel-provider-inactive` | error / warn | Selected provider disabled → re-enable or replace |
| `placeholder-braces` | error | `{{id}}`, unclosed `{`, stray `}` → exactly `{id}` |
| `template-needs-body` | error | Active template with empty body |
| `whatsapp-variable-unmapped` | error | Body placeholder missing from the provider template's **Variables (ordered)** → add it in the approved position or remove it |
| `namespace-switch` | error | A raw `NOTIFICATIONS.Routing` or `NOTIFICATIONS.Channel` create while the tenant is still served from its legacy masters: the first such row would stop every legacy route (or the legacy channel policy) at once → move the tenant with `migrate-notifications.py` ([migration.md](./migration.md#3-copy-each-tenants-configuration)) |
| `channel-in-event` | warn | Channel not declared on the event's catalogue row → usually fix the routing row |
| `no-orphan-template` | warn | Template with no active routing row → harmless |
| `non-notifiable-audience` | warn | `AUTO_ESCALATE` / `SYSTEM` never send |
| `channel-enabled` | warn | Routing on a channel that is off or has no row (expected on a fresh install) |
| `unknown-token` | warn | `{token}` not declared by the event; ships literally |
| `email-needs-subject` | warn | No subject; `Complaint <id>` is used |
| `email-subject-length` | warn | Subject over 150 characters |
| `sms-length` | warn | Estimated over 3 segments. Estimate adds 12 characters per placeholder; the shipped Hindi bodies trigger it |
| `whatsapp-needs-template` | warn | WhatsApp routing without an approved provider template (`NB_TEMPLATE_NOT_APPROVED`) |
| `whatsapp-variable-unfilled` | warn | Provider template variable the event cannot fill; sent empty |

Expected warnings on the shipped defaults: `channel-enabled` (channels ship off unless the
allowlist named them),
`whatsapp-needs-template` (the assignee WhatsApp rows have no approved template), `sms-length`
(Hindi bodies).

### 5.5 WhatsApp provider templates

WhatsApp sends an approved template (Twilio Content SID, `HX…`) plus ordered values, not your
body. Without one the message is `SKIPPED / NB_TEMPLATE_NOT_APPROVED`.

1. Get your own templates approved in Twilio, with names and ordered variables matching your
   messages.
2. **Providers → Sync WhatsApp templates**: it matches approved templates to routing rows;
   review and save the rows you want. They land on **Provider Templates (WhatsApp)**.
3. Check routing and templates on **Configure**, then trigger a real complaint transition.

### 5.6 Changing the OTP wording

**Configure → Login and registration OTP (SMS)**, at the end of the page, edits the text of
the OTP SMS. It changes the wording only: the OTP service (`user-otp`) builds the SMS itself
and novu-bridge delivers it, so on/off and provider stay on **Channels** (SMS, [§4](#4-switch-the-channel-on)).
The OTP has no event, routing or template row.

The text is three localization messages in module `egov-user`:

| Code | OTP type | Built-in text, used when the language has no `egov-user` message |
|---|---|---|
| `sms.login.otp.msg` | login | `Dear Citizen, Your Login OTP is %s.` |
| `sms.register.otp.msg` | register | `Dear Citizen, Your OTP to complete your DIGIT Registration is %s.` |
| `sms.pwd.reset.otp.msg` | password reset | `Dear Citizen, Your OTP for recovering password is %s.` |

- **`%s` is the code** and must appear exactly once. Without it the SMS goes out with no
  code; with two the OTP request fails. Write `%%` for a literal `%`. The screen refuses
  those saves (`otp-code-slot`, `otp-format`, `otp-needs-text`) and warns, without blocking,
  when the SMS with a 6-digit code is over one segment (`otp-sms-length`) or the language is
  not in the tenant's language list (`otp-locale-unused`).
- **Tenant and language.** The OTP service looks the text up at the request's tenant minus
  its last segment (`mz.maputo` → `mz`; a state tenant `mz` stays `mz`), in the language the
  citizen's app is set to, `en_IN` when the request names none.
- **All three or none.** The built-in text is used only while the language has *no*
  `egov-user` message at all. Once it has one, a missing code makes that OTP type fail, so a
  save always writes all three codes. **Reset to default** deletes them when the other two
  are at their built-in text and nothing else in `egov-user` exists for that language;
  otherwise it stores the built-in text.
- **When it applies.** The next OTP. The OTP service reads localization for every OTP and
  keeps no copy. Saving here also calls `POST /localization/messages/cache-bust`: an upsert
  alone does not replace a cached *empty* answer, so the first custom wording for a language
  would otherwise go unseen. Do the same after writing these codes any other way.
- **Who can save.** A role with `/localization/messages/v1/_upsert` (on the shipped seed
  `LOC_ADMIN`, `ACCOUNT_ADMIN`, `SUPERUSER`); everyone else sees the section read-only.

## 6. Send a test and read the logs

**Providers → Test** on a row (admin role at the state tenant), enter a recipient you may message, **Send Test**, then
**View Notification Logs**. A test is a real message and a real log row at your tenant,
flagged as a test and hidden unless the **Test sends** filter is *Show test sends*. It proves
the provider and credentials only — not routing, templates or the channel switch.

**Logs** filters: **Complaint #**, **Channel**, **Status**, **Produced by**, **Test sends**.
Recipients are masked server-side. There are no retries: a failed or skipped message is one
row, and re-enabling a channel does not resend what was skipped.

| Status | Meaning |
|---|---|
| Sent (accepted by transport) | The gateway **accepted** it — not proof of delivery |
| Delivered / Bounced | A delivery receipt reported it ([§8.3](#83-delivery-receipts)) |
| Failed | Gateway refused it or a receipt reported failure; reason in the Error column |
| Skipped | A deliberate decision not to send; read the code |
| Rejected (bad event) | Malformed or uncatalogued event — a producer fault |
| Received (dry run) | Validation-only run |

Rows with Channel *No channel* are decisions taken before any channel (nobody routed, nobody
resolved); filter **No channel (nothing sent)**. **Produced by** is *Sent as finished
message* (pre-rendered by the producer) or *Routed by notifications* (resolved by the
bridge).

| Code | Cause | Fix |
|---|---|---|
| `NB_NO_PROVIDER` | Channel off for this tenant (expected on a new city) | [§4](#4-switch-the-channel-on) |
| `NB_PROVIDER_UNAVAILABLE` | Selected provider missing, disabled or wrong channel | [§4](#4-switch-the-channel-on) |
| `NB_NO_ROUTING` | No routing row for the event | Add one ([§5.2](#52-routing-and-audiences)) |
| `NB_NO_TEMPLATE` | No template in the recipient's language or `en_IN` | Add it |
| `NB_NO_RECIPIENTS` | Every audience named nobody | Check the role has holders in this tenant |
| `NB_CONTACT_MISSING` | Recipient has no phone / email | Fix the record or route another channel |
| `NB_TEMPLATE_NOT_APPROVED` | WhatsApp without an approved template | [§5.5](#55-whatsapp-provider-templates) |
| `NB_PREFERENCE_DENIED` | Recipient has not consented to the channel | Nothing — consent working |
| `NB_UNKNOWN_AUDIENCE_SCHEME` | Audience prefix unknown | Fix the routing row |
| `NB_RECIPIENT_LIMIT_EXCEEDED` | Fan-out over the cap (1000); nothing sent | Check role assignments |
| `NB_EVENT_NOT_IN_CATALOGUE` | Producer sent an undeclared event | Report it; not an operator fix |

Every code: [contract/error-codes.md](./contract/error-codes.md).

## 7. Going live and troubleshooting

Checklist:

- [ ] Each channel you use is on, a provider is selected, the card says "on and delivering".
- [ ] **Validate** reports zero errors.
- [ ] Every routing row has an `en_IN` template, plus each language you serve.
- [ ] WhatsApp: **your own** approved templates are synced and saved.
- [ ] India SMS: every body is DLT-registered, per language ([§8.4](#84-sms-india-dlt-registration)).
- [ ] A real complaint transition arrived on a handset / in a mailbox — not just a `SENT` row.
- [ ] With OTP login: a phone login works since SMS was switched on.
- [ ] Only the right people hold an admin role.

| Symptom | Likely cause | Fix |
|---|---|---|
| Nothing arrives on any channel | Channels are off (they ship off unless `novu_bridge_channels_enabled` named them) | [§4](#4-switch-the-channel-on); Logs full of `NB_NO_PROVIDER` |
| Nothing on Logs at all | No event reached the bridge | Confirm the complaint moved; check services, then the DLQ ([kafka-events.md](./kafka-events.md#verify-delivery)) |
| WhatsApp rows skipped | `NB_TEMPLATE_NOT_APPROVED` | [§5.5](#55-whatsapp-provider-templates) |
| `SENT` but nothing arrives | Gateway dropped it later | Gateway's own delivery report: sender id, DLT template, barred number; email: spam, SPF/DKIM |
| 403 saving in Configurator | Missing MDMS role, or access-control rows never seeded, or a truncated tenant bootstrap | Hold `MDMS_ADMIN`/`ACCOUNT_ADMIN`/`SUPERUSER`; if everyone gets 403: `./deploy.sh mycity --tags notifications`. If the deploy printed `master-repair — ACTION` (the tenant has exactly 500 role-actions), read the `master-repair — result` rows, then `./deploy.sh mycity -e repair_tenant_masters=true --tags master-repair,notifications` |
| "This needs one of these roles held at a state tenant…" (`NB_ADMIN_ROLE_REQUIRED`) | No admin role, or one held only at a city | Be granted one at the state tenant |
| `403 NB_TENANT_NOT_ALLOWED` on Logs, or on Disable / Delete | Looking at another state's tenant, or managing a provider for a state you are not an admin of | Log in at the tenant you mean |
| `409 NB_PROVIDER_IN_USE` on Disable / Delete | A channel still selects the provider, or MDMS could not be read | Point the channel at another provider; retry if MDMS was down |
| Banner "not been migrated yet" | Tenant still on its 2.12 configuration | `migrate-notifications.py plan --tenant mycity`, review, then `apply` ([migration.md](./migration.md#3-copy-each-tenants-configuration)) |
| Banner "No notification configuration on this tenant" | Defaults never installed | `./deploy.sh mycity` installs them on a tenant with no configuration |
| OTP login stopped | SMS off or its provider broke | [§4](#4-switch-the-channel-on); look for `CORE.SMS.OTP` rows |
| `{emp_name}` in a message | Placeholder has no value for that event | Use tokens the Events screen lists for it |
| `SKIPPED / NB_NO_ROUTING` for a complaint in `pg.citya` | Configuration written at a different root than the complaint's | Log in at the complaint's state root and configure there; re-seed that root ([§8.2](#82-whatsapp-server-side)) |

Not supported: provider failover, retries, per-city providers within a state, resending
skipped messages. The Novu dashboard (`/novu`) is for debugging only.

## 8. Deployment reference

### 8.1 Deployment settings

Ansible `host_vars/<tenant>.yml` (re-run `./deploy.sh` after changing):

| Setting | Meaning | Default |
|---|---|---|
| `enable_novu` | Starts the notification stack | `false` |
| `seed_notifications` | Seed `NOTIFICATIONS.*` masters, access-control rows, and copy legacy rows | `enable_novu` |
| `enable_otp_services` | Real OTP login; requires `enable_novu` | `false` |
| `novu_bridge_proxy_allowed_roles` / `novu_bridge_proxy_admin_roles` | The two role tiers ([§1](#1-before-you-start)) | see §1 |
| `novu_admin_email` / `novu_admin_password` | Novu's first account | — |
| `novu_api_key` | Leave unset; the deploy mints it | — |
| `notification_stack_tag` | Image tag of pgr-services, pgr-services-db, novu-bridge and novu-bridge-db — one build ([migration.md](./migration.md#1-take-all-four-images-from-one-build)). Pin a `develop-<sha8>` or release tag; the deploy warns while it is rolling | `nightly-develop` (rolling; a stopgap until the release pins one) |
| `verify_tenant_masters` / `repair_tenant_masters` | Non-`pg` state roots: compare the tenant's access-control rows with `pg`'s and report the gap / also copy the missing rows. Copying is opt-in: a gap can be deliberate, and a copied grant cannot be removed | `true` / `false` |
| `novu_bridge_channels_enabled` | **Fallback only**, for a tenant with no channel rows, e.g. `"SMS"`. The seed turns it into rows for such a tenant | unset = nothing sent |
| `novu_bridge_receipts_secret` | Enables delivery receipts ([§8.3](#83-delivery-receipts)); a secret | blank = off |
| `novu_bridge_preference_enabled` / `novu_bridge_preference_fail_open` | Consent gate; allow delivery when the preference service is down | `false` / `true` |
| `novu_bridge_core_sms_country_code` | Country code for OTP numbers sent without one, e.g. `+254` (`254` works too); a leading trunk `0` is dropped. Blank: numbers go out as given, which gateways will not route, and the bridge warns at startup | blank |
| `novu_bridge_smscountry_allowed_hosts` | Hosts an SMSCountry provider's Gateway URL may name; the default endpoint's host is always allowed | `api.smscountry.com,www.smscountry.com` |
| `twilio_account_sid` / `twilio_auth_token` / `twilio_whatsapp_from` | Bootstrap the `twilio-whatsapp` Novu integration at deploy | — |
| `novu_bridge_workflow_id_sms` / `_whatsapp` / `_email` | Novu workflow ids | `complaints-*` |
| `novu_bridge_integration_id_whatsapp` | Only if a second Twilio integration exists | blank |
| `novu_bridge_sms_provider` / `novu_bridge_sms_sender_id` / `novu_bridge_smscountry_user` / `novu_bridge_smscountry_password` | Legacy direct-SMSCountry route (bypasses Novu) — use **either** this **or** an SMSCountry provider, not both | blank |

novu-bridge environment. On Compose the deploy renders these into `/opt/digit/.env` from the
host_vars above (they are interpolated into the `novu-bridge` service in
`local-setup/docker-compose.egov-digit.yaml`; `./deploy.sh` regenerates `.env` on every run, so
set them in host_vars, not in `.env`); on Helm set them in
`devops/deploy-as-code/charts/common-services/novu-bridge/values.yaml`.

| Env | Meaning | Default |
|---|---|---|
| `NOVU_BRIDGE_RECEIPTS_SECRET` | Enables delivery receipts ([§8.3](#83-delivery-receipts)) | blank = off |
| `NOVU_BRIDGE_PREFERENCE_ENABLED` / `NOVU_BRIDGE_PREFERENCE_FAIL_OPEN` | Consent gate; allow delivery when the preference service is down | Compose `false` / `true` |
| `NOVU_BRIDGE_CORE_SMS_COUNTRY_CODE` | Country code for OTP numbers sent without one (see `novu_bridge_core_sms_country_code`) | blank |
| `NOVU_BRIDGE_SMSCOUNTRY_ALLOWED_HOSTS` | Hosts the SMSCountry adapter may post to ([providers.md](./providers.md#the-smscountry-adapter)) | `api.smscountry.com,www.smscountry.com` |

Any other property in `backend/novu-bridge/src/main/resources/application.properties` must be
added to the service's `environment:` block — Compose reads `.env` only for interpolation. One
worth knowing: channel policy is cached for `novu.bridge.channel.policy.cache.ttl.ms`
(`NOVU_BRIDGE_CHANNEL_POLICY_CACHE_TTL_MS`, 60 s), so a Channels change or a seed takes up to a
minute to apply.
Leave `NOVU_BRIDGE_CHANNEL_POLICY_SCHEMA` unset.

### 8.2 WhatsApp server side

If `twilio_*` was set before the deploy, the `twilio-whatsapp` integration and
`complaints-whatsapp` workflow already exist. To add them later without a full deploy (the
script does not update an existing integration's credentials):

```bash
export TWILIO_ACCOUNT_SID='<SID>' TWILIO_AUTH_TOKEN='<token>' TWILIO_WHATSAPP_FROM='whatsapp:+<sender>'
export NOVU_ENV_FILE=/dev/null NOVU_INTEGRATION_NAME=twilio-whatsapp NOVU_INTEGRATION_ID=twilio-whatsapp
export NOVU_WORKFLOW_ID=complaints-whatsapp NOVU_WORKFLOW_NAME=complaints-whatsapp
export NOVU_SMS_BODY='Complaint {{payload.complaintNo}} status is {{payload.status}}'
bash backend/novu-bridge/config/bootstrap-novu-whatsapp.sh
unset TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_WHATSAPP_FROM NOVU_SMS_BODY
```

Verify (`twilio-whatsapp` active, `complaints-whatsapp` present):

```bash
curl -fsS -H "Authorization: ApiKey $NOVU_API_KEY" "$NOVU_BASE_URL/v1/integrations" \
  | jq '[.data[] | select(.identifier=="twilio-whatsapp") | {identifier,channel,active,primary}]'
curl -fsS -H "Authorization: ApiKey $NOVU_API_KEY" "$NOVU_BASE_URL/v2/workflows?limit=100&page=0" \
  | jq '[.data.workflows[] | select(.workflowId=="complaints-whatsapp") | .workflowId]'
```

Configuration resolves at the complaint tenant's state root (`pg.citya` → `pg`), which on a
dump-based install may differ from the deployment's `state_root`. Seed that root, then log in
to the Configurator at it ([#1943](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1943)):

```bash
export NOTIF_TENANT=pg DIGIT_URL='http://127.0.0.1:18000' DIGIT_USERNAME='ADMIN' \
       DIGIT_PASSWORD='<bootstrap_password>' DIGIT_LOGIN_TENANT=pg
cd /opt/digit/notification-seed
NOTIF_SEED_PHASE=access python3 seed-notifications.py
# printed ACL-CHANGED? then: sudo docker restart egov-accesscontrol, and wait for
# curl -sf http://127.0.0.1:18000/access/health before the next command
export NOTIF_CHANNELS_ALLOWLIST="$(sudo docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' novu-bridge | sed -n 's/^NOVU_BRIDGE_CHANNELS_ENABLED=//p')"
SCHEMA_FILE=RAINMAKER-PGR.json NOTIF_SCHEMA_FILE=NOTIFICATIONS.json DATA_DIR=. \
  NOTIF_SEED_PHASE=data python3 seed-notifications.py
unset DIGIT_PASSWORD NOTIF_CHANNELS_ALLOWLIST
```

Exit 3 means a write was refused with 403: restart `egov-accesscontrol` and run the data phase
again. Without `NOTIF_CHANNELS_ALLOWLIST` a tenant with no channel rows gets none (it keeps
following the env allowlist). Omitting `NOTIF_SCHEMA_FILE` seeds only the legacy masters.

### 8.3 Delivery receipts

`SENT` moves to `DELIVERED` / `BOUNCED` / `FAILED` only when a provider reports back. Set
`NOVU_BRIDGE_RECEIPTS_SECRET` and point the provider at:

| Provider | URL | Auth |
|---|---|---|
| Novu webhook | `POST <public>/novu-bridge/novu-adapter/v1/receipts/novu` | header `X-Receipt-Secret` |
| SMSCountry DR callback | `GET/POST <public>/novu-bridge/novu-adapter/v1/receipts/smscountry?secret=<secret>` | query `secret` |

Blank secret = endpoint answers 403. Late or duplicate reports never move a row backwards.
Until receipts are wired, judge delivery by the gateway's own report — SMSCountry returns a
job id even for messages it later drops.

### 8.4 SMS India DLT registration

Every message must match a template registered against your sender id; unregistered ones are
accepted and then dropped (they still get a job id). Matching is on content, no template id is
sent. Register each template from **Configure**, replacing `{variable}` with `{#var#}`, once per
language (Hindi registers separately).

| Audience | Transition | Variables |
|---|---|---|
| Citizen | submitted / re-opened | complaint type, id, date |
| Citizen | assigned / re-assigned | complaint type, id, date, employee name, designation, department |
| Citizen | rejected | complaint type, id, date, rejection reason (free text; DLT caps a variable at ~30 characters — drop it if enforced) |
| Citizen | resolved | complaint type, id, date, employee name |
| Employee | assigned to you | employee name, complaint type, id, designation, city |
| Employee | feedback received | employee name, complaint type, id, rating |

### 8.5 Testing email without a real mailbox

[Ethereal](https://ethereal.email) issues throwaway SMTP accounts that capture mail:

```bash
curl -sS -X POST https://api.nodemailer.com/user -H 'Content-Type: application/json' \
  -d '{"requestor":"ccrs","version":"1.0.0"}'
```

Put the returned `host`, `port`, `user`, `pass` into an Email (SMTP) provider, trigger a
transition, read the mail at ethereal.email. It proves wiring, not deliverability (SPF/DKIM).
