# Per-tenant notification accounts

Each workspace (root tenant) can have **its own Novu organization**: its own SMS, WhatsApp and
email provider credentials, managed by its own admins in the Configurator, and used for every
message the notification module sends for that workspace. Tenants without one keep using the
deployment's shared Novu account exactly as before. Tracking issue: #2203.

**Citizen sign-in codes are not among those messages yet.** In 2.20 citizens sign in through the
Identity BFF, which sends its codes with its own sender (`http` to a gateway the deployment runs,
or `log` for development), not through notifications. The bridge's
[`messages/_send`](#sending-a-code-messages_send) is ready for it, for a workspace with its own
organization only and with fixed text; connecting the BFF is a follow-up. Codes from DIGIT's
older OTP service (`user-otp`), where a deployment still uses it, do go through notifications,
and through the workspace's organization when it has one.

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
  The workspace's notification configuration (templates, routing, access rows) comes from the
  earlier step `NOTIFICATION_DEFAULTS` ([setup-guide §8.6](./setup-guide.md#86-new-workspaces));
  the new organization starts with no providers, so its messages are
  `SKIPPED / NB_PROVIDER_UNAVAILABLE` until its admin adds one.
- **Routing.** Every message of a tenant whose ROOT has its own organization goes through it:
  complaint notifications, codes from DIGIT's older OTP service where a deployment still uses it
  (`egov.core.notification.sms`), Configurator test-sends, `_dry-run` sends and
  `messages/_send`. Subscribers are created in that
  organization, and a channel's selected provider (`NOTIFICATIONS.Channel.provider`) is looked up
  among that organization's providers. Any other tenant runs the exact code path it ran before.
  If a tenant's account cannot be read (database down, wrong encryption key), its messages fail
  (`FAILED / NB_TENANT_ACCOUNT_UNAVAILABLE`, then the DLQ); they never fall back to the shared
  account.
- **Deprovision.** Self-hosted Novu 2.3.0 cannot delete an organization (its organization API has
  no delete). `POST /tenants/{tenant}/_deprovision` therefore, in this order: marks the row
  `DEPROVISIONING` and erases the stored key, so the tenant is back on the shared account before
  Novu is touched; regenerates the environment's API key without keeping the new one (the old key
  stops working at once, also for a replica that still caches it); deletes every integration of
  the organization (and with it every provider credential); marks the row `DEPROVISIONED`. If a
  Novu call fails part-way, the call answers the error and the row stays `DEPROVISIONING` with
  `lastErrorCode`: still on the shared account, never `PROVISIONED` with its credentials half gone.
  Calling `_deprovision` again resumes it. A later `_provision` reuses the same organization,
  which still has its workflows but no providers.

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

Nothing calls this yet: 2.20's citizen sign-in (the Identity BFF) has only its `http` and `log`
senders, and connecting it is the follow-up described under **Wiring the BFF** below. Two limits
hold until then and after: it sends only for a tenant whose root has its own organization (any
other answers `409 NB_TENANT_NOT_PROVISIONED`), and the text is fixed: the `digit-otp-sms` /
`digit-otp-email` workflows carry the code and its expiry, and the OTP wording on Configure
(which belongs to DIGIT's older OTP service) does not apply.

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
2. never hands the bridge a `novu_admin_password` from host_vars that is the published default
   `Digit@12345` (the bridge signs in as that user, and `/novu-api/` is public): it counts as a
   refused sign-in, see [When the admin sign-in is refused](#when-the-admin-sign-in-is-refused);
3. on a box whose Novu admin still has its old password (`novu_admin_password_legacy`, default
   `Digit@12345`), changes it to the OpenBao one through Novu's `/v1/auth/update-password`
   before anything signs in. The Novu dashboard login changes with it: read it with
   `bao kv get -field=novu_admin_password <secrets_path>`;
4. writes the secrets into their own `.env` block (removed again when switched off), passes them
   to novu-bridge, and gives pgr-services the admin token for the `NOTIFICATION_ACCOUNT` step;
5. **verifies** that it can sign in to Novu as that admin with the password it gives the bridge:
   before the stack starts when Novu is already running (an upgrade; the legacy password working
   is enough there, since step 3 follows), and again after step 3 and the API-key mint. See
   [When the admin sign-in is refused](#when-the-admin-sign-in-is-refused).

### When the admin sign-in is refused

The usual cause is a Novu admin whose password was changed by hand (in the Novu dashboard), so it
is neither the generated one nor `novu_admin_password_legacy`, and step 3 could not move it. A
bridge holding a password Novu refuses could never provision a workspace, so the deploy does not
hand it over. A host_vars `novu_admin_password` that is the published default is treated the same
way without being tried, with its own ACTION text (remove it, or set a unique value):

| The box | The deploy |
|---|---|
| `novu_tenant_accounts` not set (on by default) and no workspace provisioned yet | Switches per-tenant accounts **off for this deploy** (`NOVU_BRIDGE_TENANT_ACCOUNTS_ENABLED=false`, the secrets block leaves `.env`; when this is found only after the stack started, novu-bridge and pgr-services are recreated) and continues. Every tenant uses the shared account as before, and tenant creation skips the notification-account step. It prints `novu tenant accounts — ACTION: per-tenant notification accounts are OFF on this box for this deploy` with what to pin. The next deploy checks again |
| `novu_tenant_accounts: true` in host_vars | Stops, with the same text: the operator asked for the feature |
| Workspaces already have their own organization (`PROVISIONED` rows), or they cannot be counted | Stops, with the same text: switching off would move their messages onto the shared account |

What to pin, in `host_vars/<box>.yml`: the admin's current password as
`novu_admin_password_legacy` (the deploy then moves the admin onto a generated password kept in
OpenBao), or as `novu_admin_password` (kept as it is; never the published default), plus
`novu_admin_email` if the admin is another account. Or set `novu_tenant_accounts: false` to run
the box on the shared account only and silence the check. When a deploy stops here, the stack it
started is still running with the refused password: workspace provisioning fails
(`NB_NOVU_PLATFORM_LOGIN_FAILED`), and workspaces that already have an organization keep sending
through it (they use their stored keys, not the admin sign-in). Pin and re-run.

**With per-tenant accounts off** (`novu_tenant_accounts: false`, or switched off as above), the
deploy still signs in as the Novu admin once, to mint `NOVU_API_KEY` when host_vars pins no
`novu_api_key`. It uses `novu_admin_password` from host_vars when set; otherwise the first Novu
accepts of: the password OpenBao holds (an earlier deploy with the feature on moved the admin onto
it), `novu_admin_password_legacy`, the published default. So turning the feature off after it ran
keeps the shared account's key, and so does a deploy that stored a generated password but stopped
before moving the admin onto it.

Registration stays disabled (`DISABLE_USER_REGISTRATION=true`): creating an organization is not a
registration.

**Helm.** Off by default (the chart's `tenant-accounts.enabled: false`): opt in. Create the
Secret, then set `tenant-accounts.enabled: true` for novu-bridge and
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
Nothing on Helm verifies the admin password as the Compose deploy does: put the admin's current
password in the Secret, and check with one `_provision` (a wrong one answers
`502 NB_NOVU_PLATFORM_LOGIN_FAILED`).

**Encryption key rotation.** Put the old value in `NOVU_BRIDGE_TENANT_KEY_ENCRYPTION_KEY_PREVIOUS`
(Helm key `encryption-key-previous`) and the new one in place, then re-provision each tenant
(`_backfill` with every tenant) so its key is stored again under the new one; the state view's
`apiKeyEncryptionKeyId` says which key wrote it. Then drop the previous key.

A provision stores the key again whenever the stored one does not open under the CURRENT key,
whatever wrote it. So a tenant whose sends fail `NB_TENANT_ACCOUNT_UNAVAILABLE` because its key was
written by a key this bridge no longer has (rotated twice, a wrong or missing `_PREVIOUS`, the key
changed without one) is repaired by `_provision` (or `_backfill`) for that tenant: the bridge
reads the organization's key from Novu again with the admin sign-in.

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
next message: until then every message on its enabled channels is recorded
`SKIPPED / NB_PROVIDER_UNAVAILABLE` (a channel that selects a provider of the shared account finds
it missing; one that selects none finds no active provider in the new organization), never a
false `SENT`, and a **Test** is refused with the same reason.

## What else changes

| Area | Effect |
|---|---|
| Delivery receipts | `/receipts/*` matches rows by transaction id or provider reference, which are unique across organizations, so a receipt is filed under the right tenant whichever account sent it. Reports are configured per sender: a gateway's DR callback or a Novu webhook set up for the shared account does not cover a tenant's own providers. The platform operator configures them (the receipts secret is a deployment secret); until then that tenant's rows stay `SENT` |
| Logs screen | Unchanged: the ledger is the bridge's own. A row sent through a tenant's organization records `novuAccount: tenant:<root>` in its provider response; OTP sends appear as `OTP_SEND` |
| Test-send | Goes through the workspace's own organization and its own `complaints-sms` / `complaints-email` workflows; its ledger row is scoped to the workspace. It is checked first against that organization's providers only, as its dispatch is: nothing there to deliver it (the named provider missing, disabled or on another channel, or none named and no active provider for the channel) is `409 NB_PROVIDER_UNAVAILABLE` with the reason, and nothing is sent |
| WhatsApp template sync | Reads the Twilio account of the workspace's own organization |
| `seed-notifications.py` | Unchanged: it seeds MDMS masters, which are per tenant anyway. A seeded channel row that pins no provider sends through the organization's primary provider, and is `SKIPPED / NB_PROVIDER_UNAVAILABLE` while the organization has no active provider for the channel |
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
  Whether a request is one of them is decided on the path as Spring MVC maps it (path parameters
  dropped, decoded, dot segments applied, any case, no trailing slash), so `/v1;x/tenants` or
  `/v1/%74enants` needs the token too; a path with `;`, an encoded `/`, `\`, `.` or `%`, `//` or a
  dot segment is refused with `400 NB_REQUEST_REJECTED` before anything else.
- **The Configurator path** acts on a workspace's organization only for an admin of that
  workspace, decided in the bridge from the egov-user session, never from the browser.
- **Fail closed:** an unreadable account fails the message rather than using the shared account.
- **The platform admin** is the one credential that reaches every tenant organization. It lives
  in OpenBao (or the Helm Secret) and the bridge's environment.

## Verified

Against stock Novu 2.3.0 (api and worker, DIGIT's worker providers mounted) with registration
disabled, mock Jasmin gateways and the bridge built from this change: two tenants provisioned into
two organizations (a re-provision created nothing), each given a Jasmin provider pointing at a
different gateway and a fake Twilio account with a different SID; `_send` codes, complaint thin
events and codes from DIGIT's older OTP service for each tenant reached only that tenant's gateway, a tenant without an
organization stayed on the shared one, the three `_send` errors came back distinct, deprovision
revoked the key, and Kong answered 404 for both internal prefixes even for an authenticated
admin session.
