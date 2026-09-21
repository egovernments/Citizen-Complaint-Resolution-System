# Operator guide: running notifications

What you can change from the Configurator, where each thing lives, and what still needs a
deployer. For turning notifications **on** in the first place, see the
[deployment runbook](./README.md) — that is a one-time job and it is the only part that needs
a shell.

**You never need the Novu dashboard.** Every provider operation is on the Providers screen.
`/novu` is left up for debugging and nothing in this guide sends you there.

- [The eight screens](#the-eight-screens)
- [Channels](#channels-the-on-off-switch)
- [Providers](#providers)
- [Routing: who gets told what](#routing-who-gets-told-what)
- [Templates](#templates)
- [Preferences and consent](#preferences-and-consent)
- [Logs](#logs-what-actually-happened)
- [Delivery receipts](#delivery-receipts)
- [Who can do what](#who-can-do-what)
- [What still needs a deployer](#what-still-needs-a-deployer)

---

## The eight screens

Configurator → **Notifications**:

| Screen | What it holds | Stored in |
|---|---|---|
| **Configure** | The guided setup: a findings list that tells you what is missing and walks you through it | — |
| **Channels** | One row per channel: on/off, and which provider serves it | MDMS `RAINMAKER-PGR.NotificationChannel` |
| **Routing** | Who is notified on which workflow transition, on which channel | MDMS `RAINMAKER-PGR.NotificationRouting` |
| **Templates** | The message text, per audience, transition, channel and language | MDMS `RAINMAKER-PGR.NotificationTemplate` |
| **Provider templates** | Approved WhatsApp templates mapped to routing keys | MDMS `RAINMAKER-PGR.NotificationProviderTemplate` |
| **Providers** | The gateway accounts and their credentials | Novu |
| **Logs** | Every message the system tried to send | `nb_dispatch_log` in Postgres |
| **Preferences** | Each user's language and per-channel consent | `digit-user-preferences-service` |

The order matters. A message is delivered only when **all four** of channel, routing, template
and provider line up. Anything missing shows on Logs as a `SKIPPED` row with a reason, never as
silence — start there when something is not arriving.

---

## Channels: the on/off switch

One row per channel (SMS, WHATSAPP, EMAIL), held at the **state tenant** and read by the bridge
on every dispatch (cached 60 seconds, so a change takes effect within a minute).

| Field | Meaning |
|---|---|
| `enabled` | Off means every message on this channel is recorded `SKIPPED / NB_NO_PROVIDER` and never sent. This is the master switch. |
| `provider` | Which configured provider serves this channel. Set it from **Providers → Channels**, not by typing here. |
| `gateway`, `senderId` | Legacy fields for the pre-provider direct-SMS route. Ignored once a provider is selected. |

**One provider per channel. No failover.** Picking a second replaces the first; there is no
fan-out and no fallback chain. If you need a standby gateway, switching is a deliberate act.

Two situations worth recognising:

- **No provider selected.** The deployment's environment fallbacks apply instead. Existing
  deployments keep working exactly as before, which is why the catalog was safe to add — but
  the Configure screen flags it (`channel-needs-provider`) so the choice becomes explicit.
- **A provider that is missing, disabled or on the wrong channel.** Nothing is delivered and
  nothing is retried; the message is recorded `SKIPPED / NB_PROVIDER_UNAVAILABLE` with the
  identifier and reason. It is deliberately **not** reported as sent — Novu accepts a trigger
  naming an unusable integration and then fails it internally, and a phantom `SENT` is the
  worst possible outcome. Fix it on Channels or Providers; the next message picks it up.

---

## Providers

Five types ship ready to configure. You enter credentials; everything else — which Novu
provider backs it, how the credential form maps, what URL it posts to — is filled in for you.

| Type | Channel | Notes |
|---|---|---|
| Twilio SMS | SMS | |
| Twilio WhatsApp | WHATSAPP | Needs approved provider templates before anything sends |
| Email (SMTP) | EMAIL | On Gmail / Microsoft 365 use an **app password**, not the account password |
| SMSCountry | SMS | Reached through an internal adapter; India also needs DLT-registered templates |
| Ozeki | SMS | |

**Credentials only ever live in Novu.** The Configurator posts them to `novu-bridge`, which
stores them as a Novu integration. They are never written to MDMS, never written to the
deployment's `.env`, never logged, and never returned by a read. Editing a provider shows you
the non-secret fields and an empty secret field to re-enter.

**Rotating a credential replaces the whole set.** Novu overwrites rather than merges, so the
form asks for every field again. Half-filling it would silently blank the rest, which is why
the bridge validates the complete set before anything is sent.

**Deleting a provider in use is refused** (`NB_PROVIDER_IN_USE`, HTTP 409). Point the channel
at another provider first. The refusal is the point: the delete would succeed in Novu and every
message on that channel would start failing.

### Verify and test-send

- **Verify** confirms the integration exists and is active. It does **not** prove the
  credentials work — SMSCountry and Ozeki have no credential-check call at all and honestly
  advertise that they cannot be verified.
- **Test-send** delivers a real message. It writes one row to the Logs, flagged as a test, at
  your own tenant. Tests are auditable and never counted as real traffic; tick "include test
  rows" on Logs to see them.

### WhatsApp: approved templates are not optional

A business-initiated WhatsApp message must reference a template the provider has approved.
Messages with no approved template are recorded `SKIPPED / NB_TEMPLATE_NOT_APPROVED` rather
than sent free-form, because the provider would reject them anyway. Use **Sync Twilio
templates** on the Providers screen to pull the approved list and match it to your routing
keys, then save the proposed rows on **Provider templates**.

---

## Routing: who gets told what

One row per `(businessService, action, toState, audience, channel)`. It answers "when a
complaint is assigned, who hears about it, and how".

| Field | Meaning |
|---|---|
| `action` + `toState` | Which workflow transition this is. `toState` is what separates two transitions sharing an action (`RATE → CLOSEDAFTERRESOLUTION` vs `RATE → CLOSEDAFTERREJECTION`). |
| `audience` | `CITIZEN` (the person who filed it), a role code such as `GRO` or `PGR_LME` (every holder of that role), or `EMPLOYEE` (a legacy alias for the current assignee). |
| `channel` | SMS, WHATSAPP or EMAIL. Must be a channel you have enabled. |
| `fromState` | **Leave blank.** It is not enforced at runtime; a value here matches every transition into `toState`, which is rarely what anyone means. |

Each routing row joins 1:1 with a template row. A routing row with no matching template sends
nothing — the Configure screen's findings list will say so.

---

## Templates

Two different things, easy to confuse:

- **Templates** — your message text, one per audience × transition × channel × language, with
  placeholders. This is what citizens read. See
  [message-templates.md](./message-templates.md) for the placeholder vocabulary, the
  per-language rules and the SMS length arithmetic.
- **Provider templates** — the WhatsApp templates Meta/Twilio have **approved**, mapped to your
  routing keys. You do not write the text here; you record which approved template id
  corresponds to which of your messages.

---

## Preferences and consent

Per user: their preferred language, and a per-channel consent record. Read-only on this screen
— citizens set it from their own profile.

When the consent gate is on, a message to someone who has not granted that channel is recorded
`SKIPPED / NB_PREFERENCE_DENIED`. That is consent working, not a fault.

**An outage is not a refusal.** If the preferences service cannot be reached, the default is to
allow delivery rather than block it. A check that could not be performed is not a citizen
saying no. A deployer can invert that (`novu_bridge_preference_fail_open`).

---

## Logs: what actually happened

Every attempt lands here with an explicit outcome. Filter by reference number (exactly or by
prefix), transaction id, channel or status.

| Status | What it means |
|---|---|
| `SENT` | A gateway **accepted** it. Queued, not delivered — that is the strongest honest statement without a receipt. |
| `DELIVERED` | A delivery receipt confirmed it reached the recipient. |
| `BOUNCED` | The address was bad (email). |
| `FAILED` | The gateway refused it, or a receipt reported final failure. The reason is on the row. |
| `SKIPPED` | A deliberate decision not to send: consent denied, channel off, no contact for that channel, no approved WhatsApp template, provider unusable. |
| `REJECTED` | The message never formed properly — a producer sent a malformed event. |
| `RECEIVED` | A validation-only run. Nothing was sent. |

Every `NB_*` code on a row is explained in
[contract/error-codes.md](./contract/error-codes.md), with what to do about it.

**Recipient details are masked.** Phone numbers and email addresses are hidden before the data
leaves the server, not in the browser — the full value never crosses the wire.

**There are no automatic retries.** A failed message is one row and one entry on the
dead-letter queue. Fixing the cause does not resend it; nor does re-enabling a channel resend
what was skipped while it was off. Those messages were never queued anywhere.

---

## Delivery receipts

A row only moves past `SENT` when the provider tells us what happened. That requires a deployer
to have set a receipts secret and given the provider a callback URL — if `DELIVERED` never
appears anywhere, that is why, and it is a deployment task, not a Configurator one.

A late or duplicate report can never move a row backwards.

---

## Who can do what

Two role tiers, both configured at deploy time.

| Tier | Can | Default roles |
|---|---|---|
| **Use** | Read Logs, Providers, Preferences; verify a provider; send a test | `EMPLOYEE`, `SUPERUSER`, `GRO`, `PGR_LME`, `MDMS_ADMIN` |
| **Manage** | Create a provider, rotate its credentials, delete it | `SUPERUSER`, `MDMS_ADMIN`, `ACCOUNT_ADMIN` |

Without a Manage role those three actions answer `403 NB_ADMIN_ROLE_REQUIRED`, even with every
Use role. Rotating an SMS gateway password is a config-admin act; a grievance officer holding a
Logs-screen role must not be able to do it. A Manage role also satisfies the Use tier.

Editing the MDMS masters (Channels, Routing, Templates) is governed separately, by the usual
MDMS role-actions.

---

## What still needs a deployer

Everything here is a one-time shell job on the server. See the
[runbook](./README.md).

| Task | Why it is not in the Configurator |
|---|---|
| Turning the notification stack on (`enable_novu`) | Starts services |
| Minting and wiring the Novu API key | A deployment secret |
| Naming the roles for the two tiers above | Security configuration |
| The bootstrap channel fallback for tenants with no rows | Only applies before any operator has configured anything |
| The delivery-receipts secret and the provider's callback URL | A shared secret between two machines |
| The consent gate's on/off and its outage policy | Changes the meaning of every send |
| Creating Novu workflows | Delivery plumbing, not configuration |

---

## See also

- [Deployment runbook](./README.md) — turning it on, per channel
- [message-templates.md](./message-templates.md) — writing the message text
- [developer-guide.md](./developer-guide.md) — adding a provider or a new kind of notification
- [contract/error-codes.md](./contract/error-codes.md) — every code on the Logs screen
