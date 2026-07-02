# baileys-send-service

A minimal HTTP service that wraps a **single** [Baileys](https://github.com/WhiskeySockets/Baileys)
WhatsApp socket and exposes a `POST /send` endpoint. It exists so that
**novu-bridge's `BaileysProviderStrategy`** can deliver **free-form** WhatsApp
messages for PGR config-driven notifications — without an approved Twilio/Meta
WhatsApp template.

It is intentionally tiny: PGR already renders and localizes the message body,
novu-bridge already decides routing/tracking. This service only takes
`{ to, text }` and pushes it onto an already-paired WhatsApp session.

## Endpoints

| Method | Path       | Purpose |
|--------|------------|---------|
| `POST` | `/send`    | Send a free-form WhatsApp message. Body: `{ "to": "+2547...", "text": "..." }` |
| `GET`  | `/healthz` | `200` only when the socket is **paired and open**; `503` otherwise (use for Docker/k8s health). |
| `GET`  | `/qr`      | Current pairing QR while **unpaired**. PNG by default; `?format=text` (or `Accept: text/plain`) for a terminal/ASCII QR. `409` once paired. |

`/send` and `/qr` honor an optional bearer token (see `SEND_TOKEN`).

### Example

```bash
curl -X POST http://localhost:3000/send \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $SEND_TOKEN" \
  -d '{"to":"+254712345678","text":"Your complaint BMT-2026-000123 has been assigned."}'
# -> {"ok":true,"jid":"254712345678@s.whatsapp.net","messageId":"..."}
```

## Number formatting (Kenya)

`to` is normalized to a WhatsApp JID (`<digits>@s.whatsapp.net`):

| Input             | JID                              |
|-------------------|----------------------------------|
| `+254712345678`   | `254712345678@s.whatsapp.net`    |
| `254712345678`    | `254712345678@s.whatsapp.net`    |
| `0712345678`      | `254712345678@s.whatsapp.net`    (drops trunk `0`, prepends `254`) |
| `712345678`       | `254712345678@s.whatsapp.net`    (bare 9-digit subscriber → prepends `254`) |

Numbers that already carry a non-Kenya country code are passed through unchanged.

## Environment

| Var                  | Default            | Notes |
|----------------------|--------------------|-------|
| `PORT`               | `3000`             | HTTP listen port. |
| `AUTH_DIR`           | `/data/baileys-auth` | Baileys `useMultiFileAuthState` directory. **Must be on a persisted volume** so the pairing survives restarts. |
| `SEND_TOKEN`         | _(empty)_          | Optional bearer token. When set, `/send` and `/qr` require `Authorization: Bearer <token>`. **Set this in any non-sandbox / shared deployment** (Bomet env makes it mandatory). |
| `RECONNECT_DELAY_MS` | `5000`             | Delay before auto-reconnect after a non-`loggedOut` disconnect. |
| `LOG_LEVEL`          | `info`             | pino log level. |

The container declares a `VOLUME ["/data"]`. In compose, mount a named volume
(e.g. `baileys_auth_data:/data`) so the session persists.

## Pairing (one-time, via SSH tunnel)

The WhatsApp session must be paired once by scanning a QR with the WhatsApp
mobile app (Linked Devices). The QR is served on `/qr` and should **never** be
exposed on a public port — pair over an SSH tunnel.

```bash
# 1. Start the service (fresh /data → it will emit a pairing QR).
#    On the server, the container listens on (host) :13040 -> (container) :3000.

# 2. From your laptop, tunnel the service port to localhost:
ssh -L 3000:127.0.0.1:13040 egov-bomet

# 3a. Open the PNG QR in a browser:
#       http://localhost:3000/qr        (add ?token=... only if you wire query auth;
#                                         otherwise use the header form below)
#     or save it:
curl -H "Authorization: Bearer $SEND_TOKEN" http://localhost:3000/qr -o qr.png && open qr.png

# 3b. ...or print an ASCII QR straight in the terminal:
curl -H "Authorization: Bearer $SEND_TOKEN" "http://localhost:3000/qr?format=text"

# 4. WhatsApp (the dedicated number) → Settings → Linked Devices →
#    "Link a device" → scan the QR.

# 5. Confirm pairing:
curl http://localhost:3000/healthz      # -> {"ok":true,"state":"open"}
```

After a successful scan, Baileys persists creds under `AUTH_DIR` and the
service auto-reconnects on subsequent restarts — no re-scan needed.

## Re-pairing (after logout)

If WhatsApp invalidates the session (you removed the linked device, or the
service logs `Logged out`), the socket is dropped and **not** auto-reconnected
(reconnecting would just loop). To re-pair:

1. Stop the service.
2. Wipe the auth volume contents (`AUTH_DIR`, e.g. `rm -rf /data/baileys-auth/*`).
3. Start the service and repeat the pairing steps above.

## ⚠️ Caveats — unofficial API & datacenter IP block

- **Unofficial WhatsApp API.** Baileys is a reverse-engineered WhatsApp Web
  client. This violates WhatsApp's ToS and the paired **number can be banned**.
  Use a **dedicated** WhatsApp number you can afford to lose. This is an accepted
  interim approach (design D7 / §6.3); the official WhatsApp Business API is the
  eventual target.
- **Datacenter / cloud IPs are frequently blocked (HTTP 405).** WhatsApp often
  refuses connections from datacenter IP ranges with `connection.close` carrying
  **status code 405**. The service logs this explicitly. If pairing fails with
  405 on the server (e.g. the Hetzner box), pair from a **residential IP**
  (or via a residential proxy) and then ship the resulting `AUTH_DIR` contents
  to the server's volume. Validate that the paired session actually stays
  `open` on the target host before relying on it.
- `/healthz` returns `503` while unpaired or reconnecting — wire alerting on a
  sustained non-`200` (or a `Logged out` log line) so a dropped session is noticed.

## Local run (without Docker)

```bash
cd utilities/baileys-send-service
npm install
AUTH_DIR=./data/baileys-auth PORT=3000 npm start
```

## Build

```bash
docker build -t baileys-send-service:local utilities/baileys-send-service
docker run --rm -p 3000:3000 -v baileys_auth_data:/data baileys-send-service:local
```
