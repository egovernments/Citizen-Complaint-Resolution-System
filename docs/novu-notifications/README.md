# Enable SMS and WhatsApp notifications

## 1. Set Ansible variables

Run repository commands below from the root of the cloned
`Citizen-Complaint-Resolution-System` repository. Update the Ansible variables in:

```text
local-setup/ansible/inventory/host_vars/<deployment>.yml
```

Set the common notification variables:

```yaml
enable_novu: true
pgr_notification_config_driven: true
seed_notifications: true

novu_bridge_channels_enabled: "SMS,WHATSAPP"
novu_bridge_channel: "sms"
novu_bridge_proxy_allowed_roles: "SUPERUSER,MDMS_ADMIN"

novu_admin_email: "<from secret manager>"
novu_admin_password: "<from secret manager>"
```

Add these WhatsApp variables:

```yaml
novu_bridge_workflow_id_whatsapp: "complaints-whatsapp"
novu_bridge_integration_id_whatsapp: "twilio-whatsapp"

twilio_account_sid: "<from secret manager>"
twilio_auth_token: "<from secret manager>"
twilio_whatsapp_from: "whatsapp:+<approved sender>"
```

Add the SMS workflow variable:

```yaml
novu_bridge_workflow_id_sms: "complaints-sms"
```

Leave `novu_api_key` unset unless the deployment already has a pinned key. Ansible
mints and wires one.

The last tested images for this guide are
`egovio/pgr-services:master-0938bdf` and
`egovio/novu-bridge:master-0469335`. Newer images should work.

For production, replace the repository fallback Novu Mongo, JWT,
storage-encryption, application-secret, and admin credentials through the deployment
secret manager. The current Ansible template does not expose every one of these
settings yet.

## 2. Deploy once

From the repository root:

```bash
(
  cd local-setup/ansible
  ./deploy.sh <deployment>
)
```

Wait for `failed=0`.

Before continuing, prove that Ansible minted and wired a usable Novu key. A green
play recap is not sufficient because the provider bootstrap is allowed to fail
without failing the deployment.

```bash
export NOVU_BASE_URL='http://127.0.0.1:14002'
export NOVU_API_KEY="$(sudo sed -n 's/^NOVU_API_KEY=//p' /opt/digit/.env | tail -1)"

test -n "$NOVU_API_KEY"
test "$NOVU_API_KEY" != changeme
curl -fsS -H "Authorization: ApiKey $NOVU_API_KEY" \
  "$NOVU_BASE_URL/v1/integrations" >/dev/null
```

Stop if any command fails. Configurator provider operations go through
`novu-bridge`; they cannot work while the bridge has an empty, placeholder, or
invalid Novu key.

Before using Configurator to manage providers, deploy and reload the current
`local-setup/kong/kong.yml`. An older Kong configuration lets the Providers screen
load but rejects provider POSTs with `InvalidAccessTokenException` before they reach
`novu-bridge`.

Those Kong routes delegate authentication to `novu-bridge`. Do not set
`NOVU_BRIDGE_PROXY_AUTH_ENABLED=false` on a reachable deployment; doing so makes
provider creation and test-send unauthenticated. Enforcing this invariant is tracked
in [issue #1942](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1942).

## 3. Enable WhatsApp

### Bootstrap the WhatsApp provider and workflow

Novu represents the Twilio WhatsApp provider as an `sms` integration. Run the
bootstrap script with the explicit WhatsApp contract below. This administers Novu;
it does not run the deployment again or trigger a message.

```bash
# Inject provider credentials through the operator's secret mechanism.
export TWILIO_ACCOUNT_SID='<from secret manager>'
export TWILIO_AUTH_TOKEN='<from secret manager>'
export TWILIO_WHATSAPP_FROM='whatsapp:+<approved sender>'

export NOVU_ENV_FILE=/dev/null
export NOVU_INTEGRATION_NAME=twilio-whatsapp
export NOVU_INTEGRATION_ID=twilio-whatsapp
export NOVU_WORKFLOW_ID=complaints-whatsapp
export NOVU_WORKFLOW_NAME=complaints-whatsapp
export NOVU_SMS_BODY='Complaint {{payload.complaintNo}} status is {{payload.status}}'

# Prevent creation of retired event-specific workflows.
export NOVU_EVENT_WORKFLOWS=,

bash backend/novu-bridge/config/bootstrap-novu-whatsapp.sh

unset TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_WHATSAPP_FROM NOVU_SMS_BODY
```

The script creates `twilio-whatsapp` when it is absent but does not update the
credentials of an existing integration. For an existing installation, update or
delete that integration in Novu before running the script.

Verify the WhatsApp integration and workflow:

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

Confirm that `twilio-whatsapp` is active and `complaints-whatsapp` exists.

### Complete a real WhatsApp delivery

Business-initiated WhatsApp messages require an approved Twilio Content SID. The
bridge skips WhatsApp events without one.

First confirm that notification configuration exists at the state root of the tenant
where the complaint will be filed. For example, a complaint in `pg.citya` resolves
notification configuration from `pg`. That may differ from the deployment's
`state_root` on a stock dump-based quickstart.

If the roots differ, re-run the idempotent notification seed for the complaint root:

```bash
export COMPLAINT_TENANT='pg.citya'
export NOTIF_TENANT="${COMPLAINT_TENANT%%.*}"
export DIGIT_URL='http://127.0.0.1:18000'
export DIGIT_USERNAME='ADMIN'
export DIGIT_PASSWORD='<from secret manager>'
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

1. Open **Notifications -> Providers -> Sync WhatsApp templates**.
2. Persist mappings from the configured Twilio account. Do not use the example
   Content SIDs shipped in the seed for another account.
3. Open **Notifications -> Configure** and verify the routing and message templates
   for the required PGR transitions.
4. Trigger a real complaint transition.
5. Check **Notifications -> Logs**, `nb_dispatch_log`, Novu activity, the provider
   console, and finally the handset.

`SENT` in the bridge log means Novu accepted the trigger; it is not proof that the
provider delivered the message.

## 4. Enable SMS

### Add the SMS provider

Open **Configurator -> Notifications -> Providers** while logged in as an employee
with an allowed provider-management role. Select **Add Provider** and enter:

```text
Channel:      SMS
Provider ID:  twilio
Name:         Twilio SMS
Identifier:   twilio-sms
Account SID:  <secret>
Auth Token:   <secret>
From:         +<sms sender>
```

Configurator creates an active integration, but it cannot make it primary, edit it,
delete it, or validate the Twilio credentials. Its **Verify** action confirms only
that Novu reports the integration as active.

Promote the new integration with Novu's administration API:

```bash
SMS_INTEGRATION_ID="$(
  curl -fsS -H "Authorization: ApiKey $NOVU_API_KEY" \
    "$NOVU_BASE_URL/v1/integrations" \
  | jq -er '.data[] | select(.identifier == "twilio-sms") | ._id'
)"

curl -fsS -X POST \
  -H "Authorization: ApiKey $NOVU_API_KEY" \
  "$NOVU_BASE_URL/v1/integrations/$SMS_INTEGRATION_ID/set-primary" \
  >/dev/null
```

Verify the SMS integration and workflow:

```bash
curl -fsS -H "Authorization: ApiKey $NOVU_API_KEY" \
  "$NOVU_BASE_URL/v1/integrations" \
| jq '[.data[] | select(.identifier == "twilio-sms") |
       {identifier,providerId,channel,active,primary}]'

curl -fsS -H "Authorization: ApiKey $NOVU_API_KEY" \
  "$NOVU_BASE_URL/v2/workflows?limit=100&page=0" \
| jq '[.data.workflows[] | select(.workflowId == "complaints-sms") |
       .workflowId]'
```

Confirm that `twilio-sms` is active and primary and that `complaints-sms` exists.

## After enabling the channels

Remove the setup values from the current shell:

```bash
unset NOVU_API_KEY NOVU_BASE_URL SMS_INTEGRATION_ID
unset NOVU_ENV_FILE NOVU_INTEGRATION_NAME NOVU_INTEGRATION_ID
unset NOVU_WORKFLOW_ID NOVU_WORKFLOW_NAME NOVU_EVENT_WORKFLOWS
```

Configurator can create provider integrations, manage notification configuration,
sync WhatsApp templates, validate the configuration, and display bridge dispatch
logs.

Configurator cannot start Novu, enable the Compose profile, set service environment
flags, mint or wire the Novu API key, create workflows, rotate or delete integrations,
select the primary SMS integration, or validate provider credentials. Those remain
deployment or Novu administration operations.

## Code references

- Ansible deployment: [`local-setup/ansible/playbook-deploy.yml`](../../local-setup/ansible/playbook-deploy.yml)
- Workflow/provider bootstrap: [`backend/novu-bridge/config/bootstrap-novu-whatsapp.sh`](../../backend/novu-bridge/config/bootstrap-novu-whatsapp.sh)
- Notification seed: [`local-setup/scripts/seed-notifications.py`](../../local-setup/scripts/seed-notifications.py)
- Configurator provider UI: [`configurator/src/resources/notification-providers/NotificationProviderList.tsx`](../../configurator/src/resources/notification-providers/NotificationProviderList.tsx)
- Provider administration API: [`backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java`](../../backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java)
- PGR routing/rendering: [`backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java`](../../backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java)
- Bridge dispatch: [`backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java`](../../backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java)
