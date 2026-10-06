# Adding an SMS Gateway That Novu Does Not Ship

This guide is for a v2.12 deployment whose SMS gateway Novu cannot drive out of the box. It
adds a provider for that gateway to Novu's **stock** worker image when the worker starts. You
don't fork Novu and you don't build an image.

The mechanism is the one the next release ships as standard for SMSCountry, Jasmin and Ozeki
([#2097](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/2097)). On
2.12 you wire it in yourself, through files in your deployment checkout.

Read [Enabling Notifications](README.md) first. This guide assumes Novu is running and that
you have done [Verify the Novu key](README.md#verify-the-novu-key).

## Do you need this?

This covers complaint notifications sent through novu-bridge. On 2.12, login OTP SMS go
through `egov-notification-sms` (`SMS_PROVIDER_CLASS: Console`), not Novu, so this gateway
does not send OTPs.

| Your gateway | What to do |
|---|---|
| SMSCountry, legacy bulk API | Not this guide. Use [Enable SMS](README.md#enable-sms), which posts to SMSCountry directly |
| One Novu 2.3.0 already ships (see the command below) | Skip Steps 1 and 2, and leave the `novu-worker` block out of Step 3: it loads files you did not create, and the worker would not start. Make Step 3's `host_vars` settings, then create the integration in Step 4 with Novu's provider id and credential keys |
| Takes a JSON POST, replies in JSON with a message id, and signals failure with a real HTTP error status | Novu's own `generic-sms` provider may be enough. Skip Steps 1 and 2 and the `novu-worker` block of Step 3, as above |
| Anything else: form-encoded requests, plain-text replies, failures reported as HTTP 200, unusual auth | This guide, all steps |

To list the SMS providers Novu ships:

```bash
sudo docker exec novu-worker ls /usr/src/app/packages/providers/dist/cjs/lib/sms
```

On 2.3.0 this lists `africas-talking`, `clickatell`, `infobip`, `kannel`, `plivo`, `termii`,
`twilio` and about 25 more.

## How it works

The Novu worker is the process that calls SMS gateways. When an SMS step runs, it asks its
`SmsFactory` for the handler matching the integration's `providerId`. These files sit beside
the worker:

| File | What it does |
|---|---|
| `register.js` | Loaded before the worker starts (`NODE_OPTIONS=--require …`). It wraps `SmsFactory.getHandler`: an integration whose `providerId` is one of yours gets your handler, and every other one goes to Novu unchanged. It refuses to start the worker if a provider file fails to load, or if the image is not a Novu version it was tested against (2.3.0). It also strips credentials from every error a send throws, before Novu stores the error |
| `novu.js` | Finds the Novu classes your provider extends (`BaseProvider`, `BaseSmsHandler`, axios) inside the image |
| `smscountry.js`, `jasmin.js`, `ozeki.js` | DIGIT's providers for those three gateways. `register.js` loads them too |
| `<gateway>.js` | Your provider: one class that sends a message, and one handler that builds it from the integration's credentials |

Novu's API and dashboard stay stock. The API accepts any `providerId` string, so an
integration for your gateway can be created like any other.

What changes on a 2.12 deployment:

| Piece | Where it lives |
|---|---|
| The provider files | `local-setup/configs/novu-worker-providers/` in your deployment checkout. Every deploy copies `local-setup/configs/` to `/opt/digit/configs/` |
| Loading them into the worker | Your per-tenant compose file, `local-setup/docker-compose.<tenant>.yml` |
| The integration | Created through Novu's API (Step 4). For SMS, the 2.12 Configurator form only offers Twilio's fields |
| Choosing it for SMS | Making it Novu's primary SMS integration (Step 5) |

## Step 1: Get the loader

`register.js` and `novu.js` come from the commit that merged #2097. Run this from the root of
your deployment checkout. It assumes the eGov repository is the `origin` remote; use your own
name for it otherwise.

```bash
git fetch origin develop
mkdir -p local-setup/configs/novu-worker-providers
for f in register.js novu.js smscountry.js jasmin.js ozeki.js; do
  git show d713ff94863c3493d9f2db1785feb3ee95a4b169:backend/novu-bridge/novu-worker-providers/$f \
    > local-setup/configs/novu-worker-providers/$f
done
wc -c local-setup/configs/novu-worker-providers/*.js
```

None of the files may be 0 bytes. A failed `git show` (the commit not fetched, a typo) still
creates the file through the redirect, and leaves it empty.

That commit's `register.js` already has the redaction boundary (`sealErrors`). None of these
files had changed on `develop` since, as of 2026-10-05. If
`git log origin/develop -- backend/novu-bridge/novu-worker-providers/` shows a later commit,
copy from that commit instead and re-run the load check at the end of Step 2.

`register.js` loads SMSCountry, Jasmin and Ozeki by default. Keeping them is harmless. They
only handle integrations whose `providerId` is `smscountry`, `jasmin` or `ozeki`, and a
2.12 deployment creates none. If you do have one of those gateways, you already have its
provider: skip to Step 3.

## Step 2: Write the provider

Create `local-setup/configs/novu-worker-providers/<gateway>.js`, here `acme-sms.js`. The example below is for a
made-up gateway, "ACME", that takes `POST {"to","from","text"}` with a bearer API key and
replies `{"status":"accepted","messageId":"…"}`. Change the request and the reply check to
match your gateway's API documentation.

```js
'use strict';

const { axios, BaseProvider, ChannelTypeEnum, BaseSmsHandler, redactedSnippet } = require('./novu');

// Must not be a provider id Novu already ships (twilio, generic-sms, ...):
// register.js checks DIGIT's ids first, so a clash would replace Novu's provider.
const PROVIDER_ID = 'acme-sms';

class AcmeSmsProvider extends BaseProvider {
  id = PROVIDER_ID;
  channelType = ChannelTypeEnum.SMS;
  httpClient = axios.create();

  constructor(config) {
    super();
    this.config = config;
  }

  async sendMessage(options) {
    const response = await this.httpClient.post(
      this.config.baseUrl || '',
      { to: options.to, from: options.from || this.config.from, text: options.content },
      {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` },
        // Decide from the body, not the status: let every reply reach the check below.
        validateStatus: () => true,
      }
    );

    const body = response.data;
    if (response.status < 200 || response.status >= 300 || body?.status !== 'accepted' || !body.messageId) {
      const text = typeof body === 'string' ? body : JSON.stringify(body ?? '');
      throw new Error(`acme-sms rejected the message (HTTP ${response.status}): ${redactedSnippet(text, [this.config.apiKey])}`);
    }
    return { id: String(body.messageId), date: new Date().toISOString() };
  }
}

class AcmeSmsHandler extends BaseSmsHandler {
  constructor() {
    super(PROVIDER_ID, ChannelTypeEnum.SMS);
  }

  // Only keys Novu's API stores reach here (baseUrl, apiKey, from, user, password, ...).
  buildProvider(credentials) {
    this.provider = new AcmeSmsProvider({
      baseUrl: credentials.baseUrl,
      apiKey: credentials.apiKey,
      from: credentials.from,
    });
  }
}

module.exports = { PROVIDER_ID, AcmeSmsProvider, AcmeSmsHandler };
```

Then add your handler to `loadHandlers()` in `register.js`:

```js
function loadHandlers() {
  return [require('./smscountry').SmsCountryHandler, require('./jasmin').JasminHandler,
          require('./ozeki').OzekiHandler, require('./acme-sms').AcmeSmsHandler];
}
```

The rules that matter:

- **Credential keys must be ones Novu already stores.** Novu's API saves a fixed set of
  credential names and silently drops any others, so a new name reaches your handler empty.
  Usable names include `baseUrl`, `apiKey`, `secretKey`, `user`, `password`, `token`, `from`,
  `host`, `port` and `accountSid`.
- **Decide success from what the gateway says, not from the HTTP status.** Many gateways
  answer 200 to a rejected message or a wrong password. Keep `validateStatus: () => true`,
  and throw whenever the reply is not a clear acceptance. If you don't throw, Novu records the
  message as sent.
- **`options.to` is the number as DIGIT stores it.** On 2.12, complaint SMS arrive in
  national format without the country code (e.g. `841212121`). Add the country code in
  `sendMessage` if your gateway needs E.164.
- **Return `{ id, date }`.** `id` is the gateway's message id, which Novu shows in its
  activity feed.
- **Mask credentials in any gateway text you quote** (`redactedSnippet(text, [secrets])`).
  `register.js` also strips credentials from every error at the boundary, so you don't need
  to handle connection failures yourself.
- **Use a provider id Novu does not ship.** A clash would silently replace Novu's provider.

Before deploying, check that the files load in the real image:

```bash
docker run --rm -e DIGIT_NOVU_PROVIDERS=required \
  -v "$PWD/local-setup/configs/novu-worker-providers:/opt/digit-novu-providers:ro" \
  --entrypoint node ghcr.io/novuhq/novu/worker:2.3.0 \
  -e "console.log(require('/opt/digit-novu-providers/register.js').register().join(', '))"
# [digit-novu-providers] SMS providers registered in the Novu worker: smscountry, jasmin, ozeki, acme-sms
# smscountry, jasmin, ozeki, acme-sms
```

## Step 3: Wire it into the deployment

Add the worker change to `local-setup/docker-compose.<tenant>.yml`, where `<tenant>` is the
name you pass to `deploy.sh`. If the file already exists, add to it.

```yaml
services:
  novu-worker:
    environment:
      NODE_OPTIONS: --require /opt/digit-novu-providers/register.js
      DIGIT_NOVU_PROVIDERS: required
    volumes:
      - ./configs/novu-worker-providers:/opt/digit-novu-providers:ro
```

`DIGIT_NOVU_PROVIDERS: required` makes every process in the container load your providers or
crash. Without it, a worker started some other way can run without them and fail every send.

In `local-setup/ansible/inventory/host_vars/<tenant>.yml`:

| Setting | Value | Why |
|---|---|---|
| `novu_bridge_sms_provider` | leave unset (not `smscountry`) | Otherwise novu-bridge posts SMS to SMSCountry itself and never reaches Novu |
| `novu_bridge_channels_enabled` | includes `SMS` | Nothing is sent on a channel not listed here |
| `novu_bridge_integration_id_whatsapp` | `twilio-whatsapp`, **if WhatsApp is enabled** | See below |

**Why the WhatsApp setting matters.** Novu stores Twilio WhatsApp on its SMS channel, and an
SMS step goes to the channel's **primary** integration. Step 5 makes your gateway the primary.
Without this setting, WhatsApp messages would be sent to your SMS gateway. With it, novu-bridge
names `twilio-whatsapp` on every WhatsApp send, so WhatsApp stays on Twilio whatever the
primary is.

Deploy:

```bash
cd local-setup/ansible
./deploy.sh <tenant>
```

Then check the worker loaded your provider:

```bash
sudo docker logs novu-worker 2>&1 | grep digit-novu-providers | tail -1
# [digit-novu-providers] SMS providers registered in the Novu worker: smscountry, jasmin, ozeki, acme-sms
```

> **Later changes to a provider file need a worker restart.** The worker reads the files only
> when it starts. The first deploy restarts it, because its compose settings changed. A
> later deploy that changes only the `.js` files copies them but does not restart the worker.
> Run `sudo docker restart novu-worker` afterwards.

## Step 4: Create the integration

Use the shell from [Verify the Novu key](README.md#verify-the-novu-key), which has
`NOVU_BASE_URL` and `NOVU_API_KEY` set. The `credentials` keys are the ones your handler
reads in `buildProvider`.

```bash
read -rsp 'Gateway API key: ' ACME_API_KEY; echo

jq -n --arg key "$ACME_API_KEY" '{
  name: "ACME SMS",
  identifier: "acme-sms-prod",
  providerId: "acme-sms",
  channel: "sms",
  active: true,
  check: false,
  credentials: { baseUrl: "https://api.acme.example/v1/sms", apiKey: $key, from: "DIGIT" }
}' | curl -fsS -X POST "$NOVU_BASE_URL/v1/integrations" \
       -H "Authorization: ApiKey $NOVU_API_KEY" -H 'Content-Type: application/json' -d @- \
   | jq '.data | {_id, identifier, providerId, active, primary}'

unset ACME_API_KEY
```

The new integration is active but **not** primary.

## Step 5: Make it the primary SMS integration

```bash
ID=$(curl -fsS -H "Authorization: ApiKey $NOVU_API_KEY" "$NOVU_BASE_URL/v1/integrations" \
     | jq -r '.data[] | select(.identifier == "acme-sms-prod") | ._id')

curl -fsS -X POST "$NOVU_BASE_URL/v1/integrations/$ID/set-primary" \
     -H "Authorization: ApiKey $NOVU_API_KEY" -H 'Content-Type: application/json' -d '{}' \
   | jq '.data | {identifier, primary}'

curl -fsS -H "Authorization: ApiKey $NOVU_API_KEY" "$NOVU_BASE_URL/v1/integrations" \
   | jq '[.data[] | select(.channel == "sms") | {identifier, providerId, active, primary}]'
```

Your integration should be the only SMS integration with `primary: true`. `twilio-whatsapp`
loses primary, and that is fine as long as `novu_bridge_integration_id_whatsapp` is set
(Step 3).

## Step 6: Check it works

1. **One message.** In the Configurator, open **Notifications → Notification Providers** and **Test** with
   channel `SMS`, your own number and a message. **Send Test** stays disabled until both are filled in. This uses the same `complaints-sms` workflow and
   primary integration as a real notification. A success there only means Novu accepted it.
2. **What the gateway said.** In Novu, the message's job should be `completed`, and its
   last execution detail should carry your gateway's message id:

   ```bash
   curl -fsS -H "Authorization: ApiKey $NOVU_API_KEY" "$NOVU_BASE_URL/v1/notifications?page=0&limit=5" \
     | jq '.data[] | {workflow: .template.name, txn: .transactionId, jobs: [.jobs[] | {status,
           detail: ([.executionDetails[] | .detail] | last),
           raw: ([.executionDetails[] | .raw | select(. != null)] | last)}]}'
   ```

   The job's `providerId` field may still say `twilio`. Novu fills it from the step, not from
   the integration that sent the message. Go by the execution detail `Integration instance
   selected`, whose `raw` names the integration that sent it (e.g. `acme-sms-prod`), by the
   message id in `raw`, and by the gateway's own report. Each complaint makes an SMS and a
   WhatsApp notification; `txn` pairs them.
3. **The handset**, and the gateway's delivery report. Accepted is not the same as delivered.
4. **WhatsApp, if enabled.** Run **Test** with channel `WHATSAPP` and an approved Content SID, and check that it still goes
   through Twilio.
5. **A real complaint.** Trigger a transition, then check **Notifications → Notification Logs**.

## When it goes wrong

| Symptom | Cause |
|---|---|
| `novu-worker` restarts in a loop with `Cannot find module '/opt/digit-novu-providers/register.js'` | The files aren't at `/opt/digit/configs/novu-worker-providers/`. Check Step 1's path and redeploy |
| Worker log: `[digit-novu-providers] Novu worker <version> is not a verified version` | The worker image is no longer 2.3.0. See [Upgrading](#upgrading) |
| Novu job fails with `Sms handler for provider acme-sms is not found` | The worker started without the preload. The overlay's `NODE_OPTIONS` didn't reach it. Check `sudo docker inspect novu-worker` |
| Messages go to Twilio instead of your gateway | Your integration isn't primary (Step 5) |
| WhatsApp messages go to your SMS gateway | `novu_bridge_integration_id_whatsapp` isn't set (Step 3) |
| No SMS reaches Novu at all | `novu_bridge_sms_provider` is `smscountry`, or `SMS` isn't in `novu_bridge_channels_enabled` |
| Your handler receives an empty credential | The key isn't one Novu stores. Rename it (Step 2) |
| Novu says `completed`, but nothing arrives | The provider treated a rejection as success. Check how it reads the gateway's reply |

The bridge's **Notifications → Notification Logs** shows `SENT` once Novu accepts the trigger. It doesn't
show whether your gateway took the message. Novu's job status and the gateway's own report do.

## Upgrading

- **To the next release (develop / 2.20).** This mechanism is built in there. The provider
  files live in `backend/novu-bridge/novu-worker-providers/`, and the deploy mounts them.
  Move your `<gateway>.js` there, add it to `loadHandlers()`, and add a catalog entry so the
  Configurator can manage it. Then remove the `novu-worker` block from your overlay. See
  [Adding an SMS provider: a walkthrough](../../2.20/notifications/adding-a-provider.md) in
  that release's docs.
- **To a newer Novu.** Your provider depends on Novu internals: file paths, `SmsFactory` and
  the handler interface. `register.js` refuses to start an untested worker version on
  purpose. Re-run the Step 2 load check against the new image and send a test message. Only
  then add the version to `SUPPORTED_WORKER_VERSIONS` in `register.js`.
  `DIGIT_NOVU_PROVIDERS_ALLOW_UNTESTED=true` on the worker skips the check in an emergency.

## Tested

Verified end to end on a fresh v2.12 deploy (tag `v2.12`, 4dcb55923) on 2026-10-05: the
`configs/` copy, the overlay loading the providers into `novu-worker`, the worker restart,
the Novu API create and `set-primary`, WhatsApp staying on Twilio, and a real complaint's SMS
delivered through the new gateway (a mock).

Before that, the steps were run against stock `ghcr.io/novuhq/novu/api:2.3.0` and `worker:2.3.0`. The setup
had a `twilio-whatsapp` integration and the `complaints-sms` workflow as a 2.12 deploy creates
them, plus the ACME example above and a mock gateway:

| Case | Result |
|---|---|
| New integration created, not primary | Novu sent through `twilio` (the primary). ACME's gateway received nothing |
| After `set-primary` | ACME's gateway received the message. The job was `completed` with the gateway's id |
| Gateway rejects with HTTP 200 | The job `failed`, with the gateway's reason in the execution detail |
| WhatsApp trigger naming `twilio-whatsapp` while ACME is primary | Went to Twilio |
