import { describe, it, expect } from 'vitest';
import {
  adaptLegacyProviderTemplate,
  adaptLegacyRouting,
  adaptLegacyTemplate,
  catalogueFromLegacyRows,
  catalogueFromWorkflow,
  legacyAudience,
  legacyEventName,
  LEGACY_MODULE,
  PLACEHOLDER_VOCABULARY,
  type BusinessServiceRecord,
} from './legacyAdapter';
import {
  actorNames,
  catalogueModules,
  eventChannels,
  eventsForModule,
  eventFor,
  placeholderNames,
} from './eventCatalogue';
import { naturalKey } from './notificationSaveGuard';

describe('legacyEventName', () => {
  it('builds the module-prefixed event key the box derives', () => {
    expect(legacyEventName('ASSIGN', 'PENDINGATLME')).toBe('COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME');
  });

  it('uppercases and trims, so a hand-edited row still matches', () => {
    expect(legacyEventName(' assign ', 'pendingAtLme')).toBe('COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME');
  });

  it('drops businessService entirely — the column had one value ever', () => {
    // There is no parameter for it. This test exists to make that deliberate.
    expect(legacyEventName('ASSIGN', 'PENDINGATLME')).not.toMatch(/PGR/);
  });

  it('is empty for an empty pair', () => {
    expect(legacyEventName('', '')).toBe('');
  });
});

describe('legacyAudience', () => {
  it('writes out the chain the box resolves', () => {
    expect(legacyAudience('CITIZEN')).toBe('ACTOR:citizen');
    expect(legacyAudience('EMPLOYEE')).toBe('ACTOR:assignee');
    expect(legacyAudience('GRO')).toBe('ROLE:GRO');
    expect(legacyAudience('GRO', true)).toBe('ACTOR:assignee|ROLE:GRO');
  });

  it('leaves a non-notifiable pseudo-audience alone, so the warning still fires', () => {
    expect(legacyAudience('AUTO_ESCALATE')).toBe('AUTO_ESCALATE');
  });
});

describe('adaptLegacy*', () => {
  const routing = [{
    id: 'PGR.ASSIGN.PENDINGATLME.GRO.SMS',
    businessService: 'PGR', fromState: 'PENDINGFORASSIGNMENT',
    action: 'ASSIGN', toState: 'PENDINGATLME', audience: 'GRO',
    assigneeOnly: true, channel: 'SMS', active: true,
  }];

  it('drops businessService, fromState and assigneeOnly, keeping the record id', () => {
    const [r] = adaptLegacyRouting(routing);
    expect(r).toEqual({
      module: LEGACY_MODULE,
      eventName: 'COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME',
      audience: 'ACTOR:assignee|ROLE:GRO',
      channel: 'SMS',
      active: true,
      id: 'PGR.ASSIGN.PENDINGATLME.GRO.SMS',
      _uniqueIdentifier: undefined,
    });
  });

  it('adapts templates and provider templates onto the same key', () => {
    const [t] = adaptLegacyTemplate([{ audience: 'CITIZEN', action: 'ASSIGN', toState: 'PENDINGATLME', channel: 'SMS', locale: 'en_IN', body: 'b', subject: null, active: true }]);
    expect(t.eventName).toBe('COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME');
    expect(t.audience).toBe('ACTOR:citizen');
    expect(t.subject).toBeUndefined();

    const [p] = adaptLegacyProviderTemplate([{ provider: 'twilio', channel: 'WHATSAPP', audience: 'CITIZEN', action: 'ASSIGN', toState: 'PENDINGATLME', locale: 'en_IN', templateId: 'HX1', approvalStatus: 'approved', variables: ['id'], active: true }]);
    expect(p.eventName).toBe('COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME');
    expect(p.audience).toBe('ACTOR:citizen');
  });

  it('produces rows whose derived uid matches the new x-unique tuples', () => {
    const [r] = adaptLegacyRouting([{ action: 'ASSIGN', toState: 'PENDINGATLME', audience: 'CITIZEN', channel: 'SMS', active: true }]);
    expect(naturalKey('notifications-routing', r as unknown as Record<string, unknown>))
      .toBe('COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME.ACTOR:CITIZEN.SMS');
  });
});

describe('catalogueFromWorkflow — mirrors the seed-time generator', () => {
  // workflow-v2 stores action.nextState as the target state's UUID while a
  // routing row keys on the applicationStatus NAME. The generator resolves that
  // once, which is what removed the resolution from the browser.
  const wf: BusinessServiceRecord = {
    businessService: 'PGR',
    states: [
      { uuid: 'u1', state: 'PENDINGFORASSIGNMENT', applicationStatus: 'PENDINGFORASSIGNMENT', actions: [{ action: 'ASSIGN', nextState: 'u2', roles: ['GRO'] }] },
      { uuid: 'u2', state: 'PENDINGATLME', applicationStatus: 'PENDINGATLME', actions: [{ action: 'RESOLVE', nextState: 'u3', roles: ['PGR_LME'] }] },
      { uuid: 'u3', state: 'RESOLVED', applicationStatus: 'RESOLVED', actions: [] },
    ],
  };

  it('emits one row per transition, keyed on the RESOLVED status', () => {
    const rows = catalogueFromWorkflow(wf);
    expect(rows.map((r) => r.eventName)).toEqual([
      'COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME',
      'COMPLAINTS.WORKFLOW.RESOLVE.RESOLVED',
    ]);
    // The raw uuid must never survive into an event key.
    expect(rows.some((r) => String(r.eventName).includes('U2'))).toBe(false);
  });

  it('declares the actors PGR sends and the tokens it fills', () => {
    const row = eventFor(catalogueFromWorkflow(wf), 'COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME');
    expect(actorNames(row)).toEqual(['citizen', 'assignee']);
    expect(placeholderNames(row)).toEqual([...PLACEHOLDER_VOCABULARY]);
  });

  it('deduplicates a transition two states can both reach', () => {
    const dup: BusinessServiceRecord = {
      states: [
        ...(wf.states ?? []),
        { uuid: 'u4', state: 'OTHER', applicationStatus: 'OTHER', actions: [{ action: 'ASSIGN', nextState: 'u2', roles: ['GRO'] }] },
      ],
    };
    expect(catalogueFromWorkflow(dup)).toHaveLength(2);
  });

  it('returns nothing for a missing workflow rather than throwing', () => {
    expect(catalogueFromWorkflow(undefined)).toEqual([]);
  });
});

describe('catalogueFromLegacyRows — the un-migrated tenant stand-in', () => {
  const routing = [
    { action: 'ASSIGN', toState: 'PENDINGATLME', audience: 'CITIZEN', channel: 'SMS', active: true },
    { action: 'ASSIGN', toState: 'PENDINGATLME', audience: 'GRO', channel: 'EMAIL', active: true },
    { action: 'RESOLVE', toState: 'RESOLVED', audience: 'CITIZEN', channel: 'SMS', active: true },
    { action: 'GHOST', toState: 'NOWHERE', audience: 'CITIZEN', channel: 'SMS', active: false },
  ];
  const templates = [
    { audience: 'CITIZEN', action: 'RATE', toState: 'CLOSEDAFTERRESOLUTION', channel: 'WHATSAPP', locale: 'en_IN', body: 'b', active: true },
  ];

  it('derives one event per distinct (action, toState) across every master', () => {
    const rows = catalogueFromLegacyRows(routing, templates);
    expect(rows.map((r) => r.eventName)).toEqual([
      'COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME',
      'COMPLAINTS.WORKFLOW.RATE.CLOSEDAFTERRESOLUTION',
      'COMPLAINTS.WORKFLOW.RESOLVE.RESOLVED',
    ]);
  });

  it('ignores inactive rows — a deactivated row is not a live event', () => {
    expect(catalogueFromLegacyRows(routing, templates).some((r) => String(r.eventName).includes('GHOST'))).toBe(false);
  });

  it('collects the channels the rows actually use', () => {
    const rows = catalogueFromLegacyRows(routing, templates);
    expect(eventChannels(eventFor(rows, 'COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME'))).toEqual(['SMS', 'EMAIL']);
  });

  it('uses the fallback vocabulary, which is what PLACEHOLDER_VOCABULARY is for', () => {
    const row = eventFor(catalogueFromLegacyRows(routing, templates), 'COMPLAINTS.WORKFLOW.RESOLVE.RESOLVED');
    expect(placeholderNames(row)).toEqual([...PLACEHOLDER_VOCABULARY]);
  });

  it('groups everything under one module, so the picker has something to show', () => {
    const rows = catalogueFromLegacyRows(routing, templates);
    expect(catalogueModules(rows)).toEqual([LEGACY_MODULE]);
    expect(eventsForModule(rows, LEGACY_MODULE)).toHaveLength(3);
  });

  it('is empty when the tenant has no legacy rows either', () => {
    expect(catalogueFromLegacyRows([], [])).toEqual([]);
  });
});
