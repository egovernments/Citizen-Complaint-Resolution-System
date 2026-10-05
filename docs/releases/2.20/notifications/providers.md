# Providers, and adding a provider

This page covers how novu-bridge reaches SMS, WhatsApp and email gateways, the DIGIT providers that some of those gateways need inside Novu's worker, and how to add a provider type. The code lives in `backend/novu-bridge/`. Operators add providers on Configurator → Notifications → **Providers** ([setup-guide.md §3](./setup-guide.md#3-add-a-provider)).

## How providers work

Every provider an operator adds is a **Novu integration**, and novu-bridge never stores credentials. `POST /novu-adapter/v1/providers` validates the credentials against the catalog, copies them into Novu's credential keys (`ProviderCatalog.toNovuCredentials`) and creates the integration. On dispatch, the bridge triggers the channel's Novu workflow (`complaints-sms`, `complaints-whatsapp` or `complaints-email`). Novu's **worker** then calls the gateway through the provider class named by the integration's `providerId`.

`service/provider/ProviderCatalog.types()` defines six types. Each type is a Novu provider (`transport: novu`), and the catalog fields are exactly the credential keys of that provider:

| Type | Channel | Novu provider | Fields → Novu credential keys | Where the provider class lives |
|---|---|---|---|---|
| `twilio-sms` | SMS | `twilio` | `accountSid`, `token`, `from` | upstream Novu |
| `twilio-whatsapp` | WHATSAPP | `twilio` | `accountSid`, `token`, `from` | upstream Novu |
| `smtp` | EMAIL | `nodemailer` | `host`, `port`, `user`, `password`, `from`, `senderName`, `secure` | upstream Novu |
| `smscountry` | SMS | `smscountry` | `user`, `password`, `from`, `baseUrl` (optional) | **DIGIT, mounted into the worker** |
| `ozeki` | SMS | `ozeki` | `baseUrl`, `user`, `password`, `from` (optional) | **DIGIT, mounted into the worker** |
| `jasmin` | SMS | `jasmin` | `baseUrl`, `user`, `password`, `from` (optional) | **DIGIT, mounted into the worker** |

The configurator renders the credential form from `GET /novu-adapter/v1/providers/catalog`, so a new type needs no UI change.

Integration identifiers take the form `<type>-<hash>`. `typeFromIdentifier` maps an identifier back to its type using `TYPES_LONGEST_FIRST`, and credential rotation reads the form from that type. A caller may choose its own identifier on the catalog form, but it must start with `<type>-`. Otherwise the call answers `400 NB_INVALID_PROVIDER`. An unmarked integration still derives its type from its Novu provider id when that id names exactly one type (`deriveType`).

## DIGIT's worker providers

Novu's `generic-sms` provider cannot drive SMSCountry, Ozeki or Jasmin. It always POSTs JSON and reads the message id from a JSON reply. The three gateways fail it in different ways:

- SMSCountry takes a form-encoded request and replies in plain text.
- Jasmin replies in plain text.
- Ozeki answers HTTP 200 for rejections, so `generic-sms` would record a failed send as sent.

Novu's own answer is one provider class per gateway (v2.3.0 ships 38 SMS provider classes), compiled into its worker. DIGIT adds its classes to the **stock** worker image at start-up instead of building a custom one. The code lives in **`backend/novu-bridge/novu-worker-providers/`**:

| File | What it is |
|---|---|
| `smscountry.js`, `jasmin.js`, `ozeki.js` | One gateway each: a provider class extending Novu's own `BaseProvider`, plus the handler that builds it from the integration's credentials |
| `register.js` | The preload. It wraps the worker's `SmsFactory.getHandler`, so an integration whose `providerId` is one of these gets DIGIT's handler and every other one goes to Novu's own lookup unchanged. It is also the redaction boundary: every error a send throws leaves it as a plain, redacted `Error` (see [Gateway notes](#gateway-notes)) |
| `novu.js` | Resolves Novu's internals (`BaseProvider`, `BaseSmsHandler`, `SmsFactory`, axios) from inside the image |
| `test/`, `run-tests.sh` | Tests, run inside the stock worker image they patch |

The worker is started with `NODE_OPTIONS=--require /opt/digit-novu-providers/register.js` and `DIGIT_NOVU_PROVIDERS=required`, and the directory mounted read-only at `/opt/digit-novu-providers`. This works because the Novu worker is not bundled: its packages resolve to plain files, so `register.js` patches the same `SmsFactory` the worker uses. Only the worker is touched:

- **API.** Stays stock. It accepts any `providerId` string and stores credentials under a fixed set of key names, encrypting the secret ones by name. These providers use existing keys (`user`, `password`, `from`, `baseUrl`).
- **ws.** Stays stock.
- **Dashboard.** Stays stock. It lists these integrations without a logo or credential form, which does not matter because providers are managed from the Configurator.

**Failure is loud by design.** The worker refuses to boot, with a `[digit-novu-providers]` error in its log, if a provider file does not load, or if the image is not the Novu version these internals were verified against (`SUPPORTED_WORKER_VERSIONS` in `register.js`, today `2.3.0`). On success it logs `[digit-novu-providers] SMS providers registered in the Novu worker: smscountry, jasmin, ozeki`.

`NODE_OPTIONS` reaches every node process in the container, so `register.js` decides per process. The image's entrypoint (`apps/worker/dist/main.js`) always registers. With `DIGIT_NOVU_PROVIDERS=required`, which the compose file and the Helm chart set on the worker, every other process registers too, except the image's dotenv helper (`dist/dotenvcreate.mjs`), which is left alone. A wrapper script, pm2 or a moved entrypoint therefore cannot start the worker without the providers; it registers, or crashes on the same checks. Without the variable, any other process is skipped with a `[digit-novu-providers] WARNING: NOT registering ...` line on stderr. A worker without the providers would otherwise fail quietly:

1. The Configurator saves an SMSCountry, Ozeki or Jasmin provider.
2. novu-bridge's trigger is accepted, and the dispatch row reads `SENT`.
3. The step then dies inside Novu with `Sms handler for provider smscountry is not found`.

`migrate-notifications.py` refuses to create such a provider while the running `novu-worker` container does not preload them. Twilio and SMTP do not depend on the preload.

A deployment that runs the worker **without** the preload (Helm `worker.digitProviders.enabled: false`, or a hand-rolled worker) must tell novu-bridge so with `NOVU_BRIDGE_DIGIT_WORKER_PROVIDERS=false` (default `true`, because the stock deployments mount them; the deploy sets it from the same switch as the mount). The bridge then:

- leaves `smscountry`, `ozeki` and `jasmin` out of `GET /providers/catalog`, so the Configurator does not offer them;
- refuses to create, rotate, re-enable or test one with `400 NB_PROVIDER_TYPE_UNAVAILABLE`, while renaming, disabling and deleting still work so that old ones can be cleaned up;
- records a channel that still selects one as `SKIPPED / NB_PROVIDER_UNAVAILABLE` instead of triggering it.

- records a channel with **no** provider selected the same way when Novu's default for it is one of them: the integration `NOVU_BRIDGE_INTEGRATION_ID_WHATSAPP` names (WhatsApp), else Novu's primary active integration on the channel, else, when none is flagged primary, every active one. With the flag off the bridge refuses to create such integrations, so this only catches one created before the flag was turned off, or in Novu directly. The check uses the same cached integration list as a selected provider's (one Novu call per `NOVU_BRIDGE_PROVIDER_AVAILABILITY_CACHE_TTL_MS`). When that list cannot be read the bridge delivers anyway, as it does for a selected provider: an unpinned channel carries login OTPs and every legacy row, and a blip on Novu's list endpoint should not stop them.

### How it is deployed

- **Compose.** `./deploy.sh` copies the directory (without its tests) to `/opt/digit/novu-worker-providers` before the stack starts, and `NOVU_WORKER_PROVIDERS_DIR` in `/opt/digit/.env` points the `novu-worker` volume at it. When the copied files change, the deploy restarts `novu-worker`, because the worker reads them only at boot. A compose run straight from `local-setup/` mounts the repo copy. Nothing to set in host_vars.
- **Helm.** The backbone `novu` chart carries a copy of the runtime files in `files/novu-worker-providers/`, because a chart cannot read outside itself. A ConfigMap serves them, the worker mounts it and gets the same `NODE_OPTIONS`, and a checksum annotation rolls the pods when the files change. `worker.digitProviders.enabled` (default `true`) turns it off, and novu-bridge must then run with `NOVU_BRIDGE_DIGIT_WORKER_PROVIDERS=false` (see above). `local-setup/tests/static/deployment-contracts.test.ts` fails if the copy drifts from `backend/novu-bridge/novu-worker-providers/`.

### Upgrading Novu

The providers depend on Novu internals: the file paths, the `SmsFactory.getHandler` lookup and the handler interface. Before bumping the worker image:

1. Run the tests against the new image: `NOVU_TEST_IMAGE=ghcr.io/novuhq/novu/worker:<version> backend/novu-bridge/novu-worker-providers/run-tests.sh`.
2. Fix anything they catch, then add the version to `SUPPORTED_WORKER_VERSIONS` in `register.js` and copy the runtime files to the chart.
3. Send one message through each provider against a mock gateway ([developer-guide.md](./developer-guide.md#local-testing-without-real-gateways)).

Bumping the image without step 2 leaves the worker refusing to boot, which is the point. `DIGIT_NOVU_PROVIDERS_ALLOW_UNTESTED=true` on the worker overrides the check for an emergency.

## Gateway notes

Each provider fails the Novu step whenever the gateway did not accept the message, whatever the HTTP status: every reply, 200 or not, goes through the provider's own parser, so Novu's activity feed shows the gateway's reason. That reason is redacted first: the integration's username and password are masked (as sent, and URL-, form- or HTML-encoded, and as the Basic-auth token), as is the value of any `password=`-style pair, before the text is cut to 200 characters. A gateway error page that echoes the request therefore never shows the panel credentials to someone with Novu dashboard access.

Errors that never reach a parser are redacted too. Novu stores whatever a send throws: `JSON.stringify(error)` as the message's error text, and `error.response.data` in the execution detail. A raw axios error from a transport failure (connection refused, reset, DNS, timeout) would serialise its request config, posted form and `Authorization` header included. So `register.js` wraps every DIGIT provider's `sendMessage` and turns **any** rejection into a plain `Error` that carries only a redacted message (at most 500 characters), with no `config`, `request`, `response`, `code` or `cause` for Novu to serialise. The message masks the username, password and every other credential value except `from`, `baseUrl`, `senderName`, `host` and `port`. A transport failure therefore reads, for example, `jasmin request failed: connect ECONNREFUSED 10.0.0.5:1401`. `test/error-boundary.test.js` sends through Novu's own `SendMessageSms` step against refused, reset and HTTP 500 echoing sockets, and checks that neither stored field contains a credential.

| Provider | Request | Accepted when… | Notes |
|---|---|---|---|
| SMSCountry | form-encoded `User`, `passwd`, `mobilenumber` (digits only), `message`, `sid`, `mtype=N`, `DR=Y` to the legacy bulk API (`http://api.smscountry.com/SMSCwebservice_bulk.aspx` unless **Gateway URL** is set) | the body starts `OK:`; the job id after it becomes Novu's message id | HTTP 200 is not success: a malformed request gets 200 and an ASP.NET error page. Accepted is not delivered: a message the operator drops (an unregistered DLT template) still gets `OK:`. The legacy bulk API only; a panel showing AuthKey/AuthToken is the REST API, which is not supported. |
| Ozeki | `POST` JSON `{"messages":[{message_id, to_address, text, from_address?}]}` to the **HTTP API URL**, HTTP Basic auth | `response_code` is `SUCCESS`, `failed_count` is 0 and the message's `status` is `SUCCESS` | Rejections, **including a wrong password**, come back as HTTP 200 with an error envelope. `message_id` is Novu's message id, echoed back. Ozeki has no delivery webhook, so accepted means submitted. |
| Jasmin | form-encoded `username`, `password`, `to`, `from`, `content` (or `hex-content`), `coding`, `dlr=no` to the **Send URL** (`:1401/send`) | the plain-text reply `Success "<msgid>"` | Failures carry a real status (400, 403, 412 or 500) and `Error "<message>"`. **Text outside the GSM 03.38 alphabet (Amharic, Arabic, emoji) is sent as UCS-2 (`coding=8`), with 70 characters per SMS segment instead of 160**, so the same complaint message can cost two or three times as many segments. The provider picks the coding per message. Jasmin converts `content` to GSM 03.38 only for coding 0 and forwards it byte for byte otherwise, so UCS-2 text goes as `hex-content`, its UTF-16BE bytes in hex. That needs the Jasmin user's `set_hex_content` authorization, which Jasmin grants unless an operator revoked it (then every UCS-2 message fails with 403). |

`from` is optional for Ozeki and Jasmin, in which case the gateway's or route's default sender is used. It is required for SMSCountry, which rejects an unregistered sender. A blank optional field is left out of the Novu credentials, so the provider's default applies.

### Providers created before these were native

Builds of this branch before the switch created SMSCountry and Ozeki providers as `generic-sms` integrations. Those SMSCountry integrations pointed at a novu-bridge adapter that no longer exists. Novu cannot change an integration's provider, so rotating one of them answers `400 NB_INVALID_PROVIDER`. To replace one:

1. Add a new provider of the same type.
2. Select it on **Channels**.
3. Delete the old one.

No 2.12 deployment has such an integration: 2.12 had no provider catalog.

### The legacy direct route

`novu.bridge.sms.provider=smscountry` (host_vars `novu_bridge_sms_provider`) makes the bridge post the SMS leg to SMSCountry itself through `SmsCountryDeliveryProvider` (a `service/delivery/DeliveryProvider`). This bypasses Novu and takes credentials from env (`novu_bridge_smscountry_user` / `_password` / `_url`). It remains for 2.12 deployments and needs neither Novu nor DIGIT's worker providers. It gets no Novu credential store, activity log or Configurator management. Its failures are `NB_SMSCOUNTRY_REJECTED` / `NB_SMSCOUNTRY_UNREACHABLE` on the dispatch row. Use it **or** an SMSCountry provider on a channel, not both.

### Provider selection at dispatch

On every dispatch, the bridge reads the tenant's `NOTIFICATIONS.Channel` row at the state tenant (60 s cache). The row's `provider` field is the Novu integration identifier. The bridge checks the selection against Novu's integration list (`NOVU_BRIDGE_PROVIDER_AVAILABILITY_CACHE_TTL_MS`, 60 s). A missing, disabled or wrong-channel provider is recorded as `SKIPPED / NB_PROVIDER_UNAVAILABLE` instead of triggering. If Novu cannot be reached for the check, the bridge delivers as it otherwise would. With no provider selected, the row's `gateway` and the env fallbacks apply.

The check cannot see whether the worker loads DIGIT's providers. It relies on `NOVU_BRIDGE_DIGIT_WORKER_PROVIDERS`: with the flag off, a selected SMSCountry, Ozeki or Jasmin provider is `SKIPPED / NB_PROVIDER_UNAVAILABLE`. See [DIGIT's worker providers](#digits-worker-providers).

### Removing a provider

Integrations are deployment-wide, so `POST /providers/_delete`, and `_update` with `active: false`, refuse with `409 NB_PROVIDER_IN_USE` while a tenant still sends through the provider:

- a channel row selects it, by identifier or Novu `_id`;
- it is the integration `NOVU_BRIDGE_INTEGRATION_ID_WHATSAPP` names (by identifier or Novu `_id`), and some enabled WhatsApp channel has no provider selected: every such trigger names it;
- it is the **last active** integration of its kind (SMS, WhatsApp or Email, from its catalog type), and some enabled channel of that kind has no provider selected. Such a channel sends through Novu's default integration. It can be a legacy `RAINMAKER-PGR.NotificationChannel` row, which has no `provider` field; a state with no rows that runs on `NOVU_BRIDGE_CHANNELS_ENABLED`; or any tenant while the channel policy is off. Novu stores Twilio WhatsApp on its `sms` channel, but a remaining WhatsApp integration does not keep an SMS one deletable, nor the reverse. An SMS channel on the [legacy direct route](#the-legacy-direct-route) does not count, because it never reaches Novu; neither does WhatsApp while `NOVU_BRIDGE_INTEGRATION_ID_WHATSAPP` is set, which the rule above covers.

The channel rows are read from MDMS at the time of the call, once per state for both checks. The states checked are: the request's `tenantId`, every state the caller is an admin of, every state the bridge has dispatched for since it started, and the states that own the providers. The check fails closed: a state whose rows cannot be read refuses, and an unreadable Novu integration list fails the call before anything changes.

### Who may manage providers

Creating, updating, deleting and test-sending a provider need a role from `NOVU_BRIDGE_PROXY_ADMIN_ROLES`. That role must be held at a state tenant that owns the deployment's providers:

- the state of `NOVU_BRIDGE_CORE_SMS_DEFAULT_TENANT`, which the deploy sets to its state root;
- any state listed in `NOVU_BRIDGE_PROVIDER_ADMIN_TENANTS` (comma-separated, default empty).

An admin of any other root on the same box, such as an onboarded workspace, gets `403 NB_TENANT_NOT_ALLOWED`. If neither setting names a state, every one of these calls is refused, and the bridge logs a warning at start-up. `migrate-notifications.py --create-provider` creates providers through `POST /providers`, so for that step log in at an owning state.

`/dispatch/_resolve` and `/dispatch/_dry-run` need the same role, held at a state tenant, but they act on one tenant's events: the admin of the event `tenantId`'s state root may run them, as may an owning state's admin for any tenant. `migrate-notifications.py plan` previews each root through `_resolve` while logged in at that root. `_dry-run` with `"send": true` is a real send of the caller's text through the shared providers, so like test-send it needs an owning state.

## Adding a provider

For a step-by-step walkthrough with a worked example (provider file, tests, catalog entry, migration mirror, chart copy and a local end-to-end test), see [adding-a-provider.md](./adding-a-provider.md). This section is the reference it follows.

Every new gateway follows one rule: **one provider class in Novu, plus one catalog entry here.** novu-bridge never carries gateway-specific code.

```
Does upstream Novu v2.3.0 ship a provider for this gateway?
├─ yes → catalog entry only (step 2)
└─ no  → a DIGIT provider in backend/novu-bridge/novu-worker-providers (step 1), then the catalog entry (step 2)
```

### 1. The provider, in `novu-worker-providers`

Copy the shape of `jasmin.js` (form-encoded, plain-text reply) or `ozeki.js` (JSON). Everything stays in `backend/novu-bridge/novu-worker-providers/`, with no image to build:

1. Add `<id>.js` exporting `PROVIDER_ID`, the provider class (extends `BaseProvider` from `./novu`, implements `sendMessage(options, bridgeProviderData)` and returns `{ id, date }`) and the handler (extends `BaseSmsHandler`, `buildProvider(credentials)` maps the integration's credentials onto the provider's config).
2. Add the handler to `loadHandlers()` in `register.js`.
3. Read credentials only from keys Novu's API already stores. They include `user`, `password`, `from`, `baseUrl`, `apiKey`, `secretKey`, `token`, `host` and `port`; the full list is the `credentials` object of Novu's integration schema, which drops any other key on save, so a new name would arrive empty.
4. Add `test/<id>.test.js` and run `./run-tests.sh`.
5. Copy the runtime file to `devops/deploy-as-code/charts/backbone-services/novu/files/novu-worker-providers/`. The static contract test fails until the chart copy matches.

The provider must decide success from **what the gateway says**, not the HTTP status (pass `validateStatus: () => true` so a non-2xx reply reaches the parser), and must throw when the gateway did not accept the message. Mask the credentials in any gateway text it quotes (`redactedSnippet` from `./novu`). `register.js` redacts every error again at the boundary and strips the axios objects, so a transport failure needs no handling in the provider. Cover every reply shape the gateway really produces (success, error string, HTML error page, empty body, rejection-as-200). Check that each test fails when its behaviour is removed.

### 2. The catalog entry, in novu-bridge

1. In `ProviderCatalog`:
   - Add a type constant and put it in `TYPES_LONGEST_FIRST`, so that no type is a prefix-match for a longer one.
   - Add a `NOVU_PROVIDER_*` constant holding the Novu provider id (Novu's own id for an upstream provider, which can differ from the type id), and a `TYPE_BY_NOVU_SMS_PROVIDER` entry mapping it to the type. Every SMS type needs both, upstream ones included, as Twilio has. Without the entry, an integration with no type marker in its identifier (one created in Novu's dashboard, say) derives no type, and its credentials cannot be rotated.
   - Add the type's channel to `CHANNEL_BY_TYPE`.
   - For a DIGIT provider only, also put the `NOVU_PROVIDER_*` constant in `WORKER_NOVU_PROVIDERS`, so `NOVU_BRIDGE_DIGIT_WORKER_PROVIDERS=false` hides and refuses it. An upstream provider works on every worker and stays out of it.
2. Add the entry to `allTypes()` (which `types()` filters). The field **keys must be the Novu provider's credential keys**, because `toNovuCredentials` copies exactly the declared keys:
   ```java
   types.add(ProviderType.builder()
           .type(ACME).label("ACME SMS").channel("SMS").transport("novu")
           .novuProviderId(NOVU_PROVIDER_ACME)             // DIGIT's (or Novu's) provider id
           .credentialFields(List.of(
                   CredentialField.text("baseUrl", "API URL", true, "https://acme.example/send", null),
                   CredentialField.text("user", "Username", true, null, null),
                   CredentialField.password("password", "Password", true, null),
                   CredentialField.text("from", "Sender id", false, null, null)))
           .supportsVerify(true).supportsTestSend(true)
           .build());
   ```
   Put what the operator must know about the gateway (costs, encodings, which API variant) in the fields' `help`. The Configurator shows it under the field.
   The Configurator shows its own translation instead of the catalog `label` for keys it has one for (`user`, `password`, `from`, `token`, `host`, `port`, `accountSid`, `secure`), so a `user` field reads **SMTP User** whatever the catalog says. See [the label note](./adding-a-provider.md#6-add-the-catalog-entry).
3. **`supportsVerify(true)`** turns on **Check status** (`POST /providers/verify`), which only checks that the integration exists and is active. **`supportsTestSend(true)`** turns on **Test** (`POST /providers/test-send`), the only real proof that the credentials work.
4. Mirror the type in `local-setup/scripts/migrate-notifications.py`:
   - `CATALOG_CHANNEL`, `CATALOG_LABEL`, `CATALOG_REQUIRED`, `TYPES_LONGEST_FIRST` and `TYPE_BY_NOVU_SMS_PROVIDER`
   - `MOUNTED_PROVIDER_TYPES`, for a DIGIT provider only
5. Update the tests that pin the catalog, or `mvn test`, `run-tests.sh` and jest fail. [adding-a-provider.md](./adding-a-provider.md) shows each change:
   - `ProviderCatalogTest` (the new provider id and keys, and the type list) and `ProviderControllerGuardsTest` (the catalog size, which types the worker-provider switch hides, and which it refuses). A DIGIT provider and an upstream one change these differently ([step 7](./adding-a-provider.md#7-update-the-java-tests)).
   - For a DIGIT provider: `test/register.test.js` (the registered ids) and the provider loop in `test/error-boundary.test.js` ([step 4](./adding-a-provider.md#4-add-it-to-the-error-boundary-test)).
   - For a DIGIT provider: the sorted `runtimeFiles` list in `local-setup/tests/static/deployment-contracts.test.ts` ([step 5](./adding-a-provider.md#5-copy-the-runtime-files-to-the-helm-chart)).
   - The Python mirror's tests in `local-setup/tests/test_notification_seed_decisions.py` ([step 8](./adding-a-provider.md#8-mirror-the-type-in-the-migration-script)).
   - No test pins them, so they are easy to miss: the `type` enums of `ProviderType` and `ProviderCreateFromCatalog` in both `openapi.yaml` copies ([step 9](./adding-a-provider.md#9-update-the-contract-and-docs)).

To verify:

- `GET /novu-adapter/v1/providers/catalog` lists the type.
- Creating one without a required field answers `400 NB_INVALID_PROVIDER`.
- The created identifier maps back to the type.
- **Test** delivers through a mock gateway that reproduces the real reply formats ([developer-guide.md](./developer-guide.md#local-testing-without-real-gateways)), then through the real gateway.

A `DeliveryProvider` that bypasses Novu is the answer only when the gateway cannot be driven by Novu's worker at all. It loses credential storage, the activity log and operator management.

### Delivery receipts for a new gateway

`service/receipts/ReceiptParser` looks for a correlation id and an outcome word anywhere in the payload ([contract/outputs.md](./contract/outputs.md#delivery-receipts)). A gateway therefore usually needs only two things: a Kong route for `/novu-bridge/novu-adapter/v1/receipts/<gateway>` (see `novu-bridge-receipts-route` and the auth-optional list in `kong.yml`) and the shared secret. Extend `ID_KEYS` / `REF_KEYS` / `STATUS_KEYS` or `mapStatus` only for names these rules miss.
