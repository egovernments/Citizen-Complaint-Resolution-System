# Providers, and adding a provider

This page covers how novu-bridge reaches SMS, WhatsApp and email gateways, the DIGIT build of the Novu worker that some of those gateways need, and how to add a provider type. The code lives in `backend/novu-bridge/`. Operators add providers on Configurator → Notifications → **Providers** ([setup-guide.md §3](./setup-guide.md#3-add-a-provider)).

## How providers work

Every provider an operator adds is a **Novu integration**, and novu-bridge never stores credentials. `POST /novu-adapter/v1/providers` validates the credentials against the catalog, copies them into Novu's credential keys (`ProviderCatalog.toNovuCredentials`) and creates the integration. On dispatch, the bridge triggers the channel's Novu workflow (`complaints-sms`, `complaints-whatsapp` or `complaints-email`). Novu's **worker** then calls the gateway through the provider class named by the integration's `providerId`.

`service/provider/ProviderCatalog.types()` defines six types. Each type is a Novu provider (`transport: novu`), and the catalog fields are exactly the credential keys of that provider:

| Type | Channel | Novu provider | Fields → Novu credential keys | Where the provider class lives |
|---|---|---|---|---|
| `twilio-sms` | SMS | `twilio` | `accountSid`, `token`, `from` | upstream Novu |
| `twilio-whatsapp` | WHATSAPP | `twilio` | `accountSid`, `token`, `from` | upstream Novu |
| `smtp` | EMAIL | `nodemailer` | `host`, `port`, `user`, `password`, `from`, `senderName`, `secure` | upstream Novu |
| `smscountry` | SMS | `smscountry` | `user`, `password`, `from`, `baseUrl` (optional) | **DIGIT Novu worker** |
| `ozeki` | SMS | `ozeki` | `baseUrl`, `user`, `password`, `from` (optional) | **DIGIT Novu worker** |
| `jasmin` | SMS | `jasmin` | `baseUrl`, `user`, `password`, `from` (optional) | **DIGIT Novu worker** |

The configurator renders the credential form from `GET /novu-adapter/v1/providers/catalog`, so a new type needs no UI change.

Integration identifiers take the form `<type>-<hash>`. `typeFromIdentifier` maps an identifier back to its type using `TYPES_LONGEST_FIRST`, and credential rotation reads the form from that type. A caller may choose its own identifier on the catalog form, but it must start with `<type>-`. Otherwise the call answers `400 NB_INVALID_PROVIDER`. An unmarked integration still derives its type from its Novu provider id when that id names exactly one type (`deriveType`).

## The DIGIT Novu worker

Novu's `generic-sms` provider cannot drive SMSCountry, Ozeki or Jasmin. It always POSTs JSON and reads the message id from a JSON reply. The three gateways fail it in different ways:

- SMSCountry takes a form-encoded request and replies in plain text.
- Jasmin replies in plain text.
- Ozeki answers HTTP 200 for rejections, so `generic-sms` would record a failed send as sent.

Novu's own answer is one provider class per gateway: v2.3.0 ships 38 SMS provider classes.

So DIGIT keeps a fork: **[dhruv-1001/novu](https://github.com/dhruv-1001/novu), branch `digit/v2.3.0`**. The fork is upstream v2.3.0 plus added SMS provider classes, and nothing else. The changes are new files plus registry entries, with no edits to upstream code. The decision is recorded in [#2084](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2084#issuecomment-5808124117). The first three providers came in [dhruv-1001/novu#1](https://github.com/dhruv-1001/novu/pull/1).

Only the **worker** needs the fork:

- **Worker.** The worker sends the message. Its `SmsFactory` maps a `providerId` to a handler, and upstream has no handler for `smscountry`, `ozeki` or `jasmin`.
- **API.** The API accepts any `providerId` string. It encrypts credentials by key name, not per provider, so it stays upstream.
- **ws.** Stays upstream.
- **Dashboard.** Stays upstream. It lists these integrations without a logo or credential form, which does not matter because providers are managed from the Configurator.

**On the upstream worker, nothing fails loudly:**

1. The Configurator saves an SMSCountry, Ozeki or Jasmin provider.
2. novu-bridge's trigger is accepted, and the dispatch row reads `SENT`.
3. The step then dies inside Novu with `Sms handler for provider smscountry is not found`.

`./deploy.sh` warns while `enable_novu` is on and the worker is the upstream image. `migrate-notifications.py` refuses to create such a provider on the upstream worker. Twilio and SMTP work on either worker.

### Build it

The image is a **local build for now**, not in a registry. Build it on the box that runs it. The following reproduces upstream's own self-hosted release build (`.github/workflows/prepare-self-hosted-release.yml`) for the worker:

```bash
git clone --filter=blob:none -b digit/v2.3.0 https://github.com/dhruv-1001/novu.git novu-fork
cd novu-fork
# node 20 and pnpm 10.11.0 (e.g. `corepack enable`); pnpm-context needs the root deps
pnpm install --filter novuhq --frozen-lockfile
cp scripts/dotenvcreate.mjs apps/worker/src/dotenvcreate.mjs
printf '\nIS_SELF_HOSTED=true\nOS_TELEMETRY_URL=""\n' >> apps/worker/src/.example.env
sed -i 's/pm2-runtime start dist\/main\.js -i max/node dist\/main.js/g' apps/worker/Dockerfile
sed -i 's/^ENV NX_DAEMON=false$/ENV NX_DAEMON=false\nENV NX_NO_CLOUD=true/' apps/worker/Dockerfile
: > /tmp/empty-secret                      # community edition: no BullMQ Pro token
pnpm --silent --workspace-root pnpm-context -- apps/worker/Dockerfile \
  | docker buildx build --secret id=BULL_MQ_PRO_NPM_TOKEN,src=/tmp/empty-secret \
      --build-arg PACKAGE_PATH=apps/worker - -t novu-worker:2.3.0-digit.1 --load
git checkout -- apps/worker && rm apps/worker/src/dotenvcreate.mjs
```

Some steps are easy to get wrong:

- Without the `dotenvcreate.mjs` copy, the build fails at `cp src/dotenvcreate.mjs`.
- The `sed` on the entrypoint gives the same single-process `node dist/main.js` as the upstream image.
- The tag is `2.3.0-digit.<n>`: the Novu version, then our build number. Bump `<n>` whenever the fork gains a provider.

### Run it

- **Compose.** Set `novu_worker_image: "novu-worker:2.3.0-digit.1"` in host_vars and run `./deploy.sh`. This renders `NOVU_WORKER_IMAGE` into `/opt/digit/.env`, which the `novu-worker` service reads. When it is unset, the default is `ghcr.io/novuhq/novu/worker:2.3.0`. The deploy's `compose pull` ignores pull failures, so a local-only tag is fine.
- **Helm.** In the backbone `novu` chart, override `worker.image.repository` and `worker.image.tag`. A cluster has to pull the image from somewhere, so push it to a registry its nodes can reach first. None is published yet.

## Gateway notes

Each provider fails the Novu step whenever the gateway did not accept the message. The step still fails when the gateway answered HTTP 200, so Novu's activity feed shows the gateway's reason.

| Provider | Request | Accepted when… | Notes |
|---|---|---|---|
| SMSCountry | form-encoded `User`, `passwd`, `mobilenumber` (digits only), `message`, `sid`, `mtype=N`, `DR=Y` to the legacy bulk API (`http://api.smscountry.com/SMSCwebservice_bulk.aspx` unless **Gateway URL** is set) | the body starts `OK:`; the job id after it becomes Novu's message id | HTTP 200 is not success: a malformed request gets 200 and an ASP.NET error page. Accepted is not delivered: a message the operator drops (an unregistered DLT template) still gets `OK:`. The legacy bulk API only; a panel showing AuthKey/AuthToken is the REST API, which is not supported. |
| Ozeki | `POST` JSON `{"messages":[{message_id, to_address, text, from_address?}]}` to the **HTTP API URL**, HTTP Basic auth | `response_code` is `SUCCESS`, `failed_count` is 0 and the message's `status` is `SUCCESS` | Rejections, **including a wrong password**, come back as HTTP 200 with an error envelope. `message_id` is Novu's message id, echoed back. Ozeki has no delivery webhook, so accepted means submitted. |
| Jasmin | form-encoded `username`, `password`, `to`, `from`, `content`, `coding`, `dlr=no` to the **Send URL** (`:1401/send`) | the plain-text reply `Success "<msgid>"` | Failures carry a real status (400, 403, 412 or 500) and `Error "<message>"`. **Text outside the GSM 03.38 alphabet (Amharic, Arabic, emoji) is sent as UCS-2 (`coding=8`), with 70 characters per SMS segment instead of 160**, so the same complaint message can cost two or three times as many segments. The provider picks the coding per message. |

`from` is optional for Ozeki and Jasmin, in which case the gateway's or route's default sender is used. It is required for SMSCountry, which rejects an unregistered sender. A blank optional field is left out of the Novu credentials, so the provider's default applies.

### Providers created before these were native

Builds of this branch before the switch created SMSCountry and Ozeki providers as `generic-sms` integrations. Those SMSCountry integrations pointed at a novu-bridge adapter that no longer exists. Novu cannot change an integration's provider, so rotating one of them answers `400 NB_INVALID_PROVIDER`. To replace one:

1. Add a new provider of the same type.
2. Select it on **Channels**.
3. Delete the old one.

No 2.12 deployment has such an integration: 2.12 had no provider catalog.

### The legacy direct route

`novu.bridge.sms.provider=smscountry` (host_vars `novu_bridge_sms_provider`) makes the bridge post the SMS leg to SMSCountry itself through `SmsCountryDeliveryProvider` (a `service/delivery/DeliveryProvider`). This bypasses Novu and takes credentials from env (`novu_bridge_smscountry_user` / `_password` / `_url`). It remains for 2.12 deployments and needs neither Novu nor the DIGIT worker. It gets no Novu credential store, activity log or Configurator management. Its failures are `NB_SMSCOUNTRY_REJECTED` / `NB_SMSCOUNTRY_UNREACHABLE` on the dispatch row. Use it **or** an SMSCountry provider on a channel, not both.

### Provider selection at dispatch

On every dispatch, the bridge reads the tenant's `NOTIFICATIONS.Channel` row at the state tenant (60 s cache). The row's `provider` field is the Novu integration identifier. The bridge checks the selection against Novu's integration list (`NOVU_BRIDGE_PROVIDER_AVAILABILITY_CACHE_TTL_MS`, 60 s). A missing, disabled or wrong-channel provider is recorded as `SKIPPED / NB_PROVIDER_UNAVAILABLE` instead of triggering. If Novu cannot be reached for the check, the bridge delivers as it otherwise would. With no provider selected, the row's `gateway` and the env fallbacks apply.

The check cannot see which worker image runs, so a fork-only provider on the upstream worker passes it. See [The DIGIT Novu worker](#the-digit-novu-worker).

## Adding a provider

Every new gateway follows one rule: **one provider class in Novu, plus one catalog entry here.** novu-bridge never carries gateway-specific code.

```
Does upstream Novu v2.3.0 ship a provider for this gateway?
├─ yes → catalog entry only (step 2)
└─ no  → a provider class in the DIGIT fork (step 1), then the catalog entry (step 2)
```

### 1. The provider class, in the fork

Work on a branch of [dhruv-1001/novu](https://github.com/dhruv-1001/novu) cut from `digit/v2.3.0`, and open the PR **inside the fork** against `digit/v2.3.0`. Copy the shape of `smscountry` or `jasmin` from [#1](https://github.com/dhruv-1001/novu/pull/1). The change must stay additive: new files, plus one entry in each registry.

| Package | Add |
|---|---|
| `packages/providers/src/lib/sms/<id>/` | `<id>.provider.ts` (a `BaseProvider` implementing `ISmsProvider`) and `<id>.provider.spec.ts`; export it from `lib/sms/index.ts` |
| `packages/shared` | `SmsProviderIdEnum.<Name> = '<id>'` (`types/providers.ts`), a credentials config built from existing `CredentialsKeyEnum` keys (`consts/providers/credentials/provider-credentials.ts`; `password` and the other `secureCredentials` keys are encrypted at rest), an entry in `smsProviders` (`consts/providers/channels/sms.ts`) |
| `packages/framework` | The same enum value (`src/shared.ts`) and `smsProviderSchemas` entry (`schemas/providers/sms/index.ts`). The `satisfies Record<SmsProviderIdEnum, …>` check fails to compile without it |
| `libs/application-generic/src/factories/sms` | `handlers/<id>.handler.ts` (credentials → provider config), its export in `handlers/index.ts`, and an instance in `SmsFactory` |
| `apps/dashboard/public/images/providers/light/square/<id>.svg` | A placeholder lettermark, not a vendor brand asset |

The provider must decide success from **what the gateway says**, not the HTTP status, and must throw when the gateway did not accept the message. Cover every reply shape the gateway really produces (success, error string, HTML error page, empty body, rejection-as-200). In the spec, check each test fails when its behaviour is removed.

```bash
cd packages/shared && pnpm build && cd ../stateless && pnpm build && cd ../providers && npx vitest run src/lib/sms/<id>
```

Then [build the worker](#build-it) with the next tag (`2.3.0-digit.<n+1>`) and set `novu_worker_image` to it.

### 2. The catalog entry, in novu-bridge

1. In `ProviderCatalog`:
   - Add a type constant and put it in `TYPES_LONGEST_FIRST`, so that no type is a prefix-match for a longer one.
   - For a fork provider, also add a `NOVU_PROVIDER_*` constant and a `TYPE_BY_NOVU_SMS_PROVIDER` entry.
2. Add the entry to `types()`. The field **keys must be the Novu provider's credential keys**, because `toNovuCredentials` copies exactly the declared keys:
   ```java
   types.add(ProviderType.builder()
           .type(ACME).label("ACME SMS").channel("SMS").transport("novu")
           .novuProviderId(NOVU_PROVIDER_ACME)             // the fork's (or Novu's) provider id
           .credentialFields(List.of(
                   CredentialField.text("baseUrl", "API URL", true, "https://acme.example/send", null),
                   CredentialField.text("user", "Username", true, null, null),
                   CredentialField.password("password", "Password", true, null),
                   CredentialField.text("from", "Sender id", false, null, null)))
           .supportsVerify(true).supportsTestSend(true)
           .build());
   ```
   Put what the operator must know about the gateway (costs, encodings, which API variant) in the fields' `help`. The Configurator shows it under the field.
3. **`supportsVerify(true)`** turns on **Check status** (`POST /providers/verify`), which only checks that the integration exists and is active. **`supportsTestSend(true)`** turns on **Test** (`POST /providers/test-send`), the only real proof that the credentials work.
4. Mirror the type in `local-setup/scripts/migrate-notifications.py`:
   - `CATALOG_CHANNEL`, `CATALOG_LABEL`, `CATALOG_REQUIRED` and `TYPES_LONGEST_FIRST`
   - `TYPE_BY_NOVU_SMS_PROVIDER` and `FORK_WORKER_TYPES` for a fork provider
5. Extend `ProviderCatalogTest` with the new provider id and keys.

To verify:

- `GET /novu-adapter/v1/providers/catalog` lists the type.
- Creating one without a required field answers `400 NB_INVALID_PROVIDER`.
- The created identifier maps back to the type.
- **Test** delivers through a mock gateway that reproduces the real reply formats ([developer-guide.md](./developer-guide.md#local-testing-without-real-gateways)), then through the real gateway.

A `DeliveryProvider` that bypasses Novu is the answer only when the gateway cannot be driven by Novu's worker at all. It loses credential storage, the activity log and operator management.

### Delivery receipts for a new gateway

`service/receipts/ReceiptParser` looks for a correlation id and an outcome word anywhere in the payload ([contract/outputs.md](./contract/outputs.md#delivery-receipts)). A gateway therefore usually needs only two things: a Kong route for `/novu-bridge/novu-adapter/v1/receipts/<gateway>` (see `novu-bridge-receipts-route` and the auth-optional list in `kong.yml`) and the shared secret. Extend `ID_KEYS` / `REF_KEYS` / `STATUS_KEYS` or `mapStatus` only for names these rules miss.
