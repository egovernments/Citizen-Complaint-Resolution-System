# otp-publisher — real OTPs over novu-bridge

Replaces Kong's `request-termination` mock on `/user-otp/v1/_send`
with a tiny Node service that mints OTPs, caches them in Redis, and
publishes a **fully-rendered** `OTP.SEND` event (novu-bridge envelope v1,
`eventType: OTP`) to its own Kafka topic (`otp.send.events`).

novu-bridge treats it exactly like a complaint notification: validate the
envelope, run the delivery gates, hand the body to the SMS provider (Novu or
a direct gateway), write one `nb_dispatch_log` row. There is no OTP-specific
code in the bridge — the OTP text is rendered here (`OTP_MESSAGE_TEMPLATE`).

```
SPA → Kong → otp-publisher → kafka(otp.send.events) → novu-bridge → SMS provider → citizen phone
              │
              └→ Redis (otp:tenantId:mobile, TTL 10min)

SPA → Kong → otp-publisher → /otp/v1/_validate → Redis lookup → 200/400
```

## Endpoints

| Path | What it does |
|---|---|
| `POST /user-otp/v1/_send` | Generates a 6-digit OTP, caches `otp:<tenantId>:<mobile>` with `OTP_TTL_SECONDS` TTL, publishes `OTP.SEND` to Kafka, responds with the legacy mock-shape envelope so the SPA notices nothing. |
| `POST /otp/v1/_validate` | Looks up the cached OTP and confirms (single-use — deletes on success). Falls back to `STATIC_OTP` if set. |
| `GET  /healthz` | Liveness — returns `{"ok":true}` when Redis + Kafka are up. |

## Env

| Var | Default | Notes |
|---|---|---|
| `PORT` | `3030` | Container port. Kong upstream is `http://otp-publisher:3030`. |
| `REDIS_URL` | `redis://digit-redis:6379` | Shared with the rest of the stack. |
| `KAFKA_BROKERS` | `digit-redpanda:9092` | Comma-separated for clustered. |
| `EVENT_TOPIC` | `otp.send.events` | Must be one of `NOVU_BRIDGE_KAFKA_INPUT_TOPICS` on novu-bridge. |
| `OTP_COUNTRY_CODE` | _unset_ | E.164 prefix (e.g. `+254`) prepended to national numbers (leading zeros dropped). Unset = number sent as given. |
| `OTP_MESSAGE_TEMPLATE` | `DIGIT: Your one-time login code is {otp}. It expires in {minutes} minutes. Do not share this code.` | `{otp}` and `{minutes}` are substituted. |
| `OTP_TTL_SECONDS` | `600` | 10-minute expiry. Citizen UI shows a 30 s resend timer. |
| `DEFAULT_TENANT_ID` | `ke` | Used when the request body omits `tenantId` (digit-ui sometimes does). |
| `STATIC_OTP` | _unset_ | Optional fixed OTP. When set, every send returns this code and validate accepts it. Mirrors `CITIZEN_LOGIN_PASSWORD_OTP_FIXED_VALUE` on egov-user — handy for CI / dev. |
| `REDIS_KEY_PREFIX` | `otp:` | Namespace for OTP keys. |

## Event envelope on Kafka

novu-bridge envelope v1 — the same shape pgr-services emits, so the bridge needs no
OTP-specific branch. `subscriberId` is keyed on the phone (OTP precedes user-create).

```json
{
  "schemaVersion": "1",
  "eventId": "<uuid>",
  "eventType": "OTP",
  "eventTime": "2026-05-15T13:14:15.000Z",
  "producer": "otp-publisher",
  "module": "USER-OTP",
  "eventName": "OTP.SEND",
  "entityType": "OTP_CODE",
  "entityId": "<same uuid>",
  "tenantId": "ke",
  "channel": "SMS",
  "subscriberId": "ke:+254712345678",
  "contact": { "type": "CITIZEN", "phone": "+254712345678", "locale": "en_IN" },
  "renderedBody": "DIGIT: Your one-time login code is 123456. It expires in 10 minutes. Do not share this code.",
  "transactionId": "OTP:ke:+254712345678:<uuid>",
  "data": { "userType": "CITIZEN" }
}
```

## Kong config

The legacy `user-otp-mock` upstream + `request-termination` plugin are
replaced with a real proxy. See `local-setup/kong/kong.yml`.

`/otp/v1/_validate` is also routed here so the validate step doesn't
keep hitting the old mock. egov-user's own `/user/_create` path is
unchanged — autocreate-on-validate still flows through the existing
citizen create endpoint after we confirm the OTP.

## Local dev

```bash
cd local-setup/scripts/otp-publisher
npm install
REDIS_URL=redis://localhost:6379 KAFKA_BROKERS=localhost:9092 \
  STATIC_OTP=123456 node server.js
# then:
curl -X POST http://localhost:3030/user-otp/v1/_send \
  -H 'Content-Type: application/json' \
  -d '{"otp":{"mobileNumber":"0712345678","tenantId":"ke","type":"login"}}'
```

## Failure modes

| Failure | Behavior |
|---|---|
| Redis down | `_send` still returns 200 (citizen UI doesn't lock up); `_validate` returns 500. Re-send needed once Redis is back. |
| Kafka down | `_send` returns 200 (OTP still cached, can be validated locally); the SMS just doesn't go out. Visible in `digit-redpanda` logs. |
| Provider rejects (trial / unverified / DLT) | The publisher doesn't know — look at `nb_dispatch_log` (Notification Logs screen, channel SMS) for the `FAILED` row and its provider code. |
| `STATIC_OTP` set in production | Big footgun. Don't. Only set in dev / CI. |

## Future work

- Per-tenant `STATIC_OTP` override (currently global).
- Rate-limit `_send` by mobile to mitigate enumeration.
- Switch to `OTP.SEND.WHATSAPP` channel when Twilio WA is verified for
  the tenant — bridge already supports `channel: whatsapp` template bindings.
