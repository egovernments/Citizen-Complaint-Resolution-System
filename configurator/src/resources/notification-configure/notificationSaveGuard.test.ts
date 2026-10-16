// Validate-on-update for the writes that are not a master row: a PROVIDER change (disable,
// enable, delete) and the snapshot the Channels card / provider actions check against.
// Kanav review of #2097 (4079418184): provider Disable and the Channels card saved without
// running the checker, so a disabled provider behind a routed channel went through silently.
import { describe, it, expect } from 'vitest';
import { checkIntegrationChange, checkPendingChanges, type NotificationSnapshot } from './notificationSaveGuard';
import { channelGuardSnapshot, type NotificationConfigQuery } from './useNotificationGuard';

const EVENT = 'COMPLAINTS.WORKFLOW.APPLY.PENDINGFORASSIGNMENT';
const TWILIO = { _id: 'i-1', identifier: 'twilio-sms-main', name: 'Twilio', active: true };
const SMTP = { _id: 'i-2', identifier: 'smtp-main', name: 'SMTP', active: true };

function snapshot(over: Partial<NotificationSnapshot> = {}): NotificationSnapshot {
  return {
    catalogue: [{ eventName: EVENT, module: 'Complaints', channels: ['SMS', 'EMAIL'], actors: [{ name: 'citizen' }], active: true }] as NotificationSnapshot['catalogue'],
    routingRows: [{ eventName: EVENT, audience: 'ACTOR:citizen', channel: 'SMS', active: true }],
    templateRows: [{ eventName: EVENT, audience: 'ACTOR:citizen', channel: 'SMS', locale: 'en_IN', body: 'Filed {id}', active: true }],
    roleCodes: [],
    channelRows: [
      { code: 'SMS', enabled: true, gateway: 'novu', provider: 'twilio-sms-main', active: true },
      { code: 'EMAIL', enabled: true, gateway: 'novu', provider: 'smtp-main', active: true },
    ],
    integrationRows: [TWILIO, SMTP],
    ...over,
  };
}

describe('checkIntegrationChange', () => {
  it('blocks disabling the provider a routed channel selects (channel-provider-inactive)', () => {
    const r = checkIntegrationChange(snapshot(), TWILIO, { op: 'patch', patch: { active: false } });
    expect(r.blocking.map((f) => [f.rule, f.ref])).toEqual([['channel-provider-inactive', 'SMS']]);
  });

  it('blocks deleting it (channel-provider-missing)', () => {
    const r = checkIntegrationChange(snapshot(), TWILIO, { op: 'remove' });
    expect(r.blocking.map((f) => f.rule)).toEqual(['channel-provider-missing']);
  });

  it('only warns for a channel nothing routes on yet, and never blocks enabling', () => {
    expect(checkIntegrationChange(snapshot(), SMTP, { op: 'patch', patch: { active: false } }).blocking).toEqual([]);
    const off = snapshot({ integrationRows: [{ ...TWILIO, active: false }, SMTP] });
    expect(checkIntegrationChange(off, { ...TWILIO, active: false }, { op: 'patch', patch: { active: true } }).blocking).toEqual([]);
  });

  it('lets an unselected provider go', () => {
    const spare = { _id: 'i-3', identifier: 'twilio-sms-spare', active: true };
    const s = snapshot({ integrationRows: [TWILIO, SMTP, spare] });
    expect(checkIntegrationChange(s, spare, { op: 'remove' }).blocking).toEqual([]);
  });

  it('with the provider list unreadable, blames only this change — not the other channels', () => {
    const s = snapshot({ integrationRows: undefined });
    expect(checkIntegrationChange(s, SMTP, { op: 'patch', patch: { active: false } }).blocking).toEqual([]);
    expect(checkIntegrationChange(s, TWILIO, { op: 'patch', patch: { active: false } }).blocking.map((f) => f.rule))
      .toEqual(['channel-provider-inactive']);
  });
});

describe('the Channels card change', () => {
  it('"None" on a routed channel blocks; switching it off does not', () => {
    const none = checkPendingChanges(snapshot(), [{ resource: 'notifications-channel', op: 'upsert', row: { code: 'SMS', enabled: true, gateway: 'novu', provider: null, active: true } }]);
    expect(none.blocking.map((f) => f.rule)).toEqual(['channel-needs-provider']);
    const off = checkPendingChanges(snapshot(), [{ resource: 'notifications-channel', op: 'upsert', row: { code: 'SMS', enabled: false, gateway: 'novu', provider: 'twilio-sms-main', active: true } }]);
    expect(off.blocking).toEqual([]);
  });
});

describe('channelGuardSnapshot', () => {
  const base = {
    catalogue: [], routingRows: [], templateRows: [], roleCodes: [], snapshot: null,
  } as unknown as NotificationConfigQuery;

  it('is null while anything the check reads is loading', () => {
    expect(channelGuardSnapshot({ ...base, loading: true })).toBeNull();
    expect(channelGuardSnapshot({ ...base, loading: true, snapshot: snapshot() })).toBeNull();
  });

  it('does not wait for an event catalogue (that would lock the card on a tenant without one)', () => {
    const s = channelGuardSnapshot({ ...base, loading: false, channelRows: snapshot().channelRows });
    expect(s).not.toBeNull();
    expect(s!.channelRows).toHaveLength(2);
  });

  it('uses the full snapshot when there is one', () => {
    const full = snapshot();
    expect(channelGuardSnapshot({ ...base, loading: false, snapshot: full })).toBe(full);
  });
});
