import { describe, it, expect } from 'vitest';
import {
  applyPendingChanges,
  checkPendingChanges,
  partitionFindings,
  naturalKey,
  refsForChange,
  fieldErrorsFor,
  fieldForRule,
  blockingSummary,
  isNotificationResource,
  type NotificationSnapshot,
  type PendingChange,
} from './notificationSaveGuard';
import type { BusinessServiceRecord, ValidationFinding } from '../workflow-services/validateNotifications';

const BS: BusinessServiceRecord = {
  businessService: 'PGR',
  states: [
    {
      uuid: 'u1', state: 'PENDINGFORASSIGNMENT', applicationStatus: 'PENDINGFORASSIGNMENT',
      actions: [
        { action: 'ASSIGN', nextState: 'u2', roles: ['GRO'] },
        { action: 'REJECT', nextState: 'u3', roles: ['GRO'] },
      ],
    },
    { uuid: 'u2', state: 'PENDINGATLME', applicationStatus: 'PENDINGATLME', actions: [] },
    { uuid: 'u3', state: 'REJECTED', applicationStatus: 'REJECTED', actions: [] },
  ],
};

/** A clean two-row config: ASSIGN/SMS and REJECT/SMS, both with templates. */
function snapshot(over: Partial<NotificationSnapshot> = {}): NotificationSnapshot {
  return {
    businessService: BS,
    roleCodes: ['GRO'],
    routingRows: [
      { businessService: 'PGR', action: 'ASSIGN', toState: 'PENDINGATLME', audience: 'CITIZEN', channel: 'SMS', active: true },
      { businessService: 'PGR', action: 'REJECT', toState: 'REJECTED', audience: 'CITIZEN', channel: 'SMS', active: true },
    ],
    templateRows: [
      { audience: 'CITIZEN', action: 'ASSIGN', toState: 'PENDINGATLME', channel: 'SMS', locale: 'en_IN', body: 'Complaint {id} assigned', active: true },
      { audience: 'CITIZEN', action: 'REJECT', toState: 'REJECTED', channel: 'SMS', locale: 'en_IN', body: 'Complaint {id} rejected', active: true },
    ],
    ...over,
  };
}

const templateChange = (row: Record<string, unknown>, over: Partial<PendingChange> = {}): PendingChange => ({
  resource: 'notification-template',
  op: 'upsert',
  row: { audience: 'CITIZEN', action: 'ASSIGN', toState: 'PENDINGATLME', channel: 'SMS', locale: 'en_IN', active: true, ...row },
  ...over,
});

describe('resource recognition', () => {
  it('knows the four notification masters and nothing else', () => {
    expect(isNotificationResource('notification-template')).toBe(true);
    expect(isNotificationResource('notification-channel')).toBe(true);
    expect(isNotificationResource('access-roles')).toBe(false);
    expect(isNotificationResource(undefined)).toBe(false);
  });
});

describe('naturalKey', () => {
  it('uses the MDMS x-unique tuple, case-insensitively', () => {
    expect(naturalKey('notification-template', { audience: 'citizen', action: 'assign', toState: 'PendingAtLme', channel: 'sms', locale: 'en_IN' }))
      .toBe('CITIZEN.ASSIGN.PENDINGATLME.SMS.EN_IN');
    expect(naturalKey('notification-channel', { code: 'sms' })).toBe('SMS');
    expect(naturalKey('notification-routing', { businessService: 'PGR', action: 'ASSIGN', toState: 'PENDINGATLME', audience: 'CITIZEN', channel: 'SMS' }))
      .toBe('PGR.ASSIGN.PENDINGATLME.CITIZEN.SMS');
  });
});

describe('applyPendingChanges', () => {
  it('replaces a row in place when the key is unchanged', () => {
    const next = applyPendingChanges(snapshot(), [templateChange({ body: 'new text {id}' })]);
    expect(next.templateRows).toHaveLength(2);
    expect(next.templateRows.find((t) => t.action === 'ASSIGN')?.body).toBe('new text {id}');
  });

  it('appends a row whose key is new', () => {
    const next = applyPendingChanges(snapshot(), [templateChange({ locale: 'hi_IN', body: 'नमस्ते {id}' })]);
    expect(next.templateRows).toHaveLength(3);
  });

  it('drops the old row when an edit moved the key fields', () => {
    const next = applyPendingChanges(snapshot(), [
      templateChange({ channel: 'EMAIL', subject: 'S', body: 'b {id}' }, { replaces: 'CITIZEN.ASSIGN.PENDINGATLME.SMS.EN_IN' }),
    ]);
    expect(next.templateRows).toHaveLength(2);
    expect(next.templateRows.some((t) => t.channel === 'SMS' && t.action === 'ASSIGN')).toBe(false);
    expect(next.templateRows.some((t) => t.channel === 'EMAIL')).toBe(true);
  });

  it('removes a row', () => {
    const next = applyPendingChanges(snapshot(), [templateChange({}, { op: 'remove' })]);
    expect(next.templateRows).toHaveLength(1);
  });

  it('never mutates the input snapshot', () => {
    const base = snapshot();
    const beforeLen = base.templateRows.length;
    applyPendingChanges(base, [templateChange({ locale: 'hi_IN', body: 'x' })]);
    expect(base.templateRows).toHaveLength(beforeLen);
  });

  it('routes each resource to its own list', () => {
    const base = snapshot({ channelRows: [{ code: 'SMS', enabled: true, provider: 'p1', active: true }], providerTemplateRows: [] });
    const next = applyPendingChanges(base, [
      { resource: 'notification-channel', op: 'upsert', row: { code: 'SMS', enabled: false, active: true } },
      { resource: 'notification-provider-template', op: 'upsert', row: { provider: 'twilio', channel: 'WHATSAPP', audience: 'CITIZEN', action: 'ASSIGN', toState: 'PENDINGATLME', locale: 'en_IN', templateId: 'HX1', approvalStatus: 'approved', variables: ['id'], active: true } },
    ]);
    expect(next.channelRows).toEqual([{ code: 'SMS', enabled: false, active: true }]);
    expect(next.providerTemplateRows).toHaveLength(1);
    expect(next.routingRows).toBe(base.routingRows);
  });
});

describe('refsForChange', () => {
  it('keys routing/template/provider-template rows on the routing ref shape', () => {
    expect(refsForChange(templateChange({}))).toEqual(['CITIZEN · ASSIGN -> PENDINGATLME · SMS']);
    expect(refsForChange({ resource: 'notification-provider-template', op: 'upsert', row: { audience: 'CITIZEN', action: 'ASSIGN', toState: 'PENDINGATLME', channel: 'WHATSAPP' } }))
      .toEqual(['CITIZEN · ASSIGN -> PENDINGATLME · WHATSAPP']);
  });

  it('keys a channel row on its code', () => {
    expect(refsForChange({ resource: 'notification-channel', op: 'upsert', row: { code: 'sms' } })).toEqual(['SMS']);
  });
});

describe('partitionFindings', () => {
  const err = (rule: string, ref: string): ValidationFinding => ({ level: 'error', rule, ref, message: `${rule} on ${ref}` });
  const warn = (rule: string, ref: string): ValidationFinding => ({ level: 'warn', rule, ref, message: `${rule} on ${ref}` });

  it('blocks an error the change introduced', () => {
    const { blocking } = partitionFindings([], [err('template-needs-body', 'A')], ['A']);
    expect(blocking).toHaveLength(1);
  });

  it('blocks an error the change LEFT on a row it touched', () => {
    const e = err('template-needs-body', 'A');
    const { blocking } = partitionFindings([e], [e], ['A']);
    expect(blocking).toHaveLength(1);
  });

  it('does NOT block a pre-existing error on an untouched row', () => {
    const other = err('routing-has-template', 'B');
    const { blocking, advisory } = partitionFindings([other], [other], ['A']);
    expect(blocking).toEqual([]);
    expect(advisory).toEqual([other]);
  });

  it('blocks a NEW error on an untouched row — a change can break a neighbour', () => {
    const { blocking } = partitionFindings([], [err('no-orphan-template', 'B')].map((f) => ({ ...f, level: 'error' as const })), ['A']);
    expect(blocking).toHaveLength(1);
  });

  it('never blocks on a warning, however new', () => {
    const { blocking, advisory } = partitionFindings([], [warn('sms-length', 'A')], ['A']);
    expect(blocking).toEqual([]);
    expect(advisory).toHaveLength(1);
  });

  it('treats a finding whose message changed as new', () => {
    const before = [err('sms-length', 'A')];
    const after: ValidationFinding[] = [{ level: 'error', rule: 'sms-length', ref: 'Z', message: 'different' }];
    expect(partitionFindings(before, after, []).blocking).toHaveLength(1);
  });

  it('matches refs case- and whitespace-insensitively', () => {
    const e: ValidationFinding = { level: 'error', rule: 'x', ref: 'citizen  ·  assign', message: 'm' };
    expect(partitionFindings([e], [e], ['CITIZEN · ASSIGN']).blocking).toHaveLength(1);
  });
});

describe('checkPendingChanges — end to end', () => {
  it('lets a clean edit through', () => {
    const r = checkPendingChanges(snapshot(), [templateChange({ body: 'Complaint {id} was assigned' })]);
    expect(r.blocking).toEqual([]);
  });

  it('blocks an edit that empties the body', () => {
    const r = checkPendingChanges(snapshot(), [templateChange({ body: '' })]);
    expect(r.blocking.map((f) => f.rule)).toContain('template-needs-body');
  });

  it('blocks an edit that introduces a double brace', () => {
    const r = checkPendingChanges(snapshot(), [templateChange({ body: 'Complaint {{id}}' })]);
    expect(r.blocking.map((f) => f.rule)).toContain('placeholder-braces');
  });

  it('does not block on the warning an over-long Hindi SMS produces', () => {
    const r = checkPendingChanges(snapshot(), [templateChange({ body: 'न'.repeat(300) })]);
    expect(r.blocking).toEqual([]);
    expect(r.advisory.map((f) => f.rule)).toContain('sms-length');
  });

  it('blocks removing the only template for an active routing row', () => {
    const r = checkPendingChanges(snapshot(), [templateChange({}, { op: 'remove' })]);
    expect(r.blocking.map((f) => f.rule)).toContain('routing-has-template');
  });

  it('lets an operator fix one row while another row is still broken', () => {
    // REJECT's template is missing entirely (a pre-existing error). Editing the
    // ASSIGN body must still save.
    const broken = snapshot({ templateRows: [
      { audience: 'CITIZEN', action: 'ASSIGN', toState: 'PENDINGATLME', channel: 'SMS', locale: 'en_IN', body: 'Complaint {id}', active: true },
    ] });
    expect(checkPendingChanges(broken, []).after.some((f) => f.level === 'error')).toBe(true);
    const r = checkPendingChanges(broken, [templateChange({ body: 'Complaint {id} was assigned' })]);
    expect(r.blocking).toEqual([]);
    expect(r.advisory.map((f) => f.rule)).toContain('routing-has-template');
  });

  it('blocks a WhatsApp body whose placeholder the provider template does not declare', () => {
    const base = snapshot({
      routingRows: [{ businessService: 'PGR', action: 'ASSIGN', toState: 'PENDINGATLME', audience: 'CITIZEN', channel: 'WHATSAPP', active: true }],
      templateRows: [{ audience: 'CITIZEN', action: 'ASSIGN', toState: 'PENDINGATLME', channel: 'WHATSAPP', locale: 'en_IN', body: 'Complaint {id}', active: true }],
      providerTemplateRows: [{ provider: 'twilio', channel: 'WHATSAPP', audience: 'CITIZEN', action: 'ASSIGN', toState: 'PENDINGATLME', locale: 'en_IN', templateId: 'HX1', approvalStatus: 'approved', variables: ['id'], active: true }],
    });
    expect(checkPendingChanges(base, []).after.filter((f) => f.level === 'error')).toEqual([]);
    const r = checkPendingChanges(base, [templateChange({ channel: 'WHATSAPP', body: 'Complaint {id} for {emp_name}' })]);
    expect(r.blocking.map((f) => f.rule)).toContain('whatsapp-variable-unmapped');
  });

  it('blocks switching off a channel that carries routing rows only when that is an error', () => {
    // Disabling a channel is a WARNING (channel-enabled), never an error — an
    // operator must be able to turn a channel off without a fight.
    const base = snapshot({ channelRows: [{ code: 'SMS', enabled: true, provider: 'p1', active: true }], integrationRows: [{ identifier: 'p1', name: 'P', active: true }] });
    const r = checkPendingChanges(base, [{ resource: 'notification-channel', op: 'upsert', row: { code: 'SMS', enabled: false, provider: 'p1', active: true } }]);
    expect(r.blocking).toEqual([]);
    expect(r.advisory.map((f) => f.rule)).toContain('channel-enabled');
  });

  it('blocks clearing the provider of an enabled channel that carries routing rows', () => {
    const base = snapshot({ channelRows: [{ code: 'SMS', enabled: true, provider: 'p1', active: true }], integrationRows: [{ identifier: 'p1', name: 'P', active: true }] });
    const r = checkPendingChanges(base, [{ resource: 'notification-channel', op: 'upsert', row: { code: 'SMS', enabled: true, provider: '', active: true } }]);
    expect(r.blocking.map((f) => f.rule)).toContain('channel-needs-provider');
  });
});

describe('presenting the result', () => {
  it('maps a rule to the field its finding belongs next to', () => {
    expect(fieldForRule('template-needs-body')).toBe('body');
    expect(fieldForRule('email-needs-subject')).toBe('subject');
    expect(fieldForRule('routing-has-template')).toBeUndefined();
  });

  it('keys field errors by form field and keeps the rule id visible', () => {
    const errors = fieldErrorsFor([
      { level: 'error', rule: 'template-needs-body', message: 'body is empty', ref: 'A' },
      { level: 'error', rule: 'transition-exists', message: 'no such transition', ref: 'A' },
    ]);
    expect(Object.keys(errors)).toEqual(['body']);
    expect(errors.body).toMatch(/^template-needs-body: /);
  });

  it('drops a field the form does not have, so nothing is attached to nowhere', () => {
    const f: ValidationFinding[] = [{ level: 'error', rule: 'template-needs-body', message: 'm', ref: 'A' }];
    expect(fieldErrorsFor(f, ['subject'])).toEqual({});
    expect(fieldErrorsFor(f, ['body', 'subject'])).toHaveProperty('body');
  });

  it('keeps the first finding per field and leaves the rest for the summary', () => {
    const errors = fieldErrorsFor([
      { level: 'error', rule: 'template-needs-body', message: 'first', ref: 'A' },
      { level: 'error', rule: 'placeholder-braces', message: 'second', ref: 'A' },
    ]);
    expect(errors.body).toMatch(/first/);
  });

  it('summarises the distinct rules that blocked', () => {
    expect(blockingSummary([])).toBe('');
    const s = blockingSummary([
      { level: 'error', rule: 'template-needs-body', message: 'm', ref: 'A' },
      { level: 'error', rule: 'template-needs-body', message: 'm2', ref: 'B' },
    ]);
    expect(s).toMatch(/2 validation errors/);
    expect(s.match(/template-needs-body/g)).toHaveLength(1);
  });
});
