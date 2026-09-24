# Provider adapters, and adding a provider

How novu-bridge reaches SMS, WhatsApp and email gateways, and how to add a new provider type.
Code lives in `backend/novu-bridge/`; operators add providers on Configurator → Notifications →
**Providers** ([setup-guide.md §3](./setup-guide.md#3-add-a-provider)).

## How the adapters work

Every provider an operator adds is a **Novu integration**. novu-bridge never stores
credentials: `POST /novu-adapter/v1/providers` validates them against the catalog, maps them to
Novu's credential keys (`ProviderCatalog.toNovuCredentials`) and creates the integration. On
dispatch the bridge triggers the channel's Novu workflow (`complaints-sms` / `-whatsapp` /
`-email`) and Novu's worker calls the gateway.

`service/provider/ProviderCatalog.types()` defines five types, in three transport tiers:

| Type | Channel | `transport` | Novu provider | Who talks to the gateway |
|---|---|---|---|---|
| `twilio-sms` | SMS | `novu` | `twilio` | Novu |
| `twilio-whatsapp` | WHATSAPP | `novu` | `twilio` | Novu |
| `smtp` | EMAIL | `novu` | `nodemailer` | Novu |
| `ozeki` | SMS | `novu-generic-sms` | `generic-sms` | Novu, JSON straight to the gateway |
| `smscountry` | SMS | `bridge-adapter` | `generic-sms` | Novu → novu-bridge adapter → gateway |

The configurator renders the credential form from `GET /novu-adapter/v1/providers/catalog`, so a
new type needs no UI change. Integration identifiers are `<type>-<hash>`; `typeFromIdentifier`
maps them back using `TYPES_LONGEST_FIRST`.

### generic-sms

Novu's `generic-sms` provider POSTs `{to, from, content, id, customData, sender}` as JSON to
`baseUrl` **verbatim** (no path appended), sends `apiKey` / `secretKey` as headers named by
`apiKeyRequestHeader` / `secretKeyRequestHeader`, and reads the reply's correlation id and date
through the `idPath` / `datePath` dot-paths.

| Novu credential | Ozeki | SMSCountry |
|---|---|---|
| `baseUrl` | the operator's HTTP API URL | `novu.bridge.smscountry.adapter.url` (+ `?apiUrl=<gateway URL>` when the operator set one) |
| `apiKey` / `apiKeyRequestHeader` | username / `X-Ozeki-Username` | panel username / `X-SMSCountry-User` |
| `secretKey` / `secretKeyRequestHeader` | password / `X-Ozeki-Password` | panel password / `X-SMSCountry-Password` |
| `from` | sender id | registered sender id |
| `idPath` / `datePath` | `data.0.message_id` / `data.0.submit_date` | `id` / `date` |

### The SMSCountry adapter

SMSCountry's legacy bulk API takes form-encoded parameters, answers plain text `OK:<jobid>`,
and returns HTTP 200 even for errors. No Novu provider can drive it, so the SMSCountry
integration's `baseUrl` points at novu-bridge itself:

```
Novu worker ──JSON──► POST /novu-bridge/novu-adapter/v1/gateways/smscountry/send ──form──► SMSCountry
```

`SmsCountryAdapterController`:

| Aspect | Behaviour |
|---|---|
| Auth | The `X-SMSCountry-User` / `X-SMSCountry-Password` headers **are** the authentication (the path is excluded from `ProxyAuthFilter`). Missing → `401 NB_ADAPTER_UNAUTHENTICATED` |
| Request | Recipient from `to` (or `recipient`, `phone`, `mobilenumber`); text from `content` (or `text`, `message`, `body`); sender from `from` / `sender` / `senderId`, else `NOVU_BRIDGE_SMS_SENDER_ID`. Missing recipient or text → `400 NB_ADAPTER_BAD_REQUEST` |
| Gateway URL | `?apiUrl=` query parameter, honoured only if it is an absolute `http(s)` URL **and** its host is the `novu.bridge.smscountry.url` host or listed in `novu.bridge.smscountry.allowed.hosts` (`NOVU_BRIDGE_SMSCOUNTRY_ALLOWED_HOSTS`, default `api.smscountry.com,www.smscountry.com`). Otherwise `400 NB_ADAPTER_URL_NOT_ALLOWED` and nothing is sent — never a fallback to `novu.bridge.smscountry.url` with the provider's credentials. The same check refuses such a URL when the provider is saved. A mock or regional gateway host must be listed. No `apiUrl` = `novu.bridge.smscountry.url` |
| Success | `200 {"id": "<jobid>", "date": "<ISO-8601>"}` — Novu fails the step unless `id` is non-empty |
| Rejection | `502 {"error": "NB_SMSCOUNTRY_REJECTED", "message": …}` — non-2xx so Novu records the step failed instead of a false success |

`novu.bridge.smscountry.adapter.url` (`NOVU_BRIDGE_SMSCOUNTRY_ADAPTER_URL`, default
`http://novu-bridge:8080/novu-bridge/novu-adapter/v1/gateways/smscountry/send`) must be reachable
**from the Novu worker** over the container/cluster network.

**Internal only.** The request carries gateway credentials, so
`/novu-bridge/novu-adapter/v1/gateways/**` is never routed through Kong. From outside it answers
**401** without a token (it is absent from Kong's auth-optional list) and **403** with one (no
access-control action exists for it); behind those, the `novu-bridge-internal-gateways-deny`
route in `local-setup/kong/kong.yml` terminates it with 404 and its upstream is a dead address.
Do not add a route or an access-control action for it.

**Allowed hosts.** `apiUrl` is where the adapter sends the operator's panel credentials, so it
is an allow-list, not a proxy: set `novu_bridge_smscountry_allowed_hosts` in host_vars (Compose)
or `NOVU_BRIDGE_SMSCOUNTRY_ALLOWED_HOSTS` (Helm) to add a host. A value replaces the default
list; the host of `novu.bridge.smscountry.url` stays allowed either way.

### The legacy direct route

`novu.bridge.sms.provider=smscountry` (host_vars `novu_bridge_sms_provider`) makes the bridge
post to SMSCountry itself through `SmsCountryDeliveryProvider` (a `service/delivery/DeliveryProvider`),
bypassing Novu, with credentials from env. It remains for existing deployments; it gets no Novu
credential store, activity log or Configurator management. Use it **or** an SMSCountry
provider on a channel, not both.

### Provider selection at dispatch

The tenant's `NOTIFICATIONS.Channel` row (`provider` = Novu integration identifier) is read at
the state tenant on every dispatch (60 s cache). The bridge checks the selection against Novu's
integration list (`NOVU_BRIDGE_PROVIDER_AVAILABILITY_CACHE_TTL_MS`, 60 s); a missing, disabled or
wrong-channel provider is recorded `SKIPPED / NB_PROVIDER_UNAVAILABLE` instead of triggering.
If Novu cannot be reached for the check, the bridge delivers as it otherwise would. With no
provider selected, the row's `gateway` and the env fallbacks apply.

## Adding a provider

Pick the tier:

```
Does Novu ship a provider for this gateway?
├─ yes → Tier 1: catalog entry only
└─ no → does the gateway accept a JSON POST and return a real HTTP status?
        ├─ yes → Tier 2: generic-sms pointed at the gateway
        └─ no  → Tier 3: generic-sms pointed at an adapter you write in novu-bridge
```

### Tier 1 — Novu supports the gateway

1. In `ProviderCatalog`, add a type constant next to `TWILIO_SMS`, `SMTP`, … and put it in
   `TYPES_LONGEST_FIRST` so that no type is a prefix-match for a longer one.
2. Add the entry to `types()`:
   ```java
   types.add(ProviderType.builder()
           .type(ACME_SMS).label("ACME SMS").channel("SMS").transport("novu")
           .novuProviderId("acme")                          // Novu's provider id
           .credentialFields(List.of(
                   CredentialField.text("apiKey", "API key", true, null, null),
                   CredentialField.password("apiSecret", "API secret", true, null),
                   CredentialField.text("from", "Sender id", true, "CITY-GOV", null)))
           .supportsVerify(true).supportsTestSend(true)
           .build());
   ```
3. **Credential mapping.** If the field keys are Novu's credential keys, the `default` branch of
   `toNovuCredentials` copies exactly the declared keys. Otherwise add a `case`.
4. **`supportsVerify(true)`** for any Novu-backed type. It enables **Check status**
   (`POST /providers/verify`), which only checks that the integration exists and is active.
   `supportsTestSend(true)` enables **Test** (`POST /providers/test-send`), the only credential
   proof.
5. Build and deploy novu-bridge. The operator then sees the type under **Add Provider**, with
   your field labels, and can select it on **Channels** for its channel.

Check: the type appears in `GET /novu-adapter/v1/providers/catalog`; creating one without a
required field answers `400 NB_INVALID_PROVIDER`; the created identifier maps back to the type;
**Test** delivers.

### Tier 2 — generic-sms straight to a JSON gateway (like Ozeki)

1. Add the type with `transport("novu-generic-sms")` and `novuProviderId(NOVU_PROVIDER_GENERIC_SMS)`.
2. Write a mapping method like `ozekiCredentials` and a `case` in `toNovuCredentials`: `baseUrl`
   = gateway URL, `apiKey`/`secretKey` + the header names the gateway expects, `from`, and the
   `idPath`/`datePath` of its reply. Non-secret settings with no credential slot can ride as
   query parameters on `baseUrl`.
3. Steps 1, 4 and 5 of Tier 1.

Check the mapping key by key, then **Test**: a wrong mapping fails at the gateway with no local
symptom.

### Tier 3 — an adapter in novu-bridge (like SMSCountry)

1. **Client** (model: `service/SmsCountryClient`): build the native request, parse the native
   reply, return a `NovuClient.NovuResponse`. Mask recipients with `PiiMask`; never log
   credentials.
2. **Controller** under `/novu-adapter/v1/gateways/<gateway>/send` (model:
   `SmsCountryAdapterController`): refuse missing credential headers before calling the
   gateway (say which header, never its value); answer a non-empty `id` on success and non-2xx
   on rejection; accept a URL parameter only if it is absolute `http(s)`.
3. **Credential mapping** as Tier 2, with `baseUrl` = your adapter's in-cluster URL (add a
   property like `novu.bridge.smscountry.adapter.url`) and the gateway URL as a query parameter.
4. **Keep it internal.** `ProxyAuthFilter` already skips `/novu-adapter/v1/gateways`, and Kong
   already refuses the prefix (401 / 403 from outside, 404 behind that). Add nothing to Kong.
   If the adapter takes a gateway URL, allow-list its hosts as
   `novu.bridge.smscountry.allowed.hosts` does — never post credentials to a caller's URL.
5. Error codes for the new gateway go in [contract/error-codes.md](./contract/error-codes.md)
   and `backend/novu-bridge/src/main/resources/contract/error-codes.txt`.
6. Steps 1, 4 and 5 of Tier 1 (`transport("bridge-adapter")`).

Check every reply shape the gateway really produces (success, error string, HTML error page,
empty body): missing headers → 401, missing recipient → 400, rejection → 502, success →
non-empty `id`.

A `DeliveryProvider` that bypasses Novu is the answer only when the gateway cannot be driven by
an HTTP POST at all; it loses credential storage, activity log and operator management.

### Delivery receipts for a new gateway

`service/receipts/ReceiptParser` finds a correlation id and an outcome word anywhere in the
payload ([contract/outputs.md](./contract/outputs.md#delivery-receipts)), so a gateway usually
needs only a Kong route for `/novu-bridge/novu-adapter/v1/receipts/<gateway>` (see
`novu-bridge-receipts-route` and the auth-optional list in `kong.yml`) and the shared secret.
Extend `ID_KEYS` / `REF_KEYS` / `STATUS_KEYS` or `mapStatus` only for names the rules miss.
