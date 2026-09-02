# Enabling Notifications

This enables SMS and WhatsApp notifications on a deployment created with
[DEPLOYMENT.MD](../../DEPLOYMENT.MD). Run the repository commands below from the
root of the cloned `Citizen-Complaint-Resolution-System` repository.

## Prerequisites

1. A deployment created by `./deploy.sh mycity`, or the same variables file before
   its first run. Adding these variables before the first deploy avoids a second run.
2. For WhatsApp, a Twilio account with a WhatsApp-enabled sender and approved
   message templates. Without approved templates nothing is delivered.
3. For SMS, an SMSCountry account on the legacy bulk API, its panel login, and a
   registered sender id. For Indian destinations you also need DLT-registered
   templates — see [Registering templates](#registering-templates-india-dlt).

The two are independent. SMS through SMSCountry does not touch Novu or Twilio, so
an SMS-only deployment needs no Twilio account and a WhatsApp-only one needs no
SMSCountry account.

Last tested with `egovio/pgr-services:master-0938bdf` and
`egovio/novu-bridge:master-0469335`.

## Configure Notification Variables

Add the variables below to the same Ansible variables file used for the
deployment: `local-setup/ansible/inventory/host_vars/mycity.yml`.

| Setting | What it is | Example |
|---|---|---|
| `enable_novu` | Starts Novu and the notification stack. Nothing below works without it. | `true` |
| `pgr_notification_config_driven` | Makes PGR read routing and templates from configuration instead of code. | `true` |
| `seed_notifications` | Seeds the three PGR notification MDMS masters on deploy. Idempotent. | `true` |
| `novu_bridge_channels_enabled` | Channels the bridge will dispatch. | `"SMS,WHATSAPP"` |
| `novu_bridge_channel` | Novu channel the bridge triggers on. Twilio WhatsApp is an `sms` integration in Novu, so this stays `sms` for both channels. | `"sms"` |
| `novu_bridge_proxy_allowed_roles` | Roles allowed to manage providers from Configurator. | `"SUPERUSER,MDMS_ADMIN"` |
| `novu_admin_email` | Novu admin account. Use an address you control. | `notifications-admin@example.com` |
| `novu_admin_password` | Novu admin password. Generate a unique, strong one. | |
| `novu_bridge_workflow_id_whatsapp` | Novu workflow the bridge triggers for WhatsApp. Must match the workflow created during [Enable WhatsApp](#enable-whatsapp). | `"complaints-whatsapp"` |
| `novu_bridge_integration_id_whatsapp` | Novu integration the bridge selects for WhatsApp. Leave blank unless a second integration exists on Novu's `sms` channel. | |
| `novu_bridge_workflow_id_sms` | Novu workflow the bridge triggers for ordinary SMS. | `"complaints-sms"` |
| `twilio_account_sid` | From the Twilio Console. | |
| `twilio_auth_token` | From the Twilio Console. | |
| `twilio_whatsapp_from` | Your Twilio WhatsApp sender, with the `whatsapp:` prefix. Defaults to the Twilio sandbox number if omitted. | `whatsapp:+14155238886` |
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

### Bootstrap the provider and workflow

If `twilio_account_sid` was set before the deployment, this is already done. The
deploy runs the same script, and its defaults produce the same integration and the
same workflows — only the workflow's display name differs, which nothing keys on.
Skip to [Verify the WhatsApp provider](#verify-the-whatsapp-provider).

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

### Verify the WhatsApp provider

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

If you are also enabling ordinary SMS, `twilio-whatsapp` must end up **not**
primary: [Enable SMS](#enable-sms) makes `twilio-sms` the primary integration on
that channel, and the bridge selects the WhatsApp one explicitly by identifier. On
a WhatsApp-only deployment, `twilio-whatsapp` may remain primary.

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
DATA_DIR=/opt/digit/notification-seed \
python3 seed-notifications.py

unset DIGIT_PASSWORD
```

Wait for `DONE`, then log in to Configurator at the same `NOTIF_TENANT`.
Configurator writes notification configuration at the tenant used for the session.
If it writes to the deployment root instead, PGR finds no routing for the complaint
tenant and emits no notification events. The automatic fix is tracked in
[issue #1943](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1943).

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

Set these and re-run `./deploy.sh mycity`:

| Setting | What it is | Example |
|---|---|---|
| `novu_bridge_sms_provider` | Selects the SMS gateway. | `smscountry` |
| `novu_bridge_sms_sender_id` | Your registered sender id. | `EGOVFS` |
| `novu_bridge_smscountry_user` | SMSCountry panel username. | |
| `novu_bridge_smscountry_password` | SMSCountry panel password. | |

Then trigger a complaint transition and check the **delivery report in the
SMSCountry panel** — not the bridge log. The gateway returns a job id for messages
it later drops, so `nb_dispatch_log` only tells you the message was queued. A
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

## Clean Up

Remove the setup values from the current shell:

```bash
unset NOVU_API_KEY NOVU_BASE_URL
unset NOVU_ENV_FILE NOVU_INTEGRATION_NAME NOVU_INTEGRATION_ID
unset NOVU_WORKFLOW_ID NOVU_WORKFLOW_NAME
```

## What Configurator Can and Cannot Do

| Configurator can | Configurator cannot |
|---|---|
| Create provider integrations | Edit, rotate, or delete integrations |
| Manage notification configuration | Select the primary SMS integration |
| Sync WhatsApp templates | Validate provider credentials |
| Validate the configuration | Mint or wire the Novu API key |
| Display bridge dispatch logs | Start Novu, enable the Compose profile, set service environment flags, or create workflows |

Everything in the right-hand column is a deployment or Novu administration
operation.

## Code References

| What | Where |
|---|---|
| Ansible deployment | [`local-setup/ansible/playbook-deploy.yml`](../../local-setup/ansible/playbook-deploy.yml) |
| Workflow/provider bootstrap | [`backend/novu-bridge/config/bootstrap-novu-whatsapp.sh`](../../backend/novu-bridge/config/bootstrap-novu-whatsapp.sh) |
| Notification seed | [`local-setup/scripts/seed-notifications.py`](../../local-setup/scripts/seed-notifications.py) |
| Configurator provider UI | [`configurator/src/resources/notification-providers/NotificationProviderList.tsx`](../../configurator/src/resources/notification-providers/NotificationProviderList.tsx) |
| Provider administration API | [`backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java`](../../backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java) |
| PGR routing/rendering | [`backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java`](../../backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java) |
| Bridge dispatch | [`backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java`](../../backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java) |
