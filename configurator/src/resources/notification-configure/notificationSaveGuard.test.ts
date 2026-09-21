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
  replacesKeyFor,
  type NotificationSnapshot,
  type PendingChange,
} from './notificationSaveGuard';
import type { TemplateRow, ValidationFinding } from '../workflow-services/validateNotifications';
import type { EventCatalogueRow } from './eventCatalogue';
import { PLACEHOLDER_VOCABULARY } from './legacyAdapter';

const ASSIGN = 'COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME';
const REJECT = 'COMPLAINTS.WORKFLOW.REJECT.REJECTED';

const CATALOGUE: EventCatalogueRow[] = [ASSIGN, REJECT].map((eventName) => ({
  module: 'Complaints',
  eventName,
  label: eventName,
  actors: [{ name: 'citizen', required: true }, { name: 'assignee' }],
  placeholders: PLACEHOLDER_VOCABULARY.map((name) => ({ name })),
  active: true,
}));

/** A clean two-row config: ASSIGN/SMS and REJECT/SMS, both with templates. */
function snapshot(over: Partial<NotificationSnapshot> = {}): NotificationSnapshot {
  return {
    catalogue: CATALOGUE,
    roleCodes: ['GRO'],
    routingRows: [
      { module: 'Complaints', eventName: ASSIGN, audience: 'ACTOR:citizen', channel: 'SMS', active: true },
      { module: 'Complaints', eventName: REJECT, audience: 'ACTOR:citizen', channel: 'SMS', active: true },
    ],
    templateRows: [
      { module: 'Complaints', eventName: ASSIGN, audience: 'ACTOR:citizen', channel: 'SMS', locale: 'en_IN', body: 'Complaint {id} assigned', active: true },
      { module: 'Complaints', eventName: REJECT, audience: 'ACTOR:citizen', channel: 'SMS', locale: 'en_IN', body: 'Complaint {id} rejected', active: true },
    ],
    ...over,
  };
}

const templateChange = (row: Record<string, unknown>, over: Partial<PendingChange> = {}): PendingChange => ({
  resource: 'notifications-template',
  op: 'upsert',
  row: { module: 'Complaints', eventName: ASSIGN, audience: 'ACTOR:citizen', channel: 'SMS', locale: 'en_IN', active: true, ...row },
  ...over,
});

describe('resource recognition', () => {
  it('knows the four WRITABLE notification masters and nothing else', () => {
    expect(isNotificationResource('notifications-template')).toBe(true);
    expect(isNotificationResource('notifications-channel')).toBe(true);
    // The legacy masters are read-only now, so there is no save path to guard,
    // and the module-owned catalogue is not authored here either.
    expect(isNotificationResource('notification-template')).toBe(false);
    expect(isNotificationResource('notifications-event-catalogue')).toBe(false);
    expect(isNotificationResource('access-roles')).toBe(false);
    expect(isNotificationResource(undefined)).toBe(false);
  });
});

describe('naturalKey', () => {
  it('uses the MDMS x-unique tuple, case-insensitively', () => {
    expect(naturalKey('notifications-template', { eventName: ASSIGN.toLowerCase(), audience: 'ACTOR:citizen', channel: 'sms', locale: 'en_IN' }))
      .toBe(`${ASSIGN}.ACTOR:CITIZEN.SMS.EN_IN`);
    expect(naturalKey('notifications-channel', { code: 'sms' })).toBe('SMS');
    expect(naturalKey('notifications-routing', { eventName: ASSIGN, audience: 'ACTOR:citizen', channel: 'SMS' }))
      .toBe(`${ASSIGN}.ACTOR:CITIZEN.SMS`);
  });
});

describe('replacesKeyFor', () => {
  // The uid is no longer decomposable — `eventName` carries dots — so the old
  // exact part-count check would reject every real key. What is left is a lower
  // bound, plus the uid match applyPendingChanges does directly.
  it('accepts a real uniqueIdentifier even though eventName contains dots', () => {
    expect(replacesKeyFor('notifications-routing', `${ASSIGN}.ACTOR:citizen.SMS`))
      .toBe(`${ASSIGN}.ACTOR:CITIZEN.SMS`);
  });

  it('rejects a blank uid and one with too few separators to be this key', () => {
    expect(replacesKeyFor('notifications-routing', '')).toBeUndefined();
    expect(replacesKeyFor('notifications-routing', '   ')).toBeUndefined();
    expect(replacesKeyFor('notifications-template', 'SMS')).toBeUndefined();
    expect(replacesKeyFor('notifications-channel', 'SMS')).toBe('SMS');
  });

  it('drops the replaced row when `replaces` is a stored uid rather than a derived key', () => {
    const base = snapshot({
      templateRows: [
        // Carries the MDMS uniqueIdentifier the row was read with, as a real
        // record does.
        { id: 'legacy-uid-1', module: 'Complaints', eventName: ASSIGN, audience: 'ACTOR:citizen', channel: 'SMS', locale: 'en_IN', body: 'old {id}', active: true } as TemplateRow,
      ],
    });
    const next = applyPendingChanges(base, [
      templateChange({ channel: 'EMAIL', subject: 'S', body: 'new {id}' }, { replaces: 'LEGACY-UID-1' }),
    ]);
    expect(next.templateRows).toHaveLength(1);
    expect(next.templateRows[0].channel).toBe('EMAIL');
  });
});

describe('applyPendingChanges', () => {
  it('replaces a row in place when the key is unchanged', () => {
    const next = applyPendingChanges(snapshot(), [templateChange({ body: 'new text {id}' })]);
    expect(next.templateRows).toHaveLength(2);
    expect(next.templateRows.find((t) => t.eventName === ASSIGN)?.body).toBe('new text {id}');
  });

  it('appends a row whose key is new', () => {
    const next = applyPendingChanges(snapshot(), [templateChange({ locale: 'hi_IN', body: 'नमस्ते {id}' })]);
    expect(next.templateRows).toHaveLength(3);
  });

  it('drops the old row when an edit moved the key fields', () => {
    const next = applyPendingChanges(snapshot(), [
      templateChange({ channel: 'EMAIL', subject: 'S', body: 'b {id}' }, { replaces: `${ASSIGN}.ACTOR:CITIZEN.SMS.EN_IN` }),
    ]);
    expect(next.templateRows).toHaveLength(2);
    expect(next.templateRows.some((t) => t.channel === 'SMS' && t.eventName === ASSIGN)).toBe(false);
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
      { resource: 'notifications-channel', op: 'upsert', row: { code: 'SMS', enabled: false, active: true } },
      { resource: 'notifications-provider-template', op: 'upsert', row: { provider: 'twilio', channel: 'WHATSAPP', audience: 'ACTOR:citizen', eventName: ASSIGN, locale: 'en_IN', templateId: 'HX1', approvalStatus: 'approved', variables: ['id'], active: true } },
    ]);
    expect(next.channelRows).toEqual([{ code: 'SMS', enabled: false, active: true }]);
    expect(next.providerTemplateRows).toHaveLength(1);
    expect(next.routingRows).toBe(base.routingRows);
  });
});

describe('refsForChange', () => {
  it('keys routing/template/provider-template rows on AUDIENCE · EVENT · CHANNEL', () => {
    expect(refsForChange(templateChange({}))).toEqual([`ACTOR:CITIZEN · ${ASSIGN} · SMS`]);
    expect(refsForChange({ resource: 'notifications-provider-template', op: 'upsert', row: { audience: 'ACTOR:citizen', eventName: ASSIGN, channel: 'WHATSAPP' } }))
      .toEqual([`ACTOR:CITIZEN · ${ASSIGN} · WHATSAPP`]);
  });

  it('canonicalises the audience, so a legacy bare name produces the checker\'s ref', () => {
    // Otherwise a save could not recognise its own finding and would block nothing.
    expect(refsForChange({ resource: 'notifications-routing', op: 'upsert', row: { audience: 'CITIZEN', eventName: ASSIGN, channel: 'SMS' } }))
      .toEqual([`ACTOR:CITIZEN · ${ASSIGN} · SMS`]);
  });

  it('keys a channel row on its code', () => {
    expect(refsForChange({ resource: 'notifications-channel', op: 'upsert', row: { code: 'sms' } })).toEqual(['SMS']);
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
      { module: 'Complaints', eventName: ASSIGN, audience: 'ACTOR:citizen', channel: 'SMS', locale: 'en_IN', body: 'Complaint {id}', active: true },
    ] });
    expect(checkPendingChanges(broken, []).after.some((f) => f.level === 'error')).toBe(true);
    const r = checkPendingChanges(broken, [templateChange({ body: 'Complaint {id} was assigned' })]);
    expect(r.blocking).toEqual([]);
    expect(r.advisory.map((f) => f.rule)).toContain('routing-has-template');
  });

  it('blocks a WhatsApp body whose placeholder the provider template does not declare', () => {
    const base = snapshot({
      routingRows: [{ module: 'Complaints', eventName: ASSIGN, audience: 'ACTOR:citizen', channel: 'WHATSAPP', active: true }],
      templateRows: [{ module: 'Complaints', eventName: ASSIGN, audience: 'ACTOR:citizen', channel: 'WHATSAPP', locale: 'en_IN', body: 'Complaint {id}', active: true }],
      providerTemplateRows: [{ provider: 'twilio', channel: 'WHATSAPP', audience: 'ACTOR:citizen', eventName: ASSIGN, locale: 'en_IN', templateId: 'HX1', approvalStatus: 'approved', variables: ['id'], active: true }],
    });
    expect(checkPendingChanges(base, []).after.filter((f) => f.level === 'error')).toEqual([]);
    const r = checkPendingChanges(base, [templateChange({ channel: 'WHATSAPP', body: 'Complaint {id} for {emp_name}' })]);
    expect(r.blocking.map((f) => f.rule)).toContain('whatsapp-variable-unmapped');
  });

  it('blocks switching off a channel that carries routing rows only when that is an error', () => {
    // Disabling a channel is a WARNING (channel-enabled), never an error — an
    // operator must be able to turn a channel off without a fight.
    const base = snapshot({ channelRows: [{ code: 'SMS', enabled: true, provider: 'p1', active: true }], integrationRows: [{ identifier: 'p1', name: 'P', active: true }] });
    const r = checkPendingChanges(base, [{ resource: 'notifications-channel', op: 'upsert', row: { code: 'SMS', enabled: false, provider: 'p1', active: true } }]);
    expect(r.blocking).toEqual([]);
    expect(r.advisory.map((f) => f.rule)).toContain('channel-enabled');
  });

  it('blocks clearing the provider of an enabled channel that carries routing rows', () => {
    const base = snapshot({ channelRows: [{ code: 'SMS', enabled: true, provider: 'p1', active: true }], integrationRows: [{ identifier: 'p1', name: 'P', active: true }] });
    const r = checkPendingChanges(base, [{ resource: 'notifications-channel', op: 'upsert', row: { code: 'SMS', enabled: true, provider: '', active: true } }]);
    expect(r.blocking.map((f) => f.rule)).toContain('channel-needs-provider');
  });
});

describe('presenting the result', () => {
  it('maps a rule to the field its finding belongs next to', () => {
    expect(fieldForRule('template-needs-body')).toBe('body');
    expect(fieldForRule('email-needs-subject')).toBe('subject');
    expect(fieldForRule('routing-has-template')).toBeUndefined();
    // transition-exists now maps to a field: with the catalogue as the vocabulary
    // it is "this event does not exist", which belongs next to the event picker.
    expect(fieldForRule('transition-exists')).toBe('eventName');
  });

  it('keys field errors by form field and keeps the rule id visible', () => {
    const errors = fieldErrorsFor([
      { level: 'error', rule: 'template-needs-body', message: 'body is empty', ref: 'A' },
      { level: 'error', rule: 'routing-has-template', message: 'no template', ref: 'A' },
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
