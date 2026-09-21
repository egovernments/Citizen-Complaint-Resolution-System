# Message Templates and Validation

Who this is for: the person who writes the SMS, WhatsApp and email wording a
citizen actually receives, and who edits it in the Configurator.

It covers what a message is made of on each channel, which `{placeholders}` you
can use and what each one turns into, every rule the validator applies (with how
to fix each one), and what ships out of the box.

You do not need any of this to send the default messages. Everything below
already passes validation as shipped.

---

## 1. What a message is made of

Notification configuration is four MDMS masters. Each one is a screen under
**Notifications** in the Configurator.

| Master | Screen | One row per | What it decides |
|---|---|---|---|
| `RAINMAKER-PGR.NotificationChannel` | Channels | channel | Whether SMS / WhatsApp / Email deliver at all, and through which provider |
| `RAINMAKER-PGR.NotificationRouting` | Routing | (business service, action, toState, audience, channel) | WHO is notified when a complaint moves |
| `RAINMAKER-PGR.NotificationTemplate` | Templates | (audience, action, toState, channel, locale) | WHAT the message says, in one language |
| `RAINMAKER-PGR.NotificationProviderTemplate` | Provider Templates | (provider, channel, audience, action, toState, locale) | The WhatsApp template the provider has approved, and the values it expects |

A routing row and a template row are a pair: routing says "tell the citizen by
SMS when a complaint is assigned", the template says what that SMS contains. A
routing row without a template sends nothing.

The **Configure** screen edits both halves together, one workflow transition at
a time. That is the screen to use day to day. The per-master screens exist for
bulk work and for fields Configure does not expose.

### SMS

* **Body only.** No subject.
* Sent as written, with the placeholders replaced.
* Length is billed in **segments**, not messages. Plain English (the GSM-7
  alphabet) fits 160 characters in one segment, then 153 per segment. A single
  character outside that alphabet — a curly apostrophe `’`, an em dash `—`, or
  any Hindi, Swahili or Portuguese accented letter — forces the whole message
  into UCS-2, where a segment is only 70 characters, then 67. This is why the
  Hindi defaults cost four or five segments while their English equivalents cost
  two.

### WhatsApp

WhatsApp does **not** send your body text.

A business cannot send free-form WhatsApp to a citizen who has not messaged
first; the provider rejects it. So every WhatsApp message goes out as a template
the provider has already approved, identified by a **Template ID** (Twilio calls
it a Content SID, `HX…`). DIGIT sends that ID plus a list of **values**, in
order, and the provider drops them into its own approved wording.

The values are the ones listed in the provider template's **Variables (ordered)**
field, resolved from this complaint. So:

* the wording a citizen sees comes from the provider template, not from the
  Template body;
* the Template body still matters — it is the record of what the message says
  and it is what the `variables` list is checked against;
* **a placeholder in the body that is not in the provider template's variables
  list is never sent.** That is the single most common WhatsApp mistake, and the
  validator makes it an error.

If there is no approved provider template for a routing key, the event is still
recorded — as `SKIPPED / NB_TEMPLATE_NOT_APPROVED` on the Logs screen — and
nothing is delivered. Nothing is silently lost.

### Email

* **Subject + body.**
* If the subject is blank, `Complaint <id>` is sent instead. That works, but it
  is not what you want a citizen to see.
* Most mail clients cut the subject preview around 150 characters.

---

## 2. Placeholders

Write a placeholder as a **single brace** around its name: `{id}`.

Not `{{id}}`. Not `{ id }`. Only the exact single-brace form is replaced;
anything else is delivered to the citizen literally, braces and all.

These are the only placeholders that are filled. Anything else ships as typed.

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

Three things worth knowing:

* A placeholder that has no value is replaced with **nothing**, not with the
  braces. `Assigned to {emp_name}.` becomes `Assigned to .` — so do not use
  `{emp_name}`, `{emp_department}`, `{emp_designation}` or `{rating}` on an
  action where they cannot exist yet.
* `{complaint_type}`, `{status}` and `{ulb}` are translated per recipient where
  a translation exists; the rest are not.
* This list is checked against the code that fills it on every build, so it
  cannot quietly go out of date.

---

## 3. The rules

The Configurator runs one checker over the whole of a tenant's notification
configuration. You can run it on demand from **Notifications → Configure →
Validate**, and it also runs automatically whenever you save (see §5).

**Errors** are things that will not work. **Warnings** are things that will
work but will cost you money, or will not reach anybody, or are probably not
what you meant.

Every finding shows its rule id. Look the id up here.

### Errors

| Rule | What it means | How to fix it |
|---|---|---|
| `audience-role-exists` | The routing row's audience is not `CITIZEN`, not `EMPLOYEE`, and not a role that exists. Nobody will ever be resolved. | Use `CITIZEN` (the person who filed), `EMPLOYEE` (whoever the complaint is assigned to right now), or a role code that appears on this workflow action. |
| `routing-has-template` | An active routing row has no active `en_IN` template for its channel. There is nothing to send. | Add a template for that audience / action / state / channel in `en_IN`, or deactivate the routing row. A template in another language alone is not enough — `en_IN` is the fallback every recipient lands on. |
| `channel-allowed` | The channel is not `SMS`, `WHATSAPP` or `EMAIL`. | Correct the channel. |
| `transition-exists` | The routing row names an action and a resulting state the workflow cannot actually produce. It will never fire. | Check the action and "to state" against the workflow. In particular the "to state" must be the status NAME (`PENDINGATLME`), never the internal state id. |
| `template-needs-body` | An active template has an empty body. The recipient is skipped and nothing is sent. | Write a body, or untick Active. |
| `placeholder-braces` | The body or subject has braces that will not be substituted — `{{id}}`, an unclosed `{`, a stray `}`, or something that is not a token name inside braces. | Use exactly one brace on each side of the token name: `{id}`. `{{id}}` is especially misleading: it half-works and the citizen sees `{PGR-2026-…}`. |
| `channel-needs-provider` | A channel is switched on but no provider is selected for it, so delivery falls back to the deployment's own settings rather than this city's configuration. An **error** when routing rows use the channel, a warning otherwise. | Pick a provider on **Notifications → Providers → Channels**. |
| `channel-provider-missing` | The channel points at a provider that no longer exists. Every message on that channel is recorded `SKIPPED / NB_PROVIDER_UNAVAILABLE`. Error when routing rows use the channel. | Select a provider that exists. |
| `channel-provider-inactive` | The selected provider exists but is switched off. Same effect as above. Error when routing rows use the channel. | Re-enable that provider, or select a different one. |
| `whatsapp-variable-unmapped` | The WhatsApp body uses a placeholder the approved provider template does not declare. That value is never sent, so the citizen gets a message with a blank where it should have been. | Either add the placeholder to the provider template's **Variables (ordered)** list — in the position the approved template expects it — or take it out of the body. If the provider template declares no variables at all, add them. |

### Warnings

| Rule | What it means | What to do |
|---|---|---|
| `channel-enabled` | Routing rows exist on a channel that has no policy row, or that is switched off. Those messages are recorded `SKIPPED / NB_NO_PROVIDER` and never delivered. | Expected on a fresh install — all three channels ship off. Turn the channel on once its provider is configured. |
| `no-orphan-template` | A template exists for a key no active routing row uses. It will never be rendered. | Harmless. Add the matching routing row if you meant to use it, otherwise delete the template. |
| `non-notifiable-audience` | The audience is `AUTO_ESCALATE` or `SYSTEM` — workflow actors, not people. It can never send. | Pick a real audience. |
| `unknown-token` | The body uses a `{token}` that is not in the list in §2. It will be delivered literally. | Check the spelling against §2. |
| `email-needs-subject` | An email template has no subject, so `Complaint <id>` is sent. | Write a subject. |
| `email-subject-length` | The subject is longer than 150 characters and will be cut in most inboxes. | Move the detail into the body. |
| `sms-length` | The SMS is estimated to cost more than 3 segments. Each segment is billed separately, so a 5-segment message costs five times a 1-segment one. | Shorten it, or drop a placeholder. If the language is the reason (see §1), this may be a cost you accept — the default Hindi messages do. |
| `whatsapp-variable-unfilled` | The provider template declares a variable that is not one of the placeholders in §2, so that position is sent as an empty string. | Correct the variable name in the provider template row. |

### How the SMS estimate is calculated

The `sms-length` warning is an **estimate**, not a bill. It counts the body as
written, with the placeholders still in it, and then adds **12 characters per
placeholder** — because `{id}` (4 characters) becomes something like
`PGR-2026-09-21-000123` (21) at send time, and the real value is almost always
longer than the token. One documented number is used rather than a guess per
token, because the real length depends on your complaint-type labels and your
employees' names, which we cannot know.

It does not mean the message will be rejected. It means it will be billed as
that many messages.

---

## 4. What ships by default

Out of the box, for the PGR workflow:

* **24 routing rows** — the citizen is notified on SMS, WhatsApp and Email for
  APPLY, ASSIGN, REASSIGN, REJECT, RESOLVE and REOPEN; the assigned employee is
  notified on all three channels when a complaint is assigned to them and when a
  citizen rates it.
* **42 templates** — all 24 routing keys in `en_IN`, plus 18 of them in `hi_IN`
  (the citizen-facing ones).
* **14 provider templates** — approved Twilio WhatsApp templates in `en_IN` and
  `hi_IN` for seven citizen-keyed transitions: the six above plus RATE. (RATE is
  routed to the employee, not the citizen, so that pair is unused today; it is
  left in place because the approval already exists.)
* **3 channel rows** — SMS, WhatsApp and Email, all **switched off**, with no
  provider selected.

All three channels ship off on purpose: a brand-new city has no provider
credentials, so anything else would mean failed sends on day one. Turn a channel
on from **Notifications → Channels** once its provider is configured — the
README in this folder walks through that.

This default configuration is run through the validator on every build. It
produces **zero errors**. It produces ten warnings, all of them deliberate:

* three `channel-enabled` — the channels ship off, as above;
* two `whatsapp-needs-template` — the two employee-facing WhatsApp rows have no
  approved Twilio template yet, because the approved wording we have is
  citizen-facing. Those events are recorded `SKIPPED / NB_TEMPLATE_NOT_APPROVED`
  until you get employee templates approved and add the rows;
* five `sms-length` — the Hindi SMS bodies are four or five segments each,
  because Devanagari forces UCS-2. Shortening them would mean dropping
  information the citizen needs, so the cost is accepted and made visible.

---

## 5. Saving is validated

You cannot save a change that breaks a message.

Every save of notification configuration — creating or editing from the Configure
screen, and creating or editing on the Routing, Templates, Channels and Provider
Templates screens — runs the same checker over the configuration **as it would
be after your change**, before anything is written. Unticking **Active** is an
edit like any other, so switching a row off is checked too.

* **Errors your change causes block the save.** The rule id and the explanation
  appear next to the field responsible where there is one (body, subject,
  audience, channel), and in a panel below the form otherwise.
* **Warnings never block.** They are shown so you can decide.
* **Errors that were already there, on rows you are not touching, do not block
  either.** They are listed separately, marked as not standing in the way. This
  is deliberate: if any error anywhere stopped every save, you could never
  repair a broken city, because your first fix would be refused on account of
  the second problem. Fix them one row at a time.

Removing a notification from the Configure screen is checked the same way:
removing the last template for a routing row that is still active is an error
and is refused, because it would leave that transition unable to send.

---

## 6. Reference

| What | Where |
|---|---|
| The rules | `configurator/src/resources/workflow-services/validateNotifications.ts` |
| Segment / character-set arithmetic | `configurator/src/resources/notification-configure/smsSegments.ts` |
| Save-blocking logic | `configurator/src/resources/notification-configure/notificationSaveGuard.ts` |
| The shipped defaults | `utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.Notification*.json` |
| The CI job that validates them | `.github/workflows/notification-config-validation.yml` |
| Where placeholders are filled | `backend/pgr-services/.../service/NotificationService.java`, `buildPlaceholderValues` |
| Turning channels and providers on | `README.md` in this folder |
