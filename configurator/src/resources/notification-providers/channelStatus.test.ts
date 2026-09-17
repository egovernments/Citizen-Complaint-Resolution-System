import { describe, it, expect } from 'vitest';
import { deriveChannelStatus, type Channel } from './channelStatus';

/** Minimal stand-in for providerApi.rowChannel (kept out of the test to avoid the app module graph). */
const channelOf = (i: Record<string, unknown>): Channel =>
  String(i.channel).toUpperCase() === 'EMAIL' ? 'EMAIL' : /whatsapp/i.test(`${i.identifier ?? ''} ${i.name ?? ''}`) ? 'WHATSAPP' : 'SMS';

const twilioSms = { channel: 'sms', providerId: 'twilio', identifier: 'twilio-sms-1', active: true };
const gmail = { channel: 'email', providerId: 'nodemailer', identifier: 'gmail-1', active: true };
const workflows = ['complaints-sms', 'complaints-email'];

describe('deriveChannelStatus', () => {
  it('delivers only when enabled in MDMS AND the Novu integration + workflow exist', () => {
    const s = deriveChannelStatus('SMS', { code: 'SMS', enabled: true, gateway: 'novu', active: true }, [twilioSms], workflows, channelOf);
    expect(s.effective).toBe(true);
    expect(s.reasons).toEqual([]);
  });

  it('enabled without a provider is "enabled, not deliverable" with the reason spelled out', () => {
    const s = deriveChannelStatus('WHATSAPP', { code: 'WHATSAPP', enabled: true, gateway: 'novu', active: true }, [twilioSms, gmail], workflows, channelOf);
    expect(s.enabled).toBe(true);
    expect(s.effective).toBe(false);
    expect(s.reasons).toContain('no active Novu integration for this channel');
    expect(s.reasons).toContain('Novu workflow complaints-whatsapp not found');
  });

  it('no MDMS row means the bridge is on its env fallback — say so, and it is not "delivering"', () => {
    const s = deriveChannelStatus('EMAIL', undefined, [gmail], workflows, channelOf);
    expect(s.effective).toBe(false);
    expect(s.reasons[0]).toMatch(/no NotificationChannel row/);
  });

  it('smscountry needs no Novu pieces but needs a senderId and carries SMS only', () => {
    const ok = deriveChannelStatus('SMS', { code: 'SMS', enabled: true, gateway: 'smscountry', senderId: 'KE-GOV', active: true }, [], [], channelOf);
    expect(ok.effective).toBe(true);
    const noSender = deriveChannelStatus('SMS', { code: 'SMS', enabled: true, gateway: 'smscountry', senderId: null, active: true }, [], [], channelOf);
    expect(noSender.reasons).toContain('no senderId for the SMSCountry gateway');
    const wrongChannel = deriveChannelStatus('EMAIL', { code: 'EMAIL', enabled: true, gateway: 'smscountry', active: true }, [gmail], workflows, channelOf);
    expect(wrongChannel.effective).toBe(false);
  });

  it('a disabled row is off even with a perfect provider setup', () => {
    const s = deriveChannelStatus('EMAIL', { code: 'EMAIL', enabled: false, gateway: 'novu', active: true }, [gmail], workflows, channelOf);
    expect(s.enabled).toBe(false);
    expect(s.effective).toBe(false);
    expect(s.reasons).toContain('disabled in NotificationChannel');
  });
});
