# Operator guide: running notifications

What you can change from the Configurator, where each thing lives, and what still
needs a deployer.

**Setting notifications up for the first time?** Start with
[setup-guide.md](./setup-guide.md) — it is the ordered path from nothing to a
delivered message. This page is the reference you come back to afterwards.

**You never need the Novu dashboard.** Every provider operation is on the
Providers screen. `/novu` is left up for debugging and nothing in this guide sends
you there.

- [The nine screens](#the-nine-screens)
- [Where the configuration lives](#where-the-configuration-lives)
- [Channels](#channels-the-onoff-switch)
- [Providers](#providers)
- [Events: the vocabulary](#events-the-vocabulary)
- [Routing: who gets told what](#routing-who-gets-told-what)
- [Templates](#templates)
- [Preferences and consent](#preferences-and-consent)
- [Logs: what actually happened](#logs-what-actually-happened)
- [Delivery receipts](#delivery-receipts)
- [Who can do what](#who-can-do-what)
- [What still needs a deployer](#what-still-needs-a-deployer)

---

## The nine screens

Configurator → **Notifications**:

They are listed here in the order the menu shows them, which is the order a new
city needs them: an account to send with, a channel to send on, then what to say.

| Screen | What it holds | Stored in |
|---|---|---|
| **Providers** | The gateway accounts and their credentials | Novu |
| **Channels** | One row per channel: on/off, and which provider serves it | MDMS `NOTIFICATIONS.Channel` |
| **Configure** | The guided setup: pick a module, see its events, add and edit notifications inline, and validate the lot | — |
| **Events** | What each module can notify about, the people each event carries, and the placeholders it fills. **Read-only** | MDMS `NOTIFICATIONS.EventCatalogue` |
| **Templates** | The message text, per event, audience, channel and language | MDMS `NOTIFICATIONS.Template` |
| **Routing** | Who is notified about which event, on which channel | MDMS `NOTIFICATIONS.Routing` |
| **Provider Templates (WhatsApp)** | Approved WhatsApp templates mapped to your routing keys | MDMS `NOTIFICATIONS.ProviderTemplate` |
| **Logs** | Every message the system tried to send | `nb_dispatch_log` in Postgres |
| **User Preferences** | Each user's language and per-channel consent | `digit-user-preferences-service` |

The menu entries drop the word "Notification" — the menu already says it. Each
screen's own title spells it out in full, so a page read on its own is still
unambiguous.

A message is delivered only when **all four** of channel, routing, template and
provider line up. Anything missing shows on the Logs screen as a `SKIPPED` row
with a reason, never as silence — start there when something is not arriving.

**Use Configure for day-to-day work.** It edits routing and template together, one
event at a time, so the two halves cannot drift apart. The per-master screens exist
for bulk work and for fields Configure does not expose.

---

## Where the configuration lives

Notification configuration is shared across modules and lives in the MDMS
namespace **`NOTIFICATIONS.*`**, held at the **state** tenant. Complaints are one
module among several; the screens are not complaint-specific any more.

### The old masters are still there, read-only

Before this release the same configuration lived in `RAINMAKER-PGR.Notification*`
and was keyed on the complaint workflow's own vocabulary. Those rows are **kept,
never deleted**. In the Configurator they appear under the **Advanced** section
(not the Notifications menu) labelled "Legacy (PGR) …", each carrying a
**Read-only** notice:

> Notification configuration has moved to the shared NOTIFICATIONS.* masters,
> which every module uses — see Notifications → Configure. These rows are kept and
> still read by the notification service on a tenant whose copy step has not run
> yet, so they are shown here, read-only; they are never deleted. To move them,
> re-run the notification seed step (`./deploy.sh <tenant> --tags notifications`):
> it copies what this tenant actually has, is additive, and leaves these rows
> untouched.

### If your city has not been copied yet

You will see a banner on Configure and on the Channels card:

> **This tenant has not been migrated yet — shown read-only**
>
> …this tenant still has N rows only in the old RAINMAKER-PGR.Notification*
> masters. They are shown here translated into the new vocabulary, exactly as the
> notification service reads them, so what you see is what is delivered — but they
> cannot be edited from this screen…

That is not a fault. Until the copy runs, your old rows **are** the live
configuration and the notification service reads them through a translator, so
nothing has stopped. The screens refuse to write, though, because a city edited in
both places has two answers to "what is configured" and the copy would then keep
the pre-edit values.

Ask a deployer to run `./deploy.sh <tenant> --tags notifications`. It is additive,
it copies **your** rows rather than the shipped defaults, and it never deletes or
changes a legacy row.

A third banner, **"No notification configuration on this tenant"**, means nothing
has ever been seeded here. Same command.

### Which one is a city actually on?

There is no setting to read. **The data chooses**, per city, all or nothing — so
that no deployment overlay can flip it by accident. The cost is that two cities on
the same build can legitimately differ, and this is how you see which:

```
GET /novu-bridge/novu-adapter/v1/config/source?tenantId=mycity
```

It answers one entry per master with the schema code actually read, how many rows
it found, whether the legacy translator served it, and whether the rows came from
a cache entry past its lifetime because MDMS could not be reached.

---

## Channels: the on/off switch

One row per channel (SMS, WHATSAPP, EMAIL), held at the **state tenant** and read
on every dispatch (cached about a minute, so a change takes effect within one).

| Field | Meaning |
|---|---|
| `enabled` | Off means every message on this channel is recorded `SKIPPED / NB_NO_PROVIDER` and never sent. This is the master switch. |
| `provider` | Which configured provider serves this channel. Set it from the **Channels** card on the Providers screen, not by typing here. |
| `gateway`, `senderId` | The pre-provider direct-SMS route. Ignored once a provider is selected. |

**SMS also carries login OTPs.** If the deployment uses real one-time passwords,
switching SMS off stops people logging in with a phone number, and those OTPs land
as `SKIPPED / NB_NO_PROVIDER`. The Channels card says so on the screen.

**One provider per channel. No failover.** Picking a second replaces the first;
there is no fan-out and no fallback chain. If you need a standby gateway,
switching is a deliberate act. There is also no way to give one city a different
provider from another city in the same state — the policy is held at the state
level.

Two situations worth recognising:

- **No provider selected.** The deployment's own settings apply instead. Existing
  deployments keep working exactly as before, which is why the provider catalog
  was safe to add — but Validate flags it (`channel-needs-provider`) so the choice
  becomes explicit.
- **A provider that is missing, disabled or on the wrong channel.** Nothing is
  delivered and nothing is retried; the message is recorded
  `SKIPPED / NB_PROVIDER_UNAVAILABLE` with the identifier and reason. It is
  deliberately **not** reported as sent — the delivery engine accepts a trigger
  naming an unusable integration and then fails it internally, and a phantom
  `SENT` is the worst possible outcome. Fix it on Channels or Providers; the next
  message picks it up.

**You must be scoped to the state tenant to change channel policy.** Logged in
against a city, the Enable/Disable buttons are disabled and the card tells you so.

---

## Providers

Five types ship ready to configure. You enter credentials; everything else — which
delivery provider backs it, how the credential form maps, what URL it posts to —
is filled in for you.

| Type | Channel | Notes |
|---|---|---|
| Twilio SMS | SMS | |
| Twilio WhatsApp | WHATSAPP | Needs approved provider templates before anything sends |
| Email (SMTP) | EMAIL | On Gmail / Microsoft 365 use an **app password**, not the account password |
| SMSCountry | SMS | Reached through an internal adapter; India also needs DLT-registered templates |
| Ozeki SMS Gateway | SMS | A gateway you run yourself |

Field-by-field instructions for each: [setup-guide.md](./setup-guide.md#3-add-a-provider).

**Credentials only ever live in Novu.** The Configurator posts them to the
notification service, which stores them there. They are never written to MDMS,
never written to the deployment's `.env`, never logged, and never returned by a
read. Editing a provider shows you the non-secret fields and an empty secret field
to re-enter.

**Rotating a credential replaces the whole set.** The store overwrites rather than
merges, so **Rotate credentials** asks for every field again. Half-filling it
would silently blank the rest, which is why the complete set is validated before
anything is sent.

**Deleting a provider in use is refused** (`NB_PROVIDER_IN_USE`, HTTP 409). Point
the channel at another provider first. The refusal is the point: the delete would
succeed in Novu and every message on that channel would start failing.

### Verify and test-send

- **Verify** confirms the integration exists and is active. It does **not** prove
  the credentials work — SMSCountry and Ozeki have no credential-check call at all
  and honestly advertise that they cannot be verified.
- **Test** delivers a real message. It writes one row to the Logs screen, flagged
  as a test, at your own tenant. Tests are auditable and never counted as real
  traffic; set the **Test sends** filter to *Show test sends* to see them.

A test exercises the provider and its credentials only. It does not exercise your
routing, your templates or the channel switch.

### WhatsApp: approved templates are not optional

A business-initiated WhatsApp message must reference a template the provider has
approved. Messages with no approved template are recorded
`SKIPPED / NB_TEMPLATE_NOT_APPROVED` rather than sent free-form, because the
provider would reject them anyway. Use **Sync WhatsApp templates** on the
Providers screen to pull the approved list and match it to your routing rows, then
save the proposed rows on **Provider Templates (WhatsApp)**.

The template IDs that ship belong to the reference demonstration account and will
not work on yours.

---

## Events: the vocabulary

**Notifications → Events** lists what each module can notify about. One row per
event, giving:

| Column | What it is |
|---|---|
| Module | Which module fires it |
| Event | The key, e.g. `COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME` |
| Label | The readable name, e.g. "Complaint assigned (PENDINGATLME)" |
| Entity type | What the reference number names, e.g. `COMPLAINT` |
| Actors | The named people the event carries — for complaints, `citizen` and `assignee` |
| Placeholders | The `{tokens}` this event can fill |
| Channels | Which channels this event may be routed to |

**This screen is read-only**, and the notice on it says why:

> Events are declared by the module that produces them — PGR's rows are generated
> from its workflow at seed time — so they are shown here but not edited here. A
> new event arrives with the module that fires it.

Fourteen complaint events ship: filed, assigned, reassigned, rejected, resolved,
reopened, rated (two outcomes), escalated, and comments added in five states.

This screen is the authority for two things the other screens check against: which
actor names an audience may use, and which `{tokens}` a template may use. If a
token is not listed for an event, it will ship as literal braces.

---

## Routing: who gets told what

One row per `(event, audience, channel)`. It answers "when this happens, who hears
about it, and how".

| Field | Meaning |
|---|---|
| Module | The owning module. Shown so you can group and filter; it is not part of the key |
| Event | Which event this is about. A picker over the Events screen |
| Audience | Who to tell — see below |
| Channel | SMS, WHATSAPP or EMAIL. Must be a channel you have enabled |

### Audiences

The audience is a reference with a prefix. On the Configure screen you pick a
**Kind** and then the value:

| Kind on screen | Stored as | Means |
|---|---|---|
| *Actor on the event* | `ACTOR:<name>` | A person the event itself names, e.g. `ACTOR:citizen`, `ACTOR:assignee` |
| *Everyone with a role* | `ROLE:<code>` | Every holder of that role in this city, e.g. `ROLE:GRO` |
| *Contacts on the event* | `EVENT_RECIPIENTS` | Contact details carried on the event itself, for recipients with no account |

**+ add a fallback (used only when the one above resolves to nobody)** builds a
chain, stored as `A|B` and shown as *or, if empty:*. The first link that names
somebody wins. `ACTOR:assignee|ROLE:PGR_LME` means "tell whoever it is assigned
to; if nobody is assigned, tell the whole team".

Two audiences never send: `AUTO_ESCALATE` and `SYSTEM`. They are workflow
bookkeeping, not people, and a row on either is dropped.

If your city has not been copied yet you will still see the old bare names.
`CITIZEN` means `ACTOR:citizen` and `EMPLOYEE` means `ACTOR:assignee`; they are
translated the same way at delivery time, so what you see is what is sent.

Each routing row needs a matching template. A routing row with no template sends
nothing — Validate says so, and at delivery time it is
`SKIPPED / NB_NO_TEMPLATE`.

**One message per person per channel.** Someone who holds two notified roles gets
one message, not two.

---

## Templates

Two different things, easy to confuse:

- **Templates** — your message text, one per event × audience ×
  channel × language, with `{placeholders}`. This is what citizens read. See
  [message-templates.md](./message-templates.md) for the placeholder vocabulary,
  the per-language rules and the SMS length arithmetic.
- **Provider Templates (WhatsApp)** — the WhatsApp templates the provider has
  **approved**, mapped to your routing keys. You do not write the text here; you
  record which approved template id corresponds to which of your messages.

A third thing used to be called Templates too and is not one: **Delivery
workflows**, a row action on the Providers screen, lists the delivery plumbing
configured in Novu. Nothing you read there is a message.

Every routing row needs a template in `en_IN`, because that is the fallback every
recipient lands on when their own language has none. A template only in another
language is not enough.

---

## Preferences and consent

Per user: their preferred language, and a per-channel consent record. Read-only on
this screen — citizens set it from their own profile.

When the consent gate is on, a message to someone who has not granted that channel
is recorded `SKIPPED / NB_PREFERENCE_DENIED`. That is consent working, not a
fault.

**An outage is not a refusal.** If the preferences service cannot be reached, the
default is to allow delivery rather than block it. A check that could not be
performed is not a citizen saying no. A deployer can invert that
(`novu_bridge_preference_fail_open`).

**Language and placeholder values behave differently.** Each recipient gets the
*template text* in their own language where one exists. The *values* substituted
into it are resolved once for the whole event, in one language — so in a
two-language fan-out both people get their own wording around the same substituted
values. That is deliberate and unchanged from before.

---

## Logs: what actually happened

Every attempt lands here with an explicit outcome. Filter by **Complaint #**,
**Channel**, **Status** and **Test sends**.

| Status | What it means |
|---|---|
| `Sent (accepted by transport)` | A gateway **accepted** it. Queued, not delivered — that is the strongest honest statement without a receipt. |
| `Delivered` | A delivery receipt confirmed it reached the recipient. |
| `Bounced` | The address was bad (email). |
| `Failed` | The gateway refused it, or a receipt reported final failure. The reason is on the row. |
| `Skipped` | A deliberate decision not to send. |
| `Rejected (bad event)` | The message never formed properly — a producer sent a malformed event, or one the Events screen does not declare. |
| `Received (dry run)` | A validation-only run. Nothing was sent. |

Every `NB_*` code on a row is explained in
[contract/error-codes.md](./contract/error-codes.md), with what to do about it.

### The skip reasons, and which are new

| Code | Meaning | New this release |
|---|---|---|
| `NB_NO_PROVIDER` | The channel is off for this city | |
| `NB_PROVIDER_UNAVAILABLE` | The selected provider is missing, disabled, or on another channel | |
| `NB_CONTACT_MISSING` | The recipient has no phone (SMS/WhatsApp) or no email | also written per recipient on the resolved path |
| `NB_TEMPLATE_NOT_APPROVED` | WhatsApp with no approved provider template | |
| `NB_PREFERENCE_DENIED` | The recipient has not consented to this channel | |
| `NB_NO_ROUTING` | Nobody is configured to be told about this event | **yes** |
| `NB_NO_RECIPIENTS` | Routing matched, but every audience named nobody | **yes** |
| `NB_NO_TEMPLATE` | A routing row with no wording, in the recipient's language or in `en_IN` | **yes** |
| `NB_UNKNOWN_AUDIENCE_SCHEME` | A routing row's audience uses a prefix with no meaning | **yes** |
| `NB_RECIPIENT_LIMIT_EXCEEDED` | One event would have fanned out past the cap; **nothing was delivered** | **yes** |
| `NB_EVENT_NOT_IN_CATALOGUE` | A module fired an event that is not on the Events screen. Recorded `Rejected` | **yes** |

The five new ones are outcomes that used to be a log line on a server and a
silently dropped message. They are now rows, which is the point: "nothing
happened" is now something you can read rather than something you have to deduce.

### Rows with no channel

Some of those decisions are taken **before** a channel comes into it — nobody to
tell, nobody found, an unreadable audience. Those rows show a Channel of *No
channel* and a recipient of *none*: there was no one to send to, so nothing was
sent.

The **Channel** filter offers **No channel (nothing sent)** as a choice, so you
can list exactly those rows.

### Other things to know

**Recipient details are masked.** Phone numbers and email addresses are hidden
before the data leaves the server, not in the browser — the full value never
crosses the wire.

**There are no automatic retries.** A failed message is one row and one entry on
the dead-letter queue. Fixing the cause does not resend it; nor does re-enabling a
channel resend what was skipped while it was off. Those messages were never queued
anywhere.

**Every row records which half produced it**, in the **Produced by** column:
*Sent as finished message* when the producing module sent finished words,
*Routed by notifications* when the notification service chose the recipients and
filled your template. The filter of the same name narrows the list to one of
them; the API parameter behind it is `sourcePath`
(`GET /novu-adapter/v1/logs?...&sourcePath=RESOLVED`).

---

## Delivery receipts

A row only moves past `SENT` when the provider tells us what happened. That
requires a deployer to have set a receipts secret and given the provider a
callback URL — if `DELIVERED` never appears anywhere, that is why, and it is a
deployment task, not a Configurator one.

A late or duplicate report can never move a row backwards.

---

## Who can do what

Two role tiers, both configured at deploy time.

| Tier | Can | Default roles |
|---|---|---|
| **Use** | Read the Logs, Providers and Preferences screens; verify a provider; send a test | `EMPLOYEE`, `SUPERUSER`, `GRO`, `PGR_LME`, `MDMS_ADMIN` |
| **Manage** | Create a provider, rotate its credentials, delete it; dry-run an event with `/dispatch/_resolve` | `SUPERUSER`, `MDMS_ADMIN`, `ACCOUNT_ADMIN` |

Without a Manage role those actions answer `403 NB_ADMIN_ROLE_REQUIRED`, even with
every Use role. Rotating an SMS gateway password is a config-admin act; a
grievance officer holding a Logs-screen role must not be able to do it. A Manage
role also satisfies the Use tier.

`/dispatch/_resolve` is on the Manage tier because it expands role pools and
returns contact details for every holder of a role — broader than the Logs screen
should hand out.

Editing the configuration masters (Channels, Routing, Templates, Provider
Templates) is governed separately, by the usual MDMS role-actions.

---

## What still needs a deployer

Everything here is a one-time shell job on the server. See the
[runbook](./README.md).

| Task | Why it is not in the Configurator |
|---|---|
| Turning the notification stack on (`enable_novu`) | Starts services |
| Minting and wiring the Novu API key | A deployment secret |
| Installing or copying the configuration masters (`--tags notifications`) | Writes MDMS schemas and permissions |
| Naming the roles for the two tiers above | Security configuration |
| The bootstrap channel fallback for cities with no rows | Only applies before any operator has configured anything |
| The delivery-receipts secret and the provider's callback URL | A shared secret between two machines |
| The consent gate's on/off and its outage policy | Changes the meaning of every send |
| Creating the delivery workflows | Delivery plumbing, not configuration |
| Adding a new producing module to the event-type allowlist | Onboarding a producer is deliberate, with a diff |

---

## See also

- [setup-guide.md](./setup-guide.md) — the first-time path, start to finish
- [message-templates.md](./message-templates.md) — writing the message text, and every validation rule
- [README.md](./README.md) — the deployment runbook and the upgrade path
- [developer-guide.md](./developer-guide.md) — adding a provider or connecting another module
- [contract/error-codes.md](./contract/error-codes.md) — every code on the Logs screen
