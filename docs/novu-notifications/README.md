# Enable SMS and WhatsApp notifications

This is the complete Ansible path for enabling config-driven PGR notifications on a CCRS deployment. It assumes current master, including the SMS/WhatsApp integration-selection fix.

The runtime path is:

```text
PGR transition
  -> state-root NotificationRouting + NotificationTemplate
  -> complaints.domain.events
  -> novu-bridge
  -> complaints-sms or complaints-whatsapp
  -> the matching Novu provider
```

Do the following in order. Run the full deployment only once.

## 1. Set inventory once

Add the notification settings and WhatsApp-bootstrap credentials to:

```text
/opt/ccrs/local-setup/ansible/inventory/host_vars/<deployment>.yml
```

```yaml
enable_novu: true
pgr_notification_config_driven: true
seed_notifications: true

novu_bridge_channels_enabled: "SMS,WHATSAPP"
novu_bridge_channel: "sms"
novu_bridge_workflow_id_sms: "complaints-sms"
novu_bridge_workflow_id_whatsapp: "complaints-whatsapp"
novu_bridge_integration_id_whatsapp: "twilio-whatsapp"
novu_bridge_proxy_allowed_roles: "SUPERUSER,MDMS_ADMIN"

novu_admin_email: "<from secret manager>"
novu_admin_password: "<from secret manager>"

twilio_account_sid: "<from secret manager>"
twilio_auth_token: "<from secret manager>"
twilio_whatsapp_from: "whatsapp:+<approved sender>"
```

`twilio_*` configures the WhatsApp integration. A separate ordinary-SMS provider is added in step 3. Leave `novu_api_key` unset unless the deployment already has a pinned key; Ansible mints and wires one.

Use a PGR image containing the config-driven notification path. For the bridge,
the stock launchers pin the published multi-architecture image
`egovio/novu-bridge:master-0469335`, which contains PR #1905's explicit WhatsApp
integration selection. Do not substitute the older `master-7c91934` image: it sends
WhatsApp through the primary SMS integration and Twilio rejects the channel-mismatched
sender. If inventory overrides `novu_bridge_image`, verify that its build contains
PR #1905 before deploying.

For production, replace the repository fallback Novu Mongo, JWT, storage-encryption, application-secret, and admin credentials through the deployment secret manager. The current Ansible template does not expose every one of those settings yet.

## 2. Deploy once

```bash
cd /opt/ccrs/local-setup/ansible
./deploy.sh <deployment>
```

Wait for `failed=0`. This starts Novu and the bridge, enables config-driven PGR, mints the Novu key, and seeds these state-root MDMS masters:

- `RAINMAKER-PGR.NotificationRouting`
- `RAINMAKER-PGR.NotificationTemplate`
- `RAINMAKER-PGR.NotificationProviderTemplate`

Do not run `deploy.sh` again for provider or workflow setup.

Before continuing, prove that Ansible actually minted and wired a usable key. A
green play recap is not sufficient on current master because the provider
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
`novu-bridge`; they cannot work while the bridge has an empty, placeholder, or
invalid Novu key.

## 3. Add the ordinary-SMS provider

SMS and WhatsApp are both Novu `sms` integrations, but they require different
senders. Current master does **not** automate the ordinary-SMS integration or
make it primary. It automates only the WhatsApp integration. This is a bootstrap
automation gap; until it is fixed, this step requires both Configurator and the
Novu API.

The SMS/WhatsApp integration-selection fix does not provision either provider.
It assumes ordinary SMS is already primary and only makes WhatsApp select
`twilio-whatsapp` explicitly at dispatch time.

> **Gateway prerequisite:** deploy and reload the current `local-setup/kong/kong.yml`
> before using the Configurator to add a provider. Older Kong configurations let
> the Providers screen load but reject **Add Provider** with
> `InvalidAccessTokenException` because the Bearer-authenticated provider POSTs
> are intercepted before they reach `novu-bridge` (fixed by `477b2436`).

> **Keep bridge authentication enabled:** those Kong exceptions delegate
> authentication to `novu-bridge`. Do not set
> `NOVU_BRIDGE_PROXY_AUTH_ENABLED=false` on a reachable deployment; doing so also
> makes provider creation and test-send unauthenticated. Enforcing this invariant
> automatically is tracked in
> [issue #1942](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1942).

Open **Configurator -> Notifications -> Providers** while logged in as an
employee with an allowed provider-management role. Select **Add Provider** and
enter:

```text
Channel:      SMS
Provider ID:  twilio
Name:         Twilio SMS
Identifier:   twilio-sms
Account SID:  <secret>
Auth Token:   <secret>
From:         +<sms sender>
```

Configurator creates an active Novu integration, but it cannot make it primary,
edit it, delete it, or validate the Twilio credentials. Its **Verify** action
only confirms that Novu reports the integration as active.

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

curl -fsS -H "Authorization: ApiKey $NOVU_API_KEY" \
  "$NOVU_BASE_URL/v1/integrations" \
| jq '[.data[] | {identifier,providerId,channel,active,primary}]'
```

Confirm that `twilio-sms` has `active: true` and `primary: true`. The bridge uses
this primary integration for ordinary SMS and explicitly selects
`twilio-whatsapp` for WhatsApp.

If ordinary SMS is not required, remove `SMS` from `novu_bridge_channels_enabled` and skip this step.

## 4. Correctly bootstrap the WhatsApp provider and fixed workflows

Current master attempts this bootstrap during `deploy.sh`, but invokes the script with defaults that can create the wrong WhatsApp workflow ID and retired event workflows. Run the script once more with the explicit contract below. This is a targeted Novu API operation, not a second deployment.

The uppercase values below are script inputs; they are not Ansible variables and should not be added to YAML.

```bash
cd /opt/ccrs/backend/novu-bridge/config

# Inject provider credentials through the operator's secret mechanism.
export TWILIO_ACCOUNT_SID='<from secret manager>'
export TWILIO_AUTH_TOKEN='<from secret manager>'
export TWILIO_WHATSAPP_FROM='whatsapp:+<approved sender>'

export NOVU_BASE_URL='http://127.0.0.1:14002'
export NOVU_API_KEY="$(sudo sed -n 's/^NOVU_API_KEY=//p' /opt/digit/.env | tail -1)"
export NOVU_ENV_FILE=/dev/null
export NOVU_INTEGRATION_NAME=twilio-whatsapp
export NOVU_INTEGRATION_ID=twilio-whatsapp
export NOVU_WORKFLOW_ID=complaints-whatsapp
export NOVU_WORKFLOW_NAME=complaints-whatsapp
export NOVU_SMS_WORKFLOW_ID=complaints-sms
export NOVU_EMAIL_WORKFLOW_ID=complaints-email
export NOVU_SMS_BODY='Complaint {{payload.complaintNo}} status is {{payload.status}}'

# Current master still contains retired event-workflow bootstrap code. A comma
# is non-empty (so the script does not restore its defaults) but yields no IDs.
export NOVU_EVENT_WORKFLOWS=,

bash ./bootstrap-novu-whatsapp.sh

unset NOVU_SMS_BODY TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_WHATSAPP_FROM
```

This command only administers Novu integrations and workflows. It does not start or restart DIGIT and does not trigger a message.

The current-master script creates an integration when absent but does not update credentials on an existing `twilio-whatsapp`. For an existing installation, update or delete that integration in Novu before running the script.

The bridge uses only these fixed workflows:

```text
complaints-sms
complaints-whatsapp
complaints-email    # required only when EMAIL is enabled
```

Do not create `COMPLAINTS.WORKFLOW.*` Novu workflows. They belong to a retired event-specific design and are not selected by the current bridge runtime.

## 5. Verify the bootstrap

```bash
curl -fsS -H "Authorization: ApiKey $NOVU_API_KEY" \
  "$NOVU_BASE_URL/v1/integrations" \
  | jq '[.data[] | {identifier,providerId,channel,active,primary}]'

curl -fsS -H "Authorization: ApiKey $NOVU_API_KEY" \
  "$NOVU_BASE_URL/v2/workflows?limit=100&page=0" \
  | jq '[.data.workflows[].workflowId]'

unset NOVU_API_KEY NOVU_BASE_URL SMS_INTEGRATION_ID
unset NOVU_ENV_FILE NOVU_INTEGRATION_NAME NOVU_INTEGRATION_ID
unset NOVU_WORKFLOW_ID NOVU_WORKFLOW_NAME NOVU_SMS_WORKFLOW_ID
unset NOVU_EMAIL_WORKFLOW_ID NOVU_EVENT_WORKFLOWS
```

Confirm:

- the ordinary-SMS integration is active and primary;
- `twilio-whatsapp` is active;
- `complaints-sms` and `complaints-whatsapp` exist exactly as written;
- `/opt/digit/.env` contains `PGR_NOTIFICATION_CONFIG_DRIVEN=true` and `NOVU_BRIDGE_CHANNELS_ENABLED=SMS,WHATSAPP`.

For a non-delivery infrastructure check, stop here.

## 6. Complete real WhatsApp delivery

Business-initiated WhatsApp messages require an approved Twilio Content SID. The bridge deliberately skips WhatsApp events without one.

First confirm that the notification masters live at the state root of the tenant
where the complaint will be filed. For example, a complaint in `pg.citya` resolves
notification configuration from `pg`. That may differ from the deployment's
`state_root` on a stock dump-based quickstart.

If the roots differ, re-run the idempotent notification seed for the complaint root
before continuing:

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

Wait for `DONE`, then log in to Configurator at that same `NOTIF_TENANT` before
persisting the provider-template mappings below. Configurator writes notification
MDMS at the tenant used for the session. If it writes to the deployment root instead,
PGR finds no routing for the complaint tenant and emits no notification events. The
automatic fix for this stock-quickstart mismatch is tracked in
[issue #1943](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1943).

1. In Configurator, open **Notifications -> Providers -> Sync WhatsApp templates**.
2. Persist mappings from the configured Twilio account into `RAINMAKER-PGR.NotificationProviderTemplate`. Do not use the example SIDs shipped in the seed for another account.
3. In **Notifications -> Configure**, verify or edit state-root routing and message templates for the required PGR transitions.
4. Trigger a real complaint transition.
5. Check **Notifications -> Logs**, `nb_dispatch_log`, Novu activity, the provider console, and finally the handset.

`SENT` in the bridge log means Novu accepted the trigger; it is not proof that the provider delivered the message.

## What Configurator can and cannot do

Configurator can create provider integrations, manage the three notification MDMS masters, sync WhatsApp templates, validate notification MDMS, and display bridge dispatch logs.

Configurator cannot start Novu, enable the Compose profile, set PGR/bridge environment flags, mint or wire the Novu API key, create the fixed workflows, rotate/delete integrations, select the primary SMS integration, or verify provider credentials. Those remain deployment or Novu administration operations.

## Code references

- Ansible deployment: [`local-setup/ansible/playbook-deploy.yml`](../../local-setup/ansible/playbook-deploy.yml)
- Workflow/provider bootstrap: [`backend/novu-bridge/config/bootstrap-novu-whatsapp.sh`](../../backend/novu-bridge/config/bootstrap-novu-whatsapp.sh)
- Notification MDMS seed: [`local-setup/scripts/seed-notifications.py`](../../local-setup/scripts/seed-notifications.py)
- Configurator provider UI: [`configurator/src/resources/notification-providers/NotificationProviderList.tsx`](../../configurator/src/resources/notification-providers/NotificationProviderList.tsx)
- Provider administration API: [`backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java`](../../backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java)
- PGR routing/rendering: [`backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java`](../../backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java)
- Bridge dispatch: [`backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java`](../../backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java)
