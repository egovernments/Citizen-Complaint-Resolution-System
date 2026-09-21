import { describe, it, expect } from 'vitest';
import { deriveChannelStatus, type Channel } from './channelStatus';

/** Minimal stand-in for providerCatalog.rowChannel (kept out of the test to avoid the app module graph). */
const channelOf = (i: Record<string, unknown>): Channel =>
  String(i.channel).toUpperCase() === 'EMAIL' ? 'EMAIL' : /whatsapp/i.test(`${i.identifier ?? ''} ${i.name ?? ''}`) ? 'WHATSAPP' : 'SMS';

const twilioSms = { channel: 'sms', providerId: 'twilio', identifier: 'twilio-sms-1', name: 'Twilio SMS (prod)', active: true };
const gmail = { channel: 'email', providerId: 'nodemailer', identifier: 'gmail-1', active: true };
const workflows = ['complaints-sms', 'complaints-email'];

describe('deriveChannelStatus', () => {
  it('delivers only when enabled in MDMS AND the selected Novu integration + workflow exist', () => {
    const s = deriveChannelStatus('SMS', { code: 'SMS', enabled: true, gateway: 'novu', provider: 'twilio-sms-1', active: true }, [twilioSms], workflows, channelOf);
    expect(s.effective).toBe(true);
    expect(s.reasons).toEqual([]);
    expect(s.verdict).toBe('ok');
    expect(s.providerState).toBe('ok');
    expect(s.summary).toMatch(/delivering through Twilio SMS \(prod\)/);
  });

  it('enabled without a provider is "enabled, not deliverable" with the reason spelled out', () => {
    const s = deriveChannelStatus('WHATSAPP', { code: 'WHATSAPP', enabled: true, gateway: 'novu', active: true }, [twilioSms, gmail], workflows, channelOf);
    expect(s.enabled).toBe(true);
    expect(s.effective).toBe(false);
    expect(s.providerState).toBe('none');
    expect(s.verdict).toBe('no-provider');
    expect(s.reasons).toContain('no active Novu integration for this channel');
    expect(s.reasons).toContain('Novu workflow complaints-whatsapp not found');
  });

  it('no MDMS row means the bridge is on its env fallback — say so, and it is not "delivering"', () => {
    const s = deriveChannelStatus('EMAIL', undefined, [gmail], workflows, channelOf);
    expect(s.effective).toBe(false);
    expect(s.reasons[0]).toMatch(/no NotificationChannel row/);
    expect(s.verdict).toBe('no-row');
  });

  it('smscountry needs no Novu pieces but needs a senderId and carries SMS only', () => {
    const ok = deriveChannelStatus('SMS', { code: 'SMS', enabled: true, gateway: 'smscountry', senderId: 'KE-GOV', active: true }, [], [], channelOf);
    expect(ok.effective).toBe(true);
    // A direct gateway bypasses Novu, so provider selection does not apply to it.
    expect(ok.providerState).toBe('not-applicable');
    expect(ok.verdict).toBe('ok');
    const noSender = deriveChannelStatus('SMS', { code: 'SMS', enabled: true, gateway: 'smscountry', senderId: null, active: true }, [], [], channelOf);
    expect(noSender.reasons).toContain('no senderId for the SMSCountry gateway');
    expect(noSender.verdict).toBe('gateway-incomplete');
    const wrongChannel = deriveChannelStatus('EMAIL', { code: 'EMAIL', enabled: true, gateway: 'smscountry', active: true }, [gmail], workflows, channelOf);
    expect(wrongChannel.effective).toBe(false);
  });

  it('a disabled row is off even with a perfect provider setup', () => {
    const s = deriveChannelStatus('EMAIL', { code: 'EMAIL', enabled: false, gateway: 'novu', provider: 'gmail-1', active: true }, [gmail], workflows, channelOf);
    expect(s.enabled).toBe(false);
    expect(s.effective).toBe(false);
    expect(s.verdict).toBe('off');
    expect(s.reasons).toContain('disabled in NotificationChannel');
  });
});

describe('deriveChannelStatus — provider selection', () => {
  const on = (provider?: string) => ({ code: 'SMS', enabled: true, gateway: 'novu', provider, active: true });

  it('reports a selection that no longer resolves to an integration', () => {
    const s = deriveChannelStatus('SMS', on('twilio-sms-gone'), [twilioSms], workflows, channelOf);
    expect(s.providerState).toBe('missing');
    expect(s.verdict).toBe('provider-missing');
    expect(s.effective).toBe(false);
    expect(s.reasons.join(' ')).toMatch(/no longer exists/);
    expect(s.summary).toMatch(/Pick another provider/);
  });

  it('reports a selected provider that has been disabled', () => {
    const s = deriveChannelStatus('SMS', on('twilio-sms-1'), [{ ...twilioSms, active: false }], workflows, channelOf);
    expect(s.providerState).toBe('inactive');
    expect(s.verdict).toBe('provider-inactive');
    expect(s.effective).toBe(false);
    expect(s.summary).toMatch(/is disabled/);
  });

  it('reports a selected provider that serves a different channel', () => {
    const s = deriveChannelStatus('SMS', on('gmail-1'), [gmail, twilioSms], workflows, channelOf);
    expect(s.providerState).toBe('mismatch');
    expect(s.verdict).toBe('provider-mismatch');
    expect(s.effective).toBe(false);
  });

  it('a legacy row with no selection still delivers through the fallback, but says the selection is missing', () => {
    const s = deriveChannelStatus('SMS', on(), [twilioSms], workflows, channelOf);
    expect(s.providerState).toBe('unselected');
    expect(s.verdict).toBe('provider-unselected');
    // The bridge still picks an active integration for the channel, so this is not "off".
    expect(s.effective).toBe(true);
    expect(s.reasons.join(' ')).toMatch(/no provider selected/);
  });

  it('matches a selection written as the integration id rather than the identifier', () => {
    const s = deriveChannelStatus('SMS', on('64f0abc'), [{ ...twilioSms, _id: '64f0abc' }], workflows, channelOf);
    expect(s.providerState).toBe('ok');
    expect(s.effective).toBe(true);
  });

  it('a good provider with a missing Novu workflow is reported as such', () => {
    const s = deriveChannelStatus('SMS', on('twilio-sms-1'), [twilioSms], ['complaints-email'], channelOf);
    expect(s.providerState).toBe('ok');
    expect(s.verdict).toBe('no-workflow');
    expect(s.effective).toBe(false);
  });

  it('keeps provider noise out of a channel that is switched off', () => {
    const s = deriveChannelStatus('SMS', { code: 'SMS', enabled: false, gateway: 'novu', provider: 'twilio-sms-gone', active: true }, [twilioSms], workflows, channelOf);
    expect(s.verdict).toBe('off');
    expect(s.reasons).toEqual(['disabled in NotificationChannel']);
  });
});
