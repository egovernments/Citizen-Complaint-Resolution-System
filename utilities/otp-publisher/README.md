# otp-publisher — real OTPs over Novu + Twilio

Replaces Kong's `request-termination` mock on `/user-otp/v1/_send`
with a tiny Node service that mints OTPs, caches them in Redis, and
publishes an `OTP.SEND` event to the same Kafka topic
(`complaints.domain.events`) that novu-bridge already consumes.

The bridge's existing `DispatchPipelineService` then routes through:

- `TemplateBinding(tenantId, eventName=OTP.SEND)` → workflow id `otp-send`
- `ProviderDetail(tenantId, channel=sms)` → Twilio Account SID / token / FROM
- `otpSendWorkflow` in `backend/novu-bridge-endpoint/workflows.js` (registered by PR #36) → renders the SMS body

No bridge-side change needed.

```
SPA → Kong → otp-publisher → kafka(complaints.domain.events) → novu-bridge → Novu → Twilio → citizen phone
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
| `EVENT_TOPIC` | `complaints.domain.events` | Must match `NOVU_BRIDGE_KAFKA_INPUT_TOPIC` on novu-bridge. |
| `OTP_TTL_SECONDS` | `600` | 10-minute expiry. Citizen UI shows a 30 s resend timer. |
| `DEFAULT_TENANT_ID` | `ke` | Used when the request body omits `tenantId` (digit-ui sometimes does). |
| `STATIC_OTP` | _unset_ | Optional fixed OTP. When set, every send returns this code and validate accepts it. Mirrors `CITIZEN_LOGIN_PASSWORD_OTP_FIXED_VALUE` on egov-user — handy for CI / dev. |
| `REDIS_KEY_PREFIX` | `otp:` | Namespace for OTP keys. |

## Event envelope on Kafka

Matches `ComplaintsDomainEvent` so the bridge consumer can deserialize
without any code change. The recipient is carried as a single
stakeholder; subscriber id is the phone number itself (OTP precedes
user-create, so we have no DIGIT uuid yet — Novu accepts any string id).

```json
{
  "eventId": "<uuid>",
  "eventType": "OTP",
  "eventTime": "2026-05-15T13:14:15.000Z",
  "producer": "otp-publisher",
  "module": "USER-OTP",
  "eventName": "OTP.SEND",
  "entityType": "OTP_CODE",
  "entityId": "<same uuid>",
  "tenantId": "ke",
  "actor": { "uuid": "system", "type": "SYSTEM" },
  "stakeholders": [
    { "role": "RECIPIENT", "uuid": "0712345678", "mobileNumber": "0712345678" }
  ],
  "context": { "source": "citizen-login" },
  "data": { "otp": "123456", "userType": "CITIZEN" }
}
```

## Kong config

The legacy `user-otp-mock` upstream + `request-termination` plugin are
replaced with a real proxy. See `local-setup/kong/kong.yml`.

`/otp/v1/_validate` is also routed here so the validate step doesn't
keep hitting the old mock. egov-user's own `/user/_create` path is
unchanged — autocreate-on-validate still flows through the existing
citizen create endpoint after we confirm the OTP.

## TemplateBinding for OTP.SEND

The seed in `local-setup/db/notif-mdms-seed/data/template-bindings.json`
includes a row binding `OTP.SEND` → `otp-send` workflow with
`paramOrder: ["otp"]`. Run the existing `seed.sh` to apply.

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
| Twilio rejects (trial / unverified) | The publisher doesn't know — the bridge logs the failure to its DLQ topic. Verify recipient in Twilio console for trial accounts. |
| `STATIC_OTP` set in production | Big footgun. Don't. Only set in dev / CI. |

## Future work

- Per-tenant `STATIC_OTP` override (currently global).
- Rate-limit `_send` by mobile to mitigate enumeration.
- Switch to `OTP.SEND.WHATSAPP` channel when Twilio WA is verified for
  the tenant — bridge already supports `channel: whatsapp` template bindings.
