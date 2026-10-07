# What's new in notifications (2.12 → 2.20)

A product-level summary of the notification changes in 2.20, for product managers and anyone
deciding how to roll them out. It explains what changed for each kind of user and what is not
done yet. The guides linked in each section have the setup steps and technical detail.

## In one paragraph

In 2.12, most of the wording of complaint messages was built into the software, SMS and
WhatsApp gateways were set up on the server, and login one-time passwords (OTPs) were sent by a
separate service. In 2.20, notifications are a **module of their own that operators run from the
Configurator**. Admins add SMS, WhatsApp and email accounts from six supported providers, choose
which one each channel uses, and edit every message per event, recipient and language. Each
change is checked before it is saved. **Each new workspace** (a customer that signs itself up)
gets its own **notification account**, holding provider accounts that only its own admins
manage, and starts with default wording and routing from the moment it signs up. **Citizens and
employees** get the same kinds of messages as before, in their own language where a translation
exists, with phone numbers completed with the right country code. Login OTPs now go through the
same SMS channel as everything else. **Operators** can see what happened to each message,
including ones that were deliberately not sent and why. **For the platform**, any module can
notify people by announcing "this happened". The notification module decides who is told, how
and in which language, so other modules and products can reuse it rather than build their own.

## Before and after

| Area | 2.12 | 2.20 |
|---|---|---|
| Where message wording lives | Built into the software on most deployments; configurable only on deployments that opted in | Editable in **Notifications → Configure**, per event, per audience (who receives it), per channel and per language. English and Hindi defaults for complaints are included, worded neutrally (no sender signature or honorific) so they suit any country |
| Supported providers | Documented setups: SMSCountry for SMS (sent directly, set on the server), Twilio for WhatsApp, an SMTP mailbox for email | Six: **Twilio SMS, Twilio WhatsApp, Email (SMTP), SMSCountry, Ozeki, Jasmin** |
| Whose provider accounts | One set for the whole deployment | **Each new workspace gets its own notification account when it signs up.** Two workspaces can each use their own account with the same provider (two Twilio accounts, say) and never see each other's credentials. Other tenants share the deployment's account, as before, until an operator moves them |
| Who sets providers up, and where | Server settings and a redeploy for SMS and WhatsApp. The Configurator could add an account (in practice email) but could not edit, rotate or delete one | In **Notifications → Providers**: a workspace's own admins for its own account; otherwise the admins of the state that owns the shared account. A form specific to each provider type; rename, change credentials, switch off, delete |
| Which provider a channel uses | Fixed by server settings. Channels were switched on or off on the server | **Notifications → Channels**: one active provider per channel (SMS, WhatsApp, email) per state or workspace, switched on, off or changed by hand. Takes effect within about a minute |
| Login OTP SMS | A separate SMS service with its own setup; wording not editable | Same SMS channel, provider and log as every other SMS, through the workspace's own account where it has one. Wording for login, registration and password-reset OTPs is editable per language |
| Honest status | A message whose channel was off was already marked "Skipped" | Also: if a channel that is on has no usable provider (none added, or the chosen one deleted or switched off), the message is marked **Skipped, provider unavailable**, not "Sent" |
| Checking a provider | **Verify** and **Test** on the Providers screen | **Check status** (says plainly that it does not prove the credentials) and **Test**, which sends one real message. Test messages are flagged in the log and hidden unless asked for |
| Delivery log | Complaint number, channel and status filters, recipients masked | Adds delivery confirmation where the provider reports back (**Delivered**, **Bounced**, **Failed**), a test-send filter, and whether a message was a finished message from a module or built by the notification module. One masking rule on screen and in the API: user ids in full, a phone as its last three digits (`+***678`), an email as its first letter and domain (`c***@example.org`) |
| Checking templates | A **Validate** button on Configure | The same checks run on **every save**: errors block the save, warnings inform |
| WhatsApp templates | Sync approved templates from Twilio | Same, plus a save-time check that the message's placeholders match the approved template's variables |
| Languages | Every recipient got the same language: one default for the whole deployment | Each person gets their profile's preferred language when a template exists in it, otherwise English |

Detail: [migration.md, "What changes"](./migration.md#what-changes) (technical),
[setup-guide.md](./setup-guide.md), and [tenant-accounts.md](./tenant-accounts.md) for
per-workspace accounts.

## What each person can now do

### Operators and admins (Configurator → Notifications)

| Screen | What it is for |
|---|---|
| **Providers** | Add a provider account (pick the type, enter its credentials), **Check status**, **Test**, rename, rotate credentials, switch off or on, delete. Also **Sync WhatsApp templates**. On a workspace with its own notification account, a banner says so and the list holds that workspace's providers only. A workspace still waiting for its account is told why it cannot add providers yet |
| **Channels** | Switch SMS, WhatsApp and email on or off and choose the provider each one sends through. A status card says in plain words what is wrong, for example "on but no provider is selected", or that a channel switched on with no provider skips every message |
| **Configure** | The day-to-day editor: pick a module, then for each event choose who is told on which channel and edit the wording. **Validate** checks everything. The **Login and registration OTP (SMS)** section edits the OTP wording |
| **Events** | Read-only list of what can trigger a message, who the event names (for example the citizen or the assigned employee) and which placeholders such as `{id}` the wording may use |
| **Routing**, **Templates**, **Provider Templates (WhatsApp)** | Table views of the same configuration, for bulk review |
| **Logs** | Every message attempt and its outcome, with the reason for anything skipped or failed. User ids are shown in full; phone numbers and email addresses are masked |
| **User Preferences** | Read-only view of each user's language and channel consent |

Things operators can rely on:

- **Credentials stay in the delivery engine** (the notification service underneath that talks
  to providers). They are never stored in the configuration or the logs, and never shown back
  in the browser. A workspace's credentials sit in its own account, out of every other
  workspace's reach.
- **Only the right admins can change providers and channel choices.** On a workspace with its
  own account, that is the workspace's own admins (the person who signed it up is one), and
  nobody else, not even the admins of the shared account. Elsewhere, it is the admins of the
  state that owns the deployment's shared account. Everyone else with notification access sees
  these screens read-only, without the buttons.
- **A new workspace is ready to configure from sign-up.** It gets the default events, wording
  and routing, and its admins can open the Notifications screens straight away. Its channels stay
  off until its admin adds a provider and switches them on, unless the deployment switches a
  channel on for everyone. If the delivery engine is down at sign-up, the workspace is still
  created and its account is set up automatically later.
- **A provider in use cannot be switched off or deleted by mistake.** Point the channel at
  another provider first.
- **No message goes to a guessed number.** A phone number stored without a country code is
  completed with the person's own code, else the workspace's mobile-number rule, else the
  deployment's default. With none of these, the message is skipped as an invalid contact and
  the log says why.
- **Saving cannot break things silently.** The checks catch, for example, a message with no
  English version, a mistyped placeholder, a WhatsApp message whose variables do not match the
  approved template, or OTP wording that leaves out the code.

Guides: [setup-guide.md §3 Add a provider](./setup-guide.md#3-add-a-provider),
[§4 Switch the channel on](./setup-guide.md#4-switch-the-channel-on),
[§5 Configure what is sent](./setup-guide.md#5-configure-what-is-sent),
[§6 Send a test and read the logs](./setup-guide.md#6-send-a-test-and-read-the-logs);
[tenant-accounts.md, "In the Configurator"](./tenant-accounts.md#in-the-configurator).

### Citizens

- By default, an update by SMS, WhatsApp or email when their complaint is **filed, assigned,
  reassigned, rejected, resolved or reopened**, on whichever channels the deployment switches on.
- The message in the language set on their profile when a template exists in it, otherwise
  English.
- SMS and WhatsApp reach the right number. A mobile number stored without a country code gets
  the citizen's own code, else their workspace's, else the deployment's default. This includes
  the first message when an employee files a complaint for them, and login OTPs. If no code is
  known, the message is not sent rather than sent to a wrong number.
- In a workspace with its own account, messages come through that workspace's own provider
  accounts, for example with its own sender name or number.
- Login, registration and password-reset OTPs on the same SMS provider as everything else. If SMS
  is switched off, phone login stops, and the Channels screen and the logs show why.
- A deployment can also switch on a consent check, so a person who has not agreed to a channel is
  not messaged on it. It is off by default.

### Employees

- By default, a message on each switched-on channel when a complaint is **assigned to them** and
  when a citizen **rates** their work.
- In the default wording for new tenants, the assignment message greets them as "Dear" and
  their name. It no longer has an office line, which showed a raw placeholder on tenants without
  districts.
- WhatsApp to staff needs an approved WhatsApp template. None is shipped, so until one is added
  those messages are skipped, and the log says so.

### Developers of other modules

A module sends a **thin event**, a short message that says only *what happened* ("licence
renewed", "complaint assigned") and to whom it relates. The notification module then decides
**who** is told, on **which channel**, in **which language** and with **what wording**, all from
configuration that operators edit. The module does not contain any message text or gateway code.

To join, a module lists its events (who they name and what placeholders they carry), ships
default wording, and publishes its events. Complaints are the first module built this way.
Modules that cannot be changed can still send a finished message for one person on one channel.
How to: [developer-guide.md, "Plug a module in"](./developer-guide.md#plug-a-module-in).

A service that only needs to send a sign-in code can ask the notification module to send it
through the workspace's own account. It gets a clear answer: sent, no account, no provider for
that channel, or the provider refused. The code is never logged or stored. The new sign-in
service is meant to be the first user; connecting it is a separate follow-up.

## Notifications as a reusable module

- **A published interface.** The message formats, the API, every reason code and the log format
  are documented and versioned in [contract/](./contract/README.md), and a running deployment
  serves the same documents.
- **Not tied to complaints.** The naming, configuration and screens are module-neutral. A new
  module joins by declaring its events and default wording, without code changes to the
  notification module.
- **One pipeline.** Every message, including login OTPs, follows the same channel switches, the
  same provider choice and the same log.
- **One deployment, many customers.** Each workspace has its own notification account, so
  customers on one deployment use their own gateways and sender names without sharing
  credentials. Tenants that do not need one keep sharing the deployment's account.

## Upgrading an existing 2.12 deployment

- **Deploying 2.20 changes the software only.** Nobody's messages change at deploy time.
- **Each tenant is moved separately**, in a reviewed step that an operator runs when ready. It
  first shows a plan of what will be copied and a preview of what each event will send, before
  and after the move. (A tenant here means one customer's configuration, such as a state and its
  cities.)
- **Customisations are kept exactly.** The tenant's own messages and settings are copied as they
  are. Default messages it never had are not added. Wording is kept too: a tenant still on
  2.12's default wording keeps it, old signature included, and the plan lists it as customised
  because it differs from the new neutral defaults. That is expected. Edit the templates on
  Configure to adopt the new wording.
- **The move is one-way per tenant.** Once moved, a tenant is configured only through the new
  screens.
- **A tenant not yet moved keeps sending as before** from its 2.12 configuration. The new screens
  show that configuration read-only, with a banner.
- **A tenant that used 2.12's built-in wording, and already has complaints, gets no complaint
  notifications after the upgrade** until an operator reviews and installs the default wording
  in the same per-tenant step. The deploy reports which tenants need this. Login OTPs are not affected.
- **Plan a quiet period** for each tenant's move. For up to about a minute, an event that arrives
  mid-move can be rejected, and the tool tells you which window to check.
- The process was rehearsed on a copy of a production-like 2.12 configuration (41 routing rules,
  60 templates, 14 WhatsApp template links) with 8 deliberate customisations added. All of them
  were kept, the before and after previews matched, and every complaint action produced the
  expected message attempts.
- **Per-workspace accounts switch on with the upgrade** on deployments that run self-serve
  sign-up (Kubernetes deployments switch them on explicitly). Only workspaces that sign up
  afterwards get their own account automatically. Every existing tenant keeps the shared
  account until an operator moves it, tenant by tenant (a "backfill"). A moved tenant's account
  starts empty, so its admins must add providers before its next message, or nothing is
  delivered for it. An operator can instead switch the feature off and keep everything on the
  shared account.
- **The delivery engine's admin password changes.** It is now generated and kept in the
  deployment's secrets store, and the deploy refuses the publicly documented default. The
  operator's login to the delivery engine's own dashboard changes with it. In that dashboard,
  each workspace appears as a separate organization.
- **Workspaces signed up on a pre-release build**, before sign-up installed notification
  defaults, have no notification configuration, so their complaints send nothing. The same holds
  for a workspace whose set-up step failed. The deploy lists them and prints a one-off step for
  each, run with the sign-in token of one of that workspace's admins.

Step by step: [migration.md](./migration.md), especially
[§3 Copy each tenant's configuration](./migration.md#3-copy-each-tenants-configuration);
[tenant-accounts.md, "Existing tenants"](./tenant-accounts.md#existing-tenants-backfill);
[setup-guide.md §8.6 New workspaces](./setup-guide.md#86-new-workspaces).

## Adding a new SMS gateway

- **2.20:** a small, documented developer task. If the delivery engine already supports the
  gateway, it takes one catalogue entry. If not, it takes **one provider file plus one catalogue
  entry**, with their tests. The gateway then appears in **Providers → Add Provider** with its own
  form, without any Configurator changes, for the shared account and every workspace's own.
- **2.12:** possible, but each deployment wired the provider in by hand on its own server, and it
  was chosen by making it the default integration outside the Configurator.

Guides: [adding-a-provider.md](./adding-a-provider.md) (2.20, a worked example),
[providers.md](./providers.md#adding-a-provider) (reference), and
[../../2.12/notifications/adding-an-sms-gateway.md](../../2.12/notifications/adding-an-sms-gateway.md)
(the 2.12 approach).

## Known limits

- **No automatic failover.** If a channel's provider fails, messages fail. Someone has to choose
  another provider on Channels. There are no automatic retries, and switching a channel back on
  does not resend what was skipped.
- **One provider per channel per state or workspace.** A city cannot use a different provider
  from its state or workspace.
- **"Sent" means the gateway accepted the message**, not that it arrived. Delivery confirmation
  only appears where the provider reports back and that is set up on the server. **Twilio
  messages stay "Sent"** even when delivered, because Twilio's own delivery reports are not
  yet matched to the log. For a workspace's own providers, the platform operator has to set up
  delivery reports for each one; until then their messages also stay "Sent".
- **A Test can report success when nothing can deliver it.** In a workspace's own account with
  no active provider, the delivery engine accepts the test message and then fails it. Check that
  a test message actually arrived.
- **Citizen phone sign-in through the new sign-in service does not use notifications yet.** The
  notification side can already send a sign-in code through the workspace's own account;
  connecting the sign-in service is a separate follow-up. Until then, phone sign-in there is
  unavailable unless the deployment sets up a separate sender or a development-only stand-in.
  OTPs for the existing login are not affected.
- **The new screen text is English only** for now (for example Channels, the OTP wording and the
  notification-account banner).
- **Several states sharing the deployment's account.** Where more than one state manages the
  shared providers, an admin of one state can rename or change the credentials of a provider
  another state uses. Switching it off and deleting it are protected. Workspaces with their own
  account are not affected.
- **WhatsApp needs your own approved templates.** The shipped WhatsApp templates belong to a demo
  account and will not work on yours. A workspace with its own WhatsApp account needs templates
  approved on that account. Approval by Meta takes time, so start early.
- **SMSCountry, Ozeki and Jasmin** were tested end to end against simulated gateways that
  reproduce their real replies. Run a **Test** send on each live account before go-live.

## Glossary

| Term | Meaning |
|---|---|
| Provider | The SMS, email or WhatsApp company or gateway that actually delivers the message (Twilio, SMSCountry, an SMTP mailbox, …) |
| Channel | How a message travels: SMS, WhatsApp or email |
| Event | Something that happened that may warrant a message, e.g. "complaint assigned" |
| Audience | Who an event's message goes to: a person the event names (the citizen, the assignee), everyone with a role, or contacts carried on the event |
| Template | The wording for one event, audience, channel and language. Placeholders like `{id}` are filled in when the message is sent |
| Routing | The rule "when this event happens, tell this audience on this channel" |
| Thin event | A module's short "this happened" notice. The notification module turns it into messages |
| Tenant / state / city | One customer's configuration. Notification settings are held at the top level (a state or a workspace) and apply to its cities |
| Workspace | A tenant created through self-serve sign-up. Its admins, including the person who signed it up, manage it in the Configurator |
| Notification account | The account in the delivery engine that holds a tenant's provider credentials and that its messages go through. Each new workspace gets its own at sign-up; other tenants share the deployment's account until an operator moves them. It does not change who receives messages or what they say |
| Mobile-number rule | A tenant's setting for what a valid local mobile number looks like, including its country code. A workspace gets one for the country it signed up in |
| Delivery engine | The open-source notification service (Novu) underneath, which talks to the providers |
| Skipped | A deliberate decision not to send (channel off, no usable provider, no wording, no consent, a number without a known country code, …), with the reason in the log |
| OTP | One-time password, the code texted for login, registration or password reset |
