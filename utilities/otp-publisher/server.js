// otp-publisher — Kong forwards /user-otp/v1/_send + /otp/v1/_validate here.
//
// Replaces the legacy Kong `request-termination` mock with a real
// generator that:
//   1. mints a 6-digit OTP
//   2. caches `(otp, mobileNumber)` in Redis with a TTL (default 10 min)
//   3. publishes a fully-rendered `OTP.SEND` event (novu-bridge envelope v1,
//      eventType OTP) to its own topic (`otp.send.events`); novu-bridge delivers
//      it exactly like a complaint notification — no OTP-specific bridge code.
//
// On `_validate`, looks up the cached OTP and confirms.
//
// Response shapes mirror the previous Kong mock so the digit-ui SPA
// doesn't notice anything has changed:
//   _send  → { ResponseInfo:{...}, otp:{otp:"", UUID:"<id>", isValidationSuccessful:true} }
//   _validate → same shape; isValidationSuccessful reflects the Redis check
//
// Env:
//   PORT (default 3030)
//   REDIS_URL (default redis://digit-redis:6379)
//   KAFKA_BROKERS (default digit-redpanda:9092)
//   EVENT_TOPIC (default otp.send.events)
//   OTP_COUNTRY_CODE (e.g. +254; prepended to national numbers, leading zeros dropped)
//   OTP_MESSAGE_TEMPLATE ({otp} and {minutes} placeholders)
//   OTP_TTL_SECONDS (default 600)
//   DEFAULT_TENANT_ID (default ke — used when request body omits tenantId)
//   STATIC_OTP (optional — when set, every _send returns this code
//     and _validate accepts it. Useful for dev / CI without flipping to
//     a separate mock. Mirrors CITIZEN_LOGIN_PASSWORD_OTP_FIXED_VALUE.)

import express from 'express';
import { randomInt, randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { Kafka } from 'kafkajs';

const PORT = Number(process.env.PORT || 3030);
const REDIS_URL = process.env.REDIS_URL || 'redis://digit-redis:6379';
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'digit-redpanda:9092').split(',').map((s) => s.trim()).filter(Boolean);
const EVENT_TOPIC = process.env.EVENT_TOPIC || 'otp.send.events';
const OTP_COUNTRY_CODE = (process.env.OTP_COUNTRY_CODE || '').trim();
const OTP_MESSAGE_TEMPLATE = process.env.OTP_MESSAGE_TEMPLATE
  || 'DIGIT: Your one-time login code is {otp}. It expires in {minutes} minutes. Do not share this code.';
const OTP_TTL_SECONDS = Number(process.env.OTP_TTL_SECONDS || 600);
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'ke';
const STATIC_OTP = process.env.STATIC_OTP || null;
const REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX || 'otp:';

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

// E.164 for the gateway: keep a '+' number as-is; otherwise prepend the configured
// country code and drop national leading zeros. With no country code configured the
// number is sent as given (the bridge does not guess one).
const toE164 = (mobile) => {
  const m = String(mobile || '').trim();
  if (m.startsWith('+') || !OTP_COUNTRY_CODE) return m;
  return OTP_COUNTRY_CODE + m.replace(/^0+/, '');
};

const renderBody = (otp) => OTP_MESSAGE_TEMPLATE
  .replace('{otp}', otp)
  .replace('{minutes}', String(Math.max(1, Math.round(OTP_TTL_SECONDS / 60))));

const publishEvent = async ({ tenantId, mobile, otp, userType }) => {
  const eventId = randomUUID();
  const phone = toE164(mobile);
  // novu-bridge envelope v1: the message is rendered HERE; the bridge only delivers.
  const event = {
    schemaVersion: '1',
    eventId,
    eventType: 'OTP',
    eventTime: new Date().toISOString(),
    producer: 'otp-publisher',
    module: 'USER-OTP',
    eventName: 'OTP.SEND',
    entityType: 'OTP_CODE',
    entityId: eventId,
    tenantId,
    channel: 'SMS',
    // OTP precedes user-create, so there is no DIGIT uuid yet: key the subscriber on the phone.
    subscriberId: `${tenantId}:${phone}`,
    contact: { type: 'CITIZEN', phone, locale: 'en_IN' },
    renderedBody: renderBody(otp),
    // Unique per send: a resend must be a new dispatch-log row, not an upsert of the last one.
    transactionId: `OTP:${tenantId}:${phone}:${eventId}`,
    data: { userType: userType || 'CITIZEN' },
  };
  await producer.send({
    topic: EVENT_TOPIC,
    messages: [{ key: phone, value: JSON.stringify(event) }],
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

app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));

app.post('/user-otp/v1/_send', async (req, res) => {
  const mobile = extractMobile(req.body);
  const tenantId = extractTenant(req.body);
  if (!mobile) return res.status(400).json(mockOk({ isValidationSuccessful: false }));
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
    res.json(mockOk({ isValidationSuccessful: !!ok }));
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
