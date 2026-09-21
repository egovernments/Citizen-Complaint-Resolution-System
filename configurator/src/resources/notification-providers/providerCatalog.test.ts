import { describe, it, expect } from 'vitest';
import {
  FALLBACK_CATALOG,
  buildCredentials,
  createProviderBody,
  credLabelKey,
  findProviderType,
  findSelectedIntegration,
  groupCatalogByChannel,
  integrationChannel,
  integrationKey,
  integrationLabel,
  matchesProviderSelection,
  missingRequiredFields,
  normalizeCatalog,
  providerChoicesForChannel,
  providerTypeLabelKey,
  rowChannel,
  type ProviderType,
} from './providerCatalog';

const RAW_CATALOG = {
  data: [
    {
      type: 'twilio-sms',
      label: 'Twilio SMS',
      channel: 'SMS',
      transport: 'novu',
      novuProviderId: 'twilio',
      supportsVerify: true,
      supportsTestSend: true,
      credentialFields: [
        { key: 'accountSid', label: 'Account SID', type: 'text', required: true, placeholder: 'ACxxx' },
        { key: 'token', label: 'Auth Token', type: 'password', required: true },
      ],
    },
    {
      type: 'twilio-whatsapp',
      label: 'Twilio WhatsApp',
      channel: 'whatsapp',
      transport: 'novu',
      novuProviderId: 'twilio',
      supportsVerify: true,
      supportsTestSend: true,
      credentialFields: [{ key: 'from', label: 'From', type: 'text', required: true }],
    },
    {
      type: 'ozeki',
      label: 'Ozeki SMS Gateway',
      channel: 'SMS',
      transport: 'bridge-adapter',
      novuProviderId: '',
      supportsVerify: false,
      supportsTestSend: true,
      credentialFields: [
        { key: 'baseUrl', label: 'Gateway URL', type: 'text', required: true, help: 'e.g. http://10.0.0.5:9509' },
        { key: 'useHttps', label: 'Use HTTPS', type: 'checkbox' },
      ],
    },
    {
      type: 'smtp',
      label: 'SMTP',
      channel: 'EMAIL',
      transport: 'novu',
      novuProviderId: 'nodemailer',
      supportsVerify: true,
      supportsTestSend: true,
      credentialFields: [{ key: 'host', label: 'SMTP Host', type: 'text', required: true }],
    },
  ],
};

const catalog = normalizeCatalog(RAW_CATALOG);

describe('normalizeCatalog', () => {
  it('reads the {data:[...]} envelope and upper-cases the channel', () => {
    expect(catalog.map((p) => p.type)).toEqual(['twilio-sms', 'twilio-whatsapp', 'ozeki', 'smtp']);
    expect(findProviderType(catalog, 'twilio-whatsapp')?.channel).toBe('WHATSAPP');
  });

  it('defaults missing flags conservatively: no support unless the bridge says so', () => {
    const ozeki = findProviderType(catalog, 'ozeki')!;
    expect(ozeki.supportsVerify).toBe(false);
    expect(ozeki.supportsTestSend).toBe(true);
    expect(ozeki.transport).toBe('bridge-adapter');
    // `required` absent -> not required; unknown field type -> text.
    expect(ozeki.credentialFields[1]).toMatchObject({ key: 'useHttps', type: 'checkbox', required: false });
    expect(ozeki.credentialFields[0].help).toMatch(/9509/);
  });

  it('drops entries that could not be rendered rather than showing a broken row', () => {
    const out = normalizeCatalog({
      data: [
        { label: 'no type', channel: 'SMS' },
        { type: 'weird', channel: 'PIGEON' },
        { type: 'ok', channel: 'SMS', credentialFields: [{ label: 'no key' }, { key: 'a', label: 'A' }] },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].credentialFields.map((f) => f.key)).toEqual(['a']);
    expect(out[0].label).toBe('ok');
  });

  it('accepts a bare array and survives junk', () => {
    expect(normalizeCatalog([{ type: 'x', channel: 'EMAIL' }])).toHaveLength(1);
    expect(normalizeCatalog(null)).toEqual([]);
    expect(normalizeCatalog({ data: 'nope' })).toEqual([]);
  });
});

describe('groupCatalogByChannel', () => {
  it('groups in SMS, WhatsApp, Email order and drops empty groups', () => {
    const groups = groupCatalogByChannel(catalog);
    expect(groups.map((g) => g.channel)).toEqual(['SMS', 'WHATSAPP', 'EMAIL']);
    expect(groups[0].types.map((t) => t.type)).toEqual(['twilio-sms', 'ozeki']);
    expect(groupCatalogByChannel(catalog.filter((p) => p.channel === 'EMAIL')).map((g) => g.channel)).toEqual(['EMAIL']);
  });
});

describe('integration <-> catalog resolution', () => {
  const twilioSms = { _id: '1', channel: 'sms', providerId: 'twilio', identifier: 'twilio-sms-1', name: 'Twilio prod', type: 'twilio-sms', active: true };
  const twilioWa = { _id: '2', channel: 'sms', providerId: 'twilio', identifier: 'wa-1', name: 'WA prod', type: 'twilio-whatsapp', active: true };
  const legacyWa = { _id: '3', channel: 'sms', providerId: 'twilio', identifier: 'whatsapp-legacy', name: 'old', type: null, active: true };
  const smtp = { _id: '4', channel: 'email', providerId: 'nodemailer', identifier: 'smtp-1', type: 'smtp', active: false };

  it('trusts the catalog type over the legacy identifier marker', () => {
    // Novu stores WhatsApp as an `sms` integration; without a type the marker is all we have.
    expect(integrationChannel(twilioWa, catalog)).toBe('WHATSAPP');
    expect(integrationChannel(legacyWa, catalog)).toBe('WHATSAPP');
    expect(integrationChannel(twilioSms, catalog)).toBe('SMS');
    expect(integrationChannel(smtp, catalog)).toBe('EMAIL');
    expect(rowChannel({ channel: 'sms', identifier: 'plain' })).toBe('SMS');
  });

  it('keys a selection by identifier and matches ids as a fallback', () => {
    expect(integrationKey(twilioSms)).toBe('twilio-sms-1');
    expect(integrationKey({ _id: 'only-id' })).toBe('only-id');
    expect(matchesProviderSelection(twilioSms, 'TWILIO-SMS-1')).toBe(true);
    expect(matchesProviderSelection(twilioSms, '1')).toBe(true);
    expect(matchesProviderSelection(twilioSms, '')).toBe(false);
    expect(findSelectedIntegration([twilioSms, twilioWa], 'wa-1')).toBe(twilioWa);
    expect(findSelectedIntegration([twilioSms], 'nope')).toBeUndefined();
  });

  it('labels a row by name, then type label, then providerId', () => {
    expect(integrationLabel(twilioSms, catalog)).toBe('Twilio prod');
    expect(integrationLabel({ identifier: 'x', type: 'smtp' }, catalog)).toBe('SMTP');
    expect(integrationLabel({ identifier: 'x', providerId: 'twilio' }, catalog)).toBe('twilio');
  });

  it('offers only ACTIVE integrations of the asked-for channel', () => {
    const rows = [twilioSms, twilioWa, legacyWa, smtp, { ...twilioSms, _id: '5', identifier: 'off', name: 'off', active: false }];
    expect(providerChoicesForChannel(rows, 'SMS', catalog).map((c) => c.value)).toEqual(['twilio-sms-1']);
    expect(providerChoicesForChannel(rows, 'WHATSAPP', catalog).map((c) => c.value)).toEqual(['wa-1', 'whatsapp-legacy']);
    // smtp is inactive, so Email has nothing selectable.
    expect(providerChoicesForChannel(rows, 'EMAIL', catalog)).toEqual([]);
    expect(providerChoicesForChannel(rows, 'SMS', catalog)[0].typeLabel).toBe('Twilio SMS');
  });
});

describe('credential form helpers', () => {
  const fields = findProviderType(catalog, 'ozeki')!.credentialFields;

  it('derives i18n keys that match the existing app.providers.* convention', () => {
    expect(credLabelKey('accountSid')).toBe('app.providers.cred.account_sid');
    expect(credLabelKey('from')).toBe('app.providers.cred.from');
    expect(credLabelKey('base-URL')).toBe('app.providers.cred.base_url');
    expect(providerTypeLabelKey('twilio-whatsapp')).toBe('app.providers.type.twilio_whatsapp');
  });

  it('reports blank required fields, ignoring checkboxes', () => {
    expect(missingRequiredFields(fields, {})).toEqual(['baseUrl']);
    expect(missingRequiredFields(fields, { baseUrl: '   ' })).toEqual(['baseUrl']);
    expect(missingRequiredFields(fields, { baseUrl: 'http://x' })).toEqual([]);
  });

  it('ships checkboxes as booleans and drops blank optional text', () => {
    expect(buildCredentials(fields, { baseUrl: ' http://x ', useHttps: true })).toEqual({ baseUrl: 'http://x', useHttps: true });
    expect(buildCredentials(fields, { baseUrl: 'http://x' })).toEqual({ baseUrl: 'http://x', useHttps: false });
    // A numeric-looking value stays a STRING (Novu rejects a numeric nodemailer port).
    expect(buildCredentials([{ key: 'port', label: 'Port', type: 'text', required: true }], { port: '587' })).toEqual({ port: '587' });
  });
});

describe('createProviderBody', () => {
  const wa = findProviderType(catalog, 'twilio-whatsapp')!;
  const sms = findProviderType(catalog, 'twilio-sms')!;

  it('uses the catalog {type,...} body by default', () => {
    expect(createProviderBody(wa, '  WA prod ', { from: 'x' })).toEqual({
      type: 'twilio-whatsapp', name: 'WA prod', credentials: { from: 'x' },
    });
    expect(createProviderBody(sms, 'S', {}, { active: false })).toMatchObject({ active: false });
  });

  it('falls back to the legacy body, marking WhatsApp in the identifier so the row survives a refetch', () => {
    expect(createProviderBody(wa, 'WA prod', { from: 'x' }, { legacy: true })).toEqual({
      channel: 'WHATSAPP', providerId: 'twilio', name: 'WA prod', identifier: 'whatsapp-wa-prod', credentials: { from: 'x' },
    });
    expect(createProviderBody(sms, 'SMS prod', {}, { legacy: true })).toEqual({
      channel: 'SMS', providerId: 'twilio', name: 'SMS prod', identifier: undefined, credentials: {},
    });
  });
});

describe('FALLBACK_CATALOG', () => {
  it('only describes what a pre-catalog bridge could actually create', () => {
    expect(FALLBACK_CATALOG.map((p: ProviderType) => p.type)).toEqual(['twilio-sms', 'twilio-whatsapp', 'smtp']);
    expect(FALLBACK_CATALOG.every((p) => p.transport === 'novu')).toBe(true);
    const smtp = findProviderType(FALLBACK_CATALOG, 'smtp')!;
    expect(smtp.credentialFields.find((f) => f.key === 'port')?.type).toBe('text');
    expect(smtp.credentialFields.find((f) => f.key === 'secure')?.type).toBe('checkbox');
  });
});
