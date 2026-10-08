# Per-tenant notification accounts

Each workspace (root tenant) can have **its own Novu organization**: its own SMS, WhatsApp and
email provider credentials, managed by its own admins in the Configurator, and used for every
message of that workspace, including citizen sign-in codes. Tenants without one keep using the
deployment's shared Novu account exactly as before. Tracking issue: #2203.

| You are | Read |
|---|---|
| An operator turning it on, upgrading, or moving existing tenants | [Turning it on](#turning-it-on), [Existing tenants](#existing-tenants-backfill) |
| A workspace admin | [In the Configurator](#in-the-configurator) |
| Integrating the Identity BFF's OTP sender | [Sending a code](#sending-a-code-messages_send) |
| Reviewing the design | [Why organizations](#why-one-novu-organization-per-tenant), [Security](#security) |

## Why one Novu organization per tenant

Novu has two levels a tenant could map to:

- **Environments** (inside one organization). Self-hosted Novu 2.3.0 refuses to create them:
  `POST /v1/environments` carries `@ProductFeature(MANAGE_ENVIRONMENTS)` and answers
  `402 Payment Required` for the FREE service level every self-hosted organization has.
- **Organizations.** `POST /v1/organizations` works with a signed-in user, and Novu's
  `CreateOrganization` creates the organization's Development and Production environments, each
  with its own API key. Integrations (provider credentials), workflows and subscribers all live
  per environment, so two organizations share nothing.

An API key belongs to one environment and cannot create an organization, so novu-bridge signs in
as the **Novu platform admin** (the account the deploy mints the shared `NOVU_API_KEY` with) to
create and manage tenant organizations. It then works inside each one with that organization's
own API key, which it stores encrypted.

## What happens to a tenant

```text
signup saga ... BINDING -> NOTIFICATION_ACCOUNT ──> novu-bridge POST /tenants/{tenant}/_provision
                                                     ├─ Novu: organization "DIGIT tenant <tenant>"
                                                     ├─ read its Development API key
                                                     ├─ create the workflows the bridge triggers
                                                     └─ nb_tenant_account: PROVISIONED, key encrypted
```

- **Provision** is idempotent: calling it again for a provisioned tenant changes nothing and
  returns its state. A tenant never gets a second organization: a lease on the tenant's row stops
  two callers working at once, the organization id is written down the moment Novu creates it,
  and after a crash between those two steps the next attempt adopts the organization Novu already
  has under the tenant's name. Every workflow the bridge triggers is created in the new
  organization: `complaints-sms`, `complaints-whatsapp`, `complaints-email`, and the OTP workflows
  `digit-otp-sms` and `digit-otp-email`, whose text is only the code and its expiry.
- **Tenant creation** runs it as the last step of the signup saga (`NOTIFICATION_ACCOUNT` in
  pgr-services). It never fails a signup: if Novu or the bridge is down, the workspace is created
  without its own messaging, the step is recorded as `DEFERRED`, and pgr-services retries it every
  10 minutes (`PGR_ONBOARDING_NOTIFICATION_ACCOUNT_RECONCILE_INTERVAL_MS`) until it succeeds.
- **Routing.** Every message of a tenant whose ROOT has its own organization goes through it:
  complaint notifications, DIGIT login OTPs (`egov.core.notification.sms`), Configurator
  test-sends, `_dry-run` sends and `messages/_send`. Subscribers are created in that
  organization, and a channel's selected provider (`NOTIFICATIONS.Channel.provider`) is looked up
  among that organization's providers. Any other tenant runs the exact code path it ran before.
  If a tenant's account cannot be read (database down, wrong encryption key), its messages fail
  (`FAILED / NB_TENANT_ACCOUNT_UNAVAILABLE`, then the DLQ); they never fall back to the shared
  account.
- **Deprovision.** Self-hosted Novu 2.3.0 cannot delete an organization (its organization API has
  no delete). `POST /tenants/{tenant}/_deprovision` therefore deletes every integration of the
  organization (and with it every provider credential), regenerates the environment's API key
  without keeping the new one, erases the stored key and marks the row `DEPROVISIONED`. The old
  key stops working at once. The tenant falls back to the shared account; a later `_provision`
  reuses the same organization, which still has its workflows but no providers.

## In the Configurator

On a workspace with its own organization, **Notifications → Providers** and **Channels** act on
that organization. A banner says so. The workspace's admins (any of `SUPERUSER`, `MDMS_ADMIN`,
`ACCOUNT_ADMIN` held at the workspace's root tenant; a founder has all three) can add, rename,
rotate, enable or disable, test, delete and select providers. Nobody else can: an admin of
another workspace, or of the state that owns the shared providers, gets
`403 NB_TENANT_NOT_ALLOWED`. The workspace does not need to be listed in
`NOVU_BRIDGE_PROVIDER_ADMIN_TENANTS`.

A workspace without its own organization keeps today's screens: it reads the shared account's
providers, and only an admin of a state that owns them may change them. If per-tenant accounts
are on but the workspace has none yet, the banner says so.

The screens send `?tenantId=<workspace>` on every provider call; the bridge decides what it means
([providers.md](./providers.md#who-may-manage-providers)).

## Sending a code: `messages/_send`

`POST /novu-bridge/novu-adapter/v1/messages/_send`, on the internal network only (Kong answers
404), with header `X-Novu-Bridge-Token: <NOVU_BRIDGE_INTERNAL_SEND_TOKEN>`:

```json
{ "tenantId": "acme", "channel": "SMS", "recipient": "+254712345678", "templateKey": "OTP",
  "payload": { "code": "482913", "expiresInSeconds": 300 } }
```

`payload.expiresAt` (an ISO-8601 instant) may replace `expiresInSeconds`. `channel` is `SMS` or
`EMAIL`; `recipient` is E.164 for SMS, and anything else is `400 NB_INVALID_REQUEST`. Unlike a
complaint notification, whose stored national number the bridge completes with the tenant's
country code, a national number here is refused rather than completed: a sign-in code goes only to
the number the citizen typed, as the caller validated it against the tenant's mobile rule.
The message is sent through the tenant's own organization,
pinned to the provider its channel row selects, else its primary active provider for the
channel. The bridge then waits up to 5 s (`NOVU_BRIDGE_MESSAGES_CONFIRM_TIMEOUT_MS`) for Novu's
job to finish.

| Status | Code | Meaning | Identity BFF |
|---|---|---|---|
| 200 | `SENT` | The provider accepted the message | sent |
| 202 | `QUEUED` | Novu accepted it; the provider had not answered in time | sent |
| 409 | `NB_TENANT_NOT_PROVISIONED` | The tenant's root has no organization of its own (or the feature is off) | `OTP_CHANNEL_UNAVAILABLE` |
| 422 | `NB_NO_PROVIDER_FOR_CHANNEL` | It has one, but no usable provider carries the channel | `OTP_CHANNEL_UNAVAILABLE` |
| 502 | `NB_PROVIDER_FAILED` | The provider refused the message (Novu's short reason in the message, masked) | channel failed |
| 502 / 503 | `NB_NOVU_TRIGGER_FAILED` / `NB_NOVU_UNAVAILABLE`, `NB_TENANT_ACCOUNT_UNAVAILABLE` | Novu refused the trigger, could not be reached, or the account could not be read | channel failed |
| 400 | `NB_INVALID_REQUEST`, `NB_UNKNOWN_TEMPLATE`, `NB_INVALID_TENANT` | Malformed request | bug |

Success body: `{"data": {"status", "transactionId", "tenantId", "channel", "provider", "account"}}`;
`transactionId` is Novu's. The code is never logged, never stored and never echoed in an error.
Each send writes one ledger row (module `identity`, event `OTP_SEND`, recipient as a hashed
subscriber id `otp_<uuid>`, stable per tenant and number; transaction id `otp_<uuid>`) that the
Logs screen shows with both ids as they are: they are UUID-shaped, which the Logs masking treats
as ids. Rate limits and lockout are the caller's.
`GET /tenants/{tenant}` with the same token says whether a tenant is provisioned and which
channels have a usable provider (the capability lookup for hiding `phone_otp`).

**Wiring the BFF** (separate change, owned by the Identity BFF): a `novu` `OtpSender` that posts
the body above with the BFF's message (`tenantId`, `phoneNumber` → `recipient`, `code`,
`expiresInSeconds`), maps 409 and 422 to `OTP_CHANNEL_UNAVAILABLE` and anything else non-2xx to a
failed channel, and reads the bridge URL and token from two new settings, for example
`IDENTITY_OTP_NOVU_BRIDGE_URL=http://novu-bridge:8080/novu-bridge` and
`IDENTITY_OTP_NOVU_BRIDGE_TOKEN=${NOVU_BRIDGE_INTERNAL_SEND_TOKEN}`. The full contract is in
[contract/openapi.yaml](./contract/openapi.yaml).

## The tenant admin API

Internal only (Kong answers 404), header `X-Novu-Bridge-Token: <NOVU_BRIDGE_INTERNAL_ADMIN_TOKEN>`,
base `/novu-bridge/novu-adapter/v1`:

| Call | Does |
|---|---|
| `POST /tenants/{tenant}/_provision` | Provision (idempotent); `organizationCreated` says whether this call created it |
| `GET /tenants/{tenant}` | State, and per channel whether a usable provider carries it (also with the send token) |
| `GET /tenants/{tenant}/providers` | The tenant's providers, never their credentials |
| `POST /tenants/{tenant}/providers` | Add one: the catalog form `{type, name, credentials, active?}` ([providers.md](./providers.md#how-providers-work)) |
| `POST /tenants/{tenant}/providers/_update` | `{id, name?, credentials?, active?}`; credentials are replaced whole |
| `POST /tenants/{tenant}/providers/_delete` | `{id}`; refused while the tenant's channels send through it |
| `POST /tenants/{tenant}/_deprovision` | See above |
| `GET /tenants` | Every tenant account and its state |
| `POST /tenants/_backfill` | `{tenantIds: [...]}` (at most 500): provision each, report each |

Different tenants can hold different credentials for the same provider type: each provider lives
in its tenant's own organization. A `{tenant}` with a dot (`acme.city`) means its root (`acme`).

## Turning it on

**Compose (Ansible).** On by default wherever self-serve signup and Novu both run
(`enable_novu` and `enable_keycloak`); `novu_tenant_accounts: true|false` in host_vars overrides.
The deploy then:

1. generates four secrets into OpenBao the first time (never into host_vars or the repository):
   `novu_bridge_tenant_key_encryption_key`, `novu_bridge_internal_admin_token`,
   `novu_bridge_internal_send_token` and `novu_admin_password`;
2. refuses to continue if `novu_admin_password` in host_vars is the published default
   `Digit@12345` (the bridge signs in as that user, and `/novu-api/` is public);
3. on a box whose Novu admin still has its old password (`novu_admin_password_legacy`, default
   `Digit@12345`), changes it to the OpenBao one through Novu's `/v1/auth/update-password`
   before anything signs in. The Novu dashboard login changes with it: read it with
   `bao kv get -field=novu_admin_password <secrets_path>`;
4. writes the secrets into their own `.env` block (removed again when switched off), passes them
   to novu-bridge, and gives pgr-services the admin token for the `NOTIFICATION_ACCOUNT` step.

Registration stays disabled (`DISABLE_USER_REGISTRATION=true`): creating an organization is not a
registration.

**Helm.** Create the Secret, then set `tenant-accounts.enabled: true` for novu-bridge and
`onboarding.notificationAccountUrl` for pgr-services:

```bash
kubectl -n egov create secret generic novu-bridge-tenant-accounts \
  --from-literal=novu-admin-email=<the Novu admin> --from-literal=novu-admin-password=<its password> \
  --from-literal=encryption-key="$(openssl rand -hex 32)" \
  --from-literal=internal-admin-token="$(openssl rand -hex 24)" \
  --from-literal=internal-send-token="$(openssl rand -hex 24)"
```

The bridge refuses to start with the feature on and no encryption key of at least 32 characters
or no Novu admin login. A blank internal token switches its API off (`403 NB_INTERNAL_API_DISABLED`).

**Encryption key rotation.** Put the old value in `NOVU_BRIDGE_TENANT_KEY_ENCRYPTION_KEY_PREVIOUS`
(Helm key `encryption-key-previous`) and the new one in place, then re-provision each tenant
(`_backfill` with every tenant) so its key is stored again under the new one; the state view's
`apiKeyEncryptionKeyId` says which key wrote it. Then drop the previous key.

## Existing tenants (backfill)

Turning the feature on changes nothing for tenants that already exist: they keep the shared
account. Moving one to its own organization changes which credentials its messages use, and the
new organization starts with no providers, so it is an explicit operator step:

- **Ansible:** list them in `novu_tenant_accounts_backfill: ["acme", "globex"]` and re-run the
  deploy (idempotent, non-fatal; the result is printed);
- **By hand,** on the box:

  ```bash
  docker exec -e T="$(sudo grep -h '^NOVU_BRIDGE_INTERNAL_ADMIN_TOKEN=' /opt/digit/.env | cut -d= -f2-)" novu-bridge \
    sh -c 'wget -qO- --header="Content-Type: application/json" --header="X-Novu-Bridge-Token: $T" \
      --post-data="{\"tenantIds\":[\"acme\",\"globex\"]}" \
      http://127.0.0.1:8080/novu-bridge/novu-adapter/v1/tenants/_backfill'
  ```

Then add each tenant's providers (its admins in the Configurator, or the admin API) before its
next message: until then its channels have no provider (`SKIPPED / NB_PROVIDER_UNAVAILABLE` where
a channel pins one).

## What else changes

| Area | Effect |
|---|---|
| Delivery receipts | `/receipts/*` matches rows by transaction id or provider reference, which are unique across organizations, so a receipt is filed under the right tenant whichever account sent it. Reports are configured per sender: a gateway's DR callback or a Novu webhook set up for the shared account does not cover a tenant's own providers. The platform operator configures them (the receipts secret is a deployment secret); until then that tenant's rows stay `SENT` |
| Logs screen | Unchanged: the ledger is the bridge's own. A row sent through a tenant's organization records `novuAccount: tenant:<root>` in its provider response; OTP sends appear as `OTP_SEND` |
| Test-send | Goes through the workspace's own organization and its own `complaints-sms` / `complaints-email` workflows; its ledger row is scoped to the workspace. It is checked first against that organization's providers only, as its dispatch is: nothing there to deliver it (the named provider missing, disabled or on another channel, or none named and no active provider for the channel) is `409 NB_PROVIDER_UNAVAILABLE` with the reason, and nothing is sent |
| WhatsApp template sync | Reads the Twilio account of the workspace's own organization |
| `seed-notifications.py` | Unchanged: it seeds MDMS masters, which are per tenant anyway. A seeded channel row that pins no provider sends through the organization's primary provider |
| `migrate-notifications.py` | Unchanged: it migrates 2.12 tenants, which stay on the shared account; `--create-provider` creates providers there. To give a migrated tenant its own organization, backfill it, then add its providers there |
| Novu worker providers | SMSCountry, Ozeki and Jasmin are loaded once by the shared Novu worker and work for every organization |
| Novu dashboard | The platform admin sees every tenant organization in the organization switcher |

## Security

- **Credentials** go straight to the tenant's Novu organization; the bridge never stores or logs
  them, and no endpoint returns them (the integration projection is an allowlist).
- **Tenant API keys** are stored AES-256-GCM encrypted, with the tenant id as authenticated
  data: a value copied onto another tenant's row does not decrypt. The state view shows only
  which encryption key wrote it.
- **The internal APIs** take only `X-Novu-Bridge-Token` (a separate admin and send token,
  compared in constant time), never a DIGIT session, and Kong terminates both prefixes with 404.
  The send token can read a tenant's status and send; it cannot provision or touch credentials.
- **The Configurator path** acts on a workspace's organization only for an admin of that
  workspace, decided in the bridge from the egov-user session, never from the browser.
- **Fail closed:** an unreadable account fails the message rather than using the shared account.
- **The platform admin** is the one credential that reaches every tenant organization. It lives
  in OpenBao (or the Helm Secret) and the bridge's environment.

## Verified

Against stock Novu 2.3.0 (api and worker, DIGIT's worker providers mounted) with registration
disabled, mock Jasmin gateways and the bridge built from this change: two tenants provisioned into
two organizations (a re-provision created nothing), each given a Jasmin provider pointing at a
different gateway and a fake Twilio account with a different SID; OTPs, complaint thin events and
DIGIT login OTPs for each tenant reached only that tenant's gateway, a tenant without an
organization stayed on the shared one, the three `_send` errors came back distinct, deprovision
revoked the key, and Kong answered 404 for both internal prefixes even for an authenticated
admin session.
