# Message Templates and Validation

Who this is for: the person who writes the SMS, WhatsApp and email wording a
citizen actually receives, and who edits it in the Configurator.

It covers what a message is made of on each channel, which `{placeholders}` you
can use and what each one turns into, every rule the checker applies (with how to
fix each one), and what ships out of the box.

You do not need any of this to send the default messages. Everything below already
passes validation as shipped.

New to notifications? Set them up first: [setup-guide.md](./setup-guide.md).

---

## 1. What a message is made of

Notification configuration is five MDMS masters in the shared `NOTIFICATIONS`
namespace, held at the state tenant. Each one is a screen under **Notifications**
in the Configurator.

| Master | Screen | One row per | What it decides |
|---|---|---|---|
| `NOTIFICATIONS.EventCatalogue` | Events | event | WHAT can be notified about — and which actors and `{tokens}` each event carries. **Read-only** |
| `NOTIFICATIONS.Channel` | Channels | channel | Whether SMS / WhatsApp / Email deliver at all, and through which provider |
| `NOTIFICATIONS.Routing` | Notification Routing | (event, audience, channel) | WHO is notified when something happens |
| `NOTIFICATIONS.Template` | Notification Templates | (event, audience, channel, locale) | WHAT the message says, in one language |
| `NOTIFICATIONS.ProviderTemplate` | Provider Templates (WhatsApp) | (provider, channel, event, audience, locale) | The WhatsApp template the provider has approved, and the values it expects |

A routing row and a template row are a pair: routing says "tell the citizen by SMS
when a complaint is assigned", the template says what that SMS contains. **A
routing row without a template sends nothing** — at delivery time it is recorded
`SKIPPED / NB_NO_TEMPLATE`.

The **Configure** screen edits both halves together, one event at a time. That is
the screen to use day to day. The per-master screens exist for bulk work and for
fields Configure does not expose.

> **Upgrading?** These masters replaced `RAINMAKER-PGR.Notification*`, which were
> keyed on the complaint workflow's own vocabulary — `(businessService, action,
> toState)` instead of one `eventName`, and a bare audience instead of a scheme.
> The old rows are kept and shown read-only; see
> [operator-guide.md](./operator-guide.md#where-the-configuration-lives).

### SMS

* **Body only.** No subject.
* Sent as written, with the placeholders replaced.
* Length is billed in **segments**, not messages. Plain English (the GSM-7
  alphabet) fits 160 characters in one segment, then 153 per segment. A single
  character outside that alphabet — a curly apostrophe `'`, an em dash `—`, or any
  Hindi, Swahili or Portuguese accented letter — forces the whole message into
  UCS-2, where a segment is only 70 characters, then 67. This is why the Hindi
  defaults cost four or five segments while their English equivalents cost two.

### WhatsApp

WhatsApp does **not** send your body text.

A business cannot send free-form WhatsApp to a citizen who has not messaged first;
the provider rejects it. So every WhatsApp message goes out as a template the
provider has already approved, identified by a **Template ID** (Twilio calls it a
Content SID, `HX…`). The system sends that ID plus a list of **values**, in order,
and the provider drops them into its own approved wording.

The values are the ones listed in the provider template's **Variables (ordered)**
field, resolved from this event. So:

* the wording a citizen sees comes from the provider template, not from the
  Template body;
* the Template body still matters — it is the record of what the message says and
  it is what the `variables` list is checked against;
* **a placeholder in the body that is not in the provider template's variables
  list is never sent.** That is the single most common WhatsApp mistake, and the
  checker makes it an error.

If there is no approved provider template for a routing key, the event is still
recorded — as `SKIPPED / NB_TEMPLATE_NOT_APPROVED` on the Logs screen — and
nothing is delivered. Nothing is silently lost.

### Email

* **Subject + body.**
* If the subject is blank, `Complaint <id>` is sent instead. That works, but it is
  not what you want a citizen to see.
* Most mail clients cut the subject preview around 150 characters.

---

## 2. Placeholders

Write a placeholder as a **single brace** around its name: `{id}`.

Not `{{id}}`. Not `{ id }`. Only the exact single-brace form is replaced; anything
else is delivered to the citizen literally, braces and all.

**Which tokens exist is decided per event**, by that event's row on the **Events**
screen. The Configure screen lists them next to the body and warns about one that
the event does not declare. A module that adds events brings its own vocabulary
with them.

For the fourteen complaint events, that vocabulary is these thirteen tokens:

| Placeholder | What it becomes | Empty when |
|---|---|---|
| `{id}` | The complaint number, e.g. `PGR-2026-09-21-000123` | never |
| `{complaint_type}` | The complaint category, in the recipient's language where a translation exists (otherwise the raw service code) | never |
| `{status}` | The complaint's current status, translated where possible | before the first transition |
| `{date}` | The date the complaint was filed, `dd/MM/yyyy` | never |
| `{additional_comments}` | The comment the employee typed on this action (e.g. the reason for a rejection) | the action carried no comment |
| `{rating}` | The citizen's rating, 1–5 | before the complaint is rated |
| `{citizen_name}` | The name of the citizen who filed | the complaint was filed without a name |
| `{download_link}` | A shortened link to the mobile app | the link shortener is unavailable |
| `{ulb}` | The city / district name, translated | the complaint has no district on its address |
| `{ao_designation}` | The local label for the assigning officer's designation | that label is not translated for this tenant |
| `{emp_name}` | The name of the employee the complaint is currently assigned to | nothing is assigned yet (e.g. on APPLY) |
| `{emp_department}` | That employee's department | as above, or HRMS has no record |
| `{emp_designation}` | That employee's designation | as above |

Four things worth knowing:

* **A placeholder with no value is delivered as its braces**, not as a blank.
  `Assigned to {emp_name}.` arrives as `Assigned to {emp_name}.` when nothing is
  assigned. That is deliberate: a blank looks like a working message with nothing
  to say, whereas braces look like the mistake they are. `{download_link}` is the
  one exception — it is blanked rather than left literal, because a shortener
  outage must not ship a message containing the words `{download_link}`. Still:
  do not use `{emp_name}`, `{emp_department}`, `{emp_designation}` or `{rating}`
  on an event where they cannot exist yet.
* **On WhatsApp the same missing value is sent as an empty string**, because the
  provider template takes positional values. A message whose variables are all
  empty is rejected by the provider.
* `{complaint_type}`, `{status}`, `{ulb}`, `{ao_designation}`, `{emp_department}`
  and `{emp_designation}` are translated where a translation exists; the rest are
  not.
* **The values are resolved once per event, in one language**, while the template
  text is chosen per recipient. So in a two-language fan-out each person gets
  their own wording around the same substituted values. This is unchanged from
  before and is deliberate.

This list is checked against the code that fills it on every build, so it cannot
quietly go out of date. Another module opts into the same check by adding its own
parity test against its own producer.

---

## 3. The rules

The Configurator runs one checker over the whole of a tenant's notification
configuration. Run it on demand from **Notifications → Configure → Validate**, and
it also runs automatically whenever you save (see §5).

**Errors** are things that will not work. **Warnings** are things that will work
but will cost you money, or will not reach anybody, or are probably not what you
meant.

Every finding shows its rule id. Look the id up here. This table is generated from
`NOTIFICATION_RULES` in
`configurator/src/resources/workflow-services/validateNotifications.ts`, in source
order, and a unit test fails if the checker ever emits a rule that is not in it.

### Errors

| Rule | What it means | How to fix it |
|---|---|---|
| `audience-role-exists` | The audience names an actor the event does not declare, or a role code that does not exist, so nobody is ever resolved. | Use an actor the **Events** screen lists for this event, or a role code that exists. |
| `audience-scheme` | The audience uses a scheme the box has no resolver for; the event is recorded `SKIPPED / NB_UNKNOWN_AUDIENCE_SCHEME`. | Use `ACTOR:<name>`, `ROLE:<code>`, `EVENT_RECIPIENTS`, or a chain such as `ACTOR:assignee\|ROLE:GRO`. The Configure screen's pickers only produce valid forms. |
| `routing-has-template` | An active routing row has no active `en_IN` template, so there is nothing to send. | Add a template for that event / audience / channel in `en_IN`, or deactivate the routing row. A template in another language alone is not enough — `en_IN` is the fallback every recipient lands on. |
| `channel-allowed` | The channel is not one of SMS, WHATSAPP, EMAIL. | Correct the channel. |
| `transition-exists` | The row names an event with no active row in the event catalogue. | Pick an event from the **Events** screen. Nothing else will ever match. |
| `channel-gateway-mismatch` | A channel row names a direct gateway that cannot carry it — `smscountry` carries SMS only — so every message on that channel is undeliverable. | Set the gateway back to `novu` and choose a provider for the channel. The Channels form only offers `smscountry` on the SMS row. |
| `channel-needs-provider` | An enabled channel has no provider selected, so it falls back to deployment-wide settings. **Error** when routing rows use the channel, a warning otherwise. | Pick a provider on **Notifications → Channels**. |
| `channel-provider-missing` | The selected provider no longer exists. Error when routing rows use the channel. | Select a provider that exists. Every message on that channel is otherwise `SKIPPED / NB_PROVIDER_UNAVAILABLE`. |
| `channel-provider-inactive` | The selected provider exists but is disabled. Error when routing rows use the channel. | Re-enable that provider, or select a different one. |
| `placeholder-braces` | Malformed placeholder braces (`{{id}}`, an unclosed `{`, a stray `}`) that will not be substituted. | Use exactly one brace on each side of the token name: `{id}`. `{{id}}` is especially misleading: it half-works and the citizen sees `{PGR-2026-…}`. |
| `template-needs-body` | An active template has an empty body, so the recipient is skipped with nothing sent. | Write a body, or untick Active. |
| `whatsapp-variable-unmapped` | The WhatsApp body uses a placeholder the provider template does not declare, so that value never reaches the recipient. | Either add the placeholder to the provider template's **Variables (ordered)** list — in the position the approved template expects it — or take it out of the body. If the provider template declares no variables at all, add them. |

### Warnings

| Rule | What it means | What to do |
|---|---|---|
| `channel-in-event` | The routing row uses a channel the event's catalogue row does not declare. | Either the catalogue row or the routing row is wrong. The catalogue is owned by the producing module, so usually the routing row. |
| `no-orphan-template` | A template exists for a key no active routing row uses; it will never be rendered. | Harmless. Add the matching routing row if you meant to use it, otherwise delete the template. |
| `non-notifiable-audience` | `AUTO_ESCALATE` / `SYSTEM` are workflow actors, not people; a routing row on them never sends. | Pick a real audience. |
| `channel-enabled` | Routing rows exist on a channel with no policy row, or one that is switched off. | Expected on a fresh install — all three channels ship off. Turn the channel on once its provider is configured. Those messages are recorded `SKIPPED / NB_NO_PROVIDER`. |
| `unknown-token` | The body uses a `{token}` the event does not declare; the braces ship literally. | Check the spelling against the tokens listed for that event on the **Events** screen. |
| `email-needs-subject` | An EMAIL template has no subject; the box substitutes a default one (`Complaint <id>`). | Write a subject. |
| `email-subject-length` | An EMAIL subject longer than 150 characters is truncated by most mail clients. | Move the detail into the body. |
| `sms-length` | An SMS body is estimated to cost more than 3 segments (each segment is billed separately). | Shorten it, or drop a placeholder. If the language is the reason (see §1), this may be a cost you accept — the default Hindi messages do. |
| `whatsapp-needs-template` | An active WHATSAPP routing row has no approved provider template; every event is skipped. | Use **Notification Providers → Sync WhatsApp templates**, then save the rows. Until then those events are `SKIPPED / NB_TEMPLATE_NOT_APPROVED`. |
| `whatsapp-variable-unfilled` | The provider template declares a variable the event cannot fill; it is sent as an empty string. | Correct the variable name in the provider template row. |

Twenty-one rules in total. None has been retired.

### How the SMS estimate is calculated

The `sms-length` warning is an **estimate**, not a bill. It counts the body as
written, with the placeholders still in it, and then adds **12 characters per
placeholder** — because `{id}` (4 characters) becomes something like
`PGR-2026-09-21-000123` (21) at send time, and the real value is almost always
longer than the token. One documented number is used rather than a guess per
token, because the real length depends on your category labels and your employees'
names, which we cannot know. The finding text shows the arithmetic it used.

It does not mean the message will be rejected. It means it will be billed as that
many messages.

---

## 4. What ships by default

Out of the box, for the complaint workflow:

* **14 events** in the catalogue — one per reachable `(action, resulting state)`
  in the complaint workflow, generated from the workflow definition rather than
  hand-written.
* **24 routing rows** — the citizen is notified on SMS, WhatsApp and Email for
  APPLY, ASSIGN, REASSIGN, REJECT, RESOLVE and REOPEN; the assigned employee is
  notified on all three channels when a complaint is assigned to them and when a
  citizen rates it.
* **42 templates** — all 24 routing keys in `en_IN`, plus 18 of them in `hi_IN`
  (the citizen-facing ones).
* **14 provider templates** — approved Twilio WhatsApp templates in `en_IN` and
  `hi_IN` for seven citizen-keyed events.
* **3 channel rows** — SMS, WhatsApp and Email, all **switched off**, with no
  provider selected.

All three channels ship off on purpose: a brand-new city has no provider
credentials, so anything else would mean failed sends on day one. Turn a channel
on from **Notifications → Channels** once its provider is configured — the
[setup guide](./setup-guide.md) walks through that.

The shipped Twilio template IDs belong to the reference demonstration account and
**will not work on yours**. Each city needs its own approved wording and its own
IDs.

This default configuration is run through the checker on every build. It produces
**zero errors**. It produces exactly ten warnings, each one a known and accepted
property rather than a to-do:

* three `channel-enabled` — the channels ship off, as above;
* two `whatsapp-needs-template` — the two assignee-facing WhatsApp rows have no
  approved Twilio template, because the approved wording we have is
  citizen-facing. Those events are recorded
  `SKIPPED / NB_TEMPLATE_NOT_APPROVED` until you get employee templates approved
  and add the rows;
* five `sms-length` — the Hindi SMS bodies are four or five segments each, because
  Devanagari forces UCS-2. Shortening them would mean dropping information the
  citizen needs, so the cost is accepted and made visible.

---

## 5. Saving is validated

You cannot save a change that breaks a message.

Every save of notification configuration — creating or editing from the Configure
screen, and creating or editing on the Routing, Templates, Channels and Provider
Templates screens — runs the same checker over the configuration **as it would be
after your change**, before anything is written. Unticking **Active** is an edit
like any other, so switching a row off is checked too.

* **Errors your change causes block the save.** The banner reads *"This change
  cannot be saved until the following is fixed:"*, and the rule id and explanation
  appear next to the field responsible where there is one (body, subject,
  audience, channel, event, provider, variables) and in a panel below the form
  otherwise.
* **Warnings never block.** They are shown so you can decide.
* **Errors that were already there, on rows you are not touching, do not block
  either.** They are listed separately under "*…other findings in this tenant's
  notification configuration — these do not block this save*". This is deliberate:
  if any error anywhere stopped every save, you could never repair a broken city,
  because your first fix would be refused on account of the second problem. Fix
  them one row at a time.

Removing a notification from the Configure screen is checked the same way:
removing the last template for a routing row that is still active is an error and
is refused, because it would leave that event unable to send.

**The legacy screens have no save path at all** — they are read-only, so there is
nothing to validate there.

---

## 6. Reference

| What | Where |
|---|---|
| The rules | [`configurator/src/resources/workflow-services/validateNotifications.ts`](../../../configurator/src/resources/workflow-services/validateNotifications.ts) |
| Audience parsing | [`configurator/src/resources/notification-configure/audienceScheme.ts`](../../../configurator/src/resources/notification-configure/audienceScheme.ts) |
| The event vocabulary | [`configurator/src/resources/notification-configure/eventCatalogue.ts`](../../../configurator/src/resources/notification-configure/eventCatalogue.ts) |
| Segment / character-set arithmetic | [`configurator/src/resources/notification-configure/smsSegments.ts`](../../../configurator/src/resources/notification-configure/smsSegments.ts) |
| Save-blocking logic | [`configurator/src/resources/notification-configure/notificationSaveGuard.ts`](../../../configurator/src/resources/notification-configure/notificationSaveGuard.ts) |
| The shipped defaults | [`utilities/default-data-handler/src/main/resources/mdmsData-dev/NOTIFICATIONS/`](../../../utilities/default-data-handler/src/main/resources/mdmsData-dev/NOTIFICATIONS) |
| The event-catalogue generator | [`local-setup/scripts/generate_event_catalogue.py`](../../../local-setup/scripts/generate_event_catalogue.py) |
| The legacy-to-new converter | [`local-setup/scripts/notifications_convert.py`](../../../local-setup/scripts/notifications_convert.py) |
| The CI job that validates the defaults | [`.github/workflows/notification-config-validation.yml`](../../../.github/workflows/notification-config-validation.yml) |
| Turning channels and providers on | [setup-guide.md](./setup-guide.md) |
| Every code on the Logs screen | [contract/error-codes.md](./contract/error-codes.md) |
