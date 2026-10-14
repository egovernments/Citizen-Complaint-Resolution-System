# What's new in notifications (2.12 → 2.20)

A product-level summary of the notification changes in 2.20, for product managers and anyone
deciding how to roll them out. It explains what changed for each kind of user and what is not
done yet. The guides linked in each section have the setup steps and technical detail.

## In short

- **Notifications are a module of their own, run from the Configurator.** In 2.12, most complaint
  wording was built into the software, and SMS and WhatsApp gateways were set up on the server.
  In 2.20, admins add SMS, WhatsApp and email accounts from six supported providers, choose which
  one each channel uses, and edit every message per event, audience, channel and language. Each
  change is checked before it is saved.
- **Each new workspace** (a customer that signs itself up) starts with default wording and
  routing, and, where per-workspace accounts are on, its own **notification account**: the place
  its provider credentials live, managed only by its own admins. They are on by default when the
  Ansible deploy runs notifications and self-serve sign-up, off when Docker Compose is started by
  hand, and opt-in on Kubernetes. Other tenants (a tenant is one customer's configuration, such
  as a state and its cities) share the deployment's account, as before.
- **Citizens and employees** get the same kinds of messages as before, with phone numbers
  completed with a country code. **Operators** can see what happened to each message,
  including the ones deliberately not sent, and why.
- **For the platform**, any module can notify people by announcing "this happened". The
  notification module decides who is told, how and in which language, so other modules and
  products can reuse it rather than build their own.
- **Not yet: citizen phone sign-in**, whose codes do not go through notifications yet
  ([Known limits](#known-limits)).

## Before and after

| Area | 2.12 | 2.20 |
|---|---|---|
| Where message wording lives | Built into the software on most deployments; configurable only on deployments that opted in | Editable in **Notifications → Configure**, per event, audience (who receives it), channel and language. Neutral defaults (no sender signature or honorific) in English, plus Hindi for citizen messages |
| Supported providers | Documented setups: SMSCountry for SMS (sent directly, set on the server), Twilio for WhatsApp, an SMTP mailbox for email | Six: **Twilio SMS, Twilio WhatsApp, Email (SMTP), SMSCountry, Ozeki, Jasmin** |
| Whose provider accounts | One set for the whole deployment | Where per-workspace accounts are on, each new workspace gets its own at sign-up. Two workspaces can use the same provider with separate accounts and cannot use or change each other's credentials. Other tenants share the deployment's account until an operator moves them |
| Who sets providers up, and where | Server settings and a redeploy for SMS and WhatsApp. The Configurator could add an account (in practice email) but could not edit, rotate or delete one | **Notifications → Providers**, with a form per provider type: add, rename, change credentials, switch off, delete. A workspace's own admins manage its own account. The shared account is managed by the admins of the state that owns it (the deployment's main state, plus any the operator names) |
| Which provider a channel uses | Fixed by server settings. Channels were switched on or off on the server | **Notifications → Channels**: one active provider per channel per state or workspace, changed only by an admin. Takes effect within about a minute |
| Sign-in codes (OTP) | A separate SMS service with its own setup; wording not editable from the Configurator | Citizen sign-in moved to the new sign-in service, which does not use notifications yet. Where a deployment still uses DIGIT's older OTP service, its codes go through the same SMS channel, provider and log as other SMS, and their wording is editable per language |
| When nothing can send | A message whose channel was off was already marked "Skipped" | Also when a channel is on but has no usable provider (none added, or the chosen one deleted or switched off): marked **Skipped**, with the reason *provider unavailable*, not "Sent" |
| Checking a provider | **Verify** and **Test** on the Providers screen | **Check status** (does not prove the credentials) and **Test**, which sends one real message and is refused, with the reason, when nothing could deliver it. Test messages are flagged in the log and hidden unless asked for |
| Delivery log | Complaint number, channel and status filters, recipients masked | Adds delivery confirmation where the provider reports back (**Delivered**, **Bounced**, **Failed**), a test-send filter, and which messages a module wrote itself. One masking rule on screen and in the API: user ids in full, a phone as its last three digits (`+***678`), an email as its first letter and domain (`c***@example.org`) |
| Checking templates | A **Validate** button on Configure | The same checks run on **every save**: errors block the save, warnings inform |
| WhatsApp templates | Sync approved templates from Twilio | Same, plus a save-time check that the message's placeholders match the approved template's variables |
| Languages | One language for every recipient: the deployment's default | The deployment's default (English), unless the deployment lets citizens choose a language on their profile, which is off by default. Then each citizen gets their language where a template exists in it |

Detail: [migration.md, "What changes"](./migration.md#what-changes) (technical),
[setup-guide.md](./setup-guide.md), and [tenant-accounts.md](./tenant-accounts.md) for
per-workspace accounts.

## What each person can now do

### Operators and admins (Configurator → Notifications)

| Screen | What it is for |
|---|---|
| **Providers** | Add a provider account (pick the type, enter its credentials), **Check status**, **Test**, rename, rotate credentials, switch off or on, delete. Also **Sync WhatsApp templates**. On a workspace with its own notification account, a banner says so and the list holds only its providers. A workspace still waiting for its account is told why it cannot add providers yet |
| **Channels** | Switch SMS, WhatsApp and email on or off and choose the provider each one sends through. A status card says in plain words what is wrong, for example "on but no provider is selected" |
| **Configure** | The day-to-day editor: pick a module, then for each event choose who is told on which channel and edit the wording. **Validate** checks everything. The **Login and registration OTP (SMS)** section edits the wording of codes from DIGIT's older OTP service, where a deployment still uses it |
| **Events** | Read-only list of what can trigger a message, who the event names (for example the citizen or the assigned employee) and which placeholders such as `{id}` the wording may use |
| **Routing**, **Templates**, **Provider Templates (WhatsApp)** | Table views of the same configuration, for bulk review |
| **Logs** | Every message attempt and its outcome, with the reason for anything skipped or failed. User ids are shown in full; phone numbers and email addresses are masked |
| **User Preferences** | Read-only view of each user's language and channel consent |

Things operators can rely on:

- **Credentials stay in the delivery engine** (the notification service underneath that talks
  to providers), never in the configuration or the logs, and are never shown back in the
  browser. A workspace's credentials sit in its own account, out of other workspaces' reach.
- **Only the right admins can change provider accounts**, and the notification module checks
  this itself, not just the screen. On a workspace with its own account, only its own admins
  (the person who signed it up is one), not even the admins of the state that owns the shared
  account. On the shared account, the admins of that state.
- **Channel choices** (which channels are on, and which provider each uses) are part of a state's
  or workspace's configuration. The Configurator offers these controls only to its admins, and on
  a workspace with its own account only to that workspace's own admins. This is a rule of the
  screen: someone allowed to edit that configuration directly through the API (a superuser, for
  example) can still change it. Provider credentials are the hard boundary.
- Everyone else with notification access sees these screens read-only, without the buttons.
- **A new workspace is ready to configure from sign-up.** It gets the default events, wording
  and routing, and the person who signed it up can use the Notifications screens once the
  workspace has finished onboarding (the Configurator keeps it there until every step is done).
  Its channels stay off until a provider is added and the channel switched on, unless the
  deployment switches a channel on for everyone. If the delivery engine is down at sign-up, the
  workspace is still created and gets its own account automatically later.
- **A provider in use cannot be switched off or deleted by mistake.** Point the channel at
  another provider first.
- **A Test does not report success for a message nothing could deliver.** If the provider is
  switched off or serves another channel, or the channel has no provider, the Test is refused
  with the reason and nothing is sent. This check needs the delivery engine's provider list:
  when that cannot be read, the Test is sent anyway, with a warning. A Test through the shared
  account's older direct SMSCountry connection is not checked; that gateway reports its own
  errors. A workspace's Test is judged against its own providers only, never the shared
  account's.
- **Phone numbers get a country code before anything is sent.** A number stored without one is
  completed with the person's own code, else the state's or workspace's mobile-number rule, else
  the deployment's default. With none of these, the message is skipped as an invalid contact and
  the log says why. Two cases can still go wrong: the deployment's default is a guess for
  someone from another country, and a long local number that happens to start with the country
  code can be read as already international. A mobile-number rule that includes the number
  pattern resolves most of the second.
- **Saving refuses the mistakes that would break a message**, for example a message with no
  English version, placeholder braces that cannot be filled in (`{{id}}`, an unclosed `{`), a
  WhatsApp message that uses a variable its approved template does not have, or OTP wording that
  leaves out the code. Other problems only **warn**, and the save goes ahead: a placeholder the
  event does not provide (a misspelt `{emp_nme}` is sent as typed), an approved-template
  variable the event cannot fill (sent empty), a WhatsApp message with no approved template
  (skipped when sent), or an SMS long enough to cost several messages.

Guides: [setup-guide.md §3 Add a provider](./setup-guide.md#3-add-a-provider),
[§4 Switch the channel on](./setup-guide.md#4-switch-the-channel-on),
[§5 Configure what is sent](./setup-guide.md#5-configure-what-is-sent),
[§6 Send a test and read the logs](./setup-guide.md#6-send-a-test-and-read-the-logs);
[tenant-accounts.md, "In the Configurator"](./tenant-accounts.md#in-the-configurator).

### Citizens

- By default, an update by SMS, WhatsApp or email when their complaint is **filed, assigned,
  reassigned, rejected, resolved or reopened**, on whichever channels their state or workspace
  switches on.
- Messages in the deployment's default language (English). Where the deployment lets citizens
  choose a language on their profile (off by default), they get the one they chose when a
  template exists in it; the defaults include Hindi.
- SMS and WhatsApp numbers get a country code. A mobile number stored without one gets the
  citizen's own code, else their state's or workspace's, else the deployment's default (a guess
  for a citizen from another country). This includes the first message when an employee files a
  complaint for them. If no code is known, the message is not sent.
- In a workspace with its own account, messages come through that workspace's own provider
  accounts, for example with its own sender name or number.
- Phone sign-in codes do not come through notifications yet ([Known limits](#known-limits)).
- A deployment can also switch on a consent check: a person is then messaged on a channel only
  if their stored preferences agree to it, so anyone with no stored preference gets nothing
  (codes from DIGIT's older OTP service still go out). It is **off** on Docker Compose and
  Ansible deployments, but **on** in the Kubernetes (Helm) chart and in the notification
  service's own default. Leave it off unless the deployment collects that consent: on
  Kubernetes, set `NOVU_BRIDGE_PREFERENCE_ENABLED` to `"false"`, or most messages are skipped.

### Employees

- By default, a message on each switched-on channel when a complaint is **assigned to them** and
  when a citizen **rates** their work. The default wording for staff is English only.
- New tenants' default assignment message greets them as "Dear" and their name, without the old
  office line, which showed a raw placeholder on tenants without districts.
- WhatsApp to staff needs an approved WhatsApp template. None is shipped, so until one is added
  those messages are skipped, and the log says so.

### Developers of other modules

A module sends a **thin event**, a short message that says only *what happened* ("license
renewed", "complaint assigned") and to whom it relates. The notification module then decides
**who** is told, on **which channel**, in **which language** and with **what wording**, all from
configuration that operators edit. The module does not contain any message text or gateway code.

To join, a module lists its events (who they name and what placeholders they carry), ships
default wording, and publishes its events. Complaints are the first module built this way.
Modules that cannot be changed can still send a finished message for one person on one channel.
How to: [developer-guide.md, "Plug a module in"](./developer-guide.md#plug-a-module-in).

A service that only needs to send a sign-in code can ask the notification module to send it, for
a workspace with its own account only (any other tenant gets a "no account" answer). The text is
fixed: the code and when it expires. The answer says what happened: sent, accepted but not yet
confirmed by the provider, no account, no provider for that channel, the provider refused, or the
delivery engine could not be reached or refused the send
([every answer](./tenant-accounts.md#sending-a-code-messages_send)). The notification module
never logs or stores the code; the delivery engine keeps the sent message, code included, in its
own activity feed. Connecting the new sign-in service to it is a separate follow-up.

## Notifications as a reusable module

- **A published interface.** The message formats, the API, every reason code and the log format
  are documented and versioned in [contract/](./contract/README.md), and a running deployment
  serves the same documents.
- **Not tied to complaints.** The naming, configuration and screens are module-neutral. A new
  module joins by declaring its events and default wording, without code changes to the
  notification module.
- **One pipeline.** Every module's messages follow the same channel switches, the same provider
  choice and the same log. Two sends check only that a provider can carry the channel, not
  whether the channel is switched on: a provider **Test**, and the sign-in code send above. Both
  are logged. The new sign-in service's own codes do not go through notifications yet.
- **One deployment, many customers.** Where per-workspace accounts are on, each workspace has its
  own notification account, so customers on one deployment use their own gateways and sender
  names without sharing credentials. Tenants that do not need one keep sharing the deployment's
  account.

## Upgrading an existing 2.12 deployment

- **Deploying 2.20 never copies a tenant's 2.12 configuration, and never adds default wording to
  a tenant that already has some.** It writes only two things: a tenant with no channel on/off
  settings gets settings that match what the server already said, so nothing changes; and a
  fresh install (no notification configuration and no complaints yet) gets the default wording
  and routing. One thing does change for some tenants, described next.
- **A tenant that used 2.12's built-in wording, and already has complaints, gets no complaint
  notifications after the deploy** until an operator reviews and installs the default wording in
  the per-tenant step below. Most 2.12 deployments used the built-in wording. The deploy reports
  which tenants need this.
- **Each tenant is moved separately**, in a reviewed step that an operator runs when ready. It
  first shows a plan of what will be copied and a preview of what each event will send, before
  and after the move.
- **Customizations are kept exactly.** The tenant's own messages and settings are copied as they
  are, and no default messages are added. A tenant still on 2.12's default wording keeps it, old
  signature included, and the plan lists it as customized because it differs from the new
  neutral defaults. Edit the templates on Configure to adopt the new wording.
- **The move is one-way per tenant.** Once moved, a tenant is configured only through the new
  screens.
- **A tenant that already used configurable wording keeps sending as before until it is moved**,
  from its 2.12 configuration. The new screens show that configuration read-only, with a banner.
- **Plan a quiet period** for each tenant's move. For up to about a minute, an event that arrives
  mid-move can be rejected and is not sent. The tool tells you which window to check.
- The move was rehearsed on an earlier 2.20 build (before the last rounds of review fixes and
  before per-workspace accounts), on a copy of a production-like 2.12 configuration (41 routing
  rules, 60 templates, 14 WhatsApp template links) with 8 deliberate customizations added. All
  were kept, the before and after previews matched, and every complaint action produced the
  expected message attempts.
- **Per-workspace accounts** are on by default when the Ansible deploy runs notifications (Novu)
  and self-serve sign-up (Keycloak), unless the deploy cannot sign in as the delivery engine's
  admin (next point). They are off when Docker Compose is started by hand, and opt-in on
  Kubernetes. Only workspaces that sign up afterwards get one automatically; existing tenants
  keep the shared account until an operator moves them, one by one. A moved tenant's account
  starts empty, so its admins must add providers first, or nothing is delivered for it.
- **Where per-workspace accounts are on, the delivery engine's admin password changes**, unless
  the operator set their own: the deploy generates one, keeps it in the deployment's secrets
  store and moves the admin onto it. The operator's dashboard login changes too. The publicly
  documented default password is never handed to the notification module. If the deploy cannot
  sign in as the admin with the password it would hand over (for example, someone changed it by
  hand), it switches per-workspace accounts off for that deploy and says what to do. It stops
  instead if the operator asked for them explicitly or workspaces already have their own.
- **Workspaces signed up on a pre-release build**, before sign-up installed notification
  defaults, or whose set-up step failed, have no notification configuration, so their complaints
  send nothing. The deploy lists them, with a one-off step for each.

Step by step: [migration.md](./migration.md), especially
[§3 Copy each tenant's configuration](./migration.md#3-copy-each-tenants-configuration);
[tenant-accounts.md, "Existing tenants"](./tenant-accounts.md#existing-tenants-backfill);
[setup-guide.md §8.6 New workspaces](./setup-guide.md#86-new-workspaces).

## Adding a new SMS gateway

- **2.20:** a small, documented developer task. If the delivery engine already supports the
  gateway, it takes one catalog entry. If not, it takes **one provider file plus one catalog
  entry**, with their tests. The gateway then appears in **Providers → Add Provider** with its own
  form, without any Configurator changes, for the shared account and every workspace's own.
- **2.12:** possible, but each deployment wired the provider in by hand on its own server, and it
  was chosen by making it the default integration outside the Configurator.

Guides: [adding-a-provider.md](./adding-a-provider.md) (2.20, a worked example),
[providers.md](./providers.md#adding-a-provider) (reference), and
[../../2.12/notifications/adding-an-sms-gateway.md](../../2.12/notifications/adding-an-sms-gateway.md)
(the 2.12 approach).

## Known limits

- **Citizen phone sign-in does not use notifications yet.** Citizens sign in through 2.20's new
  sign-in service. The notification side can already send a sign-in code, but only for a
  workspace with its own account and with fixed text; connecting the two is a follow-up. Until
  then, phone sign-in is unavailable unless the deployment sets up a separate SMS sender (or, for
  development only, a fixed code). The OTP wording on Configure applies only to DIGIT's older
  OTP service.
- **No automatic failover.** If a channel's provider fails, messages fail. Someone has to choose
  another provider on Channels. There are no automatic retries, and switching a channel back on
  does not resend what was skipped.
- **One provider per channel per state or workspace.** A city cannot use a different provider
  from its state or workspace.
- **"Sent" means the gateway accepted the message**, not that it arrived. Delivery confirmation
  only appears where the provider reports back and that is set up on the server. **Twilio
  messages stay "Sent"** even when delivered: Twilio's delivery reports are not yet matched to
  the log. A workspace's own providers also stay "Sent" until the operator sets up their reports.
- **The new screen text is English only** for now (for example Channels, the OTP wording and the
  notification-account banner).
- **Several states sharing the deployment's account.** An admin of one state can rename or change
  the credentials of a shared provider another state uses (switching it off and deleting it are
  protected). Workspaces with their own account are not affected.
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
| Notification account | The account in the delivery engine that holds a tenant's provider credentials and that its messages go through. Where per-workspace accounts are on, each new workspace gets its own at sign-up; other tenants share the deployment's account until an operator moves them. It does not change who receives messages or what they say |
| Mobile-number rule | A tenant's setting for what a valid local mobile number looks like, including its country code. A workspace gets one for the country it signed up in |
| Delivery engine | The open-source notification service (Novu) underneath, which talks to the providers |
| Skipped | A deliberate decision not to send (channel off, no usable provider, no wording, no consent, a number without a known country code, …), with the reason in the log |
| OTP | One-time password, the code texted for sign-in, registration or password reset |
