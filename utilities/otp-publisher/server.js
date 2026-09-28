// otp-publisher — Kong forwards /user-otp/v1/_send + /otp/v1/_validate here.
//
// Replaces the legacy Kong `request-termination` mock with a real
// generator that:
//   1. mints a 6-digit OTP
//   2. caches `(otp, mobileNumber)` in Redis with a TTL (default 10 min)
//   3. publishes `OTP.SEND` to the same kafka topic novu-bridge already
//      consumes (`complaints.domain.events`), letting the existing
//      DispatchPipelineService route through the OTP TemplateBinding +
//      Twilio integration without any bridge-side change.
//
// On `_validate`, looks up the cached OTP and confirms.
//
// Response shapes mirror the previous Kong mock so the digit-ui SPA
// doesn't notice anything has changed:
//   _send  → { ResponseInfo:{...}, otp:{otp:"", UUID:"<id>", isValidationSuccessful:true} }
//   _validate → same shape; isValidationSuccessful reflects the Redis check,
//     and a failed check is HTTP 400 (egov-otp's status for a bad OTP)
//
// Env:
//   PORT (default 3030)
//   REDIS_URL (default redis://digit-redis:6379)
//   KAFKA_BROKERS (default digit-redpanda:9092)
//   EVENT_TOPIC (default complaints.domain.events)
//   OTP_TTL_SECONDS (default 600)
//   DEFAULT_TENANT_ID (default ke — used when request body omits tenantId)
//   STATIC_OTP (optional — when set, every _send returns this code
//     and _validate accepts it. Useful for dev / CI without flipping to
//     a separate mock. Mirrors CITIZEN_LOGIN_PASSWORD_OTP_FIXED_VALUE.)
//   EGOV_USER_HOST (default http://egov-user:8107 — used to resolve a
//     username to the account's mobile number when _send carries no
//     mobileNumber, as on the employee Forgot Password screen)

import express from 'express';
import { randomInt, randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { Kafka } from 'kafkajs';

const PORT = Number(process.env.PORT || 3030);
const REDIS_URL = process.env.REDIS_URL || 'redis://digit-redis:6379';
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'digit-redpanda:9092').split(',').map((s) => s.trim()).filter(Boolean);
const EVENT_TOPIC = process.env.EVENT_TOPIC || 'complaints.domain.events';
const OTP_TTL_SECONDS = Number(process.env.OTP_TTL_SECONDS || 600);
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'ke';
const STATIC_OTP = process.env.STATIC_OTP || null;
const REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX || 'otp:';
const EGOV_USER_HOST = (process.env.EGOV_USER_HOST || 'http://egov-user:8107').replace(/\/+$/, '');
const USER_LOOKUP_TIMEOUT_MS = 5000;

const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 3 });
redis.on('error', (e) => console.error('[redis] error:', e.message));

const kafka = new Kafka({ clientId: 'otp-publisher', brokers: KAFKA_BROKERS });
const producer = kafka.producer({ allowAutoTopicCreation: true });

const app = express();
app.use(express.json({ limit: '64kb' }));

const log = (level, msg, extra = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra }));

const mockOk = (extra = {}) => ({
  ResponseInfo: {
    apiId: 'Rainmaker',
    ver: '.01',
    ts: '',
    resMsgId: 'uief87324',
    msgId: '',
    status: 'successful',
  },
  otp: { otp: '', UUID: '', isValidationSuccessful: true, ...extra },
});

const generateOtp = () => {
  if (STATIC_OTP) return STATIC_OTP;
  // 6-digit, zero-padded
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
};

const keyFor = (mobile, tenantId) => `${REDIS_KEY_PREFIX}${tenantId}:${mobile}`;

const publishEvent = async ({ tenantId, mobile, otp, userType }) => {
  const eventId = randomUUID();
  const event = {
    eventId,
    eventType: 'OTP',
    eventTime: new Date().toISOString(),
    producer: 'otp-publisher',
    module: 'USER-OTP',
    eventName: 'OTP.SEND',
    entityType: 'OTP_CODE',
    entityId: eventId,
    tenantId,
    actor: { uuid: 'system', type: 'SYSTEM' },
    stakeholders: [
      {
        // novu-bridge's Stakeholder model uses fields: type, userId, mobile.
        // OTP is pre-account: the citizen doesn't have a DIGIT user yet.
        // We pass userId so the bridge's UserServiceClient lookup is
        // satisfied (set via OTP_RECIPIENT_USER_ID env — point at a
        // throwaway placeholder user that exists at the target tenant).
        type: 'RECIPIENT',
        userId: process.env.OTP_RECIPIENT_USER_ID || mobile,
        mobile,
      },
    ],
    // novu-bridge's DispatchPipelineService enforces workflow.toState as
    // required even for non-stateful events. Stub it so the OTP event
    // passes validation and reaches the OTP_SEND TemplateBinding.
    workflow: { fromState: null, toState: 'SENT', action: 'SEND' },
    context: { source: 'citizen-login' },
    data: { otp, userType: userType || 'CITIZEN' },
  };
  await producer.send({
    topic: EVENT_TOPIC,
    messages: [{ key: mobile, value: JSON.stringify(event) }],
  });
  return eventId;
};

const extractMobile = (body) => {
  const otp = body?.otp || body?.Otp || {};
  return (otp.mobileNumber || otp.identity || body?.mobileNumber || '').trim();
};
const extractTenant = (body) => {
  const otp = body?.otp || body?.Otp || {};
  return (otp.tenantId || body?.tenantId || DEFAULT_TENANT_ID).trim();
};
const extractType = (body) => {
  const otp = body?.otp || body?.Otp || {};
  return (otp.type || otp.userType || body?.userType || 'login').trim();
};
const extractUserName = (body) => {
  const otp = body?.otp || body?.Otp || {};
  return (otp.userName || body?.userName || '').trim();
};
const extractUserType = (body) => {
  const otp = body?.otp || body?.Otp || {};
  return (otp.userType || body?.userType || '').trim().toUpperCase();
};

// The employee Forgot Password screen sends the username only, never the
// mobile number. Resolve it the way the stock user-otp service does: search
// egov-user and deliver to the number registered on the account.
const lookupUser = async ({ userName, tenantId, userType }) => {
  const res = await fetch(`${EGOV_USER_HOST}/user/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName, tenantId, userType: userType || undefined }),
    signal: AbortSignal.timeout(USER_LOOKUP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`user search returned HTTP ${res.status}`);
  const { user = [] } = await res.json();
  return user[0] || null;
};

// Returns { mobile, tenantId } for the OTP recipient, or { status } when the
// request can't be served. egov-user validates a password-reset OTP against
// the account's own mobile number and tenantId, so a resolved user's values
// are what the Redis key must be built from.
const resolveRecipient = async (body) => {
  const mobile = extractMobile(body);
  const tenantId = extractTenant(body);
  if (mobile) return { mobile, tenantId };
  const userName = extractUserName(body);
  if (!userName) return { status: 400 };
  let user;
  try {
    user = await lookupUser({ userName, tenantId, userType: extractUserType(body) });
  } catch (e) {
    log('error', 'otp.user_lookup.failed', { tenantId, err: e.message });
    return { status: 502 };
  }
  const resolved = (user?.mobileNumber || '').trim();
  if (!resolved) {
    log('warn', 'otp.user_lookup.no_mobile', { tenantId, found: !!user });
    return { status: 400 };
  }
  return { mobile: resolved, tenantId: user.tenantId || tenantId };
};

app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));

app.post('/user-otp/v1/_send', async (req, res) => {
  const { mobile, tenantId, status } = await resolveRecipient(req.body);
  if (status) return res.status(status).json(mockOk({ isValidationSuccessful: false }));
  const otp = generateOtp();
  try {
    await redis.set(keyFor(mobile, tenantId), otp, 'EX', OTP_TTL_SECONDS);
    const eventId = await publishEvent({ tenantId, mobile, otp, userType: extractType(req.body) });
    log('info', 'otp.sent', { tenantId, mobile_redacted: mobile.replace(/.(?=.{2})/g, '*'), eventId });
    res.json(mockOk({ UUID: eventId }));
  } catch (e) {
    log('error', 'otp.send.failed', { err: e.message });
    // Mirror the legacy mock: still respond 200 (the SPA polls) so a transient
    // kafka/redis blip doesn't lock citizens out. SMS just won't land.
    res.json(mockOk());
  }
});

app.post('/otp/v1/_validate', async (req, res) => {
  const mobile = extractMobile(req.body);
  const tenantId = extractTenant(req.body);
  const supplied = (req.body?.otp?.otp || req.body?.otp?.Otp || req.body?.otp || '').toString().trim();
  if (!mobile || !supplied) return res.status(400).json(mockOk({ isValidationSuccessful: false }));
  if (STATIC_OTP && supplied === STATIC_OTP) {
    return res.json(mockOk({ isValidationSuccessful: true }));
  }
  try {
    const cached = await redis.get(keyFor(mobile, tenantId));
    const ok = cached && cached === supplied;
    if (ok) await redis.del(keyFor(mobile, tenantId)); // single-use
    // A failed check must be a 4xx, as egov-otp answers it: egov-user's
    // password-reset path discards the isValidationSuccessful flag and only
    // rejects when the validate call itself fails.
    res.status(ok ? 200 : 400).json(mockOk({ isValidationSuccessful: !!ok }));
  } catch (e) {
    log('error', 'otp.validate.failed', { err: e.message });
    res.status(500).json(mockOk({ isValidationSuccessful: false }));
  }
});

const start = async () => {
  await redis.connect();
  await producer.connect();
  log('info', 'otp-publisher.up', { port: PORT, topic: EVENT_TOPIC, ttl: OTP_TTL_SECONDS, static: !!STATIC_OTP });
  app.listen(PORT, '0.0.0.0');
};

const shutdown = async (sig) => {
  log('info', 'shutdown', { sig });
  try { await producer.disconnect(); } catch {}
  try { await redis.quit(); } catch {}
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch((e) => {
  console.error('startup failed:', e);
  process.exit(1);
});
