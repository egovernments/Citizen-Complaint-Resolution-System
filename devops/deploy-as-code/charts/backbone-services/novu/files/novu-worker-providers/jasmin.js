'use strict';

const { axios, BaseProvider, CasingEnum, ChannelTypeEnum, BaseSmsHandler, redactedSnippet } = require('./novu');

const PROVIDER_ID = 'jasmin';

/**
 * GSM 03.38 default alphabet plus its extension table. Text made only of these
 * characters fits SMPP data coding 0; anything else needs UCS-2 (coding 8).
 */
const GSM_7_CHARACTERS = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡' +
    'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà' +
    '\f^{}\\[~]|€'
);

/**
 * UTF-16BE as hex: what Jasmin's `hex-content` carries for coding 8. UCS-2 proper is
 * the BMP subset; characters beyond it (emoji) go out as surrogate pairs, which is
 * what handsets decode.
 */
function toUcs2Hex(text) {
  return Buffer.from(text, 'utf16le').swap16().toString('hex');
}

function fitsGsm7(text) {
  for (const character of text) {
    if (!GSM_7_CHARACTERS.has(character)) {
      return false;
    }
  }
  return true;
}

/**
 * Jasmin SMS Gateway, an open-source SMPP gateway commonly self-hosted by operators
 * and government deployments. Its HTTP API listens on port 1401 by default and
 * answers in **plain text**, which is why it needs a provider of its own rather
 * than riding `generic-sms`: Jasmin accepts a JSON request body, but never replies
 * with JSON, and `generic-sms` resolves the message id by walking a dot-path into a
 * parsed object.
 *
 * Wire contract (verified against `jasmin/protocols/http/endpoints/send.py`):
 *
 * - `render_GET` delegates to `render_POST`, so both verbs work. This provider posts
 *   form-encoded so the credentials stay out of the query string, and therefore out
 *   of proxy and access logs.
 * - `to`, `username`, `password` and `dlr` are mandatory; `dlr` must be exactly
 *   `yes` or `no`, so it is always sent.
 * - Success is HTTP 200 with the body `Success "<msgid>"`. Failures carry a real
 *   status code (400 bad arguments, 403 authentication, 412 no route or no bound
 *   connector, 500 server) and the body `Error "<message>"`.
 * - `coding` is the SMPP data coding and defaults to 0 (GSM 03.38). Non-Latin
 *   alphabets need `coding: 8` (UCS-2), which also shortens a single segment from
 *   160 to 70 characters.
 * - Jasmin does not transcode for any coding but 0. `route_routable` converts
 *   `content` from UTF-8 to GSM 03.38 when coding is 0, and otherwise forwards the
 *   bytes as they arrived, so UTF-8 `content` labelled coding 8 reaches the handset
 *   garbled while Jasmin answers Success. For coding 8 this provider therefore sends
 *   `hex-content`, the UTF-16BE bytes in hex, which Jasmin unhexlifies into the PDU
 *   as is (`content` and `hex-content` together are a 400). `hex-content` needs the
 *   user's `set_hex_content` MT authorization, which Jasmin grants by default.
 *
 * Config: baseUrl, username, password, from; optional coding (0 | 8; when unset it is
 * chosen per message), dlr ('yes' asks for a receipt), dlrUrl, dlrLevel.
 */
class JasminSmsProvider extends BaseProvider {
  id = PROVIDER_ID;
  channelType = ChannelTypeEnum.SMS;
  casing = CasingEnum.CAMEL_CASE;
  httpClient = axios.create();

  constructor(config) {
    super();
    this.config = config;
  }

  async sendMessage(options, bridgeProviderData = {}) {
    const wantsDlr = this.config.dlr === 'yes' && Boolean(this.config.dlrUrl);

    const payload = this.transform(bridgeProviderData, {
      username: this.config.username,
      password: this.config.password,
      to: options.to,
      from: options.from || this.config.from,
      content: options.content,
      // The integration's credentials carry no coding field, so an unset coding is
      // the normal case: pick UCS-2 whenever the text leaves GSM 03.38 (Amharic,
      // Arabic, Devanagari, emoji...), or Jasmin would mangle it on the air.
      coding: this.config.coding ?? (fitsGsm7(options.content) ? '0' : '8'),
      // Mandatory in Jasmin's own field spec, and only ever `yes` or `no`.
      dlr: wantsDlr ? 'yes' : 'no',
      ...(wantsDlr ? { 'dlr-url': this.config.dlrUrl, 'dlr-level': this.config.dlrLevel ?? '3' } : {}),
    });

    // After the passthrough merge, so an overridden coding or content is encoded too.
    const body = { ...payload.body };
    if (String(body.coding) === '8' && body.content != null && body['hex-content'] == null) {
      body['hex-content'] = toUcs2Hex(String(body.content));
      delete body.content;
    }

    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined && value !== null) {
        form.append(key, String(value));
      }
    }

    const { data } = await this.httpClient.post(this.config.baseUrl || '', form, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...payload.headers,
      },
      // Jasmin answers in plain text; without this axios would try to parse JSON.
      responseType: 'text',
      // Read the `Error "..."` body ourselves rather than surfacing a bare status.
      validateStatus: () => true,
    });

    return { id: parseMessageId(data, [this.config.username, this.config.password]), date: new Date().toISOString() };
  }
}

/**
 * `Success "<msgid>"` on acceptance; `Error "<message>"` otherwise. Gateway text goes
 * into the error (and Novu's activity feed) with the credentials masked.
 */
function parseMessageId(body, secrets = []) {
  const trimmed = typeof body === 'string' ? body.trim() : '';
  const success = /^Success\s+"(.*)"$/s.exec(trimmed);
  if (success) {
    return success[1];
  }
  const failure = /^Error\s+"(.*)"$/s.exec(trimmed);
  throw new Error(`Jasmin request failed: ${redactedSnippet(failure ? failure[1] : trimmed, secrets) || 'empty response'}`);
}

class JasminHandler extends BaseSmsHandler {
  constructor() {
    super(PROVIDER_ID, ChannelTypeEnum.SMS);
  }

  buildProvider(credentials) {
    this.provider = new JasminSmsProvider({
      baseUrl: credentials.baseUrl,
      username: credentials.user,
      password: credentials.password,
      from: credentials.from,
    });
  }
}

module.exports = { PROVIDER_ID, JasminSmsProvider, JasminHandler, fitsGsm7, toUcs2Hex };
