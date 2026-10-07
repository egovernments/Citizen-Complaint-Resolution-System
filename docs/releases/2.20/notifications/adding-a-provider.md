# Adding an SMS provider: a walkthrough

This page walks a developer who is new to the codebase through adding a new SMS gateway (a "provider adapter") to notifications, from deciding whether you need code at all to sending a message through it on a local stack.

It is a tutorial. For how the pieces work and why, see [providers.md](./providers.md), which this page links to instead of repeating:

- [How providers work](./providers.md#how-providers-work)
- [DIGIT's worker providers](./providers.md#digits-worker-providers)
- [Gateway notes](./providers.md#gateway-notes)

On a **2.12** deployment, which has no provider catalog, follow [Adding an SMS Gateway That Novu Does Not Ship](../../2.12/notifications/adding-an-sms-gateway.md) instead. It wires the same worker provider in through the deployment's own files.

The example gateway, **AcmeSMS, is fictional**. Nothing about it exists in the repo. Every snippet below was applied to a scratch copy of `develop`, and all of its tests were run: worker, Java, Python and static.

## 0. Do you need a provider file at all?

Every provider an operator adds is a Novu integration. Novu's **worker** sends the message through a provider class, and novu-bridge never carries gateway code. So the question is whether a provider class for your gateway already exists.

| Your gateway | What you add |
|---|---|
| Upstream Novu 2.3.0 already ships a provider for it | A catalog entry only: [step 6](#6-add-the-catalog-entry), then [steps 7–10](#7-update-the-java-tests). Leave it out of the "worker provider" lists. |
| Anything else, JSON gateways included | A DIGIT provider file (all steps) |

To list the SMS provider ids that Novu ships:

```bash
docker run --rm --entrypoint sh ghcr.io/novuhq/novu/worker:2.3.0 -c \
  'cd /usr/src/app/apps/worker && node -e "console.log(Object.values(require(\"@novu/shared\").SmsProviderIdEnum).join(\" \"))"'
```

**Why not Novu's `generic-sms`?** It posts its own fixed JSON body, decides success from the HTTP status alone, and reads the message id from a JSON path. A gateway that rejects with HTTP 200, or replies in plain text, would then be recorded as sent ([why the three DIGIT gateways need their own](./providers.md#digits-worker-providers)). The catalog also refuses it: `ProviderCatalogTest.noCatalogTypeRidesGenericSmsAnyMore` fails if a type uses `generic-sms`. A provider file is about 80 lines, and it is the only way to read the gateway's own accept-or-reject answer.

A `DeliveryProvider` inside novu-bridge, which bypasses Novu, is the last resort. It loses Novu's credential store, the activity feed and operator management ([providers.md](./providers.md#adding-a-provider)).

## The worked example: AcmeSMS (fictional)

| | AcmeSMS |
|---|---|
| Request | `POST` form-encoded to `https://api.acmesms.example/v1/send`: `account`, `key`, `to` (digits, no `+`), `sender`, `text`, `encoding` (`gsm` or `ucs2`) |
| Accepted | Plain-text body `OK:<id>` |
| Rejected | Plain-text body `ERR:<reason>`, **with HTTP 200**. An outage gives a 5xx HTML page that echoes the posted form. |
| Operator enters | Account id, API key, sender id, an optional send URL |

That is the shape most hand-rolled gateways take: form in, text out, and a 200 that does not mean success. Ozeki shows the JSON variant (see `ozeki.js`).

## 1. Write the provider file

AcmeSMS needs the GSM-7 check that Jasmin already has. On `develop`, `fitsGsm7` and `toUcs2Hex` are defined in `jasmin.js`, and `novu.js` does not export them. Do not import them from `./jasmin`. That would tie AcmeSMS to the Jasmin provider: renaming or removing Jasmin would break AcmeSMS when the worker boots, and `register.js` would refuse to start the worker. Shared helpers belong in `novu.js`, which says so itself ("Shared by the providers below, kept here so the mounted file set stays fixed"). So move them first:

1. In `backend/novu-bridge/novu-worker-providers/`, move `GSM_7_CHARACTERS`, `toUcs2Hex` and `fitsGsm7` (with their comments) from `jasmin.js` into the shared section of `novu.js`, below `redactedSnippet`.
2. Add `fitsGsm7` and `toUcs2Hex` to `module.exports` in `novu.js`.
3. In `jasmin.js`, take them from `./novu`. Keep them in its `module.exports`, because `test/jasmin.test.js` imports `toUcs2Hex` from `../jasmin`:
   ```js
   const { axios, BaseProvider, CasingEnum, ChannelTypeEnum, BaseSmsHandler, redactedSnippet, fitsGsm7, toUcs2Hex } =
     require('./novu');
   ```

Now create `backend/novu-bridge/novu-worker-providers/acmesms.js`. Copy the shape of `smscountry.js` or `jasmin.js` (form-encoded with a plain-text reply), or `ozeki.js` (JSON):

```js
'use strict';

const { axios, BaseProvider, CasingEnum, ChannelTypeEnum, BaseSmsHandler, redactedSnippet, fitsGsm7 } = require('./novu');

const PROVIDER_ID = 'acmesms';
const DEFAULT_BASE_URL = 'https://api.acmesms.example/v1/send';

class AcmeSmsProvider extends BaseProvider {
  id = PROVIDER_ID;
  channelType = ChannelTypeEnum.SMS;
  casing = CasingEnum.CAMEL_CASE;
  httpClient = axios.create();

  constructor(config) {
    super();
    this.config = config;
  }

  async sendMessage(options, bridgeProviderData = {}) {
    const text = String(options.content ?? '');
    const payload = this.transform(bridgeProviderData, {
      account: this.config.user,
      key: this.config.apiKey,
      to: (options.to || '').replace(/[^0-9]/g, ''), // AcmeSMS wants digits, no '+'
      sender: options.from || this.config.from,
      text,
      // Anything outside GSM 03.38 (Amharic, Arabic, emoji) must go as UCS-2.
      encoding: fitsGsm7(text) ? 'gsm' : 'ucs2',
    });

    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(payload.body)) {
      if (value !== undefined && value !== null) {
        form.append(key, String(value));
      }
    }

    const { data } = await this.httpClient.post(this.config.baseUrl || DEFAULT_BASE_URL, form, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...payload.headers },
      responseType: 'text', // plain-text reply: do not let axios parse JSON
      validateStatus: () => true, // every status goes through parseMessageId
    });

    return { id: parseMessageId(data, [this.config.user, this.config.apiKey]), date: new Date().toISOString() };
  }
}

/** `OK:<id>` is the only success. Anything else fails the step, with the credentials masked. */
function parseMessageId(body, secrets = []) {
  const trimmed = typeof body === 'string' ? body.trim() : '';
  if (trimmed.startsWith('OK:') && trimmed.length > 'OK:'.length) {
    return trimmed.slice('OK:'.length).trim();
  }
  const reason = trimmed.startsWith('ERR:') ? trimmed.slice('ERR:'.length).trim() : trimmed;
  throw new Error(`AcmeSMS request failed: ${redactedSnippet(reason, secrets) || 'empty response'}`);
}

class AcmeSmsHandler extends BaseSmsHandler {
  constructor() {
    super(PROVIDER_ID, ChannelTypeEnum.SMS);
  }

  // Integration credentials (Novu's keys) -> the provider's config.
  buildProvider(credentials) {
    this.provider = new AcmeSmsProvider({
      user: credentials.user,
      apiKey: credentials.apiKey,
      from: credentials.from,
      baseUrl: credentials.baseUrl,
    });
  }
}

module.exports = { PROVIDER_ID, AcmeSmsProvider, AcmeSmsHandler };
```

The rules this follows:

- **`PROVIDER_ID` is the Novu `providerId`.** It must not be one of Novu's own ids (the command in [step 0](#0-do-you-need-a-provider-file-at-all)), because `register.js` checks DIGIT's handlers first and would shadow Novu's.
- **Credential keys must be keys Novu's API stores.** Novu drops any other key on save, so a made-up name arrives empty. The list is the `credentials` object of Novu's integration schema, and includes `user`, `password`, `apiKey`, `secretKey`, `token`, `apiToken`, `from`, `baseUrl`, `host`, `port` and `region`. **Put a secret in `apiKey`, `apiToken`, `secretKey`, `token`, `password` or `serviceAccount`**: Novu encrypts only those keys at rest.
- **Decide success from the body, not the status.** `validateStatus: () => true` sends every reply, 4xx and 5xx included, to your parser. The parser must throw for anything that is not a clear acceptance. That covers error strings, HTML pages, empty bodies and a bare `OK:`.
- **Mask what you quote.** The error message ends up in Novu's activity feed. Pass gateway text through `redactedSnippet(text, secrets)` (or `redact` for JSON fields, as in `ozeki.js`), both from `./novu`. List the username first and the secret second, so that their Basic-auth token is masked too.
- **Leave transport failures alone.** On connection refused, reset, DNS failure or timeout, `register.js` turns the axios error into a plain, redacted `Error` ([step 4](#4-add-it-to-the-error-boundary-test)).
- **Unicode.** If the gateway needs a flag or a different coding for non-GSM text, decide it per message. Take `fitsGsm7` from `./novu`, never from another provider's file. Jasmin shows the hex-encoded UCS-2 variant (`toUcs2Hex`).
- **`this.transform(bridgeProviderData, {...})`** merges Novu's `_passthrough` overrides. Keep it, even if you think nothing will use it.

## 2. Register it in `register.js`

Add the handler to `loadHandlers()` in `backend/novu-bridge/novu-worker-providers/register.js`:

```js
function loadHandlers() {
  return [require('./smscountry').SmsCountryHandler, require('./jasmin').JasminHandler, require('./ozeki').OzekiHandler,
    require('./acmesms').AcmeSmsHandler];
}
```

Nothing else in `register.js` changes. Every DIGIT provider gets the same treatment:

- The `getHandler` patch picks it up.
- The redaction boundary (`sealErrors`) wraps its `sendMessage`.
- It joins the "registered" log line.

Two optional edits:

- If the gateway uses a credential key that is **not** secret and is not in `PUBLIC_CREDENTIALS` (`from`, `baseUrl`, `senderName`, `host`, `port`), add the key there. Otherwise the boundary masks that key's value in error messages.
- The skip warning in `run()` names the providers in prose. Update it if you want the new name to appear there.

## 3. Unit-test the provider

Create `test/acmesms.test.js` next to the others. `stubHttp` (in `test/stub-http.js`) swaps the provider's axios instance for a recorder:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AcmeSmsProvider } = require('../acmesms');
const { stubHttp } = require('./stub-http');

const config = { user: 'acct-17', apiKey: 'k-S3cret', from: 'CITYGOV' };
const msg = { to: '+254700000001', content: 'Complaint PG-1 is resolved' };

test('posts the form and returns the gateway id', async () => {
  const provider = new AcmeSmsProvider(config);
  const calls = stubHttp(provider, { status: 200, data: 'OK:a1b2c3\n' });
  const result = await provider.sendMessage(msg);
  assert.equal(result.id, 'a1b2c3');
  assert.equal(calls[0].body.get('to'), '254700000001');
  assert.equal(calls[0].body.get('encoding'), 'gsm');
  assert.equal(calls[0].config.validateStatus(500), true, 'every status reaches the parser');
});

// AcmeSMS answers HTTP 200 for rejections: the body, not the status, decides.
test('fails on ERR: even when the status is 200', async () => {
  const provider = new AcmeSmsProvider(config);
  stubHttp(provider, { status: 200, data: 'ERR:sender not registered' });
  await assert.rejects(provider.sendMessage(msg), /AcmeSMS request failed: sender not registered/);
});

test('masks the credentials in an echoed error page', async () => {
  const provider = new AcmeSmsProvider(config);
  stubHttp(provider, { status: 500, data: '<html>Bad request: account=acct-17&key=k-S3cret (k-S3cret)</html>' });
  const error = await provider.sendMessage(msg).catch((e) => e);
  assert.doesNotMatch(error.message, /acct-17|k-S3cret/);
});

test('sends text outside the GSM alphabet as UCS-2', async () => {
  const provider = new AcmeSmsProvider(config);
  const calls = stubHttp(provider, { status: 200, data: 'OK:u1' });
  await provider.sendMessage({ ...msg, content: 'ሰላም' });
  assert.equal(calls[0].body.get('encoding'), 'ucs2');
});
```

Cover every reply shape the real gateway produces: success, error string, HTML error page, empty body and rejection with a 200, as well as non-GSM text.

Run the whole suite inside the **stock** worker image that the providers patch (needs Docker):

```bash
bash backend/novu-bridge/novu-worker-providers/run-tests.sh
```

The output ends with `# fail 0`. Then **check that each test can fail**. Break the behaviour it guards, for example by making `parseMessageId` accept any body or by dropping the `redactedSnippet` call. Confirm the test goes red, then restore the file from a copy.

## 4. Add it to the error-boundary test

`test/error-boundary.test.js` sends through Novu's own `SendMessageSms` step against a refused port, a reset socket and an HTTP 500 that echoes the request. It then checks that nothing Novu would store contains a credential. Add the new id to its loop:

```js
for (const providerId of ['smscountry', 'jasmin', 'ozeki', 'acmesms']) {
```

If your provider reads a secret from a key other than `password`, give that key **its own value** and add the value to `LEAKS`, so the test hunts for the secret your provider actually sends:

```js
const USER = 'leak-user-7Q';
const PASSWORD = 'pw&S3cret<9> x';
const API_KEY = 'ak&K3y<7> z';

/** Every form a credential could take on its way into Novu's storage. */
const LEAKS = [
  USER,
  PASSWORD,
  'S3cret',
  encodeURIComponent(PASSWORD),
  new URLSearchParams({ v: PASSWORD }).toString().slice(2),
  Buffer.from(`${USER}:${PASSWORD}`).toString('base64'),
  API_KEY,
  'K3y',
  encodeURIComponent(API_KEY),
  new URLSearchParams({ v: API_KEY }).toString().slice(2),
];
```

and, in `sendThroughNovu()`:

```js
credentials: { baseUrl, user: USER, password: PASSWORD, apiKey: API_KEY, from: 'DIGIT' },
```

Do not reuse `PASSWORD` as the key's value. The boundary masks every secret credential value, so with `apiKey: PASSWORD` the key would be masked through `credentials.password`, which a real AcmeSMS integration does not have. The test would then check a credential shape that no deployment has.

What guards what. Each of these was checked by breaking the code and watching the test go red:

- The **refused** and **reset** cases prove that the boundary covers your provider. They turn red if `sealErrors` does not wrap it, because Novu would then store the axios error, posted form included.
- The **HTTP 500** case stays green on your parser's own masking, and on `redact`'s rule that masks any `key=…` pair. So it does not tell you whether the boundary treats `apiKey` as a secret.
- That is guarded by `anything a provider throws, not only axios errors, is redacted at the boundary` in the same file. It passes an `apiKey` and goes red if `apiKey` is added to `PUBLIC_CREDENTIALS`. If your secret lives in another key (`apiToken`, `secretKey`, `token`), give that test's credentials that key with its own value, put the value in the message the test throws, and assert that it is masked, as the test already does for `k-ZZ91`.
- Your parser's masking of the key is guarded by your own unit test (`masks the credentials in an echoed error page`).

`test/register.test.js` pins the registered set, so add `acmesms` there too:

- the id list in `registers our providers on the factory the worker imports`;
- the two sorted `['acmesms', 'jasmin', 'ozeki', 'smscountry']` assertions.

Re-run `run-tests.sh`.

## 5. Copy the runtime files to the Helm chart

Helm can only read files inside the chart, so the chart carries a byte-identical copy. The tests stay behind, because they live in `test/` and the glob below skips that folder:

```bash
cp backend/novu-bridge/novu-worker-providers/*.js \
   devops/deploy-as-code/charts/backbone-services/novu/files/novu-worker-providers/
```

`local-setup/tests/static/deployment-contracts.test.ts` fails if the copy drifts. It also pins the file list, in the `runtimeFiles(PROVIDERS_SRC)` expectation in `the helm chart ships the same provider code and mounts + preloads it`. `runtimeFiles()` returns the folder's `.js` files **sorted**, and the test compares with `toEqual`, so insert the new file in alphabetical order rather than appending it. For AcmeSMS it goes first:

```ts
expect(runtimeFiles(PROVIDERS_SRC)).toEqual(['acmesms.js', 'jasmin.js', 'novu.js', 'ozeki.js', 'register.js', 'smscountry.js']);
```

To run it:

```bash
cd local-setup/tests && npm ci && npx jest static/deployment-contracts.test.ts
```

Compose needs nothing more: `./deploy.sh` copies the whole folder to the box ([How it is deployed](./providers.md#how-it-is-deployed)).

## 6. Add the catalog entry

`backend/novu-bridge/src/main/java/org/egov/novubridge/service/provider/ProviderCatalog.java` is what the Configurator's **Add Provider** form is built from (`GET /novu-adapter/v1/providers/catalog`), so the form needs no code change (but see the note on field labels below). Edit six places:

```java
// 1. Type and Novu provider id
public static final String ACMESMS = "acmesms";
public static final String NOVU_PROVIDER_ACMESMS = "acmesms";

// 2. DIGIT worker providers only: hidden and refused when NOVU_BRIDGE_DIGIT_WORKER_PROVIDERS=false
private static final Set<String> WORKER_NOVU_PROVIDERS =
        Set.of(NOVU_PROVIDER_SMSCOUNTRY, NOVU_PROVIDER_OZEKI, NOVU_PROVIDER_JASMIN, NOVU_PROVIDER_ACMESMS);

// 3. Longest first, so no type is a prefix-match for a longer one
private static final List<String> TYPES_LONGEST_FIRST =
        List.of(TWILIO_WHATSAPP, SMSCOUNTRY, TWILIO_SMS, ACMESMS, JASMIN, OZEKI, SMTP);

// 4. TYPE_BY_NOVU_SMS_PROVIDER: add  NOVU_PROVIDER_ACMESMS, ACMESMS
// 5. CHANNEL_BY_TYPE:           add  ACMESMS, "SMS"
//    (both are Map.of, which takes at most 10 pairs; switch to Map.ofEntries past that)
```

6. Add the form to `allTypes()`. The order there is the order the Configurator offers:

```java
types.add(ProviderType.builder()
        .type(ACMESMS).label("AcmeSMS").channel("SMS").transport("novu")
        .novuProviderId(NOVU_PROVIDER_ACMESMS)
        .credentialFields(List.of(
                CredentialField.text("user", "Account id", true, "acct-12345", null),
                CredentialField.password("apiKey", "API key", true,
                        "From the AcmeSMS console, under API keys"),
                CredentialField.text("from", "Sender id", true, "CITYGOV",
                        "Must be registered with AcmeSMS, or every message is rejected"),
                CredentialField.text("baseUrl", "Send URL", false, "https://api.acmesms.example/v1/send",
                        "Leave blank for the standard endpoint. Text outside the GSM alphabet "
                                + "(Amharic, emoji) is sent as UCS-2: 70 characters per SMS segment, not 160")))
        .supportsVerify(true).supportsTestSend(true)
        .build());
```

The parts of that entry:

- **Field keys are the Novu credential keys** that your handler's `buildProvider` reads. `toNovuCredentials` copies exactly the declared keys, and a blank optional field is left out, so the provider's default applies.
- `CredentialField.text(key, label, required, placeholder, help)`, `.password(key, label, required, help)` and `.checkbox(key, label, help)` give the field kinds. Use `password` for every secret, because the form never echoes it.
- Put what an operator must know in `help`, such as costs, encodings and which API variant. The Configurator shows it under the field.
- `supportsVerify(true)` enables **Check status**, which only checks that the integration exists and is active. `supportsTestSend(true)` enables **Test**, which sends a real message.

**The Configurator overrides some field labels.** `ProviderCredentialFields.tsx` renders each label as `t(credLabelKey(f.key), { _: f.label })`. The catalog label is only the fallback for the translation key `app.providers.cred.<key in snake_case>`, and a translation always wins. The Configurator's bundled English (`configurator/src/providers/i18nProvider.ts`) defines that key for `account_sid`, `token`, `from`, `host`, `port`, `user`, `password` and `secure`. A `configurator-ui` localization message overrides it again. The bundled English is the base for every language. So AcmeSMS's form shows **SMTP User** for `user` and **From** for `from`, not "Account id" and "Sender id". Only `apiKey` ("API key") and `baseUrl` ("Send URL") show the catalog's label. SMSCountry, Ozeki and Jasmin have the same problem today: their `user` and `password` fields read **SMTP User** and **SMTP Password**.

- The lookup is per credential **key**, not per type. You cannot give one type its own label for a shared key without changing `ProviderCredentialFields.tsx`.
- A key with no translation (`apiKey`, `baseUrl`, `secretKey`, …) shows the catalog label. If you add a translation for it under `app.providers.cred` in `i18nProvider.ts`, that label applies to **every** type that uses the key, and the catalog labels for it stop showing.
- Put anything specific to your gateway in `help` and `placeholder`. The Configurator shows those as the catalog sends them.

**For a provider that upstream Novu ships,** edit every place above except place 2:

- Leave the type out of `WORKER_NOVU_PROVIDERS`. Only DIGIT's worker providers are hidden and refused when `NOVU_BRIDGE_DIGIT_WORKER_PROVIDERS=false`, and an upstream provider works on every worker.
- The `NOVU_PROVIDER_*` constant holds **Novu's** provider id, which can differ from your type id. For example, Novu's id for Africa's Talking is `africas-talking`.
- Still add the `TYPE_BY_NOVU_SMS_PROVIDER` entry, as Twilio has. Without it, an integration created outside the catalog has no type marker in its identifier (one made in Novu's dashboard, say). `deriveType` returns null for it, and the Configurator cannot rotate it.
- Use Novu's credential keys. Read them from the handler file in `/usr/src/app/libs/application-generic/build/main/factories/sms/handlers/` in the worker image.

## 7. Update the Java tests

Two test classes pin the catalog, both under `backend/novu-bridge/src/test/java/org/egov/novubridge/`. What changes in them depends on whether the type is a DIGIT worker provider (AcmeSMS) or one that upstream Novu ships.

### 7a. A DIGIT worker provider (AcmeSMS)

In `service/provider/ProviderCatalogTest.java`:

- In `theDigitGatewaysAreNovuProviders_withTheirIdsAndCredentialKeys`, add the id and keys to `providerKeys`, plus a `requiredKeys` assertion.
- Add the new type to the list in `noCatalogTypeRidesGenericSmsAnyMore`, in `allTypes()` order.
- Add a test that the identifier reads back and the type derives:

```java
@Test
void acmeSms_isAWorkerProvider_andReadsBackFromItsIdentifier() {
    assertTrue(ProviderCatalog.isWorkerProvider("acmesms"));
    assertEquals("acmesms", ProviderCatalog.typeFromIdentifier(ProviderCatalog.identifierFor("acmesms", "Main")));
    assertEquals("acmesms", ProviderCatalog.deriveType(Map.of("providerId", "acmesms", "channel", "sms")));
    assertEquals("SMS", ProviderCatalog.digitChannelOf(Map.of("providerId", "acmesms", "channel", "sms")));
}
```

In `web/controllers/ProviderControllerGuardsTest.java`:

- In `withTheWorkerProvidersOff_theCatalogHidesThem`, change `assertEquals(6, all.size(), …)` to `7`. Leave the `List.of("twilio-sms", "twilio-whatsapp", "smtp")` assertion alone, because a worker provider is hidden while the worker providers are off.
- Add the type to the `List.of("smscountry", "ozeki", "jasmin")` loop in `withTheWorkerProvidersOff_creatingOne_isRefused_inBothForms`.

### 7b. A type upstream Novu ships

Such a type is neither hidden nor refused when the worker providers are off, so the worker-provider tests above would fail for it. Instead:

- In `ProviderCatalogTest`, add the type to the list in `noCatalogTypeRidesGenericSmsAnyMore`, in `allTypes()` order. Leave `theDigitGatewaysAreNovuProviders_withTheirIdsAndCredentialKeys` alone: it covers DIGIT's gateways, and it asserts that the type id equals the Novu id.
- Add a test of its own. For example, for a type `africastalking` on Novu's `africas-talking` (the class needs a static import of `Assertions.assertFalse`):

```java
@Test
void africasTalking_isUpstream_andReadsBackFromItsIdentifierAndItsNovuId() {
    assertFalse(ProviderCatalog.isWorkerProvider("africas-talking"));
    ProviderType type = catalog.require("africastalking");
    assertEquals("africas-talking", type.getNovuProviderId());
    assertEquals(Set.of("user", "apiKey", "from"), requiredKeys(type));
    assertEquals("africastalking", ProviderCatalog.typeFromIdentifier(ProviderCatalog.identifierFor("africastalking", "Main")));
    assertEquals("africastalking", ProviderCatalog.deriveType(Map.of("providerId", "africas-talking", "channel", "sms")));
    assertEquals("SMS", ProviderCatalog.digitChannelOf(Map.of("providerId", "africas-talking", "channel", "sms")));
}
```

In `ProviderControllerGuardsTest.withTheWorkerProvidersOff_theCatalogHidesThem`:

- Add the type to the `List.of("twilio-sms", "twilio-whatsapp", "smtp")` assertion, in `allTypes()` order, because it stays visible.
- Change `6` to `7`.
- Do **not** add it to the refused loop in `withTheWorkerProvidersOff_creatingOne_isRefused_inBothForms`.

### Run the suite

Run the **whole** suite (Java 17), because more than one class pins the catalog:

```bash
cd backend/novu-bridge && mvn test        # quick loop: mvn test -Dtest=ProviderCatalogTest
```

## 8. Mirror the type in the migration script

`local-setup/scripts/migrate-notifications.py` mirrors the catalog for the 2.12 → 2.20 migration ([migration.md](./migration.md)). Under `# ── The provider catalog, mirrored from novu-bridge's ProviderCatalog.java`, add the type to:

- `CATALOG_CHANNEL`, `CATALOG_LABEL` and `CATALOG_REQUIRED`: the channel, the label, and the required keys;
- `TYPES_LONGEST_FIRST`: the same order as Java. `type_from_identifier()` and `derive_type()` read it.
- `TYPE_BY_NOVU_SMS_PROVIDER`, mapping the **Novu** provider id to the type, for every type, as in Java;
- `MOUNTED_PROVIDER_TYPES`, for a DIGIT worker provider only. With this entry, the script refuses to create such a provider while `novu-worker` does not preload `register.js`.

Add cases to the `ProviderIdentifier` tests in `local-setup/tests/test_notification_seed_decisions.py`: an `"acmesms-…": "acmesms"` identifier, and the id in the `derive_type` loop. That loop assumes the Novu id and the type id are the same. For an upstream type whose ids differ, assert it separately, for example `derive_type({"providerId": "africas-talking", "channel": "sms"}) == "africastalking"`. Then run:

```bash
python3 -m unittest local-setup/tests/test_notification_seed_decisions.py
```

## 9. Update the contract and docs

- **OpenAPI.** Add the type to the `type` enums of `ProviderType` and `ProviderCreateFromCatalog` in `backend/novu-bridge/src/main/resources/contract/openapi.yaml` (served by `ContractController`). Make the same change in its published copy, `docs/releases/2.20/notifications/contract/openapi.yaml`. Keep the two files identical.
- **[contract/error-codes.md](./contract/error-codes.md).** Update the type list under `NB_UNKNOWN_PROVIDER_TYPE`. For a worker provider, also update the "SMSCountry, Ozeki or Jasmin" wording under `NB_PROVIDER_UNAVAILABLE` and `NB_PROVIDER_TYPE_UNAVAILABLE`.
- **[providers.md](./providers.md).** Add a row to the type table and a row to [Gateway notes](./providers.md#gateway-notes) (request, "accepted when…", traps).
- **[setup-guide.md §3](./setup-guide.md#3-add-a-provider).** Add a row with the fields the operator fills in.
- **`backend/novu-bridge/novu-worker-providers/README.md`.** Update the list of providers.
- Many comments and messages name "SMSCountry, Ozeki and Jasmin" in prose. Behaviour does not depend on them. `git grep -n -i jasmin` finds them, so you can decide which should name the new gateway.

## 10. Try it end to end locally

On a local stack deployed with `enable_novu: true` ([setup-guide.md §2](./setup-guide.md#2-turn-the-stack-on)):

1. **Deploy your branch.** Build the bridge and its migrator, and pin both in `local-setup/ansible/inventory/host_vars/<tenant>.yml`:
   ```bash
   docker build -t novu-bridge:local    backend/novu-bridge
   docker build -t novu-bridge-db:local backend/novu-bridge/src/main/resources/db
   # host_vars/<tenant>.yml:
   #   novu_bridge_image:    "novu-bridge:local"
   #   novu_bridge_db_image: "novu-bridge-db:local"
   cd local-setup/ansible && ./deploy.sh <tenant>
   ```
   - **Use the `:local` tag.** The deploy's image plan reports a pin ending in `:local` as "built on this host".
   - **A `:local` image exists only on the machine that built it.** This works only when `deploy.sh` targets that same machine, as it does for a local stack. On any other host, `compose pull --ignore-pull-failures` skips the missing image, and `up -d` then fails with `pull access denied for novu-bridge`. To test on a remote box, push both images to a registry the box can pull from and pin those refs instead.
   - **Pin `novu_bridge_db_image` too.** The bridge and its migrator must be the same build, and pinning only one makes the deploy warn. The warning still names `pgr_services_image` and `pgr_services_db_image` while those two follow `notification_stack_tag`. That is fine for this test if your branch is based on the `develop` commit that tag was built from. Otherwise build and pin those two from your branch the same way.

   The deploy copies `novu-worker-providers/` from this checkout to `/opt/digit/novu-worker-providers` and restarts `novu-worker` when the files changed. While you only change the provider file, a faster loop is to copy the files there yourself and run `docker restart novu-worker`.
2. **Check that the worker loaded it.** Run `docker logs novu-worker 2>&1 | grep digit-novu-providers`. The output should end `… registered in the Novu worker: smscountry, jasmin, ozeki, acmesms`. A `[digit-novu-providers]` error means the worker refused to boot; the line says why.
3. **Start a mock gateway** on the stack's network. The network is `<basename of digit_dir>_egov-network`, which is `digit_egov-network` for `/opt/digit`. Save this as `acme-mock.py`:
   ```python
   # acme-mock.py: a stand-in for the FICTIONAL AcmeSMS gateway. Logs each request, answers like the real one.
   from http.server import BaseHTTPRequestHandler, HTTPServer
   from itertools import count
   from urllib.parse import parse_qs

   ids = count(1)


   class AcmeSms(BaseHTTPRequestHandler):
       def do_POST(self):
           length = int(self.headers.get("Content-Length", 0))
           # keep_blank_values and .get: a missing or empty field must get an ERR: reply,
           # not a KeyError that closes the socket (the provider would log "socket hang up").
           posted = parse_qs(self.rfile.read(length).decode(), keep_blank_values=True)
           form = {k: v[0] for k, v in posted.items()}
           field = lambda k: form.get(k, "")
           print("to=%s sender=%s encoding=%s text=%r"
                 % (field("to"), field("sender"), field("encoding"), field("text")), flush=True)
           if field("key") != "test-key":
               reply = "ERR:invalid key"          # AcmeSMS rejects with HTTP 200 too
           elif not field("sender") or not field("text"):
               reply = "ERR:missing sender or text"
           elif field("to").endswith("0000"):
               reply = "ERR:number blocked"
           else:
               reply = "OK:acme-%d" % next(ids)
           self.send_response(200)
           self.send_header("Content-Type", "text/plain")
           self.end_headers()
           self.wfile.write(reply.encode())


   HTTPServer(("0.0.0.0", 8080), AcmeSms).serve_forever()
   ```
   ```bash
   docker run -d --rm --name acme-mock --network digit_egov-network \
     -v "$PWD/acme-mock.py:/acme-mock.py:ro" python:3.12-alpine python /acme-mock.py
   ```
4. **Add the provider.** In the Configurator, go to **Notifications → Providers → Add Provider** and pick **AcmeSMS**. Fill in the fields as the form labels them (see [the label note in step 6](#6-add-the-catalog-entry)): any value for **SMTP User** (the `user` key, "Account id" in the catalog), `test-key` for **API key**, `CITYGOV` for **From** (the `from` key, "Sender id" in the catalog) and `http://acme-mock:8080/send` for **Send URL**. Then click **Create Provider**. Log in at a state that owns the providers ([who may manage providers](./providers.md#who-may-manage-providers)).
5. **Test it.** Use **Test** on the row, enter a phone number and a message, then **Send Test**. The button stays disabled until both are filled in. `docker logs acme-mock` shows the request, with `encoding=gsm`.
6. **Read the result in the right place.** Under **View Notification Logs**, set **Test sends** to *Show test sends*. The row reads *Sent (accepted by transport)*, which means **Novu accepted the trigger** and nothing more. The gateway's answer is in Novu's activity feed (the Novu dashboard, `/novu`) and in the mock's log. Send to a number ending `0000`. The activity feed should show `AcmeSMS request failed: number blocked`, while the Logs row still reads Sent. Rotate the credentials to a wrong API key, and the feed should show `invalid key` with no key in it.
7. **Use it for real.** Under **Notifications → Channels**, select AcmeSMS for SMS and **Enable** it ([setup-guide.md §4](./setup-guide.md#4-switch-the-channel-on)). Then file a complaint, and the message appears in the mock's log. Non-GSM text, such as an Amharic template, should arrive with `encoding=ucs2`.
8. **Clean up.** Run `docker stop acme-mock`, delete the provider, and remove the `novu_bridge_image` and `novu_bridge_db_image` pins.

Then repeat step 5 against the real gateway with real credentials. That is the only proof that the credentials work. If the gateway sends delivery receipts, see [Delivery receipts for a new gateway](./providers.md#delivery-receipts-for-a-new-gateway).

## Checklist

- [ ] [Step 0](#0-do-you-need-a-provider-file-at-all): confirmed Novu 2.3.0 has no provider for the gateway, and the new id does not collide with one of Novu's
- [ ] Shared helpers (`fitsGsm7`, `toUcs2Hex`) imported from `./novu`, never from another provider's file
- [ ] `novu-worker-providers/<id>.js`: `PROVIDER_ID`, provider class, handler; `validateStatus: () => true`; parser throws on anything but a clear acceptance; quoted text goes through `redactedSnippet`/`redact`; secrets live in a Novu-encrypted key
- [ ] Handler added to `loadHandlers()` in `register.js` (and to `PUBLIC_CREDENTIALS` if it uses a new non-secret key)
- [ ] `test/<id>.test.js` covers every reply shape; each test seen to fail when its behaviour is broken
- [ ] `error-boundary.test.js` loop updated, plus the secret key with its own value in `sendThroughNovu` and `LEAKS`; the `register.test.js` lists updated; `run-tests.sh` green
- [ ] Runtime `.js` files copied to `devops/deploy-as-code/charts/backbone-services/novu/files/novu-worker-providers/`; file list in `deployment-contracts.test.ts` updated, in alphabetical order; jest green
- [ ] `ProviderCatalog.java`: constants, `WORKER_NOVU_PROVIDERS` (worker providers only), `TYPES_LONGEST_FIRST`, `TYPE_BY_NOVU_SMS_PROVIDER`, `CHANNEL_BY_TYPE`, `allTypes()` entry with help text
- [ ] `ProviderCatalogTest` and `ProviderControllerGuardsTest` updated for the right path ([7a or 7b](#7-update-the-java-tests)); full `mvn test` green
- [ ] Field labels checked in the Configurator form: keys with a bundled translation (`user`, `password`, `from`, …) show that, not the catalog label
- [ ] `migrate-notifications.py` mirror (six names) and `test_notification_seed_decisions.py` updated; unittest green
- [ ] Both `openapi.yaml` copies, `error-codes.md`, `providers.md`, `setup-guide.md` §3 and the providers README updated
- [ ] Sent through a mock gateway that reproduces the real reply formats, then through the real gateway; checked the result in Novu's activity feed, not only on Logs
