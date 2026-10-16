'use strict';

const { axios, BaseProvider, CasingEnum, ChannelTypeEnum, BaseSmsHandler, redact } = require('./novu');

const PROVIDER_ID = 'ozeki';

/**
 * Ozeki SMS Gateway, a customer-hosted HTTP/SMPP gateway common in on-premise
 * installs.
 *
 * Ozeki speaks JSON, so a `generic-sms` integration can physically deliver through
 * it. What `generic-sms` cannot do is tell a success from a failure: it only
 * extracts `idPath` from the reply, and Ozeki reports failures as **HTTP 200** with
 * an error envelope. A dedicated provider reads `response_code` and `failed_count`
 * and fails honestly.
 *
 * Wire contract (vendor docs and the official Java client
 * `ozekisms/java-send-sms-http-rest-ozeki`):
 *
 * - `POST http://<gateway>:9509/api?action=sendmsg` (HTTPS on :9508), Basic auth
 *   against the gateway's HTTP API user.
 * - Body `{"messages":[{"message_id","to_address","text"}]}`, one entry per
 *   recipient. Other fields are optional and omitted when unset.
 * - Reply `{"response_code":"SUCCESS","data":{"success_count":1,"failed_count":0,
 *   "messages":[{"message_id":"<echoed>","status":"SUCCESS"}]}}`. `message_id` is
 *   echoed back, so it is the correlation key.
 * - An authentication failure returns HTTP 200 with a messages-less envelope, which
 *   is why the envelope, not the status code, decides the outcome.
 * - There is no status-query action and no JSON-API delivery webhook, so a success
 *   here means submitted, not delivered.
 */
class OzekiSmsProvider extends BaseProvider {
  id = PROVIDER_ID;
  channelType = ChannelTypeEnum.SMS;
  // Ozeki's own fields are snake_case (`to_address`, `message_id`).
  casing = CasingEnum.SNAKE_CASE;
  httpClient = axios.create();

  constructor(config) {
    super();
    this.config = config;
  }

  async sendMessage(options, bridgeProviderData = {}) {
    const messageId = options.id || `novu-${Date.now()}`;
    const sender = options.from || this.config.from;

    const payload = this.transform(bridgeProviderData, {
      messages: [
        {
          message_id: messageId,
          to_address: options.to,
          text: options.content,
          // The wire field exists in the official client, but whether the SMSC honours
          // a per-message sender is route-dependent.
          ...(sender ? { from_address: sender } : {}),
        },
      ],
    });

    const { data } = await this.httpClient.post(this.config.baseUrl || '', payload.body, {
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeader(),
        ...payload.headers,
      },
      // The gateway answers 200 for rejections too, so read the envelope instead.
      validateStatus: () => true,
    });

    return {
      id: parseMessageId(data, messageId, [this.config.username, this.config.password]),
      date: new Date().toISOString(),
    };
  }

  authHeader() {
    if (!this.config.username && !this.config.password) {
      return {};
    }
    const token = Buffer.from(`${this.config.username ?? ''}:${this.config.password ?? ''}`).toString('base64');
    return { Authorization: `Basic ${token}` };
  }
}

/**
 * The envelope decides the outcome: `response_code` must be SUCCESS, nothing may
 * have failed, and the echoed per-message entry must itself be SUCCESS. The gateway's
 * own words go into the error, and so into Novu's activity feed, with the
 * credentials masked.
 */
function parseMessageId(body, sentMessageId, secrets = []) {
  const gateway = (value, fallback) => (value == null ? fallback : redact(value, secrets));
  const responseCode = body?.response_code;
  const reason = (fallback) => gateway(body?.response_msg, fallback);

  if (!body || typeof responseCode !== 'string' || responseCode.toUpperCase() !== 'SUCCESS') {
    throw new Error(
      `Ozeki request failed${responseCode ? ` (${gateway(responseCode)})` : ''}: ${reason('unrecognised response')}`
    );
  }

  const failed = body.data?.failed_count ?? 0;
  if (failed > 0) {
    throw new Error(`Ozeki rejected ${failed} of ${body.data?.total_count ?? failed} messages: ${reason('no reason given')}`);
  }

  const message = body.data?.messages?.[0];
  if (!message) {
    // An authentication failure lands here: HTTP 200, no messages in the envelope.
    throw new Error(`Ozeki returned no message result: ${reason('empty data.messages')}`);
  }

  if (typeof message.status === 'string' && message.status.toUpperCase() !== 'SUCCESS') {
    throw new Error(`Ozeki rejected the message (${gateway(message.status)}): ${reason('no reason given')}`);
  }

  return message.message_id || sentMessageId;
}

class OzekiHandler extends BaseSmsHandler {
  constructor() {
    super(PROVIDER_ID, ChannelTypeEnum.SMS);
  }

  buildProvider(credentials) {
    this.provider = new OzekiSmsProvider({
      baseUrl: credentials.baseUrl,
      username: credentials.user,
      password: credentials.password,
      from: credentials.from,
    });
  }
}

module.exports = { PROVIDER_ID, OzekiSmsProvider, OzekiHandler };
