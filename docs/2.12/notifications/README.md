# Notifications: the deployment runbook

> **Start here instead, unless you are the deployer:**
>
> | You want to | Read |
> |---|---|
> | **Set notifications up for the first time**, start to finish | **[setup-guide.md](./setup-guide.md)** — the ordered path from nothing to a delivered message |
> | Run it day to day — channels, providers, events, routing, logs, who can do what | [operator-guide.md](./operator-guide.md) |
> | Write the message text, and look up a validation rule | [message-templates.md](./message-templates.md) |
> | Connect another module, add a provider, or supply your own recipient resolution | [developer-guide.md](./developer-guide.md) |
> | Integrate against the published interface | [contract/](./contract/README.md) — [thin event](./contract/thin-event-v1.schema.json) · [envelope](./contract/envelope-v1.schema.json) · [OpenAPI](./contract/openapi.yaml) · [error codes](./contract/error-codes.md) · [outputs](./contract/outputs.md) |
> | **Upgrade an existing deployment** | [Upgrading an existing deployment](#upgrading-an-existing-deployment) on this page — read it before you deploy |
>
> **This page** is the deployment runbook: one-time, shell-based, done by a
> deployer, with the per-channel detail an operator does not need —
> [prerequisites](#prerequisites) · [shared variables](#configure-notification-variables) ·
> [deploy](#start-deployment) · [WhatsApp](#enable-whatsapp) · [SMS](#enable-sms) ·
> [Email](#enable-email) · [supported providers](#supported-providers-out-of-the-box) ·
> [what Configurator can and cannot do](#what-configurator-can-and-cannot-do) ·
> [upgrading](#upgrading-an-existing-deployment)

This enables SMS, WhatsApp and email notifications on a deployment created with
[the deployment guide](../deployment/README.md). Run the repository commands below from the
root of the cloned `Citizen-Complaint-Resolution-System` repository.

Each channel is independent — enable one, two or all three. Each has its own
section below listing what it needs.

## Prerequisites

1. A deployment created by `./deploy.sh mycity`, or the same variables file before
   its first run. Adding these variables before the first deploy avoids a second run.
2. For WhatsApp, a Twilio account with a WhatsApp-enabled sender and approved
   message templates. Without approved templates nothing is delivered.
3. For SMS, an SMSCountry account on the legacy bulk API, its panel login, and a
   registered sender id. For Indian destinations you also need DLT-registered
   templates — see [Registering templates](#registering-templates-india-dlt).
4. For email, an SMTP account. On Gmail and Microsoft 365 that means an **app
   password**, not the account password — see [Enable Email](#enable-email).

No channel depends on another: an SMS-only deployment needs no Twilio account, a
WhatsApp-only one needs no SMSCountry account.

Nothing is dispatched until you name a channel in `novu_bridge_channels_enabled`.
There is no default.

Each channel section has its own settings table. Collect the ones you need before
the first deploy and you can do this in a single run.

Last tested with `egovio/pgr-services:master-0938bdf` and
`egovio/novu-bridge:master-0469335`.

## Configure Notification Variables

These apply to every channel. Add them to the same Ansible variables file used
for the deployment: `local-setup/ansible/inventory/host_vars/mycity.yml`.
Per-channel settings live in each channel's section.

| Setting | What it is | Example |
|---|---|---|
| `enable_novu` | Starts Novu and the notification stack. Nothing below works without it. | `true` |
| `seed_notifications` | Seeds the notification MDMS masters and their access-control rows on deploy, and copies an existing tenant's rows into the shared `NOTIFICATIONS.*` namespace. Idempotent. Defaults to `enable_novu`. | `true` |
| `novu_bridge_channels_enabled` | **Bootstrap fallback only.** Channels are switched on per tenant in Configurator → Notifications → **Channels** (MDMS `NOTIFICATIONS.Channel`); this env list applies only while a tenant has no channel rows. Leave it unset and nothing is sent until the operator enables channels in the configurator. | `"SMS"` |
| `novu_bridge_proxy_allowed_roles` | Roles allowed to **use** the Configurator's notification screens (logs, integrations, preferences, the provider catalog, verify and test-send). Default `EMPLOYEE,SUPERUSER,GRO,PGR_LME,MDMS_ADMIN`. | `"SUPERUSER,MDMS_ADMIN"` |
| `novu_bridge_proxy_admin_roles` | Roles allowed to **manage** providers — create one, rotate its credentials, delete it. Default `SUPERUSER,MDMS_ADMIN,ACCOUNT_ADMIN`. A caller without one of these gets `403 NB_ADMIN_ROLE_REQUIRED` on those three calls even if it is on the list above; a role on this list also satisfies that list. | `"SUPERUSER,MDMS_ADMIN"` |
| `novu_admin_email` | Novu admin account. Use an address you control. | `notifications-admin@example.com` |
| `novu_admin_password` | Novu admin password. Generate a unique, strong one. | |
| `novu_api_key` | Leave unset. Ansible mints a key and wires it into `/opt/digit/.env`. Set it only if the deployment has a pinned key. | |

## Start Deployment

```bash
cd local-setup/ansible
./deploy.sh mycity
```

Wait for `failed=0`. This also syncs the current `local-setup/kong/kong.yml` and
reloads Kong, which the Configurator provider screens need. If you edit `kong.yml`
without re-running the deployment, apply it with
`sudo docker exec kong-gateway kong reload` — Kong is DB-less and does not re-read
the file on its own.

### Verify the Novu key

Do this before any provider work. A green play recap is not enough: the provider
bootstrap is allowed to fail without failing the deployment.

```bash
export NOVU_BASE_URL='http://127.0.0.1:14002'
export NOVU_API_KEY="$(sudo sed -n 's/^NOVU_API_KEY=//p' /opt/digit/.env | tail -1)"

test -n "$NOVU_API_KEY"
test "$NOVU_API_KEY" != changeme
curl -fsS -H "Authorization: ApiKey $NOVU_API_KEY" \
  "$NOVU_BASE_URL/v1/integrations" >/dev/null
```

Stop if any command fails. Configurator provider operations go through
`novu-bridge`, and they cannot work while the bridge holds an empty, placeholder,
or invalid Novu key. Keep this shell open — the sections below reuse
`NOVU_BASE_URL` and `NOVU_API_KEY`.

Do not set `NOVU_BRIDGE_PROXY_AUTH_ENABLED=false` on a reachable deployment. The
Kong routes delegate authentication to `novu-bridge`, so disabling it makes provider
creation and test-send unauthenticated. Enforcing this is tracked in
[issue #1942](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1942).

## Enable WhatsApp

WhatsApp goes through Twilio. Set these and re-run `./deploy.sh mycity`:

| Setting | What it is | Example |
|---|---|---|
| `twilio_account_sid` | From the Twilio Console. | |
| `twilio_auth_token` | From the Twilio Console. | |
| `twilio_whatsapp_from` | Your WhatsApp sender, with the `whatsapp:` prefix. Defaults to Twilio's sandbox number if omitted. | `whatsapp:+14155238886` |
| `novu_bridge_workflow_id_whatsapp` | Leave at the default unless you renamed the workflow. | `"complaints-whatsapp"` |
| `novu_bridge_integration_id_whatsapp` | Leave blank. Only needed if a second Twilio integration exists alongside the WhatsApp one. | |

The deploy registers the Twilio account with Novu and creates the message route
WhatsApp uses. The rest of this section is verification and the extra steps real
WhatsApp delivery needs.

### Bootstrap the provider and workflow

If `twilio_account_sid` was set before the deployment, this is already done. The
deploy runs the same script, and its defaults produce the same integration and the
same workflows — only the workflow's display name differs, which nothing keys on.
Skip to [Verify WhatsApp](#verify-whatsapp).

Run it by hand only when the Twilio credentials were added after the first deploy
and you would rather not re-run `./deploy.sh`. It administers Novu: it does not run
the deployment again and does not send a message.

```bash
# Copy these values from the Twilio Console.
export TWILIO_ACCOUNT_SID='<Twilio Account SID>'
export TWILIO_AUTH_TOKEN='<Twilio Auth Token>'
export TWILIO_WHATSAPP_FROM='whatsapp:+<Twilio WhatsApp sender>'

export NOVU_ENV_FILE=/dev/null
export NOVU_INTEGRATION_NAME=twilio-whatsapp
export NOVU_INTEGRATION_ID=twilio-whatsapp
export NOVU_WORKFLOW_ID=complaints-whatsapp
export NOVU_WORKFLOW_NAME=complaints-whatsapp
export NOVU_SMS_BODY='Complaint {{payload.complaintNo}} status is {{payload.status}}'

bash backend/novu-bridge/config/bootstrap-novu-whatsapp.sh

unset TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_WHATSAPP_FROM NOVU_SMS_BODY
```

The script creates `twilio-whatsapp` when it is absent, but it does not update the
credentials of an existing integration. On an existing installation, update or
delete that integration in Novu before running the script.

### Verify WhatsApp

```bash
curl -fsS -H "Authorization: ApiKey $NOVU_API_KEY" \
  "$NOVU_BASE_URL/v1/integrations" \
| jq '[.data[] | select(.identifier == "twilio-whatsapp") |
       {identifier,providerId,channel,active,primary}]'

curl -fsS -H "Authorization: ApiKey $NOVU_API_KEY" \
  "$NOVU_BASE_URL/v2/workflows?limit=100&page=0" \
| jq '[.data.workflows[] | select(.workflowId == "complaints-whatsapp") |
       .workflowId]'
```

Confirm that `twilio-whatsapp` is `active` and that `complaints-whatsapp` exists.

`twilio-whatsapp` being `primary` is expected and fine — it is the only Twilio
integration this guide creates. The direct-gateway SMS route below does not add
another: SMSCountry is called by the bridge itself and registers nothing in Novu.
(An SMSCountry provider added from the configurator does register an integration —
see [Supported providers out of the box](#supported-providers-out-of-the-box).)

### Send a real WhatsApp message

Business-initiated WhatsApp messages require an approved Twilio Content SID. The
bridge skips WhatsApp events without one.

First confirm that notification configuration exists at the state root of the tenant
where the complaint will be filed. A complaint in `pg.citya` resolves its
configuration from `pg`, which on a stock dump-based quickstart may differ from the
deployment's `state_root`.

If the roots differ, re-run the idempotent notification seed for the complaint root:

```bash
export COMPLAINT_TENANT='pg.citya'
export NOTIF_TENANT="${COMPLAINT_TENANT%%.*}"
export DIGIT_URL='http://127.0.0.1:18000'
export DIGIT_USERNAME='ADMIN'
export DIGIT_PASSWORD='<bootstrap_password from the Ansible variables>'
export DIGIT_LOGIN_TENANT="$NOTIF_TENANT"

cd /opt/digit/notification-seed
SCHEMA_FILE=/opt/digit/notification-seed/RAINMAKER-PGR.json \
NOTIF_SCHEMA_FILE=/opt/digit/notification-seed/NOTIFICATIONS.json \
DATA_DIR=/opt/digit/notification-seed \
python3 seed-notifications.py

unset DIGIT_PASSWORD
```

Wait for `DONE`, then log in to Configurator at the same `NOTIF_TENANT`.
Configurator writes notification configuration at the tenant used for the session.
If it writes to the deployment root instead, the notification service finds no
routing for the complaint tenant and records `SKIPPED / NB_NO_ROUTING`. The
automatic fix is tracked in
[issue #1943](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1943).

`NOTIF_SCHEMA_FILE` is what stages the shared `NOTIFICATIONS.*` schemas and the
copy step. Omit it and only the legacy masters are seeded, which leaves the tenant
on the read adapter — check with
`GET /novu-bridge/novu-adapter/v1/config/source?tenantId=…`.

Sync matches approved templates to PGR transitions by template name and saves that
Twilio account's Content SID. Each account needs its own approved templates with the
expected names and ordered variables; the example seed SIDs are not portable.

1. Open **Notifications -> Providers -> Sync WhatsApp templates**.
2. Review and persist the matched templates.
3. Open **Notifications -> Configure** and verify the routing and message templates
   for the required PGR transitions.
4. Trigger a real complaint transition.
5. Check **Notifications -> Logs**, `nb_dispatch_log`, Novu activity, the provider
   console, and finally the handset.

`SENT` in the bridge log means Novu accepted the trigger. It is not proof that the
provider delivered the message.

## Enable SMS

SMS goes through SMSCountry's **legacy bulk API** — the one eGov accounts are
provisioned on. It authenticates with your SMSCountry panel login rather than an
API key, and `novu-bridge` posts to it directly, so this needs no Novu integration
and no Novu workflow.

If your SMSCountry panel shows an AuthKey/AuthToken pair you are on their newer
REST v0.1 API, which is not supported.

There are two ways to reach that API, and they are alternatives — do not configure
both for the same channel:

- **As a provider (preferred).** Add SMSCountry in **Configurator -> Notifications
  -> Providers** and select it as the SMS channel's active provider. The credentials
  are stored in Novu, and Novu's worker calls the bridge's internal SMSCountry
  adapter. Nothing below is needed.
- **As a direct gateway (the settings below).** Set the channel's `gateway` to
  `smscountry` and put the panel login in the deployment variables; `novu-bridge`
  posts to SMSCountry itself, with no Novu integration and no Novu workflow. This is
  the older path and stays supported.

For the direct-gateway route, set these and re-run `./deploy.sh mycity`:

| Setting | What it is | Example |
|---|---|---|
| `novu_bridge_sms_provider` | Selects the SMS gateway. | `smscountry` |
| `novu_bridge_sms_sender_id` | Your registered sender id. | `EGOVFS` |
| `novu_bridge_smscountry_user` | SMSCountry panel username. | |
| `novu_bridge_smscountry_password` | SMSCountry panel password. | |

### Verify SMS

Trigger a complaint transition, then open the **delivery report in the SMSCountry
panel** — not the bridge log.

SMSCountry returns a job id even for messages it later drops, so the bridge can
only tell you the message was accepted, never that it arrived. In the report a
delivered message is billed; a blocked one shows as rejected at zero cost.

### Registering templates (India, DLT)

Skip this unless you send to Indian numbers. India's DLT regime requires every
message to match a template registered against your sender id. The gateway accepts
unregistered messages and the operator drops them, so **a successful send response
does not mean delivered** — a rejected message still gets a job id. Judge only by
the delivery report, where a blocked message shows as rejected and costs nothing.

Matching is on message content; no template id is sent. Punctuation and blank-line
differences are tolerated, a reworded sentence is not.

Register one template per row below, per language you send. Take the exact text
from **Configurator -> Notifications -> Configure**, replacing each `{variable}`
with DLT's `{#var#}` marker and leaving the rest character for character.

| Audience | Transition | Variables |
|---|---|---|
| Citizen | complaint submitted | complaint type, id, date |
| Citizen | assigned | complaint type, id, date, employee name, designation, department |
| Citizen | re-assigned | complaint type, id, date, employee name, designation, department |
| Citizen | rejected | complaint type, id, date, rejection reason |
| Citizen | resolved | complaint type, id, date, employee name |
| Citizen | re-opened | complaint type, id, date |
| Employee | assigned to you | employee name, complaint type, id, designation, city |
| Employee | feedback received | employee name, complaint type, id, rating |

Two things that bite:

- The rejection reason is free text an employee types, and DLT caps a variable at
  about 30 characters. Reword that template to drop the variable if your provider
  enforces the limit.
- Hindi and other non-Latin templates register separately from the English ones.

## Enable Email

Email goes through Novu, unlike SMS. The deploy creates the `complaints-email`
workflow; you add the SMTP provider yourself.

1. Open **Configurator -> Notifications -> Providers**, select **Add Provider**:

| Field | Value |
|---|---|
| Channel | `EMAIL` |
| Provider ID | `nodemailer` |
| Name | anything, e.g. `Org SMTP` |
| Identifier | anything you will recognise, e.g. `org-smtp` |
| SMTP Host | `smtp.gmail.com`, `smtp.office365.com`, … |
| SMTP Port | `587` |
| SMTP User | the mailbox address |
| SMTP Password | an **app password** — see below |
| From | usually must equal the SMTP User |
| Use TLS (secure) | **unchecked** for port 587 — see below |

2. Add `EMAIL` to `novu_bridge_channels_enabled` and re-run `./deploy.sh mycity`.

Two things account for most failures:

- **Use an app password, not your account password.** Gmail and Microsoft 365
  reject the account password for SMTP once 2FA is on, with
  `535-5.7.8 Username and Password not accepted` — which reads like a typo and
  sends people round in circles. Generate a 16-character app password instead.
- **"Use TLS (secure)" does not mean "use TLS".** It means TLS from the first
  byte, which is port **465**. Port **587** starts in plaintext and upgrades via
  STARTTLS, so it needs this **unchecked**. Checking it with 587 hangs or fails
  the handshake.

| Port | Use TLS (secure) |
|---|---|
| 587 | unchecked |
| 465 | checked |

### Verify email

Trigger a complaint transition and check the mailbox. If nothing arrives, look at
**Notifications -> Logs** first: it will tell you whether the message was handed
to your SMTP server at all, which separates a configuration problem from a
delivery one.

### Test without mailing anyone

[Ethereal](https://ethereal.email) issues throwaway SMTP credentials that accept
and capture mail instead of delivering it. Enough to prove the wiring — the
provider fields, the workflow, the bridge — without touching a real mailbox.

```bash
curl -sS -X POST https://api.nodemailer.com/user \
  -H 'Content-Type: application/json' \
  -d '{"requestor":"ccrs","version":"1.0.0"}'
```

That returns `host`, `port`, `secure`, `user` and `pass`. Put them in the
provider form above, trigger a transition, then read the captured mail by
signing in at [ethereal.email](https://ethereal.email) with the same
credentials, or over IMAP at `imap.ethereal.email:993`.

It proves configuration, not deliverability: SPF, DKIM and whether a real
recipient's provider accepts the mail still need a live SMTP account.

## Clean Up

Remove the setup values from the current shell:

```bash
unset NOVU_API_KEY NOVU_BASE_URL
unset NOVU_ENV_FILE NOVU_INTEGRATION_NAME NOVU_INTEGRATION_ID
unset NOVU_WORKFLOW_ID NOVU_WORKFLOW_NAME
```

## Supported providers out of the box

Five provider types ship configured-ready. You add them in **Configurator ->
Notifications -> Providers**; nothing here needs the Novu dashboard.

**Creating, rotating and deleting a provider needs an admin role.** Those three calls
carry or destroy credentials, so `novu-bridge` requires a role from
`novu_bridge_proxy_admin_roles` (default `SUPERUSER`, `MDMS_ADMIN`, `ACCOUNT_ADMIN`)
and answers `403 NB_ADMIN_ROLE_REQUIRED` without one. Everything else on these screens
— reading the catalog and the integration list, verifying a provider, sending a test —
stays open to the wider `novu_bridge_proxy_allowed_roles`.

| Provider | Channel | How it sends | Credentials stored in |
|---|---|---|---|
| Twilio SMS | SMS | Novu integration | Novu |
| Twilio WhatsApp | WHATSAPP | Novu integration | Novu |
| SMTP (`nodemailer`) | EMAIL | Novu integration | Novu |
| SMSCountry | SMS | Novu integration calling the bridge's internal adapter | Novu |
| Ozeki | SMS | Novu integration | Novu |

**Credentials only ever live in Novu.** The configurator posts them to
`novu-bridge`, which stores them as a Novu integration. They are not written to
MDMS, not written to `/opt/digit/.env`, and are never returned by a read — an edit
shows the non-secret fields and lets you re-enter a secret to rotate it.

**SMSCountry goes through an internal adapter.** Novu has no SMSCountry provider,
so the integration is pointed at
`POST /novu-bridge/novu-adapter/v1/gateways/smscountry/send`, which Novu's worker
calls over the container network with the panel credentials in headers. That path
is deliberately **not reachable from outside**: Kong terminates
`/novu-bridge/novu-adapter/v1/gateways` with a 404, and there is no accesscontrol
action for it. Nothing you do in the configurator should ever need that URL.

**One active provider per channel, per state tenant.** The choice is a field on the
MDMS master `NOTIFICATIONS.Channel` (`provider`, the Novu integration identifier)
alongside `enabled`, `gateway` and `senderId`. Selecting a provider on the Channels
screen writes that field; `novu-bridge` reads it at the state tenant on every
dispatch. A tenant with no rows there falls back to the legacy
`RAINMAKER-PGR.NotificationChannel` automatically, per tenant. Picking a second
provider for the same channel replaces the first — there is no fan-out and no
fallback chain, and no way to give one city a different provider from another in
the same state. Two cases are worth knowing exactly:

- **No provider selected** — the pre-catalog behaviour applies verbatim: the row's
  `gateway` decides the transport, then the deployment's env fallbacks
  (`novu_bridge_sms_provider`, `novu_bridge_channels_enabled`, …). Existing
  deployments are therefore unaffected by the catalog. The configurator's
  "Validate notifications" check flags it (`channel-needs-provider`) so the tenant's
  delivery becomes an explicit choice rather than an inherited default.
- **A selection pointing at a provider that is missing, disabled, or on another Novu
  channel** — nothing is delivered and nothing is retried. The bridge checks the
  selection against Novu's integration list before it triggers and records the event
  `SKIPPED / NB_PROVIDER_UNAVAILABLE` on the Logs screen, with the identifier and the
  reason in the message. It does **not** report `SENT`: Novu accepts a trigger naming an
  unusable integration and fails the step internally, which is exactly the phantom-`SENT`
  this check exists to prevent. If Novu cannot be reached to check at all, the bridge
  fails open and delivers as it otherwise would. Fix it by re-enabling that provider or
  selecting another one on the Channels screen; the change takes effect on the next event.

## What Configurator Can and Cannot Do

| Configurator can | Configurator cannot |
|---|---|
| Create, rename, rotate credentials on, enable/disable and delete provider integrations | Mint or wire the Novu API key |
| Enable/disable a channel and select its active provider | Start Novu, enable the Compose profile, or set service environment flags |
| Edit routing, templates and WhatsApp provider templates in the shared `NOTIFICATIONS.*` masters | Install those masters, or copy a tenant's legacy rows into them (`--tags notifications`) |
| Sync approved WhatsApp templates from Twilio | Create the Novu delivery workflows |
| Verify a provider, and validate the whole configuration | Add a producing module's `eventType` to the allowlist |
| Display the dispatch log | Set the delivery-receipts secret, or the providers' callback URLs |
| Read each user's language and per-channel consent | Change the consent gate or its outage policy |
| Show which MDMS namespace is serving a tenant (the Configure banner) | Choose that namespace — the data chooses, per tenant |
| — | **Author events.** The Events screen is read-only: a module declares its own events, and PGR's are generated from its workflow at seed time |

Everything in the right-hand column is a deployment or producer operation.
**Operators do not need the Novu dashboard** — provider management is entirely in
the configurator, and `/novu` is left for debugging.

## Upgrading an existing deployment

Read this before you deploy. There is one hard operational constraint and one
required step.

### 1. Run the notification seed step

Everything new arrives as **seed data** — the shared `NOTIFICATIONS.*` schemas, the
event catalogue, the copy of your tenant's own rows, and the access-control rows
that let the screens through the gateway. MDMS seed migrations do not run on a
deployed box, so a data file alone never reaches one. A stock re-deploy is enough —
the notification seed step is part of it — but if you would rather not run the
whole playbook, run just that step:

```bash
cd local-setup/ansible
./deploy.sh mycity --tags notifications
```

It is idempotent and safe to re-run. It:

- creates the five `NOTIFICATIONS.*` schemas and, where a schema already exists but
  the committed definition has gained a property, upgrades it in place — without
  which every Configurator write carrying the new field is rejected, which is
  exactly how a seed-only change silently fails to reach an existing deployment;
- **copies the tenant's own rows** into the new namespace. It reads what the server
  actually has over `/mdms-v2/v2/_search` rather than staging the repository's
  defaults, because a deployed city has drifted from them through years of operator
  edits;
- seeds the generated event catalogue, which has no legacy counterpart;
- adds the access-control actions and role-actions for the new screens and the
  provider endpoints, and restarts `egov-accesscontrol` when it created any — that
  last part matters, because it caches role-actions in memory and would keep 403ing
  the endpoints it was just granted.

**Existing rows are copied, never deleted.** The `RAINMAKER-PGR.Notification*` rows
are left exactly as they are. Nothing is modified and nothing is removed, which is
what makes the release rollback-able: deploy the previous images and the old rows
are still the live configuration.

Until the copy runs, a tenant is served its legacy rows through a read adapter, so
**notifications keep working on an image upgraded before the playbook ran**. In the
Configurator that tenant's notification screens are read-only with a banner saying
so. Confirm which state a tenant is in with
`GET /novu-bridge/novu-adapter/v1/config/source?tenantId=mycity`, or by the absence
of that banner.

If the copy could not finish, the deploy prints a task named
`notif-seed — WARNING: the NOTIFICATIONS.* copy did not complete`. Your legacy rows
are untouched and delivery is unaffected; re-run the step once MDMS is healthy.

Without this step at all, the symptom is a Channels screen that saves nothing and a
Providers screen whose edit and delete buttons return 403.

### 2. Never run the old and the new `pgr-services` at the same time

This release moves complaint notifications from *pre-rendered messages published by
`pgr-services`* to *thin events resolved inside `novu-bridge`*. The bridge accepts
both kinds, forever and simultaneously — which is what makes the rollback above
work. It deliberately does **not** suppress a replay: an event that arrives twice
with the same idempotency key is dispatched twice.

So if an old replica and a new replica are both running, the same complaint
transition produces a message from each and **the citizen gets two**.

- **Docker Compose**: `docker compose up` recreates a service by stopping the old
  container before starting the new one. Nothing to do.
- **Kubernetes**: the chart sets `strategy.type: Recreate` for `pgr-services`
  (`devops/deploy-as-code/charts/urban/pgr-services/values.yaml`) precisely for
  this reason. A rolling update would run both versions side by side during the
  rollout. Do not change it to `RollingUpdate` for this release. Note that
  `type: Recreate` must not also carry a `rollingUpdate` block — the API rejects
  that combination.

There is no flag for any of this. Which path a deployment is on is decided by which
image it runs, and every dispatch-log row records it in `source_path`
(`PRERENDERED` or `RESOLVED`) so you can answer the question per message, in
production.

## Code References

| What | Where |
|---|---|
| Ansible deployment | [`local-setup/ansible/playbook-deploy.yml`](../../../local-setup/ansible/playbook-deploy.yml) |
| Workflow/provider bootstrap | [`backend/novu-bridge/config/bootstrap-novu-whatsapp.sh`](../../../backend/novu-bridge/config/bootstrap-novu-whatsapp.sh) |
| Notification seed | [`local-setup/scripts/seed-notifications.py`](../../../local-setup/scripts/seed-notifications.py) |
| Tenant-master repair | [`local-setup/scripts/repair-tenant-masters.py`](../../../local-setup/scripts/repair-tenant-masters.py) |
| Legacy-to-new master conversion | [`local-setup/scripts/notifications_convert.py`](../../../local-setup/scripts/notifications_convert.py) |
| Event-catalogue generator | [`local-setup/scripts/generate_event_catalogue.py`](../../../local-setup/scripts/generate_event_catalogue.py) |
| Configurator provider UI | [`configurator/src/resources/notification-providers/NotificationProviderList.tsx`](../../../configurator/src/resources/notification-providers/NotificationProviderList.tsx) |
| Provider administration API | [`backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java`](../../../backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java) |
| Routing, recipients, language and rendering | [`backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/NotificationResolver.java`](../../../backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/NotificationResolver.java) |
| Where the masters come from, and the legacy fallback | [`backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/digit/MdmsNotificationConfigRepository.java`](../../../backend/novu-bridge/src/main/java/org/egov/novubridge/service/resolution/digit/MdmsNotificationConfigRepository.java) |
| Bridge dispatch | [`backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java`](../../../backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java) |
| What PGR sends, as an executable spec | [`backend/novu-bridge/src/test/java/org/egov/novubridge/service/resolution/golden/ScenarioThinEventBuilder.java`](../../../backend/novu-bridge/src/test/java/org/egov/novubridge/service/resolution/golden/ScenarioThinEventBuilder.java) |

## Channels, receipts and per-recipient language

**Which channels deliver is decided per tenant, in the configurator.** Notifications →
**Channels** edits the MDMS master `NOTIFICATIONS.Channel` (one row per
channel: `enabled`, `gateway` = `novu` | `smscountry`, `senderId`, `provider`). novu-bridge reads it at the
state tenant on every dispatch (cached 60 s), falling back per tenant to the legacy
`RAINMAKER-PGR.NotificationChannel` when the new one has no rows
(`NOVU_BRIDGE_CHANNEL_POLICY_SCHEMA` / `_LEGACY_SCHEMA` — leave both unset; they are
defaults precisely so a dropped overlay cannot flip them). A tenant with no rows in
either falls back to the
`novu_bridge_channels_enabled` env list; a tenant *with* rows is governed by them alone — a
channel with no row is off. The **Notifications → Channels** screen shows the effective
state per channel and why (row present? enabled? Novu integration? workflow? sender id?).
"Validate" on the Configure screen warns about routing rows on a channel that is off.

**`SENT` means the transport accepted the message.** To move rows to `DELIVERED` / `BOUNCED` /
`FAILED`, point the provider's delivery report at the bridge:

| Provider | URL | Auth |
|---|---|---|
| Novu (webhook) | `POST <public>/novu-bridge/novu-adapter/v1/receipts/novu` | header `X-Receipt-Secret: <novu_bridge_receipts_secret>` |
| SMSCountry (DR callback) | `GET/POST <public>/novu-bridge/novu-adapter/v1/receipts/smscountry?secret=<…>` | query `secret` |

Set `NOVU_BRIDGE_RECEIPTS_SECRET` in `/opt/digit/.env` (blank = endpoint off, 403). The bridge
tolerates the common report shapes (it looks for a `transactionId` or job/message id and an
outcome word anywhere in the payload); only `SENT` rows move, so late or duplicate reports never
regress a row.

**Test sends are real rows at your tenant**, flagged `is_test`, hidden on the Logs screen
unless you pick "Show test sends". The "view in logs" button after a test opens the screen
with that filter on.

**Per-recipient language.** On the resolved path the bridge renders each recipient in their
`preferredLanguage` from digit-user-preferences-service (`NOVU_BRIDGE_PREFERENCE_HOST`, one
cached lookup per state tenant per TTL) and falls back to `NOVU_BRIDGE_DEFAULT_LOCALE`
(`en_IN`) — and, per template and per field, to the default-locale row when the recipient's
language has none. Leave the preference host blank and everyone gets the default locale.
Author templates in Notifications → Configure with the locale of your choice. Note that the
*placeholder values* are resolved once per event in a single locale, while the *template text*
is chosen per recipient; that is unchanged from the pre-rendered path and is deliberate.

**Two inbound kinds, one ledger, login OTPs included.** The bridge accepts a thin domain event
(`kind: "THIN"` — the box routes, resolves and renders it) and the pre-rendered envelope
(`kind` absent or `"RENDERED"`), on the same topics
(`NOVU_BRIDGE_KAFKA_INPUT_TOPICS`, default `complaints.domain.events,notifications.events`).
Both produce the same ledger rows and obey the same gates. It accepts `eventType`
`COMPLAINTS_WORKFLOW_TRANSITIONED` (pgr-services) and
`CORE_SMS`: DIGIT core's `egov.core.notification.sms` topic (user-otp login OTPs, egov-user
password resets), translated into the envelope by `CoreSmsTranslator`
(`NOVU_BRIDGE_CORE_SMS_TOPIC` / `_DEFAULT_TENANT` / `_COUNTRY_CODE`). There is no separate
SMS service for OTPs any more: `enable_otp_services: true` needs `enable_novu: true`, and the
OTP SMS obeys the tenant's channel policy, provider and dispatch log like any other event
(`eventName CORE.SMS.OTP`). SMS disabled for the tenant ⇒ login OTPs land as
`SKIPPED / NB_NO_PROVIDER`, and the Channels screen says so. Every event, including a rejected one, leaves a dispatch-log row
(`REJECTED` with the reason), so a producer sending the wrong shape is visible on the Logs
screen rather than only in the DLQ.

