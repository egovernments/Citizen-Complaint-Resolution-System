'use strict';

const { axios, BaseProvider, CasingEnum, ChannelTypeEnum, BaseSmsHandler, redactedSnippet } = require('./novu');

const PROVIDER_ID = 'smscountry';
const DEFAULT_BASE_URL = 'http://api.smscountry.com/SMSCwebservice_bulk.aspx';

/**
 * SMSCountry's legacy bulk API.
 *
 * SMSCountry runs two APIs. This provider targets the legacy one, which most panel
 * accounts are provisioned on: it takes **form-encoded parameters** and answers in
 * **plain text**. The newer REST v0.1 JSON API is not covered here.
 *
 * Two behaviours of this gateway drive the implementation:
 *
 * - **HTTP 200 is not success.** A malformed request comes back 200 carrying an
 *   ASP.NET error page. Only a body starting `OK:` means the message was accepted,
 *   so the status code is never used to decide the outcome.
 * - **Accepted is not delivered.** A message the operator later drops (an
 *   unregistered DLT template being the common case) still returns `OK:<jobid>`.
 *   The id returned here therefore means queued; the gateway's delivery report is
 *   the only proof of delivery.
 */
class SmsCountryProvider extends BaseProvider {
  id = PROVIDER_ID;
  channelType = ChannelTypeEnum.SMS;
  // The gateway's own parameter names are irregular (`User`, `passwd`, `mobilenumber`),
  // so no casing is faithful to it. The known parameters are written out verbatim
  // below; this only applies to bridge-supplied data.
  casing = CasingEnum.CAMEL_CASE;
  httpClient = axios.create();

  constructor(config) {
    super();
    this.config = config;
  }

  async sendMessage(options, bridgeProviderData = {}) {
    const payload = this.transform(bridgeProviderData, {
      User: this.config.user,
      passwd: this.config.password,
      mobilenumber: toNationalDigits(options.to),
      message: options.content,
      sid: options.from || this.config.from,
      // N = normal (GSM-7) text. DR = Y asks the gateway for a delivery report.
      mtype: 'N',
      DR: 'Y',
    });

    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(payload.body)) {
      if (value !== undefined && value !== null) {
        form.append(key, String(value));
      }
    }

    const { data } = await this.httpClient.post(this.config.baseUrl || DEFAULT_BASE_URL, form, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...payload.headers,
      },
      // The reply is plain text; without this axios would try to parse it as JSON.
      responseType: 'text',
      // Every status goes through parseJobId, which masks the credentials: a rejected
      // non-2xx would carry the raw page (an ASP.NET error page echoes User/passwd) as
      // error.response.data, which Novu stores verbatim in its execution details.
      validateStatus: () => true,
    });

    return { id: parseJobId(data, [this.config.user, this.config.password]), date: new Date().toISOString() };
  }
}

/**
 * `OK:<jobid>` is the only accepted reply. Anything else (an error string, an HTML
 * error page, an empty body) is a failure whatever the HTTP status, which this
 * gateway reports as 200 either way. The reply goes into the error, and so into
 * Novu's activity feed, only with the panel credentials masked: an ASP.NET error
 * page can echo the posted form.
 */
function parseJobId(body, secrets = []) {
  const trimmed = typeof body === 'string' ? body.trim() : '';
  if (!trimmed.startsWith('OK:')) {
    throw new Error(`SMSCountry request failed: ${redactedSnippet(trimmed, secrets) || 'empty response'}`);
  }
  return trimmed.slice('OK:'.length).trim();
}

/** The gateway wants the country code with no leading `+`. */
function toNationalDigits(phone) {
  return (phone || '').replace(/[^0-9]/g, '');
}

class SmsCountryHandler extends BaseSmsHandler {
  constructor() {
    super(PROVIDER_ID, ChannelTypeEnum.SMS);
  }

  buildProvider(credentials) {
    this.provider = new SmsCountryProvider({
      user: credentials.user,
      password: credentials.password,
      from: credentials.from,
      baseUrl: credentials.baseUrl,
    });
  }
}

module.exports = { PROVIDER_ID, SmsCountryProvider, SmsCountryHandler };
