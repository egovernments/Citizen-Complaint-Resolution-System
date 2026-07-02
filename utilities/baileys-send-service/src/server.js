'use strict';

/**
 * baileys-send-service
 *
 * A minimal, concurrency-safe HTTP wrapper around a SINGLE Baileys WhatsApp
 * socket. It exists so novu-bridge's BaileysProviderStrategy can deliver
 * free-form WhatsApp messages for PGR config-driven notifications without
 * requiring an approved Twilio/Meta template.
 *
 *   POST /send    { "to": "+2547...", "text": "..." }  -> sends a WhatsApp message
 *   GET  /healthz                                       -> 200 when paired+open, 503 otherwise
 *   GET  /qr                                            -> current pairing QR (png or text) while unpaired
 *
 * Auth/session state lives under AUTH_DIR (default /data/baileys-auth) which is
 * a persisted volume, so a pairing survives container restarts. On
 * connection.close the socket auto-reconnects unless the disconnect reason is
 * `loggedOut` (re-pair required) — see README.md.
 *
 * Reference pattern: /root/baileys-test.js (the proven makeWASocket flow).
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
} = require('baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const QRCode = require('qrcode');
const pino = require('pino');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT || '3000', 10);
const AUTH_DIR = process.env.AUTH_DIR || '/data/baileys-auth';
// Optional bearer token. When set, /send (and /qr) require Authorization: Bearer <token>.
const SEND_TOKEN = process.env.SEND_TOKEN || '';
const RECONNECT_DELAY_MS = parseInt(process.env.RECONNECT_DELAY_MS || '5000', 10);

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// ---------------------------------------------------------------------------
// Single-socket state (concurrency-safe: one socket, guarded (re)connect)
// ---------------------------------------------------------------------------
let sock = null; // the live Baileys socket (null until connectToWhatsApp resolves)
let connectionState = 'connecting'; // 'connecting' | 'open' | 'close'
let latestQr = null; // raw QR string while unpaired; null once paired/open
let connecting = false; // guard so we never spin up two sockets at once
let saveCreds = null; // creds persister from useMultiFileAuthState

function isReady() {
  return sock !== null && connectionState === 'open';
}

/**
 * Establish (or re-establish) the single WhatsApp socket.
 * Guarded by `connecting` so concurrent callers/reconnect timers cannot
 * create a second socket.
 */
async function connectToWhatsApp() {
  if (connecting) {
    logger.debug('connectToWhatsApp called while already connecting; skipping');
    return;
  }
  connecting = true;

  try {
    const { state, saveCreds: persist } = await useMultiFileAuthState(AUTH_DIR);
    saveCreds = persist;

    sock = makeWASocket({
      auth: state,
      browser: Browsers.ubuntu('DIGIT'),
      logger,
      printQRInTerminal: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        // New pairing QR — cache it so GET /qr can serve it.
        latestQr = qr;
        logger.info('Pairing QR generated; scan it via GET /qr');
      }

      if (connection === 'open') {
        connectionState = 'open';
        latestQr = null; // paired — no QR to show anymore
        logger.info('WhatsApp connection open (paired and ready)');
      }

      if (connection === 'connecting') {
        connectionState = 'connecting';
      }

      if (connection === 'close') {
        connectionState = 'close';
        const statusCode =
          lastDisconnect && lastDisconnect.error instanceof Boom
            ? lastDisconnect.error.output.statusCode
            : lastDisconnect && lastDisconnect.error
            ? lastDisconnect.error.output && lastDisconnect.error.output.statusCode
            : undefined;

        logger.warn({ statusCode }, 'WhatsApp connection closed');

        // Datacenter / cloud IPs are frequently blocked by WhatsApp (HTTP 405).
        if (statusCode === 405) {
          logger.error(
            'Error 405: WhatsApp is blocking this IP (common on datacenter/cloud IPs). ' +
              'See README.md — pairing may need to be done from a residential IP.'
          );
        }

        if (statusCode === DisconnectReason.loggedOut) {
          // Session is gone — require a manual re-pair. Do NOT auto-reconnect
          // (it would just loop). Clear the socket; /qr will re-issue once the
          // auth dir is wiped and the service restarts (see README.md).
          logger.error(
            'Logged out. Re-pairing required: delete the auth volume and restart, then scan GET /qr.'
          );
          sock = null;
          // intentionally no reconnect
        } else {
          // Any other close (restartRequired after QR scan, timeouts, etc.) -> reconnect.
          logger.info(`Reconnecting in ${RECONNECT_DELAY_MS}ms...`);
          setTimeout(() => {
            connectToWhatsApp().catch((err) =>
              logger.error({ err }, 'Reconnect attempt failed')
            );
          }, RECONNECT_DELAY_MS);
        }
      }
    });
  } catch (err) {
    logger.error({ err }, 'Failed to establish WhatsApp socket; retrying');
    setTimeout(() => {
      connectToWhatsApp().catch((e) => logger.error({ err: e }, 'Retry failed'));
    }, RECONNECT_DELAY_MS);
  } finally {
    connecting = false;
  }
}

// ---------------------------------------------------------------------------
// Number formatting: E.164 / Kenyan local -> WhatsApp JID
// ---------------------------------------------------------------------------
/**
 * Normalize a phone number to a WhatsApp JID (`<digits>@s.whatsapp.net`).
 *
 * Handles common Kenyan input shapes:
 *   +254712345678  -> 254712345678@s.whatsapp.net  (E.164)
 *   254712345678   -> 254712345678@s.whatsapp.net
 *   0712345678     -> 254712345678@s.whatsapp.net  (drop leading 0, prepend 254)
 *   712345678      -> 254712345678@s.whatsapp.net  (bare 9-digit subscriber)
 *
 * @param {string} raw
 * @returns {string} JID
 * @throws {Error} when no usable digits remain
 */
function toWhatsAppJid(raw) {
  if (raw === undefined || raw === null) {
    throw new Error('phone number is required');
  }
  let digits = String(raw).replace(/\D/g, '');

  if (digits.length === 0) {
    throw new Error(`invalid phone number: "${raw}"`);
  }

  if (digits.startsWith('254')) {
    // already has Kenya country code
  } else if (digits.startsWith('0')) {
    // local format: drop the trunk 0, prepend Kenya code
    digits = '254' + digits.slice(1);
  } else if (digits.length === 9) {
    // bare 9-digit subscriber number (e.g. 7XXXXXXXX) -> prepend Kenya code
    digits = '254' + digits;
  }
  // else: assume it already carries some other country code; pass through.

  return `${digits}@s.whatsapp.net`;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '64kb' }));

function checkAuth(req, res) {
  if (!SEND_TOKEN) return true; // auth disabled
  const header = req.get('authorization') || '';
  const expected = `Bearer ${SEND_TOKEN}`;
  if (header !== expected) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return false;
  }
  return true;
}

// Human-facing pairing page: shows the QR, auto-refreshes it (Baileys rotates the
// QR every ~20s), and flips to "connected" once the phone scans it. Served at the
// root so it can be published behind a domain for browser-based login.
app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DIGIT WhatsApp pairing</title>
<style>
  body{font-family:system-ui,sans-serif;text-align:center;background:#0b141a;color:#e9edef;margin:0;padding:2rem}
  h1{font-size:1.3rem;font-weight:600} .card{max-width:420px;margin:1.5rem auto;background:#111b21;border-radius:14px;padding:1.5rem}
  img{width:280px;height:280px;background:#fff;border-radius:8px;padding:8px} .muted{color:#8696a0;font-size:.9rem}
  .ok{color:#00a884;font-size:1.1rem;font-weight:600} .state{margin-top:.5rem}
</style></head>
<body>
  <h1>DIGIT · Link WhatsApp (Baileys)</h1>
  <div class="card">
    <div id="content"><p class="muted">Loading QR…</p></div>
    <div class="state muted" id="state"></div>
  </div>
  <p class="muted">Open WhatsApp → Settings → Linked Devices → Link a device, then scan.</p>
<script>
async function tick(){
  try{
    const h = await fetch('/healthz').then(r=>r.json()).catch(()=>({}));
    const st = document.getElementById('state');
    if(h && h.ok){
      document.getElementById('content').innerHTML='<p class="ok">✅ Connected — WhatsApp is linked.</p>';
      st.textContent='state: '+(h.state||'open'); return; // stop refreshing
    }
    st.textContent='state: '+((h&&h.state)||'connecting');
    document.getElementById('content').innerHTML='<img alt="QR" src="/qr?ts='+Date.now()+'">';
  }catch(e){ document.getElementById('state').textContent='error: '+e; }
  setTimeout(tick, 5000);
}
tick();
</script>
</body></html>`);
});

// Liveness/readiness: 200 only when the socket is paired and open.
app.get('/healthz', (req, res) => {
  if (isReady()) {
    return res.status(200).json({ ok: true, state: connectionState });
  }
  return res.status(503).json({
    ok: false,
    state: connectionState,
    paired: sock !== null,
    qrAvailable: latestQr !== null,
  });
});

// Pairing QR. Serves PNG by default; `?format=text` (or Accept: text/plain)
// returns a terminal-friendly ASCII QR (handy over an SSH tunnel + curl).
app.get('/qr', async (req, res) => {
  if (!checkAuth(req, res)) return;

  if (isReady()) {
    return res.status(409).json({ ok: false, error: 'already paired' });
  }
  if (!latestQr) {
    return res
      .status(503)
      .json({ ok: false, error: 'no QR available yet; try again shortly' });
  }

  const wantsText =
    req.query.format === 'text' ||
    (req.get('accept') || '').includes('text/plain');

  try {
    if (wantsText) {
      const ascii = await QRCode.toString(latestQr, { type: 'terminal', small: true });
      res.type('text/plain').send(ascii);
    } else {
      const png = await QRCode.toBuffer(latestQr, { type: 'png', width: 320 });
      res.type('png').send(png);
    }
  } catch (err) {
    logger.error({ err }, 'Failed to render QR');
    res.status(500).json({ ok: false, error: 'failed to render QR' });
  }
});

// Send a free-form WhatsApp message.
app.post('/send', async (req, res) => {
  if (!checkAuth(req, res)) return;

  const { to, text } = req.body || {};
  if (!to || typeof text !== 'string' || text.length === 0) {
    return res
      .status(400)
      .json({ ok: false, error: 'body must include {to, text} (non-empty text)' });
  }

  if (!isReady()) {
    return res.status(503).json({
      ok: false,
      error: 'whatsapp socket not ready',
      state: connectionState,
    });
  }

  let jid;
  try {
    jid = toWhatsAppJid(to);
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }

  try {
    const result = await sock.sendMessage(jid, { text });
    const messageId = result && result.key ? result.key.id : null;
    logger.info({ jid, messageId }, 'WhatsApp message sent');
    return res.status(200).json({ ok: true, jid, messageId });
  } catch (err) {
    logger.error({ err, jid }, 'WhatsApp send failed');
    return res
      .status(502)
      .json({ ok: false, error: 'send failed', detail: err.message });
  }
});

const server = app.listen(PORT, () => {
  logger.info(`baileys-send-service listening on :${PORT} (auth dir: ${AUTH_DIR})`);
  connectToWhatsApp().catch((err) =>
    logger.error({ err }, 'Initial WhatsApp connection failed')
  );
});

// Graceful shutdown
function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  // Force-exit if the socket keeps the process alive too long.
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, toWhatsAppJid };
