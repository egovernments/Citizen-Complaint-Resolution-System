# Setting up notifications

Follow this page once, top to bottom, and your city will be sending SMS, WhatsApp
and email messages to citizens and staff.

You do not need to be a developer. Steps 1 and 2 need someone with server access;
everything after that is done in the Configurator, in a browser.

There are no screenshots in this guide. Every screen, button and field is named
exactly as it appears in the product, so you can search for it.

| Step | What you do | Where |
|---|---|---|
| [1](#1-before-you-start) | Collect accounts and permissions | — |
| [2](#2-turn-the-stack-on) | Turn the notification stack on | Server |
| [3](#3-add-a-provider) | Add a provider and enter its credentials | Configurator |
| [4](#4-switch-the-channel-on) | Pick the provider for a channel and switch the channel on | Configurator |
| [5](#5-review-what-is-sent) | Review the events, audiences and message text | Configurator |
| [6](#6-send-a-test-and-read-the-logs) | Send a test and read the result | Configurator |
| [7](#7-going-live) | Going live, and what to do when something is wrong | — |

Related pages: [running notifications day to day](./operator-guide.md) ·
[writing the message text](./message-templates.md) ·
[the deployment runbook](./README.md) ·
[the developer interface](./developer-guide.md)

---

## 1. Before you start

### Accounts you need, per channel

Each channel is independent. Set up one, two or all three.

| Channel | You need | Where to get it |
|---|---|---|
| **SMS** | An account with one of the supported gateways: Twilio, SMSCountry, or an Ozeki gateway you run yourself | The gateway's own sign-up. For India you also need DLT-registered message templates — see [message-templates.md](./message-templates.md) |
| **WhatsApp** | A Twilio account with a WhatsApp-enabled sender, **and message templates that Meta has approved** | Twilio Console. Approval takes time — start it early |
| **Email** | An SMTP mailbox | Your own mail provider. On Gmail and Microsoft 365 this means an **app password**, not the account password |

**WhatsApp will not send anything without approved templates.** A business cannot
send free-form WhatsApp to someone who has not written to it first; the provider
refuses. Every WhatsApp message goes out as a template the provider has already
approved. If you have not started that approval, do SMS and email first.

### OTP login and notifications share the SMS channel

If your deployment uses real one-time passwords for login (the deployment setting
`enable_otp_services`), those OTP text messages go out through the same SMS
channel as complaint notifications, through the same provider, and are recorded in
the same log.

Two consequences:

- Turning the SMS channel **off** stops login OTPs as well. They are recorded
  `SKIPPED / NB_NO_PROVIDER` and nobody can log in with a phone number.
- Changing the SMS provider changes who sends the OTPs too.

`enable_otp_services: true` requires `enable_novu: true`; the deployment refuses
to run otherwise.

### Permissions you need

Two tiers, both decided at deployment time.

| You want to | You need a role from | Default roles |
|---|---|---|
| Read the notification screens, verify a provider, send a test | `novu_bridge_proxy_allowed_roles` | `EMPLOYEE`, `SUPERUSER`, `GRO`, `PGR_LME`, `MDMS_ADMIN` |
| **Create a provider, change its credentials, delete it** | `novu_bridge_proxy_admin_roles` | `SUPERUSER`, `MDMS_ADMIN`, `ACCOUNT_ADMIN` |

Without an admin role, those three actions answer `403 NB_ADMIN_ROLE_REQUIRED`
even if you can see every screen. Entering a gateway password is an
administrator's act, and a grievance officer who can read the logs must not be
able to do it. An admin role also satisfies the first list.

Editing the message configuration itself (Channels, Routing, Templates) is
governed separately, by the ordinary MDMS roles — `MDMS_ADMIN`, `ACCOUNT_ADMIN`
or `SUPERUSER`.

---

## 2. Turn the stack on

This step is run on the server by whoever deploys the system. It is a one-time
job. The full reference is the [deployment runbook](./README.md); what follows is
the short path.

### A new deployment

Add these to the deployment's variables file,
`local-setup/ansible/inventory/host_vars/mycity.yml`:

```yaml
enable_novu: true          # starts the notification services
```

`seed_notifications` follows `enable_novu` unless you set it explicitly, so you do
not normally need to name it.

Then run:

```bash
cd local-setup/ansible
./deploy.sh mycity
```

Wait for `failed=0`.

### What the deploy does for you

You do not have to do any of this by hand:

- **Starts the notification services** — the bridge, Novu and its workers, and
  the user-preference service.
- **Creates the Novu API key** and writes it into the deployment's environment.
  On a brand-new installation it opens Novu's registration just long enough to
  create the first account, then closes it again.
- **Creates the Novu delivery workflows** `complaints-sms`, `complaints-whatsapp`
  and `complaints-email`.
- **Installs the notification configuration** — the events, routing rows, message
  templates, approved-template rows and channel rows described in step 5. All
  three channels arrive **switched off**, with no provider selected. That is
  deliberate: a brand-new city has no gateway account, and anything else would
  mean failed sends on day one.
- **Grants the permissions** the notification screens need, and restarts the
  access-control service when it created any — that service caches permissions in
  memory and would otherwise keep refusing the screens it was just granted.

### An existing deployment, upgrading

Run the notification step on its own:

```bash
cd local-setup/ansible
./deploy.sh mycity --tags notifications
```

It is safe to re-run. **Nothing you have configured is deleted or changed.**

What it does to an existing city:

- Adds the new shared `NOTIFICATIONS.*` masters, and **copies your city's own
  rows into them** — the rows the server actually has, read live, not the
  defaults from the repository. A city that has edited its routing and templates
  over two years keeps every edit.
- Leaves the old `RAINMAKER-PGR.Notification*` rows exactly where they are. They
  are never deleted. In the Configurator they become **read-only**, labelled
  "Legacy (PGR) …", with a notice explaining where the configuration moved to.
- Adds the permissions the new screens need.

The copy is additive and can be run again if it was interrupted. If it could not
finish, the deploy prints a warning naming the step, your old rows are untouched,
and notifications keep working from them.

### Confirm the upgrade landed

Two ways. Either is enough.

**In the Configurator.** Open **Notifications → Configure**. If you see a banner
headed *"This tenant has not been migrated yet — shown read-only"*, the copy has
not run for this city yet — re-run the step above. No banner means the city is on
the new masters and you can edit normally.

**From a shell**, ask the notification service which masters it is actually
reading. `$TOKEN` is an ordinary employee access token:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:18000/novu-bridge/novu-adapter/v1/config/source?tenantId=mycity" | jq
```

It answers one entry per master with the schema code it read and how many rows it
found. `"legacy": true` on any of them means that city is still being served from
the old masters.

There is **no setting** that chooses between old and new. The data chooses, per
city, all or nothing — which is why this endpoint exists: two cities on the same
build can legitimately differ, and this is how you see which is which.

---

## 3. Add a provider

A *provider* is a gateway account — the thing that actually sends the message.

Open **Configurator → Notifications → Notification Providers** and select
**Add Provider**. The dialog asks for three things:

- **Provider type** — pick one of the five below.
- **Name** — anything you will recognise later, e.g. `City SMS account`.
- **Credentials** — the form then asks for exactly that type's fields. You never
  have to know which gateway software is behind it.

Then select **Create Provider**.

**Where the credentials go.** They are sent straight to Novu over TLS and stored
there. They are never written to the message configuration, never written to the
deployment's environment file, never logged, and **never sent back to the
browser**. Editing a provider shows you the non-secret fields and an empty box to
re-enter the secret.

**Changing a credential replaces the whole set.** The storage overwrites rather
than merges, so the form asks for every field again. Half-filling it would
silently blank the rest.

### Twilio SMS

| Field | What to put in it |
|---|---|
| Account SID | From the Twilio Console. Starts `AC…` |
| Auth token | From the Twilio Console |
| From number | Your Twilio number in international form, e.g. `+14155238886`, SMS-enabled for the countries you send to |

### Twilio WhatsApp

| Field | What to put in it |
|---|---|
| Account SID | From the Twilio Console |
| Auth token | From the Twilio Console |
| WhatsApp sender | Your WhatsApp-registered Twilio sender, with the prefix: `whatsapp:+14155238886` |

For testing you can use Twilio's sandbox number, after enrolling your own handset
with the `join <code>` message Twilio gives you.

### Email (SMTP)

| Field | What to put in it |
|---|---|
| SMTP host | e.g. `smtp.gmail.com`, `smtp.office365.com` |
| SMTP port | `587` in almost every case |
| Username | The mailbox address |
| Password | An **app password** — see below |
| From address | Usually must be the same as the username |
| From name | What recipients see as the sender, e.g. `City Grievance Desk` |
| Use TLS on connect (port 465) | **Leave unticked** for port 587 — see below |

Two things cause most email failures:

- **Use an app password, not your account password.** Once two-factor
  authentication is on, Gmail and Microsoft 365 reject the account password for
  SMTP with `535-5.7.8 Username and Password not accepted`, which reads like a
  typo and sends people round in circles. Generate a 16-character app password in
  your mail account's security settings.
- **"Use TLS on connect" is not "use TLS".** It means encryption from the very
  first byte, which is port **465**. Port **587** starts unencrypted and upgrades
  a moment later, so it needs this box **unticked**. Ticking it with port 587
  hangs or fails the handshake.

| Port | Use TLS on connect |
|---|---|
| 587 | unticked |
| 465 | ticked |

### SMSCountry

Uses SMSCountry's legacy bulk service, which is what eGov accounts are provisioned
on. It authenticates with your **panel login**, not an API key. If your panel shows
you an AuthKey/AuthToken pair, you are on their newer service, which is not
supported here.

| Field | What to put in it |
|---|---|
| Panel username | Your SMSCountry panel login |
| Panel password | Your SMSCountry panel password |
| Registered sender id | The sender id your messages are registered against, e.g. `KE-GOV` |
| Gateway URL | Leave blank to use the standard SMSCountry endpoint |

### Ozeki SMS Gateway

For a gateway you run yourself.

| Field | What to put in it |
|---|---|
| HTTP API URL | Your gateway's send URL, e.g. `https://ozeki.example.org:9509/api?action=sendmessage` |
| Username | Gateway login |
| Password | Gateway password |
| Sender id | Optional — leave blank to use the gateway's own default sender |

### Check that it works

The dialog offers **Verify** and **Test** as soon as the provider is created, and
each row on the list offers them again, alongside **Rename**, **Rotate
credentials**, **Disable** / **Enable**, **Delete** and **Templates**.

- **Verify** confirms the account exists and is switched on. It does **not** prove
  the password is right. SMSCountry and Ozeki have no way to check a password
  short of sending a message, so they honestly do not offer Verify at all — the
  dialog says *"This provider type offers no connectivity check."* A check that
  always passes would be worse than none.
- **Test** sends one real message. See [step 6](#6-send-a-test-and-read-the-logs).
- **Rotate credentials** asks for every field again, because the store overwrites
  rather than merges. **Rename** changes only the display name.
- **Delete** is refused while a channel still points at the provider
  (`NB_PROVIDER_IN_USE`). Point that channel somewhere else first. The refusal is
  the point — the delete would otherwise succeed and every message on that channel
  would start failing.
- **Templates** lists the Novu delivery workflows for the channel. It is a
  plumbing view, not your message text; your wording lives on **Notification
  Templates**.

---

## 4. Switch the channel on

A provider on its own sends nothing. The channel has to be switched on and pointed
at it.

On **Notifications → Notification Providers**, the **Channels** card shows each
channel's real state and lets you select its provider and switch the channel on
with **Enable** / **Disable**. **Notifications → Channels** is the same setting on
its own screen.

The card states the rule itself: *"One active provider per channel. A channel
delivers when it is switched on here AND its selected provider is enabled;
otherwise every event on it is recorded SKIPPED / NB_NO_PROVIDER."* — and, right
below it, *"SMS also carries login OTPs — switching it off disables OTP login."*

**One provider per channel, per city. There is no automatic failover.** Selecting
a second provider for a channel replaces the first. Nothing fans out to two
gateways and nothing falls back when one is down — switching gateways is a
deliberate act. There is also no way to give one city within a state a different
provider from another: the choice is held at the state level and every city under
it uses it.

The card names the tenant it is reading — *"Policy is read at …"* — and if you are
logged in scoped to a city rather than the state, it tells you so and the
**Enable** / **Disable** buttons are disabled: *"You are scoped to … switch to the
state tenant to change channel policy."*

### Reading the status card

The card writes a full sentence per channel. These are the ones you will meet:

| It says | It means | Do this |
|---|---|---|
| "… is on and delivering through *Name*" | Working. | Nothing. |
| "No channel policy row for …" | This city has no setting for that channel at all; the deployment's own fallback applies, which is normally "off". | Switch the channel on so the choice is explicit. |
| "… is off. Every event on this channel is recorded SKIPPED / NB_NO_PROVIDER and nothing is delivered." | The master switch is off. | Switch it on once its provider is configured. |
| "… is on but no provider is configured for it." | No provider of that type exists yet. | Go back to [step 3](#3-add-a-provider). |
| "… is on but no provider is selected." | Providers exist; none is chosen, so delivery falls back to the deployment's own settings rather than this city's choice. | Select one here. |
| "… is on but its selected provider *Name* no longer exists / is disabled / does not serve …" | The selection is broken. Every message on the channel is recorded `SKIPPED / NB_PROVIDER_UNAVAILABLE` and nothing is delivered. | Re-enable that provider, or select another. |
| "… is on with a working provider, but the Novu workflow complaints-… is missing" | Delivery plumbing is absent. | A deployment job — see the [runbook](./README.md). |

The broken-selection case deliberately reports `SKIPPED`, not `SENT`. The delivery
engine would happily accept a message naming an unusable gateway and fail it out
of sight, and a row that says `SENT` for a message that never left is the worst
possible outcome.

Changes take effect on the next message, within about a minute.

---

## 5. Review what is sent

Three things decide what a person receives. Open **Notifications → Configure**
("Configure Notifications") — that screen edits them together, one event at a
time, and tells you what is missing. Pick a **Module** at the top (for complaints
it is `Complaints`) and it lists that module's events with their notifications
underneath.

### Events

An *event* is something that happened that might be worth telling someone about:
a complaint was filed, assigned, rejected, resolved, reopened, rated.

**Notifications → Events** lists them. Each row gives the event's name, the module
that produces it, the people ("actors") the event carries, the `{placeholders}` it
can fill, and the channels it may be sent on. Fourteen complaint events ship out
of the box, named like
`COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME` and labelled "Complaint assigned
(PENDINGATLME)".

**This screen is read-only.** Events are declared by the software that produces
them — the complaint service's rows are generated from its workflow when the city
is set up. A new event arrives with the module that fires it; you cannot invent
one here.

### Routing: who is told, on which channel

**Notifications → Notification Routing** holds one row per
*(event, audience, channel)*. Read a row as a sentence:

> when **COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME** happens,
> tell **ACTOR:citizen** by **SMS**.

The *audience* is the only part that needs explaining. It is a reference with a
prefix, and there are three forms plus a fallback chain:

| Audience | Means | Example |
|---|---|---|
| `ACTOR:<name>` | A person the event itself names. The complaint service names `citizen` (who filed it) and `assignee` (who it is with right now). | `ACTOR:citizen` |
| `ROLE:<code>` | Everybody in this city holding that role. | `ROLE:GRO` |
| `EVENT_RECIPIENTS` | Contact details carried on the event itself — used where the recipient has no account, such as a login OTP. | `EVENT_RECIPIENTS` |
| `A\|B` | Try the first; if it names nobody, try the second. | `ACTOR:assignee\|ROLE:PGR_LME` |

On the Configure screen you do not type these. The **Audience** field is a pair of
pickers: a **Kind** — *Actor on the event*, *Everyone with a role*, or *Contacts
on the event* — and then the actor or role itself. **+ add a fallback (used only
when the one above resolves to nobody)** adds the next link in the chain, shown
as *or, if empty:*.

Which actor names are available is not a guess: the **Events** screen lists them
per event, and the Configure screen only offers those.

Two audiences never send: `AUTO_ESCALATE` and `SYSTEM`. They are workflow
bookkeeping, not people. A routing row on either is dropped.

If you are upgrading, you may still see the older bare names `CITIZEN` and
`EMPLOYEE`. They keep working and mean `ACTOR:citizen` and `ACTOR:assignee`.

**Twenty-four routing rows ship by default** — the citizen on SMS, WhatsApp and
email for filed, assigned, reassigned, rejected, resolved and reopened; the
assigned employee on all three channels when a complaint reaches them and when a
citizen rates it.

### Templates: what the message says

**Notifications → Notification Templates** holds the wording: one row per
*(event, audience, channel, language)*.

A routing row and a template row are a pair. Routing says "tell the citizen by
SMS when a complaint is assigned"; the template says what that SMS contains. **A
routing row with no template sends nothing**, and the Configure screen says so.

Placeholders are written with **single braces**: `{id}`, `{complaint_type}`,
`{date}`. Not `{{id}}` and not `{ id }` — only the exact single-brace form is
replaced, and anything else is delivered to the citizen literally, braces and all.
The tokens you may use for a given event come from that event's row on the
**Events** screen, and the Configure screen checks what you type against it.

A placeholder with no value is delivered **as its braces**, e.g. `{emp_name}`, not
as a blank. That is on purpose: a blank looks like a working message with nothing
to say, whereas braces look like the mistake they are.

Full detail — every placeholder, every validation rule, the SMS length arithmetic:
[message-templates.md](./message-templates.md).

### Languages

Each recipient is written to in the language recorded in their profile, where a
template exists for it. Where one does not, the message falls back to `en_IN`.

That makes `en_IN` special: **every routing row needs an `en_IN` template**, or
some recipients get nothing. A template only in another language is not enough,
and the checker treats it as an error.

Forty-two templates ship by default — all twenty-four routing keys in `en_IN`,
plus eighteen of them in `hi_IN`.

### WhatsApp needs the provider's approval

WhatsApp does **not** send your template body. It sends a template the provider
has approved, identified by a Template ID (Twilio calls it a Content SID, `HX…`),
plus the values to drop into it in the order the approved template expects.

So for WhatsApp there is one more screen: **Notifications → Provider Templates
(WhatsApp)**, which records which approved template corresponds to which of your
messages.

To fill it, open **Notifications → Notification Providers** and select
**Sync WhatsApp templates**. It pulls your Twilio account's approved templates,
matches them to your routing rows, shows you what it matched and what it skipped,
and saves only the rows you select.

The fourteen approved templates that ship belong to the reference demonstration
account and **will not work on yours**. Each city needs its own approved wording
and its own template IDs. This is the single most common reason WhatsApp messages
quietly fail to arrive.

Without an approved template, a WhatsApp message is recorded
`SKIPPED / NB_TEMPLATE_NOT_APPROVED` rather than sent as free text — the provider
would refuse it anyway.

### Check the whole configuration

**Validate** on the Configure screen runs every rule over this city's
configuration. It answers with one of **All checks passed**, **Passed · N
warning(s)**, or **N error(s)**, and **Show details** lists each finding.

**Errors** will not work. **Warnings** will work but will cost money, reach
nobody, or are probably not what you meant. Every finding shows a rule id you can
look up in [message-templates.md](./message-templates.md).

The same check runs whenever you save. A save that would break a message is
refused — *"This change cannot be saved until the following is fixed:"* — but only
for problems your change causes or touches. Errors that were already there, on
rows you are not editing, are listed separately and do not block you, so a broken
city can be repaired one row at a time.

---

## 6. Send a test and read the logs

### Send one message

On **Notifications → Notification Providers**, use **Test** on the provider's row.
Fill in a recipient you are authorised to message and select **Send Test**.

A test is a real message and a real log row at your own city, flagged as a test.
Tests are auditable and are never counted as ordinary traffic.

Then select **View Notification Logs**, or open **Notifications → Notification
Logs** and set the **Test sends** filter to *Show test sends* — test rows are
hidden otherwise.

A test exercises the provider and its credentials. It does **not** exercise your
routing, your templates or the channel switch. To test those, make a real
complaint move.

### Read the Logs screen

Every attempt lands here with an explicit outcome. There is no silent path: if
nothing arrived, there is a row saying why.

Filter by **Complaint #**, **Channel**, **Status** and **Test sends**.

| Status | What it means |
|---|---|
| `Sent (accepted by transport)` | The gateway **accepted** it. Queued, not delivered — that is the strongest honest statement without a delivery receipt. |
| `Delivered` | A delivery receipt confirmed it reached the recipient. Only appears if a deployer has wired receipts up. |
| `Bounced` | The email address was bad. |
| `Failed` | The gateway refused it, or a receipt reported final failure. The reason is in the Error column. |
| `Skipped` | A deliberate decision not to send. Not a fault in itself — read the code. |
| `Rejected (bad event)` | The message never formed properly. A software fault, not a configuration one. |
| `Received (dry run)` | A validation-only run. Nothing was sent. |

**Recipient details are masked**, on the server, before the data reaches the
browser.

**Some rows have no channel.** When the decision was taken before any channel came
into it — nobody is configured to be told, nobody could be found, the audience was
unreadable — the row's Channel reads `NONE`. The **Channel** filter only offers
SMS, Email and WhatsApp, so **clear that filter** to see them. They are the rows
that explain "nothing happened at all".

**There are no automatic retries.** A failed message is one row. Fixing the cause
does not resend it, and switching a channel back on does not resend what was
skipped while it was off — those messages were never queued anywhere.

### The codes you will actually meet

The Error column shows the reason verbatim. These are the handful an operator
sees; the complete list, with what each one means and what to do, is in
[contract/error-codes.md](./contract/error-codes.md).

| Code | What happened | What to do |
|---|---|---|
| `NB_NO_PROVIDER` | The channel is switched off for this city. | Step 4. On a brand-new city this is expected — the channels ship off. |
| `NB_PROVIDER_UNAVAILABLE` | The channel points at a provider that is missing, switched off, or serves a different channel. | Step 4: re-enable it or select another. |
| `NB_NO_ROUTING` | Nobody is configured to be told about this event. | Step 5: add a routing row for that event. The usual reason nothing was sent after onboarding a new event. |
| `NB_NO_TEMPLATE` | There is a routing row but no wording for it, in the recipient's language or in `en_IN`. | Step 5: add the template. |
| `NB_NO_RECIPIENTS` | Routing matched, but every audience on it named nobody — no such actor on the event, or nobody in this city holds that role. | Check the role really has holders here. |
| `NB_CONTACT_MISSING` | The recipient has no phone (SMS/WhatsApp) or no email address. | Correct the person's record, or route that audience on a channel you can reach them on. |
| `NB_TEMPLATE_NOT_APPROVED` | A WhatsApp message with no approved provider template. | Step 5: sync and save your approved templates. |
| `NB_PREFERENCE_DENIED` | The recipient has not consented to this channel. | Nothing. This is consent working. |
| `NB_UNKNOWN_AUDIENCE_SCHEME` | A routing row's audience uses a prefix the system does not know. | Fix the audience on that row. It is never guessed at. |
| `NB_EVENT_NOT_IN_CATALOGUE` | Something produced an event that is not declared on the **Events** screen. | Not an operator fix. Report it — the module and the configuration are out of step. |

`SENT` means the gateway accepted the message. To learn whether it actually
arrived, a deployer must give the gateway a delivery-report address; see the
[runbook](./README.md). Until then, use the gateway's own delivery report: with
SMS in particular, a rejected message still comes back with a job id, and only the
gateway's report tells you it was dropped.

---

## 7. Going live

### Checklist

- [ ] Every channel you intend to use is **on**, with a provider selected, and its
      status card says "on and delivering".
- [ ] **Validate** on the Configure screen reports **zero errors**. Warnings are
      fine if you have read them.
- [ ] Every routing row has an `en_IN` template, and a template in each other
      language you serve.
- [ ] WhatsApp: your **own** approved templates are synced and saved. The shipped
      ones are not yours.
- [ ] India, SMS: every message body is registered with DLT against your sender
      id, in each language.
- [ ] You have sent one real complaint through a full transition and seen it
      arrive on a handset or in a mailbox — not just a `SENT` row.
- [ ] If you use real OTP login: you have logged in with a phone number since
      switching the SMS channel on.
- [ ] Only the people who should hold an admin role hold one.

### When something is wrong

| Symptom | Most likely cause | Fix |
|---|---|---|
| **Nobody receives anything, on any channel** | The channels are off. All three ship off. | Step 4. The Logs screen will be full of `SKIPPED / NB_NO_PROVIDER`. |
| **Nothing at all on the Logs screen** | No event is reaching the system: the complaint did not actually change state, or the notification services are not running. | Check the complaint really moved. Then ask a deployer to confirm the services are up. |
| **SMS works, WhatsApp rows say skipped** | `NB_TEMPLATE_NOT_APPROVED` — no approved provider template for that message. | Step 5: **Sync WhatsApp templates**, then save the rows. The shipped template IDs are not yours. |
| **Rows say SENT but nothing arrives** | `SENT` only means the gateway accepted it. The gateway dropped it afterwards. | Read the **gateway's own** delivery report. Common causes: an unregistered sender id, an unregistered DLT template (India), a barred or unreachable number. For email, check spam and whether your domain's mail records allow this sender. |
| **Cannot save in the Configurator — 403** | Your account is missing the MDMS role for that master, or the permissions were never installed on this city. | Confirm you hold `MDMS_ADMIN`, `ACCOUNT_ADMIN` or `SUPERUSER`. If everyone gets 403, the permission rows are missing: re-run `./deploy.sh mycity --tags notifications`. |
| **"Managing notification providers requires one of these roles…" (403)** | You can read the screens but hold none of the admin roles. | Have an administrator add the provider, or be granted `SUPERUSER`, `MDMS_ADMIN` or `ACCOUNT_ADMIN`. |
| **A channel screen says the tenant is not migrated** | This city's configuration is still only in the old masters. | `./deploy.sh mycity --tags notifications`. Your rows are copied, never deleted. Until then the screens are read-only and the old rows are still what is delivered. |
| **"No notification configuration on this tenant"** | Nothing has ever been seeded here. | `./deploy.sh mycity --tags notifications`, then reload. |
| **OTP login stopped working** | The SMS channel was switched off, or its provider broke. | Step 4. Look for `CORE.SMS.OTP` rows on the Logs screen — `SKIPPED / NB_NO_PROVIDER` means the channel is off. |
| **A message arrives with `{emp_name}` in it** | The placeholder had no value for that event. | Take that token out of the template for that event, or use one the **Events** screen says the event fills. |
| **One role's members get two copies** | They do not — the system sends one message per person per channel. If they really got two, two *different* events fired. | Check the Logs screen: two rows will have different event names. |

### What is deliberately not supported

Saying this once saves a long search:

- **No automatic failover between providers.** One provider per channel. If it is
  down, messages fail; they are not retried elsewhere.
- **No retries.** One attempt, one row.
- **No per-city provider within a state.** The channel and its provider are held
  at the state level.
- **No resend of what was skipped.** Turning a channel on does not deliver what
  was missed while it was off.
- **The Novu dashboard is not part of your job.** Everything above is in the
  Configurator. `/novu` is left running for engineers to debug with.

---

## See also

- [operator-guide.md](./operator-guide.md) — running it day to day once it works
- [message-templates.md](./message-templates.md) — writing the wording, and every validation rule
- [README.md](./README.md) — the full deployment runbook, and upgrading
- [contract/error-codes.md](./contract/error-codes.md) — every code that can appear on the Logs screen
- [developer-guide.md](./developer-guide.md) — adding a provider, or connecting another module
