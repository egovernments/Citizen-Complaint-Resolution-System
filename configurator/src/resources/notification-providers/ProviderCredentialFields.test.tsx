// @vitest-environment jsdom
//
// Credential field labels on Add Provider / Rotate credentials. A per-KEY translation used to
// outrank the bridge catalog's per-TYPE label, so SMSCountry, Ozeki and Jasmin (which share the
// keys user / password / from with SMTP) were labelled "SMTP User" / "SMTP Password" / "From".
// Rendered with the app's real bundled English messages, so a translation added under the wrong
// key shows up here, not on a live Configurator.
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { I18nContextProvider } from 'ra-core';
import { i18nProvider } from '@/providers/i18nProvider';
import { ProviderCredentialFields } from './ProviderCredentialFields';
import { credFields } from './providerApi';
import {
  credentialFieldLabel,
  credLabelKey,
  credTypeLabelKey,
  normalizeCatalog,
  type CatalogCredentialField,
  type CredLabelTranslate,
} from './providerCatalog';

// The credential fields of GET /providers/catalog, as ProviderCatalog.java (novu-bridge) builds them.
const RAW_CATALOG = [
  {
    type: 'twilio-sms', label: 'Twilio SMS', channel: 'SMS', transport: 'novu', novuProviderId: 'twilio',
    credentialFields: [
      { key: 'accountSid', label: 'Account SID', type: 'text', required: true },
      { key: 'token', label: 'Auth token', type: 'password', required: true },
      { key: 'from', label: 'From number', type: 'text', required: true, help: 'The Twilio number in E.164, SMS-enabled for the destination country' },
    ],
  },
  {
    type: 'twilio-whatsapp', label: 'Twilio WhatsApp', channel: 'WHATSAPP', transport: 'novu', novuProviderId: 'twilio',
    credentialFields: [
      { key: 'accountSid', label: 'Account SID', type: 'text', required: true },
      { key: 'token', label: 'Auth token', type: 'password', required: true },
      { key: 'from', label: 'WhatsApp sender', type: 'text', required: true, help: 'The WhatsApp-registered Twilio sender, prefixed whatsapp:' },
    ],
  },
  {
    type: 'smtp', label: 'Email (SMTP)', channel: 'EMAIL', transport: 'novu', novuProviderId: 'nodemailer',
    credentialFields: [
      { key: 'host', label: 'SMTP host', type: 'text', required: true },
      { key: 'port', label: 'SMTP port', type: 'text', required: true, help: 'Sent as text, not a number' },
      { key: 'user', label: 'Username', type: 'text', required: true },
      { key: 'password', label: 'Password', type: 'password', required: true },
      { key: 'from', label: 'From address', type: 'text', required: true },
      { key: 'senderName', label: 'From name', type: 'text', required: true },
      { key: 'secure', label: 'Use TLS on connect (port 465)', type: 'checkbox', required: false, help: 'Leave off for STARTTLS on port 587' },
    ],
  },
  {
    type: 'smscountry', label: 'SMSCountry', channel: 'SMS', transport: 'novu', novuProviderId: 'smscountry',
    credentialFields: [
      { key: 'user', label: 'Panel username', type: 'text', required: true },
      { key: 'password', label: 'Panel password', type: 'password', required: true, help: 'The panel account type issues no API key' },
      { key: 'from', label: 'Registered sender id', type: 'text', required: true, help: 'The sender id the messages are registered against' },
      { key: 'baseUrl', label: 'Gateway URL', type: 'text', required: false },
    ],
  },
  {
    type: 'ozeki', label: 'Ozeki SMS Gateway', channel: 'SMS', transport: 'novu', novuProviderId: 'ozeki',
    credentialFields: [
      { key: 'baseUrl', label: 'HTTP API URL', type: 'text', required: true },
      { key: 'user', label: 'Username', type: 'text', required: true, help: "The gateway's HTTP API user" },
      { key: 'password', label: 'Password', type: 'password', required: true },
      { key: 'from', label: 'Sender id', type: 'text', required: false },
    ],
  },
  {
    type: 'jasmin', label: 'Jasmin SMS Gateway', channel: 'SMS', transport: 'novu', novuProviderId: 'jasmin',
    credentialFields: [
      { key: 'baseUrl', label: 'Send URL', type: 'text', required: true },
      { key: 'user', label: 'Username', type: 'text', required: true, help: 'The Jasmin HTTP API username' },
      { key: 'password', label: 'Password', type: 'password', required: true },
      { key: 'from', label: 'Sender id', type: 'text', required: false },
    ],
  },
  // A type this Configurator has no translations for: the catalog's labels must show as sent.
  {
    type: 'acme-sms', label: 'Acme SMS', channel: 'SMS', transport: 'novu', novuProviderId: 'acme',
    credentialFields: [
      { key: 'user', label: 'API login', type: 'text', required: true },
      { key: 'password', label: 'API secret', type: 'password', required: true },
      { key: 'from', label: 'Short code', type: 'text', required: false },
      // Sent without a label: generic per-key translation, then the raw key.
      { key: 'host', type: 'text', required: false },
      { key: 'apiKey', type: 'text', required: false },
    ],
  },
];

const CATALOG = normalizeCatalog(RAW_CATALOG);

function fieldsOf(type: string): CatalogCredentialField[] {
  const entry = CATALOG.find((pt) => pt.type === type);
  if (!entry) throw new Error(`no catalog entry ${type}`);
  return entry.credentialFields;
}

/** The labels as rendered, in order, without the required-field asterisk. */
function renderedLabels(type: string): string[] {
  const { container, unmount } = render(
    <I18nContextProvider value={i18nProvider}>
      <ProviderCredentialFields type={type} fields={fieldsOf(type)} values={{}} onChange={() => {}} />
    </I18nContextProvider>,
  );
  const labels = Array.from(container.querySelectorAll('label')).map((el) =>
    (el.textContent ?? '').replace(/\s*\*$/, '').trim());
  unmount();
  return labels;
}

describe('ProviderCredentialFields labels (bundled English)', () => {
  it('SMSCountry shows its catalog labels, not the SMTP ones', () => {
    expect(renderedLabels('smscountry')).toEqual(['Panel username', 'Panel password', 'Registered sender id', 'Gateway URL']);
  });

  it('Ozeki shows its catalog labels', () => {
    expect(renderedLabels('ozeki')).toEqual(['HTTP API URL', 'Username', 'Password', 'Sender id']);
  });

  it('Jasmin shows its catalog labels', () => {
    expect(renderedLabels('jasmin')).toEqual(['Send URL', 'Username', 'Password', 'Sender id']);
  });

  it('SMTP keeps its translated labels ("SMTP User", …) and the catalog label for an untranslated key', () => {
    expect(renderedLabels('smtp')).toEqual([
      'SMTP Host', 'SMTP Port', 'SMTP User', 'SMTP Password', 'From', 'From name', 'Use TLS (secure)',
    ]);
  });

  it('Twilio SMS and WhatsApp keep their translated labels', () => {
    expect(renderedLabels('twilio-sms')).toEqual(['Account SID', 'Auth Token', 'From']);
    expect(renderedLabels('twilio-whatsapp')).toEqual(['Account SID', 'Auth Token', 'From']);
  });

  it('a type with no translations shows the catalog label, then the generic key translation, then the raw key', () => {
    expect(renderedLabels('acme-sms')).toEqual(['API login', 'API secret', 'Short code', 'Host', 'apiKey']);
  });

  it("help text is the catalog's own, per type", () => {
    const { container } = render(
      <I18nContextProvider value={i18nProvider}>
        <ProviderCredentialFields type="ozeki" fields={fieldsOf('ozeki')} values={{}} onChange={() => {}} />
      </I18nContextProvider>,
    );
    expect(container.textContent).toContain("The gateway's HTTP API user");
    expect(container.textContent).not.toMatch(/SMTP/);
  });
});

describe('credentialFieldLabel lookup order', () => {
  const messages: Record<string, string> = {
    'app.providers.cred.user': 'Generic user',
    'app.providers.cred.smtp.user': 'SMTP User',
  };
  const t: CredLabelTranslate = (key, options) => messages[key] ?? options?._ ?? key;

  it('per-type translation, then catalog label, then generic translation, then key', () => {
    expect(credentialFieldLabel(t, 'smtp', { key: 'user', label: 'Username' })).toBe('SMTP User');
    expect(credentialFieldLabel(t, 'smscountry', { key: 'user', label: 'Panel username' })).toBe('Panel username');
    expect(credentialFieldLabel(t, 'smscountry', { key: 'user', label: '' })).toBe('Generic user');
    expect(credentialFieldLabel(t, 'smscountry', { key: 'apiKey', label: '' })).toBe('apiKey');
    expect(credentialFieldLabel(t, undefined, { key: 'user', label: 'Panel username' })).toBe('Panel username');
  });

  it('builds per-type keys like the provider-type keys (hyphen and camelCase to snake)', () => {
    expect(credTypeLabelKey('twilio-sms', 'accountSid')).toBe('app.providers.cred.twilio_sms.account_sid');
    expect(credLabelKey('accountSid')).toBe('app.providers.cred.account_sid');
  });

  it('keeps an absent catalog label empty instead of substituting the key', () => {
    expect(fieldsOf('acme-sms').find((f) => f.key === 'host')?.label).toBe('');
  });

  it('the offline fallback form uses per-type keys too', () => {
    expect(credFields('EMAIL', 'nodemailer').find((f) => f.key === 'user')?.labelKey).toBe('app.providers.cred.smtp.user');
  });
});
