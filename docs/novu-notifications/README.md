# Enable Novu notifications

This is the only current guide for CCRS notifications. It covers the config-driven PGR path on Compose and Ansible deployments. It assumes the WhatsApp integration-selection fix from master PR #1905 is present in the deployed `novu-bridge` image.

The supported flow is:

```text
PGR transition
  -> state-root NotificationRouting + NotificationTemplate
  -> one rendered Kafka event per recipient and channel
  -> novu-bridge
  -> fixed Novu workflow
  -> Novu provider integration
  -> recipient
```

PGR resolves recipients and renders content. The bridge gates channels, selects the workflow/provider, triggers Novu, and records trigger outcomes. Configurator manages routing, content, and initial provider creation; deployment automation must establish the platform first.

## The complete Ansible sequence

For a new Ansible-managed deployment, the linear path is:

1. Put every supported durable notification setting and the WhatsApp-bootstrap credentials in `inventory/host_vars/<deployment>.yml` using the block in step 2. Ordinary-SMS provider credentials live in Novu and are added in step 3.
2. Run `./deploy.sh <deployment>` once. It starts Novu, mints and wires the Novu API key, enables config-driven PGR, and seeds notification MDMS.
3. If SMS is enabled, create the distinct ordinary-SMS provider and make it the primary Novu `sms` integration as described in step 4.
4. Run `bootstrap-novu-whatsapp.sh` once with the explicit environment contract in step 5. This creates the WhatsApp integration and the exact workflow identifiers without running Ansible again.
5. For real WhatsApp delivery, replace the seeded example Content SIDs with mappings from the configured Twilio account. Author or verify PGR routing and message templates in Configurator.
6. Verify the configuration, then generate a real complaint transition only when a delivery test is intended.

Steps 1–4 are sufficient for a non-delivery platform/bootstrap validation. Actual end-to-end delivery also requires steps 5–6.

The uppercase values in step 5 are inputs to the shell script; do not add them to Ansible YAML. The playbook does not read `NOVU_WORKFLOW_NAME`, `NOVU_SMS_WORKFLOW_ID`, `NOVU_EMAIL_WORKFLOW_ID`, or `NOVU_EVENT_WORKFLOWS`. Conversely, keep the lowercase Ansible variables in inventory so a future deployment does not revert the configuration. `NOVU_API_KEY` is normally minted during step 2 and read from `/opt/digit/.env` by the targeted command afterward.

## Before you start

You need:

- a state-root tenant such as `ke` and a deployment administrator for that tenant;
- Kafka, PostgreSQL, Redis, MDMS v2, egov-user, PGR, Novu, and `novu-bridge`;
- a provider account for every channel you will enable;
- approved Twilio/Meta Content templates for WhatsApp;
- a bridge and PGR image containing the config-driven notification code;
- a `novu-bridge` image containing the WhatsApp integration-selection fix.

Compose and Ansible are the supported bootstrap paths. The Helm charts deploy components but do not currently perform the complete PGR flag, workflow, provider, and MDMS bootstrap described here.

Do not allow complaint traffic until every enabled channel has its workflow and provider ready.

## 1. Choose channels and providers

| CCRS channel | Novu step | Provider requirement |
|---|---|---|
| `SMS` | `sms` | A plain-SMS integration, normally primary; for example Twilio with `from: +...` |
| `WHATSAPP` | `sms` | A distinct Twilio integration with `from: whatsapp:+...` and a stable identifier such as `twilio-whatsapp` |
| `EMAIL` | `email` | An SMTP/Nodemailer integration |

Novu models both Twilio SMS and WhatsApp as `sms`. CCRS disambiguates them by sending `overrides.sms.integrationIdentifier` for WhatsApp. Keep the ordinary SMS integration primary and set `NOVU_BRIDGE_INTEGRATION_ID_WHATSAPP` to the exact identifier of the WhatsApp integration.

## 2. Set durable deployment configuration

For a production deployment, replace every repository fallback secret. Store these values in the deployment's secret manager or authoritative inventory, not in documentation or shell history:

```text
NOVU_MONGO_USERNAME
NOVU_MONGO_PASSWORD
NOVU_JWT_SECRET
NOVU_STORE_ENCRYPTION_KEY
NOVU_SECRET_KEY
NOVU_BRIDGE_SECRET_KEY
NOVU_ADMIN_EMAIL
NOVU_ADMIN_PASSWORD
```

The current Ansible environment template does not expose all of the Mongo/JWT/storage/application secret variables. Do not take the fallback values into production; add secret-manager-backed inventory/template wiring for them before enabling Novu on a production host.

The effective notification settings must include:

```text
PGR_NOTIFICATION_CONFIG_DRIVEN=true
NOVU_BRIDGE_CHANNELS_ENABLED=SMS,WHATSAPP
NOVU_BRIDGE_INTEGRATION_ID_WHATSAPP=twilio-whatsapp
NOVU_BRIDGE_PROXY_ALLOWED_ROLES=SUPERUSER,MDMS_ADMIN
```

Add `EMAIL` only after SMTP is configured. Restrict the proxy role list to deployment administrators; provider integrations affect the whole Novu environment, not one city tenant.

For Ansible, use inventory rather than editing `/opt/digit/.env`:

```yaml
enable_novu: true
pgr_notification_config_driven: true
seed_notifications: true
novu_bridge_channels_enabled: "SMS,WHATSAPP"
novu_bridge_integration_id_whatsapp: "twilio-whatsapp"
novu_bridge_proxy_allowed_roles: "SUPERUSER,MDMS_ADMIN"

novu_admin_email: "<from secret manager>"
novu_admin_password: "<from secret manager>"

twilio_account_sid: "<from secret manager>"
twilio_auth_token: "<from secret manager>"
twilio_whatsapp_from: "whatsapp:+<approved sender>"
```

Set every value before starting, then run the normal deployment playbook once. Do not run the full deployment a second time just to create Novu integrations or workflows; step 5 performs that targeted operation against the running Novu API. Keep complaint traffic stopped until the provider and workflow verification is complete. Direct changes to the generated `.env` will be overwritten on the next Ansible deployment.

```bash
cd /opt/ccrs/local-setup/ansible
./deploy.sh <deployment>
```

## 3. Bootstrap the platform and base MDMS

For a standalone Compose deployment, run the installer through step 6 first:

```bash
cd local-setup

# Supply admin credentials through the operator's secret-injection mechanism.
export CHANNELS_ENABLED=SMS,WHATSAPP
export PROXY_ALLOWED_ROLES=SUPERUSER,MDMS_ADMIN
export NOTIF_TENANT=ke
export NOVU_BRIDGE_INTEGRATION_ID_WHATSAPP=twilio-whatsapp
export NOVU_BRIDGE_IMAGE_WA='<verified bridge image built from master>'
export PGR_IMAGE_WA='<verified PGR image built from master>'

./scripts/enable-notifications.sh --to step6 --local --yes
```

Steps 1–6:

1. enable config-driven PGR;
2. start Novu, `novu-bridge`, and migrations;
3. create/fetch the Novu Development API key and wire it into the bridge;
4. set the channel and proxy-role gates;
5. handle or validate ingress;
6. create the three state-root notification MDMS schemas and seed their base rows.

The installer and MDMS seeder are create-or-skip, not desired-state reconcilers. Review existing rows instead of assuming a rerun repaired them. The seed contains example WhatsApp Content SIDs; replace them with templates from the configured provider account before enabling production WhatsApp delivery.

For Ansible, the playbook starts the services, mints/wires the key, and seeds MDMS when `enable_novu` is true. The explicit workflow/provider bootstrap in step 5 is the compatibility path for current master and the final verification after the playbook completes.

## 4. Create the ordinary SMS provider first

When SMS and WhatsApp are both required on a fresh Novu environment, create the ordinary SMS integration first and verify it is the primary `sms` integration.

In Configurator, log in to the state-root tenant, open **Notifications → Providers**, and add:

```json
{
  "channel": "SMS",
  "providerId": "twilio",
  "name": "Twilio SMS",
  "identifier": "twilio-sms",
  "credentials": {
    "accountSid": "<secret>",
    "token": "<secret>",
    "from": "+<sms sender>"
  }
}
```

Configurator sends this to `POST /novu-bridge/novu-adapter/v1/providers` with the operator's DIGIT bearer token. The equivalent direct Novu endpoint is `POST /v1/integrations` with `Authorization: ApiKey <NOVU_API_KEY>`.

Configurator creates integrations but cannot rotate, deactivate, delete, or select the primary integration. Use the Novu dashboard/API for those lifecycle operations.

If an existing automation run already created WhatsApp first, explicitly make the ordinary SMS integration primary in Novu before opening the SMS channel.

## 5. Create workflows and the WhatsApp integration

The bridge expects these exact workflow IDs:

| Workflow ID | Step content |
|---|---|
| `complaints-sms` | SMS body `{{ payload.body }}` |
| `complaints-email` | Email subject `{{ payload.subject }}` and body `{{ payload.body }}` |
| `complaints-whatsapp` | Twilio SMS-type step; the bridge supplies the WhatsApp recipient, integration identifier, Content SID, and variables |

For the Twilio WhatsApp path, continue the Compose installer after supplying the account's real credentials:

```bash
export TWILIO_ACCOUNT_SID='<from secret manager>'
export TWILIO_AUTH_TOKEN='<from secret manager>'
export TWILIO_WHATSAPP_FROM='whatsapp:+<approved sender>'
export CHANNELS_ENABLED=SMS,WHATSAPP
export NOVU_BRIDGE_INTEGRATION_ID_WHATSAPP=twilio-whatsapp

# Current-master compatibility: Novu 2.3 derives workflow IDs from names,
# and dotted event IDs otherwise create new suffixed workflows on every run.
export NOVU_ENV_FILE=/dev/null
export NOVU_WORKFLOW_NAME=complaints-whatsapp
export NOVU_EVENT_WORKFLOWS=complaints-workflow-apply,complaints-workflow-assign

./scripts/enable-notifications.sh --from step7 --local --yes
```

This creates the dedicated integration with identifier `twilio-whatsapp` and creates the fixed workflows if absent. Confirm that the durable Compose `.env` also contains:

```text
NOVU_BRIDGE_INTEGRATION_ID_WHATSAPP=twilio-whatsapp
```

Then recreate `novu-bridge`. Merely exporting the value for one installer run is not durable.

For an Ansible-managed deployment, the credentials and bridge integration identifier are already durable in inventory from step 2. Do **not** run the deployment again. Run only the repository bootstrap script against the Novu API that is already up:

```bash
cd /opt/ccrs/backend/novu-bridge/config

# Inject these three through the operator's secret mechanism. They are shown
# as exports only to make the script's input contract explicit.
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
export NOVU_EVENT_WORKFLOWS=complaints-workflow-apply,complaints-workflow-assign

bash ./bootstrap-novu-whatsapp.sh

unset NOVU_API_KEY TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_WHATSAPP_FROM
```

This command does not start or restart DIGIT and does not trigger a notification. It only calls Novu's integration and workflow administration APIs. Run it from the repository directory so `load-dotenv.sh` remains beside the bootstrap script.

The compatibility variables are intentional:

- `NOVU_ENV_FILE=/dev/null` prevents the tracked dummy `.env.novu` values from filling an omitted variable.
- `NOVU_WORKFLOW_NAME=complaints-whatsapp` forces Novu 2.3 to create the exact ID the bridge triggers.
- normalized `NOVU_EVENT_WORKFLOWS` values make the current script's existence check rerun-safe.

On current master, an existing integration is create-or-skip: this command will not rotate credentials under an existing `twilio-whatsapp` identifier. Update/delete that integration in Novu before rerunning, or use the reconciliation behavior from PR #1912. A first-time bootstrap does not have this limitation.

For a deployment without WhatsApp, stop after step 6 and create the required workflows with Novu `POST /v2/workflows`; the current all-in-one workflow bootstrap requires Twilio WhatsApp credentials even for an SMS/email-only rollout.

For email, add an SMTP provider in Configurator before adding `EMAIL` to the channel gate:

```json
{
  "channel": "EMAIL",
  "providerId": "nodemailer",
  "name": "Primary SMTP",
  "identifier": "smtp-primary",
  "credentials": {
    "host": "smtp.example.org",
    "port": "587",
    "user": "<user>",
    "password": "<secret>",
    "from": "notifications@example.org",
    "secure": false
  }
}
```

## 6. Import WhatsApp templates

In Configurator, open **Notifications → Providers → Sync WhatsApp templates**. Review the matched templates and persist them as `RAINMAKER-PGR.NotificationProviderTemplate` rows.

The mappings must:

- use the configured Twilio account's approved `HX...` Content SIDs;
- target `WHATSAPP`;
- match the routing audience, action, target state, and locale;
- preserve the required positional variable order;
- be active and approved.

The current sync code uses the first Twilio integration containing credentials. If ordinary SMS and WhatsApp use different Twilio accounts, do not accept the result blindly; verify the account or persist the mappings from the intended account using `local-setup/scripts/persist-provider-templates.py`.

## 7. Configure PGR routing and message content

Still logged in to the state-root tenant, open **Notifications → Configure** and author the PGR transitions that should send notifications.

Each active route needs a matching active message template with the same:

```text
audience + action + toState + channel + locale
```

The three runtime masters are:

- `RAINMAKER-PGR.NotificationRouting` — who is notified and on which channel;
- `RAINMAKER-PGR.NotificationTemplate` — rendered SMS/email/fallback content;
- `RAINMAKER-PGR.NotificationProviderTemplate` — approved provider-template mapping for WhatsApp.

PGR reads these masters from the state-root tenant even when the complaint belongs to a city tenant. Configurator currently writes to the authenticated session tenant, so do not author notification configuration while logged into a city tenant.

Phone normalization also depends on `common-masters.MobileNumberValidation`; verify it separately because the notification seeder does not create it.

## 8. Verify end to end

Do not treat an active integration or a successful API trigger as proof of delivery.

1. Confirm Novu API authentication and the three expected workflow IDs.
2. Confirm the plain SMS integration is primary and the WhatsApp identifier exactly matches `NOVU_BRIDGE_INTEGRATION_ID_WHATSAPP`.
3. Use Configurator test-send as a provider/workflow smoke test. With the master fix, WhatsApp test-send targets the configured WhatsApp integration.
4. Create or update a real complaint through a configured workflow transition.
5. Confirm PGR emitted `complaints.domain.events` and `novu-bridge` consumed it.
6. Inspect **Notifications → Logs** or `nb_dispatch_log`.
7. Correlate the transaction in Novu and the provider console.
8. Confirm the message reached the handset or inbox.

Bridge log meanings:

| Status | Meaning |
|---|---|
| `SENT` | Novu accepted the trigger request; this is not proof of provider delivery |
| `FAILED` | Bridge processing or Novu trigger failed |
| `SKIPPED` | Channel disabled, contact missing, preference denied, or another gate rejected the event |
| `RECEIVED` | Validation-only processing |

The live test suite is in `local-setup/tests/e2e/notifications/`.

## Disable or roll back

For a reversible cutback:

1. set `PGR_NOTIFICATION_CONFIG_DRIVEN=false` to return PGR to its legacy notification path;
2. remove channels from `NOVU_BRIDGE_CHANNELS_ENABLED` and recreate the bridge;
3. keep Novu and MDMS data intact until the fallback is validated.

A full decommission additionally requires revoking the Novu key, removing provider credentials and workflows, deactivating notification MDMS rows, stopping the notifications profile, and closing Novu ingress. Those are explicit destructive operations and are not performed by `enable-notifications.sh`.

## Current boundaries

- The config-driven producer documented here is PGR-specific.
- Configurator cannot start services, set deployment flags, mint/wire the bridge key, create MDMS schemas, or reconcile workflows.
- Provider management is create-only in Configurator.
- Configurator's provider Verify action checks that the Novu integration is present and active; it does not validate credentials with Twilio/SMTP.
- Static Configurator validation checks MDMS coherence, not live deployment readiness.
- Preferred language is not currently used for per-recipient template selection.
- The bridge retry topic is consumed but current failures are not automatically published to it; inspect/replay the DLQ operationally.

## Code references

- Platform installer: [`local-setup/scripts/enable-notifications.sh`](../../local-setup/scripts/enable-notifications.sh)
- MDMS seeder: [`local-setup/scripts/seed-notifications.py`](../../local-setup/scripts/seed-notifications.py)
- Novu key bootstrap: [`backend/novu-bridge/config/novu-mint-key.sh`](../../backend/novu-bridge/config/novu-mint-key.sh)
- Workflow/WhatsApp bootstrap: [`backend/novu-bridge/config/bootstrap-novu-whatsapp.sh`](../../backend/novu-bridge/config/bootstrap-novu-whatsapp.sh)
- PGR rendering and emission: [`backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java`](../../backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java)
- Bridge dispatch: [`backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java`](../../backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java)
- Provider API: [`backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java`](../../backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/ProviderController.java)
